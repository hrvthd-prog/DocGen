'use strict';

// A DOCX → PDF átalakító munkalistájának tesztjei.
// Futtatás: node test/docx-pdf.test.js   (csak Windowson, cscript kell hozzá)
//
// EZ EGY VALÓS HIBÁBÓL SZÜLETETT. A szkript eredetileg önálló, „húzd rá a
// mappát" eszköz volt: rekurzívan MINDEN .docx fájlt átalakított. Amikor az app
// elkezdte a kimeneti mappába tenni, ez azt jelentette, hogy a korábbi
// generálások maradéka, a kézzel odamásolt iratok és az almappák tartalma is
// újra PDF-be ment — a felhasználó mérte le.
//
// A szkript a Wordöt vezérli, ezért nem futtatható vakon egy tesztből. A
// `/lista` kapcsoló ezért szárazon fut: kiírja, MIT alakítana át, és kilép,
// mielőtt a Wordhöz nyúlna. A munkalista összeállítása pont az a rész, ahol a
// hiba volt.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let passed = 0, failed = 0;
const failures = [];

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
    failed++; failures.push({ name, error: e.message });
  }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function assertEq(a, b, m) {
  if (a !== b) throw new Error(`${m || 'assertEq'}: várt ${JSON.stringify(b)}, kapott ${JSON.stringify(a)}`);
}
function section(n) { console.log(`\n[${n}]`); }

const SZKRIPT = path.join(__dirname, '..', 'tools', 'docx-pdf.vbs');

// Windowson kívül nincs cscript – ott a készlet magát kihagyja, nem bukik.
const cscript = spawnSync('cscript', ['//Nologo', '/?'], { encoding: 'utf8' });
if (cscript.error) {
  console.log('\n[docx-pdf] Kihagyva: nincs cscript (nem Windows).');
  process.exit(0);
}

/** Próbamappa fájlokkal; a kísérőfájl csak akkor készül, ha `manifest` meg van adva. */
function mappat(fajlok, manifest) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'docxpdf-'));
  for (const f of fajlok) {
    const teljes = path.join(d, f);
    fs.mkdirSync(path.dirname(teljes), { recursive: true });
    fs.writeFileSync(teljes, 'proba');
  }
  if (manifest) {
    // Ugyanaz az alak, amit a pdf-chain.js ír: UTF-8, 2 szóköz behúzás.
    fs.writeFileSync(path.join(d, 'docgen-generalas.json'), JSON.stringify({
      version: 1,
      at: new Date().toISOString(),
      files: manifest.map(n => ({
        docx: n, pdf: n.replace(/\.docx$/i, '.pdf'),
        client: 'Teszt Elek', template: 'Sablon', lastName: 'Teszt', firstName: 'Elek',
      })),
    }, null, 2), 'utf8');
  }
  return d;
}

