import type { StudioObject } from './types';
import { getTextRuns, layoutText, textRunFamily } from './text-layout';

type Run = { text: string; bold?: boolean; italic?: boolean; underline?: boolean; fontSize?: number; color?: string };
type Emphasis = 'bold' | 'italic' | 'underline';
type Snapshot = { runs: Run[]; start: number; end: number };
export interface InlineTextEditor {
  element: HTMLDivElement;
  format(style: Emphasis): void;
  formatValues(patch: { fontSize?: number; color?: string }): boolean;
  state(style: Emphasis): boolean | 'mixed';
  updateStyle(): void;
  focus(selectAll?: boolean): void;
  focusAt(x: number, y: number): void;
  finish(): void;
  destroy(): void;
}

/** DOM is only an editing surface; persisted runs contain plain text and booleans. */
export function createInlineTextEditor(
  object: StudioObject,
  options: { label: string; change(): void; finish(): void; selectionChanged?(): void },
): InlineTextEditor {
  const element = document.createElement('div');
  element.className = 'studio-inline-text';
  element.contentEditable = 'true';
  element.setAttribute('contenteditable', 'true');
  element.tabIndex = 0;
  element.setAttribute('role', 'textbox');
  element.setAttribute('aria-multiline', 'true');
  element.setAttribute('aria-label', options.label);
  element.spellcheck = true;
  let composing = false, pendingFinish = false, disposed = false;
  let savedSelection = { start: 0, end: 0 };
  let snapshots: Snapshot[] = [], cursor = -1;
  let typingStyle: Omit<Run, 'text'> | undefined;
  let typingSpan: HTMLSpanElement | undefined;

  function readRuns(): Run[] {
    const runs: Run[] = [];
    function visit(node: Node, style: Omit<Run, 'text'> = {}) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.textContent) runs.push({ text: node.textContent, ...style });
        return;
      }
      if (!(node instanceof HTMLElement)) return;
      if (node.tagName === 'BR') { runs.push({ text: '\n', ...style }); return; }
      const next = { ...style };
      for (const key of ['bold', 'italic', 'underline'] as const) {
        if (node.dataset[key] !== undefined) next[key] = node.dataset[key] === 'true';
      }
      if (node.dataset.fontSize) next.fontSize = Number(node.dataset.fontSize);
      if (node.dataset.color) next.color = node.dataset.color;
      if (node.tagName === 'B' || node.tagName === 'STRONG') next.bold = true;
      if (node.tagName === 'I' || node.tagName === 'EM') next.italic = true;
      if (node.tagName === 'U') next.underline = true;
      if ((node.tagName === 'DIV' || node.tagName === 'P') && node !== element && runs.length && !runs.at(-1)?.text.endsWith('\n')) runs.push({ text: '\n', ...next });
      node.childNodes.forEach(child => visit(child, next));
    }
    element.childNodes.forEach(node => visit(node));
    let remaining = 100000;
    return runs.flatMap(run => {
      const text = run.text.slice(0, remaining); remaining -= text.length;
      return text ? [{ ...run, text }] : [];
    });
  }
  function rememberSelection() {
    const selection = document.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return;
    if (typingSpan && !typingSpan.contains(range.startContainer)) { typingStyle = undefined; typingSpan = undefined; }
    const prefix = document.createRange(); prefix.selectNodeContents(element);
    prefix.setEnd(range.startContainer, range.startOffset);
    const end = document.createRange(); end.selectNodeContents(element); end.setEnd(range.endContainer, range.endOffset);
    savedSelection = { start: prefix.toString().length, end: end.toString().length };
    options.selectionChanged?.();
  }
  function restoreSelection() {
    element.focus();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = []; let node: Node | null;
    while ((node = walker.nextNode())) if (node instanceof Text) nodes.push(node);
    if (!nodes.length) { element.append(document.createTextNode('')); nodes.push(element.firstChild as Text); }
    const point = (offset: number): [Node, number] => {
      for (const text of nodes) {
        if (offset <= text.length) return [text, offset];
        offset -= text.length;
      }
      const last = nodes[nodes.length - 1]; return [last, last.length];
    };
    const range = document.createRange();
    range.setStart(...point(savedSelection.start)); range.setEnd(...point(savedSelection.end));
    const selection = document.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
  }
  function renderRuns(runs: Run[]) {
    element.replaceChildren();
    let paragraph: HTMLElement = element;
    const nextParagraph = () => {
      paragraph = document.createElement('div'); paragraph.dataset.textParagraph = 'true';
      paragraph.style.minHeight = `${(object.fontSize ?? 24) * (object.lineHeight ?? 1.2)}px`;
      element.append(paragraph);
    };
    if (object.paragraphSpacing) nextParagraph();
    const appendRun = (run: Run) => {
      const span = document.createElement('span');
      span.textContent = run.text;
      for (const key of ['bold', 'italic', 'underline'] as const) if (run[key] !== undefined) span.dataset[key] = String(run[key]);
      span.style.fontFamily = `'${textRunFamily(object, run)}', sans-serif`;
      if (run.fontSize !== undefined) { span.dataset.fontSize = String(run.fontSize); span.style.fontSize = `${run.fontSize}px`; }
      if (run.color !== undefined) { span.dataset.color = run.color; span.style.color = run.color; }
      span.style.textDecoration = (run.underline ?? object.underline) ? 'underline' : 'none';
      paragraph.append(span);
    };
    for (const run of runs) {
      if (!object.paragraphSpacing) { appendRun(run); continue; }
      const parts = run.text.split('\n');
      parts.forEach((part, index) => {
        if (part) appendRun({ ...run, text: part });
        if (index < parts.length - 1) {
          // The explicit text node keeps range offsets/serialization unchanged.
          // Its whitespace is collapsed; the paragraph box owns the line break.
          const newline = document.createElement('span'); newline.textContent = '\n'; newline.style.whiteSpace = 'normal';
          paragraph.append(newline); paragraph.style.marginBottom = `${object.paragraphSpacing}px`;
          nextParagraph();
        }
      });
    }
  }
  function publish(runs = readRuns(), record = true) {
    object.text = runs.map(run => run.text).join(''); object.textRuns = runs;
    if (record) {
      const snap = { runs: structuredClone(runs), ...savedSelection };
      if (cursor < 0 || JSON.stringify(snap.runs) !== JSON.stringify(snapshots[cursor].runs)) {
        snapshots = snapshots.slice(0, cursor + 1); snapshots.push(snap); cursor++;
        if (snapshots.length > 80) { snapshots.shift(); cursor--; }
      }
    }
    updateStyle(); options.change(); options.selectionChanged?.();
  }
  function updateStyle() {
    element.dir = object.textDirection ?? 'auto';
    element.lang = object.textLanguage ?? 'und';
    const size = object.fontSize ?? 24;
    const layout = layoutText(object);
    const first = layout.lines[0];
    const firstSize = first?.runs.length ? Math.max(...first.runs.map(run => run.fontSize)) : size;
    const shift = Math.max(0, (first?.y ?? firstSize) - firstSize);
    Object.assign(element.style, {
      fontFamily: `'${object.fontFamily ?? 'Liberation Sans'}', sans-serif`,
      fontSize: `${size}px`, lineHeight: String(object.lineHeight ?? 1.2),
      letterSpacing: `${object.tracking ?? 0}px`,
      opacity: String(object.opacity),
      color: object.fill === 'none' ? 'transparent' : object.fill,
      textAlign: object.textAlign ?? 'left', paddingTop: `${shift}px`,
      whiteSpace: object.wrapText ? 'pre-wrap' : 'pre', overflowWrap: object.wrapText ? 'anywhere' : 'normal',
    });
  }
  function format(style: Emphasis) {
    if (composing || disposed) return;
    rememberSelection();
    const runs = readRuns();
    let offset = 0;
    const start = savedSelection.start, end = savedSelection.end;
    const effective = (run: Run) => style === 'underline' ? (run.underline ?? object.underline ?? false) : (run[style] ?? textRunFamily(object, run).includes(style === 'bold' ? 'Bold' : 'Italic'));
    const target = runs.filter(run => { const from = offset; offset += run.text.length; return offset > start && from < end; });
    if (start === end) {
      const current = caretStyle();
      seedTypingStyle({ [style]: !current[style] });
      return;
    }
    const value = !target.every(effective);
    applyRange({ [style]: value });
  }
  function applyRange(patch: Partial<Omit<Run, 'text'>>): boolean {
    if (composing || disposed) return false;
    rememberSelection();
    const start = savedSelection.start, end = savedSelection.end;
    if (start === end) { seedTypingStyle(patch); return true; }
    const runs = readRuns();
    let offset = 0;
    const next: Run[] = [];
    for (const run of runs) {
      const from = offset; offset += run.text.length;
      const a = Math.max(0, start - from), b = Math.min(run.text.length, end - from);
      if (a >= b) { next.push(run); continue; }
      if (a) next.push({ ...run, text: run.text.slice(0, a) });
      next.push({ ...run, text: run.text.slice(a, b), ...patch });
      if (b < run.text.length) next.push({ ...run, text: run.text.slice(b) });
    }
    renderRuns(next); restoreSelection(); publish(next); options.selectionChanged?.();
    return true;
  }
  function caretStyle(): Omit<Run, 'text'> {
    if (typingStyle) return typingStyle;
    let offset = 0;
    const runs = getTextRuns({ ...object, textRuns: readRuns() });
    const run = runs.find(item => { offset += item.text.length; return offset >= savedSelection.start; }) ?? getTextRuns({ ...object, textRuns: undefined })[0];
    const { text: _text, ...style } = run;
    return style;
  }
  function seedTypingStyle(patch: Partial<Omit<Run, 'text'>>) {
    const style = { ...caretStyle(), ...patch };
    restoreSelection();
    const selection = document.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    const span = document.createElement('span');
    for (const key of ['bold', 'italic', 'underline'] as const) if (style[key] !== undefined) span.dataset[key] = String(style[key]);
    span.dataset.fontSize = String(style.fontSize ?? object.fontSize ?? 24); span.dataset.color = style.color ?? object.fill;
    span.style.fontFamily = `'${textRunFamily(object, { text: '', ...style })}', sans-serif`;
    span.style.fontSize = `${span.dataset.fontSize}px`; span.style.color = span.dataset.color;
    span.style.textDecoration = style.underline ? 'underline' : 'none';
    const text = document.createTextNode(''); span.append(text); range.insertNode(span);
    range.setStart(text, 0); range.collapse(true); selection.removeAllRanges(); selection.addRange(range);
    typingStyle = style; typingSpan = span; options.selectionChanged?.();
  }
  function replaceSelection(text: string) {
    rememberSelection();
    const live = document.getSelection();
    if (!live?.rangeCount || !element.contains(live.getRangeAt(0).startContainer)) restoreSelection();
    const selection = document.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text); range.insertNode(node);
    range.setStartAfter(node); range.collapse(true); selection.removeAllRanges(); selection.addRange(range);
    rememberSelection(); publish();
  }
  function finish() {
    if (disposed) return;
    if (composing) { pendingFinish = true; return; }
    publish(); options.finish();
  }
  element.addEventListener('input', () => { if (!composing) { rememberSelection(); publish(); } });
  element.addEventListener('compositionstart', () => { composing = true; });
  element.addEventListener('compositionend', () => { composing = false; rememberSelection(); publish(); if (pendingFinish) finish(); });
  element.addEventListener('beforeinput', event => {
    if (composing) return;
    if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') { event.preventDefault(); replaceSelection('\n'); }
  });
  element.addEventListener('paste', event => { event.preventDefault(); event.stopPropagation(); replaceSelection(event.clipboardData?.getData('text/plain') ?? ''); });
  element.addEventListener('drop', event => { event.preventDefault(); event.stopPropagation(); });
  element.addEventListener('keydown', event => {
    event.stopPropagation();
    if (composing || event.isComposing) return;
    const mod = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
    if (mod && ['b', 'i', 'u'].includes(key)) { event.preventDefault(); format(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline'); }
    else if (mod && (key === 'z' || key === 'y')) {
      event.preventDefault();
      const next = cursor + (key === 'y' || event.shiftKey ? 1 : -1);
      if (next >= 0 && next < snapshots.length) {
        cursor = next; const snapshot = snapshots[cursor]; savedSelection = { start: snapshot.start, end: snapshot.end };
        renderRuns(snapshot.runs); restoreSelection(); publish(snapshot.runs, false);
      }
    } else if (event.key === 'Escape') { event.preventDefault(); finish(); }
  });
  for (const event of ['pointerdown', 'pointerup', 'click', 'dblclick', 'keyup', 'copy', 'cut']) element.addEventListener(event, e => e.stopPropagation());
  document.addEventListener('selectionchange', rememberSelection);
  renderRuns(getTextRuns(object)); updateStyle();
  snapshots = [{ runs: readRuns(), ...savedSelection }]; cursor = 0;
  return {
    element, format, formatValues: applyRange, updateStyle,
    state(style) {
      if (savedSelection.start === savedSelection.end && typingStyle) return !!typingStyle[style];
      let offset = 0;
      const runs = getTextRuns({ ...object, textRuns: readRuns() });
      const selected = runs.filter(run => { const from = offset; offset += run.text.length; return savedSelection.start === savedSelection.end ? from <= savedSelection.start && offset >= savedSelection.start : offset > savedSelection.start && from < savedSelection.end; });
      return selected.every(run => run[style]) ? true : selected.some(run => run[style]) ? 'mixed' : false;
    },
    focus(selectAll = false) { if (selectAll) savedSelection = { start: 0, end: object.text?.length ?? 0 }; restoreSelection(); },
    focusAt(x, y) {
      element.focus();
      const doc = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null; caretRangeFromPoint?: (x: number, y: number) => Range | null };
      const point = doc.caretPositionFromPoint?.(x, y);
      const legacy = point ? undefined : doc.caretRangeFromPoint?.(x, y);
      const node = point?.offsetNode ?? legacy?.startContainer;
      const offset = point?.offset ?? legacy?.startOffset;
      if (node && offset !== undefined && element.contains(node)) {
        const range = document.createRange(); range.setStart(node, offset); range.collapse(true);
        const selection = document.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); rememberSelection();
      }
    },
    finish,
    destroy() { disposed = true; document.removeEventListener('selectionchange', rememberSelection); element.remove(); },
  };
}
