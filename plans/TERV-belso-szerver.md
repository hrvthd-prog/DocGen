# Belső szerverre költözés — fejlesztési terv

*2026-11-14. Állapot: **terv, jóváhagyásra vár.** Ág: `belso-szerver`.
Egyetlen kódváltozás van benne: a hamis „valaki más közben írt” javítása (2.1).*

Ez a terv a `TERV-szerver-es-audit.md` **folytatása, nem a cseréje**: az a
célarchitektúrát és az IT-kérdéseket rögzíti (3. és 6. fejezet), ez azt, hogy
**mit építünk, milyen sorrendben, és miből látszik, hogy kész.** Három
súlypontja a megrendelésből jön: párhuzamos mentés (2.), bolondbiztos felület
külön legfőbb adminnal (3.), alapértelmezett DOCX-kimenet (4.).

## 0. Röviden

| | Megállapítás | Teendő |
|---|---|---|
| **Párhuzamos mentés** | A „valaki más közben írt” figyelmeztetés egyedül dolgozva is megjelent: **a program a saját előző mentését nézte idegen írásnak.** Reprodukálva, a gyökérok a kódban megvan (2.1). | **Javítva ezen az ágon**, 4 új teszttel. A tartós megoldás a szerveren: rekordszintű verziószám, automatikus összefésülés, „ki szerkeszti most” jelzés (2.3). |
| **Felület** | Minden szint ugyanazt a sűrű, szakértői felületet kapja; a szintek ma csak azt döntik el, *mit szabad*, azt nem, *mennyit lát*. | **Egyszerű mód** mindenkinek, **Szakértő mód** csak a legfőbb adminnak (3.). |
| **Kimenet** | A fő gomb ma **„DOCX + PDF”**, a mellékgomb a „Csak DOCX” — a Dokumentumok fülön és a tömeges ügynél is. Fordítva kell. | Egy fő gomb: Word-irat. A PDF-készítés a Szakértő módba kerül, kézi lépésként. A PDF-sablon irata marad PDF (4.). |
| **Szerver** | A felület és az üzleti logika marad; az adattárolás, az azonosítás és a jogosultság költözik. | Hat fázis, mindegyiknek mérhető „kész, ha” feltétele (5.). |

## 1. Az ág szabályai

- **Az ágon nem lép a verzió, és nincs tag.** A `v10.NNN` a `main` commit-
  számából jön (`tools/verzio.js`); ha az ág is tagelne, ugyanaz a szám két
  különböző commitra mutatna. Ezért itt a hookok (`core.hooksPath`) **nincsenek
  bekapcsolva**; a verziót a `main`-be olvasztás adja.
- **A `main` közben él.** A napi hibajavítás ott megy tovább; az ágat
  rendszeresen a `main`-re kell húzni (`git merge main`), hogy a végén ne egy
  nagy ütközés legyen.
- **Ami a mai `file://` változaton is hasznos és kockázatmentes, az a `main`-re
  megy**, nem itt vár (2.1 javítás, 4. fejezet, a 3. fejezet nagy része). Az
  ágon az marad, ami szervert feltételez.
- Tesztek commit előtt: `node test/run-all.js`. Piros teszt mellett nincs commit.

## 2. Párhuzamos mentés és használat

### 2.1 A gyökérok: a program a saját mentésével ütközött — JAVÍTVA

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

**A javítás (ezen az ágon):**

- a kiírt szöveg és a lenyomat **ugyanabban a pillanatban** készül, az írás előtt;
- a háttér a mentéseket **sorba állítja**, egyszerre egy fut;
- a három tároló (`employee-repo`, `case-repo`, `transfer-repo`) változás-
  számlálóval dönti el, hogy a mentés alatt jött-e újabb módosítás.

Teszt: `test/employee-repo.test.js`, „Egyidejű szerkesztés: hamis riasztás
egyedül dolgozva” — 4 eset; a régi kódon 3 elbukik, a javítotton mind zöld, és a
valódi ütközést továbbra is jelzi. **Böngészőben, a Z: meghajtón nincs
ellenőrizve** — az a céges gépen derül ki (8. fejezet).

### 2.2 Ami a mai megoldásban ezen túl gyenge

A javítás a hamis riasztást szünteti meg. A mai frissesség-ellenőrzés
(`TERV-adatbiztonsag.md` 7.) 2–5 főre készült; 15–20 főnél ezek fognak fájni:

