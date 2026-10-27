# T02–T05: integrační evidence a otevřené brány

Datum: 26. 10. 2026. Rozsah: lokální větev `feat/online-pdf-editor`, jediný společný editor. Tento záznam popisuje aktuálně doložené změny proti [plánu implementace](../superpowers/plans/2026-10-26-complete-editor-implementation.md) a [integračním pravidlům](../superpowers/plans/2026-10-26-parallel-development.md). **T02–T05 jako celé úkoly zatím nejsou uzavřené.** Počty cílených testů níže se mohou překrývat a nejsou součtem unikátních testů.

## Dodaný rozsah

| Úkol | Doložené chování a hranice |
| --- | --- |
| T02, stránky | Společný panel zpřístupňuje výběr aktuální stránky, všech stránek nebo rozsahu a přesun nahoru/dolů vedle rotace, ořezu, spojení, extrakce a rozdělení. Mutace vycházejí z aktuálního nativního snapshotu a procházejí checkpointem; odvozený export nemění otevřený projekt. Browser roundtrip všech kombinací, zejména merge/split, zůstává otevřený. |
| T03, transakce a historie | Koordinátor chrání před pozdním výsledkem, zrušením a neplatným checkpointem. Recovery zapisuje a načítá aktivní stránku a výběr po obnovení kanonického povrchu. Nová cache nativního snapshotu a kanonický rebase opravují reprodukovaný případ, kdy Save následované Undo po rotaci ponechalo obrácené stránky. Poslední oprava má cílené testy a TypeScript kontrolu, ale čeká na nezávislý re-review a opakování browser scénáře. |
| T04, struktury PDF | Strukturální navigace remapuje reference stránek přes stabilní identitu a obousměrnou mapu. Je zapojená do exportu a zachovává nativní katalog a prokládané designové stránky v podporovaných profilech. Panel záložek/odkazů, vlastnosti dokumentu včetně XMP a import/export/odebrání příloh jsou napojené do hlavního editoru. Strukturální operace se odemykají jen pro ověřené profily: formuláře, tagy, vrstvy a nepodporované přeuspořádání příloh zůstávají pod guardem. U příloh se podporují plochá jména; strom `Kids` se odmítá. |
| T05, projekt v2 | Produkční save/import/ZIP/recovery používá přenosný v2 projekt se zpětným čtením v1. Sdílená média se ověřují hashem a referenční historie sdílí assety mezi 80 stavy, místo aby ukládala 80 kopií base64; nepoužívané assety se uklízejí. Implementovaná je jedna designová sekce. Další typy sekcí se bezpečně odmítají a T23–T27 z toho nejsou dodané. |

## Ověření

| Vrstva | Evidence | Výsledek a limit |
| --- | --- | --- |
| Cílené testy | Integrátor: 33 testů exportu a identity ve 3 souborech. T02: 65 testů ve 4 souborech a 13 checkpoint testů. T04: 11 nových a 35 širších testů. T05: 40 testů v 6 souborech. Nezávislé review: 28 testů v 7 souborech a přijetí čtyř oprav. | Tyto běhy dokládají příslušné řezy, nikoli zelenou celou sadu nebo dokončení všech akceptačních scénářů. |
| Host a recovery | Nejnovější recovery běh: 27 testů ve 2 souborech. Po opravě nativního no-op Undo: 47 testů ve 3 souborech a `npx tsc --noEmit` prošly. | Poslední oprava čeká na nezávislý re-review a browser reprodukci rotace/Save/Undo a grafického objektu/autosave/Undo/Redo. |
| Skutečný browser projekt | V jednom editoru byl upraven nativní text `Jeden editor pro PDF i grafiku.`, grafický text `Grafika zůstává upravitelná.`, český název a autor dokumentu a rotace grafického textu o 90°. Stažený [v2 projekt](../../.superpowers/sdd/2026-10-26-complete-editor-implementation/t02-t05-browser.zpdf) nezávisle zkontroloval [inspekční skript](../../.superpowers/sdd/2026-10-26-complete-editor-implementation/inspect-browser-project.mjs): hashe všech assetů, dvě stránky, geometrii 842 × 595, nativní text, editovatelný grafický objekt a metadata. | Nová záložka zobrazila po recovery přesně aktivní stránku 2 a vybranou elipsu; tento stav zatím nebyl znovu uložen. UI importu přílohy otevřel skutečný výběr souboru. Tlačítko exportu bylo vyvoláno, ale cesta výstupního PDF nebyla získána, takže se zde netvrdí nezávislé ověření jeho bajtů. |
| Celá sada | [Log plného běhu](../../tests-t02-t05-full.log): 1666 úspěšných, 34 neúspěšných, celkem 1700 testů; 135 úspěšných a 3 neúspěšné soubory. | 31 selhání souvisí s rozpracovanými překlady, 1 s pozastaveným T11 layoutem a 2 s pozastavenou T13 bezpečnostní opravou. Jsou to produktová selhání v aktuálním stromu, nikoli environmentální výjimka. Překlady 49 katalogů jsou rozpracované. Nový kompletní zelený běh zatím není doložen. |

