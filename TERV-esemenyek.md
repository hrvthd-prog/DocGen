# Ügykövetés és státusz-betekintő — terv

> **Állapot: az 1–5. fázis elkészült, a 6–7. hátravan.**
>
> | # | Fázis | Állapot |
> |---|---|---|
> | 1 | Ügytípusok mint adat | ✅ `js/schema/case-types.js` |
> | 2 | Adatmodell | ✅ `js/services/case-repo.js` |
> | 3 | Idővonal | ✅ `js/modules/cases/case-timeline.js` |
> | 4 | Ügyek fül | ✅ `js/modules/cases/cases-view.js` |
> | 5 | Azonosító-kötés | ✅ lezáráskor, a lejárattal együtt |
> | 6 | **Státusz-HTML** | ⬜ hátravan |
> | 7 | **Dokumentum-kötés** | ⬜ hátravan |
>
> **Három alapfeltevés dőlt meg menet közben.** A szöveg ezeket **JAVÍTVA**
> jelöléssel mondja el, mert a tévedés indoklása többet ér, mint egy utólag
> simára írt terv.
>
> Megvalósult, de a tervben nem szerepelt: visszamenőleges rögzítés
> (történés vs. rögzítés napja), ügy-láncolás a következő ciklusra, és a
> lejárt ügyek jelzője a fül címkéjén.

## 1. A probléma

A nyilvántartás ma **egy pillanatképet** tárol: milyen most a dolgozó adata.
De az idegenrendészeti ügyintézés nem állapot, hanem **folyamat**:

- a kérelmek egymás után következnek (első engedély → meghosszabbítás → …),
  és minden megszerzett engedély új azonosítót hoz
- nem csak kérelmek vannak: ki- és bejelentések, szálláshely-változás bejelentése,
  munkáltatói igazolások, határidők
- ma mindezt fejben vagy külön táblázatban kell követni

Ez ugyanaz a mintázat, amit az azonosítóknál már megoldottunk: **nem az aktuális
érték az érték, hanem a történet**. Ezért a megoldás is ugyanaz az elv legyen.

A második, a felhasználó szerint fontosabb rész: a **feljebbvalók és munkatársak**
lássák, mi hol tart — anélkül, hogy hozzáférnének a teljes nyilvántartáshoz.

## 2. Fogalmak

Két fogalom elég, többet ne vezessünk be:

| Fogalom | Mi ez | Példa |
|---|---|---|
| **Ügy** | Egy elintézendő folyamat, aminek státusza és határideje van | Tartózkodási engedély meghosszabbítása |
| **Esemény** | Egy megtörtént lépés az ügyön belül, időbélyeggel | „Beadva 2026-08-12", „Hiánypótlás érkezett" |

A „teendő" nem külön fogalom: **a nyitott ügy maga a teendő**. Egy külön
feladatlista ugyanazt az adatot duplikálná, és a kettő azonnal elcsúszna egymástól.

## 3. Adatmodell

```
case {
  id            ← belső UUID
  employeeId    ← melyik dolgozóhoz tartozik
  type          ← ügytípus kulcsa (adat, lásd 4.)
  status        ← az ügytípus által megengedett státuszok egyike
  ehNumber      ← EH szám
  fileNumber    ← iktatószám
  openedAt      ← mikor indult
  triggerDate   ← a határidő kezdő napja – KÉZZEL rögzítve (OIF-érkeztetés
                  vagy a tény napja). Enélkül nincs határidő.
  dueAt         ← határidő; a triggerDate-ből számol, de felülírható
  closedAt      ← a lezárás napja (a döntés napja, nem a rögzítésé)
  outcome       ← megadva | elutasitva | megszuntetve | elutasitva_ervn
                  | visszavonva | null
  producedId    ← ha az ügy azonosítót hozott: { type, value, expiresAt }
  events[]      ← { at, occurredAt, status, outcome, note, user,
                    ehNumber, fileNumber }
  createdAt / updatedAt / updatedBy
}
```

Az `events[]` a **teljes állapotváltozás-történet**. Ebből visszakereshető, mikor
mi történt, és ki rögzítette — ez hatósági ügyintézésnél nem luxus.

