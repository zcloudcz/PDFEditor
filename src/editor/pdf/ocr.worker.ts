// Classic worker: retain an immediately terminable handle during core/model loading.
// The pinned upstream worker may print native diagnostics; never expose document data.
for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  self.console[method] = () => {};
}
importScripts(new URL('/ocr/tesseract-worker.min.js', self.location.origin).href);
