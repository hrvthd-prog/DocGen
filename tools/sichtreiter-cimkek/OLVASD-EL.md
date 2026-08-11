# Elba Sichtreiter papírcetlik — 58 × 18 mm

`Sichtreiter-cimkek-58x18mm.xlsx` — beillesztesz 83 nevet, kinyomtatod, kivágod.

> **A neveket ne a repóban lévő példányba illeszd be.** Mentsd el máshová
> (pl. az asztalra) munkamásolatként, és abba írj. A repó `.gitignore`-ja
> adatvédelmi okból minden `*.xlsx`-et kizár; ez az egy **üres** sablon
> névre szóló kivétel, tehát ide bemásolt nevek verziókezelésbe kerülhetnek.

## Használat

1. Mentsd el a fájlt munkamásolatként, nyisd meg, **`Nevek`** lap: illeszd be a
   névlistát a sárga sávba
   (`A2:A84`, 83 sor, egy név egy sorban). A `D` oszlopban látod, hány név van
   kitöltve.
2. Menj a **`Címkék`** lapra — a nevek automatikusan megjelennek a rácsban,
   balról jobbra, fentről le.
3. Nyomtatás (Ctrl+P): **A4, álló, méretezés 100%** („Tényleges méret").
   **Semmilyen „laphoz igazítás" ne legyen bekapcsolva** — az elrontja a
   mm-pontos méretet.
4. Vágás: a szaggatott szürke keretek között 2 mm rés van, a rés közepén vágj.
5. **Ellenőrzés az első lap után:** mérd meg vonalzóval egy keret szélességét.
   58 mm-nek kell lennie. Ha nem az, a nyomtatási méretezés nem 100%.

## Kiosztás

| | |
|---|---|
| Címke | 58 × 18 mm, szaggatott szürke keret, név középen (Arial 12) |
| Rés | 2 mm vízszintesen és függőlegesen |
| Laponként | 3 oszlop × 13 sor = 39 címke |
| Összesen | 28 sor × 3 = **84 hely** (83 névhez + 1 tartalék), 3 A4-es lap |
| Margó | oldalt 10 mm + vízszintes középre igazítás, fent/lent 13 mm |

A 14. sor is kijönne matematikailag laponként (14 × 18 + 13 × 2 = 278 mm), de
akkor a felső/alsó margó 9,5 mm-re szűkül, és egyes tintasugarasok alsó
nem-nyomtatható sávja levágná. Ezért 13 sor / lap.

## Miért van `--target`, és mi a méretpontosság buktatója

Az `.xlsx` formátum az oszlopszélességet **nem mm-ben** tárolja, hanem a
munkafüzet alap- („Normal") betűtípusának *maximum digit width* (MDW)
egységében. Az átszámítás **alkalmazásfüggő** — LibreOffice-szal kimérve:

| | képlet | Calibri 11 MDW | 58 mm = |
|---|---|---|---|
| Excel | `képpont = char × MDW_egész + 5` | 7 (egész) | 30,60 char |
| LibreOffice Calc | `képpont = char × MDW_valós` | 7,392 | 29,66 char |

A `+ 5` képpontos tapadás miatt a kettő **egyszerre nem hozható pontosra**, ezért
a cél explicit:

```bash
python3 generate.py                       # Excel-pontos (ez a szállított fájl)
python3 generate.py --target libreoffice  # LibreOffice Calc-pontos
```

Az alapértelmezés az Excel, mert ez a dokumentált eset, és a közismert
„8,43 char = 64 képpont" alapértékkel hitelesíthető (8,43 × 7 + 5 = 64,01).
A szállított fájl LibreOffice-ban ~59,9 mm-re jön ki (+3,3%) — ott a
`--target libreoffice` változat kell.

A **sormagasság** pontban megy (18 mm = 51,02 pt), ott nincs ilyen áttétel és
nincs alkalmazásfüggés.

## Ellenőrzés

A `--target libreoffice` változatot PDF-be renderelve lemértük: címke
**58,06 mm × 17,98 mm**, vízszintes rés **1,99 mm** (cél 58 / 18 / 2). Ez
igazolja a fenti modellt, és ezen keresztül a szállított Excel-változat
számítását is.

A `2 mm` rés-sorokat a LibreOffice egész képpontra kvantálja
(5,67 pt = 7,56 képpont → 7 képpont = 1,85 mm). Kézi vágásnál ez a 0,15 mm
lényegtelen, de **ezért nem szabad a szállított fájlt LibreOffice-szal
újramenteni** — az beírja a lekvantált 5,25 pt-ot. (Az oszlopszélességeket az
újramentés megtartja, csak a sormagasságot rontja.)
