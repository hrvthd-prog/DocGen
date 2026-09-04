# Enter Hungary kitöltés-segéd — terv

> **Állapot: mind a hét fázis elkészült** (2026-09-04).
>
> | # | Fázis | Állapot |
> |---|---|---|
> | 0 | Ügyek fül javításai (lista-scroll, sortördelés) | ✅ `cases-view.js`, `cases.css` |
> | 1 | EH űrlapleírás + munkáltatói adatblokk | ✅ `js/schema/eh-forms.js` |
> | 2 | EH panel az ügy-részletezőben | ✅ `js/modules/cases/case-eh.js` |
> | 2b | Fél képernyős (960 px) elrendezés | ✅ `cases.css` |
> | 2c | Billentyűkezelés (Tab / Enter / F2 / Esc) | ✅ `case-eh.js` |
> | 3 | Inline szerkesztés → visszaírás a DB-be | ✅ séma-validációval |
> | 4 | Eltérés- és hosszjelzés a másolható mezőkön | ✅ |
>
> **Három dolog a megvalósításkor derült ki**, és mindhárom néma hibát okozott
> volna — a részletek a 12. pontban:
> a dátumok formázása, a séma-validáció megkerülése, és hogy az egész oldal
> görgött a panelek helyett.
>
> A terv **négy mentett EH űrlapon** alapul (2026-09-01 és 2026-09-04):
> a fő űrlap (`tipus=tartcelharm`) és a három munkavállalási lap —
> Vendégmunkás (`-c7`), EU Kék Kártya (`-c9`), Nemzeti Kártya (`-c12`) —
> valamint az `AUMOVIO Hungary Kft.` cégkivonatán (hatályos 2026-08-30).
>
> **Üzemi méret: 960 px széles ablak** (1920×1080, fele-fele dokkolva a
> DocGen és az EH között) — lásd 6.6.

---

## 1. A probléma

Az Enter Hungary űrlapját ma **kézzel, fejből, két ablak között ugrálva**
töltjük ki. Az adat mind megvan a DocGen nyilvántartásában, de:

- a **sorrend** más: a DocGen űrlapja téma szerint csoportosít
  (`seed-schema.js` `groups`), az EH a hatósági rovatsorrendet követi;
- a **mezőnév** más: „Vezetéknév" ↔ „családi név (útlevél szerint)";
- az **érték alakja** néhol más: a DB `Szerbia`-t tárol, az EH
  állampolgárság-legördülője `Szerb`-et vár;
- kitöltés közben derül ki, hogy **egy adat hiányzik vagy hibás** — ilyenkor
  most a Nyilvántartás fülre kell átmenni, ott megkeresni a dolgozót,
  szerkeszteni, menteni, majd visszatalálni az EH űrlapon oda, ahol tartottunk.

A cél tehát nem automatizálás, hanem **egy ablak, ami az EH sorrendjében
mutatja az adatot, egy kattintással másol, és helyben javíthatóvá teszi**.

### A funkció lényege a MÁSOLÁS

Ez a terv legfontosabb szűkítése, és minden későbbi döntést ez vezérel.

Az EH mezői két csoportra bomlanak, és a kettő **nem egyenrangú**:

| | Mi ez | Mit ér a panel | Mennyi kód |
|---|---|---|---|
| **Másolható** | `<input type=text/number>` — ide a vágólapról kerül az érték | **Ez a funkció maga.** Egy kattintás, és pontosan az kerül be, ami a DB-ben van | ide megy a munka |
| **Listás** | `<select>`, rádiógomb, checkbox — a böngésző csak a lista elemeit fogadja el | Csak tájékoztat: melyik értéket keresd a legördülőben | **minimális** |

Egy legördülőbe a vágólapról nem lehet értéket tenni, tehát az EH-oldali
kitöltés ott mindenképp kézi. Ezért a listás mezőkre **nem építünk
átalakító logikát**: nincs értékkonverzió, nincs formátum-normalizálás,
nincs megfeleltetési tábla. A panel megmutatja a tárolt értéket magyarul
(ez a `SchemaStore.resolveValues()`-ból ingyen jön), megjelöli, hogy listás,
és ennyi.

**Számokban** (a kész leírásból mérve, `test/eh-forms.test.js` őrzi): a fő
űrlap 41 DB-s mezőjéből **31 másolható és 10 listás**; a munkavállalási lapon
6 vs. 6; a cégadat-blokkban 33 vs. 10. Egy teljes kérelem (fő űrlap + c7)
**70 másolható mezőt** ad. A munka háromnegyede tehát oda megy, ahol számít.

## 2. Amit ez a terv NEM csinál

Kimondva, hogy később ne kelljen kitalálni, miért nincs benne:

- **Nincs Playwright / böngésző-automatizálás.** Az EH bejelentkezéshez kötött,
  és az űrlap `name` attribútumai bármikor változhatnak. Ez külön projekt
  lehet; a mostani adatréteg (4. és 6. pont) viszont pont az, amire egy
  későbbi kitöltő-robot ráépülhet — a leképezés nem vész kárba.
- **Nincs új adatkör.** Egyetlen új sémamezőt sem veszünk fel. Ami ma nincs a
  DB-ben (beutazás helye/ideje, nemzetiség, szakmai gyakorlat éve, korábbi
  büntetés…), az a panelen „kézzel" sorként jelenik meg, nem új rovatként.
  Ez tudatos döntés két helyen, ahol felmerült a bővítés: a szálláshely
  jogcíme és a részletes iskolai végzettség — mindkettő listás mező, ahol a
  sémabővítés amúgy sem spórolna kattintást.
- **Nincs hozzátartozó-kezelés.** A DB `hr_children` mezője szabad szöveg, az
  EH viszont hozzátartozónként 19 rovatot kér, nyolcszor. Gépi leképezés nem
  lehetséges. Ismert plafon, lásd 11.
- **Nincs beállítás-felület a cégadatnak.** Egy munkáltató van; a `EH_EMPLOYER`
  adatblokk egy helyen szerkeszthető (6.2). Ha több cég lesz, a config-fájlba
  költöztethető — de nem előre.

## 3. Az EH űrlapok szerkezete

Egy munkavállalási kérelem **két lapból** áll: a közös fő űrlap (személyes
adatok, útlevél, szálláshely) és a jogcím szerinti lap (foglalkoztatás,
munkáltató, készségek). A kettőnek **nincs közös mezője** — nem duplikálás,
hanem kiegészítés.

| Lap | `tipus` | Címe az EH-n | Mezők |
|---|---|---|---|
| Fő űrlap | `tartcelharm` | Tartózkodási engedély iránti kérelem | 90 (+ 8 × 19 hozzátartozó) |
| Vendégmunkás | `tartcelharm-c7` | Vendégmunkás-tartózkodási engedély | 103 |
| EU Kék Kártya | `tartcelharm-c9` | — | 95 |
| Nemzeti Kártya | `tartcelharm-c12` | — | 99 |

**A fő űrlap minden jogcímnél ugyanaz.** Ezt a rejtett mezők mutatják: a
`tipus` értéke generikusan `tartcelharm`, és egy külön `tartcel` hidden
hordozza a jogcímet (a mentésben `tartcelharm-c23`). Vagyis nem négy fő
űrlap van, hanem egy, négy jogcímértékkel. *(Feltételezés, a rejtett mezők
alapján — ha kitöltés közben mégis eltérés látszik, az egy-két sor a
leírásban, nem átépítés.)*

**A három munkavállalási lap 93 mezője azonos.** Az eltérés mindössze:

| Lap | Csak rajta | Mit jelent |
|---|---|---|
| c7 | `foglkoztatotip`, `btatv34`, `btatv34nap`, `btatv34szam` | kedvezményes foglalkoztató / kölcsönbeadó minősítés |
| c7, c12 | `tavorszag`, `kiutasitasceltip`, `kiutasitasceltipus`, `kiutasitascelengedely` | a nyilatkozat távozási része |
| c7, c9 | `mentessegmpiac`, `mentessegmpiachivpont` | munkaerőpiaci vizsgálat alóli mentesség |
| c12 | `atvetel`, `okmanyatvetelhelye` | okmány átvételének helye |

Ezért a leírás **egyetlen sorlista**, ahol a jogcím-specifikus sorok
`only: ['c7']` jelölést kapnak — nem három, 93 soronként másolt tömb (6.1).

### A fő űrlap paneljei

| # | Panel | Mezők | Ebből DB-ből |
|---|---|---|---|
| 1 | Tartózkodási engedély első kérelem/hosszabbítás | 6 | 2 |
| 2 | A kérelmező személyes adatai | 18 | 15 |
| 3 | A kérelmező útlevelének adatai | 6 | 5 |
| 4 | A kérelmező magyarországi szálláshelyének adatai | 11 | 10 |
| 5 | Teljes körű egészségbiztosítás feltételei | 2 | 0 (állandó) |
| 6 | A vissza- vagy továbbutazás feltételei | 8 | 2 |
| 7 | Eltartott hozzátartozók (ismétlődő blokk) | 8 + 8 × 19 | 0 |
| 8 | Magyarországra érkezést megelőző tartózkodási hely | 9 | 3 |
| 9 | Más schengeni tagállam okmánya | 4 | 0 |
| 10 | Egyéb adatok (elutasítás, büntetés, kiutasítás, betegség) | 11 + 8 gyermek-jelölő | 0 |
| 11 | A tartózkodás tervezett időtartama és indokai | 1 | 1 (támpont) |
| 12 | Az okmány átvétele | 4 | 2 |
| 13 | Nyilatkozat | 2 | 0 |

