# Díjátutalási napló és a PDF-lánc — terv

> A *miért*. A használat a [README](README.md) „Átutalások" és „PDF" szakaszában.

## 0. A kiindulás

Két, látszólag független kérés érkezett:

1. Épüljön be a `Procedural-Fee-Transfer-Log.xlsm` munkafüzet az appba.
2. „Nem működik a PDF összefűzés és a PDF generálás."

Kiderült, hogy **egy dologról szólnak**. Az appnak addig egyetlen saját PDF-je
sem volt: vagy a Wordre bízta (jó forma, de a lánc a gyakorlatban megszakadt),
vagy a böngésző nyomtatására (fut, de a formát eldobja). A díjátutalási lap
pedig pont olyan dokumentum, amit nem sablonból, hanem magunk rajzolunk — ez
kényszerítette ki a hiányzó réteget, ami után a másik két baj is orvosolható lett.

---

## 1. A PDF-lánc — mi szakadt el és miért

```
DOCX generálás  →  [Word konverzió]  →  PDF-ek  →  összefűzés
     (app)           (docx-pdf.vbs)      (lemez)     (app)
```

A Word-lépést böngészőből **nem lehet** elindítani. Ez nem hiányosság, hanem
határ: hivatalos nyomtatvány tördelését egyedül a Word ismeri, és minden
böngészős közelítés (mammoth → HTML → nyomtatás) pont azt rontja el, amiért az
irat készül. A 2026-09-18-i mérés szerint a Word COM a munkaállomáson **működik**
(`tools/pdf-proba/EREDMENY.md`), tehát nem technológiai fal volt, hanem
munkafolyamat-szakadás. Négy konkrét ok:

| # | Ok | Javítás |
|---|---|---|
| 1 | A konvertáló szkript a repó `tools/` mappájában volt, a DOCX-ek meg máshol — kézzel kellett megtalálni és ráhúzni a mappát | Az app minden generálás után **bájtmásolatban** a kimeneti mappába teszi `PDF-keszites.vbs` néven |
| 2 | Semmi nem jelezte, ha 12 DOCX mellett 0 PDF van | „PDF-előállítás állapota" sáv: hány DOCX, hány PDF, mi hiányzik, mikor készült a legutóbbi |
| 3 | `state.lastGenerated` csak a memóriában élt → újratöltés után „Előbb generálj dokumentumokat" a kész fájlok tetején | Kísérőfájl (`docgen-generalas.json`) a **kimeneti mappában** |
| 4 | Párosítatlan csoportnál néma `continue`, a végén mégis „✓ összefűzve" | A kiírt fájlokat számoljuk; 0 esetén hiba, a pontos okkal |

### Miért bájtmásolat a szkript

A `.vbs` UTF-16 LE + BOM kódolású — a Windows Script Host különben ANSI-ként
olvassa, és minden ékezet elromlik, a PDF-ben is (`tools/pdf-proba/EREDMENY.md`,
2026-08-06). Bájtmásolatnál ez a kérdés fel sem merül, és **egyetlen forrás**
marad (`tools/docx-pdf.vbs`), amit a `vbs-encoding.test.js` továbbra is őriz.
A generált fájlba égetés (JS-konstans) ezt kettőzné meg feleslegesen.

### Miért a kimeneti mappába kerül a kísérőfájl, és nem a localStorage-ba

A `docgen.js` explicit döntést rögzít: *„a fájlnevek személyneveket
tartalmaznak, ezért nem tesszük a böngésző tárolójába."* A kimeneti mappa más:
ugyanazok a nevek ott **már ott vannak fájlnévként**. A kísérőfájl tehát nem
visz személyes adatot új helyre — ellenben túléli az újratöltést, és a
`docgenpdf://` indítást is előkészíti.

### Két hiba, ami közben derült ki

- **A fájlnév nem visszafejthető.** Az `outputFilename` tokent cserél, tiltott
  karaktert vág, ütközésnél sorszámoz. A mappa tartalmából tehát nem lehet
  megmondani, melyik PDF melyik ügyfélé — a kísérőfájl nem kényelem, hanem
  szükséglet.
- **Az összefűzés minden csomagnak ugyanazt a nevet adta.** A `merge.js` a nyers
  dolgozó-rekordból olvasott `client['Vezetéknév']`-et, de a `clientRows` elemei
  `fields`-alapú rekordok — a token mindig üres volt, így minden csomag
  „dokumentumcsomag", „dokumentumcsomag (2)" lett. A név-feloldás mostantól a
  sémán megy át (`nameTokens`), és a tokenek a kísérőfájlba is bekerülnek.

