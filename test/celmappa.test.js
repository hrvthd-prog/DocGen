'use strict';

// A 09_OIF_kerelmek szerkezete: hova kerül egy generált irat, és megtalálja-e a
// program a dolgozó mappáját (plans/TERV-kimenet-es-ugyek.md 3.).
// Futtatás: node test/celmappa.test.js
//
// A tévedés itt két irányba drága: rossz helyre írt irat (a feltöltésnél hiányzik),
// vagy egy második, párhuzamos dolgozói mappa (eltérő névformából). A fájlrendszert
// egy minimális handle-utánzat adja, a valódi fs-service.js-en át.

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

const sandbox = {
  console, Date, Math, JSON, Set, Map, WeakMap, WeakSet, Object, Array, String, Number,
  Boolean, Error, RegExp, Promise, isNaN, parseInt, parseFloat, setTimeout, clearTimeout,
  Blob: class {}, window: {},
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const [rel, name] of [
  ['../js/services/fs-service.js', 'FsService'],
  ['../js/modules/docgen/celmappa.js', 'DocgenCelmappa'],
]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, rel), 'utf8') + `\nglobalThis.${name} = ${name};`,
    sandbox, { filename: rel });
}
const C = sandbox.DocgenCelmappa;

// ── mappa-utánzat: { név: almappa-objektum } ────────────────────────────────
function dir(name, sub = {}) {
  const d = {
    name, kind: 'directory', sub,
    async getDirectoryHandle(n, { create } = {}) {
      if (sub[n]) return sub[n];
      if (create) return (sub[n] = dir(n));
      const e = new Error(n); e.name = 'NotFoundError'; throw e;
    },
    entries() {
      const items = Object.entries(sub);
      return (async function* () { for (const it of items) yield it; })();
    },
  };
  return d;
}
/** A 09_OIF_kerelmek üres váza, plusz a megadott dolgozói mappák. */
function oif({ hosszabbitas = {}, kiadas = [] } = {}) {
  const honapok = {};
  for (const [h, nevek] of Object.entries(hosszabbitas)) {
    honapok[h] = dir(h, Object.fromEntries(nevek.map(n => [n, dir(n)])));
  }
  return dir('09_OIF_kerelmek', {
    '01_Hosszabbitasok': dir('01_Hosszabbitasok', honapok),
    '02_Kiadasok': dir('02_Kiadasok', Object.fromEntries(kiadas.map(n => [n, dir(n)]))),
    '03_Bejelentesek': dir('03_Bejelentesek', {
      '01_Munkaviszony_megszunes': dir('01_Munkaviszony_megszunes'),
      '02_Szallashelyvaltozasok': dir('02_Szallashelyvaltozasok'),
    }),
  });
}
const nemKerdez = async () => { throw new Error('nem kellett volna kérdeznie'); };
const alap = { sablon: 'Adatlap', ma: '2026-10-29', kerdez: nemKerdez };

