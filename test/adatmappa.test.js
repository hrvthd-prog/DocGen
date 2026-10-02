'use strict';

// Adatmappa-választás: mi kerül át a böngészőtárból (vagy az eddigi mappából).
// Futtatás: node test/adatmappa.test.js
//
// A hiba, amit fog: a mappaválasztás csak a dolgozókat vitte át, ráadásul új
// belső azonosítóval — az ügyek és az átutalások a böngészőben ragadtak, és a
// régi azonosítóra mutattak volna. A registry-view `hatterek()` + `atkoltoztet()`
// párosát mérjük valódi tárolókkal; a fájlrendszer és az IndexedDB utánzat.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
const failures = [];

async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) {
    console.log(`  ✗ ${name}`); console.log(`    ${e.message}`);
    failed++; failures.push({ name, error: e.message });
  }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function assertEq(a, b, m) {
  if (a !== b) throw new Error(`${m || 'assertEq'}: várt ${JSON.stringify(b)}, kapott ${JSON.stringify(a)}`);
}

// ── utánzatok: böngészőtár (próba mód: „helyi_" előtag) és mappák ───────────
let idb;
function mappa(name, files = {}) {
  return { name, files: new Map(Object.entries(files).map(([n, d]) => [n, JSON.stringify(d)])) };
}
const FsService = {
  loadHandle: async k => (idb.has('helyi_' + k) ? idb.get('helyi_' + k) : null),
  saveHandle: async (k, v) => { idb.set('helyi_' + k, v); },
  readTextFromDir: async (d, n) => {
    if (!d.files.has(n)) { const e = new Error('nincs'); e.name = 'NotFoundError'; throw e; }
    return d.files.get(n);
  },
  writeTextToDir: async (d, n, t) => { d.files.set(n, t); },
  fileExists: async (d, n) => d.files.has(n),
  getSubDir: async (d, n) => (d.sub = d.sub || mappa(n)),
  listFiles: async (d, f) => [...d.files.keys()].filter(f).sort(),
  deleteFromDir: async (d, n) => d.files.delete(n),
};

const sandbox = {
  console, Date, Math, JSON, Set, Map, Object, Array, String, Number, Boolean,
  Error, RegExp, Promise, isNaN, parseInt, parseFloat, crypto, setTimeout, clearTimeout,
  FsService,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const [rel, name] of [
  ['../js/services/employee-repo.js',      'EmployeeRepo'],
  ['../js/schema/case-types.js',           'CaseTypes'],
  ['../js/services/case-repo.js',          'CaseRepo'],
  ['../js/services/transfer-repo.js',      'TransferRepo'],
  ['../js/modules/registry/registry-view.js', 'RegistryModule'],
]) {
  const code = fs.readFileSync(path.join(__dirname, rel), 'utf8') + `\nglobalThis.${name} = ${name};`;
  vm.runInContext(code, sandbox, { filename: rel });
}
const { EmployeeRepo, CaseTypes, CaseRepo, RegistryModule } = sandbox;
const { _hatterek: hatterek, _atkoltoztet: atkoltoztet } = RegistryModule;
CaseTypes.loadFrom(null);

// ── próba-adat: egy kilépett dolgozó naplóval, ügye, átutalása, sémája ──────
const DOLGOZO = {
  id: 'e1', identifiers: [{ type: 'passport', value: 'P1', current: true }],
  fields: { surname: 'Kiss', forename: 'Anna' }, exited: true, exitDate: '2026-09-01',
  history: [{ at: '2026-08-10T10:00:00Z', action: 'modositas', changes: [] }],
  createdAt: '2026-08-01T10:00:00Z', updatedAt: '2026-09-01T10:00:00Z',
};
const UGY = { id: 'c1', employeeId: 'e1', type: CaseTypes.all()[0].key, openedAt: '2026-08-10',
              events: [{ at: '2026-08-10T10:00:00Z', note: 'eredeti' }],
              createdAt: '2026-08-10T10:00:00Z', updatedAt: '2026-08-10T10:00:00Z' };
const KOTEG = { id: 'b1', label: '2026-09-18/1', rows: [{ id: 'r1', caseId: 'c1', employeeId: 'e1' }] };

