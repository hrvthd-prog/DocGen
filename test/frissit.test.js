'use strict';

// A ZIP-ből frissítő szkript tesztje. Futtatás: node test/frissit.test.js
//
// A tét nem a másolás, hanem az, hogy MI MARAD MEG. A céges gépen ugyanabban a
// mappában él a kód és az éles adat (nyilvántartás, ügyek, mentések). Egy
// frissítő szkript, ami „tükrözi" a forrást, ezt csendben letörölné – onnantól
// az egyetlen mentés a data/backup/, ami épp szintén eltűnt.
//
// Ezért itt egy valódi frissítés fut le: felépítünk egy hamis „céges gépet",
// ráengedjük a szkriptet egy GitHub-szerű ZIP-pel, és megnézzük, mi lett.

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

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
function section(n) { console.log(`\n[${n}]`); }

// A szkript Windows Script Host-ot igényel – máshol nincs mit mérni.
if (process.platform !== 'win32') {
  console.log('\n(nem Windows – a .vbs nem futtatható, a készlet kimarad)');
  console.log('Eredmény: 0 sikeres / 0 hibás (kihagyva)');
  process.exit(0);
}

const GYOKER = path.join(__dirname, '..');
const VBS    = path.join(GYOKER, 'tools', 'frissit.vbs');

const tmp    = fs.mkdtempSync(path.join(os.tmpdir(), 'docgen-frissit-'));
const forras = path.join(tmp, 'forras', 'DocGen-main');
const cel    = path.join(tmp, 'cegesgep');
const zip    = path.join(tmp, 'DocGen-main.zip');

function ir(gyoker, rel, tartalom) {
  const ut = path.join(gyoker, rel);
  fs.mkdirSync(path.dirname(ut), { recursive: true });
  fs.writeFileSync(ut, tartalom);
  return ut;
}
function olvas(gyoker, rel) {
  return fs.readFileSync(path.join(gyoker, rel), 'utf8');
}

try {
  // ── A forrás: ez jön a GitHubról ─────────────────────────────────────────
  ir(forras, 'index.html',      '<html>ÚJ verzió</html>');
  ir(forras, 'js/app.js',       'console.log("új app");');
  ir(forras, 'js/version.js',   "window.APP_VERZIO = { verzio: '10.99', datum: '2026-08-17' };");
  ir(forras, 'css/app.css',     'body { color: red }');
  // Ez szándékosan a ZIP-ben van, a védett mappában: a szkriptnek NEM szabad
  // kiírnia, akkor sem, ha egyszer valaki mégis becsomagolná.
  ir(forras, 'data/docgen-employees.json', '{"employees":[]}');

  // ── A „céges gép": régi kód + éles adat + egy elárvult fájl ──────────────
  ir(cel, 'index.html',    '<html>RÉGI verzió</html>');          // frissülnie kell
  ir(cel, 'css/app.css',   'body { color: red }');               // azonos – nem változhat
  ir(cel, 'js/regi-modul.js', 'ez már nincs a repóban');         // nem törölhető
  ir(cel, 'data/docgen-employees.json',
     '{"employees":[{"id":"eles-adat","nev":"Nagy Béla"}]}');     // SOHA nem írható felül
  ir(cel, 'data/backup/2026-08-17.json', '{"mentes":true}');      // SOHA nem törölhető
  ir(cel, 'Sablonok/nyilatkozat.txt', 'sablon helyettes');        // SOHA nem törölhető
  fs.copyFileSync(VBS, ir(cel, 'tools/frissit.vbs', ''));

  // ── ZIP, ahogy a GitHub adja: egyetlen gyökérmappával ────────────────────
  const ps = spawnSync('powershell', ['-NoProfile', '-Command',
    `Compress-Archive -Path '${forras}' -DestinationPath '${zip}' -Force`],
    { encoding: 'utf8' });
  assert(ps.status === 0, 'a próba-ZIP nem készült el: ' + (ps.stderr || ''));

  // ── Futtatás ─────────────────────────────────────────────────────────────
  const r = spawnSync('cscript', ['//nologo', path.join(cel, 'tools', 'frissit.vbs'),
                                  zip, '/csendes'], { encoding: 'latin1' });

  section('Lefutás');
  test('a szkript hibátlanul lefut', () => {
    assert(r.status === 0, `kilépési kód ${r.status}: ${r.stdout} ${r.stderr}`);
  });

  section('Frissítés');
  test('a megváltozott fájl frissült', () => {
    assert(olvas(cel, 'index.html').includes('ÚJ'), 'az index.html a régi maradt');
  });
  test('az új fájl megérkezett', () => {
    assert(fs.existsSync(path.join(cel, 'js', 'app.js')), 'a js/app.js nem jött át');
    assert(olvas(cel, 'js/version.js').includes('10.99'), 'a version.js nem jött át');
  });

  section('Amihez nem szabad nyúlni');
  test('az éles nyilvántartás érintetlen – a ZIP-beli data/ NEM írta felül', () => {
    assert(olvas(cel, 'data/docgen-employees.json').includes('Nagy Béla'),
      'AZ ÉLES ADATOT FELÜLÍRTA – ez adatvesztés');
  });
  test('a mentések megvannak', () => {
    assert(fs.existsSync(path.join(cel, 'data', 'backup', '2026-08-17.json')));
  });
  test('a sablonmappa megvan', () => {
    assert(fs.existsSync(path.join(cel, 'Sablonok', 'nyilatkozat.txt')));
  });
  test('a repóból kikerült fájlt nem törli', () => {
    assert(fs.existsSync(path.join(cel, 'js', 'regi-modul.js')),
      'törölte az elárvult fájlt – a szkript nem tükrözhet, csak frissíthet');
  });

  section('Másodszori futás');
  const r2 = spawnSync('cscript', ['//nologo', path.join(cel, 'tools', 'frissit.vbs'),
                                   zip, '/csendes'], { encoding: 'latin1' });
  test('a második futás már nem talál változást', () => {
    assert(r2.status === 0, 'a második futás elszállt');
    assert(/naprakész/i.test(r2.stdout) || /naprak/i.test(r2.stdout),
      `nem jelentette naprakésznek: ${r2.stdout.trim()}`);
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('\n' + '='.repeat(60));
console.log(`Eredmény: ${passed} sikeres / ${failed} hibás (összesen ${passed + failed})`);
if (failed > 0) {
  console.log('\nHibás tesztek:');
  failures.forEach(f => console.log(`  - ${f.name}: ${f.error}`));
  process.exit(1);
}
console.log('Mind sikeres ✓');
process.exit(0);
