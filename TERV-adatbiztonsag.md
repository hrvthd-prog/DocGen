# Adatbiztonság és kiadási folyamat — terv

## 0. Miért ez a négy dolog

A tesztanyag készítése három hiányosságot hozott felszínre, és egy negyediket
maga a folyamat. Egyik sem elmélet — mindet lemértem.

| # | Probléma | Súly |
|---|---|---|
| 1 | Sérült adatfájl esetén az app némán üresen indul | **adatvesztés** |
| 2 | 20 biztonsági másolat készül, egyet sem lehet visszatölteni | **adatvesztés** |
| 3 | A `?v=` verziólépést semmi nem őrzi | rossz kód éles használatban |
| 4 | Hiányzó fixture hetekig észrevétlen | a tesztek hazudtak |

Az 5. javaslat (böngészős teszt automatizálása headless böngészővel) **kimarad**:
az első npm-függőség lenne ebben a projektben, és a build-lépés hiánya valódi
érték egy telepítés nélküli belső eszköznél.

---

## 1. Sérült adatfájl — a néma üres indulás

### A hiba

A `createFileBackend.load()` két gyökeresen különböző esetet mos össze:

```js
async load() {
  try {
    const text = await FsService.readTextFromDir(dirHandle, filename);
    return JSON.parse(text);
  } catch {
    return null;   // „még nincs adatfájl – üres nyilvántartással indulunk"
  }
}
```

A `catch` elnyeli:

- **a fájl nem létezik** → jogos, üresen indulunk (első használat)
- **a fájl létezik, de olvashatatlan** → NEM jogos: van adat, csak nem fér hozzá

Lemért lefutás csonka JSON-nal:

```
A fájlon 1 személy volt, de sérülten.
Betöltés után a nyilvántartás: 0 személy
✗ Az app ÜRESEN indul, és semmi nem jelzi, hogy baj van.
✗ Egyetlen módosítás után a sérült adat FELÜLÍRÓDOTT.
```

A mentés előtti biztonsági másolat megmenti a tartalmat, de a felhasználó ebből
semmit nem lát. Amit lát: „nincs adat". Reális reakció, hogy újraimportál
mindent — és onnantól két adathalmaz keveredik.

### A javítás

A háttér **különböztesse meg** a két esetet:

```
fájl nincs        → null            (üres nyilvántartás, minden rendben)
fájl van, hibás   → hibát DOB       (a hívó dolga eldönteni, mi legyen)
```

A `load()` ne nyelje el: engedje a hibát felszínre. A felület kapja el, és
**ne induljon el üresen** — helyette mondja ki, mi történt, és ajánlja fel a
visszaállítást (2. pont).

**Ez egy javítással két tárolót gyógyít:** a `CaseRepo` ugyanezt a
`createFileBackend`-et használja.

### Kockázat, amire figyelni kell

Az üres fájl (0 bájt) is `JSON.parse` hibát ad. Az valós eset lehet
félbeszakadt írás után — ugyanúgy sérülésként kell kezelni, nem „nincs fájl"-ként.

---

## 2. Visszaállítás biztonsági másolatból

### A hiba

A `data/backup/` mappába minden mentés előtt időbélyeges másolat készül, az
utolsó 20 megmarad. Végigkerestem a kódot: **nincs visszaállító út**. Kézzel
átmásolható a fájl, de ezt sehol nem írja le semmi, és pánikban senki nem
találja ki.

Egy mentés, amit nem tudsz visszatenni, nem mentés.

### A megoldás

A Nyilvántartás fülre egy **„Visszaállítás mentésből"** párbeszéd:

- listázza a `backup/` tartalmát, időbélyeg szerint, legfrissebb elöl
- mindegyiknél kiírja, **hány személyt tartalmaz** — ez a fontos, nem a fájlnév
- visszaállítás előtt a jelenlegi állapotot is elmenti (a mentési út amúgy is
  ezt teszi, de itt explicit legyen)
- megerősítést kér, mert felülír

**Ahol a legtöbbet ér:** az 1. pont hibaüzenetéből közvetlenül elérhető legyen.
Aki sérült fájllal indít, egy kattintással jusson a visszaállításhoz.

### Amit NEM csinálunk

Automatikus visszaállítást. Ha az app magától visszatöltene egy régebbi
állapotot, az csendben eldobná az azóta történteket. A döntés a felhasználóé.

---

## 3. Kiadási szkript — a `?v=` verziólépés

### A hiba

A fejlesztés alatt **háromszor** fordult elő, hogy a böngésző a régi kódot
adta. Ellenőriztem: semmilyen teszt vagy szkript nem figyeli a verziót.

Éles használatban ez azt jelenti, hogy frissítés után a felhasználók csendben
a frissítés előtti kódot futtatják — amíg valaki Ctrl+F5-öt nem nyom.

### A megoldás

