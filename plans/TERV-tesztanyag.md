# Tesztanyag és körbe-teszt — terv

## 1. Cél

Legyen a repóban olyan **próbasablon-készlet** és **importálható táblázat**,
amivel az app teljes útja végigjátszható: táblázat → nyilvántartás →
dokumentum. Ma ez hiányzik: minden ellenőrzés kézzel összerakott adaton
futott, ami munkamenetenként újra megszületik és eltűnik.

## 2. Egy hibát már a felderítés talált

A `test/fixtures/adatbekero-minta.xlsx` **nincs a repóban** — a `.gitignore`
`*.xlsx` szabálya kizárja. Friss klónban emiatt **három teszt elbukik**:

```
✗ az oszlopkulcsok és a sorrend megegyezik az eredetivel   ENOENT
✗ az angol címkék megegyeznek az eredetivel                ENOENT
✗ az eredeti adatbekérő üres sablonja gond nélkül beolvasható  ENOENT
```

Ez nem elmélet: lemértem egy `git clone`-nal. A tesztkészlet ma **csak az én
gépemen teljes**, ami pont az ellenkezője annak, amiért teszt van.

**Javítás:** a `.gitignore` kapjon kivételt a `test/fixtures/` mappára. Az
éles adat továbbra is kizárva marad — a fixture-ökben kitalált emberek vannak.

## 3. Mit kell lefednie

A séma mai állapota: 49 mező, ebből 4 kötelező, 5 választható (enum), 6 dátum,
5 számított. A tesztanyagnak ezek mindegyikét érintenie kell.

| Terület | Miért kockázatos |
|---|---|
| Számított mezők | négy mezőből fűz össze egyet — elrontható a sorrend és az elválasztó |
| Kétnyelvű jelölők | `{{Neme}}` / `{{Neme_EN}}` ugyanabból a mezőből |
| Jelölőnégyzet | `{{CHECK:…}}` → ☒/☐, saját igaz-halmazzal |
| Enum-szinonimák | `ffi`, `Nő`, `Igen` mind fel kell ismerni |
| Dátumalakok | többféle írásmód → ISO |
| Azonosító-párosítás | **lejárt** számra is meg kell találni az embert |
| Duplikátum | fájlon belül és a nyilvántartással szemben |
| Hiányzó adat | ne törjön el, hanem naplózza |

## 4. A sablonok

Négy `.docx`, a `test/fixtures/sablonok/` mappában.

| Fájl | Mit fed le |
|---|---|
| `01-alap-adatlap.docx` | minden egyszerű mező, mind az 5 számított, `{{mai nap}}`, `{{Azonosító}}` |
| `02-ketnyelvu-nyilatkozat.docx` | mind az 5 enum magyarul ÉS angolul (`_EN`) |
| `03-jelolonegyzetek.docx` | `{{CHECK:…}}` igaz és hamis ágon, plusz **szándékosan hiányzó** mezők |
| `04-tordelt-jelolok.docx` | **a jelölők több futamra szétvágva** |

A negyedik magyarázatra szorul. A Word gépelés közben szétvágja a szöveget
`<w:r>` futamokra — egy `{{Neme}}` jelölő simán `{{Ne` + `me}}` alakban kerül
az XML-be, ha közben megnyomtál egy szóközt vagy formáztál. Ez a
**leggyakoribb valós hiba** dokumentumsablonoknál. A docxtemplaternek van
előfeldolgozója rá, de ha ezt nem teszteljük, csak hisszük, hogy működik.

A többi sablon tiszta futamokkal készül — az önmagában nem életszerű, ezért
kell mellé a 4.

## 5. Az importálható táblázat

Egy `test/fixtures/proba-import.xlsx`, a valódi adatbekérő szerkezetében
(rejtett kulcssor, angol címkesor, 3. sortól adat). Hat sor, mindegyik más
esetet állít:

| # | Sor | Amit bizonyít |
|---|---|---|
| 1 | teljes, kanonikus értékek | az alapeset működik |
| 2 | `ffi`, `Nő`, `Igen`, vegyes dátumalakok | a szinonimák és dátumok feloldódnak |
| 3 | meglévő személy **lejárt** SAP-számával | a történet alapján párosít, nem duplikál |
| 4 | az 1. sor ismétlése | fájlon belüli duplikátumot kiszűr |
| 5 | hiányzó kötelező mező | kimarad, nem hoz létre féloldalas rekordot |
| 6 | mind az 5 azonosító kitöltve | az azonosító-tükrözés a mezőkbe |

A 3. sorhoz a nyilvántartásban előre kell lennie egy személynek lejárt
azonosítóval — ezt a teszt maga hozza létre.

**Kitalált emberek, kitalált számok.** Valós személyes adat nem kerül a
repóba. A nevek felismerhetően próbanevek (Próba Péter, Teszt Tímea).

## 6. Hogyan készülnek a fájlok

