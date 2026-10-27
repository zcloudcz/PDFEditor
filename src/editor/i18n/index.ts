import { EDITOR_LOCALES, type EditorLocale } from './locales';

export { EDITOR_LOCALES, type EditorLocale } from './locales';
export const LANGUAGE_STORAGE_KEY = 'zcloud-pdf-editor-language';
type Messages = Record<string, string>;
const loaders = import.meta.glob<{ default: Messages }>('./translations/*.json');
const cache = new Map<string, Messages>();
let locale: EditorLocale = 'cs';
let messages: Messages = {};
let fallback: Messages = {};
let request = 0;
const bindings = new Map<Element, { value: () => string; last: string }>();

export function resolveLocale(value: string | null | undefined): EditorLocale | undefined {
  const normalized = value?.replace(/_/g, '-').toLowerCase();
  if (!normalized) return undefined;
  if (/^zh-(tw|hk|mo|hant)(-|$)/.test(normalized)) return 'zh-TW';
  if (/^(no|nb)(-|$)/.test(normalized)) return 'nb';
  return EDITOR_LOCALES.find(item => item.code.toLowerCase() === normalized)?.code
    ?? EDITOR_LOCALES.find(item => item.code === normalized.split('-')[0])?.code;
}
export function getLocale(): EditorLocale { return locale; }
export function t(source: string, params: Record<string, string | number> = {}): string {
  const value = messages[source] || (locale === 'cs' ? source : fallback[source]) || source;
  return value.replace(/\{(\w+)\}/g, (match, key) => Object.hasOwn(params, key) ? String(params[key]) : match);
}
/** Recover a source only for an explicitly supplied UI message, never document text. */
export function bindUIMessage(element: Element, message: string) {
  const source = Object.entries(messages).find(([, value]) => value === message)?.[0]
    ?? Object.entries(fallback).find(([, value]) => value === message)?.[0] ?? message;
  setUIText(element, () => t(source));
}

/** Bind an explicitly authored UI label; never use for document or user data. */
export function setUIText(element: Element, value: () => string) {
  const label = value();
  bindings.set(element, { value, last: label });
  if (element.textContent !== label) element.textContent = label;
}

export function localizeUI(root: ParentNode = document) {
  const selector = '[data-ui-text],[data-ui-title],[data-ui-aria-label],[data-ui-placeholder],[data-ui-alt],[data-ui-page-label]';
  const nodes = [...root.querySelectorAll<HTMLElement>(selector)];
  if (root instanceof HTMLElement && root.matches(selector)) nodes.unshift(root);
  for (const node of nodes) {
    if (node.closest('svg,.textLayer,[contenteditable="true"],.design-pdf-overlay')) continue;
    let params: Record<string, string | number> = {};
    try { if (node.dataset.uiParams) params = JSON.parse(node.dataset.uiParams); } catch { /* Invalid optional interpolation. */ }
    const source = node.getAttribute('data-ui-text');
    if (source !== null && node.textContent !== t(source, params)) node.textContent = t(source, params);
    for (const attr of ['title', 'aria-label', 'placeholder', 'alt', 'page-label']) {
      const key = node.getAttribute(`data-ui-${attr}`);
      const target = attr === 'page-label' ? 'data-page-label' : attr;
      if (key === null) continue;
      const value = attr === 'page-label' ? `${t(key)} ${params.number}` : t(key, params);
      if (node.getAttribute(target) !== value) node.setAttribute(target, value);
    }
  }
}
async function load(code: string): Promise<Messages> {
  if (cache.has(code)) return cache.get(code)!;
  const loader = loaders[`./translations/${code}.json`];
  const result = loader ? (await loader()).default : {};
  cache.set(code, result);
  return result;
}
export async function setLocale(next: EditorLocale): Promise<void> {
  if (!EDITOR_LOCALES.some(item => item.code === next)) return;
  const generation = ++request;
  const [translated, english] = await Promise.all([load(next), load('en')]);
  if (generation !== request) return;
  locale = next; messages = translated; fallback = english;
  try { localStorage.setItem(LANGUAGE_STORAGE_KEY, next); } catch { /* Optional preference storage. */ }
  document.documentElement.lang = next;
  document.documentElement.dir = EDITOR_LOCALES.find(item => item.code === next)!.dir;
  for (const [node, binding] of bindings) {
    if (!node.isConnected || node.textContent !== binding.last) { bindings.delete(node); continue; }
    const label = binding.value(); if (node.textContent !== label) node.textContent = label;
    binding.last = label;
  }
  localizeUI();
  document.querySelectorAll<HTMLSelectElement>('#editor-language').forEach(select => { select.value = next; });
  window.dispatchEvent(new Event('editor:locale-changed'));
}
export function setupLocalization() {
  const label = document.createElement('label'); label.className = 'editor-language-control';
  const icon = document.createElement('i'); icon.className = 'ph ph-translate'; icon.setAttribute('aria-hidden', 'true');
  const select = document.createElement('select'); select.id = 'editor-language'; select.setAttribute('aria-label', 'Language');
  for (const item of EDITOR_LOCALES) { const option = document.createElement('option'); option.value = item.code; option.textContent = item.name; option.lang = item.code; option.dir = item.dir; select.append(option); }
  label.append(icon, select); document.querySelector('.product-header')?.append(label);
  let preferred: EditorLocale | undefined;
  try { preferred = resolveLocale(localStorage.getItem(LANGUAGE_STORAGE_KEY)); } catch { /* Private mode. */ }
  preferred ??= (navigator.languages || [navigator.language]).map(resolveLocale).find(Boolean) ?? 'en';
  select.value = preferred;
  select.addEventListener('change', () => { void setLocale(select.value as EditorLocale).catch(() => { select.value = locale; }); });
  const observer = new MutationObserver(records => {
    for (const node of bindings.keys()) if (!node.isConnected) bindings.delete(node);
    for (const record of records) for (const node of record.addedNodes) if (node instanceof HTMLElement) localizeUI(node);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  void setLocale(preferred).catch(() => { localizeUI(); });
  return () => observer.disconnect();
}
