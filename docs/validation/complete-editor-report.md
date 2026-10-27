# Complete editor: integrační evidence

Datum: 26. 10. 2026. [Prováděcí plán](../superpowers/plans/2026-10-26-complete-editor-implementation.md). Lokální pracovní kopie na `feat/online-pdf-editor`, bez commitu, push, deploymentu nebo publikace. Stav popisuje doložený rozsah profilů; nepředstavuje dokončení celého plánu ani paritu s Acrobat/Canva.

## Aktuální ověřený bod

Kanonický dodávaný lokální stav prošel **2 017 testy ve 173 souborech**, TypeScript, curated `build:editor` i plným upstream `npm run build`. Zahrnuje přijatý konzervativní guard T13 pro projekty s datovými metadaty. Browser po posledním buildu znovu obnovil dokument s hodnotou Count 42; dřívější skutečné scénáře ověřily i porovnání T09 nad společným PDF/grafickým snapshotem. Přímé logy, skutečné výstupy a otevřené brány uvádí [validační řez T15 až T19](t15-t19-validation.md). Automatické testy nepokrývají lidskou kontrolu přístupnosti, kompletní interoperabilitu Office ani všechny cílové přístroje.

Editor používá jediný viewport s původním PDF a interaktivní grafickou vrstvou. Dokument, stránky, zoom, scroll, výběr, Save, Undo a Export mají společné integrační hranice. [Závazný návrh interakce](../superpowers/specs/2026-10-26-single-editor-surface-design.md) nadále platí. Přítomnost panelu nebo upstream modulu sama o sobě neuzavírá akceptaci úkolu.

## Rozsah a otevřené závislosti

| Úkol | Doložený stav a hranice |
| --- | --- |
| UX01 až UX03 | Inline text a společná kontextová lišta jsou integrované v jednom Editoru. Doložené scénáře zahrnují dvojklik, formátování a zachování výběru/obnovy. |
| UX04 | Dílčí skutečné browserové scénáře; celá keyboard, RTL, touch a asistivní matice zůstává otevřená. |
| T01 až T05 | Podporované stránkové operace, společné transakce/historie, dvojitá obnova, navigace, vlastnosti/přílohy a portable v2 jsou integrované. [Samostatná závěrečná evidence](t02-t05-completion.md) uvádí ověřené profily a odmítané struktury. Historie neobnovuje caret ani interní nativní command stack. |
| T06 | Standardní formuláře, komentáře/anotace, skutečný výběr znaků a konzervativní merge formulářů jsou integrované. Browser ověřil českou hodnotu pole a zvýraznění slova; celá akceptační matice zůstává otevřená. |
| T07 | Lokální OCR s připnutými ces/eng modely a textovou vrstvou je integrované. Syntetické benchmarky nejsou obecná garance přesnosti rekonstrukce dokumentů. |
| T08 až T09 | Číslování/Bates, watermark, optimalizace, explicitní raw-file oprava, omezené ZIP dávky, porovnání a kalibrované měření jsou integrované. Skutečný browser doložil opravu chybějícího EOF bez změny původního prefixu, ztrátovou optimalizaci se zachovaným vektorovým textem a Escape měření bez změny dokumentu. Porovnání společného snapshotu s jeho exportem našlo 0/1 změněných stránek; pozitivní kontrola novým grafickým obdélníkem našla 1/1. Širší korpus a výkonová matice zůstávají otevřené. |
| T10 až T11 | Sdílený layout a podporované textové efekty jsou integrované. Vybrané Devanagari případy mají nezávislou PDF.js/PDFium extrakci; označkovaná arabština zůstává blokovaná kvůli interoperabilitě. Skutečné vytvoření A4 a SVG export prošly po opravě nativního zaokrouhlení geometrie; celý jazykový korpus není uzavřený. |
| T12 | Obrazové efekty/masky/EXIF, osobní šablony a značky jsou integrované. [Asistované odstranění barevného pozadí](t12-cutout-evidence.md) má omezený deterministický profil; úplná browser/device a vizuální akceptace zůstává otevřená. |
| T13 | Kernel skutečného odstranění obsahu má automatické testy včetně nepoužitých resources a omezeného dekódování. Přijatý guard před jakýmkoli purge odmítá i projekt s neprázdnými dataTables/dataCharts a nulou grafických objektů, protože rekonstrukce fromPdf by metadata ztratila. Guard prošel regresí a nezávislým review; vlastní ruční browserová/bezpečnostní akceptace T13 a UI purge zůstávají samostatnou branou. |
| T14 | V aktuální navazující etapě vynecháno podle pokynu uživatele. |
| T15 | Integrovaný audit a úpravy existujících standardních tagů, pořadí, jazyka, alt textu, TH scope a popisků polí v konzervativním profilu. Skutečný export ověřen PDF.js. Nové tagování, externí PDF/UA validátor a lidské kontroly zůstávají otevřené. |
| T16 | Integrovaný omezený preflight a běžný PDF tiskový export s trim/bleed a vektorovými ořezovými značkami. Skutečný export zachoval text a požadované boxy. PDF/A, PDF/X, ICC, CMYK a separace nejsou tímto dodané. |
| T17 | Integrovaný omezený PDF export do DOCX/PPTX s reportem editovatelných/rastrovaných prvků a uživatelem zvolenou věrností, kontrolované tabulky do CSV/XLSX. Skutečný DOCX export i nezávislý DOCX/PPTX rendering jsou doložené. Office import a širší korpus čekají. |
| T18 | Integrované ploché OCG, portfolio s PDF Collection a pasivní inventář/extrakce podporovaných médií. Skutečný browserový retest potvrdil Collection, dva původní soubory beze změny bajtů a názvy/viditelnost dvou OCG. Komplexní konfigurace a mediální viewer/authoring čekají. |
| T19 | Integrovaná trvalá tabulková/grafová data, čtyři typy grafů jako editovatelné skupiny prvků, CSV a omezené přenosné ZIP dávky s náhledem/přetečením. Skutečný browser doložil shodu dat a grafiky po změně na 42, vektorový PDF export, Tab focus, CSV varianty v portable ZIP a obnovu v nové záložce se zachovanou hodnotou 42 a dvěma nabídkami grafů. Širší matice zůstává otevřená. |
| T20 až T27 | Navazující prezentace/board/exportní profily, timeline/Docs/Sheets/web a smíšené controllers/offline nejsou dokončené existencí současného exportu nebo v2 diskriminantu. Nejsou součástí právě ověřovaného řezu T15 až T19. |
| T28 až T29 | Volitelná spolupráce a lokální AI nejsou implementované. Žádný server, automatický upload nebo model inference se tímto neaktivuje. |
| T30 | Průběžná integrační a distribuční práce; každý další milník vyžaduje vlastní testy, browser, nezávislé výstupy a sources/notices. |

