'use strict';

// xlsx be- és kimenet tesztjei, körbe-teszttel a valódi adatbekérő ellen.
// Futtatás: node test/xlsx.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
const failures = [];
const queue = [];

function atest(name, fn) { queue.push({ name, fn }); }
function asection(name) { queue.push({ section: name }); }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function assertEq(a, b, m) {
  if (a !== b) throw new Error(`${m || 'assertEq'}: várt ${JSON.stringify(b)}, kapott ${JSON.stringify(a)}`);
}

// ── Sandbox ─────────────────────────────────────────────────────────────────
// Az ExcelJS böngészős bundle-je Node-ban CommonJS modulként töltődik be
// megbízhatóan, ezért azt kívülről injektáljuk a sandboxba.
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

vm.runInContext(fs.readFileSync(path.join(__dirname, '../vendor/xlsx.full.min.js'), 'utf8'),
  sandbox, { filename: 'xlsx.full.min.js' });

const modules = [
  ['../js/services/employee-repo.js', 'EmployeeRepo'],
  ['../js/schema/value-codec.js',     'ValueCodec'],
  ['../js/schema/seed-schema.js',     'SEED_SCHEMA'],
  ['../js/schema/schema-store.js',    'SchemaStore'],
  ['../js/schema/export-profiles.js', 'ExportProfiles'],
  ['../js/services/xlsx-write.js',    'XlsxWrite'],
  ['../js/services/xlsx-read.js',     'XlsxRead'],
];
for (const [rel, name] of modules) {
  let code = fs.readFileSync(path.join(__dirname, rel), 'utf8');
  code += `\nglobalThis.${name} = ${name};`;
  vm.runInContext(code, sandbox, { filename: rel });
}

const { SchemaStore, SEED_SCHEMA, ExportProfiles, XlsxWrite, XlsxRead, EmployeeRepo } = sandbox;

SchemaStore.loadFrom(SEED_SCHEMA);
ExportProfiles.loadFrom(null);
const PROFILE = ExportProfiles.get('horizontes');

const EREDETI = path.join(__dirname, 'fixtures/adatbekero-minta.xlsx');

/**
 * Az eredeti adatbekérő sorainak kiolvasása SheetJS-szel.
 * Az ExcelJS nem tudja beolvasni ezt a fájlt (a benne lévő cellakommentek
 * szerkezete miatt) – ezért az import ágon is a SheetJS a beolvasó.
 */
function eredetiSor(rowIndex) {
  const b = fs.readFileSync(EREDETI);
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  const wb = sandbox.XLSX.read(ab, { type: 'array' });
  const ws = wb.Sheets['Data'];
  const range = sandbox.XLSX.utils.decode_range(ws['!ref']);
  const out = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ws[sandbox.XLSX.utils.encode_cell({ r: rowIndex - 1, c })];
    const v = cell ? (cell.w != null ? cell.w : cell.v) : '';
    if (String(v || '').trim()) out.push(String(v).trim());
  }
  return out;
}

