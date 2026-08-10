'use strict';

// Séma-összevetés tesztjei – a VALÓDI adatbekérő fájllal.
// Futtatás: node test/schema-from-xlsx.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

const XLSX_PATH = path.join(__dirname,
  '../../munkavallaloi_adatbekero_sablon_20260805.xlsx');

if (!fs.existsSync(XLSX_PATH)) {
  console.log('\n[Séma-összevetés]');
  console.log('  ⚠ A minta adatbekérő nem található, a készlet kimarad:');
  console.log('    ' + XLSX_PATH);
  console.log('\n' + '='.repeat(60));
  console.log('Eredmény: 0 sikeres / 0 hibás (kihagyva)');
  process.exit(0);
}

// ── Sandbox: a böngésző-oldali modulok Node alatt ──────────────────────────
const { JSDOM } = (() => { try { return require('jsdom'); } catch { return {}; } })();

const sandbox = {
  console, Date, Math, JSON, Set, Map, Object, Array, String, Number, Boolean,
  Error, RegExp, Promise, isNaN, parseInt, parseFloat, Uint8Array, ArrayBuffer,
  TextDecoder, TextEncoder, Buffer,
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);

// Vendor: SheetJS + PizZip
for (const v of ['xlsx.full.min.js', 'pizzip.min.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../vendor/', v), 'utf8'), sandbox,
    { filename: v });
}

// DOMParser – a legördülők XML-olvasásához
if (JSDOM) {
  sandbox.DOMParser = new JSDOM('').window.DOMParser;
}

for (const f of ['value-codec.js', 'seed-schema.js', 'schema-store.js', 'schema-from-xlsx.js']) {
  const name = { 'value-codec.js': 'ValueCodec', 'seed-schema.js': 'SEED_SCHEMA',
                 'schema-store.js': 'SchemaStore', 'schema-from-xlsx.js': 'SchemaFromXlsx' }[f];
  let code = fs.readFileSync(path.join(__dirname, '../js/schema/', f), 'utf8');
  code += `\nglobalThis.${name} = ${name};`;
  vm.runInContext(code, sandbox, { filename: f });
}

const { SchemaFromXlsx, SchemaStore, SEED_SCHEMA } = sandbox;
const buf = fs.readFileSync(XLSX_PATH);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

SchemaStore.loadFrom(SEED_SCHEMA);

// ════════════════════════════════════════════════════════════════════════════
section('Adatbekérő beolvasása');

let analysis;
test('a fájl elemezhető', () => {
  analysis = SchemaFromXlsx.analyze(ab);
  assertEq(analysis.sheetName, 'Data');
});

test('mind a 44 oszlop kulcsa kiolvasható', () => {
  assertEq(analysis.columns.length, 44);
  assertEq(analysis.columns[0].key, 'personnel_reg_number');
  assertEq(analysis.columns[1].key, 'surname');
  assertEq(analysis.columns[43].key, 'previous_street');
});

test('az angol címkék is kiolvasódnak a 2. sorból', () => {
  const s = analysis.columns.find(c => c.key === 'surname');
  assertEq(s.labelEn, 'Surname (as in passport)');
});

if (JSDOM) {
  test('a legördülők értékkészlete kiolvasható a munkalap XML-jéből', () => {
    assertEq(Object.keys(analysis.dropdowns).sort().join(','),
      'educational_attainment,marital_status,passport_type,sex,speaks_hungarian');
    assertEq(analysis.dropdowns.sex.join(','), 'male,female');
    assertEq(analysis.dropdowns.marital_status.join(','), 'married,unmarried,widow,divorced');
  });
} else {
  console.log('  ⚠ jsdom nincs telepítve – a legördülő-olvasás tesztje kimarad');
}

// ════════════════════════════════════════════════════════════════════════════
section('Összevetés a kiinduló sémával');

// A minta-xlsx a 44 oszlopos eredeti. A séma azóta hat mezővel bővült a
// hatósági formanyomtatvány miatt, ezért a diff joggal jelzi őket hiányzónak:
// a RÉGI fájlból tényleg hiányoznak. Pontosan ezt a hatot várjuk, se többet,
// se kevesebbet – így a teszt továbbra is kiszúrja a véletlen eltérést.
const FORMANYOMTATVANY_MEZOK = [
  'occupation_before_arrival', 'other_accommodation', 'pp_issuance_place',
  'stairway', 'topographical_number', 'transport_type',
];

test('a kiinduló séma megegyezik a fájllal – csak a formanyomtatvány-mezők újak', () => {
  const d = SchemaFromXlsx.diff(analysis, SchemaStore.get());
  assertEq(d.added.length, 0, 'váratlan új mező: ' + d.added.map(a => a.key).join(','));
  assertEq(d.removed.map(r => r.key).sort().join(','), FORMANYOMTATVANY_MEZOK.join(','),
    'nem a várt mezők hiányoznak a régi fájlból');
  assertEq(d.labelChanged.length, 0, 'eltérő angol címke: ' + JSON.stringify(d.labelChanged));
  assertEq(d.orderChanged, false, 'eltérő oszlopsorrend');
  if (JSDOM) assertEq(d.enumChanged.length, 0, 'eltérő legördülő: ' + JSON.stringify(d.enumChanged));
});