**90 mező**, ebből **40 a DB-ből**. A hozzátartozó-blokkokkal együtt 236.

### A munkavállalási lap paneljei (c7, 103 mező)

| # | Panel | Mezők | Ebből |
|---|---|---|---|
| 1 | Benyújtó | 1 | állandó |
| 2 | Levelezési címe | 10 | **cégadat** |
| 3 | Székhely | 10 | **cégadat** |
| 4 | Vízum átvételének helye | 2 | kézi |
| 5 | A kérelmező magyarországi megélhetésére vonatkozó adatok | 8 | 1 DB + 1 állandó |
| 6 | Magyarországi munkáltató adatai | 15 | **cégadat** |
| 7 | Foglalkoztató *(csak c7)* | 4 | állandó |
| 8 | Munkakör betöltéséhez szükséges szakképzettsége | 3 | 3 DB |
| 9 | Munkavégzés helye(i) | 23 | 11 cégadat + 2 DB |
| 10 | A munkakör ellátásához szükséges készségei, ismeretei | 17 | 6 DB |
| 11 | Nyilatkozat | 10 | kézi |

**A 103 mezőből ~46 állandó cégadat, 12 jön a DB-ből, a többi kézi vagy
nyilatkozat.** Ez a szám indokolja a `EH_EMPLOYER` blokkot: a lap közel fele
minden kérelemnél ugyanaz.

## 4. A leképezés

A `→` a DocGen sémakulcsot jelöli (`js/schema/seed-schema.js`).
**Jelöletlen sor** = másolható mező, az érték változtatás nélkül átvihető.
**⚠** = másolható mező, de az érték alakja eltér — lásd 5.1.
**⌄** = listás mező (legördülő/rádió): nem másolható, a panel csak tájékoztat — lásd 5.2.
**cég** = a `EH_EMPLOYER` blokkból (6.2).
**áll.** = minden dolgozónál ugyanaz, konstans az űrlapleírásban.
**—** = nincs a DB-ben, kézzel kell kitölteni.

### 4.1 Fő űrlap

#### 1. panel — Első kérelem / hosszabbítás

| EH mező (`name`) | EH címke | Forrás |
|---|---|---|
| `nemfizetek` | Kijelentem, hogy az eljárás díjmentes | áll. `nem` |
| `tartenghosszab` | Tartózkodási engedély meghosszabbítása | az **ügytípusból**: `rp_hosszabbitas` → `igen`, egyébként `nem` |
| `beutazashelye` | beutazás helye | — |
| `beutazasideje` | beutazás ideje | — |
| `elozotarengszama` | előző TE száma | → `number_of_rp` |
| `elozotarengideje` | előző TE érvényessége | → `expiration_of_rp` |

#### 2. panel — A kérelmező személyes adatai

| EH mező | EH címke | Forrás |
|---|---|---|
| `kerelmezonevelotag`, `…2` | előnév | — |
| `kerelmezocsaladnev` | családi név (útlevél szerint) | → `surname` |
| `kerelmezoutonev` | utónév (útlevél szerint) | → `forename` |
| `kerelmezoszulcsaladnev` | születési családi név | → `surname_at_birth` |
| `kerelmezoszulutonev` | születési utónév | → `forename_at_birth` |
| `kerelmezoanyjacsaladnev` | anyja születési családi neve | → `mothers_surname_at_birth` |
| `kerelmezoanyjautonev` | anyja születési utóneve | → `mothers_forename_at_birth` |
| `kerelmezoszulorszag` *(select, 252)* | születési ország | → `place_of_birth_country` ⌄ |
| `kerelmezoszulhely` | születési város | → `place_of_birth_locality` |
| `kerelmezoszulido` | születési idő | → `date_of_birth` |
| `kerelmezonem` *(select)* | neme | → `sex` ⌄ *(`Férfi`/`Nő` egyezik)* |
| `kerelmezoap` *(select, 218)* | állampolgárság | → `citizenship` ⌄ |
| `kerelmezonemzetiseg` *(select)* | nemzetisége | — |
| `csaladiallapot` *(select)* | családi állapot | → `marital_status` ⌄ *(`Nőtlen/hajadon`, `Házas`, `Elvált`, `Özvegy` egyezik)* |
| `szakkepzettseg` | szakképzettsége | → `professional_qualification` ⚠ M1 |
| `vegzettseg` *(select, 4 érték)* | iskolai végzettsége | → `educational_attainment` ⌄ *(a 4 érték egyezik)* |
| `kerelmezokulfoldifoglakozas` *(max 30)* | MO-ra érkezést megelőző foglalkozás | → `occupation_before_arrival` ⚠ M1, M2 |

#### 3. panel — Útlevél

| EH mező | EH címke | Forrás |
|---|---|---|
| `utlevelszama` | útlevél száma | → `pp_number` |
| `utleveltipus` *(select)* | útlevél típusa | → `passport_type` ⌄ |
| `utleveltipusegyeb` | éspedig | — |
| `kiallitashelye` | kiállítás helye | → `pp_issuance_place` |
| `kiallitasideje` | kiállítás ideje | → `pp_issuance_date` |
| `ervenyessegiideje` | érvényességi ideje | → `pp_validity` |

#### 4. panel — Magyarországi szálláshely

| EH mező | EH címke | Forrás |
|---|---|---|
| `iranyitoszam` | irányítószám | → `postal_code` |
| `telepules` *(max 27)* | település | → `locality` |
| `kozteruletneve` *(max 25)* | közterület neve | → `name_of_public_place` |
| `kozteruletjellege` *(select, 42, kisbetűs)* | közterület jellege | → `type_of_public_place` ⌄ |
| `hazszam` *(max 8)* | házszám/helyrajzi szám | → `street_number`, üresen → `topographical_number` |
| `epulet` | épület | → `building` |
| `lepcsohaz` *(max 4)* | lépcsőház | → `stairway` |
| `emelet` *(select)* | emelet | → `floor` ⌄ |
| `ajto` *(max 4)* | ajtó | → `door` |
| `tartjogcim` *(select)* | tartózkodás jogcíme | — ⌄ kézi |
| `tartjogcimegyeb` | éspedig | → `other_accommodation` |

