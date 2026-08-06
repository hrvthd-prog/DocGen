# Aumovio DocGen — terv (v2)

## 0. Mi változott a visszajelzésed után

| Pont | Változás |
|---|---|
| Séma | **Nem hardcode.** A meződefiníciók adatként élnek (JSON), futásidőben szerkeszthetők, új adatkör kód nélkül felvehető. Új: séma-szerkesztő + séma-diff új sablonfájlból. |
| Azonosítás | A SAP-azonosító **tartózkodási engedélyenként változik**, ezért nem lehet kulcs. Belső, soha nem változó azonosító + **az összes korábbi és aktuális külső azonosító megőrzése** (5. pont). |
| PDF | Tényleg kell → a **környezet-próba az 1. fázis**, nem lábjegyzet, és konkrét próba-artefaktumokkal. |
| Pozicionálás | Az app **SAP-kiegészítő**, nem kiváltó: azt az idegenrendészeti adatkört és sablonkezelést viszi, amit az SAP nem tárol. Ez a tervben végig irányadó. |

## 1. Kontextus és cél

A `BEVapp` (WHC/BEVA, éles, ~6500 sor JS) alapjaira épül egy önálló alkalmazás a
`C:\Users\hrvth\Desktop\Munka\Dániel\Aumovio\DocGen` mappában (jelenleg üres).

Az app **kiegészíti az SAP-t**: a vállalat nem vált SAP-ról, de az SAP nem tárolja az idegenrendészeti ügyintézéshez szükséges adatkört és nem kezel ilyen dokumentumsablonokat. A DocGen ezt a hiányt tölti be — saját nyilvántartás + dokumentumgenerálás.

**Marad:** dokumentumgenerálás + a HU/EN érték-fordító logika.
**Kikerül:** Data-sheet importáló, EH-nyomtatvány, fejlesztői panel, PDF-szerver.
**Új:** munkavállalói nyilvántartás, adat-vezérelt sémával, amiből bármikor előáll a Horizontes adatbekérő xlsx.

A felderítés két kulcs-megállapítása:

- **A szétválasztás tiszta.** A `docgen.js` **egyetlen hivatkozást sem tartalmaz** az `ImportModule`/`EhModule` felé (és fordítva sem). Nincs mit szétszálazni — csak drótozást eltávolítani.
- **Az adatforrás cseréje kicsi felület.** A mai Excel-alapú betöltés a `docgen.js`-ben mindössze **~95 sor** (1226–1320, 1909–1936).

## 2. Fő döntések

| Téma | Döntés |
|---|---|
| Refaktor módja | Strukturált átépítés (a bevált service-réteg marad, a 3124 soros `docgen.js` szétszedve) |
| Séma | **Adat, nem kód.** JSON-ban tárolt, UI-ból szerkeszthető, verziózott, migrációval |
| Azonosítás | Belső állandó azonosító + külső azonosítók **teljes története** |
| Adatforrás | Excel-fájl helyett saját nyilvántartás |
| xlsx írás | **ExcelJS** hozzávétele (a SheetJS ingyenes kiadása nem tud stílust/validációt írni — 7.3) |
| PDF | Sávos stratégia, a generálástól függetlenítve; a sávot méréssel választjuk (9.) |
| Tárolás | Fájl-alapú JSON az elsődleges, IndexedDB tartalék; egyfelhasználós most, többfelhasználósra előkészítve |
| Git | Új, üres repó — a WHC-történet nem kerül át |

## 3. Mit másolunk át — és mit semmiképp

Fehérlistával másolunk, nem mappamásolással.

**Átmásolandó (~2,8 MB, javarészt vendor):** `vendor/*`; `js/services/{docx,fs,settings,excel}-service.js`; `js/{utils,logger,app}.js`; `js/modules/docgen.js` (szétbontásra); `css/{tokens,app}.css`; `app.html`, `print.html`.

**Kifejezetten NEM másolandó:**