## Důkazy navazujícího browserového řezu

Syntetické podklady a výstupy jsou uložené v `.superpowers/sdd/2026-10-26-complete-editor-implementation/`:

- [T08 opravený raw soubor](../../.superpowers/sdd/2026-10-26-complete-editor-implementation/t08-repaired-browser.pdf): PDF.js načetl jednu stránku; původní prefix zůstal stejný a byl doplněn terminální EOF.
- [T08 ztrátový výstup](../../.superpowers/sdd/2026-10-26-complete-editor-implementation/t08-lossy-browser.pdf): 24 533 B proti 230 397 B vstupu, stále jedna stránka a extrahovatelný text `Vector text remains selectable`. [Náhled](../../.superpowers/sdd/2026-10-26-complete-editor-implementation/t08-lossy-browser.jpg).
- [T09 Escape](../../.superpowers/sdd/2026-10-26-complete-editor-implementation/t09-cancel-browser.jpg): po zrušení panel uvádí nezměněný dokument.
- [T11 SVG vytvořeného A4](../../.superpowers/sdd/2026-10-26-complete-editor-implementation/t11-created-design-browser.svg) a [nezávislý render](../../.superpowers/sdd/2026-10-26-complete-editor-implementation/t11-created-design-render.png): vektorový výstup včetně českých glyfových cest, bez rasterizace. [Browser](../../.superpowers/sdd/2026-10-26-complete-editor-implementation/t11-created-design-browser.jpg).

Podrobnou evidenci T15 až T19, podporované profily a dosud otevřené důkazy uvádí [samostatný report](t15-t19-validation.md).

## Otevřené brány

P00/P01 zůstávají otevřené: odpovídající nativní zdroje, reprodukovaný native rebuild a úplné distribuční notices nejsou uzavřené. Tato lokální integrace není oprávnění k publikaci. Překlady mají 49 katalogů po 927 klíčích; nových 152 zpráv představuje 7 448 překladů, s 60 úspěšnými testy lokalizace/zdrojů. Revize rodilými mluvčími nebyla provedena.

Lidské kontroly UI přístupnosti a čtení exportovaných PDF, označkovaná arabština, externí conformance validátory a širší Office/rendering korpus zůstávají otevřené. [Audit Office runtime](../legal/office-runtime-audit.md) odděluje externí QA renderer od připravenosti k dodání v browseru. Ořez není sanitizace, kreslený podpis není kryptografický podpis a grafický obdélník není redakce. Nepotvrzené psaní se nesmí prezentovat jako uložené; žádný export nesmí tiše rasterizovat nebo deklarovat nedoloženou shodu.
