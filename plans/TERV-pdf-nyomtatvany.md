# TERV — PDF-nyomtatvány kitöltése a nyilvántartásból (NEAK NYT.52)

> Állapot: **általánosítva** (2026-10-05). A 0–10. fejezet az első, NYT.52-re szabott
> változatot írja le (beégetett mezőtérkép + SHA-256) — ezt a **11. fejezet** váltja:
> bármely kitölthető PDF sablon, a NYT.52 egy példa a sok közül.
> Előzmény: a PDF Műhelyben indult „PDF-szerkesztő” terv
> (`pdf-muhely/szerkeszto-terv.md`), amelynek 14. fejezete dönt úgy, hogy ez a
> feladat a DocGenbe tartozik. Az indoklás itt a 2. fejezetben van.

---

## 0. A feladat

A **NEAK NYT.52 – Megrendelő TAJ-igazolványhoz** (`NYT.52.K.pdf`) csak PDF-ben
létezik, kitölthető mező nincs benne. Több dolgozónak kell kitölteni. A
felhasználó döntései (2026-10-05):

- csak az **üres helyekre** kerül szöveg, a nyomtatvány szövege nem változik;
- aláírás nem kell: a kész irat a dolgozó **`02_Feltoltheto`** mappájába megy;
- több dolgozónak kell.

### 0.1 A nyomtatvány vizsgálata (F0, lemérve PyMuPDF-fel)

| tulajdonság | érték |
|---|---|
| oldal | 1 db, A4 álló (595,32 × 841,92 pt), forgatás nincs |
| eredet | Microsoft Word 2007 → PDF (szerző: OEP, 2020-04-01) |
| AcroForm / XFA / titkosítás | nincs / nincs / nincs |
| betűk | Calibri, Calibri Bold (részhalmaz), Times New Roman, Arial |
| rajzolat | 432 kitöltött téglalap (a táblázat vonalai) + **10 keretes négyzet** (a jelölőnégyzetek) |
| SHA-256 | `0f53fbfd21cd7dbd6f061533bb6ef80a46f3b6559273c4d07a2b3e720d0dd992` |
| méret | 377 790 bájt |

A táblázat vonalaiból **minden cella pontosan kiszámolható** — a betűnkénti
cellák is (irányítószám 4, év 4, hó 2, nap 2). Próbakitöltés kitalált adatokkal:
minden érték a helyére esett, az `ő`/`ű` hibátlan, a 10 jelölőnégyzetből bármelyik
X-elhető. A cellák szélessége egyenetlen (Word-táblázat), ezért a koordinátákat
a rajzolatból kell venni, nem egyenletes osztásból.

---

## 1. Cél

A **Dokumentumok** fülön a NYT.52 ugyanúgy választható, mint egy `.docx` sablon:
kijelölöd a dolgozókat, Generálás, és mindegyikük `02_Feltoltheto` mappájában
ott a kitöltött PDF. Nincs Word-lépés, nincs kézi gépelés, nincs kézi konverzió.

---

## 2. Miért a DocGenben, és nem a PDF Műhelyben

| szempont | DocGen | PDF Műhely |
|---|---|---|
| **az adatok** (név, anyja neve, születés, cím, belépés) | megvannak a nyilvántartásban | kézzel kellene begépelni dolgozónként |
| cégadatok (név, székhely, adószám) | `EH_EMPLOYER` (`js/schema/eh-forms.js`) | nincs |
| több dolgozó egyszerre | a generálás eleve így működik | új felület kellene |
| ékezetes PDF-szöveg | `PdfService`: pdf-lib + beágyazott **Carlito** | megoldható (PyMuPDF), de új kód |
| a nyomtatvány betűje | Calibri — a Carlito **metrikában Calibri-kompatibilis**, a kitöltés ránézésre a nyomtatványhoz illik | — |
| célmappa a dolgozónál | `FsService.DIR_UP` már létezik | van |
| mintája van-e | `eh-forms.js`: adat-leírás űrlaprovat → sémakulcs | a `PlacerTab` vászna |

A Műhely egyetlen előnye az interaktív vászon lett volna — de egy **rögzített**
nyomtatványnál a mezők helyét nem kell kattintgatni: a vektoros rajzolatból egyszer
kiszámoljuk, és adatként rögzítjük. A Műhelyben a kitöltés kétszeres munka és
kétszeres hibalehetőség lenne (ugyanazt az adatot még egyszer begépelni).