> **JAVÍTVA — két időpont kell, nem egy.** Eredetileg csak `at` volt: a
> rögzítés pillanata. Csakhogy a valóságban napokkal később visszük fel, hogy
> „múlt kedden megjött a hiánypótlási felhívás" — így az idővonal a **gépelés**
> sorrendjét mutatta volna a történések helyett, vagyis pont azt nem tudta
> volna, amiért az egészet építjük.
>
> - **`at`** — mikor rögzítettük. **Audit-nyom, sosem írjuk felül.**
> - **`occurredAt`** — mikor történt. Ezt adja meg a felhasználó, és az
>   idővonal e szerint rendez.
>
> Az utólag felvitt bejegyzések az idővonalon kiírják a rögzítés napját is.
> Meglévő bejegyzés dátuma és megjegyzése javítható (`updateEvent`), a rögzítés
> ideje és a rögzítő nem.
>
> **Kimenetelek:** a terv háromról tudott. A valóságban öt van, és a
> „megszüntetve" meg az „elutasítva **érdemi vizsgálat nélkül**" nem
> keverhető össze: az utóbbi formai bukás, általában ismételten benyújtható.
> Lezáráshoz kötelező megadni — enélkül maradnának „lezárva, de senki nem
> tudja, mi lett" ügyek.

**Tárolás:** `data/docgen-cases.json`, ugyanazzal a repository-mintával és
biztonsági mentéssel, mint az `employee-repo`. Külön fájlban, nem a dolgozó
rekordjában — így egy dolgozó adatlapja nem hízik korlátlanul, és az ügyek
önállóan is listázhatók.

## 4. Ügytípusok — adatként, nem kódban

Ugyanaz az elv, mint a sémánál: a típusokat **nem kódba drótozzuk**.

```json
{
  "key": "rp_hosszabbitas",
  "label": { "hu": "Tartózkodási engedély meghosszabbítása", "en": "…" },
  "statuses": [
    { "key": "elokeszites", "label": "Előkészítés" },
    { "key": "beadva",      "label": "Beadva" },
    { "key": "hianypotlas", "label": "Hiánypótlás", "alert": true },
    { "key": "elbiralas",   "label": "Elbírálás alatt" },
    { "key": "lezarva",     "label": "Lezárva", "terminal": true }
  ],
  "triggerLabel": "OIF érkeztetés napja (iktatószám megkapása)",
  "defaultDurationDays": 70,
  "deadlineKind": "hatosagi",
  "submissionWindow": { "field": "expiration_of_rp",
                        "earliestDays": -90, "latestDays": -40, "finalDays": -10 },
  "producesIdentifier": "residence_permit",
  "templates": ["Meghosszabbítási kérelem.docx", "Munkáltatói igazolás.docx"]
}
```

Amit ez egy definícióval megold:

1. **Státuszok és sorrendjük** — a UI ebből építi a léptető gombokat
2. **Határidő** — `defaultDurationDays` a `triggerLabel` szerinti naptól
3. **Benyújtási ablak** — a dolgozó adataiból számítva (lásd lentebb)
4. **Kapcsolat az azonosítókkal** — `producesIdentifier` (lásd 5.)
5. **Kapcsolat a dokumentumgenerálással** — `templates`: az ügy megnyitásakor
   egy kattintással generálható a hozzá tartozó iratcsomag *(7. fázis, hátravan)*
6. **Figyelmeztetés** — az `alert: true` státusz kiemelten jelenik meg

**Kiinduló típusok** (seed adatként, szerkeszthetően): tartózkodási engedély
igénylés / meghosszabbítás / letelepedés, szálláshely-változás bejelentése,
munkaviszony be- és kijelentése, adatváltozás bejelentése.

### JAVÍTVA — a határidőkről szinte minden feltevésem hibás volt

**(a) A `dueFrom` (lejárat − 30 nap) kikerült.** Két különböző dolgot mostam
össze benne: azt, hogy *mikor kell beadnunk*, és azt, hogy *mikor kell a
hatóságnak döntenie*. Ez a kettő független:

| | Honnan fut | Mennyi |
|---|---|---|
| Ügyintézési határidő | OIF-érkeztetés napja | 70 nap |
| Benyújtási ablak | a meglévő engedély lejárata | −90 / −40 / −10 nap |

**(b) A 70 nap nem az ügy megnyitásától fut**, hanem az OIF általi érkeztetés
napjától — amikor az iktatószám megérkezik. A határidő az érkeztetést *követő*
naptól indul, ezért a hetvenedik nap pontosan az érkeztetés + 70.

**(c) Egyetlen határidőt sem tud a program magától.** Sem azt, mikor
érkeztették a kérelmet, sem azt, mikor költözött a dolgozó. Ebből az
következik, hogy **kezdő dátum nélkül nincs határidő** — és ez nem hiányosság.
A korábbi kódom ilyenkor visszaesett a megnyitás + N napra, vagyis **kitalált
egy határidőt, aminek semmi köze nem volt a valósághoz**. Kitalált határidő
rosszabb, mint a hiányzó.

Ezért van kétféle megbízhatóság (`deadlineKind`):

- **`hatosagi`** — dokumentált naptól fut (az érkeztetés iktatószámmal
  igazolható). Erre lehet hivatkozni.