| # | Gyengeség | Következmény 15–20 főnél |
|---|---|---|
| G1 | **Az egész fájl egy egység.** Bárki bármelyik dolgozót módosítja, mindenki más következő mentése elbukik. | Valódi ütközés naponta sokszor, akkor is, ha két ember két különböző dolgozón dolgozik. |
| G2 | **A feloldás kézi:** „írd fel, töltsd újra, vidd be ismét”. | Nem technikai felhasználónak ez adatvesztésként hat; a „Később” gombbal a munka tényleg elvész. |
| G3 | **A lenyomat gyenge:** rekordszám + a legfrissebb `updatedAt`. Ami egyiket sem változtatja, azt nem látja. | Ritka, de néma felülírás lehetséges — pont az, amit a védelem kizárna. |
| G4 | **Az ellenőrzés és az írás nem egy lépés:** közte fut a biztonsági másolat (a leglassabb rész). | Két gép ugyanabban az ablakban mindkettő „rendben”-t lát, és a második felülír. Fájlmegosztáson ezt kódból nem lehet lezárni. |
| G5 | **A `docgen-config.json` (séma, szótár, szintek, ügytípusok) semmilyen ellenőrzést nem kap** (`makeConfigBackend`). | Két admin egyidejű sémaszerkesztése némán felülírja egymást. |
| G6 | **Induláskor is írhat a program** (`migrateLegacyKeys`: séma-pótlás), felhasználói művelet nélkül. | Eltérő verziójú gépek (a frissítés ma gépenkénti) egymás sémáját írják át oda-vissza. |
| G7 | **Ugyanaz a felhasználó két lapon** — a program két külön embernek látja. | „Más használja”, pedig a saját másik füle az. |

A G1, G4, G5 és G6 fájlmegosztáson **elvileg sem** oldható meg rendesen: nincs
olyan pont, ahol egyetlen szereplő dönt. Ez a szerver legerősebb műszaki indoka.

### 2.3 A célállapot a szerveren

**Elv: nem zárolunk, hanem összefésülünk.** A zárolás („ezt most Anna
szerkeszti, te nem nyúlhatsz hozzá”) elárvul (bezárt fül, ebédszünet), és
feloldó gomb, lejárat, admin-beavatkozás kell hozzá — nem technikai
felhasználóknál ez több hibát szül, mint amennyit megelőz. Helyette:

1. **Rekordszintű verziószám.** Minden dolgozó, ügy, köteg saját `rev`-et kap.
   A kliens a módosítást a látott `rev`-vel küldi; a szerver egy tranzakcióban
   ellenőriz és ír. Itt nincs G4: **egy helyen dől el.**
2. **Mezőszintű automatikus összefésülés.** Ha a `rev` közben lépett, a szerver
   megnézi, *mely mezők* változtak. Anna a lakcímet, Béla a bankszámlát írta →
   mindkettő érvényesül, **senki nem lát semmit.** Ez a G1 és a G2 túlnyomó
   részének vége. Az ügyek eseményei egyedi azonosítójú, hozzáfűzött tételek —
   ott ütközés nincs (a hosszabbítási napló már ma így működik).
3. **Valódi ütközés** (ugyanaz a mező, két különböző érték): a mentés nem megy
   át csendben, de a felhasználó **nem gépel újra**. Egy ablak mutatja a két
   értéket — „Anna 10:42-kor ezt írta: … / Te ezt írtad: …” — és egy kattintás
   a döntés. Üres érték sosem „nyer” automatikusan egy kitöltött felett, és a
   program magától semmit nem tölt ki.
4. **Jelenlét-jelzés, tájékoztató jelleggel.** A dolgozó adatlapján: „Anna is
   ezt nézi”. 30 másodperces szívveréssel, magától lejár, **semmit nem tilt** —
   csak megelőzi, hogy ketten ugyanazt csinálják.
5. **Élő frissítés.** A nyitott listák a szerver jelzésére frissülnek (SSE vagy
   10–15 mp-es lekérdezés), nem újratöltésre. Az „elavult képernyőről mentek”
   helyzet nagy része így létre sem jön.
6. **Mentés-állapot a fejlécben:** „Mentve ✓ 14:02” / „Mentés…” / „Nincs
   kapcsolat — a módosításaid megvannak, újrapróbálom”. Ma a mentésről csak a
   hiba ad hírt; a felhasználónak tudnia kell, hogy *rendben* van.
7. **A séma és a beállítások** (G5) ugyanezt a verziószámot kapják; ezeket
   úgyis csak a legfőbb admin írja.
