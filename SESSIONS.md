# Session-napló és folytonossági protokoll

> **Mire jó ez a fájl?** Hogy egy AI-asszisztens (Claude Code) vagy bárki más
> **bármikor folytatni tudjon egy korábbi munkamenetet** anélkül, hogy a
> kontextust nulláról kellene újra felderíteni. Ez a fájl a projekt „rövid távú
> memóriája": mi történt, miért, mi a következő lépés.

---

## A rendszer

Három rétegből áll, és mindegyik a repóban van (verziózva, gépfüggetlen):

| Réteg | Fájl | Szerep |
|---|---|---|
| **Belépő** | `CLAUDE.md` | Minden session elején ez töltődik be először. Ide-mutat: „olvasd el a SESSIONS.md-t". |
| **Napló** | `SESSIONS.md` (ez a fájl) | Fordított időrendű bejegyzések: mit csináltunk, mi maradt hátra. |
| **Terv** | `TERV*.md` | A *miért* — a döntések tartós indoklása. Ritkán változik. |

Az AI-asszisztens gépi memóriája (ha van) ettől **független** és nem a repóban
él; a repó-oldali igazság mindig ez a három réteg.

## Protokoll — session ELEJÉN

1. Olvasd el a `CLAUDE.md`-t (automatikusan betöltődik).
2. Olvasd el a `SESSIONS.md` legfelső 1–2 bejegyzését → ez a friss állapot.
3. Ha a feladat egy adott területet érint, olvasd a hozzá tartozó `TERV*.md`-t.
4. Futtasd a teszteket kiindulási alapként: `node test/run-all.js`.

## Protokoll — session VÉGÉN

Szúrj be **egy új bejegyzést a napló tetejére** (legfrissebb elöl) az alábbi
sablonnal. Röviden, de úgy, hogy a *következő* session ebből folytatni tudjon.

```markdown
## YYYY-MM-DD — <rövid cím>

**Cél:** mit kértek / mi volt a feladat.
**Változás:** mit csináltunk (fájlok, `v<verzió>`).
**Miért / döntés:** a nem magától értetődő döntések és okuk.
**Tesztek:** mi fut, mi az eredmény.
**Nyitott / következő:** mi maradt hátra, mire figyeljen a következő session.
```

**Elvek:**
- A tetejére kerül az új bejegyzés (fordított időrend).
- A **verziószám** köti a naplót a git-történethez — mindig írd bele. Nem a
  commit-hasht: az a saját commitjába nem írható bele (körkörös), ezért a régi
  bejegyzésekben ott maradt a „még nincs commitolva". A verzió viszont a
  commit-számból ELŐRE kiszámolható (`git rev-list --count HEAD` + 1), és a
  `post-commit` hook `v<verzió>` néven tagelt commitra mutat.
- Ne írd át a régi bejegyzéseket utólag „simára"; a tévedés is tanulság.
- Egy bejegyzés legyen tömör (nem jegyzőkönyv) — a *folytathatóság* a cél.

---

# Napló

## 2026-08-19 (4.) — Import a 4. sortól; kijelölhető nyilvántartás-tábla

**Cél:** (1) az adatbekérő-import a címkesort is személyként olvasta be;
(2) a munkavállaló-táblázatban nem lehetett sorokat kijelölni, így nem volt
tömeges adminisztráció; (3) szűk ablakban a sorbéli gombok levágódtak;
(4) az oszlopok nem voltak átrendezhetők — a BEVapp táblázatát kérték vissza.

**Változás** (`v10.44`):
- `js/modules/registry/xlsx-io.js` — az import a profil `keyRow`/`firstDataRow`
  értékeivel olvas (1: kulcsok, 2: szakaszcímek, 3: angol címkék, 4: első adatsor).
- `vendor/client-picker.js` + `.css` — `ClientPicker.inline({ container, … })`:
  ugyanaz a komponens, csak nem modal. Új: `setRows()` (kijelölés kulcs szerint
  marad meg), `selectedKeys()`, `clearSelection()`, `onSelectionChange`, `rowClass`,
  `search: false`. Inline módban nincs fejléc/Mentés-Mégse, és a billentyűk csak
  akkor az övéi, ha a fókusz a táblában van.
- `js/modules/registry/registry-view.js` — a `#rg-list` tábla erre állt át:
  jelölőnégyzetek, Shift-tartomány, oszlopválasztó (74 sémamező), rendezés,
  Excel-stílusú szűrők, mentett nézetek. A rekord-műveletek EGY helyen, a tábla
  alatti sávban (Előzmények / Szerkesztés → 1 kijelöltnél; Kilépettnek jelölés ↔
  Visszavétel / Export / Törlés → bármennyinél). `openExitDialog` és
  `confirmDestroy` mostantól tömböt kap. A `toggleExit` és a `renderRow` kiesett.
- `css/app.css` — `.workspace { min-width: 0 }`: e nélkül a széles tábla az egész
  oldalt kitolta vízszintesen a saját görgetője helyett.

**Miért / döntés:**
- Az import gyökéroka nem az olvasóban volt: `XlsxRead.readRows` beépített
  alapértelmezése `firstDataRow: 3`, az élő sablon viszont 2026-08-18 óta
  szakaszcím-sort is tartalmaz. A `tools/adatbekero.js` már helyesen a profilból
  vette a sorszámokat — az UI-import maradt le róla.
- Új tábla helyett a már vendorolt (és a BEVapp-példánnyal bitre azonos)
  ClientPickert bővítettük beágyazott móddal. Egy komponens, két használat.
- Előbb ragadós akció-oszlop készült (adat csúszik ki, gomb marad), de a
  soronkénti négy gomb ~380px-et vitt el minden sorból. A kijelölés-alapú sáv
  ezt kiváltja, így az akció-oszlop támogatása kikerült a komponensből.

**Tesztek:** `node test/run-all.js` — minden készlet zöld (új: az üres sablon
csak a profil szerinti első adatsortól olvas; a tábla kijelölhető és a műveletek
alatta vannak). Böngészőben végigpróbálva localhost-ról (`.claude/launch.json`,
python http.server): kijelölés, gomb-tiltottsg, tömeges kiléptetés, visszavétel,
előzmények, szerkesztés, oszlopválasztó, és hogy 1100px szélességnél az oldal
nem tágul túl.

**Nyitott / következő:**
- `js/modules/docgen/merge.js:139` továbbra is `row['Vezetéknév']`-ként olvassa a
  `clientRows` elemeit, pedig azok `{id, fields}` alakúak — a per-client
  merge-előnézet fájlnevei valószínűleg üresek. Nem ehhez a kéréshez tartozik.