- **`tajekoztato`** — olyan tényből, amit sem a program, sem irat nem igazol
  (mikor költözött a dolgozó). A felület ezért **nem állíthatja, hogy mulasztás
  történt**, csak azt, hogy „a megadott nap szerint" mennyi van hátra.

**A valós határidők** (megerősítve):

| Ügy | Határidő | Mitől fut |
|---|---|---|
| Kérelmek | 70 nap | OIF-érkeztetés |
| Szálláshely-változás | 3 nap | költözés napja |
| Munkaviszony megkezdése / megszűnése | 5 nap | a tény napja |
| Adatváltozás | 5 nap | *(nincs jogszabállyal megerősítve)* |

### Benyújtási ablak — az egyetlen számítható határidő

A meglévő engedély érvényessége a nyilvántartásban van, ezért ez az egy dolog
kiszámolható. Négy szakasz: **korai** (−90 előtt) · **ideális** (−90…−40) ·
**siess** (−40…−10) · **lekésve** (−10 után).

## 5. Kapcsolat az azonosító-történettel

Itt zárul be a kör a meglévő modellel. Ha egy `producesIdentifier`-t deklaráló
ügy sikeresen lezárul:

1. az app rákérdez az új azonosító számára **és a lejáratára**
2. `EmployeeRepo.addIdentifier()` — az új lesz az aktuális, **a régi lezárul**
3. az ügy `producedId` mezője megőrzi, melyik ügy hozta

> **JAVÍTVA — a lejáratot is kérni kell.** Eredetileg csak a számot kértük.
> Csakhogy a következő meghosszabbítás benyújtási ablaka az engedély
> lejáratából számol: ha az nem frissül, a **régi, már lejárt** dátumból
> számolna, és azonnal „lekésve" állapotot mutatna. Csendben rossz adatot.
> A lejárat ezért a dolgozó `expiration_of_rp` mezőjébe is bekerül
> (`EXPIRY_FIELD_MAP`).
>
> **Ügy-láncolás** (a tervben nem szerepelt): a meghosszabbítás nem egyszeri
> esemény, hanem ciklus. Amint megvan az új lejárat, azonnal tudható, mikor
> nyílik a következő ablak — egy kattintással előjegyezhető. Az új ügy
> `openedAt`-je az ablak nyitónapja, nem a mai: az ügy valójában akkor kezdődik.

Így utólag megválaszolható: *„ez az engedélyszám melyik kérelemből származik?"* —
ma ez sehol nincs rögzítve.

## 6. Felület a nyilvántartásban

**A dolgozó adatlapján: idővonal.** Az ügyek fordított időrendben, a nyitottak
kiemelve, státusszal és határidővel. Egy ügy kinyitva mutatja az eseményeit.
Új esemény rögzítése két kattintás (státusz + opcionális megjegyzés).

**Új fül: Ügyek.** Az összes dolgozó összes ügye egy listában, szűrhetően:
- **Lejárt** (piros) — a határidő elmúlt, az ügy nyitott
- **Sürgős** (borostyán) — 14 napon belül jár le
- **Nyitott** / **Lezárt**

A lista alapértelmezett rendezése a határidő. A cél, hogy reggel megnyitva
azonnal látszódjon, mi ég.

**Automatikus felvetés:** ha egy dolgozó engedélye 30 napon belül lejár és nincs
hozzá nyitott meghosszabbítási ügy, a lista tetején felajánlja a megnyitást.
Nem hoz létre magától semmit — javasol.

## 7. A státusz-betekintő HTML

Ez a rész igényli a legtöbb odafigyelést, mert **adat hagyja el a programot**.

### Miért külön, generált fájl

Szerver nincs és nem is lesz. Három út merül fel, ebből egy járható:

| Megoldás | Miért nem / miért igen |
|---|---|
| A HTML olvassa a JSON-t `file://`-ről | ✗ a böngésző CORS-ból tiltja, működésképtelen |
| A néző maga választja ki a mappát | ✗ a főnöknek mappát kelljen kijelölnie – nem fog |
| **Önálló HTML, beágyazott adattal** | ✓ egy fájl, dupla kattintás, bárhol megnyílik |

Tehát: a DocGen **legenerál egy `statusz.html`-t**, amiben az adat egy
`<script>` blokkban ül. Hálózati meghajtóra tehető vagy elküldhető.

**Ez pillanatkép, nem élő nézet.** A fájl fejlécében nagy betűkkel ott a
készítés időpontja, hogy senki ne higgye frissnek. Ez a módszer ára, és
őszintébb elhallgatni.

### Mit tartalmaz — és mit nem

A megosztott fájl **nem a nyilvántartás másolata**. Külön **megosztási profil**
dönti el, mely mezők kerülhetnek bele — ugyanúgy adat, mint az export profil.

