import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFStream,
  degrees,
  type PDFObject,
} from 'pdf-lib';

export type PageOperation = 'rotate' | 'extract' | 'merge' | 'crop';
export type PageOperationErrorCode =
  | 'invalid-input'
  | 'invalid-selection'
  | 'invalid-angle'
  | 'invalid-crop'
  | 'unsupported-structure'
  | 'encrypted'
  | 'signed'
  | 'limit-exceeded';
export class PageOperationError extends Error {
  constructor(public readonly code: PageOperationErrorCode) {
    super(code);
    this.name = 'PageOperationError';
  }
}
export interface PdfCropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
const maxInputBytes = 50 * 1024 * 1024;
const maxCombinedBytes = 100 * 1024 * 1024;
const maxPages = 200;
const fail = (code: PageOperationErrorCode): never => {
  throw new PageOperationError(code);
};

function hasSignature(doc: PDFDocument): boolean {
  const visited = new Set<PDFObject>();
  const visit = (object: PDFObject): boolean => {
    if (visited.has(object)) return false;
    visited.add(object);
    const dict = object instanceof PDFStream ? object.dict : object;
    if (dict instanceof PDFDict) {
      if (
        dict.has(PDFName.of('ByteRange')) ||
        dict.get(PDFName.of('Type')) === PDFName.of('Sig') ||
        dict.get(PDFName.of('FT')) === PDFName.of('Sig')
      )
        return true;
      return dict.values().some(visit);
    }
    return object instanceof PDFArray && object.asArray().some(visit);
  };
  return (
    doc.catalog.has(PDFName.of('Perms')) ||
    doc.context.enumerateIndirectObjects().some(([, object]) => visit(object))
  );
}

function assertSupported(doc: PDFDocument, operation: PageOperation): void {
  if (doc.isEncrypted) fail('encrypted');
  if (hasSignature(doc)) fail('signed');
  if (doc.getPageCount() > maxPages) fail('limit-exceeded');
  if (doc.getPageCount() === 0) fail('invalid-input');
  if (operation !== 'extract' && operation !== 'merge') return;
  // Page copying does not rebuild document-wide references. Refuse unknown structures.
  const catalogKeys = new Set([
    'Type',
    'Pages',
    'Metadata',
    'Version',
    'Lang',
    'PageLayout',
    'PageMode',
    'ViewerPreferences',
  ]);
  if (doc.catalog.keys().some((key) => !catalogKeys.has(key.decodeText())))
    fail('unsupported-structure');
  for (const page of doc.getPages()) {
    const annotations = page.node.get(PDFName.of('Annots'));
    if (annotations !== undefined) {
      const resolved = doc.context.lookup(annotations);
      if (!(resolved instanceof PDFArray) || resolved.size() > 0)
        fail('unsupported-structure');
    }
    if (
      [
        'AA',
        'StructParents',
        'AF',
        'B',
        'PresSteps',
        'SeparationInfo',
        'VP',
      ].some((key) => page.node.has(PDFName.of(key)))
    )
      fail('unsupported-structure');
  }
}

async function load(
  bytes: Uint8Array,
  operation: PageOperation
): Promise<PDFDocument> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0)
    fail('invalid-input');
  if (bytes.byteLength > maxInputBytes) fail('limit-exceeded');
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes.slice(), {
      ignoreEncryption: true,
      updateMetadata: false,
      throwOnInvalidObject: true,
    });
  } catch {
    return fail('invalid-input');
  }
  assertSupported(doc, operation);
  return doc;
}

/** Validate original bytes before any bridge reserialization can remove structures. */
export async function assertPageOperationSupported(
  bytes: Uint8Array,
  operation: PageOperation
): Promise<void> {
  await load(bytes, operation);
}

function selection(indices: readonly number[], count: number): void {
  if (
    !indices.length ||
    new Set(indices).size !== indices.length ||
    indices.some(
      (index) => !Number.isInteger(index) || index < 0 || index >= count
    )
  )
    fail('invalid-selection');
}

export async function rotatePdfPages(
  bytes: Uint8Array,
  indices: readonly number[],
  angle: number
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(angle) || angle % 90 !== 0) fail('invalid-angle');
  const doc = await load(bytes, 'rotate');
  selection(indices, doc.getPageCount());
  for (const index of indices) {
    const page = doc.getPage(index);
    page.setRotation(
      degrees((((page.getRotation().angle + (angle % 360)) % 360) + 360) % 360)
    );
  }
  return doc.save();
}

/** Retains the original document metadata. Extraction is not sanitization. */
export async function extractPdfPages(
  bytes: Uint8Array,
  indices: readonly number[]
): Promise<Uint8Array> {
  const doc = await load(bytes, 'extract');
  selection(indices, doc.getPageCount());
  const selected = indices.map((index) => doc.getPage(index));
  while (doc.getPageCount()) doc.removePage(doc.getPageCount() - 1);
  for (const page of selected) doc.addPage(page);
  return doc.save();
}

/** First input owns document metadata/settings; other inputs contribute only pages. */
export async function mergePdfDocuments(
  inputs: readonly Uint8Array[]
): Promise<Uint8Array> {
  if (!inputs.length || inputs.some((bytes) => !(bytes instanceof Uint8Array)))
    fail('invalid-input');
  if (
    inputs.reduce((sum, bytes) => sum + bytes.byteLength, 0) > maxCombinedBytes
  )
    fail('limit-exceeded');
  const first = inputs[0];
  if (!first) return fail('invalid-input');
  const doc = await load(first, 'merge');
  for (const input of inputs.slice(1)) {
    const source = await load(input, 'merge');
    if (doc.getPageCount() + source.getPageCount() > maxPages)
      fail('limit-exceeded');
    const pages = await doc.copyPages(source, source.getPageIndices());
    for (const page of pages) doc.addPage(page);
  }
  return doc.save();
}

/** Visual CropBox only, in unrotated PDF user coordinates; hidden content remains. */
export async function cropPdfPages(
  bytes: Uint8Array,
  indices: readonly number[],
  box: PdfCropBox
): Promise<Uint8Array> {
  if (
    ![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
    box.width <= 0 ||
    box.height <= 0
  )
    fail('invalid-crop');
  const doc = await load(bytes, 'crop');
  selection(indices, doc.getPageCount());
  for (const index of indices) {
    const media = doc.getPage(index).getMediaBox();
    if (
      box.x < media.x ||
      box.y < media.y ||
      box.x + box.width > media.x + media.width ||
      box.y + box.height > media.y + media.height
    )
      fail('invalid-crop');
  }
  for (const index of indices)
    doc.getPage(index).setCropBox(box.x, box.y, box.width, box.height);
  return doc.save();
}
