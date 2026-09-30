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

> **~~Nyitott: kérünk-e PIN-t? Javaslat: hagyjuk ki.~~**
> **2026-09-30: a felhasználó döntése szerint KELL.** Megvalósítva:
> PBKDF2-SHA-256, 100 000 iteráció, fiókonkénti véletlen sóval, a közös
> fiókfájlban (nem localStorage-ban). Amit ad: nem lehet más fiókjával
> dolgozni, tehát a naplóbejegyzés ahhoz tartozik, aki tényleg dolgozott.
> Amit nem: 4-6 jegyű PIN keresési tere kicsi, és a só, a hash és az
> ellenőrző kód is a kliensen van — a titok védelme az NTFS dolga.

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

## 7. Megvalósítva (2026-09-30) — és amit a munka megtanított

**FF1–FF6 kész**, `v10.66`. Az `Auth` 99 tesztje zöld, a teljes készlet (24) is.

### 7.1 Amit a felhasználó a terv ELLENŐRZÉSEKOR döntött el

| Kérdés | Döntés |
|---|---|
| PIN | **kell** — a terv 3.3 „javaslat: hagyjuk ki" pontja megfordult |
| adatmappa nélküli üzem | **próba mód**: elindul, de végig sáv jelzi, és a bélyeg `proba` jelzést kap. Később kódba égetett adatkönyvtár jöhet |
| megtekintő nézete | **egyetlen új, kicsi „Ügyállás" fül** |
| HRBP és dokumentumgenerálás | nem generálhat (a terv szerint) |
| Beállítások fül | Séma+Szótár adminnak, **EH elérhetőség az ügyintézőnek is** → új `settings.ehcontact` művelet |

### 7.2 A terv nem vette észre: a kapu kijátszható volt

Az eredeti terv nem számolt azzal, hogy adatmappa **nélkül** az app böngészőtárból indul — ott nincs fiókfájl, tehát **egy „Mégsem" kattintással bármelyik szint kikerülhető lett volna.** Ez most próba mód: `Auth.setProba(true)`, a felületen végig sáv, és a `can()` mindent engedélyez **kivéve** a fiókkezelést (fiókfájl nélkül az csak a beállítottság látszatát adná).

### 7.3 Amit a kód másképp oldott meg, mint a terv

- **A belépés overlay, nem külön lap.** A BEVapp két HTML-fájlt használ (`index.html` = belépés, `app.html` = app) — mi nem: az appnak egy belépési pontja van, amire a `frissit.vbs`, a README és a `kiadas.js` `?v=` léptetése is épül.
- **A modulok fiókja `init()`-ben dől el, nem a script betöltésekor.** Hat helyen `const currentUser = Settings.currentUser();` állt a modul törzsében, ami a bejelentkezés ELŐTT fut le. Ez volt az igazi ok, amiért a BEVapp két lapot használ. `let` + `init()`-beli értékadás: 10 sor, a 44 használati hely érintetlen.
- **„Mi hiányzik" helyett „Következő lépés".** A terv 3.4 öt mezőt ígért, de a „mi hiányzik" adatnak **nincs forrása a DocGen-ben** (azt a PDF Műhely Áttekintője számolja az iratokból). Nem találtunk ki egyet: a `CaseTypes.triggerLabel` valódi, meglévő jel — a határidő kezdő napja, ha még nincs határidő.
- **Az admin figyelmeztetést kap**, ha egy `megtekinto` fiók nevére egyetlen dolgozó „Közvetlen vezető" mezője sem illeszkedik: az a fiók üres listát látna. Jobb itt kiderülnie, mint a műszakvezetővel felderíttetni.
- **A HRBP-nél a nem írható mező LÁTSZIK**, csak `readonly`+`disabled` és 🔒 jelet kap. A HRBP-nek olvasnia kell — az elrejtés rossz irány lenne.

### 7.4 Ami a 2. fázisra maradt

- **Az NTFS-mátrix (4. fejezet) átadása az IT-nak.** Ezt kód nem tudja elvégezni.
- **Az `allapot-kivonat.json`** (3.4): amíg nincs, az Ügyállás fül felületi szűkítés, nem adatvédelem — a `megtekinto` ugyanabból a fájlból olvas.
- **Kézi végigpróbálás mind a négy szinttel** éles gépen: a Node-tesztek a felületet és a File System Access API-t nem fedik.

## 8. A szintek ADATTÁ tétele (2026-09-30, a felhasználó kritikájából)

> *„A jogosultság adás/vételre nem lehet kitalálni valamilyen központi admin felületet, beállítást? Hardcode-olni ilyen jellegű dolgot soha nem tanácsos."*