| Elem | Miért |
|---|---|
| `.beva-update-token`, `BEVapp token.txt` | Élő GitHub PAT |
| `Sablonok/` (7,2 MB), `Kész fájlok/` (2,5 MB) | WHC ügyfélsablonok és legenerált iratok valós személyes adatokkal |
| `logs/`, `utmutato_kepek/` (1,2 MB) | Hibanaplók, képernyőképek valós nevekkel |
| `.git/`, `patches/`, `archív/`, `*.zip` | WHC-történet |
| `beva-pdf-server.ps1`, `beva-start.vbs`, `update.bat`, `tools/update-from-github.ps1` | Tiltott/irreleváns infrastruktúra |
| `js/modules/{import,eh,dev}.js`, `css/dev.css` | Elhagyandó funkciók |
| `docs/`, `assets/`, `README.md`, `CLAUDE.md`, `AGENTS.md` | WHC-specifikus — újraírandó |
| `index.html`, `js/login.js`, `css/login.css` | Bejelentkező képernyő — egyfelhasználós indulásnál felesleges |

Ezután `git init` a `DocGen`-ben, tiszta `.gitignore`-ral: kimeneti mappa, sablonok, **adatbázis-fájl**, naplók kizárva. Éles személyes adat soha nem kerül verziókezelésbe.

## 4. Célarchitektúra

```
DocGen/
  app.html, print.html
  css/            tokens.css, app.css, registry.css
  js/
    app.js  utils.js  logger.js
    schema/
      schema-store.js        ← séma betöltés/mentés/migráció  (a séma ADAT, nem kód)
      schema-editor.js       ← mezők szerkesztése UI-ból
      schema-from-xlsx.js    ← séma-javaslat egy xlsx sablonból (diff)
      value-codec.js         ← HU/EN enum kódolás/dekódolás  (a megtartott "parser")
    services/
      settings-service.js  fs-service.js  docx-service.js
      xlsx-read.js           ← SheetJS (beolvasás)
      xlsx-write.js          ← ExcelJS (stílusos kiírás)
      employee-repo.js       ← tároló: azonosítók, validáció, audit, mentés
    modules/
      registry/   registry-view.js  employee-form.js  xlsx-io.js
      docgen/     index.js  templates.js  selection.js  naming.js  generate.js  ui.js
      settings/   settings-view.js  schema-view.js
  tools/          pdf-proba/  (környezet-próba artefaktumok)
  data/           (gitignore-olt: config + adatbázis)
  test/           auto-tests.js
  TERV.md
```

Fülek: **Dokumentumok** · **Nyilvántartás** · **Beállítások** (ezen belül: séma, export profilok, PDF).

## 5. Azonosítás — a SAP-szám problémája

A SAP-azonosító **minden új tartózkodási engedéllyel változik**, és a régit nem adja ki újra. Így önmagában nem lehet kulcs, viszont a *történet* értékes: régi dokumentumok, hatósági ügyek a régi számra hivatkoznak.

**Modell:**

```
employee {
  id            ← belső UUID, soha nem változik, nem is jelenik meg sehol
  identifiers[] ← { type, value, validFrom, validTo, current }
                  type: sap | residence_permit | passport | tax | taj | ...
  fields{}      ← a séma szerinti adatok
  audit         ← createdAt / updatedAt / updatedBy / schemaVersion
  archived      ← puha törlés (kilépett dolgozó ne tűnjön el visszamenőleg)
}
```

Ebből következik:

- **Keresés bármelyik azonosítóra** — a két éve lejárt engedélyszámra is megtalálható az ember.
- **Import-párosítás:** ha az érkező azonosító egyezik *bármelyik* korábbival → ugyanaz a személy, az új azonosító `current`-té válik, a régi `validTo`-t kap. Nem keletkezik duplikátum.
- **Tartalék párosítás,** ha nincs azonosító-egyezés: vezetéknév + keresztnév + születési dátum (a Horizontes útmutató is ezt a hármast használja duplikátumszűrésre).
- Új engedély rögzítése a UI-ban egy lépés: „Új azonosító" → a régi automatikusan lezárul.

Ez egyben javítja a mai app valódi hibáját is: ott a kiválasztás kulcsa a *„Vezetéknév Keresztnév" szöveg*, így két azonos nevű dolgozó egybeolvad, és az egyikük dokumentuma nem készül el.

## 6. Séma — adatként, nem kódban

A meződefiníciók **JSON-ban élnek** és UI-ból szerkeszthetők. A kód csak *értelmezi* őket.

