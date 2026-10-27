# ZCLOUD PDF Editor: společný rozsah PDF a grafické tvorby

Stav a research: 26. 10. 2026. Podklady: [PDF gap analysis](2026-10-26-pdf-gap-analysis.md) a [Canva gap analysis](2026-10-26-canva-gap-analysis.md), včetně primárních zdrojů a důkazů v implementaci. Jde o plán, nikoli oznámení implementovaných funkcí.

## Rozhodnutí

Jedna aplikace pro úpravu PDF a tvorbu grafických dokumentů je vhodný cíl. Úplná ekvivalence všech produktů a služeb Acrobat a Canva při rozpočtu 0 není realistický závazek. Cílem je široké pokrytí konkrétních pracovních postupů, s ověřenou kvalitou uloženého výstupu a bez placeného enginu či skrytého odesílání dokumentů.

Zachovat společný projekt, seznam stránek, výběr objektů, kontextové vlastnosti, ukládání a export. Nativní PDF podklad a grafická vrstva mohou interně používat odlišné enginy. Budoucí video, plynulý text nebo web potřebují vlastní datový model; jednotná aplikace neznamená jediný model pro všechny typy obsahu.

## Co již existuje

Úpravy existujícího PDF textu a obrázků, hledání/nahrazování, nové PDF a stránky, souvislé scrollování a přizpůsobení stránky/šířky/výšky. Grafická vrstva má text, obrázky, tvary, vrstvy, skupiny, zarovnání a snapping, šest vlastních šablon a základní značku. Exportuje PDF a obrázky; SVG a PPTX mají popsaná omezení. Projekt `.zpdf` uchovává PDF podklad a grafické objekty.

Není hotové společné undo ani automatická obnova všech nativních změn. Rozhraní ve 49 jazycích neprokazuje podporu sazby a exportu všech těchto písem. Přítomnost upstream nástroje v repozitáři neznamená jeho integraci do editoru.

## Společné pořadí vývoje

| Vlna | PDF větev | Grafická větev | Podmínka dokončení |
| --- | --- | --- | --- |
| 0: spolehlivý základ | Zachování struktur PDF, společné revize a obnova | Shoda náhledu/exportu, kontrola fontů, migrace projektu | Nativní i grafické změny přežijí uložení a obnovu; neověřené kombinace se odmítnou před ztrátou dat. Uzavřít distribuční a zdrojové licenční podklady. |
| 1: každodenní práce | Merge/split/extract/rotate/crop, standardní komentáře a anotace, vyplňování formulářů | Zalamování a bohatší styly textu, masky/crop/filtry obrázků, vkládání šablon do projektu, více značek | Výstupy se správně otevřou v nezávislých čtečkách; nový obsah podporuje undo a uložení. |
| 2: produktivita | Lokální CZ/EN OCR, tvorba formulářů, záložky, číslování, porovnání dokumentů | CSV dávky, tabulky/grafy, varianty rozměrů, prezentační režim | Měřit OCR na korpusu; ověřit přetečení textu, výkon a možnost zrušení dávek; zachovat data grafů. |
| 3: specializované funkce | Skutečná redakce, chráněný export, podpisy, přístupnost a tiskové profily | Odstranění pozadí, pokročilé efekty, animované snímky | Každá funkce má samostatný rozsah, exportní testy a bezpečnostní či kvalitativní bránu. Redakce vyžaduje odstranění tajných dat i ze zdrojů, revizí a obnovy. |
| 4: nové produktové oblasti | Pokročilé Office konverze a týmové procesy | Video/audio, Docs, weby, whiteboard, spolupráce a AI | Nejdříve ověřit uživatelskou potřebu, datový model, výkon a případný provozní rozpočet. |

Pořadí nevyjadřuje odhad termínu. Redakce je důležitá, ale nesmí být vydána jako kosmetické překrytí. Podpis nakreslený obrázkem se nesmí označit za kryptografický podpis.

## Co je obtížné a co je za současných podmínek nereálné

**Náročné, ale technicky dosažitelné:** věrná sazba komplexních písem, bezpečná redakce, editovatelná rekonstrukce skenů, kvalitní PDF–Office konverze, PDF/UA a PDF/X, video export a souběžná editace. Jde o samostatné dlouhodobé oblasti s vlastními testovacími korpusy. Nezaručovat bezztrátovost libovolného dokumentu.

**Nereálné jako bezplatná plná ekvivalence:** katalog licencovaných médií v rozsahu Canvy, neomezené hostované generování obrázků/videa, globální tisková logistika a rozsáhlá cloudová služba bez provozních prostředků. Smysluplné alternativy jsou vlastní menší katalog, auditované OSS fonty a prvky, volitelný lokální model na zařízení uživatele a tiskové/exportní balíčky.

Backend není důsledkem jedné aplikace. Některé služby jej potřebují, základní PDF a grafické pracovní postupy mohou zůstat lokální. Případný server nebo lokální pomocná aplikace je nové produktové rozhodnutí; tato analýza neautorizuje upload dokumentů ani vznik placené infrastruktury.

## Paralelní realizace dalších vln

Nejdříve sjednotit rozhraní transakcí, identity stránek, revizí a exportních schopností. Potom lze oddělit čtyři proudy: PDF operace/anotace/formuláře; text a fonty; obrázky/šablony/značky; nezávislá validace uložených výstupů a zachování dat. Vlastnictví společného modelu a migrací musí mít jeden integrátor, aby paralelní vývoj neprodukoval neslučitelné formáty projektu.

Pro každou položku evidence: skutečně dostupná v jednotném editoru, pouze částečná, upstream kandidát, nebo chybějící. Nepoužívat jedno procento „parity“, které skrývá rozdíl mezi tlačítkem a spolehlivým workflow.
