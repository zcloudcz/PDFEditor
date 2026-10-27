import { setUIText, t } from '../i18n';
export interface BrandKit {
  name: string;
  colors: string[];
  font: 'Liberation Sans' | 'Liberation Sans Bold' | 'Liberation Sans Italic';
  logo?: string;
}

export const BRAND_STORAGE_KEY = 'pdf-editor-brand-kit-v1';
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export function defaultBrandKit(): BrandKit {
  return { name: 'Studio Nová', colors: ['#204d45', '#d8ef82', '#f6f3eb'], font: 'Liberation Sans' };
}

export function validateLogo(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_LOGO_BYTES * 4 / 3) + 64) return false;
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return false;
  try {
    const bytes = atob(match[2]);
    return bytes.length <= MAX_LOGO_BYTES && (match[1] === 'png'
      ? bytes.startsWith('\x89PNG\r\n\x1a\n')
      : bytes.startsWith('\xff\xd8\xff'));
  } catch { return false; }
}

export function validateBrandKit(value: unknown): value is BrandKit {
  if (!value || typeof value !== 'object') return false;
  const b = value as Record<string, unknown>;
  return typeof b.name === 'string' && b.name.trim().length > 0 && b.name.length <= 80 &&
    ['Liberation Sans', 'Liberation Sans Bold', 'Liberation Sans Italic'].includes(String(b.font)) && Array.isArray(b.colors) && b.colors.length >= 2 && b.colors.length <= 6 &&
    b.colors.every((color: unknown) => typeof color === 'string' && /^#[\da-f]{6}$/i.test(color)) &&
    (b.logo === undefined || validateLogo(b.logo));
}

export function loadBrandKit(): BrandKit {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(BRAND_STORAGE_KEY) || 'null');
    if (validateBrandKit(value)) return { name: value.name, colors: [...value.colors], font: value.font, ...(value.logo ? { logo: value.logo } : {}) };
  } catch { /* Storage can be disabled by the browser. */ }
  return defaultBrandKit();
}

export function saveBrandKit(brand: BrandKit): void {
  if (!validateBrandKit(brand)) throw new Error(t('Zkontrolujte název, barvy a logo značky.'));
  localStorage.setItem(BRAND_STORAGE_KEY, JSON.stringify(brand));
}

export function mountBrandKit(container: HTMLElement, onChange?: (brand: BrandKit) => void): () => void {
  let brand = loadBrandKit();
  let disposed = false;
  let uploadVersion = 0;
  const form = document.createElement('form');
  form.className = 'studio-brand-form';
  form.innerHTML = `<h3><span data-ui-text="Vaše značka">Vaše značka</span></h3><p><span data-ui-text="Uložená jen v tomto prohlížeči. Použije se při vložení nové šablony.">Uložená jen v tomto prohlížeči. Použije se při vložení nové šablony.</span></p>
    <label><span data-ui-text="Název značky">Název značky</span><input name="brandName" maxlength="80" required></label>
    <fieldset><legend><span data-ui-text="Barvy značky">Barvy značky</span></legend><div class="studio-brand-colors"></div></fieldset>
    <label><span data-ui-text="Písmo">Písmo</span><select name="brandFont"><option>Liberation Sans</option><option>Liberation Sans Bold</option><option>Liberation Sans Italic</option></select></label>
    <label><span data-ui-text="Logo (PNG nebo JPEG, do 2 MB)">Logo (PNG nebo JPEG, do 2 MB)</span><input name="brandLogo" type="file" accept="image/png,image/jpeg"></label>
    <img class="studio-brand-logo" alt="Náhled loga značky" data-ui-alt="Náhled loga značky" hidden>
    <button type="button" data-remove-logo><span data-ui-text="Odebrat logo">Odebrat logo</span></button>
    <div class="studio-brand-actions"><button type="submit"><span data-ui-text="Uložit značku">Uložit značku</span></button><button type="button" data-reset><span data-ui-text="Obnovit výchozí">Obnovit výchozí</span></button></div>
    <p class="studio-brand-status" role="status" aria-live="polite"></p>`;
  const name = form.elements.namedItem('brandName') as HTMLInputElement;
  const upload = form.elements.namedItem('brandLogo') as HTMLInputElement;
  const font = form.elements.namedItem('brandFont') as HTMLSelectElement;
  const colors = form.querySelector<HTMLElement>('.studio-brand-colors')!;
  const preview = form.querySelector<HTMLImageElement>('img')!;
  const status = form.querySelector<HTMLElement>('[role=status]')!;
  const render = () => {
    name.value = brand.name;
    font.value = brand.font;
    colors.replaceChildren(...brand.colors.map((color, index) => {
      const input = document.createElement('input'); input.type = 'color'; input.value = color;
      input.setAttribute('aria-label', t('Color {number}', { number: index + 1 })); return input;
    }));
    preview.hidden = !brand.logo;
    if (brand.logo) preview.src = brand.logo; else preview.removeAttribute('src');
  };
  const abort = new AbortController();
  upload.addEventListener('change', async () => {
    const version = ++uploadVersion;
    const file = upload.files?.[0]; if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > MAX_LOGO_BYTES) { setUIText(status, () => t('Logo (PNG nebo JPEG, do 2 MB)')); upload.value = ''; return; }
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject();
        reader.onerror = reject; reader.readAsDataURL(file);
      });
      if (disposed || version !== uploadVersion) return;
      if (!validateLogo(data)) throw new Error();
      await new Promise<void>((resolve, reject) => {
        const img = new Image(); img.onload = () => img.naturalWidth > 0 && img.naturalHeight > 0 && img.naturalWidth * img.naturalHeight <= 16000000 ? resolve() : reject(); img.onerror = reject; img.src = data;
      });
      if (disposed || version !== uploadVersion) return;
      brand.logo = data; preview.src = data; preview.hidden = false; setUIText(status, () => t('Logo připraveno. Uložte značku.'));
    } catch { if (!disposed && version === uploadVersion) setUIText(status, () => t('Logo nelze načíst. Použijte platný PNG/JPEG do 16 megapixelů.')); }
  }, { signal: abort.signal });
  form.querySelector('[data-remove-logo]')!.addEventListener('click', () => { ++uploadVersion; delete brand.logo; upload.value = ''; preview.hidden = true; preview.removeAttribute('src'); setUIText(status, () => t('Logo odebráno. Uložte značku.')); }, { signal: abort.signal });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const next = { ...brand, name: name.value.trim(), font: font.value, colors: Array.from(colors.querySelectorAll('input'), input => input.value) };
    if (!validateBrandKit(next)) { setUIText(status, () => t('Zkontrolujte název, barvy a písmo značky.')); return; }
    try { saveBrandKit(next); brand = next; setUIText(status, () => t('Značka uložena v tomto prohlížeči.')); onChange?.(structuredClone(brand)); }
    catch { setUIText(status, () => t('Značku nelze uložit. Zkontrolujte název a dostupné úložiště prohlížeče.')); }
  }, { signal: abort.signal });
  form.querySelector('[data-reset]')!.addEventListener('click', () => {
    try { localStorage.removeItem(BRAND_STORAGE_KEY); ++uploadVersion; brand = defaultBrandKit(); upload.value = ''; render(); setUIText(status, () => t('Obnovena výchozí značka.')); onChange?.(structuredClone(brand)); }
    catch { setUIText(status, () => t('Úložiště prohlížeče není dostupné.')); }
  }, { signal: abort.signal });
  render(); container.append(form);
  return () => { disposed = true; abort.abort(); form.remove(); };
}
