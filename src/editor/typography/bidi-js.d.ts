declare module 'bidi-js' {
  export default function factory(): {
    getEmbeddingLevels(text: string, direction?: 'ltr' | 'rtl'): { levels: Uint8Array; paragraphs: { start: number; end: number; level: number }[] };
    getReorderSegments(text: string, levels: { levels: Uint8Array; paragraphs: { start: number; end: number; level: number }[] }): [number, number][];
  };
}
