# Belső szerverre költözés — fejlesztési terv

*2026-11-14. Állapot: **terv, jóváhagyásra vár.** Ág: `belso-szerver`.
A felület és a kimenet külön terv: `TERV-felulet-es-kimenet.md`.*

Ez a terv a `TERV-szerver-es-audit.md` **folytatása, nem a cseréje**: az a
célarchitektúrát és az IT-kérdéseket rögzíti (3. és 6. fejezet), ez azt, hogy
**mit építünk, milyen sorrendben, és miből látszik, hogy kész.** A súlypontja a
párhuzamos használat: 15–20 ember egyszerre, adatvesztés és hamis riasztás nélkül.

## 0. Röviden

| | Megállapítás | Teendő |
|---|---|---|
| **Párhuzamos mentés** | A mai védelem az egész fájlt egy egységnek veszi: bárki bármit ment, mindenki más következő mentése elbukik, és újra kell gépelnie. 15–20 főnél ez napi többszöri valódi ütközés. Fájlmegosztáson elvileg sem oldható meg rendesen. | A szerveren rekordszintű verziószám, mezőszintű automatikus összefésülés, „ki nézi most” jelzés — **zárolás nélkül** (2.2). |
| **Szerver** | A felület és az üzleti logika marad; az adattárolás, az azonosítás és a jogosultság költözik. | Öt fázis, mindegyiknek mérhető „kész, ha” feltétele (3.). |
| **Ami az IT-n múlik** | Szerver típusa, adatbázis, SSO, szolgáltatásfiók, időpont. | A kliensoldali előkészítés ezek nélkül is elkezdhető (3.). |

## 1. Az ág szabályai

- **Az ágon nem lép a verzió, és nincs tag.** A `v10.NNN` a `main` commit-
  számából jön (`tools/verzio.js`); ha az ág is tagelne, ugyanaz a szám két
  különböző commitra mutatna. Ezért itt a hookok (`core.hooksPath`) **nincsenek
  bekapcsolva**; a verziót a `main`-be olvasztás adja.
- **A `main` közben él.** A napi hibajavítás és a `TERV-felulet-es-kimenet.md`
  munkái ott mennek tovább; az ágat rendszeresen a `main`-re kell húzni
  (`git merge main`), hogy a végén ne egy nagy ütközés legyen.
- **Az ágon az marad, ami szervert feltételez.** Ami a mai `file://` változaton
  is hasznos, az a `main`-re megy.
- Tesztek commit előtt: `node test/run-all.js`. Piros teszt mellett nincs commit.

## 2. Párhuzamos mentés és használat

A hamis „valaki más közben írt” figyelmeztetés (egyedül dolgozva is megjelent)
gyökéroka és javítása: `TERV-felulet-es-kimenet.md` 3.1 — az a mai változat
hibája volt, és ki van javítva. Ez a fejezet arról szól, ami utána marad.

### 2.1 Ami a mai megoldásban gyenge

A mai frissesség-ellenőrzés
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

### 2.2 A célállapot a szerveren

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
6. **Mentés-állapot a fejlécben** (`TERV-felulet-es-kimenet.md` 3.2) kiegészül:
   „Nincs kapcsolat — a módosításaid megvannak, újrapróbálom”.
7. **A séma és a beállítások** (G5) ugyanezt a verziószámot kapják; ezeket
   úgyis csak a legfőbb admin írja.
8. **Indulási migráció** (G6) a szerveren fut, egyszer, kiadáskor — a kliens
   induláskor nem ír.

**Kliensoldali előkészítés (szerver nélkül is megírható és tesztelhető):** a
tárolók ma a teljes gyűjteményt mentik (`backend.save(cache)`). Ehelyett
**változás-sort** vezetnek („ezen a rekordon ezek a mezők változtak, erről a
`rev`-ről”), és a háttér dönti el, mit kezd vele: a fájl-háttér továbbra is a
teljes fájlt írja, az API-háttér rekordonként küld. Ez a célállapot egyetlen nagyobb
kliensoldali átalakítása; a `createFileBackend` / `createIdbBackend` /
`createMemoryBackend` mellé így kerül negyedikként az API-háttér.