8. **Indulási migráció** (G6) a szerveren fut, egyszer, kiadáskor — a kliens
   induláskor nem ír.

**Kliensoldali előkészítés (szerver nélkül is megírható és tesztelhető):** a
tárolók ma a teljes gyűjteményt mentik (`backend.save(cache)`). Ehelyett
**változás-sort** vezetnek („ezen a rekordon ezek a mezők változtak, erről a
`rev`-ről”), és a háttér dönti el, mit kezd vele: a fájl-háttér továbbra is a
teljes fájlt írja, az API-háttér rekordonként küld. Ez a 2.3 egyetlen nagyobb
kliensoldali átalakítása; a `createFileBackend` / `createIdbBackend` /
`createMemoryBackend` mellé így kerül negyedikként az API-háttér.

### 2.4 Ha a szerver csúszik

A változás-sorral a `file://` változat is kaphat **automatikus újrapróbálást**:
ütközéskor a program újraolvassa a fájlt, a saját függő módosításait ráteszi a
friss állapotra (mezőszinten, a 2.3/2–3. szabályával), és újra ment — a
felhasználó csak valódi mezőütközésnél lát ablakot. Ez a G1–G2-t a mai
architektúrán is enyhíti; a G4-et nem. **Csak akkor érdemes megírni, ha a
szerver 2–3 hónapnál messzebb van** — egyébként ugyanez a munka a szerveren
jobban megtérül.

### 2.5 Ellenőrzés

- Node: két kliens ugyanarra a rekordra — különböző mező → mindkettő megmarad;
  azonos mező → ütközés, a szerver állapota az elsőé; azonos érték → nincs ütközés.
- Node: 20 párhuzamos kliens, 200 véletlen írás → nincs elveszett módosítás
  (a végállapot minden elfogadott írást tartalmaz).
- Böngésző (Playwright, két lap): Anna ment → Béla listája újratöltés nélkül
  frissül; mezőütközésnél megjelenik a választó ablak.
- Hálózat megszakítva mentés közben → a fejléc jelzi, visszatéréskor a
  módosítás kimegy, duplikátum nélkül.

## 3. Felület: bolondbiztos mindenkinek, teljes a legfőbb adminnak

### 3.1 A helyzet

A négy szint (`js/schema/roles.js`) azt szabályozza, **mit szabad**. Azt, hogy
**mennyi vezérlő látszik**, semmi: egy ügyintéző ugyanazt a Dokumentumok fület
kapja, mint a legfőbb admin — húzható kártyákkal, mappabeállítással,
névmintával, csoportkezeléssel, PDF-összefűzéssel, „Mai nap” felülírással. Aki
átlátja, annak ez erő; aki nem, annak mind egy-egy hely, ahol el lehet rontani.

### 3.2 Két mód

Egy új jog a meglévő rendszerben: **`ui.expert` — „Szakértő felület”**. A
kiinduló szintek közül csak a *Legfőbb admin* kapja. Nem új jogosultsági
rendszer: ugyanúgy a Beállítások rácsán kapcsolható, mint a többi.

| | **Egyszerű mód** (mindenki más) | **Szakértő mód** (legfőbb admin) |
|---|---|---|
| Dokumentumok | három lépés egymás alatt: **Kinek? → Milyen iratot? → Elkészítés**; egy fő gomb | a mai teljes munkaterület, húzható kártyákkal |
| Mappák | nem látszik (a szerveren nincs is mappaválasztás) | sablontár kezelése, kimenet ellenőrzése |
| Névminta, csoportok, „Mai nap”, PDF-összefűzés | nem látszik; a legfőbb admin beállítása érvényes | szerkeszthető |
| Nyilvántartás | keresés, adatlap, mentés; oszlopkészlet előre beállítva | oszlopok, szűrők, tömeges szerkesztés, xlsx be/ki |
| Ügyek | „Teendőim” nézet elöl: mi járt le, mi sürgős, mi a következő lépés | minden nézet, ügytípus-sablonok, típus-pótlás |
| Beállítások | csak „Saját fiókom” | séma, szótár, szintek, fiókok, ügytípusok |
| Végleges törlés, visszaállítás mentésből, napló törlése | nincs | van, megerősítéssel |
| Hibaüzenet | mit tegyen: „Szólj a legfőbb adminnak” + egy kattintással küldhető hibajelentés | a technikai részlet is |

A legfőbb admin kap egy **„Megnézem úgy, mint…”** kapcsolót (szint
választása): pontosan azt látja, amit az adott szint — enélkül az egyszerű
módot csak más gépén, más fiókjával lehetne kipróbálni.

