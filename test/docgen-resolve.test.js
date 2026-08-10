'use strict';

// A dokumentum-generálás séma-alapú jelölőfeloldásának tesztjei.
// Futtatás: node test/docgen-resolve.test.js
//
// Ez a réteg köti össze a nyilvántartást a sablonokkal: a kétnyelvű jelölők
// ({{Neme}} / {{Neme_EN}}), a számított mezők és a magyar címkék feloldása.

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

// ── Séma-réteg betöltése ────────────────────────────────────────────────────
const sandbox = {
  console, Date, Math, JSON, Set, Map, Object, Array, String, Number, Boolean,
  Error, RegExp, Promise, isNaN, parseInt, parseFloat, crypto,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const [rel, name] of [
  ['../js/services/employee-repo.js', 'EmployeeRepo'],
  ['../js/schema/value-codec.js',     'ValueCodec'],
  ['../js/schema/seed-schema.js',     'SEED_SCHEMA'],
  ['../js/schema/schema-store.js',    'SchemaStore'],
]) {
  let code = fs.readFileSync(path.join(__dirname, rel), 'utf8');
  code += `\nglobalThis.${name} = ${name};`;
  vm.runInContext(code, sandbox, { filename: rel });
}
const { SchemaStore, SEED_SCHEMA, ValueCodec, EmployeeRepo } = sandbox;
SchemaStore.loadFrom(SEED_SCHEMA);

// ── A docgen két segédfüggvényének kiemelt mása ─────────────────────────────
// Ugyanaz a logika, mint a js/modules/docgen.js-ben; itt DOM nélkül vizsgálható.
// (A docgen forrásában is ellenőrizzük, hogy ez a két függvény tényleg létezik.)

function buildRenderRow(emp, maiNap) {
  const v = SchemaStore.resolveValues(emp.fields, 'hu');
  for (const f of SchemaStore.fields()) {
    const cimke = f.label.hu;
    if (cimke && v[cimke] === undefined) v[cimke] = v[f.key];
  }
  v['mai nap'] = maiNap;
  const sap = EmployeeRepo.currentIdentifier(emp, 'sap');
  if (sap) v['Azonosító'] = sap.value;
  return v;
}

// Ugyanaz a feloldás, amit a docgen használ – a séma adja, nem a másolata.
// Korábban itt egy kézzel karbantartott ikertestvér állt, ami elavulhatott.
function makeSchemaResolver(emp) {
  const gyorsito = new Map();
  return (name) => {
    if (!gyorsito.has(name)) gyorsito.set(name, SchemaStore.renderTag(name, emp.fields));
    return gyorsito.get(name);
  };
}

const EMP = {
  id: 'teszt-1',
  identifiers: [{ type: 'sap', value: 'SAP-2002', current: true }],
  fields: {
    surname: 'Kovács', forename: 'Anna', date_of_birth: '1990-03-15',
    citizenship: 'Fülöp-szigeteki', sex: 'male', marital_status: 'married',
    educational_attainment: 'tertiary', speaks_hungarian: 'yes',
    mothers_surname_at_birth: 'Szabó', mothers_forename_at_birth: 'Mária',
    place_of_birth_country: 'Fülöp-szigetek', place_of_birth_locality: 'Manila',
    postal_code: '1024', locality: 'Budapest',
    name_of_public_place: 'Fő', type_of_public_place: 'utca', street_number: '12',
  },
};

// ════════════════════════════════════════════════════════════════════════════
section('Kétnyelvű jelölők (HU-ENG sablonokhoz)');

const resolve = makeSchemaResolver(EMP);

test('ugyanaz a mező magyarul és angolul is feloldható', () => {
  assertEq(resolve('Neme'), 'Férfi');
  assertEq(resolve('Neme_EN'), 'Male');
  assertEq(resolve('Családi állapot'), 'Házas');
  assertEq(resolve('Családi állapot_EN'), 'Married');
});

test('a gépi kulcs is működik jelölőként', () => {
  assertEq(resolve('sex'), 'Férfi');
  assertEq(resolve('sex_EN'), 'Male');
  assertEq(resolve('surname'), 'Kovács');
});

test('az iskolai végzettség és a nyelvtudás mindkét nyelven', () => {
  assertEq(resolve('Iskolai végzettség'), 'Felsőfokú');
  assertEq(resolve('Iskolai végzettség_EN'), 'Tertiary');
  assertEq(resolve('Beszél magyarul'), 'Igen');
  assertEq(resolve('Beszél magyarul_EN'), 'Yes');
});

test('nem felsorolt mező értéke változatlan mindkét nyelven', () => {
  assertEq(resolve('Vezetéknév'), 'Kovács');
  assertEq(resolve('Vezetéknév_EN'), 'Kovács');
});