/** Szárazfutás: mit alakítana át? */
function lista(dir) {
  const r = spawnSync('cscript', ['//Nologo', SZKRIPT, dir, '/lista'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`a szkript ${r.status} kóddal állt le: ${r.stderr || r.stdout}`);
  const ki = String(r.stdout);
  return {
    mod:      (/^MOD: (.*)$/m.exec(ki) || [])[1],
    db:       Number((/^DB: (\d+)$/m.exec(ki) || [])[1]),
    hianyzo:  Number((/^HIANYZO: (\d+)$/m.exec(ki) || [])[1]),
    fajlok:   [...ki.matchAll(/^FAJL: (.*)$/gm)].map(m => m[1].trim()).sort(),
  };
}

function takarit(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }

// ════════════════════════════════════════════════════════════════════════════
section('Kísérőfájllal — csak a legutóbbi generálás');

test('A mappa idegen .docx fájljait NEM alakítja át', () => {
  const d = mappat(
    ['Uj Egy.docx', 'Uj Ketto.docx', 'Regi generalas.docx', 'Kezzel idemasolt.docx'],
    ['Uj Egy.docx', 'Uj Ketto.docx']);
  try {
    const r = lista(d);
    assertEq(r.mod, 'kiserofajl');
    assertEq(r.db, 2, `4 fájlból ${r.db}-t venne — a szűkítés nem működik`);
    assertEq(r.fajlok.join(' | '), 'Uj Egy.docx | Uj Ketto.docx');
  } finally { takarit(d); }
});

test('Az almappákba sem megy le, ha van kísérőfájl', () => {
  // Az app mindig a kimeneti mappa GYÖKERÉBE ír (FsService.writeToDir),
  // tehát az almappa tartalma sosem a mostani generálásé.
  const d = mappat(
    ['Uj Egy.docx', 'archiv/Tavalyi.docx', 'archiv/melyebb/Meg regebbi.docx'],
    ['Uj Egy.docx']);
  try {
    const r = lista(d);
    assertEq(r.db, 1);
    assertEq(r.fajlok.join(' | '), 'Uj Egy.docx');
  } finally { takarit(d); }
});

test('Ékezetes fájlnevek is átjönnek a kísérőfájlból', () => {
  // A kísérőfájl UTF-8, a szkript UTF-16 – ADODB.Stream olvassa. Ha ez elromlik,
  // a név nem talál rá a lemezen lévő fájlra, és némán kimarad.
  const nevek = ['Kőműves Győző Nyilatkozat.docx', 'Nguyễn Thị Hạnh Adatlap.docx'];
  const d = mappat([...nevek, 'Idegen.docx'], nevek);
  try {
    const r = lista(d);
    assertEq(r.db, 2, 'az ékezetes nevek nem találtak rá a fájlokra');
    assertEq(r.hianyzo, 0);
  } finally { takarit(d); }
});

test('A kísérőfájlban szereplő, de törölt fájlt hiányzóként jelzi', () => {
  const d = mappat(['Megvan.docx'], ['Megvan.docx', 'Mar nincs.docx']);
  try {
    const r = lista(d);
    assertEq(r.db, 1);
    assertEq(r.hianyzo, 1, 'nem jelezte a hiányzó fájlt');
  } finally { takarit(d); }
});

test('Az ideiglenes ~$ fájl akkor sem kerül be, ha a kísérőfájlban szerepelne', () => {
  const d = mappat(['Uj Egy.docx', '~$Uj Egy.docx'], ['Uj Egy.docx']);
  try {
    assertEq(lista(d).db, 1);
  } finally { takarit(d); }
});

section('Kísérőfájl nélkül — marad az önálló viselkedés');

test('Mindent átalakít, almappákkal együtt', () => {
  const d = mappat(['Egy.docx', 'Ketto.docx', 'archiv/Harom.docx'], null);
  try {
    const r = lista(d);
    assertEq(r.mod, 'teljes mappa');
    assertEq(r.db, 3, 'a ráhúzott mappa feldolgozása szűkült — pedig ott ez a hasznos');
    assertEq(r.fajlok.join(' | '), 'Egy.docx | Harom.docx | Ketto.docx');
  } finally { takarit(d); }
});

test('Az ideiglenes ~$ fájlokat kihagyja', () => {
  const d = mappat(['Egy.docx', '~$Egy.docx'], null);
  try {
    assertEq(lista(d).db, 1);
  } finally { takarit(d); }
});

test('A .pdf és egyéb kiterjesztés nem kerül a listába', () => {
  const d = mappat(['Egy.docx', 'Egy.pdf', 'jegyzet.txt', 'tabla.xlsx'], null);
  try {
    assertEq(lista(d).db, 1);
  } finally { takarit(d); }
});

section('Üres esetek');

test('Üres kísérőfájl-lista esetén a teljes mappára esik vissza', () => {
  // Védekező: ha a JSON-ban nincs egyetlen "docx" sem, ne álljunk meg némán.
  const d = mappat(['Egy.docx'], []);
  try {
    const r = lista(d);
    assertEq(r.mod, 'teljes mappa');
    assertEq(r.db, 1);
  } finally { takarit(d); }
});

test('Sérült kísérőfájl esetén sem hasal el', () => {
  const d = mappat(['Egy.docx'], null);
  try {
    fs.writeFileSync(path.join(d, 'docgen-generalas.json'), '{ ez nem JSON', 'utf8');
    const r = lista(d);
    assertEq(r.mod, 'teljes mappa', 'sérült kísérőfájlnál megállt vagy rosszul szűkített');
    assertEq(r.db, 1);
  } finally { takarit(d); }
});

// ── Összegzés ───────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(60));
console.log(`Eredmény: ${passed} sikeres / ${failed} hibás (összesen ${passed + failed})`);
if (failed > 0) {
  console.log('\nHibás tesztek:');
  failures.forEach(f => console.log(`  - ${f.name}: ${f.error}`));
  process.exit(1);
}
console.log('Mind sikeres ✓');