function bongeszotar() {
  idb = new Map([
    ['helyi_db_employees', { version: 1, employees: [DOLGOZO] }],
    ['helyi_db_cases',     { version: 1, cases: [UGY] }],
    ['helyi_db_transfers', { version: 1, batches: [KOTEG], audit: [] }],
    ['helyi_config_schema', { version: 7, fields: [{ key: 'sajat_mezo' }] }],
  ]);
}
const olvas = (d, n) => JSON.parse(d.files.get(n));

async function main() {
  console.log('\n[Böngészőtár → üres adatmappa]');
  await test('a dolgozó, az ügy és az átutalás is átmegy, ugyanazzal az azonosítóval', async () => {
    bongeszotar();
    const dir = mappa('uj');
    const vitt = await atkoltoztet(hatterek(null), hatterek(dir));
    assertEq(vitt.join(','), 'schema,employees,cases,transfers');
    const emp = olvas(dir, 'docgen-employees.json').employees[0];
    assertEq(emp.id, 'e1', 'nem kaphat új azonosítót');
    assertEq(emp.exited, true, 'a kilépett nem lehet újra aktív');
    assertEq(emp.history.length, 1, 'a változásnapló megmarad');
    assertEq(olvas(dir, 'docgen-cases.json').cases[0].employeeId, 'e1');
    assertEq(olvas(dir, 'docgen-transfers.json').batches[0].rows[0].caseId, 'c1');
    assertEq(olvas(dir, 'docgen-config.json').schema.fields[0].key, 'sajat_mezo');
  });

  await test('betöltés után az ügy a dolgozójához tartozik, az idővonal megvan', async () => {
    bongeszotar();
    const dir = mappa('uj');
    await atkoltoztet(hatterek(null), hatterek(dir));
    EmployeeRepo.useBackend(EmployeeRepo.createFileBackend(dir));
    CaseRepo.useBackend(CaseRepo.createFileBackend(dir));
    await EmployeeRepo.load();
    await CaseRepo.load();
    const ugyek = CaseRepo.forEmployee(EmployeeRepo.get('e1').id);
    assertEq(ugyek.length, 1);
    assertEq(ugyek[0].events[0].note, 'eredeti');
  });

  console.log('\n[Amit NEM szabad felülírni]');
  await test('van már dolgozó a célban → semmi nem változik', async () => {
    bongeszotar();
    const dir = mappa('eles', { 'docgen-employees.json': { employees: [{ id: 'e9' }] } });
    const elotte = [...dir.files.entries()].join('|');
    const vitt = await atkoltoztet(hatterek(null), hatterek(dir));
    assertEq(vitt.length, 0);
    assertEq([...dir.files.entries()].join('|'), elotte);
  });

  await test('előre beállított, de üres mappa: a szintjeit megtartja, az adat átjön', async () => {
    bongeszotar();
    idb.set('helyi_config_roles', { roles: [{ key: 'proba' }] });
    const dir = mappa('elokeszitett', { 'docgen-config.json': { roles: { roles: [{ key: 'admin' }] } } });
    const vitt = await atkoltoztet(hatterek(null), hatterek(dir));
    assert(!vitt.includes('roles'), 'a cél szintjeit nem írhatja felül');
    assertEq(olvas(dir, 'docgen-config.json').roles.roles[0].key, 'admin');
    assertEq(olvas(dir, 'docgen-cases.json').cases.length, 1);
  });

  await test('újrafuttatás nem dupláz', async () => {
    bongeszotar();
    const dir = mappa('uj');
    await atkoltoztet(hatterek(null), hatterek(dir));
    assertEq((await atkoltoztet(hatterek(null), hatterek(dir))).length, 0);
    assertEq(olvas(dir, 'docgen-cases.json').cases.length, 1);
  });

  console.log('\n[Mappáról üres mappára]');
  await test('az eddigi mappa tartalma is mind átjön', async () => {
    idb = new Map();
    const regi = mappa('regi', {
      'docgen-employees.json': { employees: [DOLGOZO] },
      'docgen-cases.json': { cases: [UGY] },
      'docgen-transfers.json': { batches: [KOTEG], audit: [] },
    });
    const dir = mappa('uj');
    const vitt = await atkoltoztet(hatterek(regi), hatterek(dir));
    assertEq(vitt.join(','), 'employees,cases,transfers');
    assertEq(olvas(dir, 'docgen-cases.json').cases[0].id, 'c1');
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
