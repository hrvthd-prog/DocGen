# PDF környezet-próba

> **Ez a mérés lezárult** — 2026-08-06, az Aumovio-s munkaállomáson. Mind a négy
> próba sikeres lett, ezért a **T1 sáv** épült be: `tools/docx-pdf.vbs`.
> Az eredmény: [EREDMENY.md](EREDMENY.md).
>
> A csomag azért marad meg, mert **másik gépen újra kell mérni**: ha az app
> más munkaállomásra kerül, ott nem biztos, hogy ugyanaz működik. Ilyenkor
> kattintsd végig, és töltsd ki az eredménylapot.

Ez a csomag azt méri fel, hogy egy adott gépen melyik módon lehet a legenerált
Word-dokumentumokból PDF-et készíteni. A böngésző önmagában nem tud Wordöt
vezérelni, ezért kell valamilyen külső út — de a régi megoldás (helyi
PDF-kiszolgáló) itt nem járható.

**Nem kell hozzá telepítés és rendszergazdai jog.** A próba semmit nem módosít a
gépen: csak létrehoz néhány fájlt ebben a mappában, amiket utána nyugodtan
törölhetsz.

Menj végig az 1–4. próbán, és írd be az eredményt az `EREDMENY.md` fájlba.

---

## 1. próba — Word + VBS szkript (a legjobb eset)

1. Másold ezt a teljes `pdf-proba` mappát az Aumovio-s gépre.
2. Kattints duplán a **`1-proba-vbs.vbs`** fájlra.

**Lehetséges kimenetek:**

| Amit látsz | Mit jelent |
|---|---|
| Megjelenik egy ablak „A VBS szkript fut" szöveggel, majd egy másik a Word verziójával, és keletkezik egy `proba-kimenet.pdf` | **T1 – minden működik.** Ez a legjobb eset. |
| Megjelenik az első ablak, de a Word-ös lépésnél hibaüzenet jön | VBS fut, de a Word-vezérlés tiltott → 2. próba |
| Semmi nem történik, vagy „a szkriptelés le van tiltva" üzenet jön | VBS tiltott → 2. próba |
| A Windows megkérdezi, mivel nyissa meg | VBS tiltott → 2. próba |

---

## 2. próba — Word makró

Akkor csináld végig, ha az 1. próba nem sikerült.

1. Nyiss meg egy **üres Word-dokumentumot**.
2. Nyomd meg az **Alt + F11** billentyűket (VBA-szerkesztő).
3. A bal oldali fában jelöld ki a **Normal** bejegyzést, majd
   **Insert (Beszúrás) → Module**.
4. Nyisd meg a **`2-proba-makro.bas`** fájlt Jegyzettömbbel, másold ki a teljes
   tartalmát, és illeszd be a Wordben megnyílt modulba.
5. Nyomd meg az **F5** billentyűt.

| Amit látsz | Mit jelent |
|---|---|
| Üzenet a Word verziójáról, és az Asztalon megjelenik a `proba-makro.pdf` | **T1b – a makrós út járható.** |
| Az Alt + F11 nem nyit meg semmit | A VBA házirenddel tiltott → 3. próba |
| A szerkesztő megnyílik, de az F5 hibát dob | Írd le a hibaüzenetet, és folytasd a 3. próbával |

---

## 3. próba — Microsoft Print to PDF

1. Nyomd meg a **Windows + R** billentyűket, írd be: `control printers`, Enter.
2. Keresd meg a nyomtatók között a **Microsoft Print to PDF** bejegyzést.
3. Ha megvan: nyisd meg a `3-proba-nyomtatas.docx` fájlt Wordben, nyomj
   **Ctrl + P**, nyomtatónak válaszd a *Microsoft Print to PDF*-et, majd Nyomtatás.

| Amit látsz | Mit jelent |
|---|---|
| Van ilyen nyomtató, és rákérdez a PDF nevére, majd elkészül | **T1c – kötegelt nyomtatással megoldható.** |
| Nincs ilyen nyomtató a listában | → 4. próba (a böngészős út marad) |

---

## 4. próba — Böngésző

1. Nyisd meg a böngészőt, amiben az appot használni fogod.
2. Írd be a címsorba: `edge://version` (Edge) vagy `chrome://version` (Chrome).

| Amit látsz | Mit jelent |
|---|---|
| Megjelenik egy verzió-oldal | Chromium-alapú böngésző → a mappaválasztás és a böngészős PDF-mentés is működni fog |
| Hibaoldal jön (pl. Firefoxban) | Nem Chromium-alapú → az app tartalék módban fut, a mappaválasztás helyett letöltés lesz |

Ellenőrizd azt is, hogy nyomtatáskor (**Ctrl + P** bármelyik weboldalon) a
célok között szerepel-e a **Mentés PDF-ként** vagy a *Microsoft Print to PDF*.

---

## Ha elkészültél

Töltsd ki az `EREDMENY.md` fájlt, és küldd vissza. Abból derül ki, melyik
konverziós utat építsük be az appba. A próbafájlokat (`proba-*.pdf` és társai)
utána nyugodtan töröld.