test('hiányzó mezőt észlel, ha a sémából kivesszük', () => {
  const s = JSON.parse(JSON.stringify(SEED_SCHEMA));
  s.fields = s.fields.filter(f => f.key !== 'telephone');
  SchemaStore.loadFrom(s);
  const d = SchemaFromXlsx.diff(analysis, SchemaStore.get());
  assertEq(d.added.length, 1);
  assertEq(d.added[0].key, 'telephone');
  assertEq(d.added[0].labelEn, 'Telephone Number');
  SchemaStore.loadFrom(SEED_SCHEMA);
});

test('a sémában lévő, de fájlból hiányzó mezőt jelzi', () => {
  const s = JSON.parse(JSON.stringify(SEED_SCHEMA));
  s.fields.push({ key: 'sajat_mezo', group: 'alap', type: 'text',
                  label: { hu: 'Saját mező', en: 'Own' } });
  SchemaStore.loadFrom(s);
  const d = SchemaFromXlsx.diff(analysis, SchemaStore.get());
  assert(d.removed.some(r => r.key === 'sajat_mezo'), 'nem jelezte a saját mezőt');
  SchemaStore.loadFrom(SEED_SCHEMA);
});

if (JSDOM) {
  test('megváltozott legördülőt észlel', () => {
    const s = JSON.parse(JSON.stringify(SEED_SCHEMA));
    const sex = s.fields.find(f => f.key === 'sex');
    sex.values = [{ id: 'male', hu: 'Férfi', en: 'Male', accepts: ['ffi'] }];  // 'female' hiányzik
    SchemaStore.loadFrom(s);
    const d = SchemaFromXlsx.diff(analysis, SchemaStore.get());
    const e = d.enumChanged.find(x => x.key === 'sex');
    assert(e, 'nem jelezte az eltérő legördülőt');
    assertEq(e.newValues.join(','), 'female');
    SchemaStore.loadFrom(SEED_SCHEMA);
  });

  test('a legördülő frissítése megőrzi a meglévő fordításokat és írásmódokat', () => {
    const s = JSON.parse(JSON.stringify(SEED_SCHEMA));
    const sex = s.fields.find(f => f.key === 'sex');
    sex.values = [{ id: 'male', hu: 'Férfi', en: 'Male', accepts: ['ffi', 'ferfi'] }];
    SchemaStore.loadFrom(s);
    const d = SchemaFromXlsx.diff(analysis, SchemaStore.get());
    const { schema } = SchemaFromXlsx.apply(SchemaStore.get(), d, { enumChanged: ['sex'] });

    const uj = schema.fields.find(f => f.key === 'sex');
    assertEq(uj.values.length, 2, 'nem lett meg mindkét érték');
    const ferfi = uj.values.find(v => v.id === 'male');
    assertEq(ferfi.hu, 'Férfi', 'a magyar fordítás elveszett');
    assertEq(ferfi.accepts.join(','), 'ffi,ferfi', 'az írásmódok elvesztek');
    const no = uj.values.find(v => v.id === 'female');
    assertEq(no.hu, 'female', 'az új érték nem kapott helyettesítő címkét');
    SchemaStore.loadFrom(SEED_SCHEMA);
  });
}

test('új mező felvétele a javaslatból', () => {
  const s = JSON.parse(JSON.stringify(SEED_SCHEMA));
  s.fields = s.fields.filter(f => f.key !== 'telephone');
  SchemaStore.loadFrom(s);
  const d = SchemaFromXlsx.diff(analysis, SchemaStore.get());
  const { schema, changes } = SchemaFromXlsx.apply(SchemaStore.get(), d, { added: ['telephone'] });
  assert(schema.fields.find(f => f.key === 'telephone'), 'a mező nem került be');
  assertEq(changes.length, 1);
  SchemaStore.loadFrom(SEED_SCHEMA);
});

test('ki nem jelölt javaslat nem kerül alkalmazásra', () => {
  const s = JSON.parse(JSON.stringify(SEED_SCHEMA));
  s.fields = s.fields.filter(f => f.key !== 'telephone');
  SchemaStore.loadFrom(s);
  const d = SchemaFromXlsx.diff(analysis, SchemaStore.get());
  const { schema, changes } = SchemaFromXlsx.apply(SchemaStore.get(), d, { added: [] });
  assert(!schema.fields.find(f => f.key === 'telephone'), 'kijelöletlenül is bekerült');
  assertEq(changes.length, 0);
  SchemaStore.loadFrom(SEED_SCHEMA);
});

test('a sorrend-igazítás a fájl oszlopsorrendjét veszi át', () => {
  const s = JSON.parse(JSON.stringify(SEED_SCHEMA));
  // megcseréljük az első két mezőt
  [s.fields[0], s.fields[1]] = [s.fields[1], s.fields[0]];
  SchemaStore.loadFrom(s);
  const d = SchemaFromXlsx.diff(analysis, SchemaStore.get());
  assertEq(d.orderChanged, true, 'nem észlelte a sorrendváltozást');
  const { schema } = SchemaFromXlsx.apply(SchemaStore.get(), d, { order: true });
  const stored = schema.fields.filter(f => f.type !== 'computed').map(f => f.key);
  assertEq(stored[0], 'personnel_reg_number');
  assertEq(stored[1], 'surname');
  SchemaStore.loadFrom(SEED_SCHEMA);
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
process.exit(0);
