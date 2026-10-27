# TERV — Tömeges ügyintézés (szálláshely-változás), ügytípus-sablonok, legutóbbi változások, hiánypótló szerkesztő

> Állapot: **megvalósítva, 2026-10-27** (a 10. fejezet a megvalósítás közbeni döntések). A kérés szövege és a döntések a 9. fejezetben.
> A meglévő tervek, amikre épül: `TERV-esemenyek.md` 4. (ügytípus `templates`
> mezője — eddig kihasználatlan), `TERV-mappaszerkezet.md` (dolgozói mappa +
> `01_Elokeszitett`), `TERV-fiokok.md` (jogosultságok).

## 1. A probléma

Ha egyszerre több dolgozó költözik ugyanarra a szálláshelyre, ma ez a kerülőút:
Nyilvántartás → kijelölés → export xlsx → Excelben a címet mindenkinél átírni →
import → Dokumentumok fül → személyek és sablonok kijelölése → generálás.
Hat lépés, két fájlművelet, és közben semmi nem rögzíti, hogy ez egy ügy volt.

Mellé három rokon hiány:

1. A sablonok nincsenek ügytípushoz kötve — a generálást minden alkalommal
   kézzel kell összeválogatni. (Az ügytípus `templates` mezője létezik, de üres,
   és nincs hozzá felület.)
2. Nem látszik, mi változott utoljára a nyilvántartásban — egy rossz import vagy
   elgépelés több száz dolgozó között nem kereshető vissza.
3. A hiányzó-adat naplóból nem lehet a hiányt javítani: a napló csak lista,
   a dolgozót a Nyilvántartásban kell megkeresni, és ott nem látszik, melyik
   mező hiányzott.

## 2. Döntések (a felhasználó válaszai alapján)

| Kérdés | Döntés |
|---|---|
| Hogyan jelenjen meg a tömeges ügy? | **Dolgozónként egy ügy + közös kötegazonosító** (`batchId`). Mindenki saját EH számot, státuszt kap; a listán „Tömeges” jelölés, a köteg egyben is megnyitható. |
| Hová kerül a sablon-hozzárendelés? | **Ügyek → Áttekintés** nézet gombja; a tömeges modul generálási lépéséből is elérhető. |
| Külön mappa dolgozónként? | **`<Név>\01_Elokeszitett`** — ugyanaz a logika, mint a Dokumentumok fülön (meglévő dolgozói mappát keres, ha nincs, létrehoz). Alapból **ki**: minden fájl a választott mappa gyökerébe. |
| Utolsó módosítások | **„Legutóbbi változások” lap** a Nyilvántartásban, minden dolgozó naplója időrendben. |

## 3. Architektúra — mi épül újra, mi a meglévő

**Nincs új adatfájl és nincs új tároló.** Minden a meglévő rétegekre ül:

| Igény | Meglévő, amit használunk | Új |
|---|---|---|
| Cím átírása | `EmployeeRepo.update(..., { source: 'tomeges' })` — ugyanaz az út, mint az import: napló (`history`), validáció, mentés | a mezők a séma `lakcim` csoportjából épülnek (nincs bedrótozott mező) |
| Dolgozóválasztás | `ClientPicker.open` (ugyanaz, mint a Dokumentumok fülön) | — |
| Ügy | `CaseRepo.create` dolgozónként | `batchId` mező az ügyön (migráció: `null`) |
| Sablon ↔ ügytípus | `CaseTypes` `templates` mező + `CaseTypes.save()` (docgen-config.json) | párbeszéd az Áttekintésen |
| Generálás | `DocgenModule` motorja (sablonkeresés, jelölőfeloldás, PDF-sablon, névminta, hiánynapló, PDF-lánc) | a `runGenerate` magja kiemelve két belső függvénybe, és kívülről hívható `generateFor` |
| Legutóbbi változások | `emp.history[]` (`at`, `user`, `source`, `action`, `changes`) + `EmployeeHistory` címkéi | gyűjtő nézet minden dolgozóra |
| Hiánypótló szerkesztő | `EmployeeForm.open` | `hianyzo` mód: kiemelés, „csak a hiányzók” szűrő; csak a naplóból hívható |

## 4. Részletes terv

### 4.1 Új ügy → két út (cases-view.js)

Az „Új ügy” gomb (Ügyek és Dolgozók nézet) eddig egyenesen a `CaseForm.open`-t
hívta. Ehelyett egy választó nyílik két csempével:

- **A) Egy dolgozó ügyintézése** — kis csempe → a mostani `CaseForm.open`, változatlanul.
- **B) Tömeges ügyintézés** — nagy, kiemelt csempe → a tömeges modul.

A dolgozósoron lévő „Ügy nyitása” (Dolgozók nézet) marad közvetlen: ott a dolgozó
már adott.

### 4.2 Tömeges modul (új: `js/modules/cases/bulk-case.js`)

Teljes szélességű oldal az Ügyek fülön (mint a részletező). Amíg nyitva van, a
cases-view nem rajzol újra (az `onChange`-ek nem tüntetik el a félig kitöltött
lépést). Lépései egy oldalon, egymás alatt, a még nem elérhető lépés halvány:

1. **Ügytípus** — legördülő. A tömeges típusok listája KÓDBAN van (mert mindegyikhez
   más mezőcsoport és más logika tartozik), egyelőre egy elem:
   `{ key: 'szallashely', caseType: 'szallashely_valtozas', group: 'lakcim' }`.
   A mezők viszont a sémából jönnek: ha a `lakcim` csoport bővül, a modul is.
2. **Dolgozók** — `ClientPicker.open`, ugyanazokkal az oszlopokkal, mint a
   Dokumentumok fülön (azonosító, EH szám, iktatószám is szűrhető). A választás
   után a nevek listája látszik, „Módosítás” gombbal újranyitható.
3. **Új szálláshely** — a `lakcim` csoport mezői az `EmployeeForm`-mal azonos
   megjelenítéssel (szöveg / enum-legördülő / dátum), + **Költözés napja** (ebből
   jön az ügy határideje, `triggerDate`). Ellenőrzés: `SchemaStore.validateValues`
   a dolgozó meglévő mezőivel összefésülve — ugyanaz a szabály, mint az űrlapon.
4. **Összesítő és jóváhagyás** — párbeszéd: dolgozónként a régi → új cím
   (a számított `address` mező mindkét állapotra), a kiürülő mezők külön jelölve
   (pl. „Emelet: 3 → (törlődik)”), és ha valakinek már van nyitott
   szálláshely-változás ügye, figyelmeztetés. „Jóváhagyom és rögzítem” gomb.
5. **Rögzítés** (a jóváhagyás után, egy lépésben):
   - `EmployeeRepo.update(id, { fields: újCím, source: 'tomeges' })` mindenkire;
   - `CaseRepo.create({ employeeId, type, triggerDate, batchId, note })` mindenkire
     — ez a „háttérben nyíló ügy”;
   - `await EmployeeRepo.flush()` + `await CaseRepo.flush()`, majd
     **visszaolvasás a tárolóból** (`EmployeeRepo.readBack`) és mezőnkénti
     összevetés. Eredmény: „✓ 12 dolgozó adata mentve és visszaolvasva” vagy a
     hibás nevek listája.
6. **Dokumentumok generálása** (csak a rögzítés után jelenik meg):
   - sablonlista: a sablonmappa sablonjai, az ügytípushoz rendeltek előre
     bejelölve; „Sablonok hozzárendelése…” link (4.3);
   - **Kimeneti mappa: Tallózás…** (`showDirectoryPicker`, saját `id`-vel, így a
     rendszerablak a legutóbbi helyen nyílik);
   - **„Külön mappa minden dolgozónak”** kapcsoló — alapból KI → minden fájl a
     választott mappába; BE → `<Név>\01_Elokeszitett` (meglévő mappa keresése a
     Dokumentumok fül logikájával);
   - „DOCX + PDF” és „Csak DOCX” gomb, haladásjelző, eredmény (hibák, hiányzó
     adatok → „Hiányzó adatok naplója” gomb).

**Köteg újranyitása:** a köteghez tartozó bármely ügy részletezőjében
„Tömeges ügy (12 dolgozó) — megnyitás” gomb → a modul a 6. lépésnél nyílik a köteg
dolgozóival (a cím ekkor már a nyilvántartásban van). Az ügylistán a köteg ügyei
„Tömeges” címkét kapnak.

### 4.3 Sablonok hozzárendelése ügytípushoz (Ügyek → Áttekintés)

Gomb az Áttekintés tetején: **„Ügytípus-sablonok”** → párbeszéd:
ügytípus-legördülő + a sablonmappa sablonjai jelölőnégyzettel (kereső szűrővel).
Mentés: `CaseTypes.byKey(t).templates = [...]` → `CaseTypes.save()`.
Ami hozzá van rendelve, de most nincs a mappában, „nem található” jelzéssel
megmarad (nem vész el egy átmeneti mappahiba miatt).
Ha a sablonmappa nincs engedélyezve (indulásonként elvész), a párbeszéd gombbal
kéri vissza — ugyanazzal az úttal, mint a Dokumentumok fül bannere.
Jog: `cases.write`.

