# DocGen

Munkavállalói nyilvántartás és dokumentumgenerálás idegenrendészeti ügyintézéshez.

Az alkalmazás **kiegészíti az SAP-t**, nem váltja ki: azt az adatkört és
sablonkezelést viszi, amit az SAP nem tárol. Telepítést nem igényel — nincs
szerver, nincs futtatókörnyezet, nincs rendszergazdai jog.

---

## Indítás

Nyisd meg az `index.html`-t egy Chromium-alapú böngészővel (Chrome vagy Edge).
Duplakattintás is elég, ha az alapértelmezett böngésző ilyen.

A `file://` protokollról a mappaválasztás és a helyi tárolás is működik —
ez le van mérve, nem feltételezés. Firefox és Safari **nem alkalmas**: nem
ismerik a mappaválasztó API-t, ami a sablonok beolvasásához kell.

## A négy fül

| Fül | Mire való |
|---|---|
| **Dokumentumok** | Sablon kiválasztása, személyek kijelölése, generálás |
| **Nyilvántartás** | Személyek felvitele, keresés, xlsx be- és kivitel |
| **Ügyek** | Kérelmek és bejelentések követése, határidők, idővonal |
| **Beállítások** | Séma szerkesztése, szótár, export profilok, napló |

Az **Ügyek** fül címkéjén piros pötty jelzi, hány ügy határideje járt le.
Csak a lejártak kapnak jelzést — ha minden szám ott lenne, pár nap alatt
megszoknánk, és a jelzés semmit nem jelentene.

### Első használat

1. **Nyilvántartás** → *Adatmappa kiválasztása* — ide kerül a `docgen-employees.json`.
2. **Dokumentumok** → *Sablonmappa* — a `.docx` sablonok helye.
3. **Dokumentumok** → *Kimeneti mappa* — ide készülnek a kész iratok.

A választott mappákat a böngésző megjegyzi, nem kell újra kijelölni.

> A mappákat az app **nem tudja megnyitni az Intézőben**: a böngésző csak
> hozzáférési fogantyút ad, elérési utat nem, és nincs API a fájlkezelő
> indítására. A sidebar ezért a mappa nevét mutatja, gomb pedig csak a
> váltáshoz van. (Ezt korábban egy helyi kiszolgáló végezte; az kikerült a
> pipeline-ból.)

## Sablonok

A sablon sima `.docx`, a behelyettesítendő helyekre `{{Mezőnév}}` kerül:

```
Alulírott {{Teljes név}}, született {{Születési helye}}, {{Születési idő}},
anyja neve {{Anyja neve}}…
```

**Kétnyelvű sablonhoz** tedd ki az `_EN` végződést ugyanarra a mezőre:
`{{Neme}}` → „Férfi", `{{Neme_EN}}` → „Male". Ugyanaz az adat, két nyelven.

**Jelölőnégyzet:** `{{CHECK:Beszél magyarul}}` → ☒ vagy ☐.

### Több négyzet egy mezőre

A hatósági űrlapok az értéket nem kiírják, hanem bejelölik: „sex: ☐ male ☒
female". Ilyenkor a jelölőhöz oda kell írni, melyik értékre néz:

```
sex: {{CHECK:Neme=male}} male  {{CHECK:Neme=female}} female
educational attainment: {{CHECK:Iskolai végzettség=primary}} primary
```

A várt érték bármelyik elfogadott alakban írható — `Neme=male`, `Neme=Férfi`
és `Neme=ffi` ugyanazt jelenti, mert az összehasonlítás a mező kanonikus
értékén történik. Amire nincs adat, az üresen marad: **fel nem ismert értékre
egyetlen négyzet sem jelölődik be**, nem találgatunk.

### Dátum három rovatban

A hatósági formanyomtatványok a dátumot szétszedve kérik. A jelölőhöz fűzött
végződés kiveszi a kért részt — a nyilvántartásban egyetlen dátum marad:

