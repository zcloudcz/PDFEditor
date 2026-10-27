# Online PDF Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. Způsob exekuce zatím nebyl vybrán; tento dokument autorizuje pouze plánování.

**Goal:** Vytvořit open-source online PDF editor s jednoduchostí PDFGuru, skutečnou editací podporovaných PDF a lokálním zpracováním.
**Architecture:** Připnutý fork BentoPDF; zachovat existující stack a funkční moduly. Vlastní sjednocené rozhraní, PDF operace v prohlížeči/workers, statická distribuce.
**Tech Stack:** TypeScript, Vite, Tailwind CSS, existující OSS PDF/WASM integrace BentoPDF, Tesseract, Vitest; Playwright pro chybějící integrační ověření.
**Spec:** ../specs/2026-10-25-online-pdf-editor-design.md
**Status:** Plán připraven k revizi, žádný úkol implementace není dokončen.
**Umístění aplikace:** Samostatný repozitář mimo GAMES; konkrétní název, adresář a doména se určí při založení. Cesty níže jsou relativní k budoucímu repozitáři.

## Global Constraints
- Výhradně open-source technologie; rozpočet na licence 0 Kč.
- Zachovat TypeScript/Vite/Tailwind; žádný přepis do jiného frameworku bez doloženého důvodu.
- Odvozený produkt AGPL-3.0 s odpovídajícími zdroji, licencemi a reprodukovatelným buildem.
- Dokumenty zpracovávat lokálně; jejich obsah a názvy nesmějí vstupovat do telemetrie.
- Nahrávání dokumentu na server není součástí první verze.
- Podporovat češtinu a angličtinu; desktop první, mobilní základní úpravy.
- 100 stran / 50 MB je cílová testovací třída, nikoli ověřená garance.
- Nejméně 40 legálně použitelných testovacích PDF.
- Původní soubor nikdy nepřepisovat; exportovat upravenou kopii.
- Nezaměňovat překrytí textu s odstraněním obsahu ani OCR s rekonstrukcí dokumentu.
- Nevydávat s nevyřešenou ztrátou práce nebo únikem redigovaného obsahu.

## Review Focus
1. Chybějící znaky v subset fontech: čeština zůstane čitelná, náhrada fontu bude oznámena (P01, P04).
2. Sdílené objekty, otočené stránky a netypický CropBox: změna zasáhne pouze zamýšlené místo (P01, P03, P04).
3. Velké skeny, nedostatek paměti a přerušení workeru: originál i poslední checkpoint zůstanou použitelné (P07, P08).
4. Formuláře, odkazy a certifikátové podpisy: export zachová podporované prvky nebo předem popíše dopad (P05, P06).
5. Redakce a historické revize PDF: cílová data se nevrátí extrakcí, přílohou ani lokálním obnovením (P06, P08).

## Mapování souborů a rozhraní
Výchozí repozitář dosud nebyl lokálně zkontrolován. Nevymýšlet názvy upstream modulů.
P00 musí zapsat skutečné moduly do docs/architecture/upstream-map.md a doplnit jejich cesty do P02–P08 před úpravami.
Nové testy a dokumenty mají plánované cesty níže. Pokud stejné ověření upstream už má, rozšířit je místo duplikace.
V první verzi nevytvářet nový obecný PDF adapter ani plugin framework; používat existující rozhraní.
Dlouhé operace používat přes stávající worker/job mechanismus; případnou chybějící funkci doplnit v jeho vlastníkovi.

## P00 — Reprodukovatelný základ a licence (1–2 dny)
**Závislosti:** žádné. Provést až při zahájení implementace.
**Files:** upstream package.json a lockfile; nové AGENTS.md, MEMORY.md, docs/architecture/upstream-map.md, docs/adr/0001-browser-first-bentopdf.md, docs/legal/components.csv.
**Interfaces:** Vstup: zvolený upstream commit. Výstup: připnutý fork, mapa vlastníků funkcí a ověřené build/test příkazy.
- [ ] Založit samostatný repozitář z konkrétního stabilního tagu/commitu, zaznamenat SHA a upstream remote.
- [ ] Přečíst jeho AGENTS.md, build instrukce a licence; inventarizovat JS, WASM, modely, fonty a jejich zdroje.
- [ ] Prověřit open-source oprávnění každé skutečně zapnuté funkce, včetně knihoven stahovaných za běhu; nejasnou komponentu vypnout.
- [ ] Spustit čistou instalaci z lockfile, existující build a testy; zaznamenat příkazy, výsledky a známé upstream chyby.
- [ ] Zapsat skutečné soubory pro viewer, text editor, stránky, export, formuláře, OCR, redakci, workers a lokální úložiště.
- [ ] Definovat stabilní příkazy npm run qa:unit, npm run qa:e2e, npm run qa:types a npm run build podle zjištěné struktury.
- [ ] ADR musí uvést: BentoPDF proti vlastnímu PDFium řešení a Stirling-PDF, důvody, licenci a podmínky změny směru.
- [ ] Commit po úspěšném baseline ověření; upstream chyby nesmějí být zaměněny za nově vzniklé.
**Hotovo:** build reprodukovatelný, licence doložené, přesné cesty a příkazy doplněné; jinak P01 nezačíná.