### 4.4 Generálómotor kiemelése (docgen.js)

A `runGenerate` (≈350 sor) ma egyben csinálja a renderelést, a mentést és a
Dokumentumok fül felületét. Kiemelés (kódmozgatás, viselkedésváltozás nélkül):

- `renderDocs(clients, templates, ui)` → `{ generated, errors, missingLogEntries, allEmptyTags }`
  — a dolgozó × sablon ciklus; a `ui` a haladásjelző hívásai.
- `saveDocs(generated, { docx, root, target })` → hibák — a mentési fázis;
  `target(clientName, cel)` dönti el a mappát.
- `runGenerate` ezekből áll össze, a felülete változatlan.
- Új export: `generateFor({ employeeIds, templates, outputDir, perWorker, docx, pdf, ui })`
  és `templateNames()`, `templatesReady()`, `requestTemplatesDir()`.
- A hiánynapló bejegyzése mostantól **`employeeId`-t** is kap (4.6-hoz kell).

### 4.5 Legutóbbi változások (Nyilvántartás)

Gomb a Nyilvántartás eszközsorán: **„Legutóbbi változások”** → párbeszéd:
az összes dolgozó `history` bejegyzése egy listában, legfrissebb elöl (a felvitel
is benne van, így „kik voltak az utolsók” közvetlenül látszik).
Oszlopok: időpont · dolgozó · művelet · forrás (űrlap / import / tömeges / ügy /
hiányzó-adat napló…) · ki · változás (mező: régi → új). Szűrő: forrás + névkeresés.
Sorra kattintva a dolgozó összesítője nyílik. Felső korlát: 500 sor (a rekordonkénti
napló amúgy is 200-ra korlátos).
Hely: `EmployeeHistory.openRecent()` — a címkéket (művelet, forrás, mezőnév,
dátum) a meglévő modul adja.

### 4.6 Hiánypótló szerkesztő (csak a hiányzó-adat naplóból)

- A napló minden sorában **„Javítás”** gomb. Dolgozó: az új bejegyzésnél
  `employeeId`; a régieknél név szerint, ha egyértelmű (különben a gomb tiltva,
  magyarázattal).
- A jelölők mezővé fordítása: `SchemaStore.resolveTag` → mező; számított mezőnél
  (pl. „Állandó lakcím”) a forrásmezői; ami nem a nyilvántartásból jön (EH szám,
  iktatószám, mai nap, ismeretlen jelölő), az külön, magyarázattal.
- `EmployeeForm.open({ id, hianyzo: { mezok, egyeb, sablon }, onSave, onCancel })`:
  felül sáv a hiányzó mezők listájával (kattintásra odaugrik), a mezők kiemelve,
  **„Csak a hiányzó mezők”** kapcsoló (a többi csoport elrejtve), az első
  hiányzóra fókusz. A `hianyzo` opciót KIZÁRÓLAG a napló adja át — más helyről
  ez a változat nem nyitható.
- Mentés → `EmployeeRepo.update(..., { source: 'hianynaplo' })` → `flush` →
  visszaolvasás + összevetés → a napló **újranyílik frissítve**: minden bejegyzés
  jelölői a dolgozó MOSTANI adataival újraértékelve (pótolt jelölő zöld,
  áthúzva; teljesen pótolt sor „✓ pótolva”). Mégse → vissza a naplóhoz.
  Ez a „mentettem, de nem látszik” élmény ellenszere: a napló eddig statikus
  lista volt, a javítás után is a régi hiányt mutatta.

## 5. Lépések és ellenőrzés

| # | Lépés | Ellenőrzés |
|---|---|---|
| 1 | `CaseRepo`: `batchId` (create + migrate) | `cases.test.js`: köteg-ügyek létrejönnek, régi ügy `batchId: null` |
| 2 | `EmployeeRepo.readBack(ids)` | `employee-repo.test.js`: update → flush → visszaolvasva egyezik |
| 3 | Tömeges logika tiszta függvényekben (`BulkCase.terv`, `BulkCase.rogzit`) | új `bulk-case.test.js`: régi→új terv, kiürülő mezők, validáció, rögzítés + ügyek + visszaolvasás |
| 4 | Jelölő → mező bontás (`DocgenMissingLog.mezokreBont`, újraértékelés) | új teszt: egyszerű, számított, dátumrész, nem sémabeli jelölő |
| 5 | Generálómotor kiemelése | böngészős próba (headless Chrome, eldobható): Dokumentumok generálás ugyanaz, mint előtte; tömeges generálás gyökérbe és dolgozói mappába |
| 6 | Felület: választó, modul, sablon-párbeszéd, legutóbbi változások, hiánypótló | headless Chrome próba módban; képernyőképek |
| 7 | `node test/run-all.js` zöld → SESSIONS.md bejegyzés → commit + push `main`-re | |

