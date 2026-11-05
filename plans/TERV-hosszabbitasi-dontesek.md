# Engedély-hosszabbítási döntések (K2) — terv

*2026-11-05. **Megvalósítva (v10.103)** — H0–H7, az eltérések a 9. fejezetben.
Kiindulás: a felhasználó fejlesztési igénye (0.), a kód feltárása (1.) és a
felhasználó válaszai négy kérdéskörben (2.).*

## 0. A kérés

**Ma:** a külföldi munkavállalók engedélyének hosszabbításáról e-mailben és
Excelben dönt a cég. A HRBP kiküldi a K2 vezetőnek, a K2 a HRBP-nek válaszol, a
HRBP továbbítja a HR ügyintézőnek, és az ügyintéző intézi a hosszabbítást.
**A két fő baj:** nagy az adminisztrációs teher, és utólag nem lehet
visszakövetni, ki mikor mit döntött.

**A cél:** a K2 vezető a DocGen-be belépve rögzíti a döntést. A döntés
naplózva van, a HRBP és az ügyintéző mindent lát, és mindenki személyre
szabott összesítőt kap arról, mi változott és mi vár rá. Push-üzenet és e-mail
nincs, mert az app offline.

| Ki | Lát | Rögzít |
|---|---|---|
| **K2 vezető** | azokat a dolgozókat, akiknek ő a K2-je | **döntést** (egyedül ő, a saját dolgozóira) |
| **Közvetlen vezető** | a saját dolgozóit | semmit, **csak olvas** |
| **HRBP** | **mindenkit** | döntést bárki nevében (helyettesítés) |
| **HR ügyintéző** | mindenkit | döntést nem; ő intézi az ügyet |
| **Legfőbb admin** | mindent | mindent |

## 1. Amit a kód már tud: erre épül, nem mellé

| Meglévő elem | Hol | Mire jó itt |
|---|---|---|
| Fiókok, PIN, belépés | `auth-service.js`, `TERV-fiokok.md` | a K2 belépése; minden naplósor egy valódi fiókhoz tartozik |
| Szintek **adatként** | `roles.js` (`ROLE_ACTIONS`, `SEED_ROLES`, `knownActions`) | 4 új művelet (3.10); a beépített szintek frissítéskor megkapják |
| **`hr_k2` mező** („K2”, SAP-ból, `hr_belso`) | `seed-schema.js:488` | **a K2-kötés**: ma szabad szöveg, fiókhoz kell kötni (3.1) |
| `hr_direct_leader` + `Leaders` | `leaders.js` | a közvetlen vezető olvasási köre; a fiókválasztós, átnevezést követő minta a `hr_k2`-re is |
| Vezetői hierarchia + **időszakos helyettes** | `Auth.visibleLeaderNames`, `deputies` | a K2 helyettese (3.6) |
| `hr_hrbp` mező | `xlsx-io.js` | a HRBP-értesítések címzettje (3.9) |
| `expiration_of_rp` | séma | a napszám alapja |
| `rp_hosszabbitas` ügytípus, **benyújtási ablak** (-90 / -40 / -10) | `case-types.js:99` | az ügyintézői ág; az ablak **átáll** (3.2) |
| `CaseRepo.suggestRenewals` + „Nincs még ügye” blokk | `case-repo.js:1238`, `cases-dashboard.js` | az ügyintéző teendője **már létezik**; kiegészül a K2 állapotával (3.8) |
| `emp.noRenewal` („nem hosszabbítjuk”), előzménnyel | `employee-repo.js:13` | a „Nem” döntés ügyintézői oldala (3.8) |
| Fájl-háttér + frissesség-ellenőrzés | `createFileBackend`, `TERV-adatbiztonsag.md` 7. | az új naplófájl (3.4) |
| `ClientPicker.inline` (keresés, szűrés, rendezés, xlsx, nyomtatás) | `allapot.js`, `registry-view.js` | a listák (3.7) |
| „Ügyállás” fül (megtekintő) | `allapot.js` | minta a vezetői felülethez |

**Ami hiányzik:** a K2 és a fiók kötése, a döntésnapló, a sávok, az értesítések
és a vezetői döntési felület.

## 2. A felhasználó döntései (2026-11-05)

| Kérdés | Döntés |
|---|---|
| Ki a K2? | a **`hr_k2` mező**, fiókhoz kötve, ugyanúgy, mint a Közvetlen vezető mező (választéklista, átnevezéskor a mező is frissül) |
| Adathozzáférés | **közös adatmappa, felületi szűkítés**; később NTFS és kivonat (`TERV-fiokok.md` 2., 4.) |
| Sávhatárok | a második sáv **179–120** (a „179–20” elírás volt); a benyújtási ablak **-90 / -45 / -15**, egy forrásból |
| A döntés módosítása | **bármikor**, de ha már fut a hosszabbítási ügy: indoklás kell, és a HRBP meg az ügyintéző **erős, nyugtázandó** figyelmeztetést kap |
| A döntés tartalma | **Igen / Nem + opcionális indoklás**. A további mezőknek utólag könnyen hozzáadhatónak kell lenniük (5.) |
| Közvetlen vezető | **csak olvas** |
| A K2 helyettese | **dönthet**, naplózva („X, Y K2 helyetteseként”) |
| Az ügyintézőnél | **teendő + egy kattintás**; nincs automatikus ügynyitás |