async function main() {
  section('Szabály: melyik irat hova');
  await test('kérelem irata a dolgozó 01_Elokeszitett mappájába, a kész PDF a 02-be', async () => {
    assertEq(C.szabaly('Adatlap').dolgozo, '01_Elokeszitett');
    assertEq(C.szabaly('Kész nyomtatvány', { kesz: true }).dolgozo, '02_Feltoltheto');
  });
  await test('a TAJ-sablonok a 04_TAJ-ba (a kész PDF-jelölés is)', async () => {
    for (const n of ['TAJ-igénylőlap (NYT.53)', 'TAJ-meghatalmazás', 'TAJ-megrendelő (NYT.52)']) {
      assertEq(C.szabaly(n, { kesz: true }).dolgozo, '04_TAJ', n);
    }
    assertEq(C.szabaly('Tajékoztató').dolgozo, '01_Elokeszitett', 'csak a „TAJ-” előtag számít');
  });
  await test('a bejelentések a 03_Bejelentesek alá, a szálláshely a generálás hónapjába', async () => {
    const tipusSablonok = {
      munkaviszony_kijelentes: ['Munkavállalói nyilatkozat foglalkoztatóváltásról'],
      szallashely_valtozas: ['Szálláshely-bejelentő'],
    };
    assertEq(C.szabaly('Munkavállalói nyilatkozat foglalkoztatóváltásról', { tipusSablonok }).ut.join('/'),
      '03_Bejelentesek/01_Munkaviszony_megszunes');
    assertEq(C.szabaly('Szálláshely-bejelentő', { tipusSablonok, ma: '2026-10-29' }).ut.join('/'),
      '03_Bejelentesek/02_Szallashelyvaltozasok/2026.10');
  });
  await test('új dolgozói mappa: hosszabbításnál a lejárat hónapja, kiadásnál név szerint', async () => {
    assertEq(C.ujDolgozoUt({ ugyTipus: 'rp_hosszabbitas', lejarat: '2026-12-14', nev: 'John Doe' }).join('/'),
      '01_Hosszabbitasok/2026.12/John Doe');
    assertEq(C.ujDolgozoUt({ ugyTipus: 'rp_elso', nev: 'John Doe' }).join('/'), '02_Kiadasok/John Doe');
    assertEq(C.ujDolgozoUt({ ugyTipus: 'rp_hosszabbitas', nev: 'John Doe' }), null, 'lejárat nélkül kérdezni kell');
    assertEq(C.ujDolgozoUt({ ugyTipus: null, nev: 'John Doe' }), null);
  });

  section('A dolgozó megtalálása');
  await test('pontos egyezés ékezet-, kis-nagybetű- és szóközfüggetlenül, bármely ékezettel', async () => {
    const m = [{ nev: 'Nguyễn Thị Hạnh' }, { nev: 'Kiss Anna' }];
    assertEq(C.egyeztet('NGUYEN  thi hanh', m).pontos.length, 1);
    assertEq(C.egyeztet('Kíss Anna', m).pontos[0].nev, 'Kiss Anna');
  });
  await test('rész- vagy fordított egyezés nem pontos, csak hasonló (kérdés kell)', async () => {
    const m = [{ nev: 'Ali Khan' }, { nev: 'Doe John' }];
    const a = C.egyeztet('Ali', m);
    assertEq(a.pontos.length, 0); assertEq(a.hasonlo.length, 1);
    assertEq(C.egyeztet('John Doe', m).hasonlo[0].nev, 'Doe John');
    assertEq(C.egyeztet('Nagy Béla', m).hasonlo.length, 0);
  });

  section('Célmappa a mappaszerkezetben');
  await test('meglévő hosszabbítási mappa bármelyik hónap alatt', async () => {
    const root = oif({ hosszabbitas: { '2026.11': ['Kiss Anna'], '2026.12': ['John Doe'] } });
    const r = await C.cel(root, Object.assign({ empId: 'e1', nev: 'John Doe' }, alap));
    assertEq(r.ut.join('/'), '01_Hosszabbitasok/2026.12/John Doe/01_Elokeszitett');
    const wd = root.sub['01_Hosszabbitasok'].sub['2026.12'].sub['John Doe'];
    assertEq(Object.keys(wd.sub).sort().join(','), '01_Elokeszitett,02_Feltoltheto,03_Beerkezett,04_TAJ');
  });
  await test('meglévő kiadási mappa; a TAJ a 04_TAJ-ba', async () => {
    const root = oif({ kiadas: ['Jane Doe'] });
    const r = await C.cel(root, Object.assign({}, alap, { empId: 'e2', nev: 'Jane Doe', sablon: 'TAJ-meghatalmazás' }));
    assertEq(r.ut.join('/'), '02_Kiadasok/Jane Doe/04_TAJ');
  });
  await test('nincs mappa, nyitott hosszabbítás → létrehozza a lejárat hónapjában, kérdés nélkül', async () => {
    const root = oif({ hosszabbitas: { '2026.11': ['Kiss Anna'] } });
    const r = await C.cel(root, Object.assign({}, alap,
      { empId: 'e3', nev: 'Nomen Nescio', ugyTipus: 'rp_hosszabbitas', lejarat: '2027-01-20' }));
    assertEq(r.ut.join('/'), '01_Hosszabbitasok/2027.01/Nomen Nescio/01_Elokeszitett');
    assert(root.sub['01_Hosszabbitasok'].sub['2027.01'], 'a hónapmappa létrejött');
  });
  await test('hasonló nevű mappa van → kérdez, és NEM hoz létre újat magától', async () => {
    const root = oif({ kiadas: ['Doe John'] });
    let kerdes = null;
    const r = await C.cel(root, Object.assign({}, alap, {
      empId: 'e4', nev: 'John Doe', ugyTipus: 'rp_elso',
      kerdez: async q => { kerdes = q; return q.hasonlo[0].ut; },
    }));
    assertEq(kerdes.hasonlo.length, 1);
    assertEq(r.ut.join('/'), '02_Kiadasok/Doe John/01_Elokeszitett');
    assert(!root.sub['02_Kiadasok'].sub['John Doe'], 'párhuzamos mappa keletkezett');
  });
  await test('a válasz munkamenetre megmarad (egy kötegben egyszer kérdez)', async () => {
    const root = oif();
    let db = 0;
    const p = Object.assign({}, alap, { empId: 'e5', nev: 'Kis Pál',
      kerdez: async q => { db++; return q.javaslatok.find(u => u[0] === '02_Kiadasok'); } });
    await C.cel(root, p);
    await C.cel(root, Object.assign({}, p, { sablon: 'Másik irat' }));
    assertEq(db, 1);
  });
  await test('„kihagyás” → null, és nem jön létre semmi', async () => {
    const root = oif();
    const r = await C.cel(root, Object.assign({}, alap, { empId: 'e6', nev: 'Senki', kerdez: async () => null }));
    assertEq(r, null);
    assertEq(Object.keys(root.sub['02_Kiadasok'].sub).length, 0);
  });
  await test('bejelentés: a hónapmappa létrejön, dolgozói mappa nem kell', async () => {
    const root = oif();
    const r = await C.cel(root, Object.assign({}, alap, { empId: 'e7', nev: 'Bárki', sablon: 'Lakcím',
      tipusSablonok: { szallashely_valtozas: ['Lakcím'] } }));
    assertEq(r.ut.join('/'), '03_Bejelentesek/02_Szallashelyvaltozasok/2026.10');
  });
  await test('nem a 09_OIF_kerelmek → hiba, és nem nő ott szerkezet', async () => {
    const idegen = dir('Dokumentumok', { 'nyaralas': dir('nyaralas') });
    let uzenet = '';
    try { await C.cel(idegen, Object.assign({ empId: 'e8', nev: 'X Y' }, alap)); }
    catch (e) { uzenet = e.message; }
    assert(/Hiányzik: 01_Hosszabbitasok/.test(uzenet), uzenet || 'nem dobott');
    assertEq(Object.keys(idegen.sub).join(), 'nyaralas');
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