```
date of birth: {{date_of_birth_year}} year {{date_of_birth_month}} month {{date_of_birth_day}} day
kiállítva:     {{pp_validity_év}} év {{pp_validity_hónap}} hó {{pp_validity_nap}} nap
```

Végződés nélkül (`{{date_of_birth}}`) a teljes dátum jön, **magyar alakban:**
`1988.04.12.` Tárolni ÉÉÉÉ-HH-NN alakban tárolunk — az megy az adatbekérőbe és
az exportba is —, a magyar alakra csak a dokumentumba íráskor vált.

Ha az adat nem ÉÉÉÉ-HH-NN alakú, a rész **üresen marad** — csonka dátumból nem
találgatunk, és a teljes dátumot sem írjuk át szebbnek látszó, de hamis alakra.

> Az üres adatbekérő dátumoszlopai `yyyy-mm-dd` formátumot kapnak. Enélkül az
> Excel a beírt dátumot a kitöltő gépének területi beállítása szerint mutatná
> (angol rendszeren `3/15/1990`), és a kitöltő azt hinné, elrontotta.

### Szótár: angolul érkezik, magyarul kell

Az ország, a munkakör vagy a szakképesítés angolul jön a kitöltőtől, a magyar
iratba viszont magyarul kell. Ezt **nem** két oszloppal oldjuk meg: egy oszlop
érkezik, a fordítást a **Beállítások → Szótár** adja.

| Jelölő | Mit ad |
|---|---|
| `{{previous_country}}` | magyarul (ez az alapértelmezés) |
| `{{previous_country_hun}}` | magyarul |
| `{{previous_country_eng}}` | ahogy a táblázatban érkezett |

A szótár soronként egy pár: `angol = magyar`. Tabulátor és pontosvessző is
elválasztó, így két Excel-oszlop közvetlenül beilleszthető. Amire nincs pár, az
változatlanul megy tovább — a hiányzó fordítás nem hiba, csak nem fordít.

A szótár a **szabad szöveges** mezőkre hat, mezőtől függetlenül: egy
„Serbia → Szerbia" pár mindenhol ugyanazt jelenti. A választható (enum) mezőket
nem érinti, azoknak saját értéklistájuk van a sémában.

> A `_hun` végű mezőkulcsok (`previous_country_hun` stb.) emiatt lerövidültek.
> A régi kulcs jelölőként megmarad, ezért a korábban kiküldött adatbekérők
> importja változatlanul működik; a meglévő adat a séma betöltésekor magától
> átköltözik az új kulcsra.

### Amit nem kérdezünk meg, mert kiszámolható

Van adat, ami egy másikból következik — azt nem kérjük be még egyszer. A
hazautazás módja ilyen: a szomszédos országokból busszal, távolabbról repülővel
megy haza az ember, tehát az **állampolgárság** eldönti. A séma ezt szabályként
írja le, nem kódként:

```js
{ key: 'transport_type', type: 'computed',
  computed: {
    from: ['citizenship'],
    lookup: { bus: ['Ausztria', 'Szlovákia', 'Ukrajna', 'Románia',
                    'Szerbia', 'Horvátország', 'Szlovénia'] },
    default: 'airplane',
  } }
```

Az ilyen mező **nem kerül ki az adatbekérőbe** (nincs értelme megkérdezni), a
kimenete pedig a szótáron megy át, mint bármelyik szabad szöveg. Ha nincs
forrásadat, üres marad — nem találgatunk. Új küldő ország felvételéhez a
**Beállítások → Séma** lapon kell bővíteni a listát.

Hogy egy mezőnek pontosan mi a jelölője, a **Beállítások → Séma** fülön látszik.
Amire nem volt adat, azt a *Hiányzó adatok naplója* utólag is megmutatja.

## Adatok helye és biztonsága

Minden adat a **te gépeden marad**, semmi nem megy ki hálózatra.

