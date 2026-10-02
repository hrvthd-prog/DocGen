'use strict';

// Indulás: a beállított adatmappához mi történik az engedéllyel.
// Futtatás: node test/indulas.test.js
//
// A hiba, amit fog: a Chromium a mappa-handle-t megtartja, a HOZZÁFÉRÉST
// viszont nem — minden indulásnál újra kell kérni, és kérni csak felhasználói
// kattintásra lehet. Ilyenkor a `restore()` nem állít be hátteret: a
// belépőképernyőnek engedélykérő gombot KELL kitennie (a Nyilvántartás
// oldalsávján lévő gombot az overlay eltakarja), különben az app minden
// indulásnál próba módba esik — ez vitte el egyszer a felhasználó 19 ügyét.
//
// A felületet (overlay, natív engedélykérő ablak) böngésző nélkül nem lehet
// mérni; azt mérjük, amit a belépőképernyő kérdez: `pendingDir()`,
// `grantAccess()`, `probaMode()`.

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
function section(n) { console.log(`\n[${n}]`); }

// ── utánzatok ───────────────────────────────────────────────────────────────

function mappa(name, files = {}) {
  return { name, files: new Map(Object.entries(files).map(([n, d]) => [n, JSON.stringify(d)])) };
}

// A böngésző engedélyállapota. `engedely`: 'granted' | 'prompt', `kattintasra`:
// mit ad a requestPermission (azt a natív ablak dönti el, itt a próba).
const bongeszo = { mentettMappa: null, engedely: 'prompt', kattintasra: true, kerdezve: 0 };

const FsService = {
  hasFsApi: true,
  loadMachineHandle: async () => bongeszo.mentettMappa,
  saveMachineHandle: async (k, h) => { bongeszo.mentettMappa = h; },
  loadHandle: async () => null,
  saveHandle: async () => {},
  queryPermissionOnly: async () => bongeszo.engedely === 'granted',
  verifyPermission: async () => {
    bongeszo.kerdezve++;
    if (bongeszo.engedely === 'granted') return true;
    if (bongeszo.kattintasra) { bongeszo.engedely = 'granted'; return true; }
    return false;
  },
  readTextFromDir: async (d, n) => {
    if (!d.files.has(n)) { const e = new Error('nincs'); e.name = 'NotFoundError'; throw e; }
    return d.files.get(n);
  },
  writeTextToDir: async (d, n, t) => { d.files.set(n, t); },
  fileExists: async (d, n) => d.files.has(n),
  getSubDir: async (d, n) => (d.sub = d.sub || mappa(n)),
  listFiles: async (d, f) => [...d.files.keys()].filter(f || (() => true)).sort(),
  deleteFromDir: async (d, n) => d.files.delete(n),
};

// Egyetlen „bármilyen elem": a renderSidebar/bind/renderList csak eseményt köt
// és szöveget ír: amit rajzolnak, azt nem mérjük, csak nem szabad elhasalnia.
function fakeEl() {
  const el = {
    innerHTML: '', textContent: '', value: '', hidden: false, disabled: false,
    dataset: {}, files: [], style: {},
    addEventListener() {}, removeEventListener() {}, remove() {}, appendChild() {},
    querySelector: () => fakeEl(), querySelectorAll: () => [], closest: () => null,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  };
  return el;
}

const dokumentum = {
  getElementById: () => fakeEl(),
  querySelector: () => fakeEl(),
  querySelectorAll: () => [],
  createElement: () => fakeEl(),
  addEventListener() {},
  activeElement: null,
};

// Auth: a próba mód jelzését és a fiókfájl betöltését figyeljük.
const Auth = {
  _proba: false,
  setProba(v) { Auth._proba = !!v; },
  isProba() { return Auth._proba; },
  can: () => true,
  currentRole: () => 'admin',
  currentUser: () => '',
  useBackend() {},
  createFileBackend: () => ({ load: async () => null, save: async () => {} }),
  load: async () => null,
  loaded: () => true,
};

const semaStub = {
  useBackend() {}, load: async () => null, save: async () => {},
  fields: () => [], version: () => 1,
  migrateLegacyKeys: () => 0, addMissingSeedFields: () => 0,
  removeRetiredFields: () => 0, refreshComputedRules: () => 0,
  resolveValues: () => ({}),
};

