# Közös mappaszerkezet a PDF Műhellyel + fs-service felújítás — terv

*2026-09-29. A [PDF Műhely](https://github.com/hrvthd-prog/pdf-muhely) `kepek-pdf-terv.md` 12. fejezetének DocGen-oldali párja.*

## 0. Miért ez a fájl

A PDF Műhely dolgozónként két alkönyvtárra vált:

```
<munkamappa>\<Dolgozó Név>\
    01_Elokeszitett\   ← ide generál a DocGen (nyomtatásra/aláírásra váró irat)
    02_Feltoltheto\    ← a szkennelt, aláírt, portálra menő végleges PDF
```

A DocGen két dolgot kap ebből: a **célmappa** `01_Elokeszitett` lesz, és a generált PDF **bélyeget** kap, hogy a Műhely biztosan tudja, generált-e az irat vagy szkennelt (a fájlnév `aláírt` utótagja csak tartalék).

Ez papíron egy konstans és egy `set_metadata`. A felmérés viszont azt mutatta, hogy **az alapja nem bírja el**: a mappaírás hibái ma némák, és pont azt a bizonytalanságot termelnék újra, amit a két alkönyvtárral meg akarunk szüntetni. Ezért a felújítás **blokkoló előfeltétel**, nem opcionális takarítás.

## 1. Az engedély-ergonómia — a napi súrlódás gyökere

**A tünet** (a felhasználó leírása): a sablonmappánál minden indulásnál jelzi, hogy hozzáférés kell. A kimeneti mappa viszont **beállítottnak látszik**, de írni nem tud — a „Másik kimenet mappa választása” gombra kell kattintani, a mappát újra kiválasztani, és **csak utána** jön a hozzáférés-párbeszéd.

**A gyökér.** A `restoreHandles` (`js/modules/docgen.js`) az engedély **nélküli** handle-t is beteszi `state.outputDir`-be, majd hívja a `rerenderSidebarSettings`-et — az pedig csak azt kérdezi, *van-e* handle:

```js
if (state.outputDir) {
  if (badge)  badge.classList.add('done');                    // ✓ 3. lépés „kész”
  if (setBtn) setBtn.textContent = '🔄 Másik kimenet mappa választása';
}
```

A sablonmappa ugyanebben a helyzetben `🔒 Sablonmappa (hozzáférés szükséges)` feliratot kap. **Ez az aszimmetria a tünet.**

Aztán `onSetOutput` a `queryPermissionOnly` `false` ágán `_pickAndSaveOutputDir()`-t hív, azaz **mappaválasztót**. Holott a banner útja (`verifyPermission(state.outputDir, true)`) ugyanezt mappaválasztó nélkül megoldja: **a gombnyomás maga a user gesture**, tehát ott a `requestPermission` szabályos. A kód eldobja a jó handle-t, és újraválasztást kér helyette.

**A javítás (~10 sor):**

1. `rerenderSidebarSettings` kapjon „handle van, engedély nincs” állapotot: `🔒 Kimeneti mappa (hozzáférés szükséges)`, és a 3. lépés ne legyen `done`.
2. `onSetOutput`: ha van handle, de nincs engedély → `FsService.verifyPermission(state.outputDir, true)`, és **csak megtagadás után** picker.

A két banner (`showDirRestoreBanner`, `showOutputDirRestoreBanner`) már ma helyesen a tárolt handle-re kér engedélyt — **nem azok hibásak, hanem a gomb útja.** Ezért elég a gombot ugyanarra az útra állítani; új felületi elem nem kell.

**Ami ezzel NEM szűnik meg:** a `file://` protokollon a Chrome tartós engedélye telepített webalkalmazáshoz kötött, és `file://`-nak nincs telepíthető origin-je — tehát az engedélyt indulásonként meg kell adni. A `TERV-dijatutalas.md` 4. pontjának (a) és (b) változata erről szól. **Döntés: előbb csak a fenti 10 soros javítás megy be, és egy-két hét valódi használat után mérjük, kell-e még az (a) egyesített „Hozzáférés megadása” képernyő vagy a (b) `localhost` + telepítés.** Lehet, hogy ezzel már nem zavaró.

Multi-user szempont a későbbi döntéshez: külön Windows-fiók = külön böngészőprofil = **külön IndexedDB és külön engedély**, tehát az elkülönítést az OS adja. Az `fs-service.js` `userKey()` prefixe akkor véd, ha többen osztoznak egy Windows-fiókon; külön fiókoknál nem ez a védelmi vonal. Minél több felhasználó és minél gyakoribb az indítás, annál inkább (b) térül meg — de elmegy a `file://` egyszerűsége, és visszajön a háttérfolyamat, amit a projekt egyszer már kidobott.

## 2. Mért hibák a `js/services/fs-service.js`-ben

| # | Hely | A hiba | Miért számít |
|---|---|---|---|
| a | `getSubDir` | minden kivételt `null`-ra fordít | a `NotFoundError` (nincs mappa), a `NotAllowedError` (nincs engedély) és a `TypeError` (érvénytelen név) egybemosódik. **A `01_Elokeszitett` létrehozása épp ezen megy** — engedélyhiba esetén a DocGen csendben a gyökérbe ír, a Műhely mátrixában `~` besorolatlan lesz, és a hiba a migrációra tolódik |
| b | `getOrRequestDir` | `verifyPermission(handle)` — a `write` paraméter defaultja `false` | csak **read** engedélyt igazol, de a handle-t `readwrite`-ra használjuk: a `createWritable()` később, a generálás közepén dob `NotAllowedError`-t |
| c | `writeToDir`, `writeTextToDir` | nincs `try/finally` a writable körül, és nincs írás-ellenőrzés | ha a `write` és a `close` között hiba van, a stream nyitva marad; Chromium swap-fájlon dolgozik, így **`.crswap` maradék** vagy fél fájl keletkezhet. A Műhely oldalán van `write_pdf_verified` (visszaolvasás + oldalszám-ellenőrzés), itt semmi |
| d | `fileExists`, `deleteFromDir` | `catch` → `false` | az engedélyhiba „nincs ilyen fájl”-ként jelenik meg, tehát a felülírás-kérdés némán elmarad |
| e | `_scanRecursive` | nincs mélységi korlát és nincs pont-szűrés | a sablonkeresés bejárja az **összes** dolgozói mappát és a `.eredeti\`-t is, ha a kimenet a Műhely munkamappája. A Műhely `walk_files` mindenhol kihagyja a ponttal kezdődő mappát — itt nem |
| f | `getOrRequestFile` | hiányzik a `force` opció | a mappánál 2026-08-19-én pont ezt javítottuk (SESSIONS.md), a fájlnál benne maradt: fájlt váltani nem lehet, a régi handle jön vissza |
| g | `docgen.js` generálás, `docgen/merge.js` | `try { writeToDir(...) } catch {}` → **néma visszaesés `saveAs`-re** | ha az írás bármiért elbukik (engedély!), a generált irat **csendben a Letöltések mappába** kerül, nem a kimenetibe. Az F5-nél ez azt jelentené, hogy a `01_Elokeszitett` hibája esetén a fájl egyáltalán nem a munkamappában landol, és a Műhely nem is látja |

**A (g) döntése:** a `saveAs` visszaesés **csak akkor marad, ha `FsService.hasFsApi` hamis** (nem Chromium böngésző). Ha a böngésző tudja a mappaírást, de az elbukott, az **hiba** — jelentsük a `<ok>`-kal, és ne szórjuk szét a fájlokat. Ez az egyetlen változat, ami mellett a 01/02 szerkezet megőrzi az értelmét: egy csendben máshova került fájl pontosan az a bizonytalanság, amit a két alkönyvtárral meg akarunk szüntetni.

**Az (a) és a (b) blokkolja a 01/02 bevezetését**; a (c)–(f) ugyanannak a mintának a többi előfordulása — a nyelt hiba. Együtt javítjuk, mert a két alkönyvtár egész célja, hogy a néma állapot látszódjon; néma hibákra épülve értelmetlen.

**Az (e)-hez egy új követelmény:** a felhasználó a Műhely munkamappáját szánja kimeneti mappának (ma még nem az). Ezért **a sablonmappa ne legyen ugyanaz vagy az alatt** — és a `_scanRecursive` kapjon mélységi korlátot plusz pont-szűrést, a `walk_files` mintájára.

## 3. A célmappa és a bélyeg

- **Célmappa:** a generált irat `<kimenet>\<Dolgozó Név>\01_Elokeszitett\` alá kerül, `getSubDir(..., true)`-val — a javított, hibát szétválasztó változattal. Ha a mappa nem hozható létre, **álljon meg és szóljon**; ne írjon a gyökérbe és ne essen vissza letöltésre (2. g).

- **A dolgozói mappa feloldása: egyezés, majd rákérdezés** (a felhasználó döntése). A DocGen végignézi a kimeneti mappa alkönyvtárait, és a Műhely `resolve_worker` logikájával párosít: **ékezet- és kisbetű-független** pontos egyezés, vagy az egyetlen részegyezés. Ha nincs biztos találat, **kérdez**: melyik meglévő mappába, vagy hozzon-e létre újat ezen a néven (`Vezetéknév Keresztnév`). Sosem hoz létre magától mappát — így nem keletkezhet párhuzamos dolgozói mappa eltérő névformátumból (nagybetűs vezetéknév, EH-szám a név után, más sorrend), amitől az Áttekintő két fél dolgozót látna. A válasz **munkamenetre megjegyzésre kerül**, hogy egy kötegelt generálás ne kérdezzen ugyanarról többször.
- **Bélyeg — megvalósításkor kiderült, hogy a docx-en át vezet az út.** A terv eredetileg a PDF metaadatát írta volna. A generált irat PDF-jét viszont **nem ez az app készíti**, hanem a Word a `tools/docx-pdf.vbs`-en át — és ott a docx `ReadOnly` nyílik, tehát a konverzió pillanatában nem tudunk tulajdonságot beállítani.

  A megoldás: a `DocxService.stampDocGen()` a **docx `docProps/core.xml` Keywords** mezőjébe írja a bélyeget (`docgen;v<verzió>`), és a **Word ezt átviszi a PDF metaadatába** az exportnál. Egy `PizZip`-es zip-átírás, ugyanaz a minta, mint a `processCheckboxes`.

  Ez nem a „docx-bélyeg nincs" döntés visszavonása: a docx itt **hordozó**, nem második igazság. A bélyeg továbbra is egyetlen dolgot dönt el — generált-e a PDF vagy szkennelt.
- **Az összefűzött csomag** (`merge.js`) pdf-lib-bel készül, ott közvetlenül `setProducer('DocGen <verzió>')` + `setKeywords(['docgen'])`.
- A Műhely `is_noise` ma is kihagyja a `docgen-*.json`-t, tehát az adatfájlok a munkamappában élhetnek — a közös mappa szándék szerint való.

## 4. Fázisok és ellenőrzés

```
F4.5  fs-service felújítás
      1) engedély-ergonómia (1. fejezet, ~10 sor)   ← a legnagyobb napi nyereség
      2) getSubDir hibaszétválasztás (a)            ← blokkoló a 01/02-höz
      3) verifyPermission(handle, true) (b)          ← blokkoló
      4) try/finally + írás-visszaolvasás (c)
      5) fileExists / deleteFromDir: hiba ≠ „nincs fájl” (d)
      6) _scanRecursive: mélységi korlát + pont-szűrés (e)
      7) getOrRequestFile: force (f)
      8) saveAs visszaesés csak !hasFsApi esetén (g)
      → ellenőrzés: node test/run-all.js + böngészős végigkattintás
        (a Node-tesztek a File System Access API-t nem fedik — a mappa-
         műveleteket kézzel kell végigpróbálni, engedély megtagadásával is)