### 2.3 Ha a szerver csúszik

A változás-sorral a `file://` változat is kaphat **automatikus újrapróbálást**:
ütközéskor a program újraolvassa a fájlt, a saját függő módosításait ráteszi a
friss állapotra (mezőszinten, a 2.2/2–3. szabályával), és újra ment — a
felhasználó csak valódi mezőütközésnél lát ablakot. Ez a G1–G2-t a mai
architektúrán is enyhíti; a G4-et nem. **Csak akkor érdemes megírni, ha a
szerver 2–3 hónapnál messzebb van** — egyébként ugyanez a munka a szerveren
jobban megtérül.

### 2.4 Ellenőrzés

- Node: két kliens ugyanarra a rekordra — különböző mező → mindkettő megmarad;
  azonos mező → ütközés, a szerver állapota az elsőé; azonos érték → nincs ütközés.
- Node: 20 párhuzamos kliens, 200 véletlen írás → nincs elveszett módosítás
  (a végállapot minden elfogadott írást tartalmaz).
- Böngésző (Playwright, két lap): Anna ment → Béla listája újratöltés nélkül
  frissül; mezőütközésnél megjelenik a választó ablak.
- Hálózat megszakítva mentés közben → a fejléc jelzi, visszatéréskor a
  módosítás kimegy, duplikátum nélkül.

## 3. Fázisok

Az architektúra a `TERV-szerver-es-audit.md` 3. fejezete szerint; itt a sorrend
és az átadási feltételek. A felület egyszerűsítése és a DOCX alapértelmezés
(`TERV-felulet-es-kimenet.md`) ezzel **párhuzamosan**, a `main`-en halad — a
szerverre költözésnek nem előfeltétele, de a 15–20 fő beengedésének igen.

| Fázis | Tartalom | Kész, ha |
|---|---|---|
| **S1** | Változás-sor a tárolókban (2.2); API-háttér; Node-szolgáltatás tesztadattal, SQLite-tal; statikus kiszolgálás | `node test/run-all.js` + a 2.4 Node-tesztjei; az app `http://localhost`-ról végigkattintható mappaválasztás nélkül |
| **S2** | Azonosítás (céges SSO, a PIN megszűnik); **szerveroldali** jogosultság; csak hozzáfűzéses audit-napló; a felhasználói beállítások a fiókhoz | „Vezető” fiókkal a teljes dolgozói adat lekérése **403**; minden írás a naplóban, névvel |
| **S3** | Sablontár a szerveren (a legfőbb admin tölti fel); kimenet a `09_OIF_kerelmek`-be szolgáltatásfiókkal; jelenlét-jelzés és élő frissítés | generált irat a helyes dolgozói mappában, a PDF Műhely „E”-nek látja |
| **S4** | Adatátvétel a mai `docgen-*.json`-okból; 1–2 hét párhuzamos futás **csak olvasásra** a régin | darabszám- és mintaegyezés (dolgozók, ügyek, események, kötegek); visszaállítási próba mentésből |
| **S5** | A `file://` változat kivezetése; a régi JSON-ok archiválása; a `frissit.vbs`-lánc megszűnik | mindenki az URL-ről dolgozik; a régi mappa írásvédett |

**Ami az IT válaszáig áll:** az S1 szerveroldalának részletei (Windows/IIS vagy
Linux, megengedett-e a Node.js és az SQLite), az S2 (Kerberos vagy Entra ID) és
az S3 (szolgáltatásfiók a megosztásra) — a `TERV-szerver-es-audit.md` K4–K8
kérdései. Az S1 **kliensoldala ezek nélkül is elkezdhető**, mert a háttér
cserélhető.