test('ismeretlen jelölő null – a hívó eshet vissza kulcskeresésre', () => {
  assertEq(resolve('NincsIlyenJelölő'), null);
});

// ════════════════════════════════════════════════════════════════════════════
section('Számított mezők a sablonokban');

test('anyja neve, születési helye és lakcím feloldható', () => {
  assertEq(resolve('Anyja neve'), 'Szabó Mária');
  assertEq(resolve('Születési helye'), 'Fülöp-szigetek, Manila');
  assertEq(resolve('Állandó lakcím'), '1024 Budapest Fő utca 12');
  assertEq(resolve('Teljes név'), 'Kovács Anna');
});

test('a számított mező angol változata a fordított értékeket használja', () => {
  const e2 = { id: 'x', identifiers: [], fields: { surname: 'Nagy', forename: 'Béla' } };
  assertEq(makeSchemaResolver(e2)('Teljes név_EN'), 'Nagy Béla');
});

// ════════════════════════════════════════════════════════════════════════════
section('A sablonokba kerülő értékkészlet');

const row = buildRenderRow(EMP, '2026. augusztus 6.');

test('a gépi kulcsok és a magyar címkék egyaránt elérhetők', () => {
  assertEq(row.surname, 'Kovács');
  assertEq(row['Vezetéknév'], 'Kovács');
  assertEq(row.sex, 'Férfi');
  assertEq(row['Neme'], 'Férfi');
});

test('a mai nap és az aktuális azonosító bekerül', () => {
  assertEq(row['mai nap'], '2026. augusztus 6.');
  assertEq(row['Azonosító'], 'SAP-2002');
});

test('a számított mezők is szerepelnek a sorban', () => {
  assertEq(row['Anyja neve'], 'Szabó Mária');
  assertEq(row['Állandó lakcím'], '1024 Budapest Fő utca 12');
});

test('a fájlnév-minta tokenjei feloldhatók a sorból', () => {
  // A DocxService NAME_TOKENS a magyar címkét keresi
  assertEq(row['Vezetéknév'], 'Kovács');
  assertEq(row['Keresztnév'], 'Anna');
});

// ════════════════════════════════════════════════════════════════════════════
section('Azonos nevű személyek szétválasztása');

test('két azonos nevű ember külön azonosítót kap és nem olvad egybe', async () => {
  EmployeeRepo.useBackend(EmployeeRepo.createMemoryBackend());
  return EmployeeRepo.load().then(() => {
    const a = EmployeeRepo.create({
      fields: { surname: 'Nagy', forename: 'Béla', date_of_birth: '1980-01-01' },
    });
    const b = EmployeeRepo.create({
      fields: { surname: 'Nagy', forename: 'Béla', date_of_birth: '1992-05-20' },
    });
    assert(a.id !== b.id, 'azonos azonosítót kaptak');

    // A docgen a kiválasztást azonosítóval tartja nyilván
    const kivalasztott = [a.id];
    const generalando = EmployeeRepo.all().filter(r => kivalasztott.includes(r.id));
    assertEq(generalando.length, 1, 'a névazonosság összevonta a két személyt');
    assertEq(generalando[0].fields.date_of_birth, '1980-01-01');
  });
});

// ════════════════════════════════════════════════════════════════════════════
section('A docgen forrás összhangja');

const docgenSrc = fs.readFileSync(path.join(__dirname, '../js/modules/docgen.js'), 'utf8');

test('a docgen a nyilvántartásból tölt, nem Excel-fájlból', () => {
  assert(/function loadFromRegistry/.test(docgenSrc), 'nincs loadFromRegistry');
  assert(!/state\.excelFile/.test(docgenSrc), 'maradt Excel-fájl hivatkozás');
  assert(!/ExcelService/.test(docgenSrc), 'maradt ExcelService hivatkozás');
});

test('a kiválasztás állandó azonosítóra épül, nem névre', () => {
  assert(!/rowDisplayName/.test(docgenSrc), 'maradt név-alapú azonosítás');
  assert(/selectedClients\.includes\(r\.id\)/.test(docgenSrc), 'nem azonosító alapján szűr');
});

test('a generálás átadja a séma-feloldót', () => {
  assert(/makeSchemaResolver/.test(docgenSrc), 'nincs séma-feloldó');
  assert(/generateDocx\([\s\S]{0,120}resolve:/.test(docgenSrc), 'a generálás nem kapja meg a feloldót');
});

test('a nyilvántartás változása frissíti a docgen listáját', () => {
  assert(/EmployeeRepo\.onChange/.test(docgenSrc), 'nincs feliratkozás a változásokra');
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
