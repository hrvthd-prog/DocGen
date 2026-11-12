# Hozzáférés új gépen, IT-audit és szerverre költözés — terv

*2026-11-12. Állapot: **terv, döntésre vár** (a 6. fejezet kérdései). Kód még nincs.*

## 0. Röviden

A mostani nehézség (új gépen az adatmappa beállítása) **nem egy hibás gomb, hanem
a `file://` + File System Access architektúra ára.** A szerverre költözés ezt
**teljesen megszünteti**: ott nincs mappaválasztó, nincs engedélykérés, és nincs
gépenként tárolt mappa. Ezért:

1. **Rövid táv (most, ~1 nap):** csak a legolcsóbb, legnagyobb hatású javítás a
   `file://` változaton (2. fejezet, R1). Nagy átépítést ide nem teszünk, mert a
   szerver kidobja.
2. **IT-bemutató és audit:** a mostani változatot **a szerverterv mellé tesszük**,
   és az auditot a célállapotra kérjük (4. fejezet). Egy `file://`-os app
   auditja olyan hiányokat találna, amiket a szerver úgyis megold.
3. **Szerver (középtáv):** vékony API a mai adattárolók helyére, céges SSO,
   szerveroldali jogosultság és napló (3. fejezet). A felület és az üzleti logika
   nagy része marad.

## 1. Miért nehéz ma új gépen — a mért lánc

Egy olyan gépen/böngészőprofilban, ahol a DocGen még nem futott:

| # | Lépés | Miért kell |
|---|---|---|
| 1 | Belépőképernyő: „Nincs beállított adatmappa” → **Folytatás próba módban** | a kapuban nincs mappaválasztó gomb, csak útmutatás (`login.js` `renderNoFolder`) |
| 2 | Nyilvántartás → **Adatmappa kiválasztása** → a `DocGen-main\data` megkeresése a Z:-n | a mappa-handle böngészőprofilonként, IndexedDB-ben él (`saveMachineHandle`) |
| 3 | **Oldal újratöltése** → „Hozzáférés megadása” → belépés | a fiókok csak az adatmappa betöltése után léteznek |
| 4 | Dokumentumok → **Sablonmappa** kiválasztása | külön handle, külön engedély |
| 5 | Dokumentumok → **Kimeneti mappa** (`09_OIF_kerelmek`) | külön handle, külön engedély |
| 6 | PDF-készítő szkript (`docx-pdf.vbs`) + `docgenpdf://` protokoll regisztrálása | Windows-oldali segédlet, gépenként (`telepit-protokoll.vbs`) |
| 7 | **Minden további indításkor** 1–3 engedélykattintás | `file://`-nak nincs telepíthető origin-je, a Chrome nem ad tartós engedélyt |

Ráadásul a Windows mappaválasztója nem tud útvonalat előre kitölteni, tehát a
felhasználónak tudnia kell, **melyik** mappát keresse — ezt ma szóban adjuk át.

A gyökér a böngésző biztonsági modellje: weboldal csak felhasználói kattintásra,
mappánként kapott engedéllyel írhat a lemezre. Ezt kódból megkerülni nem lehet,
csak a lépések számát csökkenteni.

## 2. Rövid táv: a `file://` változat (a szerverig)

| | Mit | Nyereség | Ráfordítás | Javaslat |
|---|---|---|---|---|
| **R1** | **Mappaválasztó a belépőképernyőn.** A „Nincs beállított adatmappa” kártyán „Adatmappa kiválasztása” gomb (a meglévő `pickDataDir` hívása), utána közvetlenül a fiókválasztás jön. A kártya kiírja a várt útvonalat (`location.href`-ből: `…\DocGen-main\data`). | az 1–3. lépés egy kattintás + egy mappaválasztás; nincs próba mód, nincs újratöltés | ~30 sor, `login.js` + `registry-view.js` | **igen, most** |
| R2 | **Egy közös gyökérmappa.** Egyetlen handle a közös szülőre; az adat-, sablon- és kimeneti mappa ennek almappája, relatív útvonalként a `docgen-config.json`-ban (az a közös adatmappában van, tehát új gépen már tudott). | indulásonként 1 engedély 3 helyett; új gépen 1 választás | ~150 sor, `fs-service`, `docgen.js`, `registry-view.js`; csak akkor működik, ha a három mappának **van közös szülője** a Z:-n | csak ha a szerver **3 hónapnál** messzebb van |
| R3 | `localhost` + telepített webapp (tartós engedély) | 0 engedélykérés | háttérfolyamat minden gépen | **nem** — a szerver ezt is kiváltja |
| R4 | „Új gép” ellenőrzőlista a README-ben (mit válassz, hol, sorrendben) | átadható, nem szóbeli | dokumentáció | **igen, az R1-gyel együtt** |

## 3. Célállapot: szerveren futó DocGen

### 3.1 Mi változik és mi nem

