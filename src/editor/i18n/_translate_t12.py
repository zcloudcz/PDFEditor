import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent
KEYS = {
    'Role značky': 'Brand roles',
    'Přiřadit barvu: {role}': 'Assign color: {role}',
    'Hlavní': 'Primary',
    'Doplňková': 'Accent',
    'Podklad': 'Background',
    'Zrušit role značky': 'Clear brand roles',
    'Přiřadit textový styl: {role}': 'Assign text style: {role}',
    'Nadpis': 'Heading',
    'Běžný text': 'Body text',
    'Roztáhnout': 'Stretch',
    'Přizpůsobit obrázek': 'Fit image',
    'Vyplnit rámeček': 'Fill frame',
    'Kruhová maska': 'Circular mask',
    'Zaoblená maska': 'Rounded mask',
    'Bez masky': 'No mask',
    'Poloměr zaoblení (%)': 'Corner radius (%)',
    'Jas': 'Brightness',
    'Kontrast': 'Contrast',
    'Sytost': 'Saturation',
    'Rozmazání (px)': 'Blur (px)',
    'Nahradit obrázek': 'Replace image',
    'Obnovit úpravy obrázku': 'Reset image edits',
    'Moje šablony': 'My templates',
    'Uložit výběr jako šablonu': 'Save selection as template',
    'Název šablony:': 'Template name:',
    'Původ šablony:': 'Template source:',
    'Licence nebo oprávnění k použití šablony:': 'Template license or permission:',
    'Štítky oddělené čárkou:': 'Comma-separated tags:',
    'Šablonu nelze uložit. Vyberte návrhovou stránku bez původního PDF a u obrázků vyplňte původ.': 'Cannot save template. Select a design page without an original PDF and provide the source for images.',
    'Hledat šablony': 'Search templates',
    'Jen oblíbené': 'Favorites only',
    'Oblíbené': 'Favorite',
    'Smazat šablonu': 'Delete template',
    'Knihovna šablon není dostupná.': 'Template library is unavailable.',
    'Moje značky': 'My brands',
    'Uložit novou značku': 'Save new brand',
    'Název značky:': 'Brand name:',
    'Značku nelze uložit.': 'Cannot save brand.',
    'Použít značku na přiřazené role': 'Apply brand to assigned roles',
    'Upravit značku': 'Edit brand',
    'Hlavní barva (#RRGGBB):': 'Primary color (#RRGGBB):',
    'Doplňková barva (#RRGGBB):': 'Accent color (#RRGGBB):',
    'Barva podkladu (#RRGGBB):': 'Background color (#RRGGBB):',
    'Velikost nadpisu (pt):': 'Heading size (pt):',
    'Velikost běžného textu (pt):': 'Body text size (pt):',
    'Smazat značku': 'Delete brand',
    'Knihovna značek není dostupná.': 'Brand library is unavailable.',
    'Exportovat značky': 'Export brands',
    'Značky nelze exportovat.': 'Cannot export brands.',
    'Importovat značky': 'Import brands',
    'Značky nelze importovat.': 'Cannot import brands.',
    'Tento řez písma není podporován.': 'This font style is not supported.',
}

catalog_path = ROOT / 'catalog.ts'
catalog = catalog_path.read_text(encoding='utf-8')
old_keys = set(re.findall(r'^  "(.*)",$', catalog, re.M))
assert not old_keys.intersection(KEYS), old_keys.intersection(KEYS)
catalog = catalog.replace('export const sourceMessages = [\n', 'export const sourceMessages = [\n' + ''.join(f'  {json.dumps(k, ensure_ascii=False)},\n' for k in KEYS), 1)
catalog_path.write_text(catalog, encoding='utf-8')

def translate_batch(texts, language):
    # A numbered line per string lets the free endpoint translate in one request.
    # The sentinel keeps authored placeholders untouched.
    protected = [s.replace('{role}', 'PDFROLEPLACEHOLDER').replace('#RRGGBB', 'PDFHEXPLACEHOLDER') for s in texts]
    query = '\n'.join(f'{i + 1}. {s}' for i, s in enumerate(protected))
    url = 'https://translate.googleapis.com/translate_a/single?' + urllib.parse.urlencode({
        'client': 'gtx', 'sl': 'en', 'tl': language, 'dt': 't', 'q': query,
    })
    for attempt in range(5):
        try:
            payload = json.loads(urllib.request.urlopen(url, timeout=35).read().decode('utf-8'))
            translated = ''.join(part[0] for part in payload[0]).splitlines()
            if len(translated) != len(texts):
                raise ValueError(f'{language}: expected {len(texts)} lines, received {len(translated)}')
            result = []
            for index, line in enumerate(translated):
                line = re.sub(r'^\s*\d+\s*[.、．)]\s*', '', line).strip()
                line = line.replace('PDFROLEPLACEHOLDER', '{role}').replace('PDFHEXPLACEHOLDER', '#RRGGBB')
                # Reject formatting drift rather than inserting broken placeholders.
                if not line or sorted(re.findall(r'\{\w+\}', line)) != sorted(re.findall(r'\{\w+\}', texts[index])):
                    raise ValueError(f'{language}: invalid line {index + 1}: {line!r}')
                result.append(line)
            return result
        except Exception:
            if attempt == 4:
                raise
            time.sleep(2 ** attempt)

for path in sorted((ROOT / 'translations').glob('*.json')):
    language = path.stem
    data = json.loads(path.read_text(encoding='utf-8'))
    if language == 'cs':
        updates = dict(zip(KEYS, KEYS))
    elif language == 'en':
        updates = KEYS
    else:
        source = list(KEYS.values())
        updates = dict(zip(KEYS, translate_batch(source, language)))
    assert not data.keys() & updates.keys(), language
    data.update(updates)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(language, len(data), flush=True)