F5    dolgozói mappa feloldása (egyezés + rákérdezés),
      célmappa 01_Elokeszitett, bélyeg a generált PDF-en
      → ellenőrzés: generálás után a Műhely Áttekintője E-t mutat, nem ~-t
```

**A frissesség-ellenőrzés is ebben a körben megy be** (a felhasználó döntése) — a `TERV-adatbiztonsag.md` 7. fejezete szerint, az F5 után, mert 2-5 fő közös mappán a néma adatvesztés nagyobb tétel, mint a mappaszerkezet.

**Az F5 a Műhely F2 (migráció) előtt kell**, különben a migráció a bélyeg nélküli régi kimenetet „szkennelt”-nek látja, és tévesen `02`-be tenné.

## 5. Amit ez a terv NEM old meg

- **Egyidejű szerkesztés közös mappán.** 2-5 felhasználó, közös mappa, gyakran egyszerre — ez a `docgen-employees.json` zárolás nélküli read-modify-write mintája miatt **elveszett mentést** okoz. Külön kérdés, nagyobb tétel, mint ez a terv: `TERV-adatbiztonsag.md` 7. fejezet.
- **A tartós engedély gyökere** (`file://`): lásd 1. fejezet vége és `TERV-dijatutalas.md` 4. pont.
- **A nyomtatott QR/vonalkód**, amivel a szkennelt köteg magától szétosztható lenne. Ez az egyetlen jel, ami átéli a nyomtatás–aláírás–szkennelés kört, de dekóder-dependenciát és szkenner-mérést igényel. Csak mérés után döntendő; a `kepek-pdf-terv.md` 12.7 írja le.
