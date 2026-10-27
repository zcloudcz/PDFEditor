import { setUIText, t } from '../i18n';
import type { StudioObject, StudioPage, StudioProject } from './types';
import { defaultBrandKit, loadBrandKit, validateBrandKit, type BrandKit } from './brand-kit';

const catalog = [
  { id: 'flyer', name: 'Nový pohled', description: 'A4 · leták pro vaše nápady', width: 595.28, height: 841.89 },
  { id: 'proposal', name: 'Dobrá spolupráce', description: 'A4 · přehledná nabídka služeb', width: 595.28, height: 841.89 },
  { id: 'business-card', name: 'První dojem', description: '90 × 50 mm · osobní vizitka', width: 255.12, height: 141.73 },
  { id: 'presentation', name: 'Velké myšlenky', description: '16:9 · tři snímky prezentace', width: 960, height: 540 },
  { id: 'social', name: 'Malá radost', description: 'Čtverec · příspěvek na sítě', width: 600, height: 600 },
  { id: 'poster', name: 'Potkáme se venku', description: 'A3 · výrazný plakát akce', width: 841.89, height: 1190.55 },
];
export function getTemplates() { return catalog.map(item => ({ ...item })); }
const uid = () => crypto.randomUUID();

export function createTemplate(id: string, brand: BrandKit = defaultBrandKit()): StudioProject {
  const template = catalog.find(item => item.id === id);
  if (!template) throw new Error('Neznámá šablona.');
  if (!validateBrandKit(brand)) throw new Error('Neplatná značka.');
  const [ink, accent] = brand.colors;
  const paper = brand.colors[2] || '#f6f3eb';
  const objects: StudioObject[] = [];
  const shape = (kind: StudioObject['kind'], x: number, y: number, width: number, height: number, fill: string, name = 'Tvar'): StudioObject => {
    const obj: StudioObject = { id: uid(), kind, name, x, y, width, height, fill, rotation: 0, opacity: 1, stroke: 'none', strokeWidth: 0, locked: false };
    objects.push(obj); return obj;
  };
  const rect = (x: number, y: number, w: number, h: number, color: string) => shape('rect', x, y, w, h, color);
  const ellipse = (x: number, y: number, w: number, h: number, color: string) => shape('ellipse', x, y, w, h, color);
  const text = (value: string, x: number, y: number, w: number, size: number, color = ink) => {
    const obj = shape('text', x, y, Math.min(w, template.width - x), size * 1.2 * value.split('\n').length + 3, color, value.replace(/\n/g, ' ').slice(0, 40));
    Object.assign(obj, { text: value, fontSize: size, fontFamily: brand.font, textAlign: 'left' }); return obj;
  };
  const signature = (x: number, y: number, size = 12, color = ink) => {
    if (brand.logo) { const logo = shape('image', x, y, size * 3, size * 3, 'none', 'Logo značky'); logo.src = brand.logo; }
    else text(brand.name.slice(0, 30), x, y, 330, size, color);
  };
  const page = (name: string, background = paper): StudioPage => ({ id: uid(), name, width: template.width, height: template.height, background, objects: objects.splice(0) });
  const pages: StudioPage[] = [];
  if (id === 'flyer') {
    rect(0, 0, 595.28, 40, ink); signature(42, 65, 14);
    text('Prostor pro\nnové nápady.', 42, 141, 510, 55);
    rect(42, 321, 511, 282, ink);
    ellipse(288, 344, 230, 230, accent); ellipse(77, 368, 168, 168, paper);
    rect(152, 452, 220, 31, ink);
    text('TVORBA · SETKÁVÁNÍ · INSPIRACE', 42, 634, 510, 12);
    text('Přijďte objevit, co vzniká, když se\npropojí dobré nápady a správní lidé.', 42, 674, 510, 21);
    rect(42, 768, 511, 1, ink); text('12. června 2027 / 17:00', 42, 786, 270, 12); text('studio.example', 400, 786, 150, 12);
  } else if (id === 'proposal') {
    signature(44, 40); text('NABÍDKA / 2027–01', 365, 43, 185, 11);
    rect(44, 108, 70, 7, accent); text('Pojďme vytvořit\nněco výjimečného.', 44, 142, 510, 40);
    text('Připraveno pro: Vaše společnost\nDatum: 12. června 2027', 44, 268, 480, 13);
    rect(44, 340, 507, 128, ink); text('Váš nápad. Naše zkušenosti.', 62, 360, 470, 23, paper);
    text('Navrhneme srozumitelné řešení, které odpovídá\nvašim cílům. Od prvního návrhu až po předání.', 62, 408, 465, 14, paper);
    const rows = [['01', 'Návrh a koncept', '8 000 Kč'], ['02', 'Realizace a úpravy', '12 000 Kč'], ['03', 'Předání a podpora', '4 000 Kč']];
    rows.forEach(([n, title, price], i) => { const y = 505 + i * 55; text(n, 44, y, 35, 12); text(title, 91, y, 305, 16); text(price, 439, y, 112, 14); rect(44, y + 35, 507, 0.7, ink); });
    text('Celkem', 44, 697, 200, 20); text('24 000 Kč', 405, 697, 150, 24);
    text('Ukázkové ceny · platnost nabídky 30 dní', 44, 746, 480, 11); text('Děkujeme za důvěru.  /  ahoj@studio.example', 44, 793, 500, 11);
  } else if (id === 'business-card') {
    rect(180, 0, 75.12, 141.73, ink); ellipse(192, 27, 50, 50, accent); ellipse(192, 67, 50, 50, paper);
    signature(16, 15, 7); text('Jana Nováková', 16, 53, 163, 16); text('Design & komunikace', 16, 78, 158, 8);
    text('jana@studio.example\n+420 123 456 789', 16, 107, 158, 8);
  } else if (id === 'presentation') {
    rect(622, 0, 338, 540, ink); ellipse(668, 74, 240, 240, accent); ellipse(668, 297, 190, 190, paper);
    signature(48, 39, 15); text('Myšlenky,\nkteré rostou.', 48, 166, 570, 64); text('Nová perspektiva pro váš další projekt', 48, 360, 570, 20); text('PREZENTACE / 2027', 48, 477, 500, 12);
    pages.push(page('01 — Úvod'));
    signature(48, 32, 13); text('Tři kroky k dobrému výsledku', 48, 100, 870, 38);
    ['Porozumět', 'Vytvořit', 'Posunout dál'].forEach((title, i) => {
      const x = 48 + i * 294; rect(x, 200, 274, 251, i === 1 ? ink : accent);
      const color = i === 1 ? paper : ink; text(`0${i + 1}`, x + 22, 219, 220, 48, color); text(title, x + 22, 308, 230, 24, color);
      text(['Známe vaše cíle.\nPtáme se a nasloucháme.', 'Hledáme správný směr.\nNápady měníme v realitu.', 'Ověřujeme výsledek.\nSpolečně rosteme.'][i], x + 22, 364, 240, 15, color);
    });
    text('02 / JAK PRACUJEME', 48, 492, 500, 11); pages.push(page('02 — Postup'));
    ellipse(660, 115, 240, 240, accent); text('Teď je řada\nna vašem nápadu.', 48, 113, 640, 53, paper); text('Pojďme se potkat.', 48, 333, 560, 25, paper); text('ahoj@studio.example', 48, 394, 550, 20, paper); signature(48, 480, 12, paper); pages.push(page('03 — Kontakt', ink));
  } else if (id === 'social') {
    signature(35, 29, 13); ellipse(312, 69, 250, 250, accent); ellipse(356, 111, 164, 164, ink);
    text('Dobré věci\nzačínají\nmalým krokem.', 35, 225, 535, 49);
    rect(35, 486, 530, 2, ink); text('Nová kolekce nápadů je tady.', 35, 515, 525, 19); text('OBJEVTE VÍCE →', 35, 555, 500, 12);
  } else {
    rect(0, 0, 841.89, 1190.55, ink); signature(58, 43, 18, paper); text('MĚSTO ŽIJE', 58, 127, 730, 83, paper);
    text('Potkáme se\nvenku.', 58, 260, 730, 99, accent); ellipse(320, 527, 438, 438, accent); ellipse(407, 614, 264, 264, ink);
    rect(58, 575, 190, 333, paper); text('12\n06', 81, 604, 160, 85); text('2027', 85, 839, 150, 30);
    text('HUDBA / JÍDLO / DOBRÁ SPOLEČNOST', 58, 1000, 730, 19, paper); text('Park u řeky · od 14:00 · vstup zdarma', 58, 1051, 730, 23, paper); text('Více na studio.example', 58, 1133, 720, 15, paper);
  }
  if (objects.length) pages.push(page(template.name));
  return { version: 1, name: template.name, pages };
}

