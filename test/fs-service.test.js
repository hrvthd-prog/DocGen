'use strict';

// Az fs-service felújításának tesztjei (TERV-mappaszerkezet.md).
// Futtatás: node test/fs-service.test.js
//
// A File System Access API böngészős; Node alatt nincs. Ezért két dolgot mérünk:
//   1. a TISZTA függvényeket (foldName, matchWorkerDir) — ezek a dolgozói mappa
//      feloldását vezetik, és egy tévedés párhuzamos mappákat hozna létre;
//   2. a HIBAKEZELÉST egy minimális handle-utánzattal — a nyelt hiba volt az a
//      minta, amitől a mappaírás csendben máshova került.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
const failures = [];

function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => { console.log(`  ✓ ${name}`); passed++; },
                    e => { console.log(`  ✗ ${name}`); console.log(`    ${e.message}`);
                           failed++; failures.push({ name, error: e.message }); });
    }
    console.log(`  ✓ ${name}`); passed++;
  } catch (e) {
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

// ── IndexedDB-utánzat ───────────────────────────────────────────────────────
// Kell, mert a handle-tár nélkül a force opció nem mérhető: a nem-force ágnak
// VAN mit visszaadnia, a force-osnak nincs — pont ez a különbség a tesztelendő.
// A valódi API visszahívásos, ezért a kezelőket a következő ciklusban hívjuk.
const _store = new Map();
function fakeIndexedDB() {
  const later = (fn) => setTimeout(fn, 0);
  return {
    open() {
      const req = {};
      later(() => {
        const db = {
          transaction() {
            const tx = {};
            later(() => tx.oncomplete && tx.oncomplete());
            tx.objectStore = () => ({
              put(v, k) { _store.set(k, v); },
              get(k) {
                const r = {};
                later(() => r.onsuccess && r.onsuccess({ target: { result: _store.get(k) } }));
                return r;
              },
            });
            return tx;
          },
        };
        if (req.onsuccess) req.onsuccess({ target: { result: db } });
      });
      return req;
    },
  };
}

// ── a modul betöltése vm-sandboxban (window mockolva) ───────────────────────
const sandbox = {
  console, Date, Math, JSON, Set, Map, Object, Array, String, Number, Boolean,
  Error, RegExp, Promise, isNaN, parseInt, parseFloat, Blob: class {},
  setTimeout, clearTimeout,
  window: {},                       // showDirectoryPicker NINCS -> hasFsApi false
  indexedDB: fakeIndexedDB(),
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
{
  const rel = '../js/services/fs-service.js';
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, rel), 'utf8') + '\nglobalThis.FsService = FsService;',
    sandbox, { filename: rel });
}
const FS = sandbox.FsService;

// ── handle-utánzat: csak amit a tesztelt függvények hívnak ──────────────────
function err(name) { const e = new Error(name); e.name = name; return e; }

function fakeDir(spec = {}) {
  // spec: { dirs: {name: fakeDir}, files: {name: {size}}, denyDir, denyFile }
  return {
    kind: 'directory',
    async getDirectoryHandle(name, { create } = {}) {
      if (spec.denyDir) throw err('NotAllowedError');
      if (spec.dirs && spec.dirs[name]) return spec.dirs[name];
      if (create) { (spec.dirs = spec.dirs || {})[name] = fakeDir(); return spec.dirs[name]; }
      throw err('NotFoundError');
    },
    async getFileHandle(name, { create } = {}) {
      if (spec.denyFile) throw err('NotAllowedError');
      if (spec.files && spec.files[name]) return spec.files[name];
      if (create) {
        const store = { size: 0 };
        const fh = {
          async getFile() { return { size: store.size }; },
          async createWritable() {
            return {
              async write(b) { store.size = spec.truncate ?? (b.byteLength ?? b.size ?? 0); },
              async close() {},
              async abort() {},
            };
          },
        };
        (spec.files = spec.files || {})[name] = fh;
        return fh;
      }
      throw err('NotFoundError');
    },
    async removeEntry(name) {
      if (spec.denyFile) throw err('NotAllowedError');
      if (spec.files && spec.files[name]) { delete spec.files[name]; return; }
      throw err('NotFoundError');
    },
    entries() {
      const items = [
        ...Object.entries(spec.dirs || {}).map(([n, d]) => [n, d]),
        ...Object.entries(spec.files || {}).map(([n, f]) => [n, { kind: 'file', ...f }]),
      ];
      return (async function* () { for (const it of items) yield it; })();
    },
  };
}

