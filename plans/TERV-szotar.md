# TERV — Szótár és kétnyelvű jelölők

> **Állapot:** **kivitelezve (`v10.46`, 2026-08-19).** Az 1., 1/b., 2., 3., 4.,
> 5. és 6. lépés kész. Nyitva maradt: az 5. pont eldöntendő kérdése (az angol
> címke adjon-e angol értéket) — szándékosan.
> **Kiváltó kérdés:** a tartózkodási cél magyarul kerül a nyilvántartásba, a
> szótárba felvesszük az angol párját — hogyan hivatkozzam a dokumentumban
> hol a magyarra, hol az angolra?

---

## 1. Rövid válasz: nem kell új mechanizmus

A konkrét eset **ma is működik**, kódmódosítás nélkül:

| | |
|---|---|
| Nyilvántartásban | `residence_purpose = "EU Kék Kártya"` |
| Beállítások → Szótár | `EU Blue Card = EU Kék Kártya` |
| `{{residence_purpose}}` | → `EU Kék Kártya` |
| `{{residence_purpose_hun}}` | → `EU Kék Kártya` |
| `{{residence_purpose_en}}` | → **`EU Blue Card`** |
| `{{residence_purpose_eng}}` | → `EU Blue Card` |
| `{{Tartózkodás célja}}` | → `EU Kék Kártya` |
| `{{Tartózkodás célja_EN}}` | → `EU Blue Card` |

Ellenőrizve: a séma-réteget `vm`-sandboxban betöltve, a fenti szótári párral
és a fenti tárolt értékkel — mind a nyolc jelölő a táblázat szerinti értéket
adta. Ugyanígy működik vegyes irányban is: a `citizenship` mezőt a kitöltő
magyarul adja (`Szerbia` → `{{citizenship_en}}` = `Serbia`), a
`place_of_birth_country`-t angolul (`Serbia` → `{{place_of_birth_country}}` =
`Szerbia`). Számított mezőn is: `{{transport_type}}` = `busz`,
`{{transport_type_en}}` = `bus`.

**Amiért mégsem volt kitalálható:** a README és a Beállítások súgója azt írja,
hogy `{{previous_country_eng}}` „ahogy a táblázatban érkezett". Ez azt sugallja,
hogy a szótárnak *iránya* van (angolul jön → magyarra fordít), és hogy magyarul
felvitt adatnál az `_eng` a magyar szöveget adná vissza. **Nem így van.** Lásd
a 2. pontot.

---

## 2. Az egyetemes szabály

> **Egy adat = egy tárolt érték. A nyelvet a JELÖLŐ választja, sosem az adat.**

### 2.1 A jelölő végződése az egyetlen nyelvkapcsoló

| Végződés | Nyelv |
|---|---|
| *(semmi)* | magyar |
| `_hu`, `_hun` | magyar |
| `_en`, `_eng` | angol |

Kis/nagybetűre és az elválasztóra (`_`, `-`, `.`, szóköz) érzéketlen, és a
gépi kulcsra, a magyar címkére és a jelölő-aliasokra egyaránt ráilleszthető.
A dátum-részek (`_year` / `_év`, `_month` / `_hónap`, `_day` / `_nap`) ezután
következnek, tehát a `{{pp_validity_ev_EN}}` féle kombináció is felismerhető.

*Kód:* `js/schema/schema-store.js` → `resolveTag()`, `LANG_RE`, `PART_RE`.

### 2.2 A fordítás forrása a MEZŐ TÍPUSÁTÓL függ

Ez a rész hiányzott, és jogosan — sehol nincs kiírva:

| Mezőtípus | Mi fordít | Hol szerkeszted |
|---|---|---|
| `enum` (választható) | a mező **saját értéklistája** (`id` / `hu` / `en`) | Beállítások → Séma → az adott mező |
| `text` (szabad szöveg) | a **globális szótár** | Beállítások → Szótár |
| `computed` (számított) | a forrásmezők a saját szabályuk szerint, a kimenet a szótáron megy át | mindkettő |
| `date`, `number` | semmi, csak formázás | — |