A `.docx` egy zip néhány XML-lel. A generálást egy szkript végzi
(`tools/tesztanyag-keszito.js`), a meglévő `vendor/pizzip.min.js`-szel — nincs
új függőség, és nem kell hozzá Word. Ez azért is jó, mert a **4. sablon
szándékosan szabálytalan futamait** kézzel kell előállítani; Wordben ezt nem
lehet megbízhatóan reprodukálni.

Az xlsx-et a saját `XlsxWrite`-unk írja, majd a sorokat SheetJS tölti fel — így
a próbafájl pontosan olyan szerkezetű, mint amit az app kiad.

> **A szkript a repóba kerül, nem csak a kimenete.** Ha a séma változik, a
> tesztanyag újragenerálható. Egy kézzel gyártott, reprodukálhatatlan bináris
> fixture pár hónap alatt hazuggá válik.

## 7. A körbe-teszt

> **A terv egyik feltevése megdőlt, még végrehajtás előtt.** Azt terveztem, hogy
> az egész körbe-teszt Node-ban fut. Lemértem: **nem tud.** A docxtemplater
> `new DOMParser()`-t hív, ami Node-ban nem létezik:
>
> ```
> ✗ tiszta futamok: HIBA – DOMParser is not a constructor
> ```
>
> Megkerülő utat kerestem — a `vendor/` egyik könyvtára sem ad használható
> XML-parsert. Marad három lehetőség:
>
> | Út | Ítélet |
> |---|---|
> | `@xmldom/xmldom` felvétele | ✗ a projektnek nulla npm-függősége van, és nincs `package.json` — ez az elvet törné meg egyetlen teszt kedvéért |
> | Saját DOMParser-pótlék | ✗ egy konform XML-DOM megírása nagyságrendekkel több munka, mint amennyit ér |
> | **Kettéosztás** | ✓ ami headless futtatható, az Node-ban; a dokumentum-renderelés böngészőben |
>
> Ezért a körbe-teszt két részből áll.

### 7a. Adatút — `test/e2e.test.js` (Node, a `run-all` része)

```
1. proba-import.xlsx beolvasása      → 6 sor, a fejléc a sémára illeszkedik
2. import-terv készítése             → 3 create, 1 update, 1 duplikátum,
                                        1 hiányos
3. alkalmazás a nyilvántartásra      → a lejárt SAP-os sor a MEGLÉVŐ emberre
                                        került, a régi azonosító lezárult
4. séma-feloldás a sorokra           → a számított és kétnyelvű értékek
5. a sablonfájlok szerkezete         → mind a 4 valódi zip, a várt jelölőkkel
6. xlsx export a nyilvántartásból    → a beolvasott értékek visszakerülnek
```

### 7b. Dokumentum-renderelés — `test/e2e-browser.js` (böngésző)

Ugyanaz a szkript fut kézzel (konzolba illesztve) és a felügyelt böngészőben.
A repóba kerül, tehát nem egyszeri kattintgatás.

```
1. mind a 4 sablon betöltése és generálása
2. a kész .docx szövegének kiolvasása (a document.xml címkéit lecsupaszítva)
3. tényleges karakterláncok összevetése
```

Nem azt nézzük, hogy „lefutott hiba nélkül", hanem hogy mi került a papírra:

- `Próba Péter` — számított mező négy helyett kettőből
- `Férfi` **és** `Male` ugyanabból a mezőből
- `1024 Budapest Fő utca 12` — négy mezőből fűzve
- `☒` és `☐` a jelölőnégyzeteknél, igaz és hamis ágon
- a **tördelt** jelölők ugyanúgy helyettesítődnek, mint a tiszták
- a hiányzó mezők bekerülnek az `emptyTags` listába

## 8. Amit ez NEM fed le

Őszintén, hogy ne bízzuk el magunkat:

- **A PDF-konverzió** — az Wordöt igényel, tesztből nem vezérelhető.
  Marad a `tools/pdf-proba/` kézi csomagja.
- **A felület** — ez adat- és fájlszintű körbe-teszt. A gombok kattintását
  továbbra is böngészőben nézem meg.
- **A valódi Word-sablonok** összes formázási furcsasága. A 4. sablon a
  leggyakoribb esetet fedi (tördelt futamok), de nem mindet — táblázatba vagy
  fejlécbe ágyazott jelölők külön eset.

## 9. Lépések

| # | Lépés | Kimenet |
|---|---|---|
| 1 | `.gitignore` kivétel a fixture-ökre | a meglévő `adatbekero-minta.xlsx` végre bekerül |
| 2 | `tools/tesztanyag-keszito.js` | a 4 sablon + az import-táblázat |
| 3 | fájlok generálása és szemrevételezése | megnyithatók Wordben és Excelben |
| 4 | `test/e2e.test.js` | adatút, a `run-all` része |
| 5 | `test/e2e-browser.js` | dokumentum-renderelés |
| 6 | futtatás, javítás amíg zöld | `node test/run-all.js` + böngésző |
| 7 | **friss klónon is lefut** | a reprodukálhatóság bizonyítva |

A 7. lépés a lényeg: ha a klónban nem fut le, a tesztanyag nem ér semmit.
Ma nem fut le — ezt a 2. pont írja le.