`tools/kiadas.js` — egyetlen parancs a megjegyzendő rítus helyett:

```
node tools/kiadas.js
```

1. lefuttatja a teljes tesztcsomagot — ha bukik, **megáll** (nem ad ki hibás kódot)
2. lépteti a `?v=N` számot az `index.html`-ben és a `print.html`-ben
3. kiírja, mit lépett és hány hivatkozáson

Kapcsolóval: `--csak-ellenoriz` (nem ír semmit, csak jelenti a mai állást).

### Miért nem teszt

Egy teszt nem tudja, hogy „változott-e a JS az utolsó kiadás óta" — ehhez
állapotot kellene tárolnia, ami maga is elavulhat. A kiadás viszont amúgy is
egy tudatos pillanat: oda való a lépés.

---

## 4. Klón-próba

### A hiba

A hiányzó fixture **hetekig** észrevétlen maradt. Nem kódhiba volt: a
tesztkészlet csak az én gépemen volt teljes. Amíg nem klónoztam, semmi nem jelezte.

### A megoldás

`tools/klon-proba.js` — ideiglenes mappába klónoz, lefuttatja a teszteket,
takarít:

```
node tools/klon-proba.js
```

Ez az egész **hibaosztályt** kizárja, nemcsak ezt az egy esetet: bármi, ami
verziókezelésből kimaradt, itt kiderül.

Beépítjük a kiadási szkriptbe is — kiadás előtt fusson le.

---

## 5. Végrehajtás és ellenőrzés

Sorrend a súly szerint; minden lépés után mérés, nem feltételezés.

| # | Lépés | Hogyan bizonyítjuk |
|---|---|---|
| 1 | A háttér megkülönbözteti a hiányzó és a sérült fájlt | teszt: csonka JSON → hiba, hiányzó fájl → üres |
| 2 | A `load()` nem nyeli el a hibát | teszt: a hívó megkapja |
| 3 | A felület nem indul üresen sérült fájlnál | böngésző: a hibaüzenet megjelenik |
| 4 | Visszaállító párbeszéd | teszt a listázásra, böngésző a kattintásra |
| 5 | `tools/kiadas.js` | próbafuttatás, majd `git diff` az `index.html`-en |
| 6 | `tools/klon-proba.js` | fusson le, és **bukjon** is, ha valamit kiveszek a repóból |

A 6. lépés második fele a lényeg: egy ellenőrzés, ami nem tud bukni, semmit
nem ér. Szándékosan elrontom, hogy lássam a bukást.

## 6. Amit ez a terv NEM old meg

- **Egyidejű szerkesztés két gépről.** Ha a `data/` közös meghajtón van, két
  felhasználó felülírhatja egymást. Ez külön kérdés (zárolás-fájl), és a
  jelenlegi egyfelhasználós használatnál nem sürgős.
  **→ 2026-09-29: a premissza megdőlt** (2-5 felhasználó, közös mappa, gyakran
  egyszerre). A feloldás a 7. fejezetben.
- **A böngésző-tároló (IndexedDB) mentése.** Ott nincs `backup/` mappa. Aki
  fájl-alapú tárolás nélkül használja az appot, annak nincs mentése — ezt a
  README-nek ki kell mondania.

## 7. Egyidejű szerkesztés közös mappán (2026-09-29)

*A 6. pont első sorának feloldása: a „jelenlegi egyfelhasználós használat” premisszája megdőlt. A felhasználó válasza: **2-5 fő, közös mappa, gyakran egyszerre**.*

### A hiba

A nyilvántartás **egyetlen fájlban** él (`docgen-employees.json`, `docgen-cases.json`), és a mentés **read-modify-write, zárolás nélkül**: `js/services/employee-repo.js` beolvas (`FsService.readTextFromDir`), a memóriában módosít, majd visszaír (`FsService.writeTextToDir`). Sem mentés előtti frissesség-ellenőrzés, sem zárolás nincs.

Két felhasználó egyidejű munkájának menete:

```
A megnyitja       → a memóriában a 14:00-as állapot
B megnyitja       → a memóriában a 14:00-as állapot
A felvesz egy dolgozót, ment  → a fájlban 15 dolgozó
B módosít egy címet, ment     → a fájlban 14 dolgozó — A munkája eltűnt
```

**Nincs hibajelzés, nincs ütközés, nincs nyom** a felületen. B a saját, helyes mentését látja; A legközelebb veszi észre, hogy a felvett dolgozó nincs meg — vagy nem veszi észre.

**Enyhítő körülmény:** az `employee-repo.js` írás előtt elteszi az előző példányt időbélyeggel a backup mappába, tehát az adat **helyreállítható**. De nem érzékelhető, és a visszaállítás A többi közben tett módosítását is visszapörgeti.