- Az Ügyek fül táblázata még a régi `data-table` — ha kell, ugyanezzel a
  `ClientPicker.inline` mintával átállítható.

## 2026-08-19 (3.) — Sablonmappa-váltás javítása + UUID-k elrejtése

**Cél:** a „Másik sablonmappa választása” gomb megnyitja a megerősítő párbeszédet, de az
„Igen, váltok” nem csinált semmit — csak az app újratöltése + engedély-megtagadás után
lehetett másik mappát választani. Emellett az összesítő kártya a személyek belső
azonosítóját (UUID) írta ki név helyett.

**Változás** (`v10.43`):
- `js/services/fs-service.js` — `getOrRequestDir(key, description, { force })`. `force: true`
  esetén átugorja az IndexedDB-ben tárolt handle-t, így mindig feljön a mappaválasztó.
- `js/modules/docgen.js` — `onSetTemplatesDir({ force })`; a váltás megerősítése
  `force: true`-val hívja. Új `clientLabel(id)` helper; az összesítő kártya és a chip-sor
  ezen keresztül névvel dolgozik. `loadFromRegistry()` az első `render()` ELŐTT fut,
  hogy a névfeloldáshoz legyen `clientRows`.
- `test/auto-tests.js` — két regressziós teszt mindkét hibára.

**Miért / döntés:** a gyökérok nem a dialog-handler volt, hanem a `getOrRequestDir`
„cache-first” viselkedése: a törlött `state.templatesDir` után a függvény a még érvényes
engedélyű RÉGI handle-t adta vissza, tehát ugyanaz a mappa állt vissza. A kimeneti
mappánál ez már meg volt oldva (`_pickAndSaveOutputDir` közvetlen picker) — itt nem
másoltuk le a mintát, hanem a közös függvényt bővítettük, hogy egy helyen legyen.
A `clientLabel` hiányzó rekordnál `(ismeretlen személy)`-t ad, nem az azonosítót — UUID
semmilyen úton ne szivárogjon a felületre.

**Tesztek:** `node test/run-all.js` — minden készlet zöld.

**Nyitott / következő:** `js/modules/docgen/merge.js:139` a `clientRows` elemeit
`row['Vezetéknév']`-ként olvassa, pedig azok `{id, fields}` alakúak — a per-client
merge-előnézet fájlnevei valószínűleg üresek. Nem ehhez a hibához tartozik, nem
nyúltunk hozzá.

## 2026-08-19 (2.) — Sürgősségi kontakt: Information for HR → Contacts

**Cél:** A felhasználó egy újabb referenciafájlt küldött (`adatbekero (1).
xlsx`), amiben a `hr_emergency_contact_name`/`hr_emergency_contact_phone`
mezőt átrakta az „Information for HR" szakaszból a „Contacts" szakasz
végére (email, telephone után).

**Változás:** (a commit után várhatóan `v42`)
- `js/schema/export-profiles.js` — a két kulcs átkerült az „Information for
  HR" `sections`-bejegyzés kulcslistájából a „Contacts"-éba (a végére).
- `test/xlsx.test.js` — `ADATBEKERO_SORREND` frissítve.
- `README.md` — a szakasz-összefoglaló és a HR-oszlopok leírása frissítve.

**Miért / döntés:** Egyszerű, egyértelmű átrendezés, a kapott fájl oszlopkulcs-
sorrendjével (`row 1`) automatikus szkripttel összevetve — pontos egyezés,
nem kézzel ellenőriztem.

**Tesztek:** `node test/run-all.js` → mind a 14 készlet zöld. A generált
`adatbekero.xlsx` fejlécsora (kulcsok) szkripttel összevetve a kapott
referenciafájléval: pontos egyezés.

**Nyitott / következő:** —