```
MA:     böngésző (file://) ──FSA-engedély──> Z:\…\data\*.json, Sablonok\, 09_OIF_kerelmek\
CÉL:    böngésző (https://docgen.<ceg>.local) ──HTTPS + SSO──> DocGen-szerver ──> adatbázis
                                                                     └──szolgáltatásfiók──> 09_OIF_kerelmek\ (a Műhelynek)
```

| Réteg | Ma | Szerveren |
|---|---|---|
| Felület (`index.html`, `js/modules`, `css`) | marad | **marad** |
| Üzleti logika (`js/services/*`: ügyek, hosszabbítás, séma, docx-render) | kliens | **marad a kliensen** (első körben) |
| Adattárolás (`createFileBackend`, `docgen-*.json`) | JSON a megosztott mappán | **API-háttér**: harmadik háttérfajta a meglévő fájl és böngészőtár mellé — a repók egyetlen ponton cserélnek |
| Egyidejű szerkesztés | frissesség-ellenőrzés (`TERV-adatbiztonsag` 7.) | verziószám alapú ütközésjelzés a szerveren — megbízható, mert egy helyen dől el |
| Azonosítás | név + PIN, kliensoldali PBKDF2 | **céges SSO** (Windows-integrált hitelesítés vagy Entra ID); a PIN megszűnik |
| Jogosultság | felületi korlát, „nem véd” (`TERV-fiokok` 2.) | **szerveroldali kikényszerítés**: a megtekintő a szervertől csak a kivonat-mezőket kapja — az NTFS-mátrix (`TERV-fiokok` 4.) feleslegessé válik |
| Napló | kliensoldali, a JSON-ban | szerveroldali, csak hozzáfűzéses audit-napló (ki, mikor, mit olvasott/írt) |
| Sablonok | mappaválasztó | a szerveren, admin tölti fel a felületen |
| Kimenet (`09_OIF_kerelmek`) | a kliens írja | a szerver írja szolgáltatásfiókkal — **a Műhely és a mappaszerkezet változatlan** |
| PDF-konverzió | Word a kliensen (`docx-pdf.vbs`, `docgenpdf://`) | **nyitott kérdés** (6. K5) |
| Frissítés | ZIP + `frissit.vbs` gépenként | egyszer, a szerveren |
| Új gép beállítása | 1. fejezet, 7 lépés | **egy URL** |

### 3.2 Technikai javaslat (az IT-val egyeztetendő)

- **Node.js** szolgáltatás: a projekt nyelve JS, a tesztek már Node alatt futnak, a
  `js/services` modulok egy része a szerveren is betölthető. Függőség minimális.
- **Tárolás:** SQLite (egyetlen fájl, egyszerű mentés) vagy az IT által adott
  SQL Server / PostgreSQL. Első körben gyűjteményenként egy JSON-dokumentum
  verziószámmal — így a mai repók szerkezete változatlan; a táblákra bontás később.
- **Futtatás:** IIS reverse proxy vagy Windows-szolgáltatás (ha Windows-szerver),
  illetve konténer (ha Linux). HTTPS a céges tanúsítvánnyal.
- **Biztonsági fejlécek:** Content-Security-Policy (ma nincs), HSTS, `X-Content-Type-Options`.

### 3.3 Fázisok

```
S0  Döntések az IT-val (6. fejezet)                        → írott válaszok, szerver-hozzáférés
S1  API-háttér + szerver, SSO nélkül, tesztadattal         → node test/run-all.js + böngészős végigkattintás tesztszerveren
S2  SSO, a fiókok UPN-hez kötve                            → belépés céges fiókkal, PIN nélkül
S3  Szerveroldali jogosultság + audit-napló                → megtekintővel lekérve a teljes dolgozó: 403; minden írás naplózva
S4  Sablonok és kimenet a szerveren; PDF-konverzió (K5)   → generált irat a 09_OIF_kerelmek-ben, a Műhely „E”-t lát
S5  Adatátvétel (a mai docgen-*.json importja), párhuzamos futás 1–2 hétig → darabszám- és mintaegyezés
S6  A file:// változat kivezetése, a régi JSON-ok archiválása
```

## 4. IT-bemutató és audit — mit kell előkészíteni

Az IT jellemzően ezt kéri; a bal oszlop a mai állapot, a jobb, ami még hiányzik.