async function generalt(employees = []) {
  const buf = await XlsxWrite.toBuffer({
    schema: SchemaStore.get(), profile: PROFILE, employees,
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return { buf, wb };
}

// ════════════════════════════════════════════════════════════════════════════
asection('Üres sablon előállítása');

let G = null;
atest('a sablon legenerálható és megnyitható', async () => {
  G = await generalt();
  assert(G.wb.getWorksheet('Data'), 'nincs Data munkalap');
  assert(G.wb.getWorksheet('Útmutató'), 'nincs Útmutató munkalap');
});

atest('mind a 44 oszlop kikerül, az eredeti sorrendben', async () => {
  const ws = G.wb.getWorksheet('Data');
  const kulcsok = [];
  ws.getRow(1).eachCell({ includeEmpty: false }, c => kulcsok.push(String(c.value)));
  assertEq(kulcsok.length, 44);
  assertEq(kulcsok[0], 'personnel_reg_number');
  assertEq(kulcsok[1], 'surname');
  assertEq(kulcsok[43], 'previous_street');
});

atest('a 2. sorban az angol címkék állnak', async () => {
  const ws = G.wb.getWorksheet('Data');
  assertEq(String(ws.getRow(2).getCell(2).value), 'Surname (as in passport)');
});

atest('a kötelező mezők piros, az opcionálisak kék fejlécet kapnak', async () => {
  const ws = G.wb.getWorksheet('Data');
  const fill = c => (c.fill && c.fill.fgColor && c.fill.fgColor.argb) || '';
  assertEq(fill(ws.getRow(1).getCell(2)), 'FFC00000', 'surname nem piros');   // kötelező
  assertEq(fill(ws.getRow(1).getCell(1)), 'FF1F3864', 'törzsszám nem kék');   // opcionális
  assertEq(fill(ws.getRow(2).getCell(2)), 'FF1F3864', 'a címkesor nem kék');
});

atest('a fejlécsor rögzítve van, hogy görgetéskor látszódjon', async () => {
  const ws = G.wb.getWorksheet('Data');
  const v = ws.views && ws.views[0];
  assertEq(v && v.state, 'frozen');
  assertEq(v && v.ySplit, 2);
});

atest('a fejléc-cellákban magyar magyarázó komment van', async () => {
  const ws = G.wb.getWorksheet('Data');
  const note = ws.getRow(1).getCell(2).note;
  const szoveg = typeof note === 'string' ? note : (note.texts || []).map(t => t.text).join('');
  assert(szoveg.includes('Vezetéknév'), 'nincs magyar jelentés a kommentben');
  assert(szoveg.includes('KÖTELEZŐ'), 'a kötelezőség nincs jelezve');
});

atest('a választható mezőkre legördülő kerül a helyes értékkészlettel', async () => {
  const ws = G.wb.getWorksheet('Data');
  const dv = ws.dataValidations;
  const model = (dv && dv.model) || {};
  const talalt = {};
  for (const [range, def] of Object.entries(model)) {
    if (def.type !== 'list') continue;
    const betu = /^([A-Z]+)/.exec(range)[1];
    talalt[betu] = String(def.formulae[0]).replace(/^"|"$/g, '');
  }
  // sex = F oszlop (6.), marital_status = M (13.)
  assertEq(talalt['F'], 'male,female', 'a nem legördülője hibás');
  assertEq(talalt['M'], 'unmarried,married,divorced,widow', 'a családi állapot legördülője hibás');
  assertEq(Object.keys(talalt).length, 5, 'nem pontosan 5 legördülő van');
});

atest('az útmutató munkalap a sémából generálódik', async () => {
  const ws = G.wb.getWorksheet('Útmutató');
  let talalt = false;
  ws.eachRow(r => {
    if (String(r.getCell(1).value || '') === 'sex') {
      talalt = true;
      assertEq(String(r.getCell(2).value), 'Neme');
      assert(String(r.getCell(5).value).includes('male = Férfi'), 'nincs értékmagyarázat');
    }
  });
  assert(talalt, 'a sex mező nem szerepel az útmutatóban');
});

// ════════════════════════════════════════════════════════════════════════════
asection('Szerkezeti egyezés az eredeti adatbekérővel');

atest('az oszlopkulcsok és a sorrend megegyezik az eredetivel', async () => {
  const wg = G.wb.getWorksheet('Data');
  const generaltKulcsok = [];
  wg.getRow(1).eachCell({ includeEmpty: false }, c => generaltKulcsok.push(String(c.value).trim()));
  assertEq(generaltKulcsok.join(','), eredetiSor(1).join(','), 'eltérő oszlopkulcs vagy sorrend');
});

atest('az angol címkék megegyeznek az eredetivel', async () => {
  const wg = G.wb.getWorksheet('Data');
  const generaltCimkek = [];
  wg.getRow(2).eachCell({ includeEmpty: false }, c => generaltCimkek.push(String(c.value).trim()));
  assertEq(generaltCimkek.join('|'), eredetiSor(2).join('|'), 'eltérő angol címke');
});

// ════════════════════════════════════════════════════════════════════════════
asection('Feltöltött export');

atest('a rekordok adatai a helyes oszlopokba kerülnek', async () => {
  const emp = [{ fields: {
    surname: 'Kovács', forename: 'Anna', date_of_birth: '1990-03-15',
    citizenship: 'Fülöp-szigeteki', sex: 'male', marital_status: 'married',
    gross_salary: '450000',
  } }];
  const { wb } = await generalt(emp);
  const ws = wb.getWorksheet('Data');
  const r = ws.getRow(3);
  assertEq(String(r.getCell(2).value), 'Kovács');
  assertEq(String(r.getCell(3).value), 'Anna');
  assertEq(String(r.getCell(4).value), '1990-03-15');
});

atest('a választható értékek a Horizontes által várt kanonikus alakban mennek ki', async () => {
  const emp = [{ fields: { surname: 'K', forename: 'A', sex: 'male', marital_status: 'married',
                           educational_attainment: 'tertiary', speaks_hungarian: 'yes' } }];
  const { wb } = await generalt(emp);
  const ws = wb.getWorksheet('Data');
  const r = ws.getRow(3);
  assertEq(String(r.getCell(6).value), 'male', 'a nem nem kanonikus alakban ment ki');
  assertEq(String(r.getCell(13).value), 'married', 'a családi állapot nem kanonikus');
});

atest('magyar kimeneti profil esetén magyarul kerülnek ki az értékek', async () => {
  const p = Object.assign({}, PROFILE, { enumEncoding: 'hu' });
  const buf = await XlsxWrite.toBuffer({
    schema: SchemaStore.get(), profile: p,
    employees: [{ fields: { surname: 'K', sex: 'male', marital_status: 'married' } }],
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const r = wb.getWorksheet('Data').getRow(3);
  assertEq(String(r.getCell(6).value), 'Férfi');
  assertEq(String(r.getCell(13).value), 'Házas');
});

// ════════════════════════════════════════════════════════════════════════════
asection('Körbe-teszt: export → import');

atest('a kiexportált adat visszaolvasva ugyanaz', async () => {
  const eredetiAdat = {
    surname: 'Kovács', forename: 'Anna', date_of_birth: '1990-03-15',
    citizenship: 'Fülöp-szigeteki', sex: 'female', marital_status: 'divorced',
    educational_attainment: 'secondary', speaks_hungarian: 'no',
    passport_type: 'official', postal_code: '1024', locality: 'Budapest',
  };
  const { buf } = await generalt([{ fields: eredetiAdat }]);
  const { rows } = XlsxRead.readRows(buf, { schema: SchemaStore.get() });

  assertEq(rows.length, 1, 'nem pontosan egy sor olvasódott vissza');
  for (const [k, v] of Object.entries(eredetiAdat)) {
    assertEq(rows[0].fields[k], v, `a(z) ${k} mező megváltozott a körben`);
  }
  assertEq(rows[0].problems.length, 0, 'váratlan olvasási gond: ' + rows[0].problems.join('; '));
});

atest('az eredeti adatbekérő üres sablonja gond nélkül beolvasható', async () => {
  const buf = fs.readFileSync(EREDETI);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const { rows, unknownColumns } = XlsxRead.readRows(ab, { schema: SchemaStore.get() });
  assertEq(rows.length, 0, 'üres sablonból adatsor keletkezett');
  assertEq(unknownColumns.length, 0, 'ismeretlen oszlop: ' + unknownColumns.join(', '));
});

// ════════════════════════════════════════════════════════════════════════════
asection('Import: magyar és angol kitöltés');

atest('magyarul kitöltött táblázat is beolvasható', async () => {
  // Kézzel írt tábla: magyar értékek, magyar fejlécnevek
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.getRow(1).values = ['surname', 'forename', 'sex', 'marital_status', 'educational_attainment'];
  ws.getRow(2).values = ['x', 'x', 'x', 'x', 'x'];
  ws.getRow(3).values = ['Nagy', 'Béla', 'Férfi', 'Házas', 'Felsőfokú'];
  ws.getRow(4).values = ['Tóth', 'Éva', 'nő', 'özvegy', 'alapfokú'];
  const buf = await wb.xlsx.writeBuffer();

  const { rows } = XlsxRead.readRows(buf, { schema: SchemaStore.get() });
  assertEq(rows.length, 2);
  assertEq(rows[0].fields.sex, 'male');
  assertEq(rows[0].fields.marital_status, 'married');
  assertEq(rows[0].fields.educational_attainment, 'tertiary');
  assertEq(rows[1].fields.sex, 'female');
  assertEq(rows[1].fields.marital_status, 'widow');
});

atest('ismeretlen választható érték nem vész el, de jelezve lesz', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.getRow(1).values = ['surname', 'sex'];
  ws.getRow(2).values = ['x', 'x'];
  ws.getRow(3).values = ['Nagy', 'egyéb'];
  const buf = await wb.xlsx.writeBuffer();

  const { rows } = XlsxRead.readRows(buf, { schema: SchemaStore.get() });
  assertEq(rows[0].fields.sex, 'egyéb', 'az eredeti érték elveszett');
  assert(rows[0].problems.length > 0, 'nem jelezte az ismeretlen értéket');
});

atest('elterjedt dátumalakok ISO-ra alakulnak', async () => {
  assertEq(XlsxRead._toIsoDate('1990-03-15'), '1990-03-15');
  assertEq(XlsxRead._toIsoDate('1990.03.15.'), '1990-03-15');
  assertEq(XlsxRead._toIsoDate('1990/3/5'), '1990-03-05');
  assertEq(XlsxRead._toIsoDate('nem dátum'), null);
});

// ════════════════════════════════════════════════════════════════════════════
asection('Import-terv: párosítás az azonosító-történettel');

atest('új személy létrehozása, meglévő frissítése', async () => {
  EmployeeRepo.useBackend(EmployeeRepo.createMemoryBackend());
  await EmployeeRepo.load();
  const meglevo = EmployeeRepo.create({
    fields: { surname: 'Kovács', forename: 'Anna', date_of_birth: '1990-03-15' },
    identifiers: [{ type: 'sap', value: 'SAP-111' }],
  });

  const rows = [
    { excelRow: 3, fields: { surname: 'Kovács', forename: 'Anna', date_of_birth: '1990-03-15',
                             citizenship: 'magyar', personnel_reg_number: 'SAP-111' }, problems: [] },
    { excelRow: 4, fields: { surname: 'Új', forename: 'Ember', date_of_birth: '1985-01-01',
                             citizenship: 'magyar' }, problems: [] },
  ];
  const terv = XlsxRead.plan(rows, { schema: SchemaStore.get() });
  assertEq(terv[0].action, 'update');
  assertEq(terv[0].matchedBy, 'identifier');
  assertEq(terv[0].employee.id, meglevo.id);
  assertEq(terv[1].action, 'create');
});

atest('a LEJÁRT SAP-számmal érkező sor is a meglévő személyre talál', async () => {
  EmployeeRepo.useBackend(EmployeeRepo.createMemoryBackend());
  await EmployeeRepo.load();
  const e = EmployeeRepo.create({
    fields: { surname: 'Kovács', forename: 'Anna' },
    identifiers: [{ type: 'sap', value: 'SAP-111' }],
  });
  EmployeeRepo.addIdentifier(e.id, { type: 'sap', value: 'SAP-222' });

  const terv = XlsxRead.plan(
    [{ excelRow: 3, fields: { surname: 'Kovács', forename: 'Anna', personnel_reg_number: 'SAP-111' }, problems: [] }],
    { schema: SchemaStore.get() });
  assertEq(terv[0].action, 'update', 'duplikátumot hozott volna létre');
  assertEq(terv[0].employee.id, e.id);
});

atest('fájlon belüli duplikátumot kiszűr', async () => {
  EmployeeRepo.useBackend(EmployeeRepo.createMemoryBackend());
  await EmployeeRepo.load();
  const rows = [
    { excelRow: 3, fields: { surname: 'Nagy', forename: 'Béla', date_of_birth: '1980-01-01' }, problems: [] },
    { excelRow: 4, fields: { surname: 'Nagy', forename: 'Béla', date_of_birth: '1980-01-01' }, problems: [] },
  ];
  const terv = XlsxRead.plan(rows, { schema: SchemaStore.get() });
  assertEq(terv[0].action, 'create');
  assertEq(terv[1].action, 'duplicate');
  assertEq(terv[1].duplicateOf, 3);
});

atest('az importált új SAP-szám a történetbe kerül, a régi lezárul', async () => {
  EmployeeRepo.useBackend(EmployeeRepo.createMemoryBackend());
  await EmployeeRepo.load();
  const e = EmployeeRepo.create({
    fields: { surname: 'Kovács', forename: 'Anna', date_of_birth: '1990-03-15' },
    identifiers: [{ type: 'sap', value: 'SAP-111' }],
  });

  const rows = [{ excelRow: 3, fields: {
    surname: 'Kovács', forename: 'Anna', date_of_birth: '1990-03-15',
    citizenship: 'magyar', personnel_reg_number: 'SAP-999',
  }, problems: [] }];
  const terv = XlsxRead.plan(rows, { schema: SchemaStore.get() });
  assertEq(terv[0].action, 'update', 'nem ismerte fel a személyt név alapján');

  const eredmeny = XlsxRead.apply(terv);
  assertEq(eredmeny.frissitve, 1);
  assertEq(eredmeny.ujAzonosito, 1);

  const u = EmployeeRepo.get(e.id);
  assertEq(u.identifiers.length, 2, 'a régi azonosító eltűnt');
  assertEq(EmployeeRepo.currentIdentifier(u, 'sap').value, 'SAP-999');
  assertEq(u.identifiers.find(i => i.value === 'SAP-111').current, false, 'a régi nem záródott le');
});

atest('hiányos sor kimarad, nem hoz létre féloldalas rekordot', async () => {
  EmployeeRepo.useBackend(EmployeeRepo.createMemoryBackend());
  await EmployeeRepo.load();
  const rows = [{ excelRow: 3, fields: { surname: 'Csak vezetéknév' }, problems: [] }];
  const terv = XlsxRead.plan(rows, { schema: SchemaStore.get() });
  assert(terv[0].validation.length > 0, 'nem jelezte a hiányzó kötelező mezőket');
  const eredmeny = XlsxRead.apply(terv);
  assertEq(eredmeny.letrehozva, 0);
  assertEq(eredmeny.kihagyva, 1);
  assertEq(EmployeeRepo.count(), 0);
});

// ── Futtatás ────────────────────────────────────────────────────────────────
(async () => {
  for (const item of queue) {
    if (item.section) { console.log(`\n[${item.section}]`); continue; }
    try { await item.fn(); console.log(`  ✓ ${item.name}`); passed++; }
    catch (e) {
      console.log(`  ✗ ${item.name}`);
      console.log(`    ${e.message}`);
      failed++; failures.push({ name: item.name, error: e.message });
    }
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
})();
