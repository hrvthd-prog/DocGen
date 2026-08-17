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