**Második kör, a nyitott kérdések lezárása (2026-11-05):**

| Kérdés | Döntés |
|---|---|
| Hány vezető, eléri-e a mappát | **10–50 fő, mind eléri** Chrome-mal vagy Edge-dzsel → kell egy rövid bevezető útmutató (H7) |
| HRBP-értesítések | **a saját dolgozói** (`hr_hrbp`) **+ kapcsoló** a mindenkiére; ha a `hr_hrbp` üres, minden HRBP megkapja |
| A K2 jegyzete | **közös**, a HRBP és az ügyintéző is látja; a mező alatt felirat jelzi |
| Bevezetéskori átvétel | **a legfőbb admin intézi**; a januári lejárók döntései már megvannak (7.1) |
| A napló megőrzési ideje | **egyelőre korlátlan**, nincs törlés |
| ≤ 14 nap / lejárt, döntés nélkül | **csak jelzés a listában**, külön értesítés nincs |
| Tartózkodási cél össz-időkorlátja | **nem kell**, az ügyintéző tudja |
| Forrás és tényleges nap, ha a HRBP vagy az admin rögzít | **egyik sem kötelező**; a forrás opcionális mező, a döntés ideje a rögzítés ideje |

### 2.1 Amit nem kérdeztem, csak feltételeztem (felülírható)

- **Az ügyintéző nem dönt.** Ha mégis kell, az egy jog a szintek rácsán, kód
  nélkül bekapcsolható.

## 3. A terv

### 3.1 Ki kicsoda: kapcsolat, nem szint

A K2-ség **kapcsolat a dolgozóval, nem jogosultsági szint.** Ugyanaz az ember
lehet az egyik dolgozó K2-je és egy másik közvetlen vezetője. Ezért:

- **A K2 dönthet egy dolgozóról, ha** a szintjén van `renewals.decide.own`
  joga, és a dolgozó `hr_k2` mezője (ékezet- és kisbetű-függetlenül,
  `Auth.fold`) **az ő neve**, vagy **ma helyettesíti** azt a K2-t.
- **A vezető olvashatja a dolgozót, ha** `renewals.read.own` joga van, és vagy
  K2-ként a fenti módon kötődik hozzá, vagy közvetlen vezetőként
  (`hr_direct_leader` ∈ `visibleLeaderNames`, ahogy ma az Ügyállásban).
- **A HRBP és az admin** (`renewals.decide`) bárkiről dönthet. A naplóban
  „<HRBP>, <K2> nevében, forrás: …” áll.
- **`hr_k2` = fiók:** a `Leaders` mintája szerint. Az űrlapon lenyíló lista
  lesz, az átnevezés a mezőt is átírja (`renameCascade`), és az import jelzi a
  nem fiók neveket. A `Leaders.FIELD` helyett `Leaders.FIELDS = [hr_direct_leader, hr_k2]`.
- **K2 nélküli dolgozó** (üres a mező, vagy a név nem fiók): nem tűnik el
  csendben, hanem a HRBP adatminőség-blokkjába kerül (3.7).
- **Átszervezés** (egy SAP-frissítés átírja a `hr_k2`-t): a függő sorok
  automatikusan az új K2-höz kerülnek, mert a kapcsolat a mezőből jön. A
  korábbi döntéseknél a napló a döntő nevét őrzi. Az új K2 értesítést kap.

### 3.2 Napszám és sávok

`napok = expiration_of_rp − ma`, naptári napban. Ugyanazzal a számítással,
mint a `suggestRenewals`, hogy a két kép ne térjen el.

| Napok | Sáv | Szín (javaslat) | Jelentés |
|---|---|---|---|
| 365–180 | Tájékoztató | semleges (nincs háttér) | döntés még nem kell, de lehet; jegyzet felvehető |
| 179–120 | Közeleg | halvány szürkéskék | lassan releváns |
| 119–90 | **Döntés esedékes** | sárga | itt kell dönteni; az előkészítés pár hét, és 90 naptól adható be a kérelem |
| 89–60 | Késésben | narancs | nem ideális, de teljesíthető |
| 59–45 | Utolsó lehetőség | piros | 45 nap: a jogszabályi beadási határidő |
| 44–15 | Csak vis maior | sötétpiros | |
| 14–0 | Már nem adható be | fekete | jogilag nem nyújtható be |
| < 0 | Lejárt | fekete, áthúzott dátum | (nem szabadna előfordulnia; ha mégis, legfelül áll) |

