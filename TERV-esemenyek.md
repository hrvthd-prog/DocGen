# Ügykövetés és státusz-betekintő — terv

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
  openedAt      ← mikor indult
  dueAt         ← határidő (számítható is, lásd 4.)
  closedAt      ← lezárás ideje (null, amíg nyitott)
  outcome       ← 'megadva' | 'elutasítva' | 'visszavonva' | null
  producedId    ← ha az ügy új azonosítót hozott: { type, value } (lásd 5.)
  events[]      ← { at, status, note, user }
  createdAt / updatedAt / updatedBy
}
```

Az `events[]` a **teljes állapotváltozás-történet**. Ebből visszakereshető, mikor
mi történt, és ki rögzítette — ez hatósági ügyintézésnél nem luxus.

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
  "dueFrom":   { "field": "expiration_of_rp", "offsetDays": -30 },
  "producesIdentifier": "residence_permit",
  "templates": ["Meghosszabbítási kérelem.docx", "Munkáltatói igazolás.docx"]
}
```

Amit ez egy definícióval megold:

1. **Státuszok és sorrendjük** — a UI ebből építi a léptető gombokat
2. **Határidő automatikusan** — `dueFrom` a dolgozó egy mezőjéből számol
   (engedély lejárata mínusz 30 nap), tehát nem kézzel kell beírni
3. **Kapcsolat az azonosítókkal** — `producesIdentifier` (lásd 5.)
4. **Kapcsolat a dokumentumgenerálással** — `templates`: az ügy megnyitásakor
   egy kattintással generálható a hozzá tartozó iratcsomag
5. **Figyelmeztetés** — az `alert: true` státusz kiemelten jelenik meg

**Kiinduló típusok** (seed adatként, szerkeszthetően): tartózkodási engedély
igénylés / meghosszabbítás, szálláshely-változás bejelentése, munkaviszony
bejelentése, munkaviszony kijelentése, adatváltozás bejelentése.

A pontos listát és a valós határidőket **veled kell véglegesíteni** — ezeket
nem találom ki helyesen a kódból.

## 5. Kapcsolat az azonosító-történettel

Itt zárul be a kör a meglévő modellel. Ha egy `producesIdentifier`-t deklaráló
ügy sikeresen lezárul:

1. az app rákérdez az új azonosító számára
2. `EmployeeRepo.addIdentifier()` — az új lesz az aktuális, **a régi lezárul**
3. az ügy `producedId` mezője megőrzi, melyik ügy hozta

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

| # | Fázis | Kimenet | Ellenőrzés |
|---|---|---|---|
| 1 | Ügytípusok mint adat | seed típusok, szerkesztő a Beállításokban | a típus szerkesztése után a UI követi |
| 2 | Adatmodell | `case-repo.js` + mentés + biztonsági másolat | tesztek: életciklus, státuszváltás, esemény-történet |
| 3 | Idővonal | a dolgozó adatlapján az ügyei | ügy nyitása → esemény → lezárás végigjátszva |
| 4 | Ügyek fül | szűrhető lista, határidő szerint | lejárt/sürgős besorolás tesztje |
| 5 | Azonosító-kötés | lezáráskor új azonosító | teszt: a régi lezárul, a `producedId` rögzül |
| 6 | Státusz-HTML | `statusz.html` + megosztási profil + előnézet | teszt: érzékeny mező nem szivárog ki |
| 7 | Dokumentum-kötés | ügytípus → sablonok, egykattintásos generálás | végigpróbálás valós sablonnal |

Az 1–4. fázis önmagában használható terméket ad; a 6. az, amit külön kértél,
és a 3. fázis után bármikor előrehozható.

## 9. Amit előbb el kell dönteni

Ezek nem blokkolják az 1–2. fázist, de a 3. előtt kellenek:

1. **Milyen ügytípusok vannak pontosan, és mik a valós határidőik?**
   A seed listát megírom javaslatként, de a jogszabályi határidőket neked kell
   megerősítened — rossz határidő rosszabb, mint semmilyen.
2. **Ki állítja be a státuszt?** Egyfelhasználós marad, vagy több ügyintéző?
   Ez eldönti, kell-e zárolás és „ki módosította" megjelenítés.
3. **Hova kerül a `statusz.html`?** Ez dönti el, kell-e jelszavas titkosítás.
4. **Kell-e csatolmány-nyilvántartás** (melyik irat mikor ment be)? Ha igen, az
   csak fájlnév-hivatkozás legyen, nem maga a fájl — az adatbázist felfújná.
