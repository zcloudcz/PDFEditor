# Jeden editor: společná stránka a kontextový výběr

Datum: 2026-10-26. Přímá oprava závazného požadavku uživatele: jeden Editor, bez ručního přepínání „Upravit text PDF“ / „Grafické prvky“. Navazuje na schválený kompletní plán; nejde o změnu produktu vyžadující nové schválení.

## Rozhodnutí

Jeden dokument zůstává otevřený v původním chráněném PDF enginu a grafické objekty jsou průhledná interaktivní SVG vrstva nad stejným pageWrap. PDF viewport vlastní rozměry, zoom, scrollování i aktuální stránku. Knihovna, stránky, vlastnosti, Save/Undo/Export zůstávají v jednom pracovním prostoru. Původní PDF text dostává pointer událost přes průhledné prázdné místo SVG; grafický objekt událost zachytí a aktivuje své vlastnosti. Změna výběru nesmí exportovat/reopen dokument.

## Varianty a důvody

1. Přejmenovat či skrýt přepínač nad dvěma celými editory: odmítnuto, neřeší společnou stránku ani výběr.
2. Grafické plátno jako renderer s přenášenou nativní textovou editací: možné, ale přináší další správu geometrie a složité transformace.
3. Původní PDF viewport s interaktivní grafickou vrstvou: zvoleno, zachová již ověřenou editaci PDF a jediný zdroj geometrie. Původní grafické SVG a panely se znovu použijí.

## Data a ochrany

Původní PDF bytes jsou zdroj; grafické objekty zůstávají oddělené a editovatelné. Engine je nedostává zapečené do podkladu. Nová grafická stránka má nativní prázdný PDF podklad jen pro render/edit. Změna zdrojové struktury se připraví a validuje před atomickým commit koordinátoru. Podepsané/šifrované a nepodporované kombinace zachovají stávající guardy a hlášení.

Přenosný projekt v2 sdílí média dle hash; runtime adapter může nadále používat StudioProject v1. Asynchronní portable import/export je oddělen od interní synchronní serializace. V1 soubory a checkpointy jsou nadále čitelné. Neznámé druhy sekcí se odmítnou, dokud nemají skutečnou implementaci.

## Akceptace

- Jedna viditelná stránka, jeden scroll a zoom, bez dvou tlačítek přepínání backendů.
- Původní PDF text lze změnit, potom vybrat/vložit grafický text či tvar na stejnou stránku a dále opět upravovat původní PDF.
- Kontextová lišta sleduje výběr; formátování neztratí textovou selection. Dokončení rozepsané native editace při grafickém výběru nesmí ztratit text.
- Save/reopen, export, page operations, undo/redo a consent recovery zachovají obě vrstvy a stránku.
- Vše běží lokálně v existujícím TypeScript/Vite stacku a auditovaných závislostech; žádný nový framework či služba.

## Rizika

Reparenting native stage nesmí rozbít pointer souřadnice, ResizeObserver ani aktivaci souvislých stránek. SVG nesmí zachytit prázdné kliky určené PDF enginu. Async rebase nesmí přepsat novější změnu; pending edit se musí flushnout před změnou projektu. Každé riziko má regresní test a browser journey; vynucený interní native reload po strukturální změně se nepřevléká za bezchybnou kontinuitu command stacku.