---

## 3. Felépítés

### 3.1 A mezőtérkép — csak adat (`js/schema/pdf-forms.js`)

Az `eh-forms.js` mintájára: leírás, logika nélkül. **A mezők forrása ugyanaz a
jelölő-szókincs, amit a `.docx` sablonok használnak** — így a dátumrész, a
szótáras fordítás, a számított mező és a jelölőnégyzet feloldása a meglévő
`makeSchemaResolver` / `makeSchemaMatcher` útján megy, új feloldó kód nélkül:

```js
const PDF_FORMS = {
  'NYT.52': {
    name:   'TAJ-megrendelő (NEAK NYT.52)',
    file:   'NYT.52.K.pdf',
    sha256: '0f53fbfd…0dd992',
    target: 'up',                                   // → 02_Feltoltheto
    size:   10.5,                                   // alap betűméret (pt)
    fields: [
      // szöveg egy cellában: [x0, y0, x1, y1], a lap bal felső sarkától, pt-ban
      { box: [262, 363.2, 530, 377.7],  tag: 'surname' },
      { box: [212, 450.2, 530, 464.7],  tag: 'citizenship_hun' },
      // betűnként egy cella: a cellahatárok x-ei + a sor y-tartománya
      { cells: [237, 262, 273, 285, 300], y: [435.8, 450.2], tag: 'date_of_birth_year' },
      // jelölőnégyzet: a négyzet bal felső sarka és oldalhossza
      { check: [222.8, 466.7, 11.2], when: 'Neme=male' },
      { check: [71.7, 128.5, 11.2],  always: true },
      // cégadat: az EH_EMPLOYER-ből, egy igazságforrás
      { box: [161, 276.8, 530, 291.5],  employer: 'nev' },
      // a kelet dátuma: a generálás napja
      { at: [252, 629.5], today: 'year' },
    ],
  },
};
```

A koordináták **bal felső origójúak** (ahogy a mérés adja). A pdf-lib bal alsó
origót vár — az átváltás (`y = lapmagasság − y`) **egyetlen helyen** történik a
kitöltőben, a leírásban soha.

### 3.2 A kitöltő (`js/services/form-pdf.js`)

```
fill(pdfBytes, form, resolve, matches) → { bytes, empty: [...], overflow: [...] }
```

1. `crypto.subtle.digest('SHA-256')` → ha nem egyezik a `form.sha256`-tal:
   **hiba**, nem kitöltés („a NEAK új változatot adott ki — a mezőtérképet újra
   kell mérni”). A rossz helyre írt adat rosszabb, mint a hiányzó irat.
2. `PDFDocument.load`, fontkit, a Carlito regular beágyazása **`subset: false`**
   mellett — a `PdfService` fejkommentje szerint a részhalmazolás ezzel a
   fontkit-építéssel olvashatatlan betűket ad. Ehhez a `PdfService` kap egy
   kis függvényt (meglévő PDF betöltése + betű), a betűbetöltés (`_loadFonts`)
   közös marad.
3. Mezőnként `drawText`:
   - `box`: balra igazítva, 3 pt margó, függőlegesen középre; ha nem fér el,
     a betűméret 7 pt-ig csökken; ha úgy sem, `overflow`-ba kerül;
   - `cells`: karakterenként a cella közepére; több karakter, mint cella →
     `overflow`;
   - `check`: „X” a négyzet közepére.
4. Az üres forrású mezők az `empty`-be — a hívó a meglévő `DocgenMissingLog`-ba
   írja, ugyanúgy, mint a `.docx` üres jelölőit.
5. Metaadat: a **Műhely bélyege** (`pdf-muhely=1;dolgozo=…;tipus=…;hely=02_Feltoltheto;…`),
   **nem** a DocGené. Lásd 3.4.

### 3.3 Beillesztés a generálásba (`js/modules/docgen.js`)

- **Sablonlista:** a sablonmappa bejárása (`fs-service.js`) ma csak `.docx`-et
  lát. Bővül: azt a `.pdf`-et is listázza, amelynek a neve egy `PDF_FORMS`
  bejegyzés `file`-ja. A felhasználó tehát egyszer bemásolja a `NYT.52.K.pdf`-et
  a sablonmappába, és onnantól ugyanúgy választható, mint egy Word-sablon (a
  keresés a `findTemplate` meglévő útját járja).
