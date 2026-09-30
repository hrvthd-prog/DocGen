# Felhasználói fiókok és négy jogosultsági szint — terv

*2026-09-30. A `TERV.md` 7.2 („Felhasználók") feloldása. Kiindulás: a felhasználó
a [BEVapp-web](https://github.com/hrvthd-prog/BEVapp-web) hasonló megoldására
mutatott — az alábbi 1. fejezet megmondja, mi vehető át onnan és mi nem.*

## 0. Miért nem volt ez eddig a tervben

A `TERV.md` szándékosan hagyta ki: *„Egyfelhasználós indulás, bejelentkező képernyő
nélkül"* (7.2), és a `js/login.js` / `css/login.css` kifejezetten a **kihagyott**
BEVapp-fájlok listáján szerepel (69. sor). A `Settings.isAdmin()` bedrótozott neve
pedig **hibaként** volt megnevezve (249–255): ezért ma `isAdmin() { return true; }`.

A 7.2 másik fele — az egyidejű szerkesztés — **elkészült** (`TERV-adatbiztonsag.md`
7., frissesség-ellenőrzés a zárolás-fájl helyett). A fiókok nem. Ez a terv arról szól.

## 1. Mi vehető át a BEVapp-ból — és mi nem

**Amit találtam:** a BEVapp fiókmegoldása **fiókválasztó, nem hitelesítés.**
`localStorage.beva_users` névlista → kattintás → `sessionStorage.beva_current_user`
→ `app.html`. Nincs jelszó. Szintből **kettő** van, nem négy:
`isAdmin() { return currentUser() === 'Horváth Dániel'; }`. Amit az admin-szint ad:
a hiányzó-adatok napló összes fiókra, naplótörlés, DevModule (Konami-kód).
Adatvédelmi korlát nincs. Az `app.js:5` az egyetlen „auth": ha nincs `current_user`,
átirányít — ez átirányítás, nem védelem.

| Átvesszük | Miért |
|---|---|
| a belépőképernyő UI-ja (`index.html` + `css/login.css`, 400 sor) | vizuálisan kész, a DocGen tokenjeivel összeillik |
| `sessionStorage` + átirányítás minta | munkamenetre él, böngészőzáráskor elfelejti — a fiók nem ragad be |
| átnevezés-migrációs minta (`EN_DASH_MIGRATIONS`) | fiók átnevezésekor a per-fiók kulcsok ne szakadjanak el |

| NEM vesszük át | Miért |
|---|---|
| bedrótozott `isAdmin()` név | a `TERV.md` 249–255 már elutasította, és nem skálázódik négy szintre |
| `DEFAULT_USERS` valódi nevekkel | személyes adat a repóban; a felhasználó is jelezte, hogy a nevekre nincs szükség |
| **korlátlan fiókkezelés a belépőképernyőn** | a BEVapp-ban bárki hozzáadhat/átnevezhet/törölhet fiókot. Egy megtekintő egy kattintással admin fiókot csinál magának — ezzel **bármelyik szint üres marad** |
| fióklista `localStorage`-ban | **böngészőprofilonként külön**: megosztott mappán minden gépen más a lista és más a szint. Egy szint, ami gépenként különbözik, nem szint |

## 2. A lényeg: mit véd ez, és mit nem

`file://` protokollon és megosztott mappán **nincs mire építeni a kikényszerítést.**
Nincs kiszolgáló; a `sessionStorage` a felhasználó gépén van, DevTools-ból egy sor;
a `docgen-employees.json` pedig ott van a mappában, és aki olvasási joggal eléri,
**Jegyzettömbbel megnyitja.**

Ezért a felhasználó döntése szerint **két fázis, szétválasztva**:

- **1. fázis — alkalmazás-szintű munkafolyamat-korlát.** Ki mit lát és mit tud
  elrontani. Véletlen ellen véd, a felületet rendezi. **Nem** véd szándékos
  hozzáférés ellen — ezt a README-nek ki kell mondania, különben a „csak
  megtekintő" név védelmet sugall, ami nincs.
- **2. fázis — NTFS-terv, amit az IT állít be.** Ez a valódi határ. Kód nincs
  hozzá, csak egy írott mátrix: melyik szint melyik mappához kap olvasást/írást.

**A megtekintő szintnél ez élesen jelentkezik.** A nyilvántartás útlevélszámot,
TAJ-t, adóazonosítót és anyja nevét tárol. Ha a sorvezető ugyanabból a fájlból
olvas, **mindent lát**, akármit rejtünk el a felületen. Adatminimalizálás csak úgy
lesz belőle, ha **nem ugyanazt a fájlt olvassa** (3.4).

## 3. A négy szint

| | `admin` | `ugyintezo` | `hrbp` | `megtekinto` |
|---|---|---|---|---|
| Nyilvántartás: olvasás | teljes | teljes | teljes | **szűkített (3.4)** |
| Nyilvántartás: írás | teljes | teljes | **csak `hr_belso`** | ✖ |
| Dokumentumgenerálás | ✔ | ✔ | ✖ | ✖ |
| Ügyek: olvasás | ✔ | ✔ | ✔ | **csak a sajátjai** |
| Ügyek: írás, esemény | ✔ | ✔ | ✖ | ✖ |
| Átutalások | ✔ | ✔ | ✖ | ✖ |
| Séma, export profilok, ügytípusok | ✔ | ✖ | ✖ | ✖ |
| Fiókok és szintek kezelése | ✔ | ✖ | ✖ | ✖ |
| Hiányzó-adatok napló | összes fiók | csak saját | csak saját | ✖ |

### 3.1 A HRBP írási köre már adat, nem új kód

A sémában **létezik** egy `hr_belso` csoport, címkéje szó szerint **„Csak HR tölti"**:
`hr_bank_account`, `hr_bank_name`, `hr_department_cost_center`, `hr_direct_leader`,
`hr_sg_category`. A mezők `hint`-je is `FILLED BY HR — please leave empty`.

A HRBP írási köre tehát **= ez a csoport**, és a szabályozás **csoportszinten** megy,
nem mezőnként. Új jelölő a sémába nem kell — ha később bővül a kör, egy mezőt át kell
tenni ebbe a csoportba, és kód nem változik. (A `foglalkoztatas` csoport
szándékosan kimarad: bér és FEOR az ügyintézőé, az az idegenrendészeti kérelem
tartalma.)

### 3.2 Hol élnek a fiókok

**Új fájl: `data/docgen-accounts.json`**, a közös adatmappában:

```json
{ "version": 1,
  "accounts": [
    { "id": "...", "name": "…", "role": "admin",
      "createdAt": "…", "createdBy": "…" }
  ] }
```

**Miért külön fájl, és nem a `docgen-config.json`:** a README szerint a config
*„nem tartalmaz személyes adatot, így gépek közt szabadon vihető"* — a fióknevek
viszont személyes adatok. Ez a tulajdonság megmarad, ha külön fájlba kerülnek.
A `data/` mappát a `.gitignore` egészében kizárja, tehát éles fiók nem kerül a repóba.

**Miért nem `localStorage`:** lásd 1. fejezet — gépenként más lista, tehát nincs szint.

A `sessionStorage` csak azt tartja, **melyik fiókkal** léptünk be most; a fiók és a
szintje a közös fájlból jön.

### 3.3 Azonosítás

**1. fázisban névválasztás, jelszó nélkül** — ez következetes azzal, hogy a szint
munkafolyamat-korlát, nem védelem. A belépőképernyőn viszont a BEVapp-pal
ellentétben **fiókot létrehozni, átnevezni, törölni NEM lehet**: azt csak belépett
admin teheti a Beállításokban. Enélkül minden szint üres.

> **Nyitott, döntést kér:** kérünk-e fiókonkénti PIN-t (localStorage-ban hash-elve)?
> Megállítja a véletlen és a laikus fiókcserét, de **nem** biztonsági határ: a hash
> és az ellenőrző kód is a kliensen van. Ha a 2. fázis NTFS-e megvan, a PIN-nek
> nincs sok haszna. **Javaslat: hagyjuk ki**, és ne sugalljunk védelmet.

### 3.4 A megtekintő: csak a saját dolgozói, státuszszinten

A szűréshez **létezik a mező**: `hr_direct_leader` („Közvetlen vezető"). A megtekintő
a fiókja nevéhez illeszkedő dolgozókat látja — ékezet- és kisbetű-függetlenül,
a `matchWorkerDir`-nél már bevált `foldName` mintájával.

Amit lát, mezőszinten:

```
név · ügy típusa · ügy állása · határidő · mi hiányzik még
```

Útlevélszám, TAJ, adóazonosító, anyja neve, bér, bankszámla **nem**.

**1. fázisban** ez a szűkített nézet ugyanabból a fájlból olvas — tehát
**kényelmi és rendezettségi** megoldás, nem adatvédelmi. **2. fázisban** a valódi
adatminimalizálás: az admin/HRBP kiír egy `allapot-kivonat.json`-t egy külön
mappába, amiben **csak a fenti öt adat** van, és a megtekintő NTFS-szinten is csak
oda kap olvasást. Enélkül a fájlhoz hozzáférve mindent lát.

## 4. NTFS-terv a 2. fázishoz (kód nincs, az IT állítja be)

| Szint | `data\` (nyilvántartás) | `Sablonok\` | munkamappa (dolgozói mappák) | `allapot\` |
|---|---|---|---|---|
| admin | írás | írás | írás | írás |
| ügyintéző | írás | olvasás | írás | írás |
| HRBP | írás¹ | olvasás | olvasás | olvasás |
| megtekintő | **nincs** | nincs | nincs | **olvasás** |

¹ A HRBP mezőszintű korlátja NTFS-sel nem kikényszeríthető — a fájl egész.
Ez a korlát az 1. fázis felületi szabálya marad; az NTFS annyit ad, hogy a HRBP
egyáltalán írhat-e a fájlba. Ha a mezőszintű korlátnak valódi határ kell, az már
kiszolgálót igényel.

**Amit ez a táblázat kimond, és amit vállalni kell:** a megtekintő így **nem tudja
használni a DocGen-t a nyilvántartáson** — csak az állapot-kivonatot olvassa. Ez a
szint tehát nem „szűkített DocGen", hanem egy külön, kicsi nézet.

## 5. Fázisok és ellenőrzés

```
FF1  Fiókmodell: docgen-accounts.json, AccountsRepo (a createFileBackend-en),
     4 szint, Settings.currentUser()/currentRole(), can(művelet) kapu
     → Node-teszt: a can() mátrix mind a 4 szintre; a fiókfájl kör
FF2  Belépőképernyő: index.html + login.css a BEVapp-ból, fióklista a KÖZÖS
     fájlból; létrehozás/átnevezés/törlés NINCS itt
     → kézi: belépés, kilépés, ismeretlen fiók
FF3  Kapuzás a felületen: fülök és gombok a can() szerint; a HRBP-nél a
     hr_belso csoporton kívüli mezők csak olvashatók
     → Node-teszt: mezőcsoport-kapu; kézi végigkattintás mind a 4 szinttel
FF4  Fiókkezelés a Beállításokban (csak admin): felvétel, szint, átnevezés
     (a per-fiók kulcsok migrálásával), törlés
     → Node-teszt: az utolsó admin nem törölhető / nem fokozható le
FF5  Megtekintő nézet: hr_direct_leader szűrés + az öt mező
     → Node-teszt: a szűrés ékezet-függetlenül; más vezető dolgozója nem látszik
FF6  README: mit véd és mit NEM; az NTFS-mátrix átadása az IT-nak
```

**Ami nem lesz kikényszerítve, és ezt ki kell mondani:** minden FF1–FF5 felületi
korlát. A kikényszerítés a 4. fejezet NTFS-e, illetve hosszabb távon kiszolgáló.

## 6. Amit szándékosan nem építünk

- **Nincs jelszó/PIN** (3.3) — látszatvédelmet nem adunk.
- **Nincs mezőszintű szabályozás mezőnként** — csoportszinten megy, a séma
  `hr_belso` csoportjával (3.1).
- **Nincs új „közvetlen vezető" mező** — a `hr_direct_leader` már megvan (3.4).
- **Nincs fiókkezelés a belépőképernyőn** — ez a BEVapp legsúlyosabb szerkezeti
  hibája (1.).
- **Nincs szerepkör-hierarchia öröklés** (`admin ⊃ ügyintéző ⊃ …`): a négy szint
  külön mátrixsor, mert a HRBP nem „kevesebb ügyintéző", hanem **más** — többet
  olvas, kevesebbet ír.
