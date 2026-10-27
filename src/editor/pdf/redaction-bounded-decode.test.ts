// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { createRedactionDecoder, loadRedactionDocument } from './redaction-bounded-decode';

describe('redaction allocation-time decoding budget', () => {
  it('stops a single compressed block before allocating beyond its stream cap', async () => {
    const doc = await PDFDocument.create();
    const stream = doc.context.flateStream(new Uint8Array(1024 * 1024));
    const NativeArray = Uint8Array; const allocations: number[] = [];
    vi.stubGlobal('Uint8Array', new Proxy(NativeArray, {
      construct(target, args) { if (typeof args[0] === 'number') allocations.push(args[0]); return Reflect.construct(target, args); },
    }));
    try { expect(() => createRedactionDecoder(1024, 2048)(stream)).toThrow('limit-exceeded'); }
    finally { vi.unstubAllGlobals(); }
    expect(Math.max(...allocations)).toBeLessThanOrEqual(1024);
  });

  it('enforces aggregate allocated storage across individually supported streams', async () => {
    const doc = await PDFDocument.create(), decode = createRedactionDecoder(1024, 1536);
    const first = doc.context.flateStream(new Uint8Array(600));
    const second = doc.context.flateStream(new Uint8Array(600));
    expect(decode(first)).toHaveLength(600);
    expect(decode(first)).toHaveLength(600); // cached reads do not consume another allocation
    expect(() => decode(second)).toThrow('limit-exceeded');
  });

  it('caps raw streams before decoding or copying them', async () => {
    const doc = await PDFDocument.create(), stream = doc.context.stream(new Uint8Array(1025));
    expect(() => createRedactionDecoder(1024, 2048)(stream)).toThrow('limit-exceeded');
  });
});


it('applies one aggregate budget across separate load-time object streams', async () => {
  const doc = await PDFDocument.create(); doc.addPage([300, 300]);
  for (let index = 0; index < 3; index++) doc.context.register(doc.context.flateStream(new Uint8Array(600).fill(32), { Type: 'ObjStm', N: 0, First: 0 }));
  const bytes = await doc.save({ useObjectStreams: false });
  await expect(loadRedactionDocument(bytes, createRedactionDecoder(1024, 1536))).rejects.toMatchObject({ code: 'limit-exceeded' });
});
