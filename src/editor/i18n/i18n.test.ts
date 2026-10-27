import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, LANGUAGE_STORAGE_KEY, localizeUI, resolveLocale, setLocale, setUIText, setupLocalization, t } from './index';

afterEach(async () => { document.body.replaceChildren(); localStorage.clear(); await setLocale('cs'); });
describe('editor localization boundaries', () => {
  it('updates page captions without modifying page objects', async () => {
    document.body.innerHTML = '<section data-ui-page-label="Stránka" data-ui-params=\'{"number":2}\'><canvas></canvas></section>';
    const canvas = document.querySelector('canvas');
    await setLocale('de');
    expect(document.querySelector('section')!.dataset.pageLabel).toBe('Seite 2');
    await setLocale('cs');
    expect(document.querySelector('section')!.dataset.pageLabel).toBe('Stránka 2');
    expect(document.querySelector('canvas')).toBe(canvas);
  });
  it('resolves browser variants and rejects unsupported locales', () => {
    expect(resolveLocale('cs-CZ')).toBe('cs');
    expect(resolveLocale('zh-Hant-HK')).toBe('zh-TW');
    expect(resolveLocale('zh_CN')).toBe('zh');
    expect(resolveLocale('no-NO')).toBe('nb');
    expect(resolveLocale('xx-XX')).toBeUndefined();
  });
  it('switches explicit UI and retains document text and form values', async () => {
    document.body.innerHTML = `<button data-ui-text="Otevřít PDF"></button><textarea>Otevřít PDF</textarea><svg><text data-ui-text="Otevřít PDF">Otevřít PDF</text></svg><div contenteditable="true" data-ui-text="Otevřít PDF">Otevřít PDF</div><input value="Otevřít PDF">`;
    const input = document.querySelector('input')!;
    input.value = 'Soukromý název';
    await setLocale('en');
    expect(document.querySelector('button')!.textContent).toBe('Open PDF');
    expect(document.querySelector('textarea')!.value).toBe('Otevřít PDF');
    expect(document.querySelector('svg text')!.textContent).toBe('Otevřít PDF');
    expect(document.querySelector('[contenteditable]')!.textContent).toBe('Otevřít PDF');
    expect(input.value).toBe('Soukromý název');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');
  });
  it('keeps HTML in translations as text and updates only registered dynamic labels', async () => {
    const button = document.createElement('button'); document.body.append(button);
    setUIText(button, () => t('Otevřít PDF'));
    await setLocale('en'); expect(button.textContent).toBe('Open PDF');
    button.textContent = '';
    await setLocale('cs'); expect(button.textContent).toBe('');
    document.body.innerHTML = '<span data-ui-text="&lt;img src=x onerror=alert(1)&gt;"></span>';
    localizeUI(); expect(document.querySelector('img')).toBeNull();
  });
  it('sets RTL on interface without changing document model or reloading', async () => {
    const model = { text: 'Soukromý text', x: 120 };
    await setLocale('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
    expect(model).toEqual({ text: 'Soukromý text', x: 120 });
    await setLocale('en'); expect(document.documentElement.dir).toBe('ltr');
  });
  it('honors last language request and ignores unsupported input', async () => {
    await Promise.all([setLocale('en'), setLocale('cs')]);
    expect(getLocale()).toBe('cs');
    await setLocale('unsupported' as never); expect(getLocale()).toBe('cs');
  });
  it('initializes preference and translates newly mounted marked UI', async () => {
    document.body.innerHTML = '<header class="product-header"></header>';
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    const dispose = setupLocalization(); await setLocale('en');
    const node = document.createElement('button'); node.dataset.uiText = 'Otevřít PDF'; document.body.append(node);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(node.textContent).toBe('Open PDF');
    expect(document.querySelectorAll('#editor-language option').length).toBe(49);
    dispose();
  });
});