### 3.3 Az egyszerű mód szabályai

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

### 3.4 Sorrend és ellenőrzés

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

## 4. Kimenet: alapértelmezés a DOCX

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
- **A funkciót elrejtjük, nem töröljük.** Három hónap éles szerverhasználat
  után, ha a szakértői gombot sem nyomta meg senki (a napló megmutatja), a
  `docx-pdf.vbs` lánc és a `docgenpdf://` protokoll kivezethető — az külön döntés.
- **Szerveren:** a konverzió a kliensen marad (a szerveroldali Word-automatizálást
  a Microsoft nem támogatja; `TERV-szerver-es-audit.md` K5 (b)). Mivel a
  funkció opcionális és nem használt, **ez nem akadálya a költözésnek.**

**Teszt:** a meglévő `docgen-resolve`, `bulk-case`, `pdf-chain` készletek
bővítése — alapértelmezett generálás nem másol szkriptet; PDF-sablon irata
`.pdf` kiterjesztéssel és a helyes célmappába kerül, a gombtól függetlenül.

Ez a fejezet **nem függ a szervertől**: a `main`-re mehet, amint jóváhagyod.

## 5. Fázisok

Az architektúra a `TERV-szerver-es-audit.md` 3. fejezete szerint; itt a sorrend
és az átadási feltételek.

| Fázis | Tartalom | Hol | Kész, ha |
|---|---|---|---|
| **F0** | Hamis ütközés javítása; ez a terv | ez az ág → `main` | ✅ tesztek zöldek; **céges gépen**: gyors egymás utáni szerkesztés a Z:-n nem ad figyelmeztetést |
| **F1** | DOCX alapértelmezés (4.); `ui.expert` + egyszerű Dokumentumok-nézet (3.); mentés-állapot a fejlécben | `main` (a mai változaton is él) | a 3.4 szerinti próba három felhasználóval |
| **F2** | Változás-sor a tárolókban (2.3); API-háttér; Node-szolgáltatás tesztadattal, SQLite-tal; statikus kiszolgálás | ág | `node test/run-all.js` + a 2.5 Node-tesztjei; az app `http://localhost`-ról végigkattintható mappaválasztás nélkül |
| **F3** | Azonosítás (céges SSO, a PIN megszűnik); **szerveroldali** jogosultság; csak hozzáfűzéses audit-napló | ág | „Vezető” fiókkal a teljes dolgozói adat lekérése **403**; minden írás a naplóban, névvel |
| **F4** | Sablontár a szerveren (a legfőbb admin tölti fel); kimenet a `09_OIF_kerelmek`-be szolgáltatásfiókkal; jelenlét-jelzés és élő frissítés | ág | generált irat a helyes dolgozói mappában, a PDF Műhely „E”-nek látja |
| **F5** | Adatátvétel a mai `docgen-*.json`-okból; 1–2 hét párhuzamos futás **csak olvasásra** a régin | tesztszerver → éles | darabszám- és mintaegyezés (dolgozók, ügyek, események, kötegek); visszaállítási próba mentésből |
| **F6** | A `file://` változat kivezetése; a régi JSON-ok archiválása; a `frissit.vbs`-lánc megszűnik | éles | mindenki az URL-ről dolgozik; a régi mappa írásvédett |

**Ami az IT válaszáig áll:** az F2 technikai részletei (Windows/IIS vagy Linux,
megengedett-e a Node.js és az SQLite), az F3 (Kerberos vagy Entra ID) és az F4
(szolgáltatásfiók a megosztásra) — a `TERV-szerver-es-audit.md` K4–K8 kérdései.
Az F1 és az F2 kliensoldala **ezek nélkül is elkezdhető**, mert a háttér
cserélhető.

**A felhasználói beállítások sorsa:** az oszlopok, nézetek, kártyahelyek ma a
böngésző tárolójában élnek, a `file://` címhez kötve — az új címen **üresen
indulnak**. Az F3-ban a fiókhoz, a szerverre kerülnek; így a beállítás a
felhasználót követi, nem a gépet.

## 6. További javaslatok

Fontossági sorrendben; az első három a költözés előtt esedékes.

1. **SheetJS 0.18.5 → a legfrissebb 0.20.x** (`vendor/xlsx.full.min.js`): két ismert
   sérülékenység (CVE-2023-30533, CVE-2024-22363), és az app a dolgozóktól
   kapott xlsx-et olvas be. Az IT-audit ezt elsőként találja meg.