export function mountTemplatePicker(container: HTMLElement, onSelect: (project: StudioProject) => void): () => void {
  const root = document.createElement('div'); root.className = 'studio-template-grid';
  const abort = new AbortController();
  for (const template of getTemplates()) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'studio-template-card';
    button.setAttribute('aria-label', t('Insert template {name}', { name: template.name }));
    const preview = document.createElement('div'); preview.className = `studio-template-preview studio-template-preview--${template.id}`;
    preview.setAttribute('aria-hidden', 'true');
    const project = createTemplate(template.id);
    const page = project.pages[0];
    // A lightweight SVG preview uses the exact authored objects, without canvas state.
    const ns = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${page.width} ${page.height}`); svg.style.background = page.background;
    page.objects.forEach(obj => {
      if (obj.kind === 'text') {
        const node = document.createElementNS(ns, 'text'); node.setAttribute('fill', obj.fill); node.setAttribute('font-family', 'Arial, sans-serif'); node.setAttribute('font-size', `${obj.fontSize}`);
        (obj.text || '').split('\n').forEach((line, i) => { const span = document.createElementNS(ns, 'tspan'); span.setAttribute('x', `${obj.x}`); span.setAttribute('y', `${obj.y + (obj.fontSize || 12) * (0.85 + i * 1.2)}`); span.textContent = line; node.append(span); }); svg.append(node);
      } else if (obj.kind === 'rect' || obj.kind === 'ellipse') {
        const node = document.createElementNS(ns, obj.kind); node.setAttribute('fill', obj.fill);
        const attrs = obj.kind === 'rect' ? { x: obj.x, y: obj.y, width: obj.width, height: obj.height } : { cx: obj.x + obj.width / 2, cy: obj.y + obj.height / 2, rx: obj.width / 2, ry: obj.height / 2 };
        Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value))); svg.append(node);
      }
    });
    preview.append(svg); const title = document.createElement('strong'); title.textContent = template.name;
    const description = document.createElement('span'); setUIText(description, () => t(template.description)); button.append(preview, title, description);
    button.addEventListener('click', () => onSelect(createTemplate(template.id, loadBrandKit())), { signal: abort.signal }); root.append(button);
  }
  container.append(root); return () => { abort.abort(); root.remove(); };
}