- **A szín mellett mindig ott a felirat is** (színtévesztés, nyomtatás).
- **Egy forrás.** A **90 / 45 / 15** határ a `rp_hosszabbitas` benyújtási
  ablakából jön (`earliestDays` / `latestDays` / `finalDays`), ami már most is
  adat. A **365 / 180 / 120 / 60** a `docgen-config.json` → `hosszabbitas.savok`
  kulcsban van, seeddel a kódban. Egy határ átírása így mindenhol érvényes.
- **Az ablak átállása** -90/-40/-10-ről **-90/-45/-15-re**. Elég a seed: a
  `CaseTypes.normalize` a beépített típust mindig a seedből veszi, a configból
  csak a sablonlistáját — az ablak a felületen nem is szerkeszthető. Migráció
  ezért **nem kell** (az ellenőrzés javítása, 9.). A `case-repo.js` feliratai
  átálltak: a −45 „Benyújtási határidő” (jogszabályi), utána „csak vis maior”.
- **Egy pure függvény** (`Hosszabbitas.sav(napok)`) dönt a sávról. Erre egy
  határérték-teszt készül: 365, 180, 179, 120, 119, 90, 89, 60, 59, 45, 44, 15,
  14, 0 és -1 nap.

### 3.3 Mi kerül az 1. listára („Döntésre vár”)

Aktív (nem kilépett) dolgozó, akinek van `expiration_of_rp`-je, a napok
száma **≤ 365** (a lejártak is benne vannak), és **az aktuális körben nincs
döntése.**

**A kör:** az aktuális kör az utolsó **lezárt** `rp_hosszabbitas` ügy óta
tart. Ebbe az időszakba eső döntés számít; ami korábbi, az már egy előző
engedélyről szólt. Ehhez nem kell új azonosító: amikor az ügyintéző lezárja a
hosszabbítást, és beíródik az új lejárat, magától új kör nyílik.
- A döntés eltárolja azt a lejáratot is, amire szólt. Ha a lejárat a döntés
  óta megváltozott (adatjavítás), és közben nem zárult hosszabbítás, a sor
  ⚠ jelet kap („a lejárat a döntés óta módosult: régi → új”). A döntés nem
  vész el, és nem is költözik át magától.
- Ha a HR már bejelölte a „nem hosszabbítjuk” jelzést (`noRenewal`, például
  mert a dolgozó felmondott), a sor „HR: nem hosszabbítjuk” jelzést kap, és
  nem jár rá értesítés.

### 3.4 A döntésnapló: új fájl, csak hozzáfűzés

**`data/docgen-hosszabbitas.json`**, a `createFileBackend`-en.

```json
{ "version": 1,
  "events": [
    { "id": "…", "at": "2026-11-05T09:14:32.123Z",
      "tipus": "DONTES",
      "empId": "…", "nev": "…", "torzsszam": "…", "k2": "Kiss Anna",
      "lejarat": "2027-03-01", "napok": 116, "sav": "esedekes",
      "dontes": "igen", "elozo": null,
      "mezok": { "indoklas": "" },
      "rogzitette": "Kiss Anna", "minoseg": "k2",
      "forras": null, "ugyFutott": false } ] }
```

- **Típusok:** `DONTES`, `MODOSITAS` (az `elozo` mezőben ott a korábbi
  döntés), `JEGYZET`, `NYUGTA` (egy erős figyelmeztetés tudomásulvétele).
  A `minoseg` értéke `k2`, `helyettes` vagy `hrbp`. A `forras` (e-mail,
  telefon, személyesen, egyéb + megjegyzés) opcionális (2.).
- **Csak hozzáfűzés.** Eseményt nem írunk át és nem törlünk. A mostani állapot
  az események összegzése. A módosítás is egy új sor, ezért a napló maga a
  „nagyon pontos” történet: ki, mikor (ezredmásodpercig), milyen minőségben,
  miről mire, melyik lejáratra, hány nappal előtte és melyik sávban döntött.
- **Pillanatkép a sorban** (név, törzsszám, K2, lejárat, napok, sáv): a napló
  akkor is olvasható marad, ha a dolgozó adata később változik vagy a dolgozót
  törlik. Ugyanebből számolható az is, hogy időben döntöttek-e (7.4).
- **Miért külön fájl, és nem a `docgen-cases.json`:**
  1. **Sok író van.** A K2-k nem ütközhetnek a HR napi munkájával a dolgozói
     és az ügyfájlban.
  2. **NTFS (2. fázis).** A vezetőknek írási jog **csak erre az egy fájlra**
     kell, a nyilvántartásra nem.
  3. **A K2 soha nem írja a dolgozói fájlt.** A „Nem” döntés ezért nem
     állítja át közvetlenül a `noRenewal`-t, hanem az ügyintéző veszi át (3.8).