### Az összefűzés átalakítása

Korábban az **aktuális kijelölésből** indult, és névegyezéssel kereste hozzá a
generált fájlt. Most a **ténylegesen elkészült listából** csoportosít. Ez
egyszerre rövidebb kód és robusztusabb: a csoportosítás nem függ attól, mi van
épp kipipálva a felületen.

Az összefűzés maga marad pdf-lib-es **lapmásolás**. A Word által előállított
oldalak bitre változatlanul kerülnek a csomagba. Wordben összefűzni és úgy
exportálni *rosszabb* lenne: a szakaszok és fejlécek ütköznének.

### `docgenpdf://` — a böngészőből indítás

A böngésző nem tud programot indítani; amit tud, az egy regisztrált protokoll
megnyitása. A mappát viszont nem tudjuk átadni: a File System Access API
fogantyút ad, nem elérési utat. Ezért a szkript **maga jegyzi meg**, hol
dolgozott utoljára (`%APPDATA%\DocGen\kimenet.txt`).

Opcionális réteg, a duplakattintásos út **fölött**, nem helyette: a
`HKEY_CURRENT_USER` alá kerül (nincs rendszergazdai jog), ugyanaz a fájl
kapcsolja ki, és ha a céges házirend tiltja, nem veszítettünk semmit.

### Amit NEM csinálunk

- **A böngészős nyomtatás nem lesz formahű.** A mammoth szándékosan eldobja a
  formázást. Ez az út megmarad „gyorsnézet, nem formahű" felirattal, de nem
  automatikus és nem javasolt. A „Csak PDF" gomb kikerült: azt ígérte, amit
  nem tudott.
- **Nem telepítünk LibreOffice-t vagy helyi kiszolgálót.** A telepítés
  hiánya valódi érték ennél az eszköznél.

---

## 2. A saját PDF-réteg

`js/services/pdf-service.js` — az első réteg, amivel az app **Word nélkül** tud
PDF-et készíteni. Erre épül a díjátutalási lap, és ez adja a közös
betűkészletet is.

### Miért kell beágyazott betűkészlet

A pdf-lib beépített betűi WinAnsi-kódolásúak, amiben **nincs `ő` és `ű`**.
Magyar iratot enélkül nem lehet készíteni. A beágyazáshoz a pdf-lib fontkitet
kér — innen a két vendor-fájl.

### A betűkészlet: Carlito

Metrikában **Calibri-kompatibilis**, vagyis a lap ugyanúgy néz ki, mint a
kiváltott munkafüzet. 2117 kódpont: magyar, vietnámi, cirill, török, román,
lengyel, horvát — pontosan a nyilvántartásban ténylegesen előforduló nevek.
SIL OFL licenc.

Base64-ként, JS-forrásban él (`tools/font-bundle.js` generálja), mert az app
`file://` protokollról fut, ahol a `fetch()` tiltott. A `<script src=...>` az
egyetlen út. 1,7 MB, ezért **csak az első tényleges PDF-készítéskor** töltődik be.

### Három mérés, ami átírta a megoldást

**1. A részhalmazolás (`subset: true`) tönkreteszi a betűket.**
7 kB-os PDF-et adott 278 kB helyett — de a 34 glifából 13 olvashatatlan volt és
4 üres, vagyis a kinyomtatott lapon a szöveg fele hiányzott. Közben a PDF
szövegrétege hibátlan maradt: másolni és keresni lehetett benne, tehát minden
szöveges ellenőrzés átengedte volna. Kikapcsolva. A méret nem érv: a kiváltott
Excel ugyanezt a lapot 319 kB-ban adta.

**2. Az első teszt a rossz dolgot mérte.**
Azt állította, hogy „a kimenet töredéke a forrásnak" — ami pontosan az, amit egy
*hibás* részhalmazoló produkál. A teszt most kibontja a PDF-be ágyazott
betűkészletet, és minden glifáját megpróbálja kirajzolni.

**3. A Carlito `liga` táblája „ti" és „fi" ligatúrát tartalmaz.**
A pdf-lib a fontkit `layout()`-jával alakít glifákká, ami ezeket alkalmazta: a
lapon „Nati onality" jelent meg, a szövegrétegben pedig „Naࢢonality" (U+08A2).
Nevekben és banki közleményben ez elfogadhatatlan. A `tools/font-bundle.js`
ezért **kiveszi a GSUB táblát** a beágyazott változatból — egy karakter, egy
glifa. A GPOS (kerning) marad; a vietnámi és cirill betűket nem érinti, mert
azok előkomponált glifák, és a `PdfService` NFC-re normalizál.