async function main() {
  section('Dolgozói mappa feloldása');
  test('foldName: ékezet- és kisbetű-független', () => {
    assertEq(FS.foldName('Horváth Dániel'), 'horvath daniel');
    assertEq(FS.foldName('ŐRY ÜSZŐ'), 'ory uszo');
  });
  test('pontos egyezés ékezet nélkül is', () => {
    const { dir } = FS.matchWorkerDir('horvath daniel', ['Horváth Dániel', 'Kiss Anna']);
    assertEq(dir, 'Horváth Dániel');
  });
  test('egyetlen részegyezés elég', () => {
    const { dir } = FS.matchWorkerDir('Kiss', ['Horváth Dániel', 'Kiss Anna']);
    assertEq(dir, 'Kiss Anna');
  });
  test('két találat -> NINCS döntés (a hívó kérdez)', () => {
    const { dir, hits } = FS.matchWorkerDir('Kiss', ['Kiss Anna', 'Kiss Béla']);
    assertEq(dir, null);
    assertEq(hits.length, 2);
  });
  test('nulla találat -> NINCS döntés, mappát nem találunk ki', () => {
    const { dir, hits } = FS.matchWorkerDir('Nagy Zoltán', ['Kiss Anna']);
    assertEq(dir, null);
    assertEq(hits.length, 0);
  });
  test('üres név -> nincs döntés', () => {
    assertEq(FS.matchWorkerDir('', ['Kiss Anna']).dir, null);
  });
  test('a két alkönyvtár neve rögzített', () => {
    assertEq(FS.DIR_PREP, '01_Elokeszitett');
    assertEq(FS.DIR_UP, '02_Feltoltheto');
  });

  section('getSubDir: a hiba nem nyelődik el');
  await test('nincs ilyen mappa -> null (jogos eset)', async () => {
    assertEq(await FS.getSubDir(fakeDir(), 'nincs'), null);
  });
  await test('create: létrejön', async () => {
    const d = fakeDir();
    assert(await FS.getSubDir(d, '01_Elokeszitett', true));
  });
  await test('engedélyhiba DOBÓDIK (nem néma null)', async () => {
    let caught = null;
    try { await FS.getSubDir(fakeDir({ denyDir: true }), 'x', true); }
    catch (e) { caught = e.name; }
    assertEq(caught, 'NotAllowedError',
             'ha ez null-t adna, a DocGen csendben a gyökérbe írna');
  });
  section('getOrRequestFile force: a szkriptváltás');
  // A tárolt fájlt eltesszük „megadott engedéllyel". force NÉLKÜL ezt kapjuk
  // vissza (a fájlválasztó fel sem jön) — force-szal át kell ugornia. Enélkül a
  // „Szkript kiválasztása" gomb látszólag nem csinál semmit: ez a mért hiba.
  await test('force nélkül a tárolt fájlt adja vissza', async () => {
    const regi = {
      name: 'regi.vbs',
      async queryPermission() { return 'granted'; },
      async requestPermission() { return 'granted'; },
    };
    await FS.saveHandle('script', regi);
    const got = await FS.getOrRequestFile('script', 'szkript', null);
    assertEq(got && got.name, 'regi.vbs');
  });
  await test('force: átugorja, és mivel nincs FS API, null-t ad', async () => {
    const got = await FS.getOrRequestFile('script', 'szkript', null, { force: true });
    assertEq(got, null, 'force esetén a tárolt fájllal tért vissza — a váltás nem működne');
  });

  section('fileExists / deleteFromDir: engedélyhiba ≠ nincs fájl');
  await test('nincs fájl -> false', async () => {
    assertEq(await FS.fileExists(fakeDir(), 'a.docx'), false);
  });
  await test('engedélyhiba DOBÓDIK', async () => {
    let caught = null;
    try { await FS.fileExists(fakeDir({ denyFile: true }), 'a.docx'); }
    catch (e) { caught = e.name; }
    assertEq(caught, 'NotAllowedError',
             'ha ez false-t adna, a felülírás-kérdés némán elmaradna');
  });
  await test('deleteFromDir: nincs ott -> false, engedélyhiba -> dob', async () => {
    assertEq(await FS.deleteFromDir(fakeDir(), 'a.docx'), false);
    let caught = null;
    try { await FS.deleteFromDir(fakeDir({ denyFile: true, files: { 'a.docx': {} } }), 'a.docx'); }
    catch (e) { caught = e.name; }
    assertEq(caught, 'NotAllowedError');
  });

  section('writeToDir: írás-ellenőrzés');
  await test('a kiírt méret egyezik -> rendben', async () => {
    const d = fakeDir();
    await FS.writeToDir(d, 'a.docx', new Uint8Array(1234));
  });
  await test('csonkolt írás -> HIBA (nem marad észrevétlen)', async () => {
    let msg = '';
    try { await FS.writeToDir(fakeDir({ truncate: 7 }), 'a.docx', new Uint8Array(1234)); }
    catch (e) { msg = e.message; }
    assert(/mérete eltér/.test(msg), `várt méret-hiba, kapott: ${msg || '(semmi)'}`);
  });

  section('Munkamappa-felismerés (kimenet-kapu)');
  await test('üres mappa rendben (első beállítás)', async () => {
    const r = await FS.looksLikeWorkFolder(fakeDir());
    assertEq(r.ok, true);
  });
  await test('01/02-t tartalmazó almappa -> munkamappa', async () => {
    const root = fakeDir({ dirs: {
      'Kiss Anna': fakeDir({ dirs: { '02_Feltoltheto': fakeDir() } }),
    } });
    const r = await FS.looksLikeWorkFolder(root);
    assertEq(r.ok, true);
    assertEq(r.dolgozok, 1);
  });
  await test('iratot tartalmazó almappa -> munkamappa', async () => {
    const root = fakeDir({ dirs: {
      'Nagy Bela': fakeDir({ files: { 'Nagy Bela Útlevél.pdf': {} } }),
    } });
    assertEq((await FS.looksLikeWorkFolder(root)).ok, true);
  });
  await test('csak idegen almappák -> NEM munkamappa', async () => {
    const root = fakeDir({ dirs: {
      'nyaralas': fakeDir({ files: { 'IMG_1.jpg': {} } }),
      'projekt':  fakeDir({ files: { 'jegyzet.txt': {} } }),
    } });
    const r = await FS.looksLikeWorkFolder(root);
    assertEq(r.ok, false);
    assertEq(r.ossz, 2);
    assertEq(r.dolgozok, 0);
  });
  await test('a 01/02 a GYÖKÉRBEN nem számít dolgozói mappának', async () => {
    // Ha valaki egy dolgozó MAPPÁJÁT adja meg kimenetnek, az nem munkamappa.
    const root = fakeDir({ dirs: {
      '01_Elokeszitett': fakeDir({ files: { 'x.docx': {} } }),
      '02_Feltoltheto':  fakeDir(),
    } });
    const r = await FS.looksLikeWorkFolder(root);
    assertEq(r.ossz, 0, 'a két alkönyvtárat almappának számolta');
    assertEq(r.ok, true, 'üresnek látszik — nem zavarunk, de nincs is mit jelezni');
  });

  section('Mélyszkennelés: korlát és pont-szűrés');
  await test('a ponttal kezdődő és a 01/02 mappát kihagyja', async () => {
    const root = fakeDir({
      files: { 'sablon.docx': {} },
      dirs: {
        '.eredeti': fakeDir({ files: { 'regi.docx': {} } }),
        '01_Elokeszitett': fakeDir({ files: { 'dolgozoi.docx': {} } }),
        '02_Feltoltheto': fakeDir({ files: { 'alairt.docx': {} } }),
        'Nyomtatvanyok': fakeDir({ files: { 'masik.docx': {} } }),
      },
    });
    const got = (await FS.listDocxFilesDeep(root)).map(f => f.name).sort();
    assertEq(JSON.stringify(got), JSON.stringify(['masik.docx', 'sablon.docx']),
             'a dolgozói iratok és a .eredeti mentések NEM sablonok');
  });
  await test('mélységi korlát: a túl mély szint kimarad', async () => {
    let deep = fakeDir({ files: { 'melyen.docx': {} } });
    for (let i = 0; i < 6; i++) deep = fakeDir({ dirs: { ['sz' + i]: deep } });
    const got = await FS.listDocxFilesDeep(deep);
    assertEq(got.length, 0, 'korlát nélkül egy tévesen megadott mappa végtelen munkát adna');
  });

  section('Gépszintű kulcs (adatmappa)');
  await test('belépve is a „helyi_" kulcsra ír — induláskor, belépés előtt ott keressük', async () => {
    sandbox.Settings = { currentUser: () => 'Kovács Anna' };
    try {
      await FS.saveMachineHandle('data_dir', 'uj-mappa');
      assertEq(_store.get('helyi_data_dir'), 'uj-mappa');
      assertEq(await FS.loadMachineHandle('data_dir'), 'uj-mappa');
      await FS.saveHandle('output_dir', 'sajat');
      assertEq(_store.get('Kov_cs_Anna_output_dir'), 'sajat', 'a fiókos kulcs fiókos marad');
    } finally { delete sandbox.Settings; }
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Eredmény: ${passed} sikeres / ${failed} hibás (összesen ${passed + failed})`);
  if (failed) {
    failures.forEach(f => console.log(`  ✗ ${f.name}: ${f.error}`));
    process.exit(1);
  }
  console.log('Mind sikeres ✓');
}

main();