- **Párhuzamos írás: itt SZABAD összefésülni.** A `TERV-adatbiztonsag.md` 7.
  azért tiltja az automatikus összefésülést, mert rekordszintű ütközéshez
  feloldó felület kellene. Hozzáfűzött, egyedi azonosítójú eseményeknél nincs
  ütközés. Ha mentéskor `StaleWriteError` jön, újraolvasunk, az eseményeket
  `id` szerint egyesítjük, és újra írunk. Így a K2 nem kap „töltsd újra”
  hibát. Ha ugyanarról a dolgozóról két döntés futott be párhuzamosan
  (például a K2 és a HRBP egyszerre rögzített), mindkettő megmarad, a későbbi
  érvényes, és a sor „párhuzamos rögzítés” jelzést kap.
- **Az idő a gép órája.** Ha egy gép órája rossz, a napló is rossz lesz. Ez
  ismert korlát; ugyanígy működik a fiók-audit is.

### 3.5 A döntés módosítása

- **Mielőtt az ügyintéző elindítja az ügyet:** a K2 szabadon módosíthat, az
  indoklás nem kötelező. A sor mindkét felületen **„Módosítva”** jelzést kap
  (narancs, a módosítások számával). Rákattintva látszik az előzmény: mi volt,
  mi lett, ki és mikor módosította.
- **Ha már fut a hosszabbítási ügy** (van nyitott `rp_hosszabbitas` ügy):
  - kötelező az indoklás (`ugyFutott: true`);
  - a HRBP és az ügyintéző **piros, nyugtázandó** figyelmeztetést kap. Amíg
    valaki tudomásul nem veszi (`NYUGTA` esemény), a figyelmeztetés az
    összesítőjük tetején és a soron is megmarad;
  - ha a módosítás **Igen → Nem**, az ügyintéző teendőt kap: „A K2 visszavonta
    — a kérelem visszavonása?”.

### 3.6 Helyettesítés

- **A K2 helyettese** (a meglévő `deputies`, kezdő és záró dátummal) a
  helyettesítés ideje alatt dönthet. A naplóban `minoseg: "helyettes"` és a K2
  neve áll.
- **A HRBP mindig rögzíthet**, opcionálisan forrással (2.). A K2 értesítést kap arról,
  hogy a nevében döntöttek, így ha nem ért egyet, szólhat.

### 3.7 Felület: egy új fül, „Hosszabbítások”

Minden szintnek ugyanaz a fül, de a tartalma a jogok szerint más. A listák a
`ClientPicker.inline`-ra épülnek, saját `storageKey`-jel, így a keresés, a
szűrés, a rendezés, az oszlopválasztás, az xlsx-export és a nyomtatás készen
van.

**1. lista: Döntésre vár.** Oszlopok: Dolgozó · Közvetlen vezető · (HRBP
nézetben: K2) · Lejárat · Hátralévő nap · **Sáv** (szín + felirat) · Utolsó
jegyzet. A sorrend a hátralévő napok szerint növekvő. A K2-nél a soron
**„Döntés…”** gomb van, a közvetlen vezetőnél nincs gomb.

**2. lista: Döntések.** **Két jól elkülönülő szakaszban:** ✔ **Hosszabbít**
(zöld) és ✖ **Nem hosszabbít** (piros). Oszlopok: Dolgozó · **Döntés ideje**
· Ki rögzítette (K2 / helyettes / HRBP, kinek a nevében) · „Módosítva” jelzés
· **Ügy állása** (Nincs még ügy / Előkészítés / Beadva / Hiánypótlás /
**Engedélyezve ÉÉÉÉ-HH-NN-ig** / Elutasítva). A K2 és a közvetlen vezető így
e-mail nélkül is látja, hol tart az ügy, és meddig kapta meg a dolgozó az
engedélyt. Szűrővel a lezárt (korábbi) körök is megjeleníthetők.

**A döntés párbeszédablaka.** A tévesen kijelölt sor a legvalószínűbb hiba,
ezért **a listában nincs egykattintásos Igen/Nem gomb.** A párbeszédablak
kiírja a nevet, a törzsszámot, a lejáratot, a hátralévő napokat és a sávot,
alatta a választás (Hosszabbít / Nem hosszabbít) és az indoklás következik
(opcionális; kötelező, ha az ügy már fut). HRBP-nél ehhez jön még: kinek a
nevében, és opcionálisan a forrás. A jegyzet mezője alatt felirat jelzi:
„A HR is látja.”

**Előzmény (soronként).** A dolgozó összes eseménye minden körből.

**HRBP és ügyintéző nézet.** Ugyanez a két lista mindenkire, szűrőkkel (K2,
HRBP, sáv, döntés). Ezen felül:
- **Adatminőség** blokk: aktív dolgozó lejárat nélkül; K2 nélkül; a K2 nem
  fiók. **Ez a legfontosabb blokk:** aki itt van, az az 1. listából némán
  kimaradna.