Alapértelmezés (szándékosan szűk):

| Kimegy | NEM megy ki |
|---|---|
| Név | Útlevélszám, TAJ, adóazonosító |
| Ügy típusa | Anyja neve, születési adatok |
| Státusz | Bér |
| Határidő, késés | Lakcím, telefonszám, e-mail |
| Utolsó frissítés | Bármi, amit nem engedélyeztél |

**Védőkorlátok, mert ez itt nem elmélet:**

- Export előtt **előnézet**: pontosan az látszik, ami ki fog menni
- Ha a profilba érzékeny mező kerül, az app **figyelmeztet és külön megerősítést kér**
- A generált fájl fejléce jelzi, hogy személyes adatot tartalmaz és hol tárolható

### Opció: jelszavas titkosítás

A fájl neveket és idegenrendészeti státuszokat tartalmaz — ez GDPR szempontból
érzékeny kör, és egy hálózati meghajtón könnyen szélesebb körhöz jut, mint
szeretnéd.

A böngésző beépített WebCrypto API-jával a tartalom **jelszóval titkosítható**
(AES-GCM), külső könyvtár nélkül. Megnyitáskor a fájl jelszót kér. Nem
alapértelmezés — akkor kapcsold be, ha a fájl nem védett helyre kerül.

### Megjelenés

Egyetlen táblázat, kereséssel és szűréssel, késés szerint színezve. Nyomtatható.
Nincs benne szerkesztés, nincs benne link a nyilvántartásra. Mobilon is olvasható.

## 8. Fázisok

| # | Fázis | Kimenet | Állapot |
|---|---|---|---|
| 1 | Ügytípusok mint adat | `case-types.js`, seed típusok | ✅ |
| 2 | Adatmodell | `case-repo.js` + mentés + biztonsági másolat | ✅ |
| 3 | Idővonal | `case-timeline.js` – események + mérföldkövek | ✅ |
| 4 | Ügyek fül | szűrhető lista, benyújtási sáv, fül-jelző | ✅ |
| 5 | Azonosító-kötés | lezáráskor új azonosító **+ lejárat + láncolás** | ✅ |
| 6 | Státusz-HTML | `statusz.html` + megosztási profil + előnézet | ⬜ |
| 7 | Dokumentum-kötés | ügytípus → sablonok, egykattintásos generálás | ⬜ |

**Ami a tervhez képest többletként elkészült:**

- **Visszamenőleges rögzítés** — a történés napja külön a rögzítésétől (3. pont)
- **Ügy-láncolás** — a lezárt meghosszabbítás után a következő ciklus
  előjegyzése egy kattintással (5. pont)
- **Fül-jelző** — a lejárt ügyek száma piros pöttyben. Csak a lejártak kapnak
  jelzést: ha minden szám ott lenne, pár nap alatt megszoknánk, és a jelzés
  semmit nem jelentene.

**Ami nyitva maradt** (a felvetéseim közül, amit még nem kértél):
a hiánypótlás **felfüggeszti** az eljárást — a 70 nap nem telik közben.
Az idővonal ezt ma nem tudja, tehát a valóságnál korábbi határidőt mutat.
Az `occurredAt` bevezetése óta ez könnyebb: a felfüggesztett napok
számításához a felhívás és a pótlás napja kell, és mindkettő rögzíthető.

**Tesztlefedettség:** `test/cases.test.js` — 58 teszt (határidők, kimenetelek,
EH szám és iktatószám, azonosító-kötés, idővonal, visszamenőleges rögzítés,
láncolás, napi összefoglaló).

## 9. Nyitott kérdések

**Megválaszolva:**

1. ~~Milyen ügytípusok vannak, és mik a valós határidőik?~~ → Kérelmek 70 nap
   az OIF-érkeztetéstől; szálláshely-változás 3 nap a költözéstől; munkaviszony
   be- és kijelentés 5 nap a ténytől. A benyújtási ablak −90 / −40 / −10 nap
   az engedély lejáratához képest.

**Még nyitott:**

2. **Az `adatvaltozas` határideje** — a seedben 5 nap, de ez az egyetlen, amit
   nem erősítettél meg. A Beállításokban átírható.
3. **Ki állítja be a státuszt?** Egyfelhasználós marad, vagy több ügyintéző?
   Ez dönti el, kell-e zárolás. A „ki rögzítette" már most minden bejegyzésen
   ott van.
4. **Hova kerül a `statusz.html`?** Ez dönti el, kell-e jelszavas titkosítás
   (WebCrypto, külső könyvtár nélkül megoldható).
5. **Kell-e csatolmány-nyilvántartás** (melyik irat mikor ment be)? Ha igen, az
   csak fájlnév-hivatkozás legyen, nem maga a fájl — az adatbázist felfújná.
