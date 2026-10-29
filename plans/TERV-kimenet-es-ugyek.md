# Új kimeneti mappaszerkezet, adatmappa, ügylista és az engedélyezés utáni teendők (terv)

*2026-10-29. A kiinduló állapot: `v10.87`, `node test/run-all.js` zöld.*
*Módszer: ponytail-audit a teljes repóra (1. fejezet), utána minden ponton a
„meglévőt használd, ne építs újat” szabály. A `ponytail:` jelölés a tudatos
egyszerűsítést jelzi; a kódban is így jelenik meg.*

## 0. Röviden

| Fázis | Tartalom | Kód |
|---|---|---|
| **F0** | Adatmappa áthelyezése a `08_DocGen\DocGen-main\data\` mappába, mentések helye, `plans/` mappa, `print.html` sorsa, config-mentés biztonsági másolata | szinte nincs (a költöztetés kézi) |
| **F1** | A `09_OIF_kerelmek` szerkezete: dolgozói mappa keresése (01/02), hónapmappák, `04_TAJ`, `03_Bejelentesek` | új `js/modules/docgen/celmappa.js`, a régi feloldás törlése |
| **F2** | Ügylista: „Tömeges” kapcsoló, ügytípus-szűrő, tartózkodási cél, új megnevezések, „Engedélyezve” | `cases-view.js`, `case-types.js`, `case-form.js` |
| **F3** | Lezárt ügy: a fölösleges határidők eltűnnek | `case-repo.js` (`timeline`), `case-timeline.js` |
| **F4** | Engedélyezés után: érvényesség sorozatszám nélkül, teendőlista, SAP-táblázat, új HR-mezők | `case-form.js`, `case-repo.js`, `case-xlsx.js`, `seed-schema.js` |

Az F2 és az F3 nem függ az F1-től, tetszőleges sorrendben jöhetnek. Az F4 az
F1-re épül (a SAP-táblázat a dolgozó mappájába kerül). Minden fázis külön
commit, zöld tesztekkel.

---

## 1. Ponytail-audit (a teljes repó, legnagyobb vágás elöl)

```
delete: böngészős „gyorsnézet nyomtatással”: print.html + openPrintSelectDialog/_openPrint + uint8ToBase64 + vendor/mammoth.browser.min.js (636 KB). Helyette semmi — a kód maga írja, hogy hivatalos iratra használhatatlan, a formahű PDF a Word-lánc. [print.html, js/modules/docgen.js:2329-2364, js/utils.js:107]
delete: SheetJS (vendor/xlsx.full.min.js, 882 KB) — az ExcelJS már be van töltve, és olvas is (workbook.xlsx.load). [js/services/xlsx-read.js, js/schema/schema-from-xlsx.js]
delete: a tömeges ügy saját kimenetimappa-választója, a „Külön mappa minden dolgozónak” kapcsoló és a kötegenként tárolt mappa — az F1 központi útvonal-szabálya kiváltja. [js/modules/cases/bulk-case.js:195-210, 340-366, 429, 530-550]
yagni: az ügytípusok címkéje, státuszai, határnapjai a docgen-config.json-ban is tárolódnak, holott szerkesztőjük nincs (csak a sablon-hozzárendelést szerkeszti felület). Ezek jöjjenek a seedből, a configban csak a `templates` maradjon. [js/schema/case-types.js normalize()]
delete: looksLikeWorkFolder (a PDF Műhely munkamappájára szabott heurisztika) — helyette: „létezik-e a 01_Hosszabbitasok / 02_Kiadasok / 03_Bejelentesek”. [js/services/fs-service.js:170-196, js/modules/docgen.js ~1430-1450]
stdlib: öt ékezetlevágó (FsService.foldName + HU_MAP, Auth.fold, CaseRepo.normText, EmployeeRepo.normText, ValueCodec) → egy fold() a utils.js-ben: s.normalize('NFD').replace(/\p{M}/gu, ''). Nem csak a magyar ékezetet veszi le (ş, č, ă, ễ is) — harmadik országbeli neveknél ez a helyes. [js/services/fs-service.js:135, js/services/auth-service.js:64, ...]
shrink: nyolc kézzel írt napkülönbség-számítás (86400000) → egy napKulonbseg(a, b) a utils.js-ben. [js/services/case-repo.js, js/modules/cases/case-timeline.js, ...]
delete: kettős export-nevek (_x és x ugyanarra: DocgenMerge 5, DocgenMissingLog 3, SchemaStore 3, EmployeeRepo 2, EmployeeHistory, RegistryModule 2, CaseRepo _validate, CaseTypes SEED/SEED_CASE_TYPES). Egy név marad, a tesztek átírva.
shrink: _findFileRecursive a docgen.js-ben a FsService._scanRecursive másodpéldánya; a state.allTemplates már tudja a sablon almappáját → közvetlen olvasás. [js/modules/docgen.js:2365-2377]
shrink: három felhasználó-előtagos kulcsképző (FsService.userKey, docgen _userPref, Settings.userKey) → Settings.getUser/setUser. [js/modules/docgen.js:295]
native: FileSaver.min.js → <a download> + URL.createObjectURL (a cases-view exportXlsx-e ezt már most is tartalékként leírja). [vendor/FileSaver.min.js, 6 hívó]
delete: EmployeeRepo.describeBackend (senki nem hívja), EmployeeRepo.removeIdentifier és TransferRepo.refreshRow (csak teszt hívja).
net: -~400 lines, -3 deps possible.
```

**Mi kerül ebből a jelen tervbe:** a bulk-case mappaválasztó törlése, a
`looksLikeWorkFolder` törlése és a `fold()` (F1 — a mappakeresés úgyis érinti),
a `CaseTypes` címkéinek seedből vétele (F2 — ez oldja meg a
„Szálláshelyváltozás” átnevezést az éles configban is), és a `print.html`
kérdése (F0, a felhasználó döntése). **A többi külön takarító kör**, nem keverjük
funkcióval: az SheetJS-csere aszinkronná teszi az xlsx-olvasást, az önálló kockázat.

Nem az audit tárgya, de a felmérés közben előjött és a tervet érinti:
- **A PDF-lánc a kimeneti mappa gyökerében keresi a fájlokat**, miközben a
  generálás 2026-09 óta dolgozói almappákba ír. Két helyen:
  - `tools/docx-pdf.vbs` `GyujtMunkat`: kísérőfájl esetén
    `fso.BuildPath(utvonal, nev)` — csak a gyökérben; az almappás DOCX-et
    „hiányzó”-nak számolja. (A `docgen.js` `generateFor` kommentje, hogy „a
    konvertáló szkript az almappákat is bejárja”, csak kísérőfájl NÉLKÜL igaz.)
  - `merge.js` `runFromOutputDir` → `readFromDir(outputDir, pdfNev)` — szintén
    csak a gyökér.

  Vagyis dolgozói mappás kimenetnél a „DOCX + PDF” valószínűleg már most sem
  készít PDF-et — a céges gépen ellenőrizendő. Az F1 javítja (3.4).
- **A `docgen-config.json` mentése nem készít biztonsági másolatot**, és ha a
  beolvasás elbukik, `{}`-ből indul, vagyis a többi szakaszt (séma, szótár,
  szintek, ügytípusok) **felülírja**. Az F0 javítja (2.2).
- A `docgen-accounts.json` nem szerepel a `hatterek()` listában, ezért a
  „Másik adatmappa” automatikus költöztetése nem viszi át a fiókokat. Ezért kézi
  a költöztetés (2.1).

---

## 2. F0 — Adatmappa, mentések, `plans/`, `print.html`

### 2.1 Az adatmappa helye: `08_DocGen\DocGen-main\data\`

**Javaslat:** nem közvetlenül a `DocGen-main` gyökere, hanem a `data\` almappája.
Három ok, mind a meglévő kódból:
1. A frissítő (`tools/frissit.vbs`) a `data` mappát **védett** mappaként
   kezeli (`VEDETT = Array("data", ...)`) — oda soha nem ír.
2. A `.gitignore` első szabálya a `data/` — ha valaha git-klón lesz a céges
   gépen, a személyes adat akkor sem kerülhet commitba.
3. A kód és a dokumentáció már most így hivatkozik rá (`data/docgen-config.json`).

A gyökérbe tett JSON-ok is működnének (a frissítő sosem töröl, és a ZIP-ben nincs
ilyen fájl), de ott az alkalmazás fájljai közé keverednének.

**A mentések helye: `DocGen-main\data\backup\` — kódváltozás nélkül.** A mentés
mindig az adatmappa `backup` almappájába kerül (fájlonként a legutóbbi 20). Külön
mentési mappát **nem** javaslok: `file://`-ről a böngésző minden indításkor
elveszi a mappaengedélyt, egy második mappa naponta egy második engedélykérést
jelentene. A lemezhiba és a véletlen törlés ellen a `Z:` meghajtó saját
(szerveroldali) mentése véd — érdemes megkérdezni az IT-t, van-e rajta
árnyékmásolat / napi mentés.