const sandbox = {
  console, Date, Math, JSON, Set, Map, Object, Array, String, Number, Boolean,
  Error, RegExp, Promise, isNaN, parseInt, parseFloat, crypto, setTimeout, clearTimeout,
  FsService, Auth,
  document: dokumentum,
  window: { addEventListener() {}, dispatchEvent() {} },
  Settings: { get: (k, d) => d, set() {}, currentUser: () => '' },
  BevLogger: { info() {}, warn() {}, error() {} },
  toast() {},
  escHtml: s => String(s),
  bevEmptyState: s => String(s),
  ClientPicker: { inline: () => ({ setRows() {}, clearSelection() {} }) },
  RegistryXlsxIO: { importFile() {}, exportData() {}, exportTemplate() {} },
  AllapotModule: { KIVONAT_DIR: 'allapot', kivonatKiir: async () => ({}) },
  SchemaStore: semaStub,
  ExportProfiles: { useBackend() {}, load: async () => null },
  Roles: { useBackend() {}, load: async () => 0, loadFrom() {} },
  CustomEvent: class { constructor(t, o) { this.type = t; Object.assign(this, o); } },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const [rel, name] of [
  ['../js/services/employee-repo.js',         'EmployeeRepo'],
  ['../js/schema/case-types.js',              'CaseTypes'],
  ['../js/services/case-repo.js',             'CaseRepo'],
  ['../js/services/transfer-repo.js',         'TransferRepo'],
  ['../js/modules/registry/registry-view.js', 'RegistryModule'],
]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, rel), 'utf8') +
    `\nglobalThis.${name} = ${name};`, sandbox, { filename: rel });
}
const { CaseRepo, RegistryModule } = sandbox;
sandbox.CaseTypes.loadFrom(null);

const UGY = { id: 'c1', employeeId: 'e1', type: 'rp_hosszabbitas', openedAt: '2026-08-10',
              status: 'beadva', events: [], createdAt: '2026-08-10T10:00:00Z',
              updatedAt: '2026-08-10T10:00:00Z' };

/** Friss indulás: a megadott mappa van mentve, a megadott engedélyállapottal. */
async function indul({ engedely, kattintasra = true }) {
  bongeszo.mentettMappa = mappa('munkamappa', {
    'docgen-employees.json': { version: 1, employees: [] },
    'docgen-cases.json':     { version: 1, cases: [UGY] },
  });
  bongeszo.engedely    = engedely;
  bongeszo.kattintasra = kattintasra;
  bongeszo.kerdezve    = 0;
  Auth._proba = false;
  await RegistryModule.init(fakeEl());
}

async function main() {
  section('Mentett adatmappa, de az engedély nem él túl az újraindulást');

  // EZ a hiba: ha itt próba módba esünk, a felhasználó a közös adat helyett a
  // böngészőtárba dolgozik — és nem is tudja, amíg el nem veszik.
  await test('nem esünk próba módba: a mappa engedélyre vár, és kérhető', async () => {
    await indul({ engedely: 'prompt' });
    assertEq(Auth.isProba(), false, 'próba mód nem indulhat magától');
    const varakozo = RegistryModule.pendingDir();
    assert(varakozo, 'a belépőképernyőnek tudnia kell, hogy van mire engedélyt kérni');
    assertEq(varakozo.name, 'munkamappa');
    assertEq(bongeszo.kerdezve, 0, 'indulásnál NEM kérdezünk (nincs kattintás)');
  });

  await test('engedély megadása után a mappa adata jön, és nincs több várakozó', async () => {
    await indul({ engedely: 'prompt' });
    assertEq(await RegistryModule.grantAccess(), true);
    assertEq(RegistryModule.pendingDir(), null, 'a kapu innentől a fiókokat kérdezi');
    assertEq(CaseRepo.all().length, 1, 'az adatmappa ügyei töltődtek be');
    assertEq(CaseRepo.all()[0].id, 'c1');
  });

  await test('megtagadott engedély: marad a várakozó mappa, nem indulunk üresen', async () => {
    await indul({ engedely: 'prompt', kattintasra: false });
    assertEq(await RegistryModule.grantAccess(), false);
    assert(RegistryModule.pendingDir(), 'a gomb maradjon kint, újra lehessen kérni');
  });

  await test('élő engedéllyel kérdés nélkül a mappával indulunk', async () => {
    await indul({ engedely: 'granted' });
    assertEq(RegistryModule.pendingDir(), null);
    assertEq(Auth.isProba(), false);
    assertEq(CaseRepo.all().length, 1);
  });

  section('Próba mód a belépőképernyőről');

  // A gomb eddig csak az `Auth.setProba(true)`-t hívta: a tárolók háttere
  // beállítatlan maradt, és az app minden repónál „nincs betöltve" hibát kapott.
  await test('a böngészőtár háttere beállítódik, a tárolók olvashatók', async () => {
    await indul({ engedely: 'prompt' });
    await RegistryModule.probaMode();
    assertEq(Auth.isProba(), true);
    assertEq(CaseRepo.all().length, 0, 'üres böngészőtár – de nem dob hibát');
  });

  await test('betöltött adatmappát a próba mód NEM cserél böngészőtárra', async () => {
    await indul({ engedely: 'granted' });
    assertEq(CaseRepo.all().length, 1);
    await RegistryModule.probaMode();
    assertEq(CaseRepo.all().length, 1, 'a betöltött adat nem rejthető el üres tár mögé');
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