**A kritika megalapozott volt, és a projekt saját elvét sértettem meg.** A `case-types.js` fejkommentje szó szerint ezt mondja: *„Ügytípusok – adatként, nem kódban. Ugyanaz az elv, mint a mezősémánál… Ha egy eljárás megváltozik, típust szerkesztünk, nem kódot írunk."* A séma, az ügytípusok, az export profilok és a szótár mind **seed a kódban → élő definíció a `docgen-config.json`-ban → szerkesztés a felületről**. A jogosultsági mátrixot viszont beégettem az `auth-service.js`-be.

### 8.1 Amit átalakítottunk

**Új: `js/schema/roles.js`** — ugyanabban a rétegben, mint a `case-types.js`:

```
SEED_ROLES (kód, kezdőállapot)
   → docgen-config.json  "roles" kulcs (élő)
   → Beállítások → „Szintek és jogosultságok" rács (szint × művelet)
```

A szint innentől adat: `{ key, label, hint, can: [...], builtin }`. Az `Auth.can()` már csak `Roles.can(currentRole(), action)`-t hív; az `Auth`-ból kikerült a mátrix és a fix szintlista.

**Teljes szintkezelés** (a felhasználó döntése): új szint felvétele, átnevezés, törlés, és a beépítetteknél „Alapra" (visszaállítás a kiadás szerinti jogokra).

### 8.2 A határ: mi NEM lehet adat

**A műveletek listája (`ROLE_ACTIONS`) kódban van.** Minden művelet egy ellenőrzési pont, amit a kód hív (`Auth.can('registry.write')`); egy felületről kitalált új műveletnek **nincs hívási helye**, tehát nem tenne semmit — csak azt a látszatot adná, hogy beállítottunk valamit.

Pontosan úgy, mint a sémánál: a **mezőlista** adat, de egy új mező**típus** kódot igényel. Amit a művelethez adatként adunk, az a **címke és a magyarázat**, hogy a rács olvasható legyen.

### 8.3 Amit a szerkeszthetőség behozott — és a védelem ellene

Egy szerkeszthető mátrixszal az admin **kizárhatja magát**: ha senkinek nincs `accounts.manage` joga, a fiókokhoz és a szintekhez többé senki nem ér hozzá, csak a JSON kézi szerkesztésével. Négy védőkorlát:

1. **a saját szintjéből** nem vehető el a kulcsjog,
2. az **utolsó birtokostól** sem,
3. **használatban lévő szint** nem törölhető (előbb át kell rendelni a fiókokat), és a saját szint sem,
4. hiányzó vagy sérült `roles` config esetén a **seed** a tartalék — **nem** „nincs korlátozás". A hiba iránya inkább zárjon, mint nyisson.

Az `adminCount()` innentől **nem az „admin" nevű szintet** számolja, hanem azt, kinek **van** `accounts.manage` joga — akármi is a szint neve.

### 8.4 Frissítés: mit kap egy új művelet

A felhasználó döntése: **a beépített szintek a seed szerint, a saját szintek nem kapják meg automatikusan.** Ugyanaz az elv, mint a séma `addMissingSeedFields()`-énél.

Ehhez a config tárolja a **`knownActions`** listát: mit ismert mentéskor. Enélkül nem lehetne megkülönböztetni az „új műveletet" a **„tudatosan elvett jogtól"** — és egy frissítés visszaadná, amit az admin szándékosan elvett. Erre külön teszt van.

### 8.5 Tartós napló a jogosultság adásáról és vételéről

A felhasználó döntése: **fájlba, visszakereshetően.** Minden szint- és fiókváltozás sort kap a fiókfájl `audit` tömbjében (mikor, ki, mit, miről mire), és a Beállításokban látszik. A `BevLogger` csak memóriában él — egy jogosultság-változásnál az kevés.

> **Ez nem kriptográfiai bizonyíték:** aki a fájlhoz hozzáfér, átírhatja. Jóhiszemű használat melletti visszakövetésre szolgál, ahogy a `TransferRepo` naplója az átutalásoknál.

### 8.6 Két hibát a tesztek fogtak el

- **A napló `action` mezőjét felülírta a művelet kulcsa.** A `_log('JOG_ADAS', { role, action })` payloadjában az `action` ütközött az esemény típusával, így a naplóból **eltűnt volna, hogy adás vagy vétel történt**. A payload kulcsa `muvelet` lett.
- **A betöltési sorrend minden fiókot lefokozott volna.** Az `Auth.migrate()` a szinteket kérdezi (`isKnownRole`); ha a `Roles` még nincs betöltve, **minden fiók a legszűkebb szintre esik**, és a következő mentés ezt ki is írja. A `Roles` most a fiókok **előtt** töltődik, a napló pedig pufferel, hogy a sorrend egy naplósort se dönthessen el. Mindkettőre regressziós teszt van.
