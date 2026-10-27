import { describe, expect, it } from 'vitest';
import { formatTextList } from './text-editor';
import type { StudioObject } from './types';
const text = (): StudioObject => ({ id: 't', kind: 'text', name: 'T', text: 'First\nSecond\n\nThird', textRuns: [{ text: 'First\n', bold: true }, { text: 'Second\n\nThird', color: '#ff0000' }], fontSize: 20, x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1, fill: '#000000', stroke: 'none', strokeWidth: 0, locked: false });
describe('editable list formatting', () => {
  it('numbers paragraphs without losing styles or empty paragraphs; reversible to bullets/plain', () => {
    const object = text(); formatTextList(object, 'number');
    expect(object.text).toBe('1. First\n2. Second\n\n3. Third');
    expect(object.textRuns?.find(run => run.text === 'First')?.bold).toBe(true);
    expect(object.textRuns?.find(run => run.text === 'Second')?.color).toBe('#ff0000');
    formatTextList(object, 'bullet'); expect(object.text).toBe('• First\n• Second\n\n• Third');
    formatTextList(object, 'none'); expect(object.text).toBe(text().text);
  });
  it('leaves locked text untouched', () => {
    const object = text(); object.locked = true; const original = structuredClone(object);
    formatTextList(object, 'bullet'); expect(object).toEqual(original);
  });
});