- **Teljes napló:** minden esemény, szűrhető és exportálható.

**Beállítások → „Hosszabbítások” kártya** (`settings.schema` joggal): a négy
saját sávhatár (365 / 180 / 120 / 60), illetve hivatkozás az ügytípus
ablakára (90 / 45 / 15).

### 3.8 Az ügyintézői ág

A meglévő **Ügyek → Áttekintés → „Nincs még ügye”** blokk (`suggestRenewals`)
**két részre válik**:
- **„Indítható — a K2 jóváhagyta”**: a K2 döntésének dátumával. Ez a 90 napos
  horizonttól függetlenül megjelenik, mert az „Igen” általában 120 nap körül
  születik, és az előkészítés heteket vesz igénybe. Egy gombbal megnyílik a
  hosszabbítási ügy (a meglévő ügyűrlap, előtöltve). Az ügy hivatkozik a
  döntésre.
- **„K2 döntésre vár”**: tájékoztató, a sávval együtt.

**„Nem” döntésnél** egy külön teendő jelenik meg: „Nem hosszabbít — átvétel”.
Az ügyintéző egy kattintással bejelöli a meglévő „nem hosszabbítjuk” jelzést
(`noRenewal`, `source: 'k2'` előzménnyel), innen indulnak a kilépés teendői.
Ezt **azért nem a K2 állítja**, mert a K2 nem ír a dolgozói fájlba (3.4).
Ha a K2 később Igenre módosít, erős figyelmeztetés jön (3.5), és az
ügyintéző visszaveszi a jelzést.

**Lezáráskor** (engedélyezve, új lejárattal, vagy elutasítva) a K2 és a
közvetlen vezető értesítést kap: „X engedélyét ÉÉÉÉ-HH-NN-ig
meghosszabbították”. Ez az ügyből számolódik, nem kerül külön eseményként a
naplóba, így egy forrás marad.

### 3.9 Értesítések: offline, lekérdezéses összesítő

**Nincs push és nincs e-mail.** Belépéskor, ha van új tétel, megnyílik egy
személyre szabott **„Összesítő”** ablak csoportokba rendezve. A fejlécben egy
csengő mutatja az olvasatlan tételek számát. Az ablakból bármelyik tételre
kattintva a hozzá tartozó sorra ugrunk.

**Az értesítések nincsenek eltárolva, hanem kiszámoljuk őket** a naplóból, az
ügyekből és a sávokból. Ezt egyetlen pure függvény végzi (`ertesitesek(fiók,
ma)`), ami Node-tesztelhető. Csak kétféle állapotot tárolunk:
- **olvasott / olvasatlan:** a böngésző `localStorage`-ában, fiókonként. Ez
  kényelmi funkció: ha elvész vagy másik gépről lép be valaki, a tételek újra
  olvasatlannak látszanak, ami nem okoz kárt;
- **nyugtázás** (erős figyelmeztetésnél): üzleti tény, ezért `NYUGTA` esemény
  kerül a naplóba, névvel és időponttal.

| Címzett | Mikor | Erősség |
|---|---|---|
| K2 | döntés nélküli dolgozója **sávot vált** (119 → esedékes; 89; 59; 44) | normál → sürgős |
| K2 | a nevében rögzítettek (HRBP vagy helyettes) | normál |
| K2 | átszervezés miatt új dolgozó került hozzá döntésre várva | normál |
| K2, közvetlen vezető | az ügyintéző lezárta az ügyet: **meddig kapta meg** / elutasítva | normál |
| HRBP | K2-döntés született | normál |
| HRBP | **a K2 módosította a korábbi döntését** | **erős**; nyugtázandó, ha az ügy már futott |
| HRBP | ≤ 90 nap, és még nincs döntés (eszkaláció) | sürgős |
| Ügyintéző | Igen → indítható; Nem → átvétel | teendő (az Áttekintésben is) |
| Ügyintéző, HRBP | módosult a döntés egy folyamatban lévő ügynél | **erős, nyugtázandó** |

A sávváltás azért jó kulcs, mert minden új sáv **egy** új tételt ad, nem
naponta egyet. A **„Már nem adható be” (≤ 14 nap) és a „Lejárt” sáv nem ad
értesítést**, csak a listában jelzi magát (2.). Ennél korábban a 90 napos
eszkaláció már szólt.

**A HRBP értesítései** alapból a saját dolgozóira vonatkoznak (`hr_hrbp`); egy
kapcsolóval mindenkiét látja. Ha a `hr_hrbp` üres, minden HRBP megkapja (2.).

### 3.10 Jogok: négy új művelet a szintek rácsán

