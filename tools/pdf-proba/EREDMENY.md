# PDF környezet-próba — eredménylap

**Kitöltve: 2026-08-06, Aumovio-s munkaállomás.**

## Összegzés

**Mind a négy próba sikeres → a T1 sáv épült be.**

| Próba | Eredmény |
|---|---|
| 1. VBS szkript + Word | ✅ működik |
| 2. Word makró | ✅ működik |
| 3. Microsoft Print to PDF | ✅ elérhető |
| 4. Böngésző (Edge) | ✅ Chromium-alapú |

Mivel az 1. próba sikerült, a legjobb út járható: **a Word COM-on keresztül
vezérelhető, teljes Word-hűségű PDF készül**, szerver és telepítés nélkül.

## Ami nem működött: ékezetes betűk

A párbeszédablakokban és a PDF-ben a magyar ékezetes betűk hibásan jelentek meg.

**Ok:** a próbafájlok UTF-8 kódolással készültek. A Windows Script Host a `.vbs`
forrást **ANSI-ként olvassa**, hacsak nem UTF-16 LE BOM-mal kezdődik. Ezért a
forrásbeli szöveg már a beolvasáskor elromlott — és mivel a szkript a saját
szövegét írta a Word-dokumentumba, a hiba a PDF-be is átöröklődött. Egyetlen
hibaforrás, két tünet.

Mérés (`AscW` karakterkódokkal, ugyanazon a forráson):

| Kódolás | Eredmény |
|---|---|
| UTF-8 BOM nélkül | ✗ 46 karakter helyett 55 — minden ékezet kettétörik |
| UTF-8 **BOM-mal** | ✗ fordítási hiba: „érvénytelen karakter" — el sem indul |
| **UTF-16 LE + BOM** | ✓ 46 karakter, `á`=225, `ű`=369 |

**Javítva:** minden `.vbs` UTF-16 LE + BOM kódolású. A
`test/vbs-encoding.test.js` géppel őrzi, hogy ne kerülhessen vissza — a
szerkesztők többsége alapból UTF-8-ban ment, ezért enélkül ez a hiba
észrevétlenül visszajönne.

A `.bas` (VBA) fordított eset: a kódablak ANSI-alapú, és az `ő`/`ű` nincs benne
a nyugati kódlapban. Ott az **ASCII-ra szorítkozás** a védelem — a
`2-proba-makro.bas` ezért ékezetmentes.

## Mi épült be ebből

`tools/docx-pdf.vbs` — duplakattintásra (vagy mappát ráhúzva) a mappa és
almappái összes `.docx` fájlját PDF-be menti.

Élesben kipróbálva ékezetes fájlnevekkel és tartalommal:

- `Nyilatkozat Nagy Béla.docx` → PDF ✓
- `almappa/Igazolás Kis Éva.docx` → PDF ✓ (rekurzió működik)
- `~$ideiglenes.docx` → helyesen kihagyva
- a kinyert PDF-szöveg ékezetei épek: *„környezet-próba"*, *„billentyűt"*,
  *„bejegyzést"*, *„járható"*

Ha a felhasználónak már fut a Wordje, a szkript ahhoz csatlakozik, és a végén
**nem zárja be** — különben a saját megnyitott dokumentumait csukná be alóla.
