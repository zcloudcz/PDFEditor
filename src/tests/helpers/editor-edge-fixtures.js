import { PDFDocument, PDFName } from 'pdf-lib';
import forge from 'node-forge';
import { PdfCryptor, PdfSigner, Crypto } from 'zgapdfsigner';
import { parsePemFiles } from '../../js/logic/digital-sign-pdf';

// Synthetic, local-only test material; the certificate is self-signed, not trusted.
export async function edgePdf({ type3 = false } = {}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  page.drawText('Original text', { x: 30, y: 240, size: 14 });
  page.drawText('Keep unchanged', { x: 30, y: 60, size: 14 });
  if (type3) {
    const glyph = doc.context.register(doc.context.stream('600 0 0 0 600 700 d1\n0 0 600 700 re f'));
    const font = doc.context.register(doc.context.obj({
      Type: 'Font', Subtype: 'Type3', FontBBox: [0, 0, 600, 700],
      FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
      CharProcs: { A: glyph }, Encoding: { Type: 'Encoding', Differences: [65, PDFName.of('A')] },
      FirstChar: 65, LastChar: 65, Widths: [600], Resources: {},
    }));
    page.node.Resources().lookup(PDFName.of('Font')).set(PDFName.of('T3'), font);
    page.node.addContentStream(doc.context.register(doc.context.stream('BT /T3 20 Tf 30 150 Td (AAA) Tj ET')));
  }
  return doc.save({ useObjectStreams: false });
}

export async function encryptedPdf(bytes, mode) {
  const doc = await new PdfCryptor({ mode, userpwd: 'reader-secret', ownerpwd: 'owner-secret' }).encryptPdf(bytes);
  return doc.save({ useObjectStreams: false });
}
export const encryptionModes = [['RC4-128', Crypto.Mode.RC4_128], ['AES-128', Crypto.Mode.AES_128], ['AES-256', Crypto.Mode.AES_256]];

export async function signedPdf(bytes) {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 86400000);
  const identity = [{ name: 'commonName', value: 'Synthetic engine test' }];
  cert.setSubject(identity); cert.setIssuer(identity);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const credentials = parsePemFiles(forge.pki.certificateToPem(cert), forge.pki.privateKeyToPem(keys.privateKey));
  return new PdfSigner({ p12cert: credentials.p12Buffer, pwd: credentials.password, reason: 'Engine export verification' }).sign(bytes);
}