```
data/docgen-employees.json   ← a személyek (érzékeny adat!)
data/docgen-cases.json       ← az ügyek és eseménytörténetük (érzékeny adat!)
data/docgen-config.json      ← séma, export profilok, ügytípusok
                               (személyes adat nélkül)
data/backup/                 ← időbélyeges mentések, utolsó 20
```

A `data/` mappát a `.gitignore` kizárja — **éles adat soha nem kerül
verziókezelésbe**. A `docgen-config.json` viszont nem tartalmaz személyes
adatot, így gépek közt szabadon vihető.

> A nyilvántartás útlevélszámot, TAJ-t, adóazonosítót és anyja nevét tárol.
> Ez GDPR-értelemben érzékeny kör — a tárolás helyét (helyi gép vagy céges
> meghajtó) érdemes az adatvédelemért felelőssel egyeztetni, mielőtt éles
> adat kerül bele.

## Azonosítók

A SAP-szám minden új tartózkodási engedéllyel változik, és a régit nem adják ki
újra — ezért **nem lehet kulcs**. Az app belső, soha nem változó azonosítót
használ, mellette pedig **megőrzi az összes korábbi külső azonosítót**.

Ennek a gyakorlati haszna: a két éve lejárt engedélyszámra is megtalálod az
embert, és az ismételt import nem hoz létre duplikátumot.

Új engedély rögzítése egy lépés: *Új azonosító* — a régi automatikusan lezárul.

## Kilépés és törlés

**Kilépettnek jelölés** a normál út: az adat megmarad, csak kikerül a listákból
és a generálásból — bármikor visszavehető. (Ez volt korábban az „archiválás";
az adatfájlban is `exited` a neve, nem `archived` — a régi kulcs betöltéskor
egyszer átfordul.)

A **kilépés dátuma kötelező**, mert ebből fut a bejelentési határidő. A
megadott nap a séma *Kilépés dátuma* mezőjébe is bekerül, hogy az xlsx-export a
tényleges — ne a felvételkor tervezett — utolsó munkanapot vigye.

Rögzítés után az app kiírja, hogy a munkaviszony megszűnését **be kell jelenteni
az OIF-nak 5 napon belül**, kiszámolja a határnapot, és megmondja, hány nap van
hátra — vagy hogy hány napja lejárt. Egy kattintással meg is nyitható rá a
*Munkaviszony megszűnésének bejelentése* ügy, hogy a határidő az **Ügyek** fülön
is látszódjon, ne csak egy elkattintott ablakban.

**Törlés** téves felvitelre való, és valóban töröl: a személyt, az
azonosító-történetét és az ügyeit. A párbeszéd előbb kiírja, mi tűnik el. A
visszaút a `data/backup/` mappa — a mentés a törlés *előtti* állapotról készül.

## Az adatbekérő táblázat

A **Nyilvántartás** fülön két xlsx tölthető le:

- **üres sablon** → `adatbekero.xlsx` — ezt küldöd ki kitöltésre
- **feltöltött export** → `adatbekero-adatok-ÉÉÉÉHHNN.xlsx` — pillanatkép az adatokról

Az üres sablonban az **1. sor rejtett**: az a gépi kulcsokat tartalmazza, ami az
importhoz kell, a kitöltőnek nem. A kitöltő a **2. sort** látja, angol
címkékkel, és minden cellán ott a kitöltést segítő komment — angolul, példákkal.

Böngésző nélkül, a parancssorból is legenerálható — ugyanaz a séma és ugyanaz a
kód fut, mint a gomb mögött:

```bash
node tools/adatbekero.js            # ide: adatbekero.xlsx
node tools/adatbekero.js ../ki.xlsx
```

A szkript a kiírás után **visszaolvassa** a fájlt az éles importálóval, és csak
akkor írja ki, ha minden oszlop mezőhöz kötődik és nincs címke-ütközés.

### Tájékozódás hetven oszlopban

A fejléc színe a mező **csoportját** jelöli (lakcím, okmányok, foglalkoztatás…),
színváltásnál vastag vonal van, és az első három oszlop görgetéskor is állva
marad. A **kötelező** mező ettől függetlenül piros: az erősebb jelzés.

