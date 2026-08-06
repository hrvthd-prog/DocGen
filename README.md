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

## A három fül

| Fül | Mire való |
|---|---|
| **Dokumentumok** | Sablon kiválasztása, személyek kijelölése, generálás |
| **Nyilvántartás** | Személyek felvitele, keresés, xlsx be- és kivitel |
| **Beállítások** | Séma szerkesztése, export profilok, napló |

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
data/docgen-config.json      ← séma és beállítások (személyes adat nélkül)
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

## PDF

A generálás `.docx`-et készít. A PDF-fé alakítás **külön lépés**, mert szerver
nem telepíthető. Hogy melyik út járható ezen a gépen, azt a
[`tools/pdf-proba/`](tools/pdf-proba/OLVASD-EL.md) csomag dönti el —
kattintsd végig, és írd be az eredményt az `EREDMENY.md`-be.

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

Hat tesztcsomag, 140 teszt — séma, azonosító-történet, xlsx oda-vissza,
jelölőfeloldás. Böngészőt nem igényel.

Nincs build-lépés és nincs csomagkezelő: a `js/` fájljai közvetlenül töltődnek
be, a sorrendjük az `index.html`-ben számít. Új modul a saját rétegének végére
kerül (service → séma → modul).

A tervet és az architektúra indoklását a [TERV.md](TERV.md) tartalmazza.
