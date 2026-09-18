'use strict';

// A PDF-lánc könyvelésének tesztjei.
// Futtatás: node test/pdf-chain.test.js
//
// A lánc közepén egy külső lépés áll (Word konverzió a docx-pdf.vbs-sel), amit
// böngészőből nem lehet elindítani. Ami ELLENŐRIZHETŐ, az a könyvelés: mi
// készült, miből lesz PDF, mi hiányzik még. Ezek tiszta függvények, a
// fájlműveletek külön élnek — ezért tesztelhető böngésző nélkül.

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

const sandbox = {
  console, Date, Math, JSON, Set, Map, Object, Array, String, Number, Boolean,
  Error, RegExp, Promise, isNaN, parseInt, parseFloat,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
{
  const rel = '../js/modules/docgen/pdf-chain.js';
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, rel), 'utf8') + '\nglobalThis.DocgenPdfChain = DocgenPdfChain;',
    sandbox, { filename: rel });
}
const { DocgenPdfChain: Lanc } = sandbox;

const GENERALT = [
  { name: 'Nagy Béla Nyilatkozat.docx',  clientName: 'Nagy Béla',  templateName: 'Nyilatkozat', vezeteknev: 'Nagy',  keresztnev: 'Béla' },
  { name: 'Nagy Béla Adatlap.docx',      clientName: 'Nagy Béla',  templateName: 'Adatlap',     vezeteknev: 'Nagy',  keresztnev: 'Béla' },
  { name: 'Kis Éva Nyilatkozat.docx',    clientName: 'Kis Éva',    templateName: 'Nyilatkozat', vezeteknev: 'Kis',   keresztnev: 'Éva' },
];

section('Fájlnév-leképezés');

test('A DOCX-ből PDF-név lesz, a kiterjesztés kis-nagybetűtől függetlenül', () => {
  assertEq(Lanc.pdfName('Nagy Béla Nyilatkozat.docx'), 'Nagy Béla Nyilatkozat.pdf');
  assertEq(Lanc.pdfName('Kis Éva Adatlap.DOCX'),       'Kis Éva Adatlap.pdf');
});

test('A pontot tartalmazó név nem törik el', () => {
  assertEq(Lanc.pdfName('Dr. Nagy B. Nyilatkozat.docx'), 'Dr. Nagy B. Nyilatkozat.pdf');
});

section('Kísérőfájl');

test('Minden generált dokumentum bekerül', () => {
  const m = Lanc.buildManifest(GENERALT, { at: '2026-09-18T08:00:00.000Z' });
  assertEq(m.version, 1);
  assertEq(m.at, '2026-09-18T08:00:00.000Z');
  assertEq(m.files.length, 3);
});

test('A név-tokenek is megőrződnek — e nélkül az összefűzött csomag névtelen lenne', () => {
  const m = Lanc.buildManifest(GENERALT);
  assertEq(m.files[0].lastName, 'Nagy');
  assertEq(m.files[0].firstName, 'Béla');
  assertEq(m.files[0].client, 'Nagy Béla');
  assertEq(m.files[0].template, 'Nyilatkozat');
});

test('Üres generálás sem dob', () => {
  assertEq(Lanc.buildManifest([]).files.length, 0);
  assertEq(Lanc.buildManifest(null).files.length, 0);
});

section('Összevetés a lemez tartalmával');

test('Minden PDF megvan → teljes', () => {
  const m = Lanc.buildManifest(GENERALT);
  const o = Lanc.compare(m, m.files.map(f => f.pdf));
  assertEq(o.vart, 3);
  assertEq(o.kesz, 3);
  assertEq(o.hianyzo.length, 0);
  assertEq(o.teljes, true);
});

test('Egy PDF hiányzik → pontosan az látszik hiányzónak', () => {
  const m = Lanc.buildManifest(GENERALT);
  const o = Lanc.compare(m, ['Nagy Béla Nyilatkozat.pdf', 'Kis Éva Nyilatkozat.pdf']);
  assertEq(o.kesz, 2);
  assertEq(o.hianyzo.length, 1);
  assertEq(o.hianyzo[0], 'Nagy Béla Adatlap.pdf');
  assertEq(o.teljes, false);
});

test('Egyetlen PDF sincs → nem „teljes”, és mind hiányzik', () => {
  const m = Lanc.buildManifest(GENERALT);
  const o = Lanc.compare(m, []);
  assertEq(o.kesz, 0);
  assertEq(o.hianyzo.length, 3);
  assertEq(o.teljes, false);
});

test('Korábbi futásból ottmaradt PDF idegenként számolódik, nem hiányként', () => {
  const m = Lanc.buildManifest(GENERALT);
  const o = Lanc.compare(m, [...m.files.map(f => f.pdf), 'Tavalyi valami.pdf']);
  assertEq(o.teljes, true);
  assertEq(o.idegen, 1);
});

test('Kísérőfájl nélkül nincs elvárás — nem hazudik teljeset', () => {
  const o = Lanc.compare(null, ['barmi.pdf']);
  assertEq(o.vart, 0);
  assertEq(o.teljes, false);
});

section('Állapotmondat');

test('Mindhárom állapotra más mondat jár', () => {
  const m = Lanc.buildManifest(GENERALT);
  const teljes  = Lanc.summaryText(Lanc.compare(m, m.files.map(f => f.pdf)));
  const felig   = Lanc.summaryText(Lanc.compare(m, ['Nagy Béla Nyilatkozat.pdf']));
  const semmi   = Lanc.summaryText(Lanc.compare(m, []));
  const nincs   = Lanc.summaryText(Lanc.compare(null, []));
  assert(teljes.includes('3'), teljes);
  assert(felig.includes('1') && felig.includes('3'), felig);
  assert(semmi.includes('PDF még egy sincs'), semmi);
  assert(nincs.includes('Nincs nyilvántartott'), nincs);
  assertEq(new Set([teljes, felig, semmi, nincs]).size, 4, 'két állapot ugyanazt a mondatot adja');
});

section('Időbélyeg');

test('A legfrissebb PDF ideje olvasható formában jelenik meg', () => {
  const sz = Lanc.idoSzoveg(Date.UTC(2026, 8, 18, 9, 5) + new Date(2026, 8, 18, 9, 5).getTimezoneOffset() * 0);
  assert(/^\d{4}\. \d{2}\. \d{2}\. \d{2}:\d{2}$/.test(Lanc.idoSzoveg(new Date(2026, 8, 18, 9, 5).getTime())),
    `váratlan formátum: ${sz}`);
  assertEq(Lanc.idoSzoveg(null), '');
});

console.log(`\n${'─'.repeat(60)}`);
console.log(`${passed} sikeres, ${failed} hibás`);
if (failed) {
  console.log('\nHibák:');
  failures.forEach(f => console.log(`  • ${f.name}: ${f.error}`));
  process.exit(1);
}