**Ebből következik a gyakorlati döntés:** ha a tartózkodási cél egy zárt,
véges lista (EU Kék Kártya / Vendégmunkás / Családegyesítés / …), akkor
**enumnak** való, és akkor a szótárba felvenni HIÁBA — az enum sosem nézi a
szótárat. Ha szabad szöveg marad, akkor a szótár a helye. Ma `text`
(`js/schema/seed-schema.js:353`), tehát **a szótár a jó hely**.

### 2.3 A szótár PÁR, nem irány

```js
// js/schema/schema-store.js → translate()
if (normalize(e.en) === needle || normalize(e.hu) === needle) {
  return lang === 'en' ? e.en : e.hu;
}
```

A keresés **mindkét oldalon** illeszkedik, a visszaadott oldalt a kért nyelv
dönti el. Vagyis **teljesen mindegy, melyik nyelven van az adat a
nyilvántartásban** — az `EU Blue Card = EU Kék Kártya` pár mindkét irányban
működik.

**De a két oldal SORRENDJE nagyon is számít.** A szerkesztő sorolvasója
(`settings-view.js` → `parseDictionary`) pusztán pozíció szerint oszt:

```js
const m = /^([^=\t;]+)[=\t;](.*)$/.exec(sor);
const en = m[1].trim();   // ← BAL oldal = ANGOL
const hu = m[2].trim();   // ← JOBB oldal = MAGYAR
```

**Nyelvfelismerés sehol nincs a kódban.** Az `en` / `hu` címke annyit jelent,
hogy „első oszlop" és „második oszlop". Fordítva felvéve a pár továbbra is
illeszkedik (a keresés kétirányú), csak a két kimenet felcserélődik — lásd G8.