- **Generálás:** a `templateName + '.docx'` ma beégetett (a ciklus és a
  nyomtatás-dialógus is). Itt ágazik el: PDF-sablonnál `FormPdf.fill(...)` a
  `DocxService.generateDocx` helyett; a név, az ütközés-utótag, a
  hiánynapló, az előrehaladás-jelző változatlan.
- **Célmappa:** a `resolveWorkerTarget` ma fixen `DIR_PREP`-et ad. Kap egy
  paramétert; a PDF-sablon a `form.target` szerint `DIR_UP`-ba ír.
- A kész PDF-et a `PDF-keszites.vbs`-nek nem kell érintenie (nem `.docx`).

### 3.4 Buktató: a DocGen-bélyeg jelentése

A Műhely szemében a DocGen-bélyeg (`docgen` a Keywords-ben vagy a Producerben)
azt **bizonyítja**, hogy az irat generált, tehát **még nem aláírt** — a
Rendezés ezért `01_Elokeszitett`-be sorolja (`has_docgen_stamp`). A NYT.52 viszont
aláírás nélkül is kész, és `02`-be megy. Ha DocGen-bélyeget kapna, egy
gyökérbe került példányát a Rendezés tévesen visszavinné `01`-be.

Ezért: **a NYT.52 kimenetén nincs `docgen` szó a metaadatban**, helyette a
Műhely saját bélyegét kapja (amit a Műhely az iktatáskor ír) — így az Áttekintő
átnevezés után is felismeri, és a helye (`02`) is benne van. A bélyeg formátuma
a Műhelyé (`stamp_keywords` a `pdf-muhely.py`-ban); a közös szerkezet leírása a
`TERV-mappaszerkezet.md`-be is bekerül.

---

## 4. A NYT.52 mezőtérképe — mi honnan jön

**Félkövér** = a felhasználónak kell döntenie (6. fejezet).

| rovat | forrás | fajta |
|---|---|---|
| Megrendeljük: külföldi munkavállalónk | mindig | X |
| … társas vállalkozó tagja | soha | — |
| EGT-ben már van egészségbiztosítása: igen / nem | **mindig „nem”?** | X |
| ingázó EU-s munkavállaló: igen / nem | **mindig „nem”?** | X |
| egyszerűsített foglalkoztatott: igen / nem | **mindig „nem”?** | X |
| Foglalkoztató neve | `EH_EMPLOYER.nev` (AUMOVIO Hungary Kft.) | szöveg |
| irányítószám · település | `szekhely.iranyitoszam` · `telepules` | 4 cella · szöveg |
| utca · házszám · emelet, ajtó | `kozteruletneve` + jelleg kisbetűvel · `hazszam` · `emelet`/`ajto` | szöveg |
| Adószám | `EH_EMPLOYER.adoszam` | szöveg |
| A TAJ-t igénylő vezetékneve | `surname` | szöveg |
| utónevei | `forename` | szöveg |
| Leánykori vezeték- és utóneve | **`surname_at_birth` · `forename_at_birth` — csak ha eltér?** | 2 cella |
| Anyja születési vezeték- és utóneve | `mothers_surname_at_birth` · `mothers_forename_at_birth` | 2 cella |
| Születési helye | **`place_of_birth_locality` vagy „ország, település”?** | szöveg |
| Születési ideje | `date_of_birth_year` / `_month` / `_day` | 4 + 2 + 2 cella |
| Állampolgársága | `citizenship_hun` (szótár) — ellenőrizni, hogy melléknévi alakot ad-e („vietnámi”) | szöveg |
| Neme | `Neme=male` → férfi, `Neme=female` → nő | X |
| Lakóhelye (5 rovat) | **?** | 4 cella + szöveg |
| Tartózkodási helye (5 rovat) | magyarországi szálláshely: `postal_code`, `locality`, `name_of_public_place` + `type_of_public_place`, `street_number`, `floor`/`door` | 4 cella + szöveg |
| Biztosítási jogviszony kezdete | `employment_start_year` / `_month` / `_day` | 4 + 2 + 2 cella |
| Kelt, (hely) | **állandó „Veszprém”?** | szöveg |
| Kelt, év · hó · nap | a generálás napja | szöveg |
| aláírás, P.H. | — (a felhasználó döntése: nem kell) | — |

