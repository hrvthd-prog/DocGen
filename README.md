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
| **Beállítások** | Séma szerkesztése, export profilok, napló |

Az **Ügyek** fül címkéjén piros pötty jelzi, hány ügy határideje járt le.
Csak a lejártak kapnak jelzést — ha minden szám ott lenne, pár nap alatt
megszoknánk, és a jelzés semmit nem jelentene.

### Első használat

1. **Nyilvántartás** → *Adatmappa kiválasztása* — ide kerül a `docgen-employees.json`.
2. **Dokumentumok** → *Sablonmappa* — a `.docx` sablonok helye.
3. **Dokumentumok** → *Kimeneti mappa* — ide készülnek a kész iratok.

A választott mappákat a böngésző megjegyzi, nem kell újra kijelölni.

## Sablonok

A sablon sima `.docx`, a behelyettesítendő helyekre `{{Mezőnév}}` kerül:

```
Alulírott {{Teljes név}}, született {{Születési helye}}, {{Születési idő}},
anyja neve {{Anyja neve}}…
```

**Kétnyelvű sablonhoz** tedd ki az `_EN` végződést ugyanarra a mezőre:
`{{Neme}}` → „Férfi", `{{Neme_EN}}` → „Male". Ugyanaz az adat, két nyelven.

**Jelölőnégyzet:** `{{CHECK:Beszél magyarul}}` → ☒ vagy ☐.

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

## Az adatbekérő táblázat

A **Nyilvántartás** fülön két xlsx tölthető le:

- **üres sablon** → `adatbekero.xlsx` — ezt küldöd ki kitöltésre
- **feltöltött export** → `adatbekero-adatok-ÉÉÉÉHHNN.xlsx` — pillanatkép az adatokról

Az üres sablonban az **1. sor rejtett**: az a gépi kulcsokat tartalmazza, ami az
importhoz kell, a kitöltőnek nem. A kitöltő a **2. sort** látja, angol
címkékkel, és mind a 44 cellán ott a kitöltést segítő komment — angolul, példákkal.

A lap **jelszóval védett**, hogy a rejtett sor véletlenül se kerüljön elő:

> **Jelszó: `Aumovio2026`** — Excelben: *Korrektúra → Lapvédelem feloldása*.
> A `js/schema/export-profiles.js`-ben (`protection.password`) átírható.
>
> Ez **nem biztonsági eszköz** — az xlsx-lapvédelem percek alatt megkerülhető.
> Egyetlen célja, hogy a kitöltő ne bolygassa meg a fejlécet.

A kitölthető sorok száma 30. A védelem tiltja a sorbeszúrást, ezért ennél több
munkavállaló nem fér bele egy fájlba — a `protection.fillableRows` állítja.

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

Másold felül a fájlokat, **majd az `index.html`-ben növeld a verziószámot**:
csere `?v=1` → `?v=2`.

Ez nem formalitás. Enélkül a böngésző a gyorsítótárból veszi a régi JS-t, és a
felhasználók a frissítés után is a régi kódot futtatják — ez a fejlesztés során
valóban megtörtént, órákat vitt el, mire kiderült.

## Fejlesztés

```bash
node test/run-all.js
```

Kilenc tesztcsomag, 227 teszt. Böngészőt nem igényel.

| Csomag | Mit őriz |
|---|---|
| `auto-tests.js` | fájlnév-minták, naplózó API, docgen-szerkezet |
| `employee-repo.test.js` | azonosító-történet, tükrözés a mezőkbe |
| `schema.test.js` | séma mint adat, migráció, átnevezés |
| `schema-from-xlsx.test.js` | séma-javaslat új sablonból |
| `xlsx.test.js` | adatbekérő oda-vissza, lapvédelem, kiírás-időkorlát |
| `docgen-resolve.test.js` | kétnyelvű jelölők, számított mezők |
| `logger.test.js` | a napló nem hagyhatja el a gépet |
| `vbs-encoding.test.js` | a `.vbs` UTF-16 LE marad |
| `cases.test.js` | határidők, kimenetelek, idővonal, láncolás |

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
