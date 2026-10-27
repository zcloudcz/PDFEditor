# Online PDF Editor — návrh pro implementační plán
Datum: 2026-10-25

## Zadání a rozhodnutí
Uživatel požaduje plnohodnotný online PDF editor, výhradně open-source technologie a rozpočet 0.
Po researchi přijal směr: BentoPDF jako výchozí základ, PDFGuru jako produktová inspirace.
Požadavek této fáze: vytvořit plán; implementace, založení repozitáře a publikování nejsou zahájeny.

## Cíl první verze
Samostatný webový editor s přímou úpravou původního textu v podporovaných PDF,
úpravou obrázků, anotacemi, organizací stránek, AcroForms a českým/anglickým OCR.
Otevření souboru → práce v jednom editoru → kontrola → stažení upravené kopie.
Vlastní vizuální identita; PDFGuru slouží jako reference jednoduchosti, jeho grafika ani kód se nekopírují.

## Navržené technické řešení
Fork připnuté verze BentoPDF, zachovat TypeScript/Vite/Tailwind a využít existující nástroje.
Nenasazovat jiný framework ani nepřepisovat funkční části bez konkrétního důvodu.
Zpracování dokumentů v prohlížeči, náročné operace ve workers, statický hosting.
Žádné dokumenty, jejich text ani názvy v telemetrii. Žádný upload bez výslovné uživatelské akce.
Knihovny, WASM a modely mají pevné verze; před vydáním musí existovat seznam licencí a zdrojů.
AGPL-3.0 odvozený produkt s odpovídajícím zdrojovým kódem a build instrukcemi.
Případnou komponentu s nekompatibilní nebo nejasnou licencí nahradit nebo její funkci vypnout.

## První verze — rozsah
- Prohlížení, hledání, výběr textu, zoom, miniatury a tisk.
- Přímé úpravy podporovaného původního textu; přidání a úpravy textu a obrázků.
- Anotace, zvýraznění, kreslení a vložení kresleného/obrazového podpisu.
- Změna pořadí, otočení, odstranění, vložení, extrakce, sloučení a dělení stránek.
- Vyplnění a tvorba běžných AcroForms; OCR češtiny a angličtiny.
- Redakce obsahu se samostatnou kontrolou exportu; kontrola metadat a příloh.
- Undo/redo uživatelských úprav; před nevratnou operací checkpoint.
- Obnova rozpracované práce se souhlasem uživatele a úplné lokální vymazání.
- Uživatelské rozhraní čeština a angličtina; desktop první, mobilní základní úpravy.
- Export musí zachovat text, formuláře a odkazy tam, kde je operace nemění.

## Hranice a transparentnost
Plnohodnotný znamená uvedené pracovní postupy, nikoli zaručenou editaci libovolného PDF.
Nepodporovaný font, typ dokumentu nebo úpravu editor výslovně oznámí; žádné skryté rasterizace.
OCR vyhledatelného skenu není automaticky věrně editovatelný dokument.
Podpis vložený jako obrázek není kvalifikovaný elektronický podpis.
Změna podepsaného souboru může narušit podpis; před úpravami zobrazit konkrétní dopad.
XFA, přelévání odstavců přes stránky, PDF/UA certifikace, věrné PDF↔Office převody,
kvalifikované podpisy, AI, účty a živá spolupráce nejsou součástí první verze.
K těmto oblastem se vrátit až podle požadavků a dostupné kapacity.

## Navržené cíle k měření
Referenční desktop: 4 jádra, 8 GB RAM; zaznamenat přesný hardware a verze prohlížečů.
100 stran / 50 MB je cílová testovací třída, nikoli ověřená garance.
Oddělit digitální dokumenty od obrazových; limit a výkon měřit pro každou třídu zvlášť.
Nejméně 40 legálně použitelných testovacích PDF, včetně češtiny, skenů a formulářů.
Před vydáním nulové nevyřešené chyby způsobující ztrátu práce nebo únik redigovaného obsahu.
Žádné cíle počtu uživatelů ani SLA nejsou zadány; backendovou kapacitu nenavrhovat.
Při lokálním zpracování N současných editorů znamená N klientských výpočtů a 0 serverových PDF úloh.
Licence 0 Kč; hosting 0 Kč jen v mezích existujícího hostingu nebo bezplatného tarifu.
Vývoj, údržba, případná doména a distribuce velkých WASM/modelů nejsou automaticky zdarma.

## Research — podklady, ověřeno webově 2026-10-25
- https://github.com/alam00000/bentopdf
- https://github.com/alam00000/bentopdf/blob/main/LICENSE
- https://www.bentopdf.com/docs/licensing
- https://pdfguru.com/
- https://github.com/embedpdf/embed-pdf-viewer/tree/v2
- https://github.com/Hopding/pdf-lib#limitations
- https://github.com/Stirling-Tools/Stirling-PDF/blob/main/LICENSE
- https://github.com/naptha/tesseract.js/blob/master/docs/faq.md

Deklarace dodavatelů jsou vstupem do plánu, ne důkazem praktické funkčnosti.
