import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import Tesseract from 'tesseract.js';
import { cpus, totalmem, platform, arch } from 'node:os';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

// Synthetic public fixture only. Report aggregate error rates; never print recognition text.
GlobalFonts.registerFromPath(resolve('public/pdfjs-viewer/standard_fonts/LiberationSans-Regular.ttf'), 'OCR fixture');
const normalize = text => text.normalize('NFC').toLowerCase().replace(/\s+/gu, ' ').trim();
function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++) next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (a[i] === b[j] ? 0 : 1)));
    row = next;
  }
  return row[b.length];
}
function image(lines, noisy) {
  const canvas = createCanvas(1600, 480), ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = noisy ? '#444' : '#111'; ctx.font = '46px "OCR fixture"';
  lines.forEach((line, index) => ctx.fillText(line, 60, 100 + index * 85));
  if (noisy) {
    let state = 7717;
    for (let i = 0; i < 10000; i++) { state = (1664525 * state + 1013904223) >>> 0; const x = state % canvas.width; state = (1664525 * state + 1013904223) >>> 0; const y = state % canvas.height; ctx.fillStyle = i % 2 ? '#999' : '#ddd'; ctx.fillRect(x, y, 1, 1); }
  }
  return canvas.toBuffer('image/png');
}
const fixtures = [
  { language: 'ces', lines: ['Příliš žluťoučký kůň úpěl ďábelské ódy.', 'Český dokument obsahuje čísla 12345 a datum.', 'Úpravy zůstávají v tomto zařízení.'] },
  { language: 'eng', lines: ['The quick brown fox jumps over the lazy dog.', 'This document contains numbers 12345 and a date.', 'All document processing stays on this device.'] },
];
const results = [];
let peakRss = process.memoryUsage().rss;
const sampling = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 10);
try {
  for (const fixture of fixtures) for (const noisy of [false, true]) {
    const png = image(fixture.lines, noisy), start = performance.now();
    const worker = await Tesseract.createWorker(fixture.language, Tesseract.OEM.LSTM_ONLY, { langPath: resolve('public/ocr/models'), gzip: false, cacheMethod: 'none', logger: () => {}, errorHandler: () => {} }, { debug_file: '/dev/null' });
    try {
      await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK, user_defined_dpi: '216' });
      const { data } = await worker.recognize(png, { rotateAuto: false }, { text: true, hocr: true });
      const expected = normalize(fixture.lines.join(' ')), actual = normalize(data.text);
      const referenceWords = expected.split(' '), actualWords = actual.split(' ');
      results.push({ language: fixture.language, fixture: noisy ? 'synthetic-light-noise' : 'synthetic-clean', width: 1600, height: 480, characters: [...expected].length, words: referenceWords.length, cer: distance([...expected], [...actual]) / [...expected].length, wer: distance(referenceWords, actualWords) / referenceWords.length, confidence: data.confidence, elapsedMs: Math.round(performance.now() - start) });
    } finally { await worker.terminate(); }
  }
} finally { clearInterval(sampling); peakRss = Math.max(peakRss, process.memoryUsage().rss); }
const report = {
  generatedAt: new Date().toISOString(), engine: 'tesseract.js 7.0.0 / tesseract.js-core 7.0.0', modelsRevision: '87416418657359cb625c412a48b6e1d6d41c29bd',
  environment: { platform: platform(), arch: arch(), node: process.version, cpu: cpus()[0]?.model, logicalCpus: cpus().length, totalRamBytes: totalmem() },
  normalization: 'Unicode NFC, lowercase, collapse whitespace, keep punctuation; Levenshtein characters/words divided by reference length',
  memory: { peakProcessRssBytes: peakRss, samplingIntervalMs: 10, scope: 'Entire Node process including OCR worker threads; not browser peak heap or a per-page guarantee' },
  limitations: ['Four synthetic single-column, upright fixtures. No real scan/camera/document corpus.', 'Noise is deterministic 1px gray dust; no blur/skew/rotation/degraded-paper benchmark.', 'Node engine benchmark proves pinned local engine/models, not browser worker loading, browser offline cache, or production accuracy.'],
  results,
};
writeFileSync(resolve('docs/validation/ocr-benchmark.json'), `${JSON.stringify(report, null, 2)}\n`);
if (results.some(result => !Number.isFinite(result.cer) || result.cer > 0.25)) throw new Error('Synthetic OCR benchmark regression');
console.log(JSON.stringify({ fixtures: results.length, maxCer: Math.max(...results.map(r => r.cer)), maxWer: Math.max(...results.map(r => r.wer)), peakProcessRssBytes: peakRss }));
