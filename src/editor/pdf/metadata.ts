import { PDFDocument, PDFName, PDFObjectCopier, PDFRef } from 'pdf-lib';

/** Copy document metadata only after the caller has checked structural-copy safety. */
export function copyPdfMetadata(source: PDFDocument, output: PDFDocument): void {
  const copier = PDFObjectCopier.for(source.context, output.context);
  const info = source.context.trailerInfo.Info;
  if (info) {
    const copied = copier.copy(info);
    output.context.trailerInfo.Info = copied instanceof PDFRef ? copied : output.context.register(copied);
  }
  for (const name of ['Metadata', 'Version', 'Lang', 'PageLayout', 'PageMode', 'ViewerPreferences']) {
    const value = source.catalog.get(PDFName.of(name));
    if (value) output.catalog.set(PDFName.of(name), copier.copy(value));
  }
}