A csoportok nem egybefüggő blokkok, mert az oszlopsorrend a hatósági
nyomtatványé: abban pl. a szakképzettség és az iskolai végzettség a személyes
adatok között van, a nyelvismeret viszont csak a betétlapon. A szín tehát
jelmagyarázat; az `Útmutató` lap *Csoport* oszlopa ugyanezt a színt viseli.

### Az oszlopsorrend a hatósági nyomtatványé

A sorrend a **9. sz. tartózkodási engedély iránti kérelem** és a betétlapjai
(9.7. Vendégmunkás, 9.9. EU Kék Kártya) rovatsorrendje:

```
borító (engedélyszám, lejárat, telefon, e-mail)
1. pont  személyes adatok → szakképzettség → végzettség → korábbi foglalkozás
2. pont  útlevél: szám → kiállítás ideje → kiállítás HELYE → típus → érvényesség
3. pont  szálláshely: helyrajzi szám → irányítószám → … → ajtó → jogcím
6. pont  eltartott hozzátartozók
7. pont  az érkezést megelőző lakcím
betétlap bér → munkakör (FEOR) → nyelvismeret → korábbi magyar munkahely
──────── innentől, ami egyik nyomtatványon sincs: adóazonosító, TAJ,
         vészhelyzeti kapcsolattartó, és a HR saját rovatai
```

Így az ügyintéző fentről lefelé haladva vezeti át az adatokat, nem ugrál a
táblázatban. A sorrend **szerződés**: a `schema.test.js`-ben egy felsorolás
(`HATOSAGI_SORREND`) őrzi, és a teszt bukik, ha elcsúszik.

> Korábban az eredeti 44 oszlopos adatbekérő sorrendje volt a szerződés. Ezért
> a tesztek nem oszlopszám, hanem **kulcs szerint** keresik a cellákat — így egy
> újabb átrendezés nem buktat el tizenhat tesztet ok nélkül.

Az első hét oszlop görgetéskor is áll: a névvel bezárólag. Ez ~145 karakternyi
szélesség — ha sok, a `style.freezeColumns` lejjebb vehető, de a névnél
kevesebbnek nincs értelme.

### HR-oszlopok: egy táblázat menjen ki, ne kettő

A HR korábban külön, álló „Personal Data Sheet" űrlapon kérte be a maga
adatait. Azok a rovatok, amiknek **nincs párja** az idegenrendészeti adatkörben,
`hr_` előtagú oszlopként vannak benne — de nem egy blokkban a végén, hanem
**annál a hatósági rovatnál, amelyikhez tartoznak**: a kettős állampolgárság az
állampolgárság mellett, az iskola és az oklevél adatai a végzettségnél, a
nyelvtudás a betétlap nyelvismeret-rovatánál, a gyerekek a kérelem 6. pontjánál.
A bankszámla és a HR által kitöltendő három rovat a tábla végén marad.

**Egyetlen dokumentum-jelölő és számított mező sem hivatkozik rájuk** — a DocGen
tárolja és visszaexportálja őket, de iratba nem kerülnek. Amit a HR-lap és az
idegenrendészeti kör egyaránt kér (adóazonosító, TAJ, munkakör, FEOR, bér,
belépés dátuma), az **nincs megkettőzve**: a meglévő mező viszi. Két HR-rovat
ezért ki is maradt: az „Identity Card Number" az útlevélszám (`pp_number`), a
„Professional Background" pedig az `occupation_before_arrival`.

> A `hr_` előtag nem kozmetika. Az importáló a fejlécet kulcs, majd
> magyar/angol **címke** és jelölő szerint próbálja mezőhöz kötni, ezért egy
> „Tax number" fejlécű HR-rovat egyenesen az adóazonosítóba költözne. Új
> HR-mezőnél a szabály: egyedi kulcs, egyedi magyar ÉS angol címke, jelölő
> nélkül. A `schema.test.js` ezt géppel is méri.