Ez nem véletlen, hanem szükséges: a séma mezői **vegyesen** várnak magyar és
angol bevitelt (`citizenship` hint: „written in HUNGARIAN";
`place_of_birth_country` hint: „English is fine"). Egyirányú szótárral a fele
mező nem működne.

### 2.4 A teljes feloldási lánc

```
{{residence_purpose_en}}
   └─ resolveTag()          teljes név mező? nem → dátum-rész? nem
                            → nyelv-utótag: "_en" → lang='en', raw='residence_purpose'
                            → findField('residence_purpose') ✓
   └─ renderValue(f, "EU Kék Kártya", 'en')
        f.type === 'text'   → translate("EU Kék Kártya", 'en')
                            → a párt a HU oldalon találja → visszaadja az EN oldalt
   └─ "EU Blue Card"
```

Ha `resolveTag` `null`-t ad (a séma nem ismeri a jelölőt), a `docx-service`
visszaesik sima kulcskeresésre a `buildRenderRow` sorában — így működnek a
séma-független jelölők, pl. `{{mai nap}}`.

### 2.5 A szótár NEM a mezőhöz kötődik, hanem az ÉRTÉKHEZ

A leggyakoribb félreértés, hogy a szótárban valahol meg kellene nevezni, melyik
mezőre vagy melyik jelölőre vonatkozik a pár. **Nem kell, és nem is lehet** —
két, egymástól független illesztés van:

| # | Mit köt össze | Mi a kulcs | Hol |
|---|---|---|---|
| 1 | jelölő → **mező** + nyelv | a jelölő **neve** (kulcs / magyar címke / angol címke / alias) + a végződés | `resolveTag()` |
| 2 | tárolt érték → **szótári pár** | maga az **érték szövege**, normalizálva | `translate()` |

A `translate()` lineárisan végigfut az ÖSSZES páron, és a mezőről semmit nem
tud — csak a szöveget kapja. Igazolva: ugyanaz az egy pár három különböző
mezőn (`residence_purpose`, `position`, `hr_dual_citizenship`), ugyanazzal az
értékkel → mindhárom `"EU Blue Card"`-ot adott.

> **A helyes gondolati kép:** a szótár nem „mező → fordítás" tábla, hanem
> **szópárok szójegyzéke**. Kétnyelvű szólista, nem konfiguráció. Ezért hat
> minden szabad szöveges mezőre egyszerre (ennek az árnyoldala a G6).

**Az illesztés normalizál** (`ValueCodec.normalize`: ékezet le, kisbetű,
elválasztók összevonva), tehát a nyilvántartásban nem kell betűre egyeznie:

| DB-ben | Talál? |
|---|---|
| `EU Kék Kártya` / `eu kek kartya` / `EU-KÉK-KÁRTYA` | ✓ mind ugyanaz |
| `EU Kékkártya` (egybeírva) | ✗ **más szó** — némán, változatlanul megy tovább |

---

## 3. Amit a felmérés talált — igazolt hiányosságok

Mindegyik futtatott próbával igazolva, nem olvasásból következtetve.

| # | Hiba | Bizonyíték | Súly |
|---|---|---|---|
| **G1** | A dokumentáció rossz modellt tanít: „`_eng` = ahogy a táblázatban érkezett". Valójában a szótár angol oldalát adja, iránytól függetlenül. | `README.md:107`, `js/modules/settings/settings-view.js:66` | **magas** — ez okozta a kérdést |
| **G2** | Hiányzó szótári párnál **néma** visszaesés: magyar szöveg kerül az angol rovatba, és sehol nem látszik. A Hiányzó-adat napló csak az ÜRES jelölőket gyűjti. | `{{position_en}}` a „darukezelő" értékkel → `"darukezelő"`; `js/modules/docgen/missing-log.js` | **magas** |
| **G3** | Magyar oldali ütközésnél „első nyer", figyelmeztetés nélkül. A seed maga is ütközik. | seedben `airplane=repülő` ÉS `plane=repülő`; `translate('repülő','en')` → `"airplane"`; `validateSchema()` erre **0 hibát** ad | **közepes** |
| **G4** | Angol fordítás nélküli enum-értéknél a **gépi azonosító** kerül a dokumentumba. A szótár ezt NEM menti meg. | `en` nélküli `eu_blue_card` érték → `{{permit_type_en}}` = `"eu_blue_card"`, szótári párral is | **magas** |
| **G5** | Az **angol címke** jelölőként MAGYAR értéket ad. | `{{Purpose of Residence}}` → `"EU Kék Kártya"` (a közvetlen mezőtalálat mindig `lang='hu'`) | **közepes** |
| **G6** | A szótár **globális, mezőfüggetlen**: minden szabad szöveges mezőre hat. | `position="car"` → `"autó"`; `locality="Brazil"` → `"Brazília"` | **alacsony**, de valós |
| **G7** | `validateSchema()` a szótárat **egyáltalán nem** nézi. | ütköző seeden is 0 hibát ad | **közepes** |
| **G8** | **Fordítva felvitt pár némán felcseréli a két kimenetet.** Nincs nyelvfelismerés, csak pozíció; a pár továbbra is illeszkedik, csak rossz oldalt ad. | `EU Kék Kártya = EU Blue Card` beírva: `{{residence_purpose}}` → `"EU Blue Card"`, `{{residence_purpose_en}}` → `"EU Kék Kártya"` | **magas** — a legkönnyebben elrontható lépés |
| **G9** | A felület egyetlen ponton sem mondja ki: (a) hogy a szótár GLOBÁLIS és az ÉRTÉKRE illeszkedik, nem mezőre; (b) hogy balra angol, jobbra magyar; (c) hogy melyik mezőtípusnál mi fordít. A séma-lap a kulcsot mutatja, de a **kész jelölőt** (`{{x}}` / `{{x_en}}`) soha. | `renderFieldRow()` = címke + kulcs + típus + részlet; a README:144 viszont azt állítja, hogy „a jelölő a Beállítások → Séma fülön látszik" | **magas** — ez a kérdés forrása |

---

## 4. A terv

Sorrend = megtérülés. Az 1. lépés önmagában megoldja a feltett kérdést.

### 1. lépés — A dokumentáció a valóságot írja  *(G1, G5)*

**Változás:** `README.md` „Szótár" szakasza és
`js/modules/settings/settings-view.js` súgószövege.

Amit ki kell mondani:
- a szótár **pár**, nem irány — mindegy, melyik nyelven van az adat;
- a nyelvet **csak a jelölő végződése** választja (2.1 táblázat);
- **melyik mezőtípusnál mi fordít** (2.2 táblázat) — ez a hiányzó láncszem;
- az angol címke jelölőként magyar értéket ad, ezért kétnyelvű sablonban
  **mindig a kulcs + végződés** alakot használd (`{{x}}` / `{{x_en}}`), ne a
  címkét.

**Ellenőrzés:** az 1. pont nyolcsoros táblázata legyen benne a README-ben, és
egyezzen a `test/docgen-resolve.test.js` új eseteivel (lásd 5. lépés).

**Kód:** ~40 sor dokumentáció, 0 sor logika.

---

### 1/b. lépés — A felület mondja ki, amit a doksi leír  *(G9)*

A dokumentáció nem elég: aki a Szótár lapon áll, nem a README-t olvassa. Mind
az öt tétel **ugyanabban a fájlban** van (`js/modules/settings/settings-view.js`),
egy menetben elvégezhető.

**U1 — „Globális szótár" kimondva.** A kártya súgójába, első mondatként:

> Ez a szótár **globális**: minden szabad szöveges mezőre egyszerre hat, és
> **az ÉRTÉK szövegére illeszkedik, nem mezőre.** Ezért nem kell (és nem is
> lehet) megadni benne, melyik mezőre vagy melyik jelölőre vonatkozik a pár.
> A „Serbia = Szerbia" mindenhol ugyanazt jelenti.

**U2 — Az oldalak megjelölve.** Két dolog, mert a szöveges súgót senki nem
olvassa el kétszer:

- **oszlopfelirat a beviteli mező FÖLÖTT**, balra `ANGOL`, jobbra `MAGYAR`
  (a `placeholder` szöveg nem elég: eltűnik az első leütésre);
- a súgóban: *„A szoftver nem ismeri fel a nyelvet, csak a sorrendet nézi.
  Fordítva felvéve nem hibázik — felcseréli a két kimenetet."*

**U3 — Kész, másolható jelölő minden séma-soron.** Ez a legnagyobb megtérülés:
a `renderFieldRow()` ma a kulcsot mutatja, a **jelölőt** nem, az `_en`
változatot pedig sehol nem említi. Új oszlop, kattintásra vágólapra:

```
Tartózkodás célja  residence_purpose   szöveg → szótár   {{residence_purpose}}  {{residence_purpose_en}}
```

Ezzel a sablonszerkesztés közben nem kell fejben összerakni a jelölőt — és a
mostani kérdés fel sem merült volna.

**U4 — A fordítás forrása látsszon a soron.** A meglévő „típus" oszlop mellé
egy szó (a 2.2 táblázat sűrítve):

| Típus | Kiírva |
|---|---|
| `text` | szöveg → **szótár** |
| `enum` | választható → **saját értéklista** |
| `date`, `number` | dátum / szám → nem fordul |
| `computed` | számított → forrásmezők + szótár |

Innen azonnal látszik, hogy egy enum mezőhöz **hiába** viszed fel a párt.

**U5 — Élő előnézet a szótár-szerkesztőben.** A beviteli mező alatt, gépelés
közben, soronként:

```
EU Blue Card = EU Kék Kártya
   {{mező}}      → EU Kék Kártya
   {{mező_en}}   → EU Blue Card
```

Ez erősebb minden súgószövegnél: **megmutatja** a sorrend következményét,
ahelyett hogy leírná. Logika sem kell hozzá — a két oldal maga az eredmény.

**Ellenőrzés:** üres fejjel, doksi nélkül a felületre nézve megválaszolható:
(1) melyik oldal az angol? (2) mi lesz a jelölő a tartózkodási célra magyarul
és angolul? (3) hat-e a szótár egy választható mezőre?

**Kód:** ~60 sor, egy fájlban, logika-változás nélkül.

---

### 2. lépés — Az enum ne szivárogtasson gépi azonosítót  *(G4)*

**Változás (egy sor):** `js/schema/schema-store.js` → `normalize()`

```js
// most:  en: v.en || v.id
// után:  en: v.en || v.hu || v.id
```

**Miért:** „EU Kék Kártya" egy angol nyelvű rovatban rossz, de olvasható —
`eu_blue_card` viszont hibásnak látszó gépi szemét egy hatósági iraton. A
kiindulópontod szerint ráadásul a tartózkodási célok a két nyelven **jogilag
azonosak**, tehát a magyar alak sokszor a helyes kimenet is.

Kockázat: nincs. A `findAmbiguities()` nem jelez hamisan, mert azonos
értéken belüli ismétlődést nem tekint ütközésnek.

**Ellenőrzés:** új teszteset — `en` nélküli enum-érték `_en` jelölőn a magyar
alakot adja, sosem az `id`-t.

---

### 3. lépés — A szótár is átessen az integritás-ellenőrzésen  *(G3, G7, G8)*

**Változás:** `js/schema/schema-store.js` → `validateSchema()` bővítése
(ugyanaz a csatorna, amin az enum-kétértelműségek már mennek, a szerkesztő
külön munka nélkül megjeleníti):

- ugyanaz a **magyar** alak két párban → „a(z) „repülő" két angol alakhoz is
  tartozik: airplane / plane";
- egy szöveg az egyik párban `en`, a másikban `hu` (fordítva felvitt pár) —
  ez teszi kiszámíthatatlanná a fordítást mindkét irányban;
- **fordítva felvitt pár** *(G8)*: ha az „angol" oldal magyar-specifikus betűt
  tartalmaz (`á é í ó ö ő ú ü ű`), a magyar oldal viszont nem → „a(z) „EU Kék
  Kártya = EU Blue Card" sor valószínűleg fordítva van: balra az angol alak
  kell". Heurisztika, nem bizonyíték — ezért figyelmeztetés, nem hiba. Ez a
  leggyakoribb elrontható lépés, és ma semmi nem véd ellene;
- **NEM** dobjuk el a párt, csak figyelmeztetünk. A `normalizeDictionary`
  mai néma `en`-oldali dedupját is érdemes ide átemelni.

Egyben javítandó a seed: `plane=repülő` törlése vagy `plane` felvétele az
`airplane` pár elfogadott alakjai közé.

**U6 — a figyelmeztetés látsszon is.** A Szótár kártya fejlécébe ugyanaz a
„N ellentmondás" jelzés, ami a Séma kártyán már ott van (`sv-problems` minta,
`title`-ben a teljes lista). A csatorna kész, csak rá kell kötni.