## 6. Amit szándékosan NEM csinálunk

- **Nincs „közös ügy” több dolgozóval** (döntés: dolgozónként egy ügy + köteg).
- **Nincs külön köteg-tároló** — a köteg az azonos `batchId`-jú ügyekből áll elő.
- **Nincs mezőnkénti „ne módosítsa” kapcsoló** a tömeges címben (lásd 7.).
- A tömeges kimeneti mappa handle-je nem tárolódik; a rendszer-mappaválasztó
  `id`-je viszont a legutóbbi helyen nyit. Ha zavaró, a `FsService.saveHandle`-lel
  egy sorban tárolható.

## 7. Nyitott kérdések

Nincs — a második kör válaszai a 9. fejezet végén.

## 8. Kockázatok

- **A `runGenerate` kiemelése** a legkényesebb rész (élő, sokat javított kód).
  Csak mozgatás, és a Dokumentumok fül generálását böngészőben is lefuttatjuk.
- **Böngészős viselkedés** (mappaválasztó, engedély) csak az éles gépen
  ellenőrizhető — a SESSIONS.md „Nyitott” pontjába konkrét lépésekként kerül.

## 9. A kérés és a válaszok

**Kérés (2026-10-27, összefoglalva):** Ügyek → Új ügy → A) egy dolgozó (marad) /
B) tömeges ügyintézés (nagyobb csempe) → ügytípus legördülőből (egyelőre
Szálláshely-változás) → dolgozók client pickerrel → új cím a séma szerint →
összesítés és jóváhagyás → DB-írás → az Ügyekben a háttérben új (tömeges) ügy →
generálás a modulban, kimeneti mappa tallózással, „külön mappa dolgozónként”
gomb (amíg nincs megnyomva, minden a választott mappába). A sablonok az
Áttekintésen gombbal rendelhetők ügytípushoz. Legutóbb módosított adatok
megtekintése. A hiányzó-adat naplóból soronként megnyitható speciális szerkesztő
(csak onnan), a hiányzó mezők kijelölve; mentés után az adat bizonyítottan a DB-be
kerül, és az oldal frissül.

**Első kör válaszai:** 2. fejezet táblázata.

**Második kör (a terv kód elleni ellenőrzése után):**

| Kérdés | Döntés |
|---|---|
| Az új címben üresen hagyott mező (emelet, ajtó, hrsz.…) | **Törlődik** — az új cím teljes csere; az összesítő minden törlődő mezőt külön kiír. |
| Kell más mező a `lakcim` csoporton kívül? | **Nem** — a csoport elég; ha bővül, az űrlap követi. |
| Költözés napja kötelező? | **Nem** — üresen az ügyek határidő nélkül nyílnak, ügyenként pótolható. |

**A kód elleni ellenőrzés eredménye:** az ügytípusok a közös `docgen-config.json`
`caseTypes` részébe mentődnek (fájl- és IDB-módban is, `registry-view.js`
`hatterek`), a `templates` mező a normalizálást túléli; a dolgozói mappa
feloldása (`FsService.matchWorkerDir`, `DIR_PREP`) a gyökér paraméterezésével
újrahasználható; az import ugyanazon az `EmployeeRepo.update` úton ír, mint amit
a tömeges modul használ (napló, validáció, mentés).

## 10. Megvalósítás közben hozott döntések

- **Dolgozói mappa kérdés nélkül, ha nincs.** A Dokumentumok fülön minden
  nem azonosítható dolgozónál kérdés jön („Melyik dolgozói mappába?”). A tömeges
  modulban a *Külön mappa* kapcsoló maga a beleegyezés: a nem létező mappa
  kérdés nélkül készül — 30 dolgozónál ez 30 kattintás lett volna. Ha viszont
  több HASONLÓ nevű mappa van, ott is kérdez (párhuzamos dolgozói mappák ellen,
  `resolveWorkerTarget(..., { ujatKerdesNelkul })`).