Ami a HR-lapon egy cellában volt, de a DocGen többől számol (`Name`,
`Mother's name`, `Place of birth`, `Home address`), az **bontva** szerepel —
számított mezőbe importálni nem lehet. A HR-lap ismétlődő blokkjai (nyelvvizsgák,
gyerekek) egy „egy sor = egy ember" táblába nem férnek: egy-egy szabad szöveges
cellába kerültek, gépi feldolgozásra nem alkalmasak. Ha a hatósági kitöltéshez
ez kevés lesz, fix rekeszekre kell bontani őket (`hr_child_1_name`, …).

A lap **jelszóval védett**, hogy a rejtett sor véletlenül se kerüljön elő:

> **Jelszó: `Aumovio2026`** — Excelben: *Korrektúra → Lapvédelem feloldása*.
> A `js/schema/export-profiles.js`-ben (`protection.password`) átírható.
>
> Ez **nem biztonsági eszköz** — az xlsx-lapvédelem percek alatt megkerülhető.
> Egyetlen célja, hogy a kitöltő ne bolygassa meg a fejlécet.

A kitölthető sorok száma 30. A védelem tiltja a sorbeszúrást, ezért ennél több
munkavállaló nem fér bele egy fájlba — a `protection.fillableRows` állítja.

### „HR adatlap" — nyomtatható lap makró nélkül

A munkafüzet harmadik lapja a HR korábbi *Personal Data Sheet* elrendezését
hozza, álló A4-en. A tetején **egyetlen írható cella** van: a személy sorszáma a
`Data` lapon. Minden érték `INDEX`-képlettel onnan jön, tehát átíráskor magától
frissül — nyomtatás és PDF a szokásos Ctrl+P, illetve *Mentés PDF-ként*.

```
B2 = 1        → az első kitöltött sor adatlapja
B2 = 7        → a hetediké
```

**Miért képlet és nem makró:** a makrós munkafüzet `.xlsm`, azt a céges
makróvédelem és a levélszűrők blokkolhatják, ráadásul az ExcelJS nem tud
VBA-projektet írni — a sablon így nem lenne generálható. A képlet ugyanazt adja,
üzemeltetési kockázat nélkül. A lap védett, a vezérlőcella kivételével minden
zárolt: egy elgépelés különben némán kitörölné az adatlap felét.

Az **elrendezés adat**, a `printSheet` a `js/schema/export-profiles.js`-ben:
szakaszok, soronként egy címke és a mögötte álló mezőkulcsok. Több kulcs egy
cellába fűződik (szóközzel, `TRIM`-mel — üres mező így nem hagy lyukat vagy lógó
elválasztót). Ismeretlen kulcsú sor kimarad, nem hibázik.

> A képletek oszlopbetűi a séma sorrendjéből származnak, ezért egy átrendezés
> némán elcsúsztathatná őket — az útlevélszám helyén a TAJ jelenne meg,
> hibaüzenet nélkül. Az `xlsx.test.js` ezért mezőnként visszafejti a képleteket
> és összeveti a `Data` lap tényleges oszlopaival.

Két rovat nem 1:1 az eredetivel: a **nyelvtudás** (a HR-lapon háromoszlopos
alrács volt) és a **gyerekek** egy-egy szabad szöveges cella, mert a táblázatban
is az. Az „ID number" rovatba az **útlevélszám** kerül — a külföldi
munkavállalónak nincs magyar személyi igazolványa.

## Ügyek és határidők

Az idegenrendészeti ügyintézés nem állapot, hanem folyamat: a kérelmek egymás
után következnek, és közben be- meg kijelentéseket is határidőre kell tenni.
Az **Ügyek** fül ezt követi.

### Kétféle határidő, és egyik sem magától értetődő

