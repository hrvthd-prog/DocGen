'use strict';

// Az ügy- és dolgozói kimutatás (CaseXlsx) tesztjei.
// Futtatás: node test/case-xlsx.test.js
//
// A súlypont azon van, amiért a kimutatás készült: az ügyszám (EH szám) és az
// iktatószám épségben, SZÖVEGKÉNT kerüljön ki — ezeket az Excel szívesen
// számmá vagy dátummá alakítaná, és akkor hatóság előtt használhatatlanok.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
const failures = [];

async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
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

// ── Sandbox ─────────────────────────────────────────────────────────────────
// Az ExcelJS böngészős bundle-jét kívülről injektáljuk (lásd xlsx.test.js).
const ExcelJS = require(path.join(__dirname, '../vendor/exceljs.min.js'));

const sandbox = {
  console, Date, Math, JSON, Set, Map, Object, Array, String, Number, Boolean,
  Error, RegExp, Promise, isNaN, parseInt, parseFloat, isFinite,
  Uint8Array, Uint16Array, Int32Array, Float64Array, ArrayBuffer, DataView,
  TextDecoder, TextEncoder, Buffer, setTimeout, clearTimeout, crypto,
  ExcelJS,
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);

for (const [rel, name] of [
  ['../js/services/employee-repo.js', 'EmployeeRepo'],
  ['../js/schema/value-codec.js',     'ValueCodec'],
  ['../js/schema/seed-schema.js',     'SEED_SCHEMA'],
  ['../js/schema/schema-store.js',    'SchemaStore'],
  ['../js/schema/export-profiles.js', 'ExportProfiles'],
  ['../js/schema/case-types.js',      'CaseTypes'],
  ['../js/services/case-repo.js',     'CaseRepo'],
  ['../js/services/case-xlsx.js',     'CaseXlsx'],
]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, rel), 'utf8') +
    `\nglobalThis.${name} = ${name};`, sandbox, { filename: rel });
}
const { SchemaStore, SEED_SCHEMA, ExportProfiles, CaseTypes, CaseRepo,
        CaseXlsx, EmployeeRepo } = sandbox;

SchemaStore.loadFrom(SEED_SCHEMA);
ExportProfiles.loadFrom(null);
CaseTypes.loadFrom(null);

async function tisztaAllapot() {
  EmployeeRepo.useBackend(EmployeeRepo.createMemoryBackend());
  CaseRepo.useBackend(CaseRepo.createMemoryBackend());
  await EmployeeRepo.load();
  await CaseRepo.load();
}

/** A kiírt puffer visszaolvasva — így azt mérjük, ami tényleg a fájlba került. */
async function visszaolvas() {
  const { buffer } = await CaseXlsx.toBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
}

/** Egy lap sorai egyszerű string-tömbökként. */
function sorok(ws) {
  const out = [];
  ws.eachRow(r => {
    const s = [];
    r.eachCell({ includeEmpty: true }, c => s.push(c.value == null ? '' : String(c.value)));
    out.push(s);
  });
  return out;
}

(async () => {

  section('Szerkezet');

  await test('Két lap készül: Ügyek és Dolgozók', async () => {
    await tisztaAllapot();
    const wb = await visszaolvas();
    assert(wb.getWorksheet('Ügyek'), 'hiányzik az Ügyek lap');
    assert(wb.getWorksheet('Dolgozók'), 'hiányzik a Dolgozók lap');
  });

  await test('Üres nyilvántartásból is kész fájl lesz, csak fejléccel', async () => {
    await tisztaAllapot();
    const wb = await visszaolvas();
    assertEq(sorok(wb.getWorksheet('Ügyek')).length, 1, 'üresen is került adatsor a lapra');
  });

  await test('Az EH szám és az iktatószám önálló oszlop', async () => {
    await tisztaAllapot();
    const fej = sorok((await visszaolvas()).getWorksheet('Ügyek'))[0];
    assert(fej.includes('EH szám'), `nincs EH szám oszlop: ${fej.join(' | ')}`);
    assert(fej.includes('Iktatószám'), `nincs Iktatószám oszlop: ${fej.join(' | ')}`);
  });

  section('Tartalom');

  await test('Az ügy sora a dolgozó nevével és az azonosítókkal megy ki', async () => {
    await tisztaAllapot();
    const e = EmployeeRepo.create({ fields: { surname: 'Nagy', forename: 'Béla' } });
    CaseRepo.create({
      employeeId: e.id, type: 'rp_hosszabbitas',
      ehNumber: 'EH-12345/2026', fileNumber: '106-1-1234/5/2026-H',
    });
    const s = sorok((await visszaolvas()).getWorksheet('Ügyek'));
    assertEq(s.length, 2, 'nem pontosan egy ügysor készült');
    const fej = s[0], sor = s[1];
    assertEq(sor[fej.indexOf('Dolgozó')], 'Nagy Béla');
    assertEq(sor[fej.indexOf('EH szám')], 'EH-12345/2026');
    assertEq(sor[fej.indexOf('Iktatószám')], '106-1-1234/5/2026-H');
  });

  await test('Az azonosítók SZÖVEG-formátumot kapnak, nem alakulnak át', async () => {
    // Ez a teszt lényege: a '106-1-1234/5/2026-H' alakú iktatószám és a
    // '2026-09-18' alakú dátum számként/dátumként is értelmezhető lenne.
    await tisztaAllapot();
    const e = EmployeeRepo.create({ fields: { surname: 'Kiss', forename: 'Anna' } });
    CaseRepo.create({ employeeId: e.id, type: 'rp_hosszabbitas', ehNumber: '20260918' });
    const ws = (await visszaolvas()).getWorksheet('Ügyek');
    const fej = sorok(ws)[0];
    const cella = ws.getRow(2).getCell(fej.indexOf('EH szám') + 1);
    assertEq(cella.numFmt, '@', 'az EH szám nem szöveg-formátumú — az Excel átalakíthatja');
    assertEq(String(cella.value), '20260918', 'az EH szám értéke megváltozott');
  });

  await test('A törölt dolgozóhoz tartozó ügy sem vész el', async () => {
    await tisztaAllapot();
    const e = EmployeeRepo.create({ fields: { surname: 'Tóth', forename: 'Pál' } });
    CaseRepo.create({ employeeId: e.id, type: 'rp_hosszabbitas' });
    EmployeeRepo.destroy(e.id);
    const s = sorok((await visszaolvas()).getWorksheet('Ügyek'));
    assertEq(s.length, 2, 'a gazdátlan ügy kimaradt a kimutatásból');
    assertEq(s[1][0], '(törölt személy)');
  });

  await test('A Dolgozók lap a séma oszlopaival és minden rekorddal áll', async () => {
    await tisztaAllapot();
    EmployeeRepo.create({ fields: { surname: 'Nagy', forename: 'Béla' } });
    EmployeeRepo.create({ fields: { surname: 'Kiss', forename: 'Anna' } });
    const s = sorok((await visszaolvas()).getWorksheet('Dolgozók'));
    assertEq(s.length, 3, 'nem minden dolgozó került ki');
    const oszlopok = ExportProfiles.columnsOf(ExportProfiles.get(), SchemaStore.get());
    assertEq(s[0].length, oszlopok.length, 'a fejléc nem a profil oszlopaiból áll');
  });

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`${passed} sikeres, ${failed} hibás`);
  if (failed) {
    for (const f of failures) console.log(`  ✗ ${f.name}: ${f.error}`);
    process.exit(1);
  }
})();
