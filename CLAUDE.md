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

A *miért*-et a tervdokumentumok őrzik: `TERV.md` (alapterv),
`TERV-esemenyek.md` (ügykövetés), `TERV-tesztanyag.md`, `TERV-adatbiztonsag.md`.
A használat: `README.md`.

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