| Művelet | Címke | Seed |
|---|---|---|
| `renewals.read` | Hosszabbítások: mindenki | admin, ügyintéző, HRBP |
| `renewals.read.own` | Hosszabbítások: a saját dolgozói | megtekintő |
| `renewals.decide.own` | Döntés K2-ként (ahol ő vagy akit helyettesít a K2) | megtekintő |
| `renewals.decide` | Döntés bárki nevében | admin, HRBP |

- A beépített szintek a `knownActions` mechanizmussal frissítéskor megkapják
  az új műveleteket, a saját szintek nem (`TERV-fiokok.md` 8.4). Erre teszt
  készül.
- A **„Csak megtekintő”** név félrevezető lesz, mert ez a szint mostantól
  dönt. **Javaslat:** a seedben legyen „Vezető”; az élő példányban az admin
  egy átnevezéssel állítja át.

### 3.11 Adatvédelem

- **1. fázis (a felhasználó döntése):** a vezetők a közös mappát használják. A
  szűkítés felületi, nem adatvédelmi. A README-nek ezt ki kell mondania,
  ahogy a megtekintőnél is (`TERV-fiokok.md` 2.).
- **2. fázis:** a `TERV-fiokok.md` 4. fejezetének NTFS-mátrixa kap egy új
  sort: a `docgen-hosszabbitas.json`-ra a vezetők **írási** jogot kapnak. A
  dolgozói fájl helyett egy kivonatot olvasnak (név, törzsszám, lejárat, K2,
  közvetlen vezető, ügy állása), az `allapot-kivonat` mintájára.
- Az **indoklás** a dolgozóról szóló, munkaviszonyt érintő adat, és a
  naplóból nem törölhető. A mező alatt egy felirat jelzi: „Röviden,
  tényszerűen. A napló nem törölhető.”
- **Megőrzési idő: egyelőre korlátlan** (2.). Ha később lesz határidő, egy
  dolgozónkénti törlés utólag hozzáadható, mert a napló dolgozó szerint
  szűrhető; a törlés ténye maga is naplózandó.

## 4. Amit szándékosan nem építünk

- **Push-üzenet, e-mail:** az app offline; helyette az összesítő ablak van (3.9).
- **Privát jegyzet:** közös fájlban nem lehet valódi; ami látszatvédelmet
  adna, azt nem építjük (2.).
- **Automatikus ügynyitás:** a felhasználó a teendőt választotta (2.).
- **Javaslat a közvetlen vezetőtől:** a felhasználó döntése szerint csak olvas.
- **Konfliktusfeloldó felület:** a hozzáfűzéses naplóban nincs ütközés (3.4).
- **Kriptográfiai napló-védelem (hash-lánc):** a párhuzamos hozzáfűzés
  elágaztatná a láncot. A napló jóhiszemű visszakövetésre szolgál, mint a
  fiók-audit. A valódi védelmet az NTFS adja.
- **Valós idejű frissítés:** a naplófájl fülváltáskor és a böngészőablak
  visszatérésekor (`visibilitychange`) töltődik újra. Ennél többre nincs szükség.

## 5. Utólagos döntési mezők — „mennyire egyszerű?”

**Egyszerű, ha az elejétől adatként építjük, és így építjük.** A projekt
saját elve: a séma, az ügytípusok és a szintek is adatok.

- A döntés űrlapjának mezői **adatként** élnek: `docgen-config.json` →
  `hosszabbitas.mezok`, seed a kódban. Most egyetlen mező van:
  `{ key: 'indoklas', type: 'textarea', label: 'Indoklás', kotelezo: false }`.
- A párbeszédablak a listából **általánosan rajzol**. Az esemény a
  `mezok: { … }` objektumban tárolja az értékeket.
- **Új mező felvétele** (például „Kért időtartam”, „Változik-e a munkakör”):
  **egy új bejegyzés a listában.** A régi döntéseknél ez a mező „—”-t mutat,
  migráció nem kell. Mező eltávolításakor a régi értékek a naplóban maradnak,
  csak az űrlapon nem jelennek meg.
- **Mezőtípusból** a séma meglévő típusai választhatók (szöveg, hosszú
  szöveg, dátum, választólista, jelölőnégyzet). Egy új típushoz kód kell,
  ugyanúgy, mint a sémánál.
- **Első körben** a lista a configban szerkeszthető. Felületi szerkesztő akkor
  kell, ha tényleg gyakran változik; akkor a Beállításokba kerül, az
  ügytípus-szerkesztő mintájára. Hogy az ügyfél-űrlap mezőrajzolója
  újrahasznosítható-e, a megvalósításkor derül ki.

## 6. Fázisok és ellenőrzés

