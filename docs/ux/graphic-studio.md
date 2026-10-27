# Grafické studio

V jedné aplikaci upravujete jeden dokument: původní text PDF i vlastní nadpisy, tvary a obrázky. Společná lišta dokumentu nabízí šablony, značku, uložení projektu a export. Přepínání mezi textovými a grafickými nástroji zachovává editovatelné grafické prvky. Dokument i obnova práce zůstávají v prohlížeči.

## Začátek práce

Na úvodní obrazovce zvolte **Nový grafický dokument** pro prázdnou A4 nebo **Začít ze šablony**. K dispozici je šest původních návrhů: leták A4, nabídka A4, vizitka 90 × 50 mm, tři snímky 16:9, čtvercový příspěvek a plakát A3.

V otevřeném PDF použijte **Grafické prvky** pro grafický panel a plátno. Pro původní text přepněte na **Upravit text PDF**. Při úpravě původního textu grafiku stále vidíte jako náhled; pro výběr a změnu grafického objektu znovu otevřete **Grafické prvky**. Aplikace při návratu převezme aktuální textové změny a zachová grafické objekty. Není potřeba dokument ručně exportovat a znovu otevírat.

## Úpravy návrhu

V knihovně vložte text, obrázek nebo tvar. Objekt vyberte na plátně a posuňte jej tažením. Úchyty a panel vlastností umožňují měnit velikost a natočení. Ve vlastnostech upravíte barvu, obrys, průhlednost, text, velikost písma a zarovnání. Písmo je lokální Liberation Sans ve třech řezech: běžném, tučném a kurzívě.

Obrázek lze oříznout pomocí procentních hodnot ve vlastnostech; **Obnovit celý obrázek** vrátí původní výřez. Panel vrstev umožňuje vybírat objekty, měnit jejich pořadí a zamykat je. Více objektů lze zarovnat, seskupit a duplikovat. Nové prvky zůstávají editovatelné v uloženém projektu.

Seznam stránek nabízí přidání, kopii, smazání a přesun. Nová prázdná stránka převezme velikost aktuální stránky. Poslední stránku nelze smazat. **Přidat PDF** připojí stránky vybraného PDF na konec návrhu.

| Zkratka | Akce ve studiu |
| --- | --- |
| Ctrl/Cmd + Z | Zpět |
| Ctrl/Cmd + Shift + Z nebo Ctrl/Cmd + Y | Znovu |
| Ctrl/Cmd + D | Duplikovat výběr |
| Ctrl/Cmd + A | Vybrat objekty stránky |
| Šipky / Shift + šipky | Posun o 1 / 10 bodů |
| Delete / Backspace | Smazat vybrané odemčené objekty |
| Escape | Zrušit výběr |
| Ctrl/Cmd + S v obou sadách nástrojů | Uložit editovatelný projekt včetně aktuálních změn textu PDF |

Zkratky úprav objektů se nepoužívají při psaní do formulářových polí. Textové a grafické nástroje mají oddělené historie; nejde zatím o společné vrácení všech akcí. Pokud se PDF podklad a rozložení stránek nezmění, přepnutí nástrojů zachová nativní historii textu. Změna struktury vyžadující nové načtení podkladu ji může resetovat. Také stále platí omezení původního PDF editoru, kde přidání stránky může po potvrzení vymazat starší historii textových úprav.

## Moje značka

V **Moje značka** nastavte název, barvy, řez písma a logo. Logo musí být platné PNG nebo JPEG do 2 MB a nejvýše 16 megapixelů. **Uložit značku** uloží nastavení v tomto prohlížeči. Lze odebrat logo nebo obnovit výchozí nastavení.

Značka se použije při vložení nové šablony. Již otevřený návrh se automaticky nepřebarví. Výběr nové šablony nahrazuje aktuální návrh po potvrzení; samostatnou kopii předem uložte jako projekt.

## Uložení a obnova

Společné **Uložit projekt** převezme také aktuální změny původního textu PDF a stáhne soubor `.zpdf`, který zachová stránky, objekty, obrázky i PDF podklad. **Otevřít projekt** jej znovu načte. Projekt je nejvhodnější formát pro pokračování v grafických úpravách.

Volba **Automatická obnova grafických úprav** průběžně ukládá grafické změny lokálně. **Psaní do původního PDF se automaticky neukládá.** Tyto změny zachovejte tlačítkem **Uložit projekt**, nebo přepněte zpět na **Grafické prvky**, kde se převezmou do projektu a při zapnuté obnově uloží lokálně.

Obnovit uloženou kopii lze tlačítkem **Obnovit poslední projekt**, případně **Obnovit grafický projekt** na úvodní obrazovce. Vypnutí automatické obnovy zastaví další ukládání; dřívější kopii odstraní **Smazat lokální kopii**. Otevřený dokument při tom zůstává zachován.

Obnova závisí na úložišti prohlížeče. Při chybě nebo před přesunem na jiné zařízení použijte stažení `.zpdf`.

## Společný export dokumentu

Dialog **Exportovat** je společný pro textové i grafické nástroje a před exportem převezme aktuální změny textu PDF. Nabízí všechny nebo aktuální stránku. Pro obrázky zvolte měřítko a kvalitu; více stránek se stáhne jako ZIP.

| Formát | Co získáte |
| --- | --- |
| PDF | Text a vektorové prvky nad původním PDF; zachovejte `.zpdf` pro další grafické úpravy. |
| PNG, JPEG, WebP | Rastrový výstup vybrané velikosti. |
| SVG | Aktuální grafickou stránku bez zdrojového PDF. Stránka s PDF podkladem se odmítne. |
| PPTX | Prezentaci s editovatelnými podporovanými texty a základními tvary. PDF podklad a ostatní grafika jsou obrázky. Všechny snímky musí mít shodnou velikost. |

Změna počtu nebo pořadí stránek zdrojového PDF s formuláři, záložkami nebo přílohami může být při PDF exportu odmítnuta. Připojování dalších PDF odmítá zjištěné formuláře, záložky a některé další dokumentové struktury, jejichž kopírování by mohlo ztratit data. PPTX zatím nebyl ručně ověřen v Microsoft Office; nepočítejte s přesnou shodou všech detailů a ponechte si projekt.

Zakrytí obsahu obdélníkem není redakce citlivých údajů. Pro úpravy původního textu použijte **Upravit text PDF** ve společné liště dokumentu.

## Stav ověření

V samostatné testovací kartě bylo ověřeno stažení PDF, PNG, JPEG, WebP, SVG a PPTX. Český text exportovaného PDF byl nezávisle přečten pomocí PDF.js a PNG vizuálně zkontrolován. Průchod od úpravy grafického textu přes doplnění textu PDF a zpět k uloženému projektu zachoval 12 editovatelných objektů i oba texty v odpovídajících vrstvách. Společná lišta zůstala dostupná.

Obnova uloženého projektu byla ověřena v nové kartě prohlížeče: český grafický text i PDF podklad zůstaly zachované. Závěrečná testovací sada prošla se 1 129 testy v 70 souborech, kontrola TypeScriptu i editorový build prošly. Vizuální ověření PPTX v Microsoft Office zůstává otevřené. Aplikace nebyla veřejně nasazena. Podrobné důkazy, omezení a zbývající akceptační seznam jsou v [implementačním plánu](../superpowers/plans/2026-10-26-graphic-studio.md).