**Ellenőrzés:** ütköző szótárral `validateSchema()` legalább 1 hibát ad, és a
szám megjelenik a kártya fejlécében; a seed sémán továbbra is 0.

**Kód:** ~20 sor + 3 sor UI.

---

### 4. lépés — A hiányzó fordítás legyen látható  *(G2)*

**Változás:** `js/modules/docgen.js` → `makeSchemaResolver()` + a meglévő
Hiányzó-adat napló bővítése.

Amikor egy `_en`/`_eng` jelölő **szabad szöveges** mezőre néz, az érték nem
üres, de a szótárban nincs pár → a jelölő kerüljön a napló egy új
„fordítatlan" rovatába (az „üres" mellé, nem helyette).

Így a mai néma hiba utólag kideríthető: „Kovács Anna / 06-tartózkodási-engedély
/ fordítatlan: `position_en`, `residence_purpose_en`".

Ez a legkisebb elegendő megoldás, mert a már meglévő napló-felületet
használja. A nagyobb, proaktív változat (Beállítások lapon egy „szótári
hiányok" gomb, ami az összes rekord összes szabad szöveges mezőjét
végigszkenneli) csak akkor jöjjön, ha ez kevésnek bizonyul.

**Ellenőrzés:** szótári pár nélküli értéknél a napló bejegyzést kap; párral
nem kap.