---

## 5. Tesztterv

**Node (`test/form-pdf.test.js`, a meglévő `vm`-sandboxos mintán):**
- a mezőtérkép épsége: minden koordináta a lapon belül; a `cells` sorrendje
  növekvő; minden `tag` létező sémakulcsra old fel (`SchemaStore.resolveTag`)
  — elírt jelölő itt bukjon el, ne a kész iraton üresen;
- a cellás mezők hossza: `date_of_birth_year` 4 cella, irányítószám 4 cella;
- kitöltés kitalált dolgozóval (a `test/fixtures` tesztanyagából): nincs
  kivétel, az `empty` pontosan a hiányzó adatokat sorolja, a túl hosszú név
  `overflow`-ba kerül;
- rossz SHA-256 → hiba, nincs kimenet;
- a kimenet metaadatában nincs `docgen` (3.4), és van Műhely-bélyeg;
- méret: < 5 MB (várhatóan 0,7 MB alatt: 378 KB nyomtatvány + a teljes Carlito regular).

**Szemrevételezés (egyszer, és minden mezőtérkép-változáskor):** a kitöltött
PDF-et képpé rajzolva megnézni — a pdf-lib nem tud renderelni, a teszt a
helyet nem látja. A fejlesztőgépen a PDF Műhely PyMuPDF-je erre kéznél van
(`page.get_pixmap`).

**Böngészős e2e (`test/e2e-browser.js` bővítése):** sablonlistában megjelenik,
generálás után a fájl a dolgozó `02_Feltoltheto` mappájában van.

---

## 6. Nyitott kérdések — mielőtt kódolok

1. **Lakóhely vs. tartózkodási hely.** A nyilvántartásban a „Magyarországi
   szálláshely” (`lakcim`) és a korábbi, külföldi cím (`previous_*`, irányítószám
   nélkül) van. Javaslat: *Tartózkodási hely* = a magyar szálláshely,
   *Lakóhely* = **üres** (a 4 jegyű irányítószám-cellák magyar címre valók).
   Eddig hogyan töltöttétek?
2. **A három igen/nem kérdés:** mindig „nem” mindhárom? Vagy van EU-s dolgozó,
   akinél az első „igen” lehet? (Ha dolgozónként változik, új sémamező kell —
   a nyilvántartásban ma nincs ilyen adat.)
3. **Leánykori név:** csak akkor töltsük, ha a születési név eltér a mostanitól
   (különben üres)? Ez a javaslat.
4. **Születési hely:** csak a település („Hanoi”), vagy „Vietnám, Hanoi”, ahogy
   a `place_of_birth` számított mező adja?
5. **Kelt:** a hely mindig „Veszprém” (a székhely)? A dátum a generálás napja?
6. **Az Áttekintőben** kapjon-e oszlopot a TAJ-megrendelő (nem kötelező irat)?
   Ha igen, a Műhelyben egy új szabály kell (`DEFAULT_RULES`), ez kis módosítás
   a `pdf-muhely.py`-ban.

---

## 7. Fázisok

| fázis | tartalom | ellenőrzés |
|---|---|---|
| ~~F0~~ | a nyomtatvány vizsgálata, próbakitöltés | **kész** (0.1) |
| **F1** | `pdf-forms.js` (a NYT.52 mezőtérképe a rajzolatból) + `form-pdf.js` | Node-teszt zöld; szemrevételezett kép |
| **F2** | beillesztés: sablonlista, generálási ág, `DIR_UP`, hiánynapló | e2e: fájl a `02`-ben, helyes névvel |
| **F3** | Műhely-oldal: bélyeg-formátum dokumentálva; ha a 6. kérdésre igen, Áttekintő-szabály | a Műhely `run-all.py` zöld; az Áttekintő felismeri |

---

## 8. Amit szándékosan nem építünk