**A felhasználói beállítások sorsa:** az oszlopok, nézetek, kártyahelyek ma a
böngésző tárolójában élnek, a `file://` címhez kötve — az új címen **üresen
indulnak**. Az S2-ben a fiókhoz, a szerverre kerülnek; így a beállítás a
felhasználót követi, nem a gépet.

**A PDF-készítés** a szerveren is kézi, kliensoldali lépés marad (a
szerveroldali Word-automatizálást a Microsoft nem támogatja;
`TERV-szerver-es-audit.md` K5 (b)). Mivel a funkció opcionális és a
gyakorlatban nem használt, **nem akadálya a költözésnek.**

## 4. További javaslatok a szerverhez

1. **Adatvédelem:** útlevél-, TAJ-, adó- és bankszámlaadat egy szerveren —
   adatleltár, megőrzési idő (mi történik a kilépett dolgozó adatával, mikor
   törlődik), és valószínűleg hatásvizsgálat (DPIA). Ezt az adatvédelmi
   felelőssel **most** kell elindítani, mert átfutása hosszabb, mint a fejlesztésé.
2. **Biztonsági átnézés az éles indulás előtt:** a sablonfeltöltés ellenőrzése
   (az S3-ban a szerver fájlt fogad), biztonsági fejlécek, függőségek listája.
   Hálózaton futó appnál egy XSS már nem csak a saját gépet érinti.
3. **Hibák gyűjtése a szerveren.** A napló ma a felhasználó böngészőjében
   marad. A szerver gyűjtse a kliens hibáit (fiók, verzió, művelet), és legyen
   egy „Hibák” lap a legfőbb adminnak.
4. **Tesztkörnyezet próbaadattal:** a mai „próba mód” utódja, ahol új kolléga
   éles adat nélkül gyakorolhat, és ahol egy kiadás éles előtt kipróbálható.
5. **Mentés és visszaállítás:** a mai 20 db/fájl másolat helyett napi
   adatbázis-mentés az IT rendje szerint, és **évente egy tényleges
   visszaállítási próba** — a ki nem próbált mentés nem mentés.
6. **Munkamenet-kezelés:** lejárat és kiléptetés a szerveren (a kliensoldali
   tétlenségi kilépés a másik tervben van).
7. **Határidő-értesítés e-mailben** (lejáró engedély, lejárt ügyhatáridő) — ma
   csak az látja, aki megnyitja az appot. Csak ha az IT enged levélküldést; nem
   feltétele a költözésnek.

## 5. Amit ez a terv szándékosan nem tartalmaz

- **Kemény zárolást** („más szerkeszti, nem nyithatod meg”) — lásd 2.2.
- **Az üzleti logika szerverre költöztetését** első körben: a séma, a
  dokumentumgenerálás, a határidő-számítás a kliensen marad. A szerver az
  adatot, a jogosultságot és a naplót adja.
- **A felületet és a kimenetet** — az a `TERV-felulet-es-kimenet.md`.
- **A PDF Műhely szerverre vitelét** és a mappaszerkezet megváltoztatását.

## 6. Döntések, amik rád várnak

| # | Kérdés | Javaslat |
|---|---|---|
| D1 | Mit tudunk az IT-tól (szerver típusa, adatbázis, SSO, időpont)? | Enélkül az S1 kliensoldala megy; a szerverkód technológiája ettől függ. |
| D2 | Zárolás helyett összefésülés (2.2) — elfogadod az elvet? | **Igen**; a jelenlét-jelzés megadja azt, amit a zárolástól várnánk, a hátrányai nélkül. |
| D3 | Ha a szerver 2–3 hónapnál messzebb van: megírjuk-e a 2.3 automatikus újrapróbálást a mai változatra? | Csak akkor. |
| D4 | Elindítod-e az adatvédelmi egyeztetést (4./1.)? | **Igen, most** — ez a leghosszabb átfutású tétel. |