Mindhárom mérésnek megvan a maga tesztje, hogy ne legyen visszavonható véletlenül.

---

## 3. A díjátutalási napló

### A köteg — egy fogalom két munkalap helyett

A makró két munkalapja (beviteli lap + `Transfer Archive`) egyetlen fogalommá
olvad: **köteg**, `elokeszites` / `kifizetve` státusszal. A kettő között nem
szerkezeti a különbség, hanem annyi, hogy a pénz elindult-e. Egy mező, nem két
adatszerkezet — így nem is térhet el egymástól ugyanaz a sor két helyen, és a
makró „archiválás + beviteli lap kiürítése" lépése egy állapotváltás lesz.

### A tétel pillanatkép, nem hivatkozás

A makró archívuma szándékosan a feloldott *értéket* másolta: *„the archive must
stand on its own"*. Ugyanez az ok itt is. Egy kifizetett tétel azt bizonyítja,
mi szerepelt a banki közleményben — ha holnap javul a dolgozó neve, vagy
törlődik az ügy (`CaseRepo.destroy()` létezik), a bizonyíték nem változhat
visszamenőleg. Az előkészítés alatti kötegnél viszont van frissítés az ügyből,
hogy a friss adat se maradjon le.

### A napló külön, csak hozzáfűzhető listában

Nem a soron belül, mint a `CaseRepo` `events[]`-e. A legfontosabb naplózandó
művelet ugyanis a **törlés** — annak a sorba ágyazott naplója magával a sorral
tűnne el. A `BevLogger` sem megoldás: memóriapuffer, az ablak bezárásával elvész.

**Ismert plafon:** ez egy JSON az adatmappában, aki a fájlhoz fér, átírhatja.
Jóhiszemű használat melletti visszakövetésre való, nem kriptografikus
bizonyíték. Ha egyszer bizonyító erő kell, a továbblépés hash-lánc.

### Az ellenőrzés figyelmeztet, nem tilt

A `DataIssues` portja. A makró is megkérdezte, hogy „mégis?" — hibajavítás
közben kell tudni átmenetileg hiányos sort tartani, különben a javítás maga
válik lehetetlenné. A PDF is elkészül hiányos sorral: a javításhoz gyakran épp
a kinyomtatott kép kell.

A kötegszintű ellenőrzés két dolgot néz, ami csak együtt látszik: ugyanaz az
azonosító kétszer a kötegben, és az azonosító egy korábbi **kifizetett**
kötegben. Előkészítés alatti másik köteg nem számít — az még nem pénzmozgás.

### A dátum csapdája

A séma magyar *megjelenítési* alakot ad vissza (`1996.04.23.`), a banki
közlemény viszont a munkafüzet képlete szerint `ÉÉÉÉ-HH-NN`. A `rowFromCase`
ezért a **nyers** mezőértékből dolgozik és normalizál. Ez mérésből derült ki,
nem tervezésből — a teszt fogta meg.

### A felület helye

Az Ügyek fül **szintjén**, nézetváltóval, nem a kiválasztott ügy alatt: egy
köteg sok ügyet fog át, gyakran különböző dolgozókét. Egy ügy részletezőjébe
zárva folyton ki kellene lépni belőle. A gyors út viszont megmarad az ügy
felől: „Díj a kötegbe" gomb a műveletsorban.

A mezőszerkesztés `change`-re menti, és **nem rajzolja újra a táblát**: a
`change` akkor sül el, amikor a felhasználó Tabbal már a következő mezőben van
— az újraépített tábla épp onnan venné el a fókuszt.

---

## 4. Ami nyitva maradt

- **A File System Access engedély minden indításnál újra kell.** A gyökere a
  `file://` protokoll: a Chrome tartós engedélye telepített webalkalmazáshoz
  kötött, és `file://`-nak nincs telepíthető origin-je. Két lehetséges lépés:
  (a) egyetlen induláskori „Hozzáférés megadása", ami egy helyre gyűjti a mai
  három kérdést; (b) `http://localhost` + telepítés, ami végleg megszünteti —
  de egy futó háttérfolyamat árán, amit a projekt egyszer már kidobott.
- **A PDF 566 kB**, mert a részhalmazolás hibás, és mindkét vágás teljesen
  beágyazódik. A továbblépés egy megbízható subsetter lenne; addig a méret az
  ár, amit a helyes kirajzolásért fizetünk.
- **A `docgenpdf://` protokollt nem próbáltuk éles gépen.** A két `.vbs`
  nyelvtana ellenőrzött, a registry-bejegyzés nem.