- **Általános PDF-szerkesztőt** (kattintásos mezőelhelyezés) — egy rögzített
  nyomtatványhoz felesleges. Ha egyszer több ilyen nyomtatvány lesz, a
  mezőtérkép-készítés akkor is egyszeri mérés; a vászonra csak akkor lesz
  szükség, ha a nyomtatványok rajzolata nem olvasható ki (szkennelt PDF).
- **A nyomtatvány beégetését a repóba:** a `*.pdf` a `.gitignore`-ban van, és ez
  jó így — a PDF a sablonmappában él, a hash a leírásban köti hozzá.
- **Aláírást, P.H.-t** — a felhasználó döntése.

---

## 9. Döntések (2026-10-05) — a 6. fejezet kérdéseire

| # | kérdés | döntés |
|---|---|---|
| 1 | lakóhely vs. tartózkodási hely | a magyarországi szálláshely a **Lakóhely** rovatba; a tartózkodási hely **üres** |
| 2 | a három igen/nem | mindhárom **„nem”** |
| 3 | leánykori név | **mindig** kitöltve: a születési név (mindig van adat) |
| 4 | születési hely | **„város, ország”** — a `place_of_birth` számított mező fordított sorrendű, ezért a két alapmező áll a térképen |
| 5 | kelt | **Budapest**, a generálás napja |
| 6 | Áttekintő-oszlop | **igen** — és a Műhelyben is legyen szerkesztő, hogy a kész PDF javítható legyen (`pdf-muhely/szerkeszto-terv.md` 15.) |

Amit én döntöttem el, mert a nyilvántartás így tárolja:
- *házszám* = `street_number` + `building` + `stairway` szóközzel („12 A II”),
  *emelet, ajtó* = `floor/door` („3/14”); az üres darab kimarad;
- a közterület jellege kisbetűvel („Házgyári út”, „Kossuth Lajos utca”) — az
  EH-cégadat nagybetűs alakja („Út”) a legördülő miatt az;
- az *állampolgárság* az, ami a nyilvántartásban áll (a szótáron át): ha ott
  „Szerbia” szerepel, az kerül ki, nem „szerb”.

## 10. Megvalósítás (2026-10-05)

| fájl | mi |
|---|---|
| `js/schema/pdf-forms.js` | a NYT.52 mezőtérképe: 36 mező, mért koordinátákkal, csak adat |
| `js/services/form-pdf.js` | `FormPdf.check` (SHA-256), `fill` (rajzolás, hiány, kilógás, Műhely-bélyeg) |
| `js/services/pdf-service.js` | `loadDocument`: meglévő PDF + Carlito (`subset: false`) |
| `js/services/fs-service.js` | `listDocxFilesDeep(dir, extra)`: a felsorolt PDF-ek is sablonok |
| `js/modules/docgen.js` | generálási ág, változat-ellenőrzés sablononként egyszer, `DIR_UP`, a PDF-lánc csak a `.docx`-ekre |
| `test/form-pdf.test.js` | 19 teszt; a `test/fixtures/NYT.52.K.pdf` az üres, nyilvános nyomtatvány |

**Mérve:** a kitöltött PDF ~635 KB (a nyomtatvány 378 KB + a teljes Carlito), a
kitöltés böngészőben ~110 ms. A betűkészlet lusta betöltése, a WebCrypto-hash, a
sablonmappa-bejárás és az írás a `02_Feltoltheto`-ba böngészőben is ki van próbálva
(http-ről, OPFS-mappán). A teljes felületi folyamat (mappaválasztó → Generálás)
automatán nem mérhető; az első éles generálásnál érdemes ránézni.

**Kimaradt, szándékosan:** a sablonlistában a PDF-sablon nem kap külön jelölést;
a fájlnév-minta dialógusa továbbra is „.docx”-et ír (a PDF-nél `.pdf` lesz belőle).

---

## 11. Általánosítás (2026-10-05, harmadik kör)

### 11.1 A kérés és a döntések

A felhasználó: *„nagyon specifikus lett … legyen a fejlesztés generális jellegű:
a pdf formátumú nyomtatványok kitöltését célozza a docgen, általános jellegű pdf
szerkesztés legyen a pdf-műhely fejlesztése. A NEAK nyomtatvány kitöltése kiváló,
ezt nem szabad elvetni.”* A nyitott kérdésekre adott válaszai:

| kérdés | döntés |
|---|---|
| hogyan írjuk le egy új PDF mezőit | **kitölthető PDF** (AcroForm): a mező neve a DocGen-jelölő |
| a Műhely szerkesztője | szöveg átírása · új szöveg és X · űrlapmezők · kitakarás (`pdf-muhely/szerkeszto-terv.md` 16.) |
| hova kerül a kimenet | **sablononként állítható**: alapból `01`, „aláírás nélkül kész” jelölővel `02` |

### 11.2 Miért kitölthető PDF, és miért rajzolunk mégis mi

A beégetett mezőtérkép (`pdf-forms.js`) nyomtatványonként kódot kért; a külön
JSON-leírást csak a Műhely ismerte volna. A kitölthető PDF **szabványos**: a
Műhely, az Acrobat vagy bármi elkészítheti, és a hatóságok eleve kitölthető
PDF-jei mezőátnevezéssel sablonok. A mezőnév = jelölő elv a Word-sablonokéval
azonos, így a sablonkészítőnek nem kell új nyelvet tanulnia.

A mezőket viszont **nem a pdf-lib tölti ki**: a beépített betűi WinAnsi-
kódolásúak (nincs ő/ű), és a mező megjelenését a nézők újrarajzolják. Ehelyett a
mező téglalapját olvassuk ki, oda rajzolunk a Carlitóval (a már bevált módon), és a
mezőket eltávolítjuk. A sablon változatát így nem kell hash-sel kötni: a mezők a
PDF-hez tartoznak, egy új NEAK-változathoz új sablon kell, rossz helyre írás nincs.

### 11.3 A mezőnevek (FormPdf)

| mezőnév | jelentés |
|---|---|
| `surname` | a jelölő értéke a Word-sablon feloldójával (`DocxService.makeParser`) |
| `{a}, {b}` | minta: több jelölő és szöveg; az üres darab elválasztója elmarad |
| `x#n` | az érték n. betűje — egyenetlen cellákhoz (a NYT.52 év-cellái 25/11/12/15 pt szélesek) |
| comb mező | egyenletes betűnkénti cellák (szabványos AcroForm) |
| jelölőnégyzet `Neme=male` / `Beszél magyarul` | a `{{CHECK:…}}` két alakja |
| választógomb-csoport `Neme` | a gomb értéke a várt érték |
| többsoros mező | tördelés, kicsinyítés 6 pt-ig |

A `makeParser` egy bővítést kapott, ami a Word-sablonoknak is jó: a nem sémabeli
dátum darabja (`{{mai nap_year}}`, `_év`, `_hó`, `_nap`) — eddig üres maradt.

### 11.4 Ami változott a 10. fejezethez képest

- **törölve:** `js/schema/pdf-forms.js` (a beégetett NYT.52-térkép) és a SHA-256-kötés;
- `js/services/form-pdf.js` újraírva: `check` (van-e mező), `fill`, `value`, `stampFor`;
- `docgen.js`: a sablonmappa minden `.pdf`-je sablon (PDF jelvénnyel); a helyi menüben
  „Aláírás nélkül kész (→ 02_Feltoltheto)” (`Settings: pdfSablonKesz`); a `02`-es
  kimenet a Műhely bélyegét, a `01`-es a DocGen-bélyeget kapja (3.4 továbbra is áll);
- `DocxService`: `docgenMark()` és `CHECKED` exportja (ugyanaz a bélyeg és jelölés);
- **a NYT.52 sablonként:** `pdf-sablonok/TAJ-megrendelő (NYT.52).pdf` — a Műhely
  szerkesztő-függvényeivel készült, kattintási pontokból (cellaillesztés): 37 mező,
  a cégadatok, a „Budapest” és a három „nem” fix szövegként. A `.gitignore` ezt a
  mappát kivételként engedi, így a repóval a használat helyére jut.

### 11.5 Ellenőrzés

- `test/form-pdf.test.js` (26): szintetikus sablon minden mezőfajtával (a teszt
  maga készíti pdf-lib-bel) + a valódi NYT.52-sablon körbe. A teljes Node-készlet zöld.
- **Böngészőben, a valódi felületen** (http, a mappaválasztó OPFS-mappára irányítva,
  egy kitalált dolgozóval): a sablonlista mutatja a PDF-sablont az almappából is; a
  jelölő kapcsolható; a generálás a jelölővel `02`-be (Műhely-bélyeg), nélküle `01`-be
  (DocGen-bélyeg) ír, mezők nélkül; a hiánypanel az üres rovatokat jelzi.
