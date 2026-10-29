# CLAUDE.md — DocGen

Útmutató AI-asszisztensnek (Claude Code) ehhez a repóhoz. Ez a fájl minden
munkamenet elején automatikusan betöltődik.

## ELŐSZÖR: folytonosság

**Minden session elején olvasd el a [SESSIONS.md](SESSIONS.md) legfelső
bejegyzését** — ez adja a friss állapotot és a nyitott szálakat. A session
**végén szúrj be új bejegyzést** a naplóba (a protokoll a SESSIONS.md-ben van).

## A projekt

Munkavállalói nyilvántartás + `.docx` dokumentumgenerálás idegenrendészeti
ügyintézéshez. Kliensoldali, telepítést nem igénylő app: **vanilla JS,
`file://` protokollról fut**, Chromium-alapú böngésző kell (Firefox/Safari
nem jó — hiányzik a mappaválasztó API). SAP-kiegészítő, nem kiváltó.

A *miért*-et a tervdokumentumok őrzik, mind a `plans/` mappában: `TERV.md` (alapterv),
`TERV-esemenyek.md` (ügykövetés), `TERV-tesztanyag.md`, `TERV-adatbiztonsag.md`,
`TERV-mappaszerkezet.md` (a PDF Műhellyel közös mappaszerkezet + `fs-service`),
`TERV-fiokok.md` (felhasználói fiókok, négy jogosultsági szint — **még nincs
megvalósítva**),
`TERV-pdf-nyomtatvany.md` (kitölthető PDF-sablonok; példa: NEAK NYT.52),
`TERV-tomeges-ugyintezes.md` (tömeges ügy, ügytípus-sablonok, hiánypótló
szerkesztő, legutóbbi változások),
`TERV-kimenet-es-ugyek.md` (09_OIF_kerelmek mappaszerkezet, adatmappa helye,
ügylista-szűrők, engedélyezés utáni teendők, SAP-táblázat).
A használat: `README.md`.

## Hol fut?

- **Éles használat és éles adat csak a felhasználó céges gépén** van
  (adatmappa, IndexedDB `docgen_fs`). Fejlesztőgépen (otthoni Windows, VPS
  `/root/DocGen`, felhős session) ne keress éles adatot — ha kell, DevTools-
  konzolos szkriptet adj (mint a `tools/ugyek-bongeszotarbol.js`).
- Böngészős viselkedést (mappaválasztó, File System Access engedély, felület)
  csak ott lehet ellenőrizni: ami a Node-teszteken túl van, azt konkrét, nála
  elvégezhető lépésként írd a SESSIONS.md „Nyitott” pontjába, és ne állítsd,
  hogy működik.
- Linuxon a Windows-only készletek (`docx-pdf`, `frissit`) kihagyják magukat.
  Friss klónban: `git config core.hooksPath tools/hooks` és
  `git config push.followTags true` — enélkül nem lép a verzió, nincs tag.

## Tesztek

```bash
node test/run-all.js          # minden Node-teszt
node test/<név>.test.js       # egy készlet
```

A böngésző-mentes tesztek `vm`-sandboxban töltik be a `vendor/` és `js/`
modulokat (a `window`/`globalThis` mockolva). A docxtemplater-render
DOMParser-t kér, ezért az böngészős tesztben fut (`test/e2e-browser.js`,
`test/formanyomtatvany-check.js`), nem Node alatt. A PizZip Node-ban is
betölthető.

## Git

Commit és push **közvetlenül `main`-re** — ebben a projektben **nincs külön ág
/ PR**. (Egyszemélyes projekt, a branch csak felesleges kerülő.)

**Hibajavítás után a commit és a push automatikus**, ha `node test/run-all.js`
mindent zöldre futtat — nem kell rá rákérdezni. (A javítás a repóban van, nem a
munkakönyvtárban: egy elmaradt commit a következő sessionnek láthatatlan.)
Kivétel: ha a felhasználó az adott menetben kifejezetten kéri, hogy ne legyen.
Piros teszt mellett nincs commit.
