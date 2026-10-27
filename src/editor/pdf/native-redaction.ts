import { createEngineModule } from '../../js/editcore/engine-loader.js';

type NativeModule = {
  HEAPU8: Uint8Array;
  _malloc(size: number): number;
  _free(ptr: number): void;
  _PDFiumExt_Init(): void;
  _FPDF_LoadMemDocument64(ptr: number, length: number, password: number): number;
  _FPDF_CloseDocument(ptr: number): void;
  _FPDF_GetPageCount(ptr: number): number;
  _FPDF_LoadPage(doc: number, index: number): number;
  _FPDF_ClosePage(ptr: number): void;
  _FPDFPage_CreateAnnot(page: number, subtype: number): number;
  _FPDFPage_CloseAnnot(annot: number): void;
  _FPDFAnnot_SetRect(annot: number, rect: number): number;
  _EPDFAnnot_ApplyRedaction(page: number, annot: number, removedCount: number): number;
  _FPDFPage_GenerateContent(page: number): number;
  _PDFiumExt_OpenFileWriter(): number;
  _PDFiumExt_SaveAsCopy(doc: number, writer: number): number;
  _PDFiumExt_GetFileWriterSize(writer: number): number;
  _PDFiumExt_GetFileWriterData(writer: number, buffer: number, length: number): number;
  _PDFiumExt_CloseFileWriter(writer: number): void;
};

export interface NativeRedactionRect { readonly pageIndex: number; readonly rect: readonly [number, number, number, number] }
const REDACT_ANNOTATION = 28; // public/fpdf_annot.h FPDF_ANNOT_REDACT

/** A fresh PDFium document pointer. The live editor engine is never touched. */
export async function nativeRedactCopy(bytes: Uint8Array, marks: readonly NativeRedactionRect[], signal: AbortSignal): Promise<Uint8Array> {
  signal.throwIfAborted();
  const native = await createEngineModule() as NativeModule;
  native._PDFiumExt_Init();
  const input = native._malloc(bytes.length), docBytes = bytes.slice();
  if (!input) throw new Error('native-memory');
  native.HEAPU8.set(docBytes, input);
  let doc = 0;
  try {
    doc = native._FPDF_LoadMemDocument64(input, docBytes.length, 0);
    if (!doc) throw new Error('native-open');
    const pageCount = native._FPDF_GetPageCount(doc);
    if (marks.some(mark => mark.pageIndex < 0 || mark.pageIndex >= pageCount)) throw new Error('native-page');
    for (const mark of marks) {
      signal.throwIfAborted();
      const page = native._FPDF_LoadPage(doc, mark.pageIndex);
      if (!page) throw new Error('native-page');
      try {
        const annot = native._FPDFPage_CreateAnnot(page, REDACT_ANNOTATION);
        if (!annot) throw new Error('native-annotation');
        try {
          const [x, y, width, height] = mark.rect;
          const rect = native._malloc(16); // FS_RECTF { left, top, right, bottom }, four float32s
          if (!rect) throw new Error('native-memory');
          try {
            const view = new DataView(native.HEAPU8.buffer);
            view.setFloat32(rect, x, true);
            view.setFloat32(rect + 4, y + height, true);
            view.setFloat32(rect + 8, x + width, true);
            view.setFloat32(rect + 12, y, true);
            if (!native._FPDFAnnot_SetRect(annot, rect)) throw new Error('native-rect');
          } finally { native._free(rect); }
          // This removes intersecting page objects and annotations in the pinned PDFium source.
          if (!native._EPDFAnnot_ApplyRedaction(page, annot, 0)) throw new Error('native-redaction');
        } finally { native._FPDFPage_CloseAnnot(annot); }
        if (!native._FPDFPage_GenerateContent(page)) throw new Error('native-content');
      } finally { native._FPDF_ClosePage(page); }
    }
    signal.throwIfAborted();
    const writer = native._PDFiumExt_OpenFileWriter();
    if (!writer) throw new Error('native-writer');
    try {
      // Pinned main.cpp calls FPDF_SaveAsCopy(..., 0): full rewrite, never incremental.
      if (!native._PDFiumExt_SaveAsCopy(doc, writer)) throw new Error('native-save');
      const length = native._PDFiumExt_GetFileWriterSize(writer);
      if (!Number.isSafeInteger(length) || length < 8 || length > 100 * 1024 * 1024) throw new Error('native-size');
      const output = native._malloc(length);
      if (!output) throw new Error('native-memory');
      try {
        if (native._PDFiumExt_GetFileWriterData(writer, output, length) !== length) throw new Error('native-read');
        return native.HEAPU8.slice(output, output + length);
      } finally { native._free(output); }
    } finally { native._PDFiumExt_CloseFileWriter(writer); }
  } finally {
    if (doc) native._FPDF_CloseDocument(doc);
    native._free(input);
    docBytes.fill(0);
  }
}