- Buktató a teszteléshez: a `?v=` csak commitkor lép, addig a böngésző a régi
  `js/`-t adhatja a gyorsítótárból.

### 11.6 Szándékos egyszerűsítések

- Elforgatott lapon a szöveg nem fordul a lappal (a hatósági nyomtatványok állók).
- A PDF-sablon irata nem kerül a PDF-láncba, így az összefűzésbe sem (`ponytail:` a kódban).
- A jelölő böngészőnként tárolódik (mint a fájlnév-minta); több gépen gépenként kell bekapcsolni.

---

## 12. A TAJ-igénylés másik két irata (2026-10-05, negyedik kör)

### 12.1 Mi kell még — forrással

Budapest Főváros Kormányhivatala foglalkoztatói tájékoztatója (*TÁJÉKOZTATÓ TAJ
szám igényléséhez foglalkoztatók részére*, 2019) szerint a kérelemhez kell:
foglalkoztató által kiállított **megrendelő** (NYT.52 — kész), **igénylőlap** a
TAJ-t igazoló hatósági igazolványhoz (NEAK **NYT.53**, A.3517-I. r. sz.), **a
foglalkoztatott meghatalmazása**, és másolatban: személyazonosításra alkalmas
igazolvány, tartózkodási hely / szálláshely igazolása, munkaszerződés. A másolatok
meglévő iratok; sablon a NYT.53-hoz és a meghatalmazáshoz kellett.

### 12.2 A felhasználó döntései

- A NYT.53-at a NEAK nyomtatványtárából töltöttük le (`NYT.53.K.pdf`, kézi
  kitöltésű változat; a gépi változat `.doc`).
- A meghatalmazás **PDF-sablon**, mint a NYT.52; a munkavállaló **a foglalkoztatót
  (céget)** hatalmazza meg.

### 12.3 Ami ebből lett

- **`TAJ-igénylőlap (NYT.53).pdf`** — 34 mező, a Műhely függvényeivel, kattintási
  pontokból. Fix: „első kiadás” X; az igényt előterjesztő a cég (név, székhely).
  Lakóhely = a szálláshely (mint a NYT.52-n), dátum = a „mai nap”. A nyomtatvány
  *„nyomtatott nagybetűkkel kell kitölteni”* — ezért **nagybetűs sablon** (12.4).
  Célmappa: `01` (az igénylő/meghatalmazott aláírja).
- **`TAJ-meghatalmazás.pdf`** — saját, egyoldalas, **kétnyelvű** (magyar, alatta
  angol): a dolgozó idegen nyelvű, értse, mit ír alá. Adatai mezők (név, születési
  hely és idő, anyja neve, állampolgárság, útlevélszám, szálláshely), a cég adatai
  fixek (teljes név, székhely, cégjegyzékszám 19-09-503741 — az `EH_EMPLOYER`
  forrásából, adószám). **Két tanú** neve, lakcíme és aláírása kézzel: így teljes
  bizonyító erejű magánokirat, ahogy a kormányhivatal kéri. A szöveg nem hatósági
  minta — jogásszal érdemes átnézetni. Célmappa: `01`.

### 12.4 Nagybetűs kitöltés — általánosan

Ha a sablon `/Keywords`-jében ott a `docgen-nagybetu`, a `FormPdf.fill` minden
értéket `toLocaleUpperCase('hu-HU')`-val ír (ő → Ő). Sablononként, nem mezőnként:
ahol a nyomtatvány nagybetűt kér, az egészre kéri. A Műhely Szerkesztés fülén egy
jelölő állítja (a többi kulcsszó megmarad).

### 12.5 Ellenőrzés

`test/form-pdf.test.js` 29 eset: a nagybetűsítés szintetikus sablonon, és mindkét új
sablon körbe (értékek, cellák, kilógás nélkül); a kitöltött lapok szemrevételezve.
A PDF Műhely Áttekintője mindkettőt külön oszlopként ismeri (`tajigeny`,
`tajmeghat`; a „taj meghatalmazas” kulcsszó nyer a sima „meghatalmazas” ellen).