| | Honnan fut | Mennyi | Ki adja meg |
|---|---|---|---|
| **Ügyintézési határidő** | OIF-érkeztetés napja | 70 nap | te, az iktatószámmal együtt |
| **Bejelentési határidő** | a tény bekövetkezése | 3 vagy 5 nap | te |

**Egyetlen határidőt sem tud a program magától.** Az érkeztetés napját az
iktatószámmal kapod meg; a költözés vagy a munkakezdés napját szintén csak te
tudod. Ezért amíg nincs megadva a kezdő nap, **nincs határidő** — és ez nem
hiányosság. Kitalálni egyet félrevezetés lenne.

A bejelentési határidők **tájékoztató** jelöléssel jelennek meg (*„a megadott
nap szerint 3 napja lejárt"*), mert egy be nem írt vagy elgépelt dátum esetén
a program téved, nem te. Az érkeztetéstől futó 70 nap ezzel szemben
iktatószámmal igazolható — arra lehet hivatkozni.

| Bejelentés | Határidő |
|---|---|
| Szálláshely-változás | a költözéstől 3 nap |
| Munkaviszony megkezdése | a ténytől 5 nap |
| Munkaviszony megszűnése | a ténytől 5 nap |

### Benyújtási ablak

Ez az **egyetlen** dolog, amit a program ki tud számolni — a meglévő engedély
lejárata a nyilvántartásban van. Meghosszabbításnál három mérföldkő:

```
─────●━━━━━━━━━━━●━━━━━━━●───────●
   −90         −40     −10    lejárat
  korai      ideális  siess  lekésve
```

Ez **nem** a 70 nap: az a hatóság döntési ideje, ez a mi benyújtási ablakunk.
A kettő külön ponton jelenik meg az idővonalon.

### Idővonal

Minden ügynek van idővonala: a megtörtént események, a számított mérföldkövek,
a határidő és a mai nap. A **számított** pontok láthatóan el vannak különítve
a rögzített tényektől — az egyik következtetés, a másik megtörtént dolog.

**Utólag is rögzíthetsz.** Ha ma viszed fel a múlt keddi hiánypótlási
felhívást, állítsd a *Mikor történt?* mezőt a valós napra — az idővonal a
történés szerint rendez, nem a gépelés szerint. A rögzítés ideje külön
megmarad audit-nyomnak, és **nem módosítható**; az utólag felvitt bejegyzések
ezt ki is írják.

### A ciklus zárása

Ha egy meghosszabbítás megadással zárul, az app bekéri az új engedélyszámot
**és a lejáratát**. A lejárat a dolgozó adatai közé is bekerül — enélkül a
következő ablak a régi, már lejárt engedélyből számolna. Utána egy kattintással
előjegyezhető a következő ciklus, a saját ablakával.

## PDF

A generálás `.docx`-et készít. A PDF-fé alakítás **külön lépés**, mert
böngészőből nem lehet Wordöt vezérelni, szervert pedig nem telepíthetünk.

1. Generálj — a `.docx` fájlok a kimeneti mappába kerülnek
2. Másold a **`tools/docx-pdf.vbs`** fájlt a kimeneti mappába, és kattints rá
   duplán (vagy húzd rá a mappát) — minden `.docx` mellé PDF kerül, almappákban is
3. Ha összefűzött PDF is kell: **Dokumentumok → Összefűzés a kimeneti mappából**

A konverzió a Wordöt használja, ezért a PDF **teljesen hű** az eredetihez.
Ha már fut a Word, a szkript ahhoz csatlakozik és nem zárja be a végén.

> **Ha szerkeszted a `.vbs` fájlt:** UTF-16 LE kódolással, BOM-mal mentsd.
> A Windows Script Host különben ANSI-ként olvassa, és minden ékezet elromlik —
> nemcsak az üzenetekben, hanem a PDF-ben is. (UTF-8 BOM-mal el sem indul.)
> A `test/vbs-encoding.test.js` ezt ellenőrzi.

A környezet felmérésének csomagja: [`tools/pdf-proba/`](tools/pdf-proba/OLVASD-EL.md),
az eredménye: [`EREDMENY.md`](tools/pdf-proba/EREDMENY.md).

## Frissítés

```bash
node tools/kiadas.js
```

Lefuttatja a teszteket, ellenőrzi, hogy a repó önmagában is teljes, majd lépteti
a gyorsítótár-verziót. Ha bármi bukik, **megáll** — hibás kódot nem ad ki.
Utána már csak a fájlokat kell átmásolni a megosztott mappába.

A verziólépés nem formalitás: enélkül a böngésző a gyorsítótárból veszi a régi
JS-t, és a felhasználók a frissítés után is a régi kódot futtatják — ez a
fejlesztés során **háromszor** megtörtént.

Csak nézni, változtatás nélkül: `node tools/kiadas.js --csak-ellenoriz`

## Verziószámok

A verzió `fő.al` alakú, például **10.27**:

| rész | mit jelent | ki lépteti |
|---|---|---|
| fő | kiadás | `node tools/kiadas.js` |
| al | a commit sorszáma (`git rev-list --count HEAD`) | a `pre-commit` hook, minden commitnál |

Az alverziót nem tárolja semmi, a commit-számból számoljuk — így nem tud
elcsúszni, és merge-nél sincs mit ütköztetni.

A verzió három helyen látszik: a **fejlécben**, a **Beállítások** fül Verzió
kártyáján, és a repóban **git tagként** (`v10.27`), amit a `post-commit` hook
készít. A GitHub *Tags* oldala így a teljes verzió-idővonal: a felületen látott
számról egy kattintással a pontos commitra lehet jutni.

> **A használat helyén nincs teendő, és nem is kell git.** Az app egy izolált
> gépen, hálózat nélkül fut; a `js/version.js` sima statikus fájl, a program
> soha nem hív gitet. A verzió a másolt fájlokkal együtt utazik. A felületen
> ezért nincs GitHub-hivatkozás sem – az ott csak egy üres fület nyitna.

**A fejlesztői gépen** viszont egyszer be kell állítani, különben nincs
verzióléptetés (a git a configot szándékosan nem klónozza):

```bash
git config core.hooksPath tools/hooks
git config push.followTags true    # hogy a tagek is felmenjenek
```

Az állapot ellenőrzése: `node tools/verzio.js --ellenoriz`

Rebase és merge közben a hook kihagyja magát — ott minden újrajátszott commit
átírná az `index.html`-t, ami garantált ütközés.

## Ha megsérül az adatfájl

Az app ilyenkor **nem indul el üresen** — kiírja, mi történt, és felajánlja a
visszaállítást.

Ez korábban másképp volt: a program összemosta a „még nincs adatfájl" és a
„van fájl, de olvashatatlan" esetet, ezért egy sérült fájl után üresen indult,
minden jelzés nélkül. A felhasználó azt látta, hogy nincs adat — és az első
módosítás felülírta a még menthető tartalmat.

A `data/backup/` mappában az utolsó 20 mentés van. A visszaállító párbeszéd
mindegyiknél kiírja, **hány személyt tartalmaz** — ez alapján lehet választani,
nem a fájlnév alapján. A lépés **visszafordítható**: a jelenlegi (akár sérült)
állapotról is mentés készül előtte.

> A böngésző tárolójával — adatmappa kiválasztása nélkül — **nincs mentés**.
> Éles adathoz mindig válassz adatmappát a Nyilvántartás fülön.

## Fejlesztés

```bash
node test/run-all.js
```

Tizenkét tesztcsomag, 322 teszt. Böngészőt nem igényel.

| Csomag | Mit őriz |
|---|---|
| `auto-tests.js` | fájlnév-minták, naplózó API, docgen-szerkezet |
| `employee-repo.test.js` | azonosító-történet, tükrözés a mezőkbe |
| `schema.test.js` | séma mint adat, migráció, átnevezés |
| `schema-from-xlsx.test.js` | séma-javaslat új sablonból |
| `xlsx.test.js` | adatbekérő oda-vissza, lapvédelem, kiírás-időkorlát |
| `docgen-resolve.test.js` | kétnyelvű jelölők, dátum-részek, szótár, számított mezők |
| `logger.test.js` | a napló nem hagyhatja el a gépet |
| `vbs-encoding.test.js` | a `.vbs` UTF-16 LE marad |
| `cases.test.js` | határidők, kimenetelek, idővonal, láncolás |
| `e2e.test.js` | **körbe-teszt:** táblázat → nyilvántartás → export |

### Próbaanyag

A `test/fixtures/` mappában kitalált emberekkel dolgozó próbafájlok vannak:

- **`proba-import.xlsx`** — 7 sor, mindegyik más esetet állít: kanonikus
  értékek, szinonimák (`ffi`, `Hajadon`, `Igen`), vegyes dátumalakok, lejárt
  azonosítós visszatérő, fájlon belüli duplikátum, hiányzó kötelező mező,
  kétértelmű dátum
- **`sablonok/`** — öt `.docx` próbasablon minden jelölő-fajtára

A negyedik sablon (`04-tordelt-jelolok.docx`) magyarázatra szorul: benne a
jelölők **több futamra vannak szétvágva**, ahogy a Word teszi gépelés közben
(`{{` + `Ne` + `me` + `}}`). Ez a leggyakoribb valós hiba dokumentumsablonoknál.

Az ötödik (`05-datum-reszek.docx`) a hatósági formanyomtatvány esetét állítja:
dátum három rovatban, és szótárból fordított ország/munkakör.

Újragenerálás a séma változása után:

```bash
node tools/tesztanyag-keszito.js
```

### Dokumentum-renderelés tesztje

A docxtemplater `DOMParser`-t igényel, ami Node-ban nincs — ezért a
dokumentumok tényleges kitöltése böngészőben fut. Indíts egy kiszolgálót,
nyisd meg az appot, majd a konzolba illeszd be a `test/e2e-browser.js`
tartalmát. 31 ellenőrzés fut le: számított mezők, kétnyelvű párok,
jelölőnégyzetek, tördelt jelölők, dátum-részek, szótár, hiányzó-adat napló.

Ugyanígy futtatható a `test/formanyomtatvany-check.js`, ami a valódi hatósági
űrlapot (`test/fixtures/sablonok/06-tartozkodasi-engedely-kerelem.docx`) méri:
felismeri-e a séma mind az 55 jelölőt, jó helyre kerül-e a 11 jelölőnégyzet, és
mi marad üresen adathiány miatt. A próbaszemélyek a `proba-szemelyek.json`-ból
jönnek, ami a kitöltött adatbekérő importjából állt elő.

Nincs build-lépés és nincs csomagkezelő: a `js/` fájljai közvetlenül töltődnek
be, a sorrendjük az `index.html`-ben számít. Új modul a saját rétegének végére
kerül (service → séma → modul).

```
js/services/   tárolók és fájlműveletek (employee-repo, case-repo, xlsx, docx)
js/schema/     séma, ügytípusok, export profilok – mind ADAT, nem kód
js/modules/    felület: docgen/, registry/, cases/, settings/
```

**Ami adat, azt ne kódba írd.** A mezőséma, az ügytípusok, a státuszok, a
határidők és az export profilok mind szerkeszthető adatok — ha egy eljárás
változik, azokat módosítjuk, nem a JavaScriptet.

## Tervek

- [TERV.md](TERV.md) — az alapok: nyilvántartás, séma, xlsx, docgen, PDF
- [TERV-esemenyek.md](TERV-esemenyek.md) — ügykövetés és státusz-betekintő
- [TERV-tesztanyag.md](TERV-tesztanyag.md) — próbasablonok és körbe-teszt
- [TERV-adatbiztonsag.md](TERV-adatbiztonsag.md) — sérült fájl, visszaállítás, kiadás