```json
{ "key": "sex", "group": "Alapadatok", "type": "enum", "required": false,
  "label": { "hu": "Neme", "en": "Sex" },
  "tags": ["Neme", "Nem"],
  "values": [
    { "id": "male",   "hu": "Férfi", "en": "Male",
      "accepts": ["male","m","férfi","ffi","f"] },
    { "id": "female", "hu": "Nő",    "en": "Female",
      "accepts": ["female","nő","no","noeoe","n"] }
  ]}
```

Ez az egy definíció szolgálja ki:

1. **A nyilvántartás űrlapját** — csoportosított, típushelyes mezők, enumból legördülő, kötelezőség-ellenőrzés.
2. **Az xlsx exportot** — oszlopsorrend, fejléckulcsok, enum-kódolás, dátumformátum (export profilon keresztül).
3. **Az xlsx importot** — az `accepts` lista miatt bármelyik írásmód felismerhető. *(A valódi Horizontes fájl önmagával sincs szinkronban: a cellakomment `ffi`/`noeoe`-t ír, a tényleges legördülő `male`/`female`-t. Az `accepts` ezt lekezeli.)*
4. **A dokumentum-jelölőket, kétnyelvűen** — a sablonok jelentős része HU-ENG kétnyelvű, ezért `{{Neme}}` → „Férfi", `{{Neme_EN}}` → „Male" ugyanabból a mezőből.
5. **A számított mezőket** — a mai `enrichClientRow` négy összefűzött mezője (`Anyja neve`, `Születési helye`, `Szállás cím`, `Állandó lakcím`) sémabeli `computed` mezővé válik, nem marad kódba drótozva.

**Séma-szerkesztő (Beállítások fül):** mezők listája csoportosítva, sorrend húzással, mező felvétele/módosítása/törlése; mezőnként: kulcs, HU/EN címke, típus, csoport, kötelezőség, enum-értékek szinonimákkal, dokumentum-jelölők.

**Védőkorlátok** (enélkül a szabad szerkeszthetőség adatvesztéssé válik):
- A `key` létrehozás után **nem szabadon írható** — átnevezés csak vezérelt migrációval (a meglévő rekordok együtt mozognak).
- Használatban lévő mező törlése **figyelmeztet**: hány rekordban van adat, melyik export profil és melyik sablon-jelölő hivatkozik rá.
- Minden sémaváltozás **verziót léptet**, a rekordok migrációval követik (hiányzó mező = üres, nem hiba).

**Séma-diff új sablonból:** ha jön egy új `munkavallaloi_adatbekero_sablon_*.xlsx`, az app beolvassa (fejlécsor + legördülők + kommentek), és **javaslatot** mutat: új mező / megszűnt mező / megváltozott enum-értékek — te döntesz, mit fogadsz el. Ez a konkrét válasz arra, hogy „ha változik az alap sablon xlsx, ne törjön el semmi".

**Kiinduló séma:** a jelenlegi adatbekérő 44 mezője *seed adatként* (nem kódként) — kötelező: `surname`, `forename`, `date_of_birth`, `citizenship`; öt enum-mező valódi legördülővel; dátumok ISO-ban.

## 7. Nyilvántartás

### 7.1 Tárolás

- **Elsődleges: JSON-fájlok lemezen**, File System Access API-val (a `FsService` már ezt a mintát használja):
  - `data/dokgen-config.json` — séma + export profilok + beállítások (**személyes adat nélkül**, így gépek közt szabadon vihető)
  - `data/dokgen-employees.json` — a rekordok
- **Tartalék: IndexedDB**, ha a fájl-API nem elérhető (nem Chromium-alapú böngésző).
- **Automata mentés** minden módosításnál + **időbélyeges biztonsági másolat** (utolsó N példány).
- Minden egy **repository-interfész** mögött, így a háttér cserélhető a UI érintése nélkül.

### 7.2 Felhasználók