## P01 — Ověření PDF jádra (2–4 dny)
**Files:** tests/fixtures/pdf/manifest.json; tests/pdf-core/edit-roundtrip.spec.ts; tests/pdf-core/structure-roundtrip.spec.ts; docs/validation/engine-report.md.
**Interfaces:** Vstup: nativní API nalezená P00. Výstup: seznam podporovaných případů a rozhodnutí pokračovat/zastavit.
- [ ] Sestavit alespoň 40 PDF s původem, právem použití, SHA a očekávanými vlastnostmi v manifestu.
- [ ] Pokrýt digitální PDF, subset fonty, českou diakritiku, více sloupců, rotaci/CropBox, sdílené objekty, obrázky, skeny, AcroForms, odkazy, šifrování a podpisy.
- [ ] Ověřit změnu konkrétního textu, uložení a znovuotevření; původní znění nesmí zůstat jako skrytá kopie v upraveném místě.
- [ ] Ověřit přidání znaku „ř“ do fontu bez tohoto glyfu, delší náhradu a úpravu otočeného textu; požadovat správný výsledek nebo výslovné odmítnutí.
- [ ] Porovnat rendering a text nezávislým OSS čtečem, nikoli pouze enginem, který provedl export; mimo upravenou oblast kontrolovat vizuální regresi.
- [ ] Zapsat měření času a paměti pro digitální a obrazové dokumenty zvlášť.
- [ ] Závěr: pokračovat jen s doloženou editací textu a zachováním neovlivněného obsahu na podporovaných případech.
- [ ] Pokud neprojde zásadní případ, popsat konkrétní selhání a rozsah opravy; přehodnotit engine před stavbou UI.
**Ověření:** npm run qa:unit a příslušné integrační scénáře; report obsahuje očekávání, skutečnost a exportované důkazy.
**Hotovo:** žádný známý destruktivní export v deklarovaných podporovaných scénářích; omezení explicitně uvedena.

## P02 — Jednotné pracovní prostředí (3–5 dnů)
**Files:** skutečné UI moduly z P00; tests/e2e/editor-shell.spec.ts; docs/ux/editor-flow.md.
**Interfaces:** Vstup: ověřené operace z P01. Výstup: otevřený dokument a jednotný stav výběru/režimu pro další nástroje.
- [ ] Před změnou UI nakreslit jednoduchý wireframe: stránky vlevo, dokument uprostřed, vlastnosti výběru vpravo; mobilní panel jako vysouvací plocha.
- [ ] Zapsat vlastní vzhled a texty, inspirované jednoduchostí PDFGuru; zachovat jen nástroje relevantní k dokumentu.
- [ ] Ověřit neúspěšné otevření poškozeného PDF, zadání správného/chybného hesla a opakované otevření bez úniku předchozího stavu.
- [ ] Doplnit průběh načítání, zoom, hledání, výběr textu, miniatury a navigaci klávesnicí.
- [ ] Přepnutí mezi nástroji zachová dokument a rozpracované úpravy.
- [ ] Ověřit desktop 1366×768 a 1920×1080, mobilní 390×844 a 844×390 bez zakrytého exportu.
- [ ] Spustit npm run qa:e2e -- editor-shell a build; commit.
**Hotovo:** uživatel otevře a prohlíží dokument v jednom prostředí bez přeskakování mezi oddělenými nástroji.

## P03 — Stránky a historie úprav (3–5 dnů)
**Files:** moduly stránek/historie z P00; tests/e2e/pages.spec.ts; tests/pdf-core/page-identity.spec.ts.
**Interfaces:** Vstup: dokumentový stav P02. Výstup: stabilní identita stránek a existující historie použitelná dalšími úpravami.
- [ ] Připravit regresní scénář reorder → rotate → delete → undo → redo → export → reopen.
- [ ] Napojit vložení, extrakci, merge/split, pořadí a rotaci do jednoho editoru; používat existující operace.
- [ ] Vazby anotací a výběru držet na identitě stránky, nikoli na proměnlivém pořadovém indexu.
- [ ] Ověřit odkazy mezi stránkami, formulářová pole a duplicitní názvy polí při sloučení; nepodporovanou kombinaci předem odmítnout.
- [ ] Ověřit, že zpět/vpřed obnoví obsah i výběr a že nová změna po undo zruší větev redo.
- [ ] Spustit související unit/e2e scénáře a build; commit.
**Hotovo:** export odpovídá viditelnému pořadí a obnovitelné změny fungují bez ztráty objektů.