**Miért most:** ez a kockázat **nagyobb tétel, mint a két alkönyvtár mappaszerkezete** (`TERV-mappaszerkezet.md`), mert nem kényelmi kérdés, hanem adatvesztés. És pont akkor lép életbe, amikor többen elkezdenek a közös mappában dolgozni — tehát **a többfelhasználós használat megkezdése előtt** kell rendezni, nem utána.

### A megoldás — frissesség-ellenőrzés, nem zárolás

Mentés előtt olvassuk vissza a fájlt, és hasonlítsuk össze azzal, amiből kiindultunk:

1. Betöltéskor jegyezzük fel a fájl azonosítóját — `File.lastModified` **és** a benne lévő legnagyobb `updatedAt`, a kettő közül a megbízhatóbbat használva (hálózati meghajtón az óra elcsúszhat, ezért az `updatedAt` a vezető jel).
2. Mentés előtt olvassuk vissza. Ha a fájl azonosítója eltér a feljegyzettől → **ne írjunk**, hanem szóljunk: „A nyilvántartás közben megváltozott (utoljára <felhasználó>, <időpont>). Töltsd újra, és ismételd meg a módosítást.”
3. Sikeres írás után frissítsük a feljegyzett azonosítót.

**Miért ez, és nem zárolás-fájl:** a lockfájl elárvul (összeomlás, bezárt fül, hálózati szakadás), ezért lejárat, heartbeat és kézi feloldás is kell hozzá — 2-5 fős csapatnál ez több kód és több hibalehetőség, mint amennyi haszon. A frissesség-ellenőrzés **nem előzi meg** az ütközést, de **láthatóvá teszi**, és ez a lényegi különbség a mai állapothoz: ma az adat némán tűnik el.

**A `updatedBy` már ott van.** Az `employee-repo.js` és a `case-repo.js` minden módosításnál kitölti (`currentUserName()`), és a személyeknek `history` tömbjük is van — tehát az ütközési üzenet meg tudja nevezni, **ki** írt közben, új adatmező nélkül.

### Amit NEM csinálunk

- **Nincs automatikus összefésülés.** Ha a fájl közben változott, az újratöltés és a módosítás megismétlése a felhasználó dolga. Rekordszintű merge-hez konfliktusfeloldó felület kellene; erre nincs igény.
- **Nincs zárolás-fájl** (lásd fentebb).
- **Nincs valós idejű figyelés.** A `FileSystemObserver` még nem elérhető mindenhol, `file://`-n pedig nem mértük. Az ellenőrzés mentés előtt fut, nem folyamatosan.
- **Nincs áttérés kiszolgálóra.** Az egyidejűséget egy közös backend végleg megoldaná, de a projekt kliensoldali, telepítést nem igénylő volta szándékos döntés.

### Ellenőrzés

- Node-teszt: két „munkamenet” (két betöltött állapot) ugyanarra a fixture-fájlra; a második mentés **utasítsa el** magát, és a fájl tartalma maradjon az elsőé.
- Node-teszt: egyetlen munkamenet ismételt mentése **menjen át** (a feljegyzett azonosító frissül) — különben minden második mentés elbukna.
- Kézi: két böngészőablak, ugyanaz a mappa, párhuzamos felvétel.

### Megvalósítva (2026-09-29)

`test/employee-repo.test.js` — az „Egyidejű szerkesztés: elveszett mentés” szakasz, 5 teszt a **valódi** `createFileBackend`-en, hamis fájlrendszerrel.

Két dolog került be a tervhez képest, mert a megvalósításkor derült ki:

**1. A lenyomat MINDEN felső szintű tömböt figyel, nem az `employees` kulcsot.** Ugyanezt a háttéret használja a `CaseRepo` (`{cases: []}`) és a `TransferRepo` (`{batches: [], audit: []}`) is. Ha csak az `employees`-t ismerné, a `docgen-cases.json` **némán védelem nélkül maradt volna** — pont olyan csendes hiba, mint amit javítunk. Erre külön teszt van.

**2. A mentési hiba eddig CSAK a naplóba ment.** A `scheduleSave` `catch`-e `BevLogger.error`-t hívott és kész — a felhasználó azt hitte, mentve van. Ütközésnél ez visszahozta volna az elveszett munkát: az adat ugyan nem íródik felül, de a módosítás akkor is elvész. Ezért:

- `onSaveError(fn)` hook mindhárom repóban (az `onChange` mintájára),
- a `registry-view.js` `hookSaveErrors()`-a `StaleWriteError`-nál **párbeszédet** nyit („a módosításod még a képernyőn van, de NEM került a fájlba”), Újratöltés gombbal; más hibánál `toast`-ot,
- `EmployeeRepo.isStaleWriteError(e)` a megkülönböztetéshez, az `isCorruptError` mintájára.

**Ami maradt szándékosan:** nincs automatikus összefésülés, nincs zárolás-fájl, nincs valós idejű figyelés (lásd fentebb).
