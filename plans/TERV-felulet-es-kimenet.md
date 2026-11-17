# Felület és kimenet — fejlesztési terv

*2026-11-14. Állapot: **jóváhagyva 2026-11-17** — A0, A1, A2, A4 kész (`v10.114`),
A3, A5, A6 hátravan. A döntések a 7. fejezet végén.
A szerverre költözés külön terv: `TERV-belso-szerver.md`.*

Ez a terv azt tartalmazza, ami **a szervertől függetlenül**, a mai `file://`
változaton is megépíthető és azonnal hasznos: bolondbiztos felület külön
legfőbb adminnal (1.), alapértelmezett DOCX-kimenet (2.), a mentés
megbízhatósága a felhasználó szemével (3.), és néhány további javaslat (4.).
Minden itt leírt munka a `main`-re megy, és a szerverre változtatás nélkül
átvihető — a szerver az adattárolást cseréli, a felületet nem.

## 0. Röviden

| | Megállapítás | Teendő |
|---|---|---|
| **Felület** | Minden szint ugyanazt a sűrű, szakértői felületet kapja; a szintek ma csak azt döntik el, *mit szabad*, azt nem, *mennyit lát*. | **Egyszerű mód** mindenkinek, **Szakértő mód** csak a legfőbb adminnak (1.). |
| **Kimenet** | A fő gomb ma **„DOCX + PDF”**, a mellékgomb a „Csak DOCX” — a Dokumentumok fülön és a tömeges ügynél is. Fordítva kell. | Egy fő gomb: Word-irat. A PDF-készítés a Szakértő módba kerül, kézi lépésként. A PDF-sablon irata marad PDF (2.). |
| **Mentés** | A „valaki más közben írt” figyelmeztetés egyedül dolgozva is megjelent: a program a saját előző mentését nézte idegen írásnak. | **Javítva** (`v10.111`, a PR #4 beolvasztásával él), 4 új teszttel. Hozzá: mentés-állapot a fejlécben (3.). |

## 1. Felület: bolondbiztos mindenkinek, teljes a legfőbb adminnak

### 1.1 A helyzet

A négy szint (`js/schema/roles.js`) azt szabályozza, **mit szabad**. Azt, hogy
**mennyi vezérlő látszik**, semmi: egy ügyintéző ugyanazt a Dokumentumok fület
kapja, mint a legfőbb admin — húzható kártyákkal, mappabeállítással,
névmintával, csoportkezeléssel, PDF-összefűzéssel, „Mai nap” felülírással. Aki
átlátja, annak ez erő; aki nem, annak mind egy-egy hely, ahol el lehet rontani.

### 1.2 Két mód

Egy új jog a meglévő rendszerben: **`ui.expert` — „Szakértő felület”**. A
kiinduló szintek közül csak a *Legfőbb admin* kapja. Nem új jogosultsági
rendszer: ugyanúgy a Beállítások rácsán kapcsolható, mint a többi.

| | **Egyszerű mód** (mindenki más) | **Szakértő mód** (legfőbb admin) |
|---|---|---|
| Dokumentumok | három lépés egymás alatt: **Kinek? → Milyen iratot? → Elkészítés**; egy fő gomb | a mai teljes munkaterület, húzható kártyákkal |
| Mappák | a beállított mappa neve látszik, a „másik mappa” gomb nem; ha az engedély hiányzik, egy gomb: „Hozzáférés megadása” (a szerveren ez a sor megszűnik) | mappák választása és cseréje |
| Névminta, csoportok, „Mai nap”, PDF-összefűzés | nem látszik; a legfőbb admin beállítása érvényes | szerkeszthető |
| Nyilvántartás | keresés, adatlap, mentés; oszlopkészlet előre beállítva | oszlopok, szűrők, tömeges szerkesztés, xlsx be/ki |
| Ügyek | „Teendőim” nézet elöl: mi járt le, mi sürgős, mi a következő lépés | minden nézet, ügytípus-sablonok, típus-pótlás |
| Beállítások | csak „Saját fiókom” | séma, szótár, szintek, fiókok, ügytípusok |
| Végleges törlés, visszaállítás mentésből, napló törlése | nincs | van, megerősítéssel |
| Hibaüzenet | mit tegyen: „Szólj a legfőbb adminnak” + egy kattintással küldhető hibajelentés | a technikai részlet is |

A legfőbb admin kap egy **„Megnézem úgy, mint…”** kapcsolót (szint
választása): pontosan azt látja, amit az adott szint — enélkül az egyszerű
módot csak más gépén, más fiókjával lehetne kipróbálni.

### 1.3 Az egyszerű mód szabályai

1. **Egy képernyő, egy feladat, egy fő gomb.** Másodlagos művelet szürke, a
   veszélyes sosem áll a fő gomb mellett.
2. **Nincs szakszó.** „DOCX” helyett „Word-irat”, „séma” helyett „adatmezők”,
   „flush / handle / backend” sehol. A szövegeket a 15–20 fő közül kettővel-
   hárommal kell felolvastatni, nem nekünk megítélni.
3. **A letiltott gomb megmondja, miért** („Előbb válassz ki legalább egy
   személyt”), nem csak szürke.
4. **Visszavonás a megerősítő ablak helyett**, ahol lehet. A „Biztosan?”
   kérdést mindenki olvasatlanul leokézza; a „Visszavonom” 10 másodpercig ott
   van, és tényleg véd.
5. **A program semmit nem tölt ki magától**, amit a felhasználó üresen hagyott.
   Az üres mező a generálásnál **figyelmeztetés**, nem kitalált érték.
6. **Mindig látszik, mi történt:** mentve / készül / kész, hova került az irat,
   hány készült, mi maradt ki és miért.
7. **Üres állapot = útmutató.** Üres lista helyett egy mondat és egy gomb a
   következő lépéshez.
8. **Nagyítás és billentyűzet:** 125–150%-os Windows-skálázáson, 1366 px
   szélességen is egy oszlopban olvasható; minden elérhető Tabbal. (A 780 px-es
   töréspont hibája egyszer már megmutatta, hogy ezt mérni kell.)

### 1.4 Sorrend és ellenőrzés

1. `ui.expert` jog + a `Megnézem úgy, mint…` kapcsoló (kicsi, mindent megalapoz).
2. Dokumentumok egyszerű nézete (ez a legtöbbet használt és a legsűrűbb).
3. Ügyek „Teendőim”, majd a Nyilvántartás és a Beállítások szűkítése.
4. Szövegek átírása, hibaüzenetek egységesítése.

**Kész, ha:** három valódi, nem technikai felhasználó öt feladatot (irat egy
dolgozónak; új dolgozó felvétele; ügy státuszának léptetése; lejáró engedélyek
megkeresése; egy elrontott adat javítása) **segítség nélkül** végigcsinál. Ahol
elakadnak, az a hibalista — nem a mi véleményünk a felületről.

Technikai megjegyzés: a `js/modules/docgen.js` 113 KB, sok beágyazott stílussal.
Nem írjuk újra; az egyszerű nézet **külön, kis modul** ugyanazokra a
szolgáltatásokra (`generateFor`, `DocgenCelmappa`), a szakértői nézet érintetlen.

## 2. Kimenet: alapértelmezés a DOCX

**Ma:** a Dokumentumok fülön a nagy zöld gomb **„DOCX + PDF”**, alatta a „Csak
DOCX” (`docgen.js`, `dg-gen-both` / `dg-gen-docx`); a tömeges ügynél ugyanígy
(`bulk-case.js`, `bk-gen-pdf` az elsődleges). A „PDF” itt valójában nem PDF-et
készít, hanem a kimeneti mappába másolja a `PDF-keszites.vbs`-t és útmutatót ír
ki — a konverzió kézi lépés a Worddel. A gyakorlatban nem használt.

**Terv:**

| | Egyszerű mód | Szakértő mód |
|---|---|---|
| Fő gomb | **„Iratok elkészítése”** → DOCX | ugyanez |
| PDF Word-sablonból | nincs | **„PDF készítése a kész iratokból…”** külön, másodlagos művelet a generálás *után* — kézi, opcionális |
| PDF-összefűzés kártya | nincs | marad, alapból kikapcsolva (ma is így indul) |
| **Kitölthető PDF-sablon** (NYT.52, NYT.53, TAJ-meghatalmazás) | **PDF készül, magától** — a sablon fajtája dönt, nem a gomb | ugyanez |
| Megerősítő ablak címkéje | „Word-irat” (+ „PDF-nyomtatvány”, ha van köztük) | „DOCX” / „PDF-sablon” |

- A `runGenerate` / `generateFor` `pdf` paramétere megmarad, csak az
  alapértelmezett hívás `pdf: false`. A `docgen-generalas.json` kísérőfájl
  továbbra is készül (olcsó, és a későbbi kézi PDF-készítés ebből dolgozik).
- **A funkciót elrejtjük, nem töröljük.** Három hónap éles használat
  után, ha a szakértői gombot sem nyomta meg senki (a napló megmutatja), a
  `docx-pdf.vbs` lánc és a `docgenpdf://` protokoll kivezethető — az külön döntés.
- **A szerveren** sem változik: a konverzió a kliensen marad, kézi lépésként
  (`TERV-belso-szerver.md` 3., S3).

**Teszt:** a meglévő `docgen-resolve`, `bulk-case`, `pdf-chain` készletek
bővítése — alapértelmezett generálás nem másol szkriptet; PDF-sablon irata
`.pdf` kiterjesztéssel és a helyes célmappába kerül, a gombtól függetlenül.


## 3. Mentés: a hamis „valaki más közben írt”

### 3.1 A gyökérok: a program a saját mentésével ütközött — JAVÍTVA

**A tünet:** „⚠ A mentés elmaradt — valaki más közben írt”, miközben egyedül
dolgozol; az üzenet a **saját nevedet** írja ki („utoljára: …”), és újratöltésig
minden további mentés is elbukik.

**A mechanizmus** (`js/services/employee-repo.js`, `createFileBackend.save`):

```
1. mentés indul          → visszaolvas, egyezik → biztonsági másolat → ÍRÁS elindul
2. az írás még tart      (hálózati meghajtón: swap-fájl + csere + méret-visszaolvasás)
3. közben szerkesztesz   → a memóriabeli nyilvántartás megváltozik
4. az írás befejeződik   → a program feljegyzi, „mit látott utoljára” —
                           de ezt az ÉLŐ memóriából veszi, nem abból, amit kiírt
5. következő mentés      → visszaolvas: a fájl ≠ a feljegyzett → „valaki más írt”
```

A 4. lépés a hiba: a lenyomat (`seen`) a már továbbszerkesztett állapotról
készült, tehát olyasmit „látott”, ami sosem került a fájlba. Innentől a fájl
soha nem egyezik a feljegyzéssel, ezért a figyelmeztetés **ragadós**. A Z:
meghajtón az írás lassú, tehát a 2–3. lépés ablaka a napi munkában rendszeresen
nyitva van — gyors egymás utáni szerkesztésnél, tömeges írásnál, ügyrögzítésnél.

Fejlesztőgépen, 300 ms-os írással reprodukálva: pontosan a fenti üzenet jön,
majd a következő mentésnél újra. Ugyanez a háttér szolgálja a nyilvántartást, az
ügyeket, az átutalásokat, a fiókokat és a hosszabbítási naplót — mind érintett.

**Két rokon hiba ugyanott:**

- **Egymásba csúszó mentések.** Az időzített automata mentés és a `flush()`
  (újratöltés, tömeges művelet, xlsx-import előtt) egyszerre futhatott
  ugyanarra a fájlra: két visszaolvasás, két írás, két biztonsági másolat.
- **Elveszíthető módosítás.** Ha a mentés alatt jött módosítás, a mentés vége
  „nincs mit menteni”-re állította a jelzőt; egy rögtön utána jövő `flush()`
  ezért nem írt ki semmit — a módosítás csak a következő szerkesztéskor került
  volna a fájlba, újratöltésnél elveszett.

**A javítás:**

- a kiírt szöveg és a lenyomat **ugyanabban a pillanatban** készül, az írás előtt;
- a háttér a mentéseket **sorba állítja**, egyszerre egy fut;
- a három tároló (`employee-repo`, `case-repo`, `transfer-repo`) változás-
  számlálóval dönti el, hogy a mentés alatt jött-e újabb módosítás.

Teszt: `test/employee-repo.test.js`, „Egyidejű szerkesztés: hamis riasztás
egyedül dolgozva” — 4 eset; a régi kódon 3 elbukik, a javítotton mind zöld, és a
valódi ütközést továbbra is jelzi. **Böngészőben, a Z: meghajtón nincs
ellenőrizve** — az a céges gépen derül ki (6. fejezet, A0).

### 3.2 Mentés-állapot a fejlécben

Ma a mentésről csak a hiba ad hírt. A felhasználónak tudnia kell, hogy
*rendben* van: a fejlécben **„Mentve ✓ 14:02”** / **„Mentés…”** / **„A mentés
nem sikerült — újrapróbálom”**. A tárolók `onChange` / `onSaveError` jelzései
már megvannak; ehhez egy `onSaved` kell melléjük és egy kis fejléc-elem.
Ugyanez az elem a szerveren a kapcsolat állapotát is mutatja majd.

### 3.3 Ami ezen túl van

A valódi többfelhasználós ütközés kezelése (15–20 fő, rekordszintű verzió,
automatikus összefésülés) **a szerverterv része**: `TERV-belso-szerver.md` 2.
A mai fájlmegosztáson ez rendesen nem oldható meg; az ottani 2.3 pont írja le,
mit érdemes megépíteni, ha a szerver csúszik.

## 4. További javaslatok

Fontossági sorrendben; mind független a szervertől.

1. **SheetJS 0.18.5 → a legfrissebb 0.20.x** (`vendor/xlsx.full.min.js`): két
   ismert sérülékenység (CVE-2023-30533, CVE-2024-22363), és az app a
   dolgozóktól kapott xlsx-et olvas be. Az IT-audit ezt elsőként találja meg.
2. **Folyamatos tesztelés (CI):** a `node test/run-all.js` és a böngészős e2e
   fusson minden pushra (GitHub Actions). Ma a tesztelés azon múlik, hogy a
   commit előtt valaki lefuttatja.
3. **Rövid felhasználói útmutató** (2–3 oldal, képekkel) az egyszerű módhoz. A
   README 80 KB, és fejlesztőnek szól.
4. **Biztonsági átnézés:** a 76 `innerHTML`-hely ellenőrzése és egy
   Content-Security-Policy `<meta>` — a `file://` változatba is betehető, a
   szerver előtt pedig kötelező.
5. **Automatikus kilépés tétlenség után** (pl. 30 perc) — közös irodában nyitva
   hagyott gépre. A kapu (`login.js`) már megvan, csak időzítő kell hozzá.
6. **Hibajelentés egy kattintással:** az egyszerű mód hibaablaka a napló
   utolsó sorait egy fájlba teszi, amit a felhasználó elküldhet a legfőbb
   adminnak. (A szerveren ez automatikus gyűjtés lesz.)

## 5. Amit ez a terv szándékosan nem tartalmaz

- **A felület újraírását** keretrendszerre. A vanilla JS marad; az egyszerű
  mód új, kis modulok a meglévő szolgáltatásokra.
- **Új jogosultsági rendszert.** A `ui.expert` egy új jog a meglévő rácsban.
- **A PDF-lánc törlését** — csak elrejtjük (2. fejezet).
- **Bármit, ami szervert feltételez** — az a `TERV-belso-szerver.md`.

## 6. Sorrend

| Lépés | Tartalom | Kész, ha |
|---|---|---|
| **A0** | A hamis ütközés javítása (3.1) | ✅ tesztek zöldek; **céges gépen**: két-három dolgozónál 5–6 mező gyors egymás utáni átírása a Z:-n nem ad figyelmeztetést |
| **A1** ✅ | DOCX alapértelmezés (2.) | a fő gomb Word-iratot ad, szkript nem másolódik; a PDF-sablon irata `.pdf` |
| **A2** ✅ | `ui.expert` jog + „Megnézem úgy, mint…” (1.2) | a legfőbb admin bármely szint nézetét látja kilépés nélkül |
| **A3** | Dokumentumok egyszerű nézete (1.2–1.3) | egy ügyintéző fiókkal három lépésben készül irat |
| **A4** ✅ | Mentés-állapot a fejlécben (3.2) | mentés után az időpont látszik; hibánál a szöveg megmondja, mi a teendő |
| **A5** | Ügyek „Teendőim”; a Nyilvántartás és a Beállítások szűkítése; szövegek | az 1.4 szerinti próba három felhasználóval |
| **A6** | A 4. fejezet tételei | egyenként |

## 7. Döntések, amik rád várnak

| # | Kérdés | Javaslat |
|---|---|---|
| D1 | Az egyszerű mód köre (1.2 táblázat) megfelel? Van, amit az ügyintézőknek mégis látniuk kell (pl. xlsx-export, tömeges ügy)? | A táblázat szerint; a tömeges ügy maradjon az ügyintézőknél, egyszerűsített gombokkal. |
| D2 | A PDF-készítés **elrejtve marad** a Szakértő módban, vagy töröljük? | **Elrejtve**, három hónap múlva újranézve. |
| D3 | Kezdhetem az A1-gyel (DOCX alapértelmezés) és az A2-vel? | **Igen** — kicsik, és a többit megalapozzák. |
| D4 | Ki az a két-három kolléga, akivel a szövegeket és a próbát (1.4) el lehet végezni? | Egy ügyintéző, egy HRBP, egy vezető. |

**Döntve 2026-11-17:** D2 — elrejtve; D3 — igen, A1 + A2 + A4. D1 és D4 nyitott
(az A3/A5 előtt kell).

### Ahogy megépült (A1, A2, A4)

- **A1:** a fő gomb „Iratok elkészítése” (Dokumentumok és tömeges ügy), `pdf: false`.
  Szakértő módban a kész eredmény alatt „PDF készítése a kész iratokból…”: ez másolja
  a szkriptet, és kiírja a következő lépést. A PDF-összefűzés kártya `expert-only`.
- **A2:** `ui.expert` jog (a frissítéskor csak a beépített admin kapja). Az egyszerű
  mód egy `body.ui-simple` osztály; ami szakértői, `expert-only` osztályt kap.
  **„Megnézem úgy, mint…”: szint + személy.** A „saját dolgozók” szintek látóköre
  a fiók nevéhez kötött, ezért a nézethez egy vezetőt is választani kell —
  enélkül az admin üres listát látna. A nézet csak memóriában él (újratöltés
  után a saját nézet jön), csak szűkít, a szerző a valódi fiók marad, és a
  Hosszabbítások rögzítése nézet módban tiltott (a „rogzitette” a nézett nevet
  írná). Élőben vált, újratöltés nélkül: az újratöltés mappa-engedélyt és PIN-t kérne.
- **A4:** a tárolók `onSaveState` jelzése ('pending' / 'saved') + a meglévő
  `onSaveError`; a fejlécben „Mentés…” / „Mentve ✓ óó:pp” / „⚠ A mentés nem
  sikerült”. Próba módban nem látszik. Automatikus újrapróbálás nincs — a
  következő módosítás próbálja újra, ezt mondja a felirat súgója is.
