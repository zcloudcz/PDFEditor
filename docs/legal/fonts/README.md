# Lokální Noto fonty pro ověřený řez T10

Soubory jsou v explicitním curated allowlistu a runtime nabídce; build ověřuje SHA256 a velikost podle manifestu. Každé písmo se načte až při použití, včetně 16,5 MB CJK. Nejde o dokončenou podporu všech komplexních písem.

- Arabština a dévanágarí: statické Regular/Bold z oficiálního archivovaného repozitáře `notofonts/noto-fonts`, revize `ffebf8c1ee449e544955a7e813c54f9b73848eac`, původní cesty `hinted/ttf/NotoSansArabic/` a `hinted/ttf/NotoSansDevanagari/`. Licence `Noto-OFL` (SIL OFL-1.1).
- CJK: statické japonské `NotoSansCJKjp-Regular.otf` z `notofonts/noto-cjk`, revize `f8d157532fbfaeda587e826d4cd5b21a49186f7c`, cesta `Sans/OTF/Japanese/`. Licence `Noto-CJK-OFL`. Japonské varianty glyphů nejsou příslibem správné regionální typografie všech CJK jazyků.
- `noto-manifest.json` obsahuje přesné bajty, SHA256 a zdrojové revize. Odkazy na zdroje: https://github.com/notofonts/noto-fonts/tree/ffebf8c1ee449e544955a7e813c54f9b73848eac a https://github.com/notofonts/noto-cjk/tree/f8d157532fbfaeda587e826d4cd5b21a49186f7c.

Sdílený backend fontkit 1.1.1 + bidi-js 1.0.3 (Unicode bidi 13) používá GSUB/GPOS pozice pro SVG obrysy a skutečné vložené PDF glyfy. SVG je vektorová kresba textu; PDF obsahuje výběrový text. PDF embedding adaptér převádí Unicode vícepísmenných RTL ligatur do vizuálního pořadí pro následný bidi průchod čtečky. Nepřepisuje původní text projektu. NFD český text se při sazbě normalizuje do NFC. Explicitní směr a jazyk se ukládají v portable v2 a předávají do bidi/fontkit; nepodporované směrové profily export odmítá.

Ověřené profily: Liberation Sans ve čtyřech řezech; Noto Sans CJK JP Regular s japonskými variantami; Noto Sans Arabic Regular/Bold s auto/RTL, číslicemi, mezerami a ligaturami, jedním stylem. Přesný Unicode a SVG/PDF pozice ověřují `src/editor/typography/independent.test.ts` skutečným PDF.js a druhým SVG rendererem.

Otevřené limity: Devanagari runtime se nyní korektně načítá přes existující regenerator-runtime 0.13.11, avšak PDF extrakce přidává mezery a přehazuje předřazené samohlásky. Dévanágarí, arabské kombinující značky, LTR arabský odstavec, smíšené Latin/Arabic fallback runs a vícestylová arabština jsou proto při exportu odmítnuté. Žádné syntetické Noto italic/CJK bold. PPTX odmítá všechny Noto profily, protože neumí slíbit stejné vložené písmo a glyfové pozice; stávající Liberation editovatelný text je zachován. Neexistuje tichá rasterizace.

Přesné odpovídající build/design zdroje a redistribuční podklady stále patří do P00/T30 gate; přítomnost OFL a připnutého fontu tyto brány neuzavírá.