> Ezt a szakaszt az EH maga is meg tudja jegyezni („adatok mentése" /
> „adatok beemelése" gomb, a mentésben `Szombathely`). A panel akkor is
> mutatja, mert szálláshelyből több van, és a mentett csak egy.

#### 5–6. panel — Egészségbiztosítás, visszautazás

| EH mező | EH címke | Forrás |
|---|---|---|
| `ebmagyartart` *(select)* | teljes körű egészségbiztosítás | áll. `Foglalkoztatási Jogviszony Alapján` |
| `ebmagyartartegyeb` | éspedig | — |
| `tovabborszag` *(select, 252)* | mely országba utazik vissza | → `citizenship` ⌄ *(itt **országnév** kell, egyezik)* |
| `mivel` | milyen közlekedési eszközzel | → `transport_type` ⚠ M3 *(`busz` / `repülő`)* |
| `utlevel`, `vizum`, `jegy`, `penz` | rendelkezik-e … | — (döntés, nem adat) |
| `osszeg`, `osszegpenznem` | összeg, pénznem | — |

#### 7. panel — Eltartott hozzátartozók

`hozzatartozo1…8` checkbox + blokkonként 19 rovat. A DB `hr_children` mezője
szabad szöveg. **A panel egyetlen sorként adja a nyers szöveget,** másolható
formában — a szétbontás kézi marad. Lásd 11.

#### 8. panel — Érkezés előtti tartózkodási hely

| EH mező | EH címke | Forrás |
|---|---|---|
| `moelotttarthelyorszag` *(select)* | ország | → `previous_country` ⌄ |
| `moelotttarthelytelepules` | település | → `previous_town` |
| `moelotttarthelykozteruletneve` | közterület neve | → `previous_street` ⚠ M4 |
| `moelotttarthelykozteruletjellege` | közterület jellege | — |
| `moelotttarthelyhazszam` | házszám | — |
| `…epulet`, `…lepcsohaz`, `…emelet`, `…ajto` | épület, lépcsőház, emelet, ajtó | — |

#### 9–13. panel

| EH mező | EH címke | Forrás |
|---|---|---|
| `schengeniokmany`, `engedelytipus`, `engdszama`, `engedelyerv` | schengeni okmány | — |
| `korabbielut`, `korabbibuntetes`, `orszag`, `korabbibuntetesdatum`, `bunticselekmenyleiras`, `buntileirasa`, `korabbikiut`, `korabbikiutdatum`, `beteg`, `reszesulkezelesben`, `kijelentemgyerek`, `kicsikoru1…8` | egyéb adatok | — |
| `meddig` | meddig kérelmezi a tartózkodást | → `employment_end` ⚠ M5 |
| `email` | e-mail cím | → `email` |
| `telefon` | telefonszám | → `telephone` |
| `atvetel` | az okmány átvétele | áll. `atvetel_hivatal` |
| `atvetel_cim` | postai kézbesítés címe | — |
| `nyilatkozat1`, `nyilatkozat2` | nyilatkozat | áll. bepipálva |

### 4.2 Munkavállalási lap (c7 / c9 / c12)

Csak azok a sorok, ahol a forrás nem cégadat. A cégadat-blokkokat a 6.2
írja le tételesen.

| EH mező | EH címke | Forrás |
|---|---|---|
| `benyujto` *(select)* | Benyújtó | áll. `foglalkoztató` |
| `vizumatvetelorszag`, `vizumatvetelvaros` | vízum átvételének helye | — (csak külföldről benyújtott kérelemnél) |
| `varhatojovedelemosszege` | várható jövedelem összege | → `gross_salary` |
| `varhatojovedelemosszegepenznem` | pénznem | áll. `Forint` |
| `adozottjovedelem`, `megtakaritas`, `jovedelemvagyon` *(+pénznemek)* | előző évi adózott jövedelem, megtakarítás, egyéb vagyon | — |
| `foglkoztatotip` *(select, csak c7)* | Foglalkoztató minősítése | áll. — a cég besorolása szerint |
| `btatv34`, `btatv34nap`, `btatv34szam` *(csak c7)* | Btátv. 34. § nyilvántartás | áll. — a cég adatai szerint |
| `szakkepzettseg` *(max 30)* | szakképzettsége | → `professional_qualification` ⚠ M1, M2 |
| `vegzettseg` *(select, 8–11 érték)* | iskolai végzettsége | → `educational_attainment` ⌄ *(szűkítő javaslat)* |
| `kulfoldifoglakozas` *(max 30)* | MO-ra érkezést megelőző foglalkozás | → `occupation_before_arrival` ⚠ M1, M2 |
| `egymunkahely` | egyetlen munkavégzési hely van | áll. bepipálva |
| `munkatobbmegye`, `foglalkoztatastobbmegyeben` *(+címblokkok)* | több vármegye | áll. üresen |
| `foglakoztataskezdete` | foglalkoztatóval kötött előzetes megállapodás kelte | → `employment_start` ⚠ M5 |
| `feorszam` *(select, 652)* | munkakör (FEOR szám) | → `feor` ⌄ kódlistából |
| `gyakorlatiido` | szakmai gyakorlati ideje (években) | — |
| `specialisismeretek` | speciális ismerete, képessége | — *(támpont: `hr_computer_skills`)* |
| `anyanyelv` *(select, 250)* | anyanyelve | → `mother_tongue` ⌄ |
| `egyebnyelv` *(select, 250)* | egyéb nyelvismerete | → `hr_language_skills` ⌄ |
| `tudmagyarul` | Beszél magyarul? | → `speaks_hungarian` ⌄ *(az érték egyezik)* |
| `korabbandolgozottmo` | Korábban dolgozott már Magyarországon? | → `hr_previous_employer` léte alapján ⌄ |
| `korabbimomunkaltatonev` | munkáltató neve | → `hr_previous_employer` |
| `korabbimomunkahely…` *(9 mező)* | korábbi munkahely címe | — |
| `elozeengervido` | Előző engedélyének érvényességi ideje | → `expiration_of_rp` |
| `tavorszag` *(select, c7/c12)* | távozási kötelezettség országa | → `citizenship` ⌄ *(országnév, egyezik)* |
| `kiutasitasceltip`, `kiutasitasceltipus`, `kiutasitascelengedely` *(c7/c12)* | kiutasítás célországa | áll. `az állampolgárságom szerinti állam` |
| `mentessegkhiv`, `mentessegkhivpont` | Kormányhivatal szakhatósági mentesség | áll. |
| `mentessegmunkavallas`, `mentessegmunkavallaspont` | munkavállalási engedély alóli mentesség | áll. |
| `mentessegmpiac`, `mentessegmpiachivpont` *(c7/c9)* | munkaerőpiaci vizsgálat alóli mentesség | áll. |
| `atvetel`, `okmanyatvetelhelye` *(csak c12)* | okmány átvétele | áll. |

## 5. Az illesztési eltérések

A DB-ben lévő érték több helyen nem az, amit az EH elfogad. **A két csoportot
külön kell kezelni**, mert a másolható mezőnél a hibás érték tényleg bekerül a
kérelembe, a listásnál viszont a böngésző úgyis csak listaelemet fogad el.

### 5.1 Másolható mezők — ide megy a munka

Öt eset. Ezek mind `<input type=text>`, tehát a hibás érték **valóban
bemásolható**, és onnantól a beadott kérelemben van.

| # | Mező | Mi a baj | Döntés |
|---|---|---|---|
| M1 | `professional_qualification` → `szakkepzettseg`, `occupation_before_arrival` → `kulfoldifoglakozas` | a DB-ben angolul is lehet (`welder`), az EH magyart vár | A meglévő **szótár** (`SchemaStore.translate`) magyarra fordít — már működik, csak használni kell. Ha nincs szótári pár, a panel jelzi (a `isUntranslated` erre való). |
| M2 | ugyanezek | az EH-n **max 30 karakter**, a DB-ben nincs korlát | A panel a hosszt méri, és túllépésnél jelzi: „30 karakterre vágva kerül be". Ugyanez a `locality` (27), `name_of_public_place` (25), `street_number` (8), `stairway`/`door` (4) és a cégnév (40) mezőkön. |
| M3 | `transport_type` → `mivel` | számított mező, az `airplane`/`bus` gépi alak | A szótár magyarra fordítja (`repülő`, `busz`). Ez ma is így megy a docx-generálásban. |
| M4 | `previous_street` → `moelotttarthelykozteruletneve` | a DB egyben tárolja (`Kossuth Lajos utca 12.`), az EH négy rovatra bontva kéri | A nyers szöveg a „közterület neve" sorra, a többi rovat kézi. **Címparser nincs** — a külföldi formátumok kiszámíthatatlanok. |
| M5 | `employment_end` → `meddig`, `employment_start` → `foglakoztataskezdete` | fogalmilag nem ugyanaz (munkaviszony vége ≠ kért tartózkodás vége; belépés napja ≠ „előzetes megállapodás kelte") | Az érték másolható, de `?` jelöléssel: „nem ugyanaz — ellenőrizd". |

A `hr_language_skills` → `egyebnyelv` **átkerült a listás csoportba**: az EH-n
250 elemű legördülő, tehát a „több nyelv egy cellában" probléma ott nem
okoz hibás beadást, csak kézi választást.

### 5.2 Listás mezők — csak tájékoztatás, nulla logika

Ezekbe a vágólapról nem lehet értéket tenni. A panel megmutatja a tárolt
értéket magyarul, `⌄` jellel jelzi, hogy legördülő, és **semmit nem alakít át**.

| Mező | DB-ben | EH-ban | Amit a panel ír |
|---|---|---|---|
| `citizenship` → `kerelmezoap` | `Szerbia` (országnév) | `Szerb` (melléknév, 218 elem) | az értéket + „⌄ melléknévi alak a listából" |
| `place_of_birth_country`, `previous_country` | angolul is lehet | magyar országnév (252) | a szótár szerinti magyar alakot |
| `passport_type` | `Magán` / `Szolgálati` | + `Szolgálati Útlevél`, `Diplomata`, `Egyéb` | az értéket |
| `type_of_public_place` | `Utca` | fő űrlap: 42 elem kisbetűvel; betétlap: 184 elem nagybetűvel | az értéket |
| `floor` | `3`, `fszt.` | `01`…`19`, `földszint` | az értéket |
| `educational_attainment` | 4 érték | fő űrlap 4, c7 8, c9 11, c12 10 érték | az értéket + a szűkítő javaslatot (lásd lent) |
| `feor` → `feorszam` | `8121` | 652 elemű kódlista | az értéket — a kód alapján megtalálható |
| `mother_tongue`, `hr_language_skills` | angolul, szabad szöveg | 250 elemű magyar lista | a szótár szerinti magyar alakot, ha van |
| `sex`, `marital_status`, `speaks_hungarian` | enum | egyező magyar címkék | az értéket (itt nincs eltérés) |

**Az egyetlen kivétel, ahol egy mondatnyi többletet adunk**, az iskolai
végzettség — mert a betétlap listája négyszer bővebb, és a szűkítés valódi
segítség. Ez **statikus szöveg az űrlapleírásban**, nem kód:

| DB-érték | A betétlapon válaszd |
|---|---|
| Nincs | `8 Általánosnál Kevesebb` *(c9-en `Nincs` is van)* |
| Alapfokú | `Általános Iskola` |
| Középfokú | `Gimnázium` / `Szakközépiskola` / `Szakmunkásképző` / `Szakiskola` / `Technikum` |
| Felsőfokú | `Főiskola` / `Egyetem` *(a c7 lapon egyik sincs — ott a legmagasabb a `Technikum`)* |

### 5.3 Ami egyáltalán nincs a DB-ben

| Mező | Hol | Döntés |
|---|---|---|
| `tartjogcim` (szálláshely jogcíme) | fő űrlap, kötelező | **Kézi mező marad.** Listás is, tehát még kevésbé éri meg sémamezőt felvenni érte. |
| `beutazashelye`, `beutazasideje`, `kerelmezonemzetiseg`, `gyakorlatiido`, `specialisismeretek` | fő űrlap / betétlap | Kézi sorként jelennek meg, hogy a panel végigolvasva megfeleljen az EH-nak. |
| hozzátartozók 19 rovata × 8 | fő űrlap 7. panel | `hr_children` nyers szövege egy sorban. Lásd 11. |

**Miért nem javítjuk az adatot a DB-ben?** Mert a DB a *dolgozó* adatát tárolja,
nem az *EH űrlap* alakját. A `Szerbia` helyes állampolgárság; hogy az EH
melléknevet kér, az az EH dolga. A leképezés a panel felelőssége — így a
docx-generálás és az Excel-export érintetlen marad.

## 6. Architektúra

Két új fájl, egy CSS-blokk, két apró módosítás meglévőben. **Nincs új service,
nincs új tároló, nincs új sémafogalom, nincs új beállítás-felület.**

```
js/schema/eh-forms.js          ← ÚJ. Adat: a 4 űrlap sorai + a munkáltatói blokk.
js/modules/cases/case-eh.js    ← ÚJ. Nézet: a panel kirajzolása + szerkesztés.
css/cases.css                  ← +~55 sor (.eh-*)
js/modules/cases/cases-view.js ← a részletező kap két fület (Idővonal | Enter Hungary)
js/utils.js                    ← a `copyText`/`execCopy` ide költözik
index.html                     ← két <script> sor
```

### 6.1 Az űrlapleírás mint adat

Ugyanaz a minta, amit az `export-profiles.js` `sections` szerkezete már használ:
a rovatsorrend adat, nem kód.

```js
const EH_FORMS = [
  { id: 'fo',      label: 'Fő űrlap – tartózkodási engedély', tipus: 'tartcelharm' },
  { id: 'c7',      label: 'Vendégmunkás-tartózkodási engedély', tipus: 'tartcelharm-c7' },
  { id: 'c9',      label: 'EU Kék Kártya',                      tipus: 'tartcelharm-c9' },
  { id: 'c12',     label: 'Nemzeti Kártya',                     tipus: 'tartcelharm-c12' },
];

const EH_PANELS = [
  { form: 'fo', title: 'A kérelmező személyes adatai', rows: [
    { eh: 'kerelmezocsaladnev', label: 'családi név (útlevél szerint)', req: true, key: 'surname' },
    { eh: 'kerelmezokulfoldifoglakozas', label: 'MO-ra érkezést megelőző foglalkozás',
      req: true, key: 'occupation_before_arrival', max: 30, dict: true },
    { eh: 'kerelmezoap', label: 'állampolgárság', req: true, key: 'citizenship',
      list: 'melléknévi alak a listából' },
    { eh: 'kerelmezonemzetiseg', label: 'nemzetisége', manual: true },
    …
  ] },
  { form: 'betet', title: 'Foglalkoztató', only: ['c7'], rows: [
    { eh: 'foglkoztatotip', label: 'Foglalkoztató', req: true, employer: 'foglkoztatotip' },
    …
  ] },
];
```

Egy sor kulcsai — **nyolc, több nem kell**:

| kulcs | jelentés |
|---|---|
| `eh` | az EH `name` attribútuma (a későbbi automatizálás horgonya) |
| `label` | az EH-n látható címke, szó szerint |
| `key` | DocGen sémakulcs, ahonnan az érték jön |
| `employer` | a `EH_EMPLOYER` blokk kulcsa (cégadat) |
| `req` | az EH-n `*`-gal jelölt kötelező mező |
| `const` / `manual` / `fromCase` | konstans érték, kézi mező, ügyből jövő érték |
| `max` | az EH `maxlength`-je — **csak másolható mezőn**, a hosszjelzéshez |
| `list` | ha jelen van: **listás mező**, nincs másoló gomb. Az értéke a soron megjelenő egymondatos tipp („melléknévi alak a listából") vagy `true` |
| `dict` | a szótár fordítsa magyarra (M1, M3) |

**A `list` kulcs vezet mindent.** Ha egy soron ott van, a panel nem tesz rá
másoló gombot, nem mér hosszt és nem alakít értéket — kiteszi a tárolt
érték magyar alakját és a tippet. **Nincs formazó-függvénytábla**: a
korábbi tervváltozatban szereplő `kozterulet_kicsi` / `kozterulet_nagy` /
`emelet` / `utlevel_tipus` normalizálók mind listás mezőt érintettek, ahová
úgysem lehet másolni — törölve. Ez ~60 sor kód és a hozzá tartozó
tesztkészlet, ami meg sem íródik.

**A jogcím-specifikus sorok `only: ['c7']` jelölést kapnak** — így a három
munkavállalási lap 93 közös mezője **egyszer** szerepel, nem háromszor
másolva. A `panelsFor(formId)` háromsoros szűrés: a `form: 'betet'` panelek
minden munkavállalási lapon megjelennek, kivéve ahol az `only` mást mond.

### 6.2 A munkáltatói adatblokk

A c7 lap 103 mezőjéből ~46 az Aumovio Hungary Kft. adata, és minden
kérelemnél ugyanaz. Ezek **egy helyen**, adatként — és **már az EH által
elfogadott alakban**, nem a cégkivonatéban (lásd 6.2.1):

```js
const EH_EMPLOYER = {
  nev:      'AUMOVIO Hungary Kft.',    // rövidített elnevezés, 20/40 karakter
  adoszam:  '10518869-2-19',           // KÖTŐJELLEL
  kshszam:  '10518869 2611 113 19',    // SZÓKÖZZEL — a cégkivonatban kötőjeles!
  teaor:    '2611',                    // TEÁOR'25 — listás mező, tájékoztatásul
  benyujto: 'foglalkoztató',           // listás

  // 8200 Veszprém, Házgyári út 6-8.
  szekhely: { iranyitoszam: '8200', telepules: 'Veszprém', kerulet: '',
              kozteruletneve: 'Házgyári',   // a jelleg NÉLKÜL
              kozteruletjellege: 'Út',      // listás, a betétlapon nagybetűs
              hazszam: '6-8.', epulet: '', lepcsohaz: '', emelet: '', ajto: '' },

  // 1106 Budapest, Napmátka utca 6. — a munkavégzés tényleges helye ÉS a
  // foglalkoztató levelezési címe (ide kérjük az okmány postázását).
  // A cégkivonat 7/2. pontja szerint fióktelep; az EH-t a jogi besorolás
  // nem érdekli, a tényleges hely kell.
  munkavegzes: { iranyitoszam: '1106', telepules: 'Budapest', kerulet: 'X.',
                 kozteruletneve: 'Napmátka',
                 kozteruletjellege: 'Utca',    // listás
                 hazszam: '6.', epulet: '', lepcsohaz: '', emelet: '', ajto: '' },

  levelezesi: 'munkavegzes',   // ugyanaz a cím — hivatkozás, nem másolat

  // c7-specifikus: a cég minősítése
  foglkoztatotip: 'kedvezményes foglalkoztató, amely a Kormánnyal érvényes '
                + 'stratégiai partnerségi megállapodással rendelkezik',  // listás
};
```

> **A `munkavegzeshelye…` blokkban nincs `kerulet` mező** — ellentétben a
> székhely (`foglszekhely…`) és a levelezési cím (`fogllevcim…`) blokkjával,
> ahol van. Ezért van a `munkavegzes` blokkban `kerulet: 'X.'`: a
> **levelezési címként** használva kell, munkavégzési helyként a panel
> egyszerűen nem hoz rá sort. A `munkavegzeshelye…` mezőknek **nincs
> hossz-korlátja** sem, szemben a székhelyével (település 27, közterület 25,
> házszám 8) és a levelezésiével (ugyanezek).

**Forrás:** `Tárolt cégkivonat – 19-09-503741`, hatályos 2026. augusztus 30.
Cégjegyzékszám `19-09-503741`, bejegyezve 1991/09/03. A teljes elnevezés
(`AUMOVIO Hungary Korlátolt Felelősségű Társaság`) 47 karakter, tehát **nem
fér bele** a 40-es korlátba — az EH `rövid cégnév` rovatába a rövidített
elnevezés való, ami a cégkivonat 3/3. pontja szerint `AUMOVIO Hungary Kft.`

**A munkavégzés helye egyelőre mindig `1106 Budapest, Napmátka utca 6.`** —
így egyetlen érték, nem a dolgozóhoz kötött adat, tehát a cégadat-blokkba
való. Ha később telephelyenként eltér, az `egymunkahely` rovat és a
`munkatobbmegye…` blokk már ott van az EH-n; a felvezető út az, hogy a
`munkavegzes` egy tömb lesz, és az ügyön választható. **Most nem az** — egy
érték nem kér választót.

#### 6.2.1 Az EH-alak, nem a cégkivonaté

Ez nem stílus kérdése: az EH **`pattern` attribútummal validál**, és a rossz
alakot a böngésző visszautasítja. A mentett c7 lapból kiolvasva:

| EH mező | `pattern` / `placeholder` | Cégkivonatban | **EH-alak** |
|---|---|---|---|
| `munkaltatokshszam` | `\d\d\d\d\d\d\d\d \d\d\d\d \d\d\d [012]\d`<br>ph: `12345678 1234 123 12` | `10518869-2611-113-19` | **`10518869 2611 113 19`** — kötőjel helyett **szóköz** |
| `munkaltatomunkaltatoadoszama` | `\d{10}\|(\d{8}[-]\d[-]\d\d)`<br>ph: `12345678-1-11 / 1234567890` | `10518869-2-19` | `10518869-2-19` — **marad kötőjeles** |
| `munkaltatomunkaltatoneve` | `maxlength=40`, ph: `max.40 chars` | `AUMOVIO Hungary Kft.` | változatlan (20 kar.) |
| `munkaltatoteaorszam` | select, ph: `0000` | `2611 '25 Elektronikai alkatrész gyártása` | `2611` — **listás**, a kód alapján keresendő |
| `munkaltatohazszam` | `maxlength=11` | `6-8.` | változatlan |
| `foglszekhelyhazszam` | `maxlength=8` | `6-8.` | változatlan |
| `…kozteruletneve` | `maxlength=25` | `Házgyári út` | **`Házgyári`** — a jelleg külön rovat |

**A KSH-szám a tanulság.** A `[012]\d` a záró két jegyre a megyekódot
korlátozza (01–19 + Budapest 01), tehát az EH tényleg szegmensekre bontva
érti a számot — a kötőjeles alakot némán elutasítja. Ezért az `EH_EMPLOYER`
blokkban **eleve az EH-alak áll**: nincs futásidejű átalakítás, nincs
formázó függvény. Egy adat, egy helyes alak.

**Ez a szabály minden cégadatra áll:** ha egy hivatalos nyilvántartás más
alakban írja, a blokkba az EH-alak kerül, a forrásalak pedig kommentbe. Így
a másolás mindig működik, és a következő olvasó látja, honnan jött.

**Miért itt és nem a Beállításokban?** Egy munkáltató van. Egy beállítás-űrlap
+ tárolási réteg + migrációs út olyan adathoz, ami évekig nem változik, három
réteg felesleges kód. Ha mégis több cég kell, a blokk a config-fájlba
költözik (a séma mellé) — a `employer:` sorkulcs változatlan marad, tehát a
felvezető út nyitva van.

**Az EH saját „adatok beemelése" gombja nem váltja ki.** Az EH egyszerre egy
cég adatait jegyzi meg, a böngésző profiljában (a mentett HTML-ben most
`Falco Zrt.` van benne) — ha az elveszik vagy más gépen dolgozol, nincs
honnan előszedni. A panel mutatja őket, akkor is, ha egy adott napon
gyorsabb az EH gombja.

### 6.3 A panel

`CaseEh.render(caseObj, employee, formId)` → HTML. Soronként:

```
┌──────────────────────────────────────────────────────────┐
│ Enter Hungary   [ Vendégmunkás-tart. engedély  ▾ ]       │
├──────────────────────────────────────────────────────────┤
│ ── A kérelmező személyes adatai ──                        │
│ családi név (útlevél szerint) *     [ Kovacs         ] ⧉ │
│ MO-ra érkezést megelőző foglalk. *  [ hegesztő       ] ⧉ │
│ állampolgárság *              ▾ Szerbia                  │
│                                 melléknévi alak a listából│
│ nemzetisége                   — kézzel                   │
│ ── Magyarországi munkáltató adatai ──          (cégadat)  │
│ rövid cégnév *                      [ AUMOVIO Hungary Kft.]⧉│
│ KSH-szám *                    [ 10518869 2611 113 19 ]  ⧉ │
│ TEÁOR száma [2025] *          ▾ 2611                     │
└──────────────────────────────────────────────────────────┘
```

A két sorfajta **ekkora különbséget** kap: a másolhatón keretezett mező és
`⧉` gomb van, a listáson csak a `▾` jel, az érték és egy halvány tipp.
Végiggörgetve ránézésre látszik, hol lehet kattintani és hol kell választani.

- **Egy görgetős lista, panelekre bontva** — a fő űrlap és a választott
  betétlap egymás után, pontosan abban a sorrendben, ahogy az EH-n végighaladsz.
  Nincs elveszett kattintás, és a böngésző Ctrl+F-je is működik rajta.
- **A választó a JOGCÍMET választja, nem a lapot.** Egy kérelem két lapból
  áll, ezért a panel a fő űrlap 90 sorát hozza, **majd közvetlenül alatta**
  a választott betétlapét — egy listában, ahogy az EH-n végighaladsz. Így a
  Tab-lánc a két lap határán sem szakad meg.
- **A választó üresen indul** („— válassz jogcímet —"), mert nincs tipikus
  jogcím: a Vendégmunkás, a Kék Kártya és a Nemzeti Kártya vegyesen fordul
  elő. Így nem fordulhat elő, hogy észrevétlenül rossz betétlapot töltesz.
  Amíg nincs választás, csak a fő űrlap látszik — az úgyis közös. A
  választás az ügyön megőrződik (`state`-ben, ügyazonosító szerint).
- **Nem találgatunk** a „tartózkodás célja" szabad szövegből: elgépelésnél
  vagy angol alaknál rossz lapot ajánlana, és a hibát nehezebb észrevenni,
  mint egy legördülőt átállítani.
- **A `⧉` gomb másol** — egy kattintás, és **csak másolható soron van**. A
  `copyText` már létezik a `settings-view.js`-ben (`file://` alatt a
  `navigator.clipboard` nem mindig elérhető, ott `execCommand` a tartalék).
  **Nem írjuk újra: átköltöztetjük a `js/utils.js`-be**, és a
  `settings-view.js` onnan hívja. −20 sor a settingsből, +0 új logika.
- **Hosszjelzés a másolható mezőkön.** Ha az érték hosszabb, mint az EH
  `maxlength`-je (`max:` a sorleírásban), a panel kiírja: „34 karakter → az
  EH 30-ra vágja". Ez az egyetlen számítás, amit egyáltalán végzünk az
  értéken — és pont ott, ahol a másolás némán rossz adatot vinne be.
- **A már másolt sor halványan megjelölve marad**, amíg a panel nyitva van.
  Nem tárolunk semmit: űrlapváltásnál és ügyváltásnál nullázódik. Ennyi elég
  ahhoz, hogy egy ~130 soros listán lásd, hol tartasz.
- **A mező `readonly`, amíg `F2`-vel vagy dupla kattintással ki nem nyitod** —
  a miértje a 6.7-ben: Tab-bal járva egy véletlen leütés különben törölné a
  kijelölt értéket. Szerkesztéskor az input a `data-key`-jét viszi; típus
  szerint a meglévő `dateFieldHtml()` (dátum) vagy legördülő (enum,
  `ValueCodec.options`) — ugyanaz, amit az `employee-form.js` használ. Ez a
  **listás sorokra is áll**: ott a másolás értelmetlen, de a *javítás* nem.
- A **kötelező, de üres** sor kiemelve (`⚠ hiányzik`) — az EH `*`-ai az
  űrlapleírásból jönnek, ingyen.
- A **kézi**, **állandó** és **cégadat** sorok is látszanak. A cégadat
  másolható (a ~46-ból ~34 szabad szöveges mező), a kézi és állandó sorok
  halványak. Ez szándékos: a panel végigolvasva megfelel az EH űrlapnak, nem
  kell fejben számolni, hol tartasz.

### 6.4 Szerkesztés → visszaírás

`change` eseményre (nem `input`-ra: minden leütésre menteni felesleges írás
és zajos history):

```js
EmployeeRepo.update(emp.id, { fields: { [key]: ertek }, source: 'eh-panel' });
```

Az `update` már mindent elintéz: `validate()`, `logChange()` (a bejegyzés
`source`-a `eh-panel` — látszik, honnan jött a javítás), `scheduleSave()`
(800 ms késleltetett írás), `emit()`.

**Két dolog, amire figyelni kell:**

1. Az `emit()` végigfut az `EmployeeRepo.onChange` feliratkozókon, és a
   `cases-view.js` erre **teljes `render()`-t** hív → a szerkesztett mező
   elveszti a fókuszt gépelés közben. A `cv-search` mezőnél ezt ma
   fókusz-visszaállítással kerüli meg a kód; itt tisztább, ha a `case-eh`
   saját változása után **nem rajzol újra** (őrző flag), csak a sor
   jelzéseit frissíti.
2. Ha az `update` dob (kötelező mező üresre törlése, ütköző azonosító), a
   hibát a soron kell mutatni, és az input értékét visszaállítani — némán
   elnyelni adatvesztés-érzetet ad.

**A cégadat- és konstans sorok nem szerkeszthetők** a panelen: azok nem a
dolgozó adatai, tehát `F2` sem nyitja őket. **Másolhatók viszont** — a
`readonly` a szerkesztést tiltja, nem a vágólapot. Ha a cégadat változik, a
`EH_EMPLOYER` blokkot kell átírni.

### 6.5 Hova kerül a panel

A `cv-detail` (jobb oldali részletező) kap **két fület**:

```
[ Idővonal ] [ Enter Hungary ]
```

Miért fül és nem a timeline alá tett szekció: a panel ~130 sor, az idővonal
alatt gyakorlatilag sosem látszana a lényeg. Fülnél az EH-kitöltés közben a
teljes magasság a paneleké — és pont ez a munkamenet, amiért az egész készül.

A fülállapot a `state`-ben él (`state.lap = 'idovonal' | 'eh'`), ügyváltáskor
**nem áll vissza**: aki EH-t tölt, sorra veszi a dolgozókat.

### 6.6 A tényleges munkakörnyezet: fél képernyő

**Ez nem „reszponzív jó lenne", hanem a funkció üzemi mérete.** A másolás
akkor gyors, ha a két ablak egymás mellett van: 1920 × 1080-on fele-fele
dokkolva **960 px széles böngészőablak**, amiből a függőleges görgetősáv után
**~945 px viewport** marad. A DocGen-nek ebben kell jól működnie — nem
mellékesen, hanem elsősorban.

Három dolog akadályozza ma:

| # | Mi | Ma | Mi lesz |
|---|---|---|---|
| K1 | `.app-root { min-width: 920px }` (`app.css:10`) | 945 px viewporton **25 px a tartalék** — egy 110 %-os böngésző-zoom vagy egy eltérő Windows-DPI azonnal vízszintes görgetősávot hoz | Az Ügyek fülre a korlát feloldva (`.tab-content` szintjén felülírva). A 920 px a Nyilvántartás táblázatához kell, nem ide. |
| K2 | `.cv-side { width: 380px; flex: 0 0 380px }` | 945 − 380 = **564 px** marad a panelnek — a bal sáv a hely 40 %-a, miközben EH-kitöltés közben alig nézünk rá | `@media (max-width: 1200px) { .cv-side { flex-basis: 300px; width: 300px } }` → **645 px** a panelnek. Három sor CSS. |
| K3 | a sorelrendezés nincs megtervezve | — | rács: `grid-template-columns: minmax(0,1fr) minmax(0,1.15fr) 28px` (címke / érték / `⧉`). A címke **tördel, nem csonkul** — az EH-n a címke alapján találod meg a rovatot, tehát a `text-overflow: ellipsis` itt kifejezetten káros lenne. |

**A bal sáv összecsukható — ez utólag került be (K4).** A terv először
elvetette („állapotot, gombot és egy fél animációt kér"), de az első éles
használat megmutatta, hogy a `@media` három sora nem elég. Két okból:

| # | Mi | Mi lett |
|---|---|---|
| K4a | **A 780 px-es töréspont elkapta a dokkolt nézetet.** 1920×1080-on fele-fele ~960 *eszköz*pixel, ami **125%-os Windows-skálázással mindössze ~756 CSS pixel** — a sáv így a tartalom FÖLÉ csúszott, és elvette a magasság 45%-át, pont ott, ahol a legkevesebb hely van | a töréspont **600 px**-re szűkült, így a sáv oldalt marad |
| K4b | 300 px-es sáv mellett 756 px-en a panel **456 px** — szűk | `is-collapsed`: a sáv `display: none`, a panel **756 px** (+66%) |

A gomb a részletező fejlécsávjában ül (`‹` / `›`), tehát **csukott
állapotban is elérhető**; mellette az ügyek száma és a kiválasztott dolgozó
neve marad látható. Gyorsbillentyű: **Alt+L**. Az állapot megjegyződik
(`Settings: cases_side_collapsed`) — aki becsukja, annak holnap is csukva
induljon.

A `display: none` és nem `width: 0`: a rejtett sáv így a **Tab-láncból is
kiesik**, vagyis az EH-panelen a Tab továbbra is pontosan a másolás útját
járja (6.7). Ha nincs kiválasztott ügy és a sáv csukva, az üres állapot
szövege maga mondja meg a kiutat — be nem lehet ragadni.

**Elférés-számítás a 645 px-re.** A leghosszabb EH-címke a
„Magyarországra érkezést megelőző foglalkozás" (44 karakter), ami 11 px-es
betűvel ~250 px — belefér az 1fr-be (≈285 px) tördelés nélkül. Az érték-mező
~330 px, a gomb 28 px. Vagyis **egysoros marad a sor**, és a ~130 soros lista
~4400 px görgetés, nem 6200. Ez a különbség egy EH-kitöltésnyi munkában
érezhető.

> A 8. pont javításai ugyanezt a méretet szolgálják: 945 px-en a
> `@media (max-width: 780px)` **nem** aktiválódik, tehát a bal sáv oldalt
> marad — a nyitott ügyek sorai viszont pont ott csúsznak össze (8.2).

### 6.7 Billentyűzet: a tényleges munkaciklus

A két ablak közti váltás **Alt+Tab**, tehát a kéz a billentyűzeten van. Ha a
másoláshoz vissza kell nyúlni az egérért és rá kell célozni egy 28 px-es
gombra, az ablakváltás megtakarított ideje elvész. Egy teljes kérelem (fő
űrlap + c7 betétlap) **~71 másolható mezőt** jelent — itt a mezőnkénti
másfél másodperc negyedóra.

**A ciklus mezőnként, a tervezett kiosztással:**

```
DocGen:  Enter        → másol + a fókusz a KÖVETKEZŐ másolható mezőre ugrik
         Alt+Tab      → át az EH-ra
EH:      Ctrl+V, Tab  → beilleszt, tovább
         Alt+Tab      → vissza a DocGen-re, a fókusz ott van, ahol hagytad
```

Öt leütés, **egérhasználat és célzás nélkül**, és a DocGen-ben ebből csak
egy a tényleges munka. A kulcs az, hogy az `Enter` **másol ÉS továbblép** —
így a visszatéréskor már a következő mezőn állsz, nem kell Tab-olni.

| Billentyű | Mit csinál | Mennyi kód |
|---|---|---|
| `Tab` / `Shift+Tab` | következő / előző **másolható** mező | 0 — natív, csak a `tabindex` helyes beállítása kell |
| `Ctrl+C` | másol | 0 — natív, mert fókuszáláskor a mező tartalma kijelölődik |
| `Enter` | **másol + ugrás a következő másolható mezőre** | ~10 sor |
| `F2` (vagy dupla kattintás) | szerkesztés be | ~8 sor |
| `Enter` szerkesztés közben | ment + szerkesztés ki | a meglévő `change`-út |
| `Esc` szerkesztés közben | elvet + szerkesztés ki | ~4 sor |

**A listás sorok kimaradnak a Tab-sorrendből** (`tabindex="-1"`). Ez a
sorfajta-megkülönböztetés (5.2) gyakorlati haszna: a Tab pontosan a másolás
útját járja végig. Az EH-n közben minden mezőn átmész — a két oldal
tab-sorrendje elcsúszik, és ez **helyes**: a listás mezőt ott magadtól
töltöd ki, a DocGen-ben nincs vele dolgod. A „már másolt sor megjelölve
marad" (6.3) adja hozzá a fogódzót, hogy hol tartasz.

**Miért `readonly` a mező alapból?** Mert fókuszáláskor kijelöljük a
tartalmát (ettől működik a `Ctrl+C` saját kód nélkül) — és egy kijelölt,
szerkeszthető mezőben **egyetlen véletlen leütés törli az egész értéket**.
Tab-bal 71 mezőn végighaladva ez nem elméleti kockázat. Readonly állapotban
a gépelés nem csinál semmit; a szerkesztés `F2`-vel vagy dupla kattintással
indul. Ez ~18 sor pluszért teljes védelem, és **helyes arány**: a gyakori
művelet (másolás) egy billentyű, a ritka (javítás) kettő.

**Fókusz-visszaállítás ablakváltás után.** A böngésző általában megőrzi a
fókuszált elemet, de nem mindig (a Chrome elejtheti, ha közben újrarajzolás
történt — például mert a `EmployeeRepo.emit()` lefutott). A panel megjegyzi
az utolsó fókuszált sort, és `window` `focus` eseményére visszaadja neki, ha
a fókusz közben a `body`-ra esett vissza. ~6 sor, és pont az a hiba múlik
rajta, ami a legbosszantóbb: Alt+Tab után a semmibe nyomsz egy Enter-t.

**Amit NEM építünk:** nincs globális gyorsbillentyű-rendszer, nincs
testreszabható kiosztás, nincs parancspaletta, és nincs „ugorj a következő
hiányzó kötelező mezőre" gyorsbillentyű sem. Hat billentyű, ebből kettő
natív. Ha a használat mutat egy hetediket, akkor jön a hetedik.

> **Megfigyelés az EH oldaláról, ellenőrizendő élesben.** Az irányítószám-
> mezők `role="iranyitoszam"` attribútumot viselnek, mellette
> `telepules="…" kerulet="…" megye="…"` hivatkozásokkal — vagyis az EH
> alighanem **maga tölti ki a települést és a kerületet** az irányítószámból.
> Ha ez beillesztésre is lefut (nem csak gépelésre), akkor a `település` sor
> másolása kihagyható, és a cím három leütéssel kevesebb. A mentett HTML-ből
> ez nem dönthető el — az első éles kitöltésnél derül ki, és ha igaz, egy
> `note:` a sorleírásban.

## 7. Fázisok és sikerkritérium

| # | Lépés | Ellenőrzés |
|---|---|---|
| 0 | Ügyek fül javításai (8. pont) | **960 px széles ablakban** (fele-fele dokkolva) a nyitott ügyek sorai nem csúsznak egymásra; mind a 12+ közelgő lejárat elérhető görgetéssel |
| 1 | `eh-forms.js` + `EH_EMPLOYER` + Node-teszt | minden `key` létező sémamező (`SchemaStore.field(key)` nem null); minden `eh` név egyedi lapon belül; a fő űrlap 90, a c7 103, a c9 95, a c12 99 sort ad; a cégadatok **EH-alakban** (KSH szóközös, adószám kötőjeles) átmennek az EH `pattern`-jein |
| 2 | `case-eh.js` render + fülek + űrlapválasztó | egy ügyet megnyitva a panel az EH sorrendjében jelenik meg; a `⧉` a vágólapra tesz; a másolt sor megjelölve marad; üres kötelező mező jelölt |
| 2b | **Fél képernyős elrendezés** (6.6) | 960 px-es ablakban **nincs vízszintes görgetősáv**; a bal sáv 300 px; a leghosszabb EH-címke egy sorban elfér és nem csonkul ellipszisre; a másoló gombok egy függőleges vonalban állnak |
| 2c | **Billentyűkezelés** (6.7) | `Tab` csak a másolható sorokat járja (a listásokat átugorja); `Enter` másol és továbblép; `Ctrl+C` a fókuszált soron működik; `F2` nyit, `Esc` elvet; **gépelés readonly soron nem írja felül az értéket**; Alt+Tab-bal ki-be váltva a fókusz ugyanazon a soron marad |
| 3 | Inline szerkesztés | mezőt átírva a Nyilvántartás fülön is az új érték látszik; a dolgozó history-jában `eh-panel` forrású bejegyzés; cégadat-soron nincs input |
| 4 | Eltérés- és hosszjelzés | `professional_qualification=welder` → a szótárból `hegesztő`; 34 karakteres foglalkozás → „az EH 30-ra vágja"; `transport_type` → `repülő`; `employment_end` → `?` jelzés. **Listás soron nincs mit ellenőrizni** — ott csak az érték és a tipp jelenik meg |

## 8. Javítás: az Ügyek fül bal oldala

Független a fentiektől, ezért **külön, elöl megy** (0. fázis).

### 8.1 „Közelgő lejárat, nyitott ügy nélkül" — csak 5 látszik

`js/modules/cases/cases-view.js`, `javaslatokHtml()`:

```js
${javaslatok.slice(0, 5).map(…)}
${javaslatok.length > 5 ? `<div class="cv-suggest__more">… és további ${…}</div>` : ''}
```

**Javítás:** a `slice(0, 5)` és a `cv-suggest__more` sor törlése, a lista
görgethetővé tétele CSS-ből:

```css
.cv-suggest__list { max-height: 30vh; overflow-y: auto; }
```

A `max-height` **azért `vh` és nem fix px**, mert a bal sáv magassága a
képernyőé; fix 150 px kis kijelzőn a fél oldalt elvenné, nagy kijelzőn
viszont fölöslegesen csonkolna. A 30 % felső korlát biztosítja, hogy a
nyitott ügyek listája alatta ne szoruljon ki. A célméreten (1080 px magas
képernyő, ~950 px viewport) ez ~285 px, azaz **körülbelül 14 javaslat-sor**
egyszerre.

A darabszámot a címsorba érdemes kiírni (`Közelgő lejárat, nyitott ügy nélkül
(12)`) — enélkül a görgethetőségből nem látszik, mennyi van összesen.

### 8.2 A nyitott ügyek sorai összecsúsznak

Ma a `.cv-row` **kétoszlopos**: bal oldalt a név + ügytípus, jobbra a státusz +
határidő. A határidő szövege viszont lehet
`Nincs határidő – add meg: OIF érkeztetés napja (iktatószám megkapása)`
(a `CaseRepo.deadlineText()` a `CaseTypes.triggerLabel()`-t fűzi bele), a
`.cv-row__meta` pedig `flex: 0 0 auto` — **nem zsugorodik**, ezért a névre
tolódik rá.

**Javítás** (`css/cases.css`), a soron belül egymás alá:

```css
.cv-row      { flex-wrap: wrap; }
.cv-row__main{ flex: 1 1 100%; min-width: 0; }
.cv-row__meta{ flex: 1 1 100%; text-align: left; margin-top: 2px; }
.cv-row__due { overflow-wrap: anywhere; }
```

Ez **CSS-only javítás** — a `sorHtml()` markupja marad. A `.cv-row__meta`
`text-align: right`-ja szűk sávban semmit nem ér: a jobb szél a névé is meg a
határidőé is, tehát a kettő úgyis egy vonalban kezdődik.

Az egy sorra jutó magasság ezzel ~34 px-ről ~50 px-re nő. Ezért fontos, hogy a
`.cv-list` **már ma is** `flex: 1; overflow-y: auto` — vagyis a lista
görgethetősége adott, csak a fölötte lévő, korlátlanul növő `cv-suggest`
szorította ki (8.1). A két javítás **együtt** adja ki, amit kértél: fent a
teljes lejárat-lista görgethetően, alatta az összes nyitott ügy, szintén
görgethetően, egymás alatti, olvasható sorokkal.

**Alternatíva, amit elvetettünk:** a `triggerLabel` rövidítése a sorban
(„Nincs határidő"). Kevesebb CSS lenne, de pont azt az információt venné el,
ami cselekvésre hív — hogy *melyik* dátumot kell megadni.

## 9. Tesztek

A projekt Node-tesztjei (`node test/run-all.js`) böngésző nélkül futnak,
`vm`-sandboxban. Ehhez a fejlesztéshez **egy új készlet** kell:

`test/eh-forms.test.js` — tisztán adat- és leképezés-teszt, DOM nélkül:

- minden `key` létező, nem `computed`-ként hivatkozott sémamező;
- minden `eh` név egyedi **lapon belül** (lapok között szándékosan ismétlődik:
  `szakkepzettseg` a fő űrlapon és a betétlapon is szerepel);
- minden `employer` kulcs létezik a `EH_EMPLOYER` blokkban;
- a `panelsFor('c9')` nem ad `only: ['c7']` sort, és a négy lap sorszáma
  90 / 103 / 95 / 99;
- **`max:` csak másolható soron van, `list:` mellett soha** — ez tartja
  őszintén a szabályt, hogy listás mezőre nem építünk logikát;
- a hosszjelzés határesete: 30 karakter még nem jelez, 31 már igen;
- a szótáras sorok (`dict: true`) létező szótári párral magyar alakot adnak,
  pár nélkül az eredetit és a „nincs szótári pár" jelzést — **nem találnak ki
  fordítást**.

Emellett **egy állítás a cégadatra**, ami értékesebb, mint amilyen egyszerű:
az `EH_EMPLOYER` minden mezője **átmegy az EH saját `pattern`-jén**. A két
mintát (`kshszam`, `adoszam`) a mentett c7 lapból másoljuk a tesztbe:

```js
assert(/^\d{8} \d{4} \d{3} [012]\d$/.test(EH_EMPLOYER.kshszam));
assert(/^(\d{10}|\d{8}-\d-\d\d)$/.test(EH_EMPLOYER.adoszam));
assert(EH_EMPLOYER.nev.length <= 40);
```

Ez az a hiba, amit különben csak az EH-n, kitöltés közben veszünk észre —
némán elutasított mezőként.

A panel kirajzolása, a vágólap és a **billentyűkezelés** böngészős próba
(`file://`-ről indítva, ahogy az app fut) — a `copyText`
`execCommand`-tartaléka pont ott számít. A billentyűzetnél három dolgot kell
végigpróbálni, mert mindhárom némán tud elromlani:
**(a)** a `Tab` tényleg átugorja-e a listás sorokat,
**(b)** `readonly` soron a gépelés tényleg nem írja-e felül a kijelölt
értéket, és
**(c)** Alt+Tab-bal ki-be váltva ugyanazon a soron marad-e a fókusz.
**A próbát 960 px széles ablakban kell végezni**, nem teljes képernyőn: a
6.6 három akadálya (K1–K3) csak ott látszik. A gyors ellenőrzés a
DevTools eszközsávával 945 × 950 px viewportra állítva is elvégezhető.

**Az űrlapleírás vázát ne kézzel gépeljük be.** A mentett HTML-ekből a
panelcímek, a `name` attribútumok, a címkék, a `*` kötelezőség-jelölés, a
`maxlength` és a legördülők értékkészlete gépileg kinyerhető (a tervhez
készült kigyűjtés ezt már megtette mind a négy lapra). A kézi munka csak a
`key` / `employer` hozzárendelés és az eltérés-jelölés — az viszont döntés,
nem gépelés. Az így kapott vázat egy eldobható szkript (`tools/eh-scrape.js`)
állítja elő; a **kimenete** kerül verziókövetésbe, nem a szkript futtatása
lesz a build része.

## 10. Miért így

- **Az űrlap adat, nem kód.** Az EH bármikor átrendezheti a rovatokat. Ha a
  sorrend kódban van, minden változás fejlesztés; ha adat, egy tömb átírása.
  Ugyanez az elv vitte az `export-profiles.js`-t és a `case-types.js`-t is.
- **A 93 közös mező egyszer szerepel.** A három munkavállalási lap között
  10 / 2 / 6 sor az eltérés — háromszor lemásolva a listát az első
  EH-módosításnál azonnal szétcsúszna.
- **A DB alakja nem változik.** Se új mező, se érték-átírás. Amit az EH máshogy
  kér, azt a panel jeleníti meg máshogy — a docx-generálás, az Excel-export és
  a szótár érintetlen. Két helyen merült fel bővítés (szálláshely jogcíme,
  részletes végzettség), és mindkettőnél a jelzés nyert — ráadásul **mindkettő
  listás mező**, ahol a tárolt érték sem spórolna kattintást.
- **A billentyűzet az elsődleges beviteli eszköz, nem az egér.** A
  munkamód Alt+Tab két ablak között; egy 28 px-es gombra célozni 71-szer
  lassabb, mint egy Entert leütni. Ezért kapott a `Tab`-sorrend és az
  `Enter` viselkedése saját szakaszt (6.7) — és ezért `readonly` a mező
  alapból, habár az egy kért funkciót (helyben szerkesztés) tesz egy
  billentyűvel távolabbra: a másolás a gyakori művelet, azt kell védeni és
  gyorsítani.
- **A listás mezőkre nem költünk.** Ez a szűkítés önmagában kivett a tervből
  egy formázó-függvénytáblát (~60 sor), a hozzá tartozó tesztkészletet és egy
  megfeleltetési adattáblát. Amit nem lehet a vágólapról bevinni, ott a panel
  legfeljebb tájékoztat.
- **A szerkesztés a meglévő `EmployeeRepo.update`-en megy.** Validáció,
  history, mentés, értesítés — mind megvan. Egyetlen új adatút sem nyílik.
- **Az eltéréseket kimondjuk, nem elrejtjük.** Hatósági űrlapnál a némán
  „megjavított" érték a legrosszabb: a felhasználó nem tudja, mit adott be.

## 11. Ismert plafonok

- **Hozzátartozók.** `hr_children` szabad szöveg, az EH nyolcszor 19 rovatot
  kér. Ha ez rendszeresen kell, a `seed-schema.js` kommentje már kimondja a
  felvezető utat: fix rekeszek (`hr_child_1_name`, `hr_child_1_birth`, …).
  Addig a panel a nyers szöveget mutatja.
- **Külföldi cím bontása.** `previous_street` és `korabbimomunkahely…` egy
  mező vs. kilenc rovat. Címparsert nem írunk (M4).
- **Állampolgárság melléknévi alakja.** Egy 218 soros `országnév → melléknév`
  tábla megoldaná, és az EH legördülőjéből ki is nyerhető. Nem most:
  figyelmeztetés elég, és a valós használat majd megmutatja, hány ország
  fordul elő egyáltalán. Ha 6–8, akkor a meglévő **szótárba** is felvehető —
  ugyanoda, ahová az anyanyelvek kerülnek. Listás mező, tehát a kattintást
  akkor sem spórolná meg — csak a keresést gyorsítaná.
- **Részletes iskolai végzettség.** A betétlap 8–11 értéket kér, a DB 4-et
  tárol. A panel javaslatot ír ki, a választás kézi marad. Ha kiderül, hogy
  mindig ugyanaz a részletes érték egy-egy csoportnál, a séma bővítése a
  felvezető út.
- **A fő űrlap jogcím-változatai.** A terv abból indul ki, hogy a fő űrlap
  minden jogcímnél azonos, és csak a `tartcel` hidden értéke más. Ha kitöltés
  közben eltérés látszik, az a leírásban egy-két sor.
- **Egy munkavégzési hely.** A `EH_EMPLOYER.munkavegzes` egyetlen cím
  (`1106 Budapest, Napmátka utca 6.`). Ha telephelyenként eltérne, a
  felvezető út: tömbbé alakítani és az ügyön választhatóvá tenni — az EH-n a
  `munkatobbmegye…` blokk erre már ott van. Most nem: egy érték nem kér
  választót.
- **Nincs vágólap-előzmény.** Ha másolsz egy mezőt, majd az EH-n véletlenül
  máshova illeszted, a DocGen-ben újra rá kell állni. Egy „utolsó öt másolt
  érték" lista megoldaná, de a `Shift+Tab` egy leütés — ennyiért nem éri meg.
- **Playwright.** A leképezés (`eh` név → érték) **pont az a réteg**, amire egy
  későbbi automatizálás épül. Ezért kerül bele az `eh` név akkor is, ha ma
  senki nem használja: két mondat most, egy visszabontás elkerülve később.

## 12. Amit a megvalósítás tanított

Három dolog a kódolás közben derült ki. Mindhárom **némán** rontott volna: a
panel dolgozott volna, csak rossz adatot ad, vagy használhatatlan marad.

### 12.1 A dátumot nyersen kell adni, nem magyarul

A `SchemaStore.resolveValues(fields, 'hu')` a dátumot olvasható magyar alakra
formázza (`1988.04.12.`) — ez a docx-generálásnál helyes, hatósági iratra az
való. **Az EH viszont `ÉÉÉÉ-HH-NN`-t vár** (a mezők placeholderje `YYYY-MM-DD`),
és a magyar alakot elutasítja.

A panel ezért a `date` típusú mezőknél a **tárolt, nyers értéket** használja, a
feloldott helyett. Itt a másolhatóság a szempont, nem az olvashatóság —
ugyanaz az adat, más cél, más alak. A `test/eh-forms.test.js` rögzíti, hogy a
kettő tényleg eltér: ha a `resolveValues` egyszer nem formázna, a kivétel
elhagyható, és a teszt megmondja.

### 12.2 Az `EmployeeRepo.update` nem őrzi a séma-szabályokat

A helyben szerkesztés első próbájánál egy **kötelező mező üresre törlése némán
átment**. Az ok: az `EmployeeRepo.validate()` csak az azonosítókat nézi
(egyediség, üres érték); a „kötelező", a dátumformátum és az enum-értékek a
`SchemaStore.validateValues()`-ben élnek, amit eddig csak az `employee-form.js`
hívott mentés előtt.

A panel ezért a mentés előtt **külön hívja** a séma-ellenőrzést, és a
szerkesztett mezőre szűr. Ez nem az EH-panel sajátossága: bármelyik jövőbeli
szerkesztő-felület ugyanebbe futna bele. A munkamegosztást három teszt
rögzíti, hogy a következő olvasó ne vezesse félre az `update` neve.

### 12.3 Az egész oldal görgött, nem a panelek

A `.tab-content.active` csak `min-height`-ot kap (`app.css`), ezért a fül
tartalma korlátlanul nő. 15 nyitott üggyel az oldal **3700 px**, a 184 soros
EH-panellel **7300 px** lett — és ilyenkor a fejléc, a fülsáv és az EH ragadó
fejléce is kicsúszik felfelé. A „legyen görgethető" kérés így nem teljesült
volna: a lista nem görgött külön, csak az ablak.

Javítás: `#tab-cases.active` fix magasságot kap
(`calc(100vh - header - tabnav)`) és `overflow: hidden`-t, így a bal sáv két
listája és a jobb oldali panel **külön-külön** görget, a keret pedig a helyén
marad. Mérve 945 × 950 px viewporton: az oldal nem görget, vízszintes
görgetősáv nincs, az ügylista 522 px-en mutat 1680 px tartalmat, az EH-panel
850 px-en 7316-ot.

### 12.4 Ami a tervhez képest eltolódott

- **A hozzátartozó-sor DB-s mező lett.** A `hr_children` nyers szövegét egy
  sor mutatja, másolhatóan — ezért 31 a másolható DB-s mezők száma a tervezett
  30 helyett. A szétbontás továbbra is kézi (11. pont).
- **A fő űrlap 83 sor lett, nem 90.** A 8 `kicsikoru…` checkbox kimaradt: mind
  kézi jelölés, egyetlen adat sem tartozik hozzájuk. A `hozzatartozo1` sor
  viszont bekerült, innen a 83.