## P04 — Text, obrázky a anotace (5–8 dnů)
**Files:** moduly obsahu/anotací z P00; tests/e2e/content-edit.spec.ts; tests/pdf-core/font-export.spec.ts.
**Interfaces:** Vstup: dokument, historie a identita stránek P02/P03. Výstup: změny uložené standardním exportem.
- [ ] Napsat regresi pro změnu původního textu, nový text s diakritikou, přesun/změnu obrázku a anotaci.
- [ ] Zpřístupnit ověřené editace z P01; výběr objektu musí odpovídat zoomu, rotaci a CropBox.
- [ ] Doplnit vlastnosti fontu, velikosti a barvy; při náhradě chybějícího fontu oznámit konkrétní změnu.
- [ ] Při přetečení nabídnout změnu velikosti/bloku nebo zrušení; neodřezávat text potichu.
- [ ] Napojit přidání obrázku, zvýraznění, kreslení a obrazový/kreslený podpis.
- [ ] Ověřit undo/redo, nezávislou textovou extrakci a render exportu; nesmí nastat skrytá rasterizace.
- [ ] Spustit obsahové testy a build; commit.
**Hotovo:** základní obsahové úpravy jsou skutečné, opakovatelné a transparentní při omezeních.

## P05 — AcroForms (3–5 dnů)
**Files:** moduly formulářů z P00; tests/e2e/forms.spec.ts; tests/pdf-core/forms-roundtrip.spec.ts.
**Interfaces:** Vstup: dokument a historie. Výstup: editovatelné AcroForms v exportu, flatten pouze na výslovnou volbu.
- [ ] Ověřit text s diakritikou, checkbox, radio a dropdown v souboru s již existujícími poli.
- [ ] Napojit vyplňování a tvorbu běžných polí včetně názvu a hodnoty.
- [ ] Ověřit vložení pole na otočené stránce a jeho appearance po exportu v nezávislém čteči.
- [ ] XFA rozpoznat a oznámit nepodporovaný scénář; dokument neměnit při odmítnutí.
- [ ] Ověřit zachování hodnot při změně pořadí a exportu.
- [ ] Spustit formulářové testy a build; commit.
**Hotovo:** formuláře fungují i mimo náš editor.

## P06 — Redakce a bezpečný export (4–7 dnů)
**Files:** moduly redakce/exportu z P00; tests/pdf-core/redaction.spec.ts; tests/e2e/export-review.spec.ts; docs/security/redaction-model.md.
**Interfaces:** Vstup: upravený dokument. Výstup: nová exportovaná kopie s doloženým odstraněním vybraného obsahu.
- [ ] Připravit PDF s tajným řetězcem v běžném textu, OCR vrstvě, metadatech, komentáři, příloze a historické revizi.
- [ ] Oddělit vizuální překrytí a redakci v UI; redakci aplikovat do nové plně přepsané kopie.
- [ ] Ověřit odstranění vybraného textu/obrázku z cílové oblasti, textové extrakce a vykreslení.
- [ ] Před exportem nabídnout samostatné odstranění metadat, komentářů a příloh; plošná redakce oblasti nesmí tvrdit, že odstranila stejné údaje v celém souboru.
- [ ] Bezpečný export prověřit nezávislým parserem, včetně dekomprese objektů a historických revizí; nestačí hledání bajtového řetězce.
- [ ] U podepsaného PDF před změnou ukázat dopad na podpis, u hesel nezapisovat heslo do úložiště ani logů.
- [ ] Ověřit, že neúspěšný export nabídne opakování a nezničí rozpracovaný dokument.
- [ ] Spustit všechny exportní/redakční testy a build; commit.
**Hotovo:** důkazy pro redakci existují; při jediném známém úniku funkci nevydávat.

## P07 — OCR a náročné operace (3–5 dnů)
**Files:** OCR/worker moduly z P00; tests/e2e/ocr.spec.ts; tests/pdf-core/ocr-export.spec.ts; docs/validation/performance.md.
**Interfaces:** Vstup: vybrané stránky a jazyk ces/eng. Výstup: vyhledatelná PDF kopie; průběh a možnost zrušení.
- [ ] Připnout OCR modely a ověřit jejich licence a dostupnost.
- [ ] Použít existující rendering PDF stránek do obrázků pro OCR, zpracovávat postupně s omezeným počtem workerů.
- [ ] Změřit přesnost na čistém českém a anglickém skenu; zapsat chybovost a stanovit podporovaný profil.
- [ ] Ověřit zarovnání textové vrstvy, hledání diakritiky a zachování původního obrazu stránky.
- [ ] Rozpoznání a případnou následnou rekonstrukci textu prezentovat odděleně; neslibovat editovatelnost skenu jen díky OCR.
- [ ] Přerušit operaci, simulovat pád workeru a ověřit retry bez duplicitní OCR vrstvy.
- [ ] Změřit třídy 100 stran / 50 MB na referenčním desktopu; zapsat čas, paměť a nezamrzající UI, snížit deklarované limity podle výsledků.
- [ ] Spustit OCR scénáře a build; commit.
**Hotovo:** OCR funguje lokálně, je přerušitelné a jeho skutečné limity jsou popsány.

