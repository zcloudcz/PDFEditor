# Lokalizace editoru

Rozhraní obsahuje 606 zpráv v každém ze 49 jazykových katalogů. Portfolio je explicitně definované v `src/editor/i18n/locales.ts`; nepředstavuje pokrytí všech evropských menšinových jazyků.

| Kód | Jazyk | Kód | Jazyk |
| --- | --- | --- | --- |
| en | angličtina | cs | čeština |
| sk | slovenština | de | němčina |
| fr | francouzština | es | španělština |
| it | italština | pt | portugalština |
| pl | polština | nl | nizozemština |
| da | dánština | sv | švédština |
| nb | norština bokmål | fi | finština |
| is | islandština | et | estonština |
| lv | lotyština | lt | litevština |
| hu | maďarština | ro | rumunština |
| bg | bulharština | el | řečtina |
| hr | chorvatština | sl | slovinština |
| sr | srbština | bs | bosenština |
| mk | makedonština | sq | albánština |
| uk | ukrajinština | ru | ruština |
| be | běloruština | ga | irština |
| mt | maltština | ca | katalánština |
| eu | baskičtina | gl | galicijština |
| cy | velština | lb | lucemburština |
| tr | turečtina | ar | arabština |
| ur | urdština | hi | hindština |
| bn | bengálština | zh | zjednodušená čínština |
| zh-TW | tradiční čínština | ja | japonština |
| ko | korejština | id | indonéština |
| vi | vietnamština | | |

Při prvním otevření se jazyk vybere podle jazyků prohlížeče; při nenalezené shodě se použije angličtina. Ruční volba v hlavičce se zapamatuje v místním úložišti a má při dalším otevření přednost. Katalog zvoleného jazyka se načítá až podle potřeby a ukládá do paměťové cache. Anglický katalog slouží jako záloha pro chybějící zprávy. Za běhu se nepoužívá externí překladová služba.

Arabština a urdština přepínají směr rozhraní na RTL. Dokumentové plátno zůstává LTR; souřadnice, pořadí stránek a obsah PDF se přepnutím jazyka nemění. Překlad se týká označených ovládacích prvků a systémových zpráv, nikoli uživatelského textu, názvů projektů, textu v PDF či šablonových objektů. Ikony doplňují textové popisky a přístupné názvy.

Výchozí vložený text může používat latinkové „Your text“, protože dodávané písmo nepokrývá CJK. Lokalizované rozhraní samo o sobě nezaručuje vykreslení všech písem v dokumentu ani jazykovou podporu kontroly pravopisu.

Překlady byly vytvořeny s pomocí AI a částečně převzaty z odpovídajících upstream zpráv. Neproběhla kontrola rodilými mluvčími. Úplnost katalogu není potvrzením jazykové kvality; odborné výrazy a delší bezpečnostní upozornění potřebují jazykovou revizi.

Cílená kontrola 2026-10-26 po doplnění formulářů, anotací a OCR: 53 testů ve dvou souborech (`editor-locales.test.ts` a `editor-localization-sources.test.ts`) prošlo. Každý katalog získal 60 nových zpráv pro panely a jednu zprávu nativního editoru o neúspěšné úpravě. Předchozí překlady zůstaly zachovány. Kontrola zdrojů zahrnuje popisky pomocných funkcí panelů, podmíněné názvy akcí, názvy typů anotací a jazyky OCR. Regresní příklad ověřuje, že hodnoty polí, uživatelské možnosti, komentáře a rozpoznaný text nejsou katalogové klíče. První pokus zablokoval Windows sandbox chybou EPERM při přejmenování dočasného souboru; opakování mimo sandbox prošlo. Kompletní integrační testy, sestavení a prohlížečová kontrola jsou samostatným navazujícím krokem.

Jazyky rozhraní jsou nezávislé na jazycích rozpoznávání OCR. Aktuální panel nabízí lokální modely češtiny a angličtiny; 49 přeložených rozhraní neznamená OCR pro 49 jazyků. Názvy polí a jejich možnosti, obsah komentářů a výsledný rozpoznaný text pocházejí z dokumentu a při změně jazyka se nepřekládají. Nové překlady byly vytvořeny AI bez revize rodilými mluvčími.

Navazující vlna T08/T09 přidala dalších 98 zpráv pro výběr textu, číslování, vodoznaky, optimalizaci, dávkové zpracování, porovnání a kalibrované měření. Kontrola aktuálních zdrojů zachytila také šest nových zpráv grafického editoru o směru a jazyku textu a omezení věrného exportu; i ty jsou přeloženy ve všech katalozích. Parametry `{page}`, `{pages}` a `{bates}` zůstávají zachovány. Porovnávané texty a jednotky zadané uživatelem se nepřekládají. Testy katalogů a zdrojů po této vlně znovu prošly (53/53 ve dvou souborech mimo sandbox po známé chybě EPERM). Úplné integrační testy a sestavení provádí koordinátor samostatně.