- **Dátum a maszk után.** A dátummező maszkja (`utils.js`) a dokumentum
  szintjén fut, a mező saját figyelője UTÁN — a modul mikrotaszkban olvas,
  különben beillesztett „20261020” került volna az állapotba. (Headless
  böngészős próbán derült ki.)
- **PDF-szkript.** A `PDF-keszites.vbs` csak akkor kerül a mappába, ha a
  Dokumentumok fülön egyszer be lett állítva; a modul ezt ki is mondja, nem
  ígér nem létező fájlt.
- **A hiánypótló sáv ragadós** a párbeszéd tetején: a szerkesztő az első
  hiányzó mezőhöz görget, a lista mégis látszik.
- **A hiánypótló mentése a szokásos validációt kapja** — egy üres kötelező
  mező (pl. születési idő) a mentést megállítja, és a szűrő ilyenkor kikapcsol,
  hogy a hibás mező látsszon.

**Ellenőrzés:** `node test/run-all.js` zöld, új `test/bulk-case.test.js` (21
eset). Headless Chrome-ban (CDP, eldobható szkript, OPFS mappákkal a
mappaválasztó helyett) végigjárva: Új ügy csempék → tömeges oldal → választó →
cím → összesítő → rögzítés (ügyek, napló forrása, tároló) → generálás gyökérbe
és dolgozói mappába → köteg újranyitása → ügytípus-sablonok mentése →
hiánynapló Javítás → mentés → frissült napló → Legutóbbi változások szűrése;
és a Dokumentumok fül generálása a kiemelt motorral (változatlan eredmény).

## 11. Javítások az első éles visszajelzés után (2026-10-27, `v10.86`)

| Panasz | Ok | Javítás |
|---|---|---|
| A hiánynapló megnyitása befagy | Korlátlanul nőtt a `localStorage`-ban, minden sor kirajzolódott; a 4.6-os újraértékelés soronként az összes dolgozó nevét feloldotta. Tele tárolónál az `append` a generálást is megszakította volna (a fájlmentés ELŐTT fut). | 50 soros lapok, egyszer épülő névindex, csak a látható lap értékelődik ki; a legújabb 2000 bejegyzés marad; tele tárolónál a régebbi fele kiesik, kivétel nélkül. |
| Szótárpárok eltűntek | A közös `docgen-config.json`-ba minden ablak a BETÖLTÉSKORI sémáját írta vissza — egy régóta nyitott ablak bármely sémamentése törölte a máshol közben felvett párokat. A „Szótár mentése” ráadásul nem várta meg a mentést (hiba esetén is „mentve”). | `SchemaStore.save()` mentés előtt újraolvassa a tárolt szótárat, és átveszi a még nem látott párokat (a saját törlés törlés marad). A szótármentés megvárja az írást, hibánál szól. |
| `{{mező_hun}}` | Működik (teszt: `schema.test.js`). | A tájékoztató és az élő előnézet a `_hun` / `_eng` (és `_hu`) alakot is mutatja. |
| `legal_title_of_accommodation` nincs sehol | A 06-os sablon öt content control-ja erre a kulcsra néz, de a sémában nem volt ilyen mező (csak az „Egyéb jogcím” szöveg). A négyzetek sosem jelölődtek, és a hiánynapló sem szólt. | Új enum mező a `lakcim` csoportban (owner / tenant / family member / courtesy user / other, magyar alakkal is). Az adatbekérőből kimarad (HR tölti, mint az egyéb jogcímet); az EH-panel „tartózkodás jogcíme” sora rá mutat. Az üres négyzetcsoport mostantól a hiánynaplóba kerül. |
| Legutóbbi változások → összesítő, mentés után a tetejére ugrik | — | Sorra kattintva a szerkesztő nyílik; mentés / *Vissza a listához* után a lista ugyanazzal a szűrővel, ugyanott. Az összesítő is ugyanott marad a szerkesztőből visszatérve. |
| Eltérő csempék, emoji | — | Két egyforma csempe, középre igazított szöveg, emoji nélkül. |
| Tömeges ügyek közvetlenül | — | Új nézet: Ügyek → **Tömeges ügyek** (`BulkCase.kotegek`). |
| Generálás / „Külön mappa” után felgörget | A teljes újrarajzolás. | A tömeges oldal görgetése megmarad. |
| A köteg mappáját jegyezze meg | — | IndexedDB-ben, kötegenként (`tomeges_kimenet:<batchId>`: mappa + kapcsoló); az engedélyt a generálás gombja kéri vissza. |