## P08 — Obnova práce a soukromí (2–4 dny)
**Files:** storage/history moduly z P00; tests/e2e/recovery.spec.ts; tests/e2e/network-privacy.spec.ts.
**Interfaces:** Vstup: checkpoint dokumentu a provedené úpravy. Výstup: nabídka obnovení nebo úplné smazání jeho lokálního stavu.
- [ ] Před lokálním ukládáním vyžádat srozumitelný souhlas a vysvětlit uložení na daném zařízení.
- [ ] Ukládat atomické checkpointy; poškozená nová revize nesmí přepsat poslední platnou.
- [ ] Ověřit refresh, pád tabu, chybějící kvótu IndexedDB a zakázané úložiště; editace bez obnovy zůstane možná.
- [ ] Při redakci odstranit/checkpointem nahradit staré lokální revize se skrytými údaji; před dokončením nabídnout výslovné vyčištění starých kopií.
- [ ] Ověřit vymazání dokumentu včetně IndexedDB, cache a aplikační historie; nevymazávat jiné dokumenty.
- [ ] Síťovým testem zablokovat a detekovat odeslání dokumentových bajtů, názvů a textu; zaznamenat všechny runtime domény knihoven.
- [ ] Spustit recovery/privacy scénáře a build; commit.
**Hotovo:** obnova neohrožuje redakci a lokální uložení je pod kontrolou uživatele.

## P09 — Přístupnost, vydání a předání (3–5 dnů)
**Files:** upstream i18n a hosting konfigurace; tests/e2e/release.spec.ts; docs/validation/release-report.md; docs/deployment.md; zdrojový archiv a licence.
**Interfaces:** Vstup: release candidate z P02–P08. Výstup: reprodukovatelný statický balíček a zveřejněný odpovídající zdroj.
- [ ] Dokončit CZ/EN texty, ovládání klávesnicí, fokus, čitelné chyby a názvy ikon.
- [ ] Zkontrolovat odkazy/akce v PDF, zakázat spuštění PDF JavaScriptu a nepoužívat nedůvěryhodný text jako HTML.
- [ ] Spustit npm run qa:types, npm run qa:unit, npm run qa:e2e a npm run build; zaznamenat skutečné výsledky.
- [ ] Ověřit Chromium, Firefox a WebKit; před veřejnou garancí Safari provést ruční test na skutečném Safari.
- [ ] Projít všech 40+ fixtures; známá omezení převést do uživatelské dokumentace.
- [ ] Ověřit build v čistém prostředí, dostupný zdrojový kód, licenční oznámení a build instrukce včetně WASM.
- [ ] Zvolit dostupný statický hosting podle velikosti modulů, hlaviček a skutečných podmínek tarifu; ověřit MIME application/wasm.
- [ ] Připravit staging, rollback na předchozí statický balíček a kontrolu po nasazení; veřejné nasazení provést až na pokyn uživatele.
- [ ] Commit/tag a release report s verzí, SHA, testy, omezeními a návodem.
**Hotovo:** vydatelná beta, všechny blokující chyby uzavřené a exporty ověřené nezávislým čtečem.

## Pořadí a odhad
P00 → P01 → P02 → P03 → P04 → P05 → P06 → P07 → P08 → P09.
První checkpoint po P01: potvrzení enginu nebo revize volby.
První uživatelská demonstrace po P04: upravit český text a obrázek, změnit stránky, uložit a znovu otevřít.
Funkční beta po P08, release candidate po P09.
Součet odhadů: 29–50 pracovních dnů, přibližně 6–10 týdnů jednoho zkušeného vývojáře.
Odhad je návrh, ne závazek; aktualizovat podle P01. Rozsah přesahující uvedené úkoly vyžaduje samostatné naplánování.

## Pravidla provedení
Každý úkol: nejdřív zachytit chybějící/rozbitý požadovaný scénář, provést nejmenší změnu,
ověřit regresi a zapsat commit. Existující funkci pouze ověřit a integrovat, nepřepisovat ji kvůli testu.
Po každé etapě aktualizovat vlastní MEMORY.md a stav checkboxů.
Výsledky testů nenahrazovat deklaracemi upstreamu.
P00/P01 jsou rozhodovací brána; zbytek plánu při změně enginu upravit před pokračováním.