| Dokumentum | Megvan | Hiányzik |
|---|---|---|
| Architektúra-leírás | `README.md`, `plans/TERV*.md` (szétszórtan) | egy 2–3 oldalas összefoglaló + ábra a mai és a célállapotról |
| **Adatleltár** (mely személyes adatok, honnan, kinek, mennyi ideig) | a séma (`seed-schema.js`) mezői | táblázat: mező → kategória (útlevél, TAJ, adóazonosító, anyja neve, bér, bankszámla) → jogalap → megőrzési idő → ki látja |
| **Adatvédelmi hatásvizsgálat (DPIA)** bemenete | — | az adatvédelmi tisztviselővel; az idegenrendészeti adatok miatt valószínűleg kötelező |
| Jogosultsági mátrix | `TERV-fiokok.md` 3., `roles.js` | a célállapot szerinti változat (szerveroldali) |
| Fenyegetésmodell | `TERV-fiokok.md` 2. (őszintén leírja, mit nem véd) | STRIDE-táblázat a célállapotra |
| **Függőségek (SBOM)** verzióval, licenccel, ismert sérülékenységgel | `vendor/` | lista + frissítés (lásd lent) |
| Biztonsági kódátvizsgálás | `escHtml` következetes használata | teljes átnézés: 76 `innerHTML`-hely, CSP hiánya, xlsx-import |
| Tesztelés | 8 Node-tesztkészlet, böngészős e2e | összefoglaló a lefedettségről |
| Mentés, visszaállítás | `backup\` (20 db/fájl), `TERV-adatbiztonsag.md` 2. | a szerveren: IT-mentés + visszaállítási próba |
| Naplózás | kliensoldali napló | szerveroldali audit-napló (S3) |
| Üzemeltetési leírás | `CLAUDE.md` „Hol fut?” | telepítés, frissítés, felelős, incidens esetén teendők |

**Az audit előtt mindenképp javítandó (független a szervertől):**

- **`vendor/xlsx.full.min.js` = SheetJS 0.18.5** — két ismert sérülékenység:
  CVE-2023-30533 (prototype pollution kártékony fájl olvasásakor, javítva 0.19.3-ban)
  és CVE-2024-22363 (ReDoS, javítva 0.20.2-ben). A DocGen a dolgozóktól kapott
  adatbekérő xlsx-et olvas be, tehát a kitettség valós. Frissítés: a SheetJS saját
  CDN-jéről (az npm-en maradt 0.18.5 nem kap javítást). A többi vendor-könyvtárat
  ugyanígy verzióra és CVE-re kell nézni.
- Content-Security-Policy `<meta>` a `file://` változatba is betehető.
- Egy belső biztonsági átvizsgálás (pl. a `security-audit` folyamat) **a bemutató
  előtt**, hogy a talált hibák ne az IT-nál derüljenek ki.

**A bemutató üzenete:** a mai változat egy kis csapat eszköze, amelynek a
korlátait a tervek őszintén rögzítik (a jogosultság ma munkafolyamat-korlát, nem
védelem). A szerverváltozat pontosan ezeket zárja le. Így az IT nem egy kész
rendszert minősít le, hanem egy célállapotot hagy jóvá — és beleszólhat a
technikai döntésekbe (S0), mielőtt kód készül.

## 5. Amit ez a terv szándékosan NEM tartalmaz

- **Nagy `file://`-os átépítést** (R2, R3) — a szerver kiváltja.
- **Az üzleti logika szerverre költöztetését** első körben — elég, ha az adat és
  a jogosultság a szerveren van; a többi a kliensen maradhat.
- **A PDF Műhely szerverre vitelét** — asztali eszköz, a megosztott mappán
  dolgozik; a szerver a mai mappaszerkezetet írja, tehát a Műhelyhez nem kell nyúlni.

## 6. Nyitott kérdések

**Neked (döntés):**

- **K1.** Az R1 (mappaválasztó a belépőképernyőn + README-lista) most mehet?
- **K2.** Mikorra várható a szerver? 3 hónapon túl megéri az R2 (egy gyökérmappa) is.
  Ehhez: a `08_DocGen`, a `Sablonok` és a `09_OIF_kerelmek` **közös szülőmappában**
  vannak a Z:-n? (Mi a három teljes útvonal?)
- **K3.** Hányan használják most, és hányan fogják a szerveren (a vezetők a
  hosszabbítási döntések miatt)?

**Az IT-nak (S0):**

- **K4.** Milyen szerver: Windows (IIS) vagy Linux? Van-e jóváhagyott futtatókörnyezet
  (Node.js), adatbázis (SQL Server / PostgreSQL), vagy SQLite is elfogadható?
- **K5.** PDF-konverzió: a mai Word-alapú konverzió a szerveren nem javasolt (a
  Microsoft nem támogatja a szerveroldali Office-automatizálást). Lehetőségek:
  (a) LibreOffice a szerveren — a sablonok kinézetét végig kell próbálni;
  (b) marad a kliensen a Word, a szerver csak a .docx-et adja. **Javaslat: (b)
  első körben**, mert a sablonok Wordre vannak hangolva.
- **K6.** SSO: Windows-integrált hitelesítés (Kerberos) vagy Entra ID? A szerepköröket
  AD-csoportok adják, vagy az app saját fióklistája (UPN-hez kötve)?
- **K7.** Kaphat-e a szolgáltatás írási jogot a `09_OIF_kerelmek` megosztásra
  (szolgáltatásfiók), és ki a felelős a mentésért?
- **K8.** Kell-e DPIA, és ki az adatvédelmi kapcsolattartó?