**A költöztetés lépései (kézi, kód nélkül):**
1. A DocGen bezárása minden gépen.
2. Intéző: a `09_OIF_kerelmek` gyökeréből a `DocGen-main\data\` mappába
   **másolás**: `docgen-accounts.json`, `docgen-cases.json`, `docgen-config.json`,
   `docgen-employees.json`, `docgen-transfers.json`, a `backup\` és (ha van) az
   `allapot\` mappa.
3. DocGen → Nyilvántartás → **Másik adatmappa** → `DocGen-main\data`. A cél nem
   üres, ezért az app nem költöztet és nem ír felül (az `atkoltoztet` csak üres
   célba ír) — egyszerűen betölti.
4. Ellenőrzés: belépés működik, a dolgozók és az ügyek száma egyezik.
5. Minden további gépen / böngészőprofilban a 3. lépés (a mappa profilonként
   tárolódik).
6. Csak ezután: a régi JSON-ok és a `backup\` törlése a `09_OIF_kerelmek`-ből.

**Utána a kimeneti mappa:** Dokumentumok fül → kimeneti mappa = `09_OIF_kerelmek`
(ez az F1 gyökere).

### 2.2 A config-mentés biztonsági másolata (adatvesztés ellen)

`registry-view.js` `makeConfigBackend.save`:
- ha a beolvasás nem „nincs ilyen fájl” hibával bukik el → **dob**, nem `{}`-ből
  ír tovább;
- írás előtt az előző tartalom `backup\<időbélyeg>-docgen-config.json` néven
  félrekerül, ugyanúgy 20-ra vágva.

Ehhez a `createFileBackend` mentés-előtti három sora (másolat + `pruneBackups`)
kikerül egy `FsService.mentesElotte(dir, filename, keep = 20)` függvénybe, és
mindkét háttér azt hívja. Új logika nincs, csak a meglévő kap második hívót. ~15 sor.

### 2.3 `plans/` mappa — **elkészült ebben a menetben**

A 11 `TERV*.md` `git mv`-vel a `plans/` mappába került, a `CLAUDE.md` és a
`README.md` hivatkozásai átírva. A kódkommentek a fájlnevet említik („lásd
`TERV-mappaszerkezet.md` 2.g”), azok így is egyértelműek, nem írjuk át őket.
Más telepítésben a frissítő **nem törli** a gyökérben maradt régi `TERV*.md`-ket
(sosem töröl) — ott kézzel kell, ahogy a céges gépen már megtörtént.

### 2.4 `print.html` → `tools/`?

Áthelyezhető: négy hivatkozás változik (`docgen.js` `window.open('tools/print.html')`,
a lapban `../vendor/mammoth…`, `tools/verzio.js` `LAPOK`, `test/verzio.test.js`).

**Javaslat viszont: törlés.** A „Gyorsnézet nyomtatással (nem formahű)” gomb
mögötti út; a kód maga írja, hogy hivatalos iratra használhatatlan, és a
formahű PDF-et a Word-lánc adja. Vele megy a 636 KB-os `mammoth`, az
`openPrintSelectDialog`, az `_openPrint` és az `uint8ToBase64` (~150 sor).
→ **Döntés: törlés** (9. fejezet, 2.).

---

## 3. F1 — A `09_OIF_kerelmek` szerkezete

### 3.1 A szabály

A kimeneti mappa (gyökér) a `09_OIF_kerelmek`. Dolgozói mappa:
`01_Hosszabbitasok\<ÉÉÉÉ.HH>\<Vezetéknév Keresztnév>\` **vagy**
`02_Kiadasok\<Vezetéknév Keresztnév>\`, alatta mindig `01_Elokeszitett`,
`02_Feltoltheto`, `03_Beerkezett`, `04_TAJ`.

| Irat | Hova kerül |
|---|---|
| Kérelem irata (minden sablon, amire az alábbiak nem illenek) | `<dolgozói mappa>\01_Elokeszitett` (az aláírás nélkül kész PDF-nyomtatvány `02_Feltoltheto` — ahogy ma) |
| TAJ-sablon (a név `TAJ-` kezdetű: igénylőlap, meghatalmazás, megrendelő) | `<dolgozói mappa>\04_TAJ` |
| A **Munkaviszony megszűnésének bejelentése** ügytípushoz rendelt sablon (pl. `Munkavállalói nyilatkozat foglalkoztatóváltásról.docx`) | `03_Bejelentesek\01_Munkaviszony_megszunes\` — közvetlenül, a meglévő fájlnév-szabállyal |
| A **Szálláshelyváltozás bejelentése** ügytípushoz rendelt sablon | `03_Bejelentesek\02_Szallashelyvaltozasok\<ÉÉÉÉ.HH>\` — közvetlenül |
| SAP-táblázat (F4) | `<dolgozói mappa>\01_Elokeszitett` |
| `03_Beerkezett`, `00_Altalanos_dokumentumok` | a DocGen nem ír beléjük |

**A bejelentés-sablonok felismerése a meglévő Ügytípus-sablonok hozzárendelésből
jön** (Ügyek → Áttekintés → „Ügytípus-sablonok…”) — új beállítás nincs, de a két
bejelentés-típushoz egyszer hozzá kell rendelni a sablonjaikat. A TAJ-szabály
fájlnév-előtag (`ponytail:` ha egyszer TAJ-ügytípus lesz, a hozzárendelés veszi át).

### 3.2 A dolgozó megtalálása — index nélkül

Minden generáláskor (munkamenetre megjegyezve, mint ma) a program bejárja:
`01_Hosszabbitasok\*\*` és `02_Kiadasok\*`. Ez egy hónapmappa-listázás plusz
hónaponként egy — néhányszor tíz könyvtárlistázás.

**Indexet nem építünk:** a mappák kézzel mozognak (a lezárt ügy átkerül a
személyi anyagba, az üres hónapmappát törlöd), egy tárolt index épp ezektől
avulna el, és onnantól rossz helyre mutatna. A bejárás mindig a valós állapotot
látja. (Ha élesben a hálózati meghajtón lassú, az mérés után jöhet.)

**Egyezés:** `fold(mappanév) === fold(vezetéknév + ' ' + keresztnév)` —
ékezet-, kisbetű- és szóközfüggetlen, **csak pontos egyezés**. A mai
`matchWorkerDir` „egyetlen részegyezés” ága megszűnik: a tisztított neveknél nem
kell, és veszélyes (`Ali` ⊂ `Ali Khan`).

| Találat | Mit tesz |
|---|---|
| 1 | oda ír |
| több (két hónapmappában, vagy 01-ben és 02-ben is) | megkérdezi, melyik — és jelzi, hogy ennek nem szabadna előfordulnia |
| 0 | **létrehozza** a dolgozó nyitott ügye alapján (3.3) |

### 3.3 Új dolgozói mappa

- nyitott **meghosszabbítási** ügy → `01_Hosszabbitasok\<a jelenlegi engedély
  lejáratának hónapja, ÉÉÉÉ.HH>\<Név>`; ha a hónapmappa nincs meg, létrehozza;
- nyitott **kiadási** ügy → `02_Kiadasok\<Név>`;
- egyéb eset (nincs ilyen ügy, nincs lejárat) → kérdez: „Hosszabbítás
  (<hónap>)” / „Kiadás” / „Mégse” — a mai párbeszéd átírva.

Létrehozáskor mind a négy almappa elkészül. A név: `vezetéknév keresztnév`, a
fájlnévben tiltott karakterek nélkül, egy szóközzel (a meglévő `fileSafe`).

**A felső szintű mappákat (`01_Hosszabbitasok`, `02_Kiadasok`, `03_Bejelentesek`
és a két almappája) a program soha nem hozza létre.** Ha hiányoznak, a generálás
megáll: „A kimeneti mappa nem a 09_OIF_kerelmek? Hiányzik: …”. Ez kiváltja a
`looksLikeWorkFolder` heurisztikát, és nem engedi, hogy egy rosszul választott
mappában új szerkezet nőjön.

### 3.4 Kód

- **Új `js/modules/docgen/celmappa.js`** (`DocgenCelmappa`), a többi
  `docgen/` almodul mintájára:
  - tiszta, Node-ban tesztelhető: `szabaly(sablonNev, tipusSablonok)`,
    `ujDolgozoUt({ ugyTipus, lejarat, nev })`, `honap(iso)`;
  - fájlrendszer: `dolgozoMappak(root)`, `cel(root, emp, sablonNev, kesz)` →
    mappa-handle (bizonytalanságnál a párbeszéd).
  - A mappanevek itt, egy helyen: a `DIR_PREP`/`DIR_UP` is ide költözik.
- `docgen.js`: a `resolveWorkerTarget`, `_prepDirIn`, `askWorkerDir`
  (~80 sor) helyére a `DocgenCelmappa.cel`; a `saveDocs` a dolgozó azonosítóját
  és a sablon nevét is megkapja (a `renderDocs` már tudja). A `generateFor`
  `perWorker` paramétere megszűnik — mindig a szabály dönt.
- `bulk-case.js`: a saját mappaválasztó, a `perWorker` kapcsoló és a
  `mappaKulcs`/`mappaMent`/`mappaVissza` törlése (~70 sor); a Dokumentumok fül
  kimeneti mappáját használja (`DocgenModule.requestOutputDir()`, a meglévő
  `requestTemplatesDir` mintájára — engedélykérés egy kattintásból).
- `fs-service.js`: `looksLikeWorkFolder`, `matchWorkerDir`, `foldName` + `HU_MAP`
  törlése; `fold()` a `utils.js`-be, az `Auth.fold` is azt hívja.
- **PDF-lánc** (1. fejezet, a gyökérben keresés hibája): a
  `docgen-generalas.json` `docx` mezője a gyökérhez képesti **relatív utat**
  kapja, perjellel (`01_Hosszabbitasok/2026.11/John Doe/01_Elokeszitett/….docx`
  — a VBS-elemző nem kezel escape-elt visszapert, a perjel nem igényel
  escape-et). A `docx-pdf.vbs` `GyujtMunkat`-ja egy `Replace(nev, "/", "\")`-t
  kap (UTF-16 fájl, a `vbs-encoding.test.js` őrzi), az összefűzés a relatív úton
  olvas. A `docx-pdf.test.js` kap egy almappás esetet.
- A név-tisztításhoz a `DocxService` belső `fileSafe`-je exportálva lesz
  (nem írunk másodikat).

**Szálláshelyváltozás hónapmappája:** alapból a **generálás hónapja**
(`ponytail:` mindig ismert; a költözés napja dolgozónként más lehet egy kötegen
belül). Döntés: így marad (9. fejezet, 3.).

---

## 4. F2 — Ügylista (Ügyek → Ügyek)

### 4.1 „Tömeges” kapcsoló

Új gomb a szűrősorban: **Tömeges**. Bekapcsolva (alapállapot) a tömeges ügyek
látszanak, kikapcsolva kimaradnak. A meglévő szűrőkkel (Nyitott, Lejárt, …)
együtt hat. `state.tomegesLatszik`, egy sor a `szurtLista()`-ban.

### 4.2 Ügytípus-szűrő (többválasztós legördülő)

Natív `<details>` + jelölőnégyzetek, könyvtár nélkül: összecsukva
„Ügytípus: mind” / „Ügytípus: 2 kiválasztva”, nyitva a típusok listája
(`CaseTypes.all()`). Üres választás = mind. `state.tipusok` (Set), egy sor a
szűrésben. A választás nem mentődik (a többi szűrő sem).

### 4.3 Megnevezések

- `Szálláshely-változás bejelentése` → **`Szálláshelyváltozás bejelentése`**
  (a seedben, a `bulk-case.js` `TIPUSOK`-ban, a README-ben és a két tervben;
  a SESSIONS.md régi bejegyzéseit nem írjuk át).
- `Tartózkodási engedély – első kérelem` → **`Tartózkodási engedély kiadása`**
  (a kulcs, `rp_elso`, marad).
- **Az éles configban tárolt régi címkék:** a `CaseTypes.normalize` a seedben
  ismert típusoknál a seed címkéjét (és státuszait, határnapjait) veszi, a
  configból csak a `templates`-t (1. fejezet, `yagni`). Így minden gépen
  átíródik, migráció nélkül, és a jövőbeli átnevezés is egy sor lesz.

### 4.4 Tartózkodási cél az ügyön

Kiadási és meghosszabbítási ügynél **kötelező** megadni (új ügy felvételekor):

| Kulcs | Megnevezés |
|---|---|
| `vendegmunkas` | Vendégmunkás-tartózkodási engedély |
| `nemzeti_kartya` | Nemzeti Kártya |
| `eu_kek_kartya` | EU Kék Kártya |
| `csaladi` | Családi együttélés biztosítása céljából kiadott tartózkodási engedély |

- `case-types.js`: `CASE_PURPOSES` (fenti négy) + `CaseTypes.title(c)`:
  van cél → `<cél> meghosszabbítása` / `<cél> kiadása`, nincs → a típus címkéje.
  `ponytail:` a „melyik típus kér célt” két kulccsal (`rp_elso`,
  `rp_hosszabbitas`) van megadva, nem típus-tulajdonsággal.
- `case-repo.js`: új mező `purpose` (migráció: `null`); az `openNextCase` (a
  következő hosszabbítás előjegyzése) átveszi az előző ügyét.
- `case-form.js`: legördülő a típus alatt, csak ennél a két típusnál; új ügynél
  kötelező, a régi (cél nélküli) ügy szerkesztésekor pótolható.
- Ahol eddig `CaseTypes.label(c.type)` állt egy **ügyre**, ott `CaseTypes.title(c)`:
  lista, részletező fejléc, idővonal fejléc, ügytörlés-megerősítés, Áttekintés
  sorai, ügykimutatás xlsx. A típus-szűrő és a köteglista típust mutat, az marad.

Eredmény a „Név és ügytípus” oszlopban:
```
John Doe
Vendégmunkás-tartózkodási engedély meghosszabbítása
```

### 4.5 Állapot oszlop: a kimenetel, nem a „Lezárva”

- A `megadva` kimenetel címkéje **`Megadva` → `Engedélyezve`** mindenhol (a
  kulcs marad `megadva`, tehát adatmigráció nincs; a felületen és a doksiban
  átírva).
- Új `CaseRepo.allapotSzoveg(c)`: lezárt **kérelemnél** a kimenetel
  (`Engedélyezve`, `Elutasítva`, …), minden más esetben a státusz. Lezárt
  **bejelentésnél** marad a `Tudomásul véve` — ott a kimenetel nem mond többet,
  és az „Engedélyezve” egy szálláshely-bejelentésen félrevezető volna.
- A **Lezárt szűrő nem változik**: minden kimenetelt mutat.

---

## 5. F3 — Lezárt ügy megjelenítése

Ami a példában fölösleges: a „Lezárva” kétszer a fejlécben, a „Lezárva · lezárva:
Megadva”, a benyújtási/beadás utáni sáv, az ügyintézési határidő, és „a
jelenlegi engedély lejár” (ami ráadásul már az ÚJ engedély lejárata).

- `case-repo.js` `timeline()`: lezárt ügynél **nincs** benyújtási pont, nincs
  „ügyintézési határidő”, nincs „ma”. A lezáró esemény címkéje a kimenetel
  (`Engedélyezve`), nem a `Lezárva` + félkövér kimenetel.
- `case-timeline.js` `render()`: lezárt ügynél nincs sáv; a fejléc:
  `Engedélyezve · új engedély: 2027. 12. 01.-ig · iktatószám: … · EH: …`.
- `cases-view.js` részletező alcím: `allapotSzoveg(c)`, és a `deadlineText`
  csak nyitott ügynél (innen jött a második „Lezárva”).

A példa ügy így:
```
John Doe
Vendégmunkás-tartózkodási engedély meghosszabbítása · Engedélyezve · EH19723XXX · ikt. 106-3-XXX40/2026-T

Vendégmunkás-tartózkodási engedély meghosszabbítása
Engedélyezve · új engedély: 2027. 12. 01.-ig · iktatószám: 106-3-XXX40/2026-T · EH: EH19723XXX

Teendők (1/5 kész)                                   ← F4
  ☑ Munkaviszony-bejelentés beküldve        határidő 2026. 11. 01.  · kész 10. 28.
  ☐ SAP-ticket leadva                       [SAP-táblázat]
  ☐ Okmány megérkezett, sorozatszám rögzítve [Sorozatszám rögzítése]
  ☐ Másolat a digitális és a fizikai személyi anyagban
  ☐ TAJ-hosszabbítás intézve

● Előkészítés     2026. 09. 07.
● Beadva          2026. 09. 29.
● Elbírálás alatt 2026. 10. 05.  iktatószám: … · Horváth Dániel
● Engedélyezve    2026. 10. 27.  érvényes 2027. 12. 01.-ig · utólag rögzítve: 2026. 10. 28.
```

---

## 6. F4 — Az engedélyezés után

### 6.1 Érvényesség a döntéskor, sorozatszám az okmánnyal

Ma a lezárás után azonnal felugrik az „Új azonosító rögzítése”, ahol a
**sorozatszám kötelező**, és csak vele együtt adható meg a lejárat.

Új menet:
1. **Lezárás „Engedélyezve” kimenetellel** (`openStatus`): új, kötelező mező
   **„Engedély érvényes (a határozat szerint)”** — csak azonosítót hozó típusnál
   (`producesIdentifier`). → `c.validUntil`, és ugyanekkor a dolgozó
   `expiration_of_rp` mezője (eddig a sorozatszámmal együtt íródott; ebből számol
   a következő hosszabbítás ablaka és az F1 hónapmappája).
2. Utána **tájékoztató párbeszéd** a régi azonosító-kérés helyett: „Engedélyezve.
   A munkaviszony megkezdését <döntés + 5 nap>-ig be kell jelenteni. A teendők
   az ügy idővonalán.” — majd a meglévő „Következő meghosszabbítás előjegyzése”
   (`ajanljKovetkezot`), most már a `validUntil`-ból.
3. **Sorozatszám, amikor az okmány megjön:** a teendőlista gombja nyitja a
   meglévő „Új azonosító rögzítése” párbeszédet, a lejárat előtöltve a
   `validUntil`-ból. Ha a kártyán más dátum áll, a beírt érték nyer, és a
   párbeszéd kiírja az eltérést („a határozat szerint: …”) — ez az
   „érvényességi idő ellenőrzése”.
- Elgépelés javítása: a `validUntil` az „Adatok szerkesztése” párbeszédben is
  szerkeszthető engedélyezett ügynél.

### 6.2 Teendőlista

Csak **engedélyezett kérelemnél**, az idővonal tetején (5. fejezet, minta).
Fix lista a kódban (`ponytail:` nem szerkeszthető; ha eljárás változik, egy tömb):

| Kulcs | Teendő | Kész, ha |
|---|---|---|
| `bejelentes` | Munkaviszony megkezdésének bejelentése beküldve — **határidő: döntés + 5 nap** | kipipálva |
| `sap` | SAP-ticket leadva a back office-nak — gomb: **SAP-táblázat** | kipipálva |
| `okmany` | Okmány megérkezett, sorozatszám rögzítve — gomb: **Sorozatszám rögzítése** | van rögzített azonosító (`producedId`) |
| `masolat` | Másolat a digitális és a fizikai személyi anyagban | kipipálva |
| `taj` | TAJ-hosszabbítás intézve (tipp: a TAJ-sablonok a dolgozó `04_TAJ` mappájába generálódnak) | kipipálva |

- Tárolás: `c.teendok = { bejelentes: '2026-10-28', … }` (kész-dátum vagy hiány);
  `CaseRepo.setTeendo(id, kulcs, kesz)`; minden pipálás idővonal-bejegyzést is
  ír (ki, mikor — az audit-nyom a meglévő minta).
- **Láthatóság a listán:** az Állapot cellában `Engedélyezve · 4 teendő`;
  pirosan, ha a bejelentés határideje lejárt. Új szűrőgomb: **Teendő** — csak
  akkor látszik, ha van nyitott teendős ügy (mint a mai állapot-chipek).
- A lezárás tényét és a „Lezárt” szűrőt ez nem érinti.

### 6.3 SAP-táblázat (xlsx a back office ticketjéhez)

A teendőlista „SAP-táblázat” gombja: kis párbeszéd két dátummal (**Kilépés**,
**Új belépés** — ezeket a program nem tudhatja), utána xlsx a dolgozó
`01_Elokeszitett` mappájába (F1), mappa nélkül letöltés.

| Oszlop | Forrás |
|---|---|
| Régi TSz | `personnel_reg_number` (Személyügyi törzsszám) |
| Név | vezetéknév keresztnév |
| Új TSZ | mindig üres |
| Kilépés | a párbeszédből — előtöltve: a döntés napja |
| Új belépés | a párbeszédből — előtöltve: a döntés másnapja |
| Időrögzítési ügyintéző | **új mező** `hr_time_admin` |
| Felettes | a meglévő `hr_direct_leader` („Közvetlen vezető”, 9. fejezet 5.) |
| K2 | **új mező** `hr_k2` |
| Új határozott idő lejárta | `c.validUntil` (a határozatból) |
| Dokumentum jellege | mindig: Határozat |
| Dokumentum száma | az ügy iktatószáma |
| Dokumentum dátuma | a döntés napja (`closedAt`) |

- **A minta** (`Ticket_SAP_TR.xlsx`, a felhasználótól): egy lap (`Munka1`), az
  1. sor a fejléc (szürke kitöltés, keret), alatta soronként egy dolgozó,
  középre zárt, keretezett cellák; a dátumok valódi dátumcellák a beépített
  rövid dátumformátummal (14-es formátumkód — a magyar Excel `2026. 10. 27.`
  alakban mutatja). A mintában a Kilépés = a döntés napja, az Új belépés = a
  másnap; ezért az előtöltés. A fejlécekből a záró szóközt elhagyjuk
  (`Felettes `, `Dokumentum dátuma `, `Határozat ` a mintában).
- Kód: `CaseXlsx.sap(c, { kilepes, belepes })` a meglévő `case-xlsx.js`-ben
  (ExcelJS már be van töltve), a minta oszlopszélességeivel.
- Fájlnév a dokumentumtípus-elöl szabállyal: `SAP-ticket — John Doe.xlsx`.
- A két új mező (`hr_time_admin` Időrögzítési ügyintéző, `hr_k2` K2) a seedbe kerül (`hr_belso` csoport, „Csak HR tölti”); a meglévő
  `addMissingSeedFields` minden gépen felveszi őket a configba, kódmigráció
  nélkül. Utána a Nyilvántartás tömeges szerkesztésével tölthetők.
- Hiányzó adatnál a táblázat elkészül, de a párbeszéd kiírja, mi üres.

### 6.4 TAJ-hosszabbítás

Új gomb nincs: a Dokumentumok fülön a három TAJ-sablon az F1 szabálya szerint
magától a `04_TAJ`-ba kerül; a teendő kipipálható. (`ponytail:` ha a teendőből
egy kattintással kellene generálni, a `generateFor` ezt egy hívással tudja.)

---

## 7. Ellenőrzés

**Node-tesztek** (minden fázis után `node test/run-all.js` zöld, csak úgy commit):
- új `test/celmappa.test.js`: `szabaly` (TAJ, két bejelentés-típus, alap,
  kész PDF), `ujDolgozoUt` (hosszabbítás hónapja a lejáratból, kiadás, ismeretlen),
  `honap`, a keresés a meglévő `fs-service.test.js` álmappáival (1 / több / 0
  találat, ékezetes és nagybetűs név, `Ali` ≠ `Ali Khan`), hiányzó felső mappa → hiba;
- `cases.test.js`: `title()` (cél + hosszabbítás/kiadás, cél nélkül), cél
  átöröklése az előjegyzésbe, `allapotSzoveg` (kérelem/bejelentés), lezárt ügy
  idővonalán nincs határidő/ablak, `validUntil` → `expiration_of_rp`,
  sorozatszám nélküli lezárás, `setTeendo` + bejegyzés;
- `case-types` normalize: régi config-címke → seed címke, `templates` megmarad;
- `case-xlsx.test.js`: a SAP-táblázat 12 fejléce sorrendben, dátumcellák, fix értékek;
- config-mentés: sikertelen olvasás nem írja felül a többi szakaszt, másolat készül.

**Böngészőben, a céges gépen** (a Node-teszt ezt nem fedi):
1. F0: költöztetés a 2.1 szerint; belépés, dolgozó- és ügyszám egyezik.
2. F1: generálás (a) hosszabbítós dolgozónak, akinek van mappája → a meglévő
   `01_Elokeszitett`; (b) akinek nincs → új `2026.MM\Név` négy almappával;
   (c) TAJ-sablon → `04_TAJ`; (d) szálláshely-köteg →
   `03_Bejelentesek\02_Szallashelyvaltozasok\2026.10`; (e) rossz kimeneti mappa
   → érthető hiba, semmi nem jön létre; (f) „DOCX + PDF” → a `PDF-keszites.vbs`
   dupla kattintásra az almappás DOCX-ekből is PDF-et készít, és az összefűzés
   megtalálja őket. **Előtte, a mostani verzióval:** megerősíteni, hogy ez ma
   valóban nem működik (1. fejezet).
3. F2–F4: a 4–6. fejezet képei, egy próbaügyön végigkattintva.

---

## 8. Amit szándékosan nem építünk

- **Mappaindex** — 3.2.
- **Külön mentési mappa** — napi plusz engedélykérés lenne (2.1).
- **Mind a 23 tartózkodási cél** — a négy jellemző; a lista egy tömb, bővíthető.
- **Szerkeszthető teendőlista, tömeges engedélyezés, több dolgozós SAP-táblázat**
  — ha élesben kell, a meglévő tömeges ügy mintájára.
- **A szűrők mentése** a munkamenetek között — a mostaniak sem mentődnek.
- **Ügytípus-szerkesztő** — a típusok kódból jönnek, csak a sablon-hozzárendelés adat.

## 9. Döntések (a felhasználó válaszai, 2026-10-29)

1. **Adatmappa:** `DocGen-main\data\` — a javaslat szerint.
2. **`print.html`:** törölhető, a mammoth-tal együtt.
3. **Szálláshelyváltozás hónapmappája:** `ÉÉÉÉ.HH`, a **generálás** hónapja szerint.
4. **Családi együttélés:** egyelőre a 4.4 szerinti megnevezés (nincs még ilyen kérelem).
5. **„Felettes” = a meglévő „Közvetlen vezető”** (`hr_direct_leader`) — új mező
   csak kettő kell: `hr_time_admin`, `hr_k2`.
6. **SAP-táblázat:** a csatolt `Ticket_SAP_TR.xlsx` alapján (6.3, „A minta”).
7. *Nem érkezett válasz* — munkahipotézis: **igen**, minden engedélyezés után
   (a SAP-sor „Kilépés / Új belépés” párja hosszabbításnál is új belépést jelent).
   Ha nem így van, a teendő egy feltétellel kihagyható a hosszabbításnál.
8. **PDF Műhely: igen, igazítani kell** — külön repó, saját terv (10. fejezet).
9. *Nem érkezett válasz* — alapállapot: a fül piros jelzése **nem** változik; a
   lejárt bejelentési határidő a lista Állapot cellájában és a „Teendő” szűrőnél
   látszik pirosan.
10. *Nem érkezett válasz* — alapállapot: az új mappa neve a nyilvántartásban
    tárolt `vezetéknév keresztnév`, csak a fájlnévben tiltott karakterek nélkül.

## 10. PDF Műhely

Külön repó (`pdf-muhely`), a terve ott: `kepek-pdf-terv.md` új fejezete. A DocGen
oldala ettől független: a DocGen nem olvassa a Műhely állapotát, csak ugyanabba a
szerkezetbe ír.
