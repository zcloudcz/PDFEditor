# Ovládání editoru: text na plátně a kontextová lišta

Datum: 26. 10. 2026. Požadavek uživatele: dvojklik má umožnit upravovat text přímo v dokumentu; základní formátování má být nahoře. Výstup je UX research a implementační specifikace, nikoli tvrzení o již dodaném chování. Zdroje jsou oficiální dokumentace, nikoli provedený uživatelský test konkurentů.

## Zjištění z konkurence

| Zdroj | Doložené chování | Důsledek pro náš návrh |
| --- | --- | --- |
| [Canva: editace textu](https://www.canva.com/help/add-and-edit-text/) | Dvojklik otevře úpravu textového rámečku; kliknutí mimo ji ukončí. | Editace musí probíhat v místě textu, bez povinného přechodu do formuláře stranou. |
| [Canva: formátování](https://www.canva.com/en_au/help/format-text/) | Lišta nabízí velikost, barvu, zvýraznění a zarovnání; část ovládání je kontextová/plovoucí. | Základní formátování bude v našem případě ve stabilní horní kontextové řadě podle výslovného požadavku uživatele. |
| [Canva: ukotvení textu](https://www.canva.com/en_au/help/anchor-text-canva/) | Rozlišuje polohu obsahu a způsob růstu rámečku; ukotvení je v pokročilém nastavení. | Rozlišovat svislé zarovnání uvnitř pevného boxu od ukotvení automaticky rostoucího boxu. |
| [Figma: text](https://help.figma.com/hc/en-us/articles/360039956434-Guide-to-text-in-Figma-Design) | Dvojklik nebo Enter otevře editaci; typografické vlastnosti používají pravý panel. | Enter poskytne klávesnicovou alternativu. Pravý panel není univerzální konvence; horní lišta je naše produktová volba. |
| [Acrobat: formátování](https://helpx.adobe.com/acrobat/desktop/edit-documents/edit-text-in-pdfs/format-text.html) | Editace přes výběr textu, formátovací panel a dokončení kliknutím mimo. | U původního PDF musí základní interakce působit stejně, byť editaci provádí jiný engine. |
| [WAI-ARIA toolbar](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/) | Skupina ovládacích prvků má přístupný název a řízenou klávesnicovou navigaci. | Lišta musí být použitelná bez myši; šipky v číselných/textových polích nesmí převzít navigace lišty. |

## Audit současné implementace

- `studio/canvas.ts:508–516`: dvojklik vybere objekt a zaměří textarea v pravém panelu. Grafický text nemá inline editor. Handler kláves na řádcích 954–1000 nemá Enter pro vstup do textu.
- `canvas.ts:920–945`: horní grafická lišta obsahuje historii a zoom; formátování textu je v pravém panelu na řádcích 633–686. Normal/Bold/Italic je jediný dropdown, tedy bez nezávislé kombinace B+I.
- `studio/types.ts:19–21`: model nemá textové úseky ani verticalAlign. Canvas, SVG/PDF a PPTX používají manuální nové řádky a omezenou sazbu; přesunutí tlačítek samo nestačí.
- `canvas.ts:728–736` a `model.ts:alignElements`: současné top/middle/bottom zarovnává objekty, nikoli obsah textu uvnitř boxu.
- `src/js/editcore/app.js:7387–7439`: nativní PDF text vstupuje do editace již při stisku myši. `openEditor` vytváří contenteditable overlay, jeho dvojklik vybírá slovo. Ochrana výběru při formátování již existuje kolem řádku 9489; navázat na ni, nepřepsat bez regresních testů.
- `editor-markup.html:482` a navazující sekce: nativní B/I/align jsou v pravém inspektoru. Test v `studio-model.test.ts:245–267` ověřuje sidebar textarea a undo, nikoli inline editaci.

Řádky jsou orientační ke dni auditu. Jde o čtení kódu, nikoli nový browserový reprodukční test. Uživatelský popis tedy odpovídá implementaci grafické vrstvy; neplatí, že inline editace chybí i v celém nativním PDF enginu.

## Cílové chování — rozhodnutí pro implementaci

| Akce | Výsledek |
| --- | --- |
| Jednoklik na textový objekt | Výběr objektu, rámeček a kontextové vlastnosti. Kliknutí samo text nezmění. |
| Dvojklik na text / Enter nad vybraným textovým objektem | Inline editace se skutečným kurzorem a možností označovat znaky/slova. Při vstupu přes Enter lze označit celý obsah; při dvojkliku umístit výběr podle zásahu. |
| Dvojklik během editace | Standardní výběr slova; nepřepínat znovu editor ani neresetovat rozpracovanou větu. |
| Tažení uvnitř editovaného textu | Výběr znaků. Přesun objektu patří na okraj/úchyt; nevzniká při označování věty. |
| B/I/U, barva či font v liště | Použít na textový výběr, nebo na celý vybraný box v objektovém režimu. Zachovat výběr i při přesunu focusu do lišty. |
| Enter při editaci | Nový řádek; nesmí nečekaně zavřít editaci. |
| Escape | Ukončit editaci a ponechat změny, návrat do výběru objektu. Pro vrácení změn použít Zpět. Tento kontrakt sjednotit pro obě vrstvy. |
| Kliknutí mimo | Potvrdit změny a vybrat zasažený objekt nebo odznačit. Chyba uložení nesmí zavřít editor se ztrátou textu. |
| Delete/Backspace | V textu maže znaky; v objektovém režimu objekt. Žádný dokumentový hotkey nesmí přepsat chování editovatelného pole. |
| Ctrl/Cmd+A, C, V, Z | V editaci působí na text; mimo editaci na výběr objektů/historii. Nepoužívat dva nezávislé undo zásobníky pro tutéž změnu. |
| Zamčený objekt / sken | Nepředstírat editovatelnost. Nabídnout odemknutí, případně OCR pro rastrový text, s vysvětlením. |

Skupiny: první klik vybere skupinu, opakovaný cílený vstup vybere vnitřní objekt; dvojklik na text uvnitř skupiny nesmí skupinu rozpojit. Vícenásobný výběr zobrazuje smíšené hodnoty, nikoli domyšlený společný font. Formátování více boxů je samostatná operace, nevytváří společný textový výběr.

## Rozložení ovládání

1. **Globální horní řada:** soubor/projekt, Zpět/Znovu, ukládání/export, jazyk. Zachovat prostor pro dokument; nemíchat sem všechny vlastnosti objektů.
2. **Kontextová horní řada pro text:** font, řez, velikost, B/I/U, barva, horizontální zarovnání, svislé zarovnání, řádkování a nabídka dalších vlastností. Tlačítka mají tooltip, stav stisknutí a klávesnicový název. Font musí skutečně poskytovat požadovaný řez, včetně kombinace bold italic.
3. **Levá část:** přidávání obsahu, stránky, šablony, vrstvy. **Pravý panel:** pokročilé vlastnosti, přesné souřadnice, efekty a vlastnosti PDF. Základní úkony nevyžadují otevření pravého panelu.
4. **Kontext obrázku:** ořez, nahradit, otočení, průhlednost. **Kontext více objektů:** zarovnat objekty, rozestupy, seskupit, zamknout. **Prázdná stránka:** rozměry a pozadí. Výška kontextové řady se při přepínání nemění.

```text
Soubor   Zpět Znovu                    Projekt / stav uložení     Export
Font ▾   Řez ▾   24 ▾   B I U   Barva   Align ▾   V-align ▾   Mezery ▾   …
Stránky / prvky       |               dokument               | Pokročilé
```

Svislé zarovnání znamená **nahoře / uprostřed / dole uvnitř textového boxu**. Nesmí se zaměnit s posunem celého boxu doprostřed stránky. Pro automatickou výšku je neúčinné: vysvětlit vztah k pevné výšce nebo nabídnout její nastavení. U původního PDF bez stabilního rámce nabídnout pouze skutečně podporované vlastnosti.

Na úzké šířce přesunout méně časté vlastnosti do „Další“; zachovat dostupnost B/I a zarovnání bez vodorovného odříznutí. Na dotykovém zařízení nabídnout explicitní akci Upravit text a otevřít klávesnici; neopírat se pouze o dvojklik. Chování návrhu je třeba ověřit při 200% zoomu a v RTL rozhraní; směr dokumentu se neodvozuje ze zvoleného jazyka UI.

## Implementační řezy a akceptace

### UX01 — společný výběr a inline editace (nejbližší priorita)

Soubory: `src/editor/studio/canvas.ts`, nový `src/editor/studio/inline-text-editor.ts` a testy; propojení s `host.ts` a stávajícími native editcore událostmi. Rozlišit stavy `idle`, `objectSelected`, `textEditing` a `transforming`; nezařazovat je jako paralelní booleany s neplatnými kombinacemi. Aktivní editor drží draft a selection; model dostává validní transakce.

- [ ] Dvojklik a Enter otevřou text přímo na plátně; editace pod zoomem, scrollováním a rotací drží pozici i velikost.
- [ ] Výběr znaků nekoliduje s drag/resize a zkratkami objektů. IME/composition se dokončí před commit; žádný input render nesmí zničit caret nebo probíhající složený znak.
- [ ] Testy: nový text, existující text, více řádků, česká diakritika, IME, zamčený text, skupina, kliknutí mimo a chyba commit. Undo vrátí text, nikoli jiný objekt.

### UX02 — kontextová horní lišta

Soubory: nový `src/editor/context-toolbar.ts`, `context-toolbar.css`, testy; adaptéry pro `studio/canvas.ts` a nativní editcore; `shell.css`, `toolbar-icons.ts` a katalogy. Jediný kontrakt selection/capabilities/execute příkazu, žádné paralelní kopie formátovacího stavu.

- [ ] Základní vlastnosti přesunout nahoru a synchronizovat s aktuálním výběrem. Nepodporované volby mají vysvětlení; neaktivní tlačítko nesmí předstírat změnu dokumentu.
- [ ] Výběr slova → klik B → stejné slovo zůstává označené a změní se jen ono. Focus do font-size pole nesmí ztratit rozsah; návrat obnoví caret. Klávesnicové použití lišty funguje stejně jako myš.
- [ ] Testy stisknutých/smíšených stavů, Ctrl/Cmd+B/I/U, undo/redo, přepínání PDF/grafiky, změna jazyka během editace, úzký viewport a RTL.

### UX03 — sazba, svislé zarovnání a export

Navazuje na T10/T11 hlavního plánu: textové styly v úsecích, zalamování, řádkování, skutečné fonty. Přidat `verticalAlign` s výchozím `top` a explicitní režim velikosti boxu do validovaného modelu; migrovat staré projekty bez změny vzhledu. Layout sdílet mezi canvasem a exporty.

- [ ] Nahoře/střed/dole ovlivní pozici obsahu, nikoli objektu; přetečení nesmí tiše skrýt text. Náhled, znovuotevřený projekt, PDF a podporovaný PPTX mají stejnou polohu a styl.
- [ ] Ověřit kombinaci B+I, textové úseky, české znaky, RTL a nepodporované glyfy. Samotný HTML bold nebo CSS vertical-align není dokončená funkce.

### UX04 — úkolový usability test

Na syntetickém dokumentu: bez instrukcí najít text, přepsat větu, označit jedno slovo, změnit B/I, vystředit odstavec a svisle usadit text v boxu, vrátit změnu, exportovat a znovu otevřít. Zaznamenat úspěch, chyby, ztrátu výběru a nutnost nápovědy. Zatím žádné výsledky tohoto testu neexistují; odborná analýza není uživatelská validace.

## Priorita

UX01 a UX02 jsou podmínkou použitelné textové editace a mají přednost před dalšími grafickými efekty a novými obsahovými editory. T03 společné transakce a T10/T11 sazba pokračují jako technické závislosti; běžné PDF funkce tím nevypadávají z plánu. Nepřidávat nové nekonzistentní panely, dokud není sjednocen tento základní interakční kontrakt.
