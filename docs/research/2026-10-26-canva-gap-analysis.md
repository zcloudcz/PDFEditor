# Canva: rozdíly, proveditelnost a priority pro jeden editor

Datum průzkumu: 26. 10. 2026. Jde o posouzení rozsahu, nikoli příslib implementace nebo úplné kompatibility. Canva byla ověřena proti aktuálně dostupné oficiální dokumentaci; konkrétní dostupnost funkcí se může lišit podle tarifu, účtu a typu dokumentu. Ceny a velikosti katalogu zde nejsou rozhodovacím kritériem. Stav našeho editoru vychází ze zdrojového kódu a existujícího validačního protokolu, nikoli z nového browserového testu během tohoto průzkumu.

## Rozhodnutí pro produkt

**Smysluplný cíl je jeden lokální editor PDF a běžné grafiky, nikoli bezplatná kopie celého ekosystému Canvy.** Současná aplikace už má společný dokument, trvalou horní lištu, editovatelné grafické objekty nad původním PDF a společné uložení/export. Nejvyšší přínos nyní přinese kvalitnější text, obrázky, šablony, práce s rozložením a spolehlivý průchod uložením a exportem. To lze rozšiřovat v prohlížeči bez placených služeb.

Canva zahrnuje také prezentace, video, audio, tabulky, Docs, weby, whiteboardy, týmovou práci, publikování, tiskové služby a AI. Její multi-design skutečně spojuje různé formáty v jednom projektu, ale ani Canva neslibuje univerzální export všech typů nebo všechny funkce napříč nimi. [Visual Suite](https://www.canva.com/design-school/resources/exploring-the-visual-suite/), [multi-design a jeho omezení](https://www.canva.com/en_gb/help/multi-design/).

**Nulová cena licence neznamená nulové náklady na vývoj, hardware, provoz nebo obsah.** Lokální editor, malé vlastní knihovny a omezené dávkové operace jsou reálné. Plnohodnotný videoeditor, sazba dokumentů, tabulkový procesor a současná týmová editace jsou samostatné velké inženýrské oblasti, i když mohou být přístupné v jedné aplikaci. Stejně kvalitní globální katalog médií, neomezená hostovaná AI a tisková logistika nejsou realistický příslib při nulovém rozpočtu.

## Co dnes skutečně máme

| Oblast a důkaz v repozitáři | Aktuální stav a hranice |
| --- | --- |
| `src/editor/studio/types.ts:1` | Sedm druhů objektů: obdélník, elipsa, čára, šipka, cesta, text a rastrový obrázek. Stránky s rozměry v bodech PDF, zdrojový PDF podklad, verze projektu 1. Žádné typy tabulka, graf, video, odstavcový dokument ani webová sekce. |
| `src/editor/studio/canvas.ts:246`, `:633`; `exports.ts:383` | Text je jeden řetězec, jeden řez/velikost/barva na objekt. Řádky se dělí podle ručních odřádkování, mezera řádků je pevně 1,2 násobku velikosti. Chybí odstavcová sazba a zalamování do šířky, smíšené řezy uvnitř textu, seznamy a styly textových úseků. |
| `src/editor/studio/canvas.ts:403`; `model.ts:81` | Přesun, změna velikosti, rotace, zarovnání, skupiny, vrstvy, zámky a duplikace. Již existuje přichytávání na mřížku a hrany/středy stránky i objektů s vodítky; není správné psát, že snapping úplně chybí. Dále lze přidat distribuci rozestupů, uživatelská vodítka a pravidla adaptace rozložení. |
| `src/editor/studio/templates.ts:5`; `brand-kit.ts` | Šest vlastních šablon, lokální logo/barvy a tři řezy Liberation Sans. Značka se uplatní na novou instanci šablony, nemění automaticky otevřený dokument. Není to katalog médií nebo systém týmového schvalování značky. |
| `src/editor/studio/document-bridge.ts:44`, `:61`; `host.ts` | Přepnutí nástrojů zachová grafické objekty a synchronizuje původní PDF. V nativních textových nástrojích je grafika neinteraktivním náhledem. Původní PDF se automaticky nerozloží na grafické objekty. |
| `src/editor/studio/project-io.ts:4`, `:32`, `:71`; `model.ts:23`; `recovery.ts:22` | Přenosný JSON `.zpdf`, limit serializace 100 × 1024 × 1024 znaků, nejvýše 200 stránek a 10 000 objektů, historie nejvýše 80 stavů. Limity nejsou benchmark výkonnosti. Obnova je lokální a jen pro synchronizovaný grafický projekt; živé nativní textové změny nejsou automaticky ukládány. |
| `src/editor/studio/exports.ts:184`, `:443`, `:509` | PDF, PNG/JPEG/WebP, SVG a částečné PPTX. SVG odmítá stránku s PDF podkladem. PPTX vyžaduje stejně velké snímky, ponechá podporované texty a základní tvary editovatelné; podklad a další grafiku rasterizuje. Vizuální shoda v Office nebyla ověřena. |

Další důkazy: [UX průvodce](../ux/graphic-studio.md), [implementace a akceptační protokol](../superpowers/plans/2026-10-26-graphic-studio.md), `MEMORY.md`. Protokol zaznamenává 1 129 úspěšných testů / 70 souborů, kontrolu TypeScriptu a build, reálné stažení exportů, kontrolu českého PDF textu a zachování grafických objektů při přechodu mezi nástroji. Tím nejsou automaticky splněny zbývající browserové scénáře, Office interoperabilita ani otevřené zdrojové/licenční release brány.

### Písmo není totéž co jazyk rozhraní

Grafický canvas používá Liberation Sans s browserovým fallbackem Arial/sans-serif (`canvas.ts:255`), zatímco PDF export načítá pouze lokální soubory Liberation Sans (`exports.ts:19`). Validátor povoluje několik názvů řezů včetně Arial, ale export tím nezískává samostatnou rodinu Arial. Český text je doložený. Arabštinu, indická písma, CJK nebo emoji nelze prohlásit za podporované jen proto, že je browser zobrazí fallbackovým písmem. Kód nemá v projektovém modelu výslovnou správu směru textu, vícefontového fallbacku a komplexní sazby. To není tvrzení, že každý nelatinský znak vždy selže; je to chybějící garantovaný průchod canvas → uložený projekt → PDF/PPTX. Lokalizace ovládání tento problém neřeší.

## Mapa mezer a proveditelnosti

Třídy: **A** = rozumné lokální rozšíření; **B** = významná inženýrská investice, stále možná lokálně; **C** = volitelný backend nebo výraznější hardware; **D** = při nulovém provozním/licenčním rozpočtu nereálná ekvivalence služby. Jedna oblast může mít malou variantu A a plnou variantu B/C/D. Priorita P0 označuje spolehlivost základu, P1 nejbližší produktové rozšíření, P2 navazující funkce, P3 samostatně rozhodovanou oblast.

| Oblast Canvy a oficiální zdroj | Co nám chybí | Reálný rozsah v jedné aplikaci | Třída / priorita |
| --- | --- | --- | --- |
| [Šablony a média](https://www.canva.com/pricing/) | Šest kompozic neřeší široké obory, vyhledávání, osobní šablony ani knihovnu obrázků/ikon. | Vlastní kurátorované šablony, tagy, náhledy, oblíbené, uložit výběr/stránku jako šablonu a znovu vložit. Lokální knihovna uživatelských médií s původem a licencí. Kvalita katalogu vyžaduje lidskou práci. | A / P1; ekvivalent obřího katalogu D |
| [Brand Kit](https://www.canva.com/help/brand-kit/) | Více značek, textové styly, explicitní přebarvení existujícího dokumentu a přenos značky. | Import/export značky, role barev a nadpisů, náhled změn a jedno undo pro aplikaci značky. Týmové schvalování až s identitou a oprávněními. | A / P1; tým C / P3 |
| [Formátování textu](https://www.canva.com/help/format-text/) | Zalamování, více stylů v textu, podtržení, odrážky, řádkování, tracking a širší nabídka fontů. | Nejdříve deterministická sazba sdílená náhledem a exporty, potom stylové úseky a auditované OSS fonty. Komplexní písma vyžadují pokrytí znaků i správné tvarování a směr. | B / P1; preflight P0 |
| [Textové efekty](https://www.canva.com/help/text-effects/) | Stíny, obrysy, text na křivce, přechody. | Přidávat jednotlivě s deklarací exportní podpory; nepřevést tiše celý dokument na bitmapu. I dokumentace Canvy uvádí limity některých efektů v PDF/SVG. | A–B / P2 |
| [Rámečky a ořez](https://www.canva.com/help/resize-and-crop/) | Interaktivní crop, masky/rámečky, pohodlné nahradit obrázek při zachování layoutu. | Kruhové a zaoblené masky, drag crop, fit/fill, původní obrázek zachovaný pro reset. Již existující procentní crop využít jako základ. | A / P1 |
| [Fotoeditor](https://www.canva.com/en_in/help/image-editor/) | Jas, kontrast, saturace, filtry, rozostření, lokální retuš, výměna objektů. | Nedestruktivní úpravy v panelu vlastností, uložený originál a parametry. Jednoduché filtry lokálně; generativní retuš řešit zvlášť. | A / P1; retuš B–C |
| [Odstranění pozadí](https://www.canva.com/features/bulk-background-remover/) | Segmentace a ruční oprava masky. | Lokální model s prověřenou licencí kódu i vah, detekce výkonu, zrušení výpočtu a štětec pro hrany. Nezaručovat stejnou kvalitu pro vlasy, sklo a nízký kontrast. | B–C / P2 |
| [Rozměry a layout](https://www.canva.com/help/resize-and-crop/) | Distribuce mezer, vlastní vodítka, znovupoužitelné bloky a adaptace návrhu na jiný formát. | Rozšířit současné zarovnávání/snapping; nabídnout ruční pravidla přikotvení a náhled resize. Změna velikosti stránky sama není chytrý redesign. | A–B / P1–P2 |
| [Prezentace](https://www.canva.com/presentations/) | Režim přednášení, poznámky, časovač, přechody, hlasový záznam. | Lokální fullscreen a poznámky nad existujícími stránkami; dál ověřený PPTX export. Sdílené živé ovládání a publikum jsou síťová služba. | A–B / P2; živé služby C |
| [Grafy a data](https://www.canva.com/en_gb/help/magic-charts/) | Datový model grafu, tabulky, editace dat a aktualizace vykreslení. | Tabulka a několik typů grafů s lokálním CSV, zachování dat v projektu, vektorový výstup. AI interpretace není potřeba pro běžný graf. | B / P2 |
| [Sheets a analytika](https://www.canva.com/help/magic-insights/) | Buňky, vzorce, odkazy, import a práce s daty. | Pro návrhy nejdříve malý datový panel; plný spreadsheet je nový výpočetní a interakční model, nikoli nová šablona. | B / P3; AI C |
| [Bulk Create](https://www.canva.com/help/bulk-create-from-sheets/) | Propojení hodnot s objekty a dávkové varianty. | CSV → mapování sloupců na text/obrázky → náhled → nové stránky; chybějící hodnoty, přetečení textu, limity velikosti a možnost zrušit. Generování po dávkách, ne stovky kopií celé historie. | A–B / P2 |
| [Video, audio a animace](https://www.canva.com/design-school/resources/exploring-the-visual-suite/) | Časová osa, délka objektů, klipy, audio, synchronizace, přechody a videoexport. | Nejprve jednoduché animované snímky. Plný střih znamená časový model, dekódování, exportní pipeline, kodekové a paměťové limity zařízení. Serverový render by změnil lokální kontrakt. | B–C / P3 |
| [Whiteboards](https://www.canva.com/design-school/resources/exploring-the-visual-suite/) | Nekonečná plocha, sticky notes, konektory, diagramy a týmová práce. | Lokální omezené diagramy mohou sdílet objekty; nekonečná plocha potřebuje virtualizaci a jiný zoom/navigaci. Exportuje se oblast, nikoli automaticky vše na A4. | A–B / P2–P3; tým C |
| [Docs](https://www.canva.com/design-school/resources/exploring-the-visual-suite/) | Plynulý tok odstavců, semantické styly, tabulky a automatické stránkování. | Dlouhé dokumenty vyžadují vlastní sazbu a vazbu toku na stránky. Současné absolutní textové boxy nejsou textový procesor. Mohou být dalším typem obsahu pod společným projektem. | B / P3 |
| [Weby](https://www.canva.com/help/publishing-canva-websites/) | Responzivní sekce, navigace, HTML export, metadata a hosting. | Lokální export statického webu je možný po zavedení webového layoutu. PDF souřadnice se samy nezmění v použitelný mobilní web. Hosting/domény/analytika jsou oddělená volitelná služba. | B / P3; publikace C |
| [Spolupráce a oprávnění](https://www.canva.com/help/set-sharing-permissions-canva/) | Komentáře, současná editace, účty, sdílecí odkazy, serverová historie a role. | Lokální komentáře a ruční předávání projektu jsou dosažitelné. Skutečná společná práce potřebuje řešení konfliktů, identitu, autentizaci a trvalé síťové úložiště. Lokální zámek objektu není bezpečnostní oprávnění. | A / P2 pro komentáře; B–C / P3 pro tým |
| [Publikace na sítě](https://www.canva.com/help/content-planner/) | Účty, plánovač, publikování na pozadí a přehledy. | Exportní presety a balíček obrázků/captionů lokálně. Spolehlivé plánování při zavřeném prohlížeči vyžaduje běžící službu a oprávnění poskytovatelů. | A / P2; C–D / P3 |
| [Tisk](https://www.canva.com/help/print-designs/) | Spadávka, ořezové značky, tiskový preflight, správa barev a objednávky. | Nejdříve kontrola rozlišení/okrajů a výstup pro běžný tisk. CMYK/PDF-X musí mít explicitní profily a validaci. Globální výroba, platby, doprava a reklamace jsou obchodní operace. | A–B / P2; logistická ekvivalence D |
| [AI fotografie](https://www.canva.com/en_in/help/image-editor/), [AI data](https://www.canva.com/help/magic-insights/) | Generování, přepis obsahu, chytré úpravy a analýza. | Omezené lokální modely na vhodném zařízení, s jasným stažením modelu a bez automatického uploadu. Neomezené stejně kvalitní generování obrázků/videa pro každého bez infrastruktury slíbit nelze. | C; hostovaná ekvivalence D / P3 |

## Jak zachovat jednu aplikaci

Společný projekt a horní lišta mají zůstat základem. Nové nástroje patří do kontextového panelu právě vybraného objektu: úpravy fotografie do obrázku, textové styly do textu, data do grafu. Šablona se má vkládat také jako stránka/blok do otevřeného projektu; dnešní nahrazení celého návrhu je pro kombinování materiálů omezení. Uložení, export, seznam stránek a informace o neuložené práci musí fungovat napříč nástroji.

Technický návrh pro další rozhodování, nikoli hotová implementace:

1. Zachovat současný model zdrojového PDF a grafické vrstvy. Nezaměňovat bitmapový náhled za skutečný podklad; neslibovat automatickou rekonstrukci libovolného PDF do čistých boxů.
2. Zavést verzované migrace projektu před přidáním textových úseků, masek, grafů nebo animace. Zachovat staré `.zpdf` a odmítat neznámé povinné vlastnosti místo jejich tiché ztráty.
3. Sjednotit výpočet textového layoutu pro canvas a export. Každá funkce dostane tabulku podporovaných výstupů: editovatelné / vektorové / explicitně rastrové / nepodporované. Export musí předem označit omezení.
4. Vyřešit nativní snapshoty a jednotný stav neuložených změn. Úplné společné undo je náročnější než společné tlačítko: příkazy nad strukturou stránek mění základ nativního enginu. Historie současných plných kopií projektu není vhodná pro velká média a stovky generovaných stránek; média mají mít sdílené identity a změny menší záznamy.
5. U budoucích Docs, webů a videí ponechat jednu aplikaci, ale dát každému typu správný datový model. „Jeden projekt“ neznamená nutit tok odstavců nebo časovou osu do stejné geometrie. I Canva dokumentuje různé exportní schopnosti podle typu stránky. [Multi-design](https://www.canva.com/en_gb/help/multi-design/).
6. Backend je případná samostatná produktová volba. Dnešní pravidlo „dokumenty zůstávají v prohlížeči“ nepřipouští jeho tiché zavedení. Lokální režim má zůstat úplný pro lokální funkce; výslovně připojené vzdálené služby by vyžadovaly změnu schváleného rozsahu.

## Doporučené pořadí a akceptace

| Etapa | Výsledek pro uživatele | Minimální důkaz před označením za hotové |
| --- | --- | --- |
| P0: důvěryhodný základ | Jasně vidí, co je uloženo a jak dopadne export. | Chybějící glyfy detekované před exportem; český text a vybrané nepodporované skripty bez tichých náhrad; aktuální nativní i grafický text přežije uložení/obnovu podle deklarovaného kontraktu; ztráta historie vysvětlena; Office test samostatně. |
| P1: praktický grafický editor | Sestaví leták, nabídku, vizitku či příspěvek bez ručního obcházení sazby a obrázků. | Zalamovaný text a styly přežijí reopen/PDF; crop/maska/filter mají reset a shodný export; šablona se vloží do stávajícího projektu; změna značky je vratná. |
| P2: produktivita | Z jedněch dat nebo návrhu rychle vytvoří více použitelných výstupů. | CSV dávka s náhledem a hlášením přetečení; graf zachová data; rozměrové varianty mají kontrolované pozice; prezentace přehrává správné stránky a poznámky; paměťové limity ověřené na cílovém zařízení. |
| P3: nové produktové oblasti | Video/Docs/web/tým/AI podle doložené potřeby. | Každá oblast má vlastní rozsah, výkonové cíle, exportní kontrakt a provozní rozpočet. Žádná nemá být označena za splněnou přidáním záložky nebo statické šablony. |

## Obsah, licence a hranice bezplatnosti

Canva rozlišuje licenci obsahu od samotné možnosti editor používat; její katalog není automaticky redistribuovatelná knihovna pro jinou aplikaci. Pro náš editor vytvářet vlastní šablony a zařazovat pouze obsah s doloženým oprávněním pro zamýšlenou distribuci. [Oficiální vysvětlení licencí Canvy](https://www.canva.com/licensing-explained/).

Tento průzkum neschvaluje žádnou novou závislost. Před výběrem OSS knihovny nebo modelu je nutné doložit primární licenci přesné verze, zdrojový kód a notices; u modelů zvlášť runtime a váhy, u médií a fontů jejich vlastní licenci. Bezplatné API ani veřejně stažitelný model nejsou samy důkaz OSS kompatibility. Jednoduché efekty, geometrii, šablony a dávkové plnění lze navrhnout bez placených externích služeb; to ještě neříká, že všechny budoucí knihovny splní pravidla projektu.

„Nereálné“ zde znamená ekonomicky nebo provozně neobhajitelné za daných podmínek: bezplatný globální stock katalog stejné kvality, neomezená hostovaná generativní AI, vlastní celosvětový tisk a bezúdržbová integrace všech sociálních sítí. Nejde o matematickou nemožnost. Menší vlastní katalog, lokální AI na uživatelském GPU, PDF pro místní tiskárnu a ruční publikace exportu jsou použitelné alternativy.
