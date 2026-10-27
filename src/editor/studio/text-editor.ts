import { t } from '../i18n';
import type { StudioObject, StudioTextRun } from './types';

/** List labels are ordinary editable text, retained by every text export. */
export function formatTextList(object: StudioObject, kind: 'bullet' | 'number' | 'none'): void {
  if (object.kind !== 'text' || object.locked) return;
  const runs = object.textRuns ?? [{ text: object.text ?? '' }];
  const source = runs.map(run => run.text).join('');
  const output: StudioTextRun[] = [];
  let cursor = 0, number = 1;
  let runIndex = 0, runOffset = 0;
  const runAt = (position: number) => {
    while (runIndex < runs.length - 1 && runOffset + runs[runIndex].text.length <= position) {
      runOffset += runs[runIndex++].text.length;
    }
    return runs[runIndex];
  };
  const slice = (start: number, end: number) => {
    while (start < end) {
      const run = runAt(start), to = Math.min(end, runOffset + run.text.length);
      output.push({ ...run, text: run.text.slice(start - runOffset, to - runOffset) });
      start = to;
    }
  };
  for (const paragraph of source.split('\n')) {
    const prefix = /^(?:•\s+|\d+\.\s+)/u.exec(paragraph)?.[0].length ?? 0;
    const content = paragraph.slice(prefix);
    if (kind !== 'none' && content.trim()) {
      const style = runAt(cursor + prefix);
      output.push({ ...style, text: kind === 'bullet' ? '• ' : `${number++}. ` });
    }
    slice(cursor + prefix, cursor + paragraph.length);
    cursor += paragraph.length;
    if (cursor < source.length) { slice(cursor, cursor + 1); cursor++; }
  }
  const text = output.map(run => run.text).join('');
  if (text.length > 100000 || output.length > 10000) throw new Error(t('Text list exceeds the project limit.'));
  object.text = text; object.textRuns = output;
}