## Brány před uzavřením

1. Dokončit cílený nezávislý re-review nejnovější opravy nativního Undo a znovu provést uvedený browser scénář.
2. Uzavřít kombinovanou T02–T05 akceptační matici včetně merge/split browser roundtripu, podporovaných T04 struktur a nezávislého čtení skutečného PDF exportu, pokud se má tvrdit jeho byte-level výsledek.
3. Dokončit souběžné opravy lokalizace, T11 a T13, poté zopakovat plnou testovací sadu, TypeScript a build proti společnému stromu. Environmentální chybu Windows Vitest `EPERM` zaznamenat odděleně, pokud se znovu objeví.
4. Zachovat otevřené P00/P01: nativní rebuild a odpovídající zdroje/notices dosud neprošly distribuční bránou. Žádný release, push ani publikace z této evidence neplyne.

Výběr stránek, ořez ani grafický obdélník nejsou redakce; export nesmí tiše rasterizovat dokument. Podporované profily T04 a jediný implementovaný typ sekce T05 zůstávají explicitními omezeními, dokud další testy a review neprokážou širší rozsah.

## Uzavření podporovaného rozsahu T02–T05

T02–T05 jsou dokončené pro výše uvedené podporované profily jednoho PDF/design editoru. Pozdější obsahové editory T23–T27 a distribuční brány P00/P01 zůstávají oddělené.

- Finální společný cílený běh: **263 testů / 23 souborů PASS** (`tests-t02-t05-final.log`), následný TypeScript i `build:editor` prošly (`types-t02-t05-final.log`, `build-t02-t05-final.log`). Katalog i všech 49 jazyků má 670 shodných klíčů; 53 lokalizačních testů prošlo.
- Nový nezávislý re-review cache a kanonické nativní serializace: bez nálezů, **53 testů / 3 soubory PASS**. Browser na novém buildu potvrdil rotate → Save → jediný Undo vrací 842×595 na 595×842; ellipse → autosave → jediný Undo odstraní elipsu; Redo ji vrátí.
- Browser přesun stránky dolů zachoval stabilní identitu i grafické objekty a aktivní stránka se přesunula na správnou pozici 2/2. Sloučení s lokálním dvoustránkovým PDF zvýšilo počet na 4. Rozdělení všech stran vytvořilo skutečný ZIP, jehož všechny čtyři PDF nezávisle načetl PDF.js; rozměry, pořadí a nativní text zůstaly zachované (`t02-browser-split.zip`, `inspect-browser-split.mjs` v plan-specific workspace).
- Browser obnova v nové kartě zachovala stránku 2 a vybranou elipsu. Skutečný import/export přílohy prošel; SHA-256 exportované přílohy odpovídá originálnímu syntetickému souboru. Odebrání bylo vyvoláno ze stejného panelu.
- Browser evidence: `t02-t05-canonical-browser.jpg` a `t03-recovery-selection-browser.jpg` v plan-specific workspace. Původní stažený v2 projekt a nezávislé ověření jeho assetů, textu, geometrie i metadat zůstávají výše.

Starší tabulky zachycují průběžné otevřené brány, tento závěrečný záznam je nahrazuje tam, kde je uvedený nový důkaz. Celá sada se netvrdí zelená: předchozí plný běh měl navíc nehotové testy T11/T13 a rozpracované překlady; ty se řeší v uživatelem nově autorizované etapě T06–T13. Nepodporované rodiny PDF struktur se nadále bezpečně odmítají.
