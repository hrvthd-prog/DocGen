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
- **A böngésző-tároló (IndexedDB) mentése.** Ott nincs `backup/` mappa. Aki
  fájl-alapú tárolás nélkül használja az appot, annak nincs mentése — ezt a
  README-nek ki kell mondania.