2. **Biztonsági átnézés a szerver előtt:** 76 `innerHTML`-hely ellenőrzése,
   Content-Security-Policy, a sablonfeltöltés ellenőrzése (az F4-ben a szerver
   fájlt fogad). Hálózaton futó appnál egy XSS már nem csak a saját gépet érinti.
3. **Adatvédelem:** útlevél-, TAJ-, adó- és bankszámlaadat egy szerveren —
   adatleltár, megőrzési idő (mi történik a kilépett dolgozó adatával, mikor
   törlődik), és valószínűleg hatásvizsgálat (DPIA). Ezt az adatvédelmi
   felelőssel kell elindítani, mert átfutása hosszabb, mint a fejlesztésé.
4. **Hibajelentés a legfőbb adminhoz.** A napló ma a felhasználó böngészőjében
   marad; 15–20 nem technikai felhasználó nem fogja tudni elmondani, mi történt.
   A szerver gyűjtse a kliens hibáit (fiók, verzió, művelet), és legyen egy
   „Hibák” lap az adminnak.
5. **Automatikus kilépés tétlenség után** (pl. 30 perc) és munkamenet-kezelés a
   szerveren — közös irodában nyitva hagyott gépre.
6. **Folyamatos tesztelés (CI):** a `node test/run-all.js` és a böngészős e2e
   fusson minden pushra (GitHub Actions). Ma a tesztelés azon múlik, hogy a
   commit előtt valaki lefuttatja.
7. **Tesztkörnyezet próbaadattal** a szerveren: a mai „próba mód” utódja, ahol
   új kolléga éles adat nélkül gyakorolhat, és ahol egy kiadás éles előtt
   kipróbálható.
8. **Rövid felhasználói útmutató** (2–3 oldal, képekkel) az egyszerű módhoz. A
   README 80 KB, és fejlesztőnek szól.
9. **Határidő-értesítés e-mailben** a szerverről (lejáró engedély, lejárt
   ügyhatáridő) — ma csak az látja, aki megnyitja az appot. Csak ha az IT enged
   levélküldést; nem feltétele a költözésnek.
10. **Mentés és visszaállítás a szerveren:** a mai 20 db/fájl másolat helyett
    napi adatbázis-mentés az IT rendje szerint, és **évente egy tényleges
    visszaállítási próba** — a ki nem próbált mentés nem mentés.

## 7. Amit ez a terv szándékosan nem tartalmaz

- **Kemény zárolást** („más szerkeszti, nem nyithatod meg”) — lásd 2.3.
- **Az üzleti logika szerverre költöztetését** első körben: a séma, a
  dokumentumgenerálás, a határidő-számítás a kliensen marad. A szerver az
  adatot, a jogosultságot és a naplót adja.
- **A felület újraírását** keretrendszerre. A vanilla JS marad; az egyszerű
  mód új, kis modulok a meglévő szolgáltatásokra.
- **A PDF Műhely szerverre vitelét** és a mappaszerkezet megváltoztatását.

## 8. Döntések, amik rád várnak

| # | Kérdés | Javaslat |
|---|---|---|
| D1 | A 2.1 javítás menjen-e **most a `main`-re** (verzióval, taggel), hogy a mai napi munkában se jelenjen meg a hamis figyelmeztetés? | **Igen.** Utána a céges gépen: Nyilvántartás → 5–6 mező gyors egymás utáni átírása két-három dolgozónál → nem jöhet figyelmeztetés. |
| D2 | A 4. fejezet (DOCX alapértelmezés) mehet-e a `main`-re a szervertől függetlenül? | **Igen.** |
| D3 | A PDF-készítés **elrejtve marad** a Szakértő módban, vagy töröljük? | **Elrejtve**, három hónap múlva újranézve. |
| D4 | Az egyszerű mód köre (3.2 táblázat) megfelel? Van, amit az ügyintézőknek mégis látniuk kell (pl. xlsx-export, tömeges ügy)? | A táblázat szerint; a tömeges ügy maradjon az ügyintézőknél, egyszerűsített gombokkal. |
| D5 | Mit tudunk az IT-tól (szerver típusa, adatbázis, SSO, időpont)? | Enélkül az F2 kliensoldala és az F1 megy; a szerverkód technológiája ettől függ. |
| D6 | Ha a szerver 2–3 hónapnál messzebb van: megírjuk-e a 2.4 automatikus újrapróbálást a mai változatra? | Csak akkor. |