**Kód:** ~15 sor.

---

### 5. lépés — Regressziós tesztek  *(a fentiek zárása)*

`test/docgen-resolve.test.js` új szakasz: „Szótár mindkét irányban".

- magyarul tárolt érték: `{{x}}` = HU, `{{x_en}}` = EN *(a te eseted)*
- angolul tárolt érték: `{{x}}` = HU, `{{x_en}}` = EN
- nincs szótári pár: mindkét jelölő az eredetit adja
- `_hu`, `_hun`, `_en`, `_eng` és a magyar címke + `_EN` mind egyezik
- enum `en` nélkül → magyar alak, sosem `id`
- ütköző szótár → `validateSchema()` jelez
- fordítva felvitt pár → `validateSchema()` figyelmeztet *(G8)*
- normalizálás: `eu kek kartya` és `EU-KÉK-KÁRTYA` ugyanarra a párra talál

**Ellenőrzés:** `node test/run-all.js` zöld.

---

### 6. lépés — „Mi hiányzik a szótárból?" gomb  *(G2, hatásfok)*

Ez a legnagyobb **napi** megtakarítás, és a 4. lépés proaktív párja: ott
generálás UTÁN derül ki a hiány, itt ELŐTTE.

Beállítások → Szótár, új gomb: **„Hiányzó párok keresése"**. Végigmegy az
összes rekord összes **szabad szöveges** mezőjén, és kigyűjti azokat az
értékeket, amikhez nincs szótári pár — **mezőnként csoportosítva**,
előfordulás szerint csökkenő sorrendben, már beilleszthető alakban:

```
# Munkakör (position) — 3 érték
darukezelő = 
targoncavezető = 
minőségellenőr = 

# Tartózkodás célja (residence_purpose) — 1 érték
Családegyesítés = 
```

Így egy ülésben feltölthető a szójegyzék, ahelyett hogy dokumentumonként
egyesével derülne ki a hiány.

**A mezőnkénti csoportosítás nem díszítés, hanem a zajszűrő:** a szkennelés a
személyneveket, utcaneveket és irányítószámokat is „hiányzó fordításnak"
látná, mert azok is `text` mezők. Csoportosítva a `locality` blokkot egy
pillanat átugrani, a `position` blokkot meg végigcsinálni — mezőnkénti
konfiguráció (és új sémafogalom) nélkül.

**Ellenőrzés:** szótári pár nélküli értékkel a lista tartalmazza az értéket a
helyes mezőblokkban; a pár felvitele után eltűnik onnan.

**Kód:** ~30 sor, új adatszerkezet nélkül (`EmployeeRepo.all()` +
`SchemaStore.fields()` + `SchemaStore.translate()`).

---

## 5. Eldöntendő — nem javasolt most megcsinálni

**Az angol címke adjon angol értéket?** *(G5)*
`resolveTag()` közvetlen mezőtalálatnál mindig `lang='hu'`-t ad. Kb. 3 sorból
átírható úgy, hogy a `label.en`-re illeszkedő találat `lang='en'`-t adjon.

