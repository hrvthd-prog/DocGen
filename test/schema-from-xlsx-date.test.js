'use strict';

// Dátumoszlop-felismerés a séma-generálásban (schema-from-xlsx).
// Futtatás: node test/schema-from-xlsx-date.test.js
//
// Memóriában épített adatbekérő-szerű munkafüzeten méri, hogy az analyze a
// valódi dátumcellát (és a szövegben tárolt év-elöl alakot) dátumnak látja-e,
// a puszta számot (azonosító) NEM, és hogy a diff/apply ebből date típusú
// mezőt csinál, illetve a szövegként tárolt dátummezőt date-re javasolja.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '\n    ' + e.message); failed++; }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function assertEq(a, b, m) { if (a !== b) throw new Error(`${m || 'assertEq'}: várt ${JSON.stringify(b)}, kapott ${JSON.stringify(a)}`); }

const s = {
  console, Date, Math, JSON, Set, Map, Object, Array, String, Number, Boolean,
  Error, RegExp, Promise, isNaN, parseInt, parseFloat, Uint8Array, ArrayBuffer,
  DataView, TextDecoder, TextEncoder, Buffer,
};
s.window = s; s.globalThis = s; s.self = s;
vm.createContext(s);
const load = (rel, name) => vm.runInContext(
  fs.readFileSync(path.join(__dirname, rel), 'utf8') + (name ? `\nglobalThis.${name}=${name};` : ''),
  s, { filename: rel });
load('../vendor/xlsx.full.min.js');
load('../vendor/pizzip.min.js');
load('../js/schema/value-codec.js',       'ValueCodec');
load('../js/schema/seed-schema.js',       'SEED_SCHEMA');
load('../js/schema/schema-store.js',      'SchemaStore');
load('../js/schema/schema-from-xlsx.js',  'SchemaFromXlsx');

const { XLSX, SchemaStore, SEED_SCHEMA, SchemaFromXlsx } = s;

// Adatbekérő-szerű munkafüzet: 1. sor kulcs, 2. sor címke, 3. sortól adat.
function buildWb() {
  const aoa = [
    ['date_of_birth', 'pp_number',  'custom_date',            'note'],
    ['Date of Birth', 'Passport No','Custom Date',            'Note'],
    [new Date(Date.UTC(1988,3,12)), 123456789, '2027.05.11.', 'valami'],
    [new Date(Date.UTC(1990,0,5)),  987654321, '2028.10.02.', 'más'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Data');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

const buf = buildWb();
const analysis = SchemaFromXlsx.analyze(buf);
const col = k => analysis.columns.find(c => c.key === k);

console.log('\n[Dátumoszlop-felismerés]');

test('valódi Excel-dátumcella oszlopa dátum', () => {
  assertEq(col('date_of_birth').isDate, true);
});
test('szövegben tárolt év-elöl dátum oszlopa is dátum', () => {
  assertEq(col('custom_date').isDate, true);
});
test('numerikus azonosító NEM dátum', () => {
  assertEq(col('pp_number').isDate, false);
});
test('sima szöveg NEM dátum', () => {
  assertEq(col('note').isDate, false);
});

// Séma, ahol a date_of_birth SZÖVEG (mint egy korábban sablonból épített sémában).
const schemaTextDob = {
  version: 1,
  groups: [{ key: 'alap', label: { hu: 'Alap', en: 'Basic' } }, { key: 'egyeb', label: { hu: 'Egyéb', en: 'Other' } }],
  fields: [
    { key: 'date_of_birth', group: 'alap', type: 'text', label: { hu: 'Születési idő', en: 'Date of Birth' }, tags: [] },
    { key: 'pp_number',     group: 'alap', type: 'text', label: { hu: 'Útlevélszám',   en: 'Passport No' },  tags: [] },
  ],
};
const d = SchemaFromXlsx.diff(analysis, schemaTextDob);

test('a szövegként tárolt dátummező typeChanged javaslatot kap', () => {
  assert(d.typeChanged.some(t => t.key === 'date_of_birth' && t.to === 'date'),
    'nincs date_of_birth a typeChanged-ben');
});
test('a numerikus azonosító NEM kap typeChanged-et', () => {
  assert(!d.typeChanged.some(t => t.key === 'pp_number'), 'pp_number tévesen dátumnak minősült');
});
test('az új dátumoszlop added-ként, isDate=true', () => {
  const a = d.added.find(x => x.key === 'custom_date');
  assert(a && a.isDate === true, 'custom_date nem isDate added');
});

const applied = SchemaFromXlsx.apply(schemaTextDob, d, {
  added: ['custom_date', 'note'],
  typeChanged: ['date_of_birth'],
});
const field = k => applied.schema.fields.find(f => f.key === k);

test('apply: date_of_birth date típusú lett', () => {
  assertEq(field('date_of_birth').type, 'date');
});
test('apply: az új dátumoszlop date típusú', () => {
  assertEq(field('custom_date').type, 'date');
});
test('apply: a sima szövegoszlop text maradt', () => {
  assertEq(field('note').type, 'text');
});

// Végponttól végpontig: date típussal a render magyar alakot ad.
SchemaStore.loadFrom(applied.schema);
test('date típus után a render magyar alakot ad (custom_date)', () => {
  assertEq(SchemaStore.renderTag('custom_date', { custom_date: '2027-05-11' }), '2027.05.11.');
});

console.log('\n' + '='.repeat(60));
console.log(`Eredmény: ${passed} sikeres / ${failed} hibás (összesen ${passed + failed})`);
console.log(failed ? 'VAN hibás ✗' : 'Mind sikeres ✓');
process.exit(failed ? 1 : 0);