**Cél:** Az előző session (2026-08-18 (2.)) után a felhasználó egy
szemléltető fájlt küldött: az általa kézzel megformázott adatbekérő 1-2-3.
sorát a mi generált fájlunk 1-2-3. sora ALÁ másolta (4-5-6. sor), hogy
összehasonlítható legyen. Két eltérést jelzett: (1) az eredeti fájlban a
cellaszín ÉS a szegélyek is a csoportosításhoz (nálunk: szakaszhoz) tartoztak,
nálunk nem stimmelt; (2) a kommentdoboz magasságát („szélességét") túl nagyra
(9-re) állítottuk, csökkentsük legalább 3-mal.

**Változás:** (a commit után várhatóan `v41`)
- `js/schema/export-profiles.js` — minden `sections[i]`-hez `fill` szín (a
  szemléltető fájlból kiolvasva, cellánként ellenőrizve: Personal Data
  `FFC00000`, Documents `FF7030A0`, Identification Numbers / Information for
  HR `FF1F3864` (a kettő UGYANAZ), Hungarian Address `FF806000`, Employment
  `FFC55A11`, Skills `FF1F6B5C`, Address Abroad `FFA6761D`, Contacts
  `FF2E75B6`); a `style`-ból törölve a mostantól használaton kívüli
  `requiredFill`/`labelFill`/`sectionFill`.
- `js/services/xlsx-write.js` — `sectionFillOf()`: kulcs → szakaszszín térkép;
  `writeHeader()` és `writeSectionRow()` ezt használja mind a 3 fejlécsoron,
  a `required`-alapú piros felülírás és az „új csoport = vastag bal szegély"
  logika törölve (a szemléltető fájlban a szakaszhatárt PUSZTÁN a színváltás
  jelzi, nincs külön szegély) — a szegély mostantól egységesen vékony,
  vízszintes vonal a sorok között; `NOTE_ROW_SPAN`: 9 → 6 (a szélesség/
  `NOTE_COL_SPAN` maradt 5), a VML style-hint magassága 160pt → 110pt.

**Miért / döntés:**
- A színt és a szegélyt NEM feltételezésből, hanem a szemléltető fájl nyers
  cella-formázásából (openpyxl: `fill.fgColor`, `border.left/top/bottom.
  style`) olvastam ki, oszloponként végigmenve mindhárom sorban — ez adta ki
  pontosan az „egy szín/szakasz, se szegély, se kötelezőség-kiemelés" mintát.
- A **kötelezőség fejléc-szín szerinti jelzése megszűnt** — a 4 kötelező mező
  (surname, forename, date_of_birth, citizenship) mind a „Personal Data"
  szakaszban van, aminek a színe véletlenül piros, DE a szakaszon belül a nem
  kötelező surname_at_birth is ugyanolyan piros. A `REQUIRED` jelzés mostantól
  kizárólag a cellakommentben van. Ezt nem kérdeztem vissza — a szemléltető
  fájl egyértelmű volt, és a felhasználó a „mehet a commit push" utasítással
  gyors végrehajtást kért.
- A kommentdoboz „szélesség 9→csökkentés" kérését a `NOTE_ROW_SPAN`
  (magasság-span) csökkentéseként értelmeztem, mert a kódban/dokumentációban
  kizárólag ott szerepelt a „9" szám (a `NOTE_COL_SPAN` mindig 5 volt) — a
  felhasználó valószínűleg ezt a számot idézte vissza, nem a pt-értéket.

**Tesztek:** `node test/run-all.js` → mind a 14 készlet zöld. A generált fájlt
oszloponként, mindhárom fejlécsoron összevetettem a szemléltető fájllal
(script, nem kézzel) — pontos egyezés. A kommentdoboz-anchor span 6 sorra
csökkent (nyers VML-ből ellenőrizve).

**Nyitott / következő:**
- Az `Útmutató` lap „Csoport" oszlopa TOVÁBBRA IS a régi, `group`-alapú színt
  viseli (`style.groupFill`), nem a szakaszszínt — ezt a felhasználó nem
  jelezte problémának, szándékosan nem nyúltam hozzá.

**Cél:** A felhasználó egy kézzel átszerkesztett adatbekérőt (`adatbekero (2).
xlsx`) adott át mint a végleges, kiküldendő verziót, és kérte, hogy az app
generátora ezt állítsa elő ezután — oszlopsorrend, egy új, kitöltést segítő
2. sor, kikapcsolt lapvédelem — valamint hogy a kommentablakok mérete miatt
(a legtöbb komment 6–9 soros szöveg volt, a doboz 2 oszlop × 4 sorra futotta)
a szövegek látszódjanak feltöltés előtt.

**Változás:** (a commit után várhatóan `v40`)
- `js/schema/export-profiles.js` — az `adatbekero` profilban: `sections`
  tömb (9 szakasz, téma szerint: Personal Data → … → Contacts) adja az
  oszlopsorrendet ÉS a 2. sori szakaszcímeket; `excludeColumns` zárja ki a
  `topographical_number`/`other_accommodation` mezőt az exportból (a sémában
  maradnak); `sectionRow: 2`, `labelRow: 3`, `firstDataRow: 4`;
  `protection.enabled: false` (a `Data` lapon); a `printSheet`-nek önálló
  `protected: true` jelzője (a „HR adatlap" a képletei miatt véve marad);
  `columnsOf()` a `sections`-ban még be nem sorolt mezőket a lista végére
  illeszti, hogy egy új séma-mező sose vesszen el.
- `js/schema/seed-schema.js` — új mező: `hr_bank_name` (a korábbi, egybe írt
  „Bank Account Number and Name of Bank" szétvált `hr_bank_account` +
  `hr_bank_name`-re); `version: 2`.
- `js/services/xlsx-write.js` — `writeSectionRow()`: a 2. sor összevont
  szakaszcímei; `enlargeNoteBoxes()`: a kiírt fájl `vmlDrawing*.vml`-jét
  utólag, nyers XML-ben nagyítja (5 oszlop × 9 sorra), mert az ExcelJS minden
  kommentnek ugyanazt az apró, fix méretű VML-dobozt írja, és ezt a publikus
  API nem teszi állíthatóvá; `addPrintSheet()` mostantól `profile.printSheet.
  protected`-et nézi a Data-lap védelme helyett.
- `tools/adatbekero.js` — a Node-sandboxba bekerült a `pizzip.min.js`
  (`enlargeNoteBoxes`-hoz kell).
- `test/xlsx.test.js`, `test/schema.test.js`, `test/schema-from-xlsx.test.js`,
  `test/e2e.test.js`, `test/fixtures/adatbekero-hints.json` — a sor- és
  oszlopeltolódás miatt frissültek (a `HATOSAGI_SORREND` teszt mostantól CSAK
  a séma belső, változatlan sorrendjét őrzi; az export-sorrend új szerződését
  `ADATBEKERO_SORREND` őrzi `xlsx.test.js`-ben); új tesztek: a két kizárt
  mező tényleg a sémában marad, a szakaszcím-sor összevonása, a
  kommentdoboz-nagyítás.
- `README.md` — az „Az adatbekérő táblázat" szakasz átírva az új sorrendre,
  szakaszcím-sorra, lapvédelem-állapotra és a kommentméret-javításra.

**Miért / döntés:**
- **A séma belső sorrendje NEM változott** — csak az EXPORT (a `columns`
  helyett `sections`-ból számolt) sorrendje. Ezt a felhasználó kérdésemre
  külön megerősítette: a téma szerinti sorrend legyen a végleges kontraktus,
  a `HATOSAGI_SORREND` (2026-08-17-i döntés) lecserélve.
- **`topographical_number` és `other_accommodation`** hiányzott az új
  fájlból, és pont a lakcím-blokk két szélén ült — tipikus jele egy véletlen
  kiesésnek kézi átrendezésnél. Rákérdeztem: a felhasználó válasza szerint
  **szándékos** kihagyás, de a DB-sémából NEM törlendő (a HR viszi fel őket
  kézzel) — innen az `excludeColumns` mechanizmus, nem törlés.
- **Az 1. sor (gépi kulcsok) az új fájlban látható volt**, a korábbi rejtett
  állapottal szemben. Rákérdezve: ez nem szándékos, csak szerkesztési
  melléktermék — az app generálásakor továbbra is rejtett marad.
- **A `Data` lap lapvédelme kikapcsolva, de a „HR adatlap" NEM** — ez nem
  feltételezés, hanem az átadott fájl tényleges állapotából derült ki
  (`ws.protection.sheet`: Data=False, HR adatlap=True). A két védelem ezért
  szétválasztott kapcsoló lett (`profile.protection` vs. `profile.printSheet.
  protected`), nem egy közös flag.
- **A kommentdoboz-méretet nem lehet az ExcelJS `note` API-ján keresztül
  állítani** — a könyvtár forrásában (`vendor/exceljs.min.js`,
  `V_SHAPE_ATTRIBUTES`) hardcodeolt `width:97.8pt;height:59.1pt`. A tényleges
  méretet Excelben nem ez a stílus, hanem a VML `<x:Anchor>` cellatartománya
  szabja meg — ezt igazoltuk is: a stílus-pt átírása önmagában NEM változtatta
  meg a visszaolvasott méretet, az `<x:Anchor>` átírása igen. Ezért a
  `toBuffer()` a kiírt zip-et PizZip-pel újranyitja és a nyers VML-t igazítja
  — ugyanaz a minta, mint a `SchemaFromXlsx` legördülő-olvasása.

**Tesztek:** `node test/run-all.js` → mind a 14 készlet zöld (354 teszt).
`node tools/adatbekero.js` → 64 oszlop, ellenőrzés zöld, a kiírt fájlban a
kommentdoboz-anchorok 5×9-re nagyítva (kézzel is ellenőrizve nyers XML-lel és
ExcelJS-szel visszaolvasva).

**Nyitott / következő:**
- A felhasználó `adatbekero (2).xlsx` fájlját magát NEM módosítottuk — az app
  a schema/export-profiles.js alapján ÚJRAGENERÁLTA a sablont (`adatbekero.
  xlsx`, gitignore-olt, ezért nincs a repóban), ami tartalmazza az összes
  kért változtatást ÉS a nagyított kommenteket is. Ha a felhasználó mégis a
  KÉZZEL szerkesztett fájlt akarja tovább használni (pl. a benne lévő
  megjegyzés-szövegek miatt), azt még nem hasonlítottuk össze mezőnként az
  új sémával.
- Commit még nem történt — a munka a working tree-ben van.

**Cél:** Követhető legyen az UI-n, ha egy dolgozó bármely adata átíródik –
ki, mikor, honnan és mit változtatott.

**Változás:** `v10.39`
- `js/services/employee-repo.js` — a napló a rekordon belül él
  (`emp.history[]`), nem külön fájlban, így a meglévő biztonsági mentés és
  visszaállítás automatikusan viszi. Mind az öt mutátor (`create`, `update`,
  `addIdentifier`, `removeIdentifier`, `setExited`) naplóz; `source` jelzi,
  honnan jött a változás (`urlap` | `import` | `ugy`).
- `js/modules/registry/employee-history.js` — új modul, a napló dialógusban:
  legfrissebb elöl, mezőnkénti előtte→utána párral, nyers érték helyett
  megjelenítéskor fordítva a sémán át.
- `js/modules/registry/registry-view.js` — „Előzmények (N)" gomb minden
  sorban; a darabszám csak akkor látszik, ha van bejegyzés.
- `js/services/xlsx-read.js`, `js/services/case-repo.js` — a `source` most
  már `'import'`, illetve `'ugy'` értékkel hívja a mutátorokat.
- `css/registry.css`, `README.md`, `index.html` — stílus, dokumentáció,
  bekötés.

**Miért / döntés:**
- **A rekordon belül, nem külön fájlban.** Nincs új tároló-háttér, nincs
  második sérülés-kezelés és visszaállító párbeszéd ugyanazért a funkcióért –
  a meglévő 20 biztonsági mentés automatikusan viszi. Következmény: a
  végleges törlés a történetet is törli (ez GDPR-szempontból helyes).
- **Nyers értéket tárolunk, nem megjelenítettet.** A kanonikus enum-azonosító
  és az ISO-dátum megy a naplóba; a fordítás (magyar címke, dátumformátum)
  megjelenítéskor történik a sémán át. Így a napló nem hazudik, ha később
  átnevezik egy séma-érték címkéjét.
- **Valódi eltérés nélkül nincs bejegyzés.** Enélkül egy újraimportált
  táblázat minden érintetlen sora zajt ütne a naplóba. A létrehozás, a
  kilépés és a visszavétel viszont önmagában is tény – azok mezőváltozás
  nélkül is bekerülnek.
- **`removeIdentifier` a mezőt szándékosan nem üríti** (lásd
  `syncIdentifierFields`), ezért a törölt azonosítót a bejegyzés `extra`
  mezőn viszi be, nem a diffen.
- **`MAX_HISTORY = 200`, fix korlát.** Ha kevés lesz, a következő lépés külön
  `docgen-audit.json`, nem nagyobb szám.

**Tesztek:** `node test/run-all.js` mind a 14 csomag zöld; 9 új teszt a
`test/employee-repo.test.js`-ben (diff, no-op szűrés, azonosító-csere,
kilépés/visszavétel, régi rekord migrációja, 200-as korlát). Böngészőben
végigvíve: létrehozás → „Előzmények (1)", mezőmódosítás → helyes
`Vezetéknév: Teszt → Tesztelt` diff, konzolhiba nélkül.

**Nyitott / következő:** Globális (nem személyhez kötött) változásnapló a
Beállítások fülön nincs megépítve – szándékosan, nem volt rá kérés; a
per-személy adatból utólag összeállítható, ha kell.

## 2026-08-17 (4.) — Frissítés ZIP-ből a céges gépen, törlés nélkül

**Cél:** A GitHubról letöltött ZIP-pel lehessen frissíteni az izolált céges
gépen — kicsomagolás nélkül, és úgy, hogy a lényeges fájlok ne tűnjenek el.

**Változás:** `v10.38`
- `tools/frissit.vbs` — a ZIP-et ideiglenes mappába bontja, bájtra összeveti a
  helyi fájlokkal, megmutatja mi változna, **rákérdez**, és csak utána másol.
  `/csendes` kapcsolóval dialógus nélkül fut.
- `test/frissit.test.js` — felépít egy hamis „céges gépet" éles adattal, és
  ellenőrzi, mi maradt meg.
- `README.md` — új szakasz a használat helyén végzett frissítésről.

**Miért / döntés:**
- **VBScript, nem PowerShell.** A munkaállomáson a WSH bizonyítottan fut
  (`tools/pdf-proba/EREDMENY.md`, 2026-08-06), a PowerShell futtatási
  házirendjéről viszont nincs mérésünk. Ahol van adat, arra építünk.
- **A szkript soha nem töröl.** A kód és az éles adat ugyanabban a mappában
  él; egy „tükröző" frissítés (`robocopy /MIR`) a `data/`-t és a `backup/`-ot
  is letörölné. Az ár: a repóból kikerült fájl ottmarad — ez ártalmatlan,
  mert az `index.html` névre hivatkozik, nem mappát olvas.
- A védett mappák (`data`, `Sablonok`, `Kimenet`, `Kész fájlok`, `logs`) nem
  csak azért maradnak ki, mert a ZIP-ben nincsenek benne (`.gitignore`),
  hanem külön névre szóló tiltás is van rájuk — a teszt ezt úgy méri, hogy a
  próba-ZIP-be szándékosan tesz `data/` fájlt.
- Bájtra hasonlít (ADODB.Stream, `iso-8859-1` — az egyetlen kódolás, amiben
  mind a 256 bájtnak van saját karaktere), nem dátumra: a ZIP időbélyegei nem
  megbízhatóak, a méret-egyezés pedig nem elég.
- A másolt fájlokról letörli a `Zone.Identifier` bejegyzést, különben a
  letöltésből származó `.vbs` indításkor figyelmeztetést kap.

**Tesztek:** `node test/run-all.js` → minden készlet zöld, benne 8 új teszt.
A `vbs-encoding` készlet automatikusan az új szkriptre is kiterjed.

**Nyitott / következő:**
- Névütközés-csapda: a VBScript nem különbözteti meg a kis- és nagybetűt, így
  a `Vedett()` függvény és a `VEDETT` tömb ütközött („újradefiniált név").
  Ez fordítási hiba volt, nem néma — de VBS-ben érdemes rá figyelni.
- Ha egyszer tényleg zavaró lesz az elárvult fájlok gyűlése, a ZIP
  fájllistájából kiszámolható, mi tűnt el — de csak a kód-mappákon belül.

## 2026-08-17 (3.) — „HR adatlap" nyomtatási lapfül, makró nélkül

**Cél:** A HR kapjon nyomtatható/PDF-be menthető adatlapot a kitöltött
táblázatból, a saját „Personal Data Sheet" elrendezésében.

**Változás:**
- `js/schema/export-profiles.js` — új `printSheet` leírás: szakaszok, soronként
  egy címke és a mögötte álló mezőkulcsok. Az ELRENDEZÉS ADAT.
- `js/services/xlsx-write.js` — `addPrintSheet()`: a harmadik lapfül (A4, álló,
  egy oldal szélesség), egyetlen írható vezérlőcellával (B2 = a személy sora a
  `Data` lapon). Minden érték `INDEX`-képlet.
- `test/xlsx.test.js` — 5 új teszt, köztük a lényegi: mezőnként visszafejti a
  képletek oszlopbetűit és összeveti a `Data` lap tényleges oszlopaival.
- `README.md` — új szakasz a nyomtatási lapról.

**Miért / döntés:**
- **Nem VBA.** A makrós munkafüzet `.xlsm`, azt a céges makróvédelem és a
  levélszűrők blokkolhatják, ráadásul az ExcelJS nem tud VBA-projektet írni —
  a sablon így nem lenne generálható. A képletes megoldás ugyanazt adja, és a
  fájl `.xlsx` marad. (A felhasználó ezt választotta három felvetett út közül.)
- A lap védett, a vezérlőcella kivételével minden zárolt: egy elgépelés
  különben némán kitörölné az adatlap felét.
- Összefűzésnél szóköz + `TRIM`, nem vessző: üres mezőnél a vessző lógva
  maradna („Szerbia, ”). Ez a lap a HR-nek szól, nem hatósági irat.
- A képletek oszlopbetűi a séma sorrendjéből jönnek, ezért egy átrendezés
  NÉMÁN elcsúsztathatná őket (az útlevélszám helyén a TAJ). Ezért van rá teszt.
- Az „ID number” rovatba az útlevélszám kerül (a felhasználó döntése): a
  külföldi munkavállalónak nincs magyar személyi igazolványa.

**Tesztek:** `node test/run-all.js` → 322/322 zöld.
`node tools/kiadas.js --csak-ellenoriz` → zöld. `node tools/adatbekero.js` → 3
lapfül, 65 oszlop.

**Nyitott / következő:**
- **A `Personal_data_sheet_2023.xlsx` NEM olvasható.** A fájl Microsoft
  IRM/Purview-védett (a CFB-ben `DRMEncryptedTransform` + `Primary`,
  `EncryptionInfo` nélkül); sem a SheetJS, sem az `msoffcrypto-tool` nem nyitja,
  és nincs jelszó, amit meg lehetne adni — a kulcs az Azure RMS-nél van. A
  nyomtatási lap ezért a KORÁBBI `Date_sheet.xlsx` elrendezését követi.
  Ha megjön a 2023-as változat védelem nélkül (Fájl → Információ → Hozzáférés
  korlátozása → Korlátlan hozzáférés, majd Mentés másként), a `printSheet`
  felsorolását kell hozzáigazítani — kódot nem.
- A nyelvtudás és a gyerekek egy-egy szabad szöveges cella, nem alrács.
- Verzió: **v10.35** (a két mai bejegyzés közös commitban).


## 2026-08-17 (2.) — Oszlopsorrend a hatósági nyomtatvány szerint

**Cél:** Az adatbekérő oszlopai olyan sorrendben álljanak, ahogy a 9. sz.
tartózkodási engedély iránti kérelemben és a betétlapokban (9.7. Vendégmunkás,
9.9. EU Kék Kártya) vannak — hogy az átvezetés fentről lefelé menjen. Emellett:
a HR-mezők a saját hatósági rovatuk mellé kerüljenek, ne egy blokkba a végén.

**Változás:**
- `js/schema/seed-schema.js` — a `fields` tömb átrendezve a nyomtatvány
  rovatsorrendjére, szakaszonkénti kommentekkel (fejrész / 1. / 2. / 3. / 6. /
  7. pont / betétlap / nem-hatósági). A HR-mezők `group`-ja tematikus lett; a
  `hr` gyűjtőcsoport helyett `csalad` és `hr_belso` van. 65 oszlop.
- **Törölve:** `hr_id_number` (az útlevélszám viszi) és
  `hr_professional_background` (erre az `occupation_before_arrival` van).
- **Javítva:** `pp_issuance_place` a `pp_issuance_date` MÖGÉ került — a
  nyomtatványon egyetlen rovat: „kiállításának ideje, helye".
- `js/schema/export-profiles.js` — `groupFill` az új csoportokra,
  `freezeColumns: 3 → 7` (a névvel bezárólag; a hatósági sorrendben a név csak
  a 6–7. oszlop).
- `test/schema.test.js` — új `HATOSAGI_SORREND` lista: EZ az oszlopsorrend
  szerződése. Plusz teszt a pp_issuance_place helyére és a törölt mezőkre.
- `test/xlsx.test.js` — új `oszlop(ws, kulcs)` segéd; minden fix oszlopindex
  kulcs szerinti keresésre cserélve.
- `test/schema-from-xlsx.test.js` — az `orderChanged` mostantól `true`, külön
  teszttel és indoklással.
- `../adatbekero.xlsx` újragenerálva.

**Miért / döntés:**
- Az „eredeti 44 oszlop sorrendje" szerződést tudatosan váltottuk le a hatósági
  sorrendre. A régi oszlopok MEGLÉTÉT továbbra is mérjük (nehogy egy korábban
  kiküldött adatbekérő importja csendben adatot dobjon el), a sorrendjüket nem.
- A fix oszlopindexek helyett kulcs szerinti keresés: az átrendezéstől 16 teszt
  bukott el úgy, hogy közben semmi nem romlott el. Így a következő átrendezés
  nem jár ezzel.
- A vészhelyzeti kapcsolattartó a telefonszám mellől a tábla végére került: a
  kérelem borítóján nincs ilyen rovat, és elöl a fagyasztott sávot szélesítette
  volna 145 → 219 karakterre.
- A munkáltató adatai (név, székhely, adószám, KSH, TEÁOR) szándékosan NEM
  mezők: minden dolgozónál ugyanazok, a sablon írja be őket.

**Tesztek:** `node test/run-all.js` → 317/317 zöld.
`node tools/kiadas.js --csak-ellenoriz` → zöld.
`node tools/adatbekero.js` → 65 oszlop, önellenőrzés rendben.

**Nyitott / következő:**
- **Excel-makró ötlet.** Felmerült, hogy a 2. lapfülön egy gomb generálja le a
  HR-nek a nyomtatható/PDF dokumentumot. Nem épült meg, mert döntést igényel:
  a makrós fájl `.xlsm`, azt a levelezés és az Excel makróvédelme blokkolhatja,
  és a DocGen már tud dokumentumot generálni `.docx` sablonból (+ `docx-pdf.vbs`).
  Kérdés a felhasználó felé: legyen VBA a táblázatban, vagy inkább egy
  „HR-adatlap" `.docx` sablon a meglévő pipeline-ban.
- A `fillableRows` továbbra is 30.
- Verzió: **v10.35** (a két mai bejegyzés közös commitban).


## 2026-08-17 — Kilépés: az archiválás helyére munkaviszony-megszűnés

**Cél:** Az „archiválás" fogalmilag rossz volt: nem irattározunk, hanem
kilépett dolgozót jelölünk – amihez dátum és bejelentési kötelezettség tartozik.

**Változás:** `v10.34`
- `js/services/employee-repo.js` — `archived` → `exited` + új `exitDate`;
  `setArchived` → `setExited(id, exited, exitDate)`, a dátum **kötelező** és a
  `EXIT_DATE_FIELD` (`employment_end`) séma-mezőbe is bemásolódik. A régi
  `archived` kulcs betöltéskor egyszer átfordul és eltűnik.
- `js/modules/registry/registry-view.js` — kilépés-párbeszéd dátummal, majd
  figyelmeztető párbeszéd az OIF felé teendő bejelentésről (határidő, hátralévő
  napok), és egy kattintásos ügynyitás a `munkaviszony_kijelentes` típusra.
- `css/registry.css`, `js/modules/docgen.js`, `TERV.md`, `README.md` — a
  fogalom átvezetése; `test/employee-repo.test.js` — új tesztek.

**Miért / döntés:**
- A dátum a **tárolóban** kötelező, nem a felületen: így importból vagy bármely
  más útról érkező jelölés sem csúszhat át dátum nélkül.
- A dátum a séma-mezőbe is bemásolódik, mert az adatbekérő „Kilépés dátuma"
  oszlopa a felvételkor TERVEZETT utolsó munkanap – enélkül az export és a
  sablonok a tervezett napot vinnék a tényleges helyett.
- Visszavételkor az `exitDate` törlődik, de a séma-mező értéke marad: az a
  felhasználó adata, nem a mi jelölésünk.
- A figyelmeztetésből ügyet lehet nyitni: egy figyelmeztetés, amit nem lehet
  elintézni, pár nap múlva zaj. A határidő-napszám az ügytípusból jön (ma 5),
  nem itteni konstans – a Beállításokban átírható.

**Tesztek:** `node test/run-all.js` → 13/13 készlet zöld.
Külső függések ellenőrizve: `munkaviszony_kijelentes` ügytípus,
`employment_end` séma-mező, `CaseRepo.hasOpenCaseOfType` / `daysLeft` /
`create({triggerDate})` — mind létezik. `archived` maradvány sehol nincs a
migrációs kódon és a rá vonatkozó teszten kívül.

**Nyitott / következő:**
- Téves kilépési dátumot csak visszavétel + újbóli jelölés útján lehet
  javítani. Ha ez zavaró lesz, a kilépés dátuma szerkeszthetővé tehető.
- A kilépés-párbeszédre nincs gépi teszt (böngészős UI); a tároló-oldali
  szabály (kötelező dátum, séma-mező írása) viszont tesztelt.

## 2026-08-17 — Commitonkénti alverzió, tag és a felületen látható verzió

**Cél:** Minden commit kapjon új alverziót, ami a felületen és a GitHubon is
követhető.

**Változás:** `v10.31`, `v10.32`, `v10.33`
- `tools/verzio.js` + `tools/hooks/{pre,post}-commit` — az alverzió a
  commit-számból jön (nincs tárolt számláló), a `pre-commit` írja a `?v=`-t és
  a `js/version.js`-t, a `post-commit` **annotált** taget készít.
- `tools/kiadas.js` a saját verziólogikája helyett a `verzio.js`-t hívja;
  `test/verzio.test.js` új; a fejlécben és a Beállítások fülön látszik a verzió.

**Miért / döntés:**
- Commit-szám, nem külön számláló: az állapot elcsúszik és merge-nél ütközik.
- A commit SHA-ja a saját commitjába nem írható (körkörös) — ezért a
  verzió→commit megfeleltetést a git tag adja.
- **Annotált** tag kell: a `git push --follow-tags` a könnyűsúlyút nem viszi
  fel (ez lemért eset volt, a v10.31 a gépen ragadt).
- A felületen nincs GitHub-link: az app a használat helyén izolált, hálózat
  nélküli gépen fut, ott csak üres fület nyitna.

**Tesztek:** `node test/run-all.js` → zöld; `node tools/verzio.js --ellenoriz`.
Mellékesen kiderült, hogy a `print.html` `?v=5`-ön állt az `index.html` 10-e
mellett – a teszt ezt már géppel őrzi.

**Nyitott / következő:**
- Rebase/merge közben a hook kihagyja magát (különben minden újrajátszott
  commit ütközne az `index.html`-en), ezért utána a verzió elmarad. Ilyenkor
  `git reset --soft HEAD~1` + újracommit rakja helyre.
- `--amend`-nél a verzió eggyel túllép (a hook a következő sorszámot számolja).
- Új gépen egyszeri: `git config core.hooksPath tools/hooks` és
  `git config push.followTags true`.

## 2026-08-17 — Adatbekérő: a HR-adatlap és a DocGen-tábla egyesítése

**Cél:** Eddig két adatbekérő ment a külföldi munkavállalóhoz: a HR álló
„Personal Data Sheet" űrlapja és a DocGen fekvő táblája. Egy fájl menjen ki,
úgy, hogy a DocGen importja se sérüljön, és a kitöltés is könnyebb legyen.

**Változás:**
- `js/schema/seed-schema.js` — új `hr` csoport és 18 `hr_` előtagú mező: a
  HR-lap azon rovatai, amiknek nincs párja az idegenrendészeti adatkörben.
  A tábla 49 → 67 oszlop.
- `js/schema/export-profiles.js` — `style.groupFill` (fejlécszín csoportonként)
  és `style.freezeColumns: 3`.
- `js/services/xlsx-write.js` — csoportszín + színváltásnál vastag vonal a
  fejlécen, oszlopfagyasztás, és kétnyelvű `Útmutató` lap: angol szabályok,
  `English label` és `Guidance` oszlop, bizalmassági blokk.
- `js/schema/schema-store.js` + `js/modules/registry/registry-view.js` —
  `addMissingSeedFields()`: a mentett sémából hiányzó seed-mezők pótlása
  betöltéskor.
- `tools/adatbekero.js` — új: üres sablon generálása böngésző nélkül,
  visszaolvasó önellenőrzéssel.
- `../adatbekero.xlsx` — a kiküldhető, egyesített fájl újragenerálva (a
  korábbi, 44 oszlopos, 2026-08-07-i példány helyére).

**Miért / döntés:**
- *Fekvő tábla, HR-extrák jobbra* (nem álló űrlap + rejtett sor). Az importáló
  az ismeretlen fejlécet eldobja, nem hibázik (`xlsx-read.js`), így a HR-kör
  nulla kockázattal befér, és egy fájlban marad a 30 ember.
- A `hr_` előtag az ütközés elleni valódi védelem: a `matchByLabel` a
  magyar/angol CÍMKÉRE is illeszt, ezért egy „Tax number" fejlécű HR-rovat az
  adóazonosítóba költözött volna. Új teszt méri (kulcs, mindkét címke, jelölő),
  és azt is, hogy számított mező nem épít `hr_` adatra.
- A címkesor szövegét NEM bántottam (nincs `*` a kötelezőn): a
  „az angol címkék megegyeznek az eredetivel" teszt szándékos szerződés. A
  kötelezőség nem-színes jelzése a cellakommentben és az Útmutató lapon van.
- A csoportszínek nem adnak egybefüggő blokkokat, mert az oszlopsorrend az
  eredeti fájlé (teszt védi). Jelmagyarázatként működnek, az Útmutató lap
  *Csoport* oszlopa ugyanazt a színt viseli.
- Nyelvvizsgák és gyerekek: ismétlődő blokk egy sorba nem tárolható, ezért
  egy-egy szabad szöveges cella (a felhasználó döntése). Gépi feldolgozásra nem
  alkalmas — ha kell, fix rekeszekre kell bontani.
- Bankszámlaszám bekerült (a HR-lapon eddig is így volt), ezért az Útmutató
  lapra bizalmassági blokk került.

**Tesztek:** `node test/run-all.js` → 312/312 zöld (a séma-készlet 4 új
teszttel). `node tools/kiadas.js --csak-ellenoriz` → zöld.
Két várakozás-teszt frissült szándékosan (`schema.test.js`,
`schema-from-xlsx.test.js`): a bővülés listája bennük van felsorolva.
A `test/fixtures/adatbekero-hints.json` 18 új bejegyzést kapott.

**Nyitott / következő:**
- A `test/fixtures/adatbekero-minta.xlsx` továbbra is a régi 44 oszlopos fájl —
  szándékosan, az mérné a sorrend-elcsúszást. Ha egyszer lecseréljük, a
  `FORMANYOMTATVANY_MEZOK` listát is nullázni kell.
- `addMissingSeedFields` visszahozza a szándékosan törölt seed-mezőt is
  (`ponytail:` megjegyzés a kódban jelzi). Ha ez zavaró lesz, „törölt
  seed-kulcsok" lista kell a configba.
- Tisztázatlan maradt: a HR-lap `Home address` vs `Place of residence`
  megkettőzése. Feltevés szerint a magyarországi lakcím bontása a tartózkodási
  hely, az állandó (külföldi) cím pedig a `previous_*` mezők — ha ez nem igaz,
  új mező kell.
- Verzió: **v10.34** (a kilépés-funkcióval közös commitban – lásd a fenti
  bejegyzést; a kettő ugyanabban a munkafában készült, a `registry-view.js`-t
  mindkettő érinti, ezért nem volt tisztán szétvágható).


## 2026-08-11 — schema-from-xlsx: dátumoszlopok felismerése (a hiba forrásának végleges lezárása)

**Cél:** Hogy a sablonból épített séma se hozza vissza a dátum-hibát: a
dátumoszlopok `date` típusúak legyenek, ne `text`.

**Változás:**
- `js/schema/schema-from-xlsx.js` — az `analyze` felismeri a dátumoszlopokat
  (`isDate`): valódi Excel-dátumcella (szám + dátum-számformátum,
  `XLSX.SSF.is_date`), vagy szövegben tárolt EGYÉRTELMŰ év-elöl alak. Puszta
  szám (azonosító) és nap/hó-sorrendű szöveg NEM az. Egy oszlop akkor dátum, ha
  minden kitöltött cellája az. Az `analyze` mostantól `cellNF:true`-val olvas
  (kell a `cell.z` formátum). Új mező → `type:'date'`. Új `typeChanged` diff-
  kategória: meglévő szöveg-mező, amit a fájl dátumnak mutat → dátumra javasol.
- `js/modules/settings/settings-view.js` — „Dátumként ismert mező" szekció a
  séma-összevető párbeszédben + a választás begyűjtése; az új dátummezők
  „(dátum)" jelzést kapnak.
- Teszt: `test/schema-from-xlsx-date.test.js` (11 eset), felvéve a run-all-ba.

**Használat a felhasználónak:** Beállítások → „Séma összevetése adatbekérővel";
a dátumoszlopok most `date`-ként jönnek be, a szövegként tárolt dátummezőket a
„Dátumként ismert mező" szekcióban egy pipával dátumra lehet váltani.

**Tesztek:** teljes `node test/run-all.js` zöld (a `schema-from-xlsx.test.js`
külső mintafájl híján kihagyva — ez korábbi viselkedés).

## 2026-08-11 — Dátum kimenet: miért jött mm/dd/yy a HU forrás ellenére

**Cél:** A `bb8ddbd` „magyar dátum a dokumentumokban" javítás ellenére a
generált iratban `mm/dd/yy` jelent meg, pedig a forrás Excel magyar
(`ÉÉÉÉ.HH.NN`, év elöl).

**Diagnózis (valódi kódon igazolva):**
- A `formatDate` (`schema-store.js`) csak `type:'date'` mezőre fut, és eddig
  csak a kötőjeles ISO-t (`1988-04-12`) formázta.
- A `schema-from-xlsx.js` (204. sor) sablonfájlból **soha nem gyárt `date`
  mezőt** — csak `enum`/`text`. Ha a séma sablonból készült, a dátumoszlopok
  `text` típusúak.
- `text` mezőnél az import a *megjelenített* cellaszöveget tárolja
  (`xlsx-read.js` else-ág). A szabvány Excel-dátumcellát (formátumkód 14)
  a SheetJS **`m/d/yy` amerikai alakban** rendereli, függetlenül a HU locale-tól
  → így lett `mm/dd/yy`, és a formázó rá se nézett.
- Valódi `date` mezőnél az import a cella *sorszámát* olvassa
  (`serialToIso`) → ISO → helyes. Végponttól végpontig igazolva: valódi
  dátumcella ÉS magyar szöveg (`1988.04.12.`, `1988.4.12`) is `1988.04.12.`-t ad.

**Változás:** `js/schema/schema-store.js` — `formatDate` mostantól minden
EGYÉRTELMŰ **év-elöl** alakot elfogad és egységesít
(`1988-04-12`, `1988.04.12`, `1988.4.12`, `1988/04/12` → `1988.04.12.`); az
ambivalens nap/hó vs hó/nap alakot (`04/12/88`) szándékosan **nem** alakítja.
Tesztek: `test/schema.test.js` bővítve. Commit: `9af334c`.

**A felhasználó teendője (a tényleges javítás nála):** a séma dátummezőinek
(`Beállítások → séma`: Születési idő, útlevél kiállítás/érvényesség, engedély
lejárata, munkaviszony kezdet/vég stb.) típusa legyen **Dátum**, ne Szöveg.
A felhasználó a rossz rekordokat törölte, újra felviszi.

**Nyitott / következő:**
- Kód-hardening lehetőség: a `schema-from-xlsx.apply` ismerje fel a
  dátumoszlopokat és tegye `type:'date'`-re (heurisztika: dátum-számformátumú
  vagy év-elöl mintás cellák), hogy a sablonból épített séma se hozza vissza a
  hibát. Egyeztetésre vár.
- Ellenőrizni a felhasználó ÉLŐ sémáján, hogy a dátummezők tényleg `date`
  típusúak-e (a böngésző tárolójában van, kódból nem látható).

## 2026-08-11 — SDT (tartalomvezérlős) jelölőnégyzetek kitöltése

**Cél:** A hatósági `.docx` sablonok Word-tartalomvezérlős (content control)
checkboxait a generálás **egyet sem** töltötte ki. A tag `mező:érték` alakú
(pl. `marital_status:unmarried`, `sex:female`), angol azonosítókkal.

**Változás:** `js/services/docx-service.js` — a `processSdt`/`processCheckboxes`
javítása; új teszt `test/sdt-checkbox.test.js`, felvéve a `test/run-all.js`-be.
Commit: `9acf9fb`, pusholva `main`-re.

**Miért / döntés — két külön hiba volt:**
1. **Rossz összehasonlítás.** A `buildRenderRow` (docgen.js) a *megjelenített
   magyar címkét* adja át (`marital_status` → „Nőtlen/hajadon"), a `processSdt`
   viszont ezt nyers string-egyenlőséggel hasonlította az angol `unmarried`
   célértékhez → sosem egyezett. A séma-egyeztető (`SchemaStore.tagEquals`),
   ami ismeri az enum-írásmódokat (`unmarried ≡ Nőtlen/hajadon`), csak a
   szöveges `{{CHECK:}}` úthoz jutott el. **Fontos tudnivaló:** a checkboxnak
   *két, független* mechanizmusa van — a `{{CHECK:mező=érték}}` szöveges
   placeholder (docxtemplater, a `makeParser`-ben) és az SDT content control
   (`processSdt`). Ezek külön kódutak. Most az `opts.equals` az SDT-ághoz is
   átmegy, és elsőként azzal dönt; ismeretlen mezőnél esik vissza a heurisztikára.
2. **A látható glyph nem frissült.** A régi kód csak a `w14:checked` flaget
   állította, a tartalomban lévő ☐/☒ karaktert nem → a doboz üresnek *látszott*
   akkor is, ha a flag stimmelt. A `processSdt` most a glyphet is beírja
   (a `w14:checkedState`/`uncheckedState` kódpontja alapján), és csak valódi
   `w14:checkbox` vezérlőkhöz nyúl.

**Tesztek:** `node test/run-all.js` → mind zöld. Az új `sdt-testben` a valódi
kódon (PizZip + `processCheckboxes`) igazolva: régi kód 0 dobozt, új kód
pontosan a helyes 4-et jelöli be (mezőnként egyet, túl-egyezés nélkül), flag+glyph.

**Nyitott / következő:**
- A Style-2 esetet (csupasz tartalomvezérlő, `{{CHECK}}` nélkül) a `06`-os
  fixture-ből *szimulálva* teszteltük. **Érdemes a felhasználó valódi
  sablonjával is validálni.**
- A fix `w14:checkbox` content controlt feltételez. Ha egy sablon **régi
  űrlapmezős** checkboxot használ (`w:ffData`/`w:checkBox`), az más szerkezet,
  és külön kezelést igényel — jelenleg NEM támogatott.
- A tag-azonosítóknak egyezniük kell a séma kulcsaival vagy elfogadott
  alakjaival (`js/schema/seed-schema.js`).