**Javaslat: most ne.** Viselkedésváltozás, ami a már kiadott sablonokat
érintheti — aki eddig az angol címkét írta ki magyar értékért, annak elromlik.
Előbb az 1. lépés dokumentálja a szabályt („kétnyelvű sablonban kulcs +
végződés"), és csak akkor nyúljunk hozzá, ha a gyakorlatban tényleg megzavar
valakit. Ha mégis: a `test/formanyomtatvany-check.js` és a hat
`test/fixtures/sablonok/*.docx` kimutatja a regressziót.

---

## 6. Amit szándékosan NEM építünk

| Ötlet | Miért nem |
|---|---|
| `{{x_raw}}` — a nyers tárolt érték | Nincs rá valós igény. A HU és az EN alak együtt lefedi a dokumentumokat. |
| Mezőre szűkíthető szótári pár (`fields: [...]`) *(G6)* | Új mechanizmus egy olyan ütközésre, ami még nem fordult elő. **Ismert plafon:** ha egy szótári pár egy szót elront egy másik mezőben (`position="car"` → `"autó"`), a felvezető út egy opcionális harmadik oszlop a párban. Addig a `validateSchema` figyelmeztetései elegendők. |
| Harmadik nyelv | Az iratok kétnyelvűek, a `LANG_RE` kétnyelvűre van szabva. Amíg nincs harmadik nyelvű hatósági űrlap, felesleges. |
| Külön szótár mezőnként | Ugyanaz, mint fent, csak drágábban: az ország- és munkakör-nevek 90%-a tényleg globális. |
| Automata gépi fordítás | Az app hálózat nélkül, izolált gépen fut (`TERV-adatbiztonsag.md`). |
| Táblázatos szótár-szerkesztő a beviteli mező helyett | A mostani szövegdoboz szuperképessége, hogy **két Excel-oszlop közvetlenül beilleszthető**. Egy kétoszlopos táblázat-szerkesztő ezt elveszítené — rosszabb lenne, nem jobb. |
| Ábécé-rendezés mentéskor | Szétverné a felhasználó saját csoportosítását. **Trigger:** ha a szótár 100 pár fölé nő és keresni kell benne. |
| `#` kezdetű megjegyzés-sorok a szótárban | 2 sor a `parseDictionary`-ben, de ma 12 pár van. **Trigger:** ha a 6. lépés egyszerre 50+ párat önt a szerkesztőbe — akkor a tagolás értékesebb lesz, mint amennyibe kerül. |

---

## 7. Amit MOST tehetsz, kódmódosítás nélkül

1. **Beállítások → Szótár**, új sor: `EU Blue Card = EU Kék Kártya`
   — **balra az ANGOL, jobbra a MAGYAR.** Fordítva felvéve nem hibázik, csak
   felcseréli a két kimenetet (G8). A mezőt nem kell megneveznie: a pár az
   ÉRTÉK szövegére illeszkedik, nem mezőre (2.5).
2. A sablonban: `{{residence_purpose}}` a magyar rovatba,
   `{{residence_purpose_en}}` az angolba.
3. Ha a tartózkodási cél valójában **zárt lista**, érdemesebb enummá tenni
   (Beállítások → Séma), és az angol alakot az értéklistába írni — akkor a
   `{{CHECK:Tartózkodás célja=eu_blue_card}}` alakú jelölőnégyzetek is
   működnek a hatósági űrlapokon. A 2. lépés ehhez ad védőhálót.

## 8. Érintett fájlok

| Fájl | Szerep |
|---|---|
| `js/schema/schema-store.js` | `resolveTag`, `renderTag`, `renderValue`, `translate`, `normalizeDictionary`, `validateSchema` — **a szótár teljes logikája itt van** |
| `js/schema/value-codec.js` | enum-értékek fordítása (`render`), normalizálás, `findAmbiguities` |
| `js/schema/seed-schema.js` | a kiinduló szótár (`dictionary:`, 30–49. sor) és a mezők típusa |
| `js/modules/settings/settings-view.js` | a szótár szerkesztője és súgója, `renderFieldRow` — **az 1/b. és a 6. lépés teljes egészében itt van** |
| `js/modules/docgen.js` | `makeSchemaResolver` / `makeSchemaMatcher` — a sablon és a séma találkozása |
| `js/services/docx-service.js` | `makeParser` — a jelölő feloldása, visszaesés sima kulcskeresésre |
| `test/docgen-resolve.test.js` | a réteg tesztjei |