```
H0  Sávok és ablak: Hosszabbitas.sav(), hosszabbitas.savok seed, rp_hosszabbitas
    ablaka -90/-45/-15 + egyszeri config-migráció, case-repo feliratok
    → Node: sávhatár-teszt (3.2), migráció: régi alap átáll, kézi érték marad
H1  K2-kötés: Leaders.FIELDS (hr_direct_leader, hr_k2), lenyíló lista,
    renameCascade, import-jelzés; k2Of(emp), dontethet(fiók, emp, nap) helyettessel
    → Node: K2 / helyettes / közvetlen vezető / idegen fiók; átnevezés a hr_k2-t is viszi
H2  Napló: HosszabbitasRepo (createFileBackend), hozzáfűzés, StaleWrite → egyesítés,
    állapot = összegzés, kör = az utolsó lezárt rp_hosszabbitas óta, lejárat-eltérés
    → Node: két munkamenet párhuzamosan ír → mindkét esemény megmarad; módosítás
      `elozo`-val; lezárt ügy után új kör; HRBP-rögzítés forrással és anélkül
H3  Jogok: 4 művelet, seed, kapuk
    → Node: mátrix-teszt; beépített szint megkapja, saját szint nem (knownActions)
H4  Felület: „Hosszabbítások” fül, 2 lista, döntés-párbeszéd, előzmény,
    HRBP-szűrők, adatminőség, teljes napló, Beállítások-kártya
    → céges gépen, kézzel (lent)
H5  Ügyintézői ág: az Áttekintés két része, egy kattintásos ügynyitás döntés-
    hivatkozással, „Nem” átvétele (noRenewal, source: 'k2'), visszavonás-teendő
    → Node: suggestRenewals + döntés-állapot; Igen→Nem futó ügynél teendő
H6  Értesítések: ertesitesek(fiók, ma), belépéskori összesítő, csengő, NYUGTA
    → Node: szabálytábla (3.9) soronként, szerepenként; sávváltás = 1 tétel
H7  README (mit véd és mit nem), TERV-fiokok 4. NTFS-sor, rövid bevezető
    útmutató a vezetőknek (10–50 fő: belépés, összesítő, döntés), bevezetés (7.1)
```

**Céges gépen, kézzel** (a Node-tesztek a DOM-ot és a File System Access API-t
nem fedik): belépés K2-ként → az összesítő ablak → döntés → kilépés → belépés
HRBP-ként → az értesítés és a sor „új” jelzése → K2-módosítás egy futó ügynél
→ a piros figyelmeztetés nyugtázása → ügyintézőként „Indítható” → ügy
lezárása → K2-ként „Engedélyezve …-ig”. A közvetlen vezetőnél nincs
döntésgomb. Két böngészőablakban egyszerre két döntés, és mindkettő
megmarad.

## 7. További javaslatok (amire esetleg nem gondoltál)

1. **Bevezetéskori átvétel.** A bevezetés napján minden ≤ 365 napos dolgozó
   „Döntésre vár”-ként jelenne meg, akkor is, ha e-mailben már döntöttek
   róla, így a K2-k újra döntenének. **A felhasználó döntése: a legfőbb admin
   intézi**; a januári lejárók döntései már megvannak. Az admin a meglévő
   döntési párbeszéddel, a K2 nevében rögzíti őket, import nem kell. Ajánlott
   forrás: „e-mail, bevezetés előtt”, bár nem kötelező. **Mellékhatás:** ezek
   a döntések a rögzítés napjával kerülnek a naplóba, ezért a 4. pont
   mutatójában későinek látszanak. A mutató a „bevezetés előtt” forrású
   sorokat kihagyja, vagy a bevezetés napja előtti időszakot nem méri.
2. **Adatminőség-blokk** (3.7): a lista csak annyira jó, amennyire az
   `expiration_of_rp` és a `hr_k2` megbízható. A hiányzó lejárat ma csendben
   kimarad.
3. **Eszkaláció:** ha 90 napon belül nincs döntés, sürgős értesítés megy a
   HRBP-nek (3.9). Opcionálisan a K2 felettesének is (a hierarchia megvan).
4. **„Időben döntött-e” mutató:** a döntéskori sáv a naplóban van, így mérhető
   a cél („a lehető legkorábban”), például: „a döntések 72%-a 120 nap előtt
   született”. A K2-nkénti bontás kényes, ezért csak a HRBP látja.
5. **Kapacitás-előrejelzés a HR-nek:** havonta hány engedély jár le a
   következő 12 hónapban, sávonként. Ugyanabból az adatból egy kis táblázat,
   ami az ügyintézők terhelésének tervezését segíti.
6. ~~**Tartózkodási cél, amelyik nem hosszabbítható tovább.**~~ **Elvetve
   (2.):** az ügyintéző tudja, a programnak nem kell jeleznie.
7. **Kilépő dolgozó:** a kilépéssel a nyitott kör magától lezárul, így nem
   maradnak zombi sorok.
8. **Egységes sávszínek:** a dolgozói adatlap csempéje (ma ≤ 90 nap:
   borostyán) és az Ügyek Áttekintés is a `Hosszabbitas.sav()`-ot használja,
   hogy egy dátumnak mindenhol ugyanaz legyen a színe.