Egyfelhasználós indulás, bejelentkező képernyő nélkül. A `Settings` per-user kulcsszerkezete megmarad, a repository felkészül a többfelhasználós módra (zárolás-fájl + „csak olvasható, ha más szerkeszti"). Közös hálózati meghajtó esetén ez ráépíthető.

### 7.3 „Mindig legyen belőle kiváló xlsx"

**Technikai buktató, amit előre tisztázok:** a SheetJS ingyenes kiadása **nem tud** cellastílust, kitöltőszínt, adatérvényesítést (legördülőt) és cellakommentet **írni**. Márpedig a Horizontes sablon minősége pont ezeken áll.

**Megoldás: ExcelJS** a vendor mappába (MIT, egyetlen böngészős JS-fájl, telepítés nélkül). Ezzel az export nem „egy tábla adat", hanem **teljes értékű adatbekérő sablon** — színezett fejléc, legördülők, magyar magyarázó kommentek, rögzített fejlécsor.

Két üzemmód: **üres sablon** (kitöltésre kiküldhető) és **feltöltött export** (a nyilvántartás szűrt tartalmával, importra kész).

Az **export profil** köti össze a sémát a célformátummal, és maga is adat — ha a Horizontes formátum változik, profilt szerkesztünk, nem adatbázist.

## 8. Docgen refaktor

| Új fájl | Mai forrás (sorok) | Tartalom |
|---|---|---|
| `docgen/index.js` | 87–206, 264–295, 475–502 | állapot, init, beállítás-perzisztencia, gyökér-render |
| `docgen/templates.js` | 1321–1604, 1937–2141 | sablonmappa, rekurzív beolvasás, csoportok, láthatóság |
| `docgen/selection.js` | 1226–1320, 1909–1936 | **kicserélve**: nyilvántartásból választás (ClientPicker megmarad) |
| `docgen/naming.js` | 1605–1733 | fájlnév-minta szerkesztő |
| `docgen/generate.js` | 2495–3046 | generálási ciklus, összegzés, folyamatjelző |
| `docgen/ui.js` | 503–1143 | oldalsáv/munkaterület render és eseménykötés |

Innen törlendő: PDF-szerver kliens (207–262); az automatikus PDF-összefűzés (2142–2494) önálló segédeszközzé alakul (9.).

**Kötelező apró javítások** (a felderítés találta):
- `app.js` a mentett `last_tab`-ot ellenőrzés nélkül állítja vissza → régi `"import"` érték esetén **üres képernyő**.
- `test/auto-tests.js` két `readFileSync` hívása (297., 438. sor) `try/catch`-en kívül van → a törölt fájlok miatt **az egész tesztfutás összeomlana**.
- `Settings.isAdmin()` fixen bedrótozott nevet használ — kikerül.

## 9. PDF — mérés, aztán megvalósítás

A mai megoldás azért szerver, mert böngészőből nem lehet Wordöt vezérelni: 127.0.0.1:3456, `-ExecutionPolicy Bypass`, HKCU URI-kezelő az automata indításhoz. Aumovio-nál ez tiltott; a Word az egyetlen biztos pont.

**Architekturális válasz: a PDF leválik a generálásról.** Az app feladata ott ér véget, hogy *helyes nevű DOCX-ek vannak egy mappában*; a konverzió külön lépés. Így a konverziós mód cserélhető anélkül, hogy a generáláshoz hozzányúlnánk.

| Sáv | Feltétel | Megoldás | Minőség |
|---|---|---|---|
| **T1** | Word + futtatható `.vbs` | `tools/convert-docx-to-pdf.vbs` — dupla kattintás, a mappa összes DOCX-ét PDF-esíti Word COM-mal. **Nincs szerver, port, registry, ütemezett feladat.** | teljes Word-hűség |
| **T1b** | Word + engedélyezett makró | ugyanez `.docm` makrógombként | teljes Word-hűség |
| **T1c** | egyik szkript sem | Explorer: fájlok kijelölése → jobb gomb → Nyomtatás, alapértelmezett nyomtató = *Microsoft Print to PDF* | teljes, de fájlnevenként rákérdez |
| **T2** | semmi | böngészős nyomtatás → „Mentés PDF-be" (`print.html` létezik, de **nyomtatási stíluslapot kell hozzá írni**) | korlátozott: fejléc/lábléc, tördelés, képelhelyezés sérülhet |

**Az 1. fázis kimenete egy környezet-próba csomag** (`tools/pdf-proba/`), amit az Aumovio-gépen végig lehet kattintani: elindul-e egy `.vbs`; enged-e a Word makrót; van-e *Microsoft Print to PDF*; Chromium-alapú-e a böngésző (a File System Access API miatt). **A mérés eredménye dönti el, melyik sáv épül meg alapértelmezettként** — a kód mindegyikre felkészül, de csak egyet csiszolunk ki.

**PDF-összefűzés:** a `pdf-lib` böngészőben tökéletesen összefűz meglévő PDF-eket — ez az egyetlen PDF-művelet, amihez semmilyen külső eszköz nem kell. Ezért önálló segédeszközként marad meg, nem a generálási ciklusba drótozva.

## 10. Végrehajtási fázisok

| # | Fázis | Kimenet |
|---|---|---|
| 1 | **Környezet-próba** + váz | `tools/pdf-proba/` kipróbálásra; fehérlistás másolás, `git init`, import/EH/dev/PDF-szerver eltávolítása, `last_tab` + tesztsuite javítás. **Ellenőrzés: a docgen fül a régi Excel-forrással még működik.** |
| 2 | Adatmodell | `employee-repo.js`: azonosító-történet, validáció, audit, mentés + biztonsági másolat |
| 3 | Séma mint adat | `schema-store.js` + migráció + `value-codec.js`; seed a 44 mezőből; öntesztek a kódolásra/dekódolásra |
| 4 | Nyilvántartás UI | lista, keresés (azonosító-történetre is), séma-vezérelt űrlap |
| 5 | Séma-szerkesztő | mezőszerkesztés védőkorlátokkal + séma-diff xlsx-ből |
| 6 | xlsx be/ki | ExcelJS bekötése, export profilok, üres sablon + feltöltött export, import párosítással |
| 7 | Docgen átkötés | adatforrás = nyilvántartás, stabil azonosítás, kétnyelvű jelölők |
| 8 | Docgen szétbontás | a 3124 soros fájl felbontása a 8. pont szerint |
| 9 | PDF | a bemért sáv megvalósítása + önálló összefűző |
| 10 | Zárás | `TERV.md`, rövid használati útmutató, végső tesztfutás |

Fázisonként megállok és mutatom az eredményt — az 1. fázis végén már fut az app, nem egy nagy dobásban készül el.

## 11. Verifikáció

- **Fázisonként:** `node test/auto-tests.js` zölden; böngészőben konzolhiba-mentesség.
- **Séma:** öntesztek arra, hogy minden enum minden `accepts` írásmódja helyesen dekódolódik, és mindkét nyelven renderelődik; sémaváltozás után a régi rekordok migrálódnak.
- **Azonosítás:** két azonos nevű dolgozó szétválik; régi (lejárt) azonosítóra is megtalálható a személy; ismételt import nem hoz létre duplikátumot.
- **Körbe-teszt:** a meglévő `munkavallaloi_adatbekero_sablon_20260805.xlsx` betöltése → nyilvántartás → xlsx export → a két fájl szerkezeti összevetése (oszlopsorrend, fejléckulcsok, legördülők, kötelező jelölés megmarad).
- **Docgen:** kétnyelvű behelyettesítés (`{{Neme}}` = Férfi, `{{Neme_EN}}` = Male) próbasablonon.
- **PDF:** a bemért sáv tényleges kipróbálása az Aumovio-gépen, valós sablonnal.

## 12. Nyitott kérdések (nem blokkolják a munkát)

1. **PDF-sáv** — az 1. fázis próbacsomagja dönti el.
2. **Felhasználók száma és az adat helye** — egyfelhasználósra épül, többfelhasználósra előkészítve.
3. **Adatvédelem** — a nyilvántartás útlevélszámot, TAJ-t, adóazonosítót, anyja nevét és bért tárol; ez GDPR-értelemben érzékeny kör. Az app minden adatot helyben tart, semmit nem küld ki, és az adatbázis-fájl nem kerül verziókezelésbe. A tárolás helyét (helyi gép vs. céges meghajtó) érdemes az adatvédelemért felelőssel egyeztetni, mielőtt éles adat kerül bele.
4. **SAP-átfedés** — ha később kiderül, hogy bizonyos mezőket az SAP-ból lehetne exportálni, az az xlsx-import ágon egy új *import profil* lesz, kódmódosítás nélkül.