9. **A „Nincs még ügye” horizontja** 90 napról 120-ra nőhet, mert innentől
   a K2 dönt, és az előkészítés heteket vesz igénybe.

## 8. Nyitott kérdések

**Mind lezárva** (2026-11-05, 2. kör; a döntések a 2. fejezet második
táblázatában). Ami később visszatérhet:
- **Megőrzési idő:** egyelőre korlátlan. Ha a HR vagy a jog határidőt ad,
  a 3.11 szerinti törlés utólag hozzáadható.
- **2.1 (az ügyintéző nem dönt):** feltételezés, a szintek rácsán kód nélkül
  átállítható.

## 9. Megvalósítás (v10.103) — az ellenőrzés javításai és az eltérések

**A terv ellenőrzésekor talált hibák (javítva a megvalósításban):**
- **Az ablak-migráció felesleges volt** (3.2): a beépített ügytípus ablaka
  mindig a seedből jön, így a −45/−15 a kiadással él.
- **A lezárt kör azonnal eltüntette volna az „Engedélyezve …-ig” sort** (3.7):
  a lezárással új kör nyílik, a 2. lista viszont csak az aktuális kört mutatta
  volna. Javítás: a lezárt kör döntése még **30 napig** (`LEZART_NAPOK`, mint az
  Ügyállásban) a 2. listán marad, „lezárt kör” jelzéssel; a *Korábbi körök is*
  jelölővel mind.
- **Az értesítések visszamenőleg nem lehetnek végtelenek** (3.9): másik gépen
  (üres olvasottság) évek eseményei jönnének „újként”. A naplóesemény- és
  ügylezárás-tételek **30 napig** élnek; a nyugtázandó tétel nyugtázásig.
- **Bevezetéskor minden K2 „új dolgozót” kapott volna** (3.9, átszervezés): a
  `hr_k2` első kitöltése is mezőváltozás. Az „új dolgozó került hozzád” tétel
  ezért csak **K2-cserénél** (volt előző K2) jön.
- **Az indoklás mező nem hagyható ki a configból** (5.): futó ügynél kötelező, így
  ha a `hosszabbitas.mezok` listából kimarad, a kód visszateszi.

**Ami másképp lett, mint a tervben:**
- **Nincs soronkénti „Döntés…” gomb** (3.7): a `ClientPicker` nem rajzol gombot
  a cellába. Helyette: sor kijelölése → **Döntés…** a műveleti sávon, vagy dupla
  kattintás a soron. A HRBP-szűrők (K2, HRBP, sáv, döntés) a tábla meglévő
  oszlopszűrői.
- **Az Összesítő tételére kattintva** a dolgozó **előzménye** nyílik meg (a
  Hosszabbítások fülön), nem a sor kijelölése — ott van a döntés gomb is.
- **Az ügyintéző teendői** az Áttekintésben egy blokkban: *K2-döntés — teendő*
  (átvétel, visszavétel, a kérelem visszavonása), külön *Indítható* blokk, és a
  régi „Nincs még ügye” címe „— K2 döntésre vár” lett, a sávval.
- **A HRBP-értesítés kapcsolója** az Összesítő tetején van (böngészőben,
  fiókonként tárolva).
- **Nem épült meg** (javaslat volt, nem döntés): 7.4 „időben döntött-e” mutató,
  7.5 kapacitás-előrejelzés, 7.8 egységes sávszínek az adatlapon, 7.9 a
  „Nincs még ügye” horizontja (maradt 90 nap). A 2. fázis kivonata (3.11) sem.

**Fájlok:** `js/services/hosszabbitas.js` (számítás, napló, értesítések),
`js/modules/hosszabbitas-view.js` (fül, párbeszédek, csengő, Összesítő,
Beállítások-kártya), `css/hosszabbitas.css`, `test/hosszabbitas.test.js`
(37 teszt: sávhatárok, ki dönthet, kör, párhuzamos írás, jogok, ügyintézői ág,
értesítési szabálytábla). Érintett: `roles.js`, `leaders.js`, `case-types.js`,
`case-repo.js`, `cases-dashboard.js`, `cases-view.js`, `case-form.js`,
`registry-view.js`, `employee-form.js`, `xlsx-io.js`, `settings-view.js`,
`app.js`, `index.html`, `README.md`, `TERV-fiokok.md` 4.

**Kézi ellenőrzés a céges gépen:** a 6. fejezet végén lévő menet. Böngészőben
(próba mód, memóriabeli adat) végigment: a fül, a sávok, a döntés és a módosítás
futó ügynél, a nyugtázás, az Összesítő, az Áttekintés blokkjai, a
Beállítások-kártya, és K2-fiókkal a szűkített nézet. A File System Access API-s
közös mappa és a két gépről egyszerre írás csak a céges gépen próbálható ki.
