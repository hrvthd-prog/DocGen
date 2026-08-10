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
const PROFILE = ExportProfiles.get('adatbekero');

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
});

atest('a kötelezőség a LÁTHATÓ soron is látszik', async () => {
  // Az 1. sor rejtett, ezért ha csak ott lenne piros a kötelező mező, a
  // kitöltő semmilyen jelzést nem kapna arról, mit nem hagyhat üresen.
  const ws = G.wb.getWorksheet('Data');
  const fill = c => (c.fill && c.fill.fgColor && c.fill.fgColor.argb) || '';
  assertEq(fill(ws.getRow(2).getCell(2)), 'FFC00000', 'a kötelező surname nem piros a 2. sorban');
  assertEq(fill(ws.getRow(2).getCell(1)), 'FF1F3864', 'az opcionális törzsszám nem kék a 2. sorban');
});

atest('a gépi kulcsok sora rejtett – a kitöltőnek nem kell látnia', async () => {
  const ws = G.wb.getWorksheet('Data');
  assertEq(ws.getRow(1).hidden, true, 'az 1. sor nincs elrejtve');
  assertEq(!!ws.getRow(2).hidden, false, 'a 2. sor nem lehet rejtett');
});

atest('a fejlécsor rögzítve van, hogy görgetéskor látszódjon', async () => {
  const ws = G.wb.getWorksheet('Data');
  const v = ws.views && ws.views[0];
  assertEq(v && v.state, 'frozen');
  assertEq(v && v.ySplit, 2);
});

function noteSzoveg(cell) {
  const note = cell.note;
  if (!note) return '';
  return typeof note === 'string' ? note : (note.texts || []).map(t => t.text).join('');
}

atest('a kitöltést segítő komment a LÁTHATÓ 2. soron van', async () => {
  // Korábban az 1. sorra került – ami rejtett, tehát a kitöltő sosem látta.
  const ws = G.wb.getWorksheet('Data');
  assert(noteSzoveg(ws.getRow(2).getCell(2)), 'nincs komment a 2. sor cellájában');
});

atest('a komment angolul is eligazít – külföldi tölti ki', async () => {
  const ws = G.wb.getWorksheet('Data');
  const sz = noteSzoveg(ws.getRow(2).getCell(2));   // surname, kötelező
  assert(/REQUIRED/.test(sz), 'a kötelezőség nincs angolul jelezve');
  assert(/KÖTELEZŐ/.test(sz), 'a kötelezőség nincs magyarul jelezve');
  assert(/Vezetéknév/.test(sz), 'nincs magyar jelentés');
});

atest('a dátummezőnél a formátum angolul is szerepel', async () => {
  const ws = G.wb.getWorksheet('Data');
  const kulcsok = [];
  ws.getRow(1).eachCell({ includeEmpty: false }, c => kulcsok.push(String(c.value)));
  const oszlop = kulcsok.indexOf('date_of_birth') + 1;
  assert(oszlop > 0, 'nincs date_of_birth oszlop');
  const sz = noteSzoveg(ws.getRow(2).getCell(oszlop));
  assert(/YYYY-MM-DD/.test(sz), `nincs angol dátumformátum: ${sz.slice(0, 80)}`);
});

atest('a választható mezőnél a komment a legördülőre utal és felsorolja az értékeket', async () => {
  const ws = G.wb.getWorksheet('Data');
  const sz = noteSzoveg(ws.getRow(2).getCell(6));   // sex
  assert(/drop-down/i.test(sz), 'nem utal a legördülőre');
  assert(/male/.test(sz) && /female/.test(sz), `hiányos értékfelsorolás: ${sz.slice(0, 120)}`);
});

atest('útmutató nélküli mezőnél a gépi felsorolás ugrik be', async () => {
  // Ha valaki új választható mezőt vesz fel a séma-szerkesztőben és nem ír
  // hozzá útmutatót, a komment akkor se maradjon üres.
  const mezo = {
    key: 'proba', group: 'egyeb', type: 'enum', required: true,
    label: { hu: 'Próba', en: 'Test' }, tags: [], hint: { en: '', hu: '' },
    values: [{ id: 'a', hu: 'Alma', en: 'Apple', accepts: [] }],
  };
  const sema = JSON.parse(JSON.stringify(SEED_SCHEMA));
  sema.fields = [mezo];
  SchemaStore.loadFrom(sema);
  const buf = await XlsxWrite.toBuffer({
    schema: SchemaStore.get(), profile: PROFILE, employees: [],
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const sz = noteSzoveg(wb.getWorksheet('Data').getRow(2).getCell(1));
  SchemaStore.loadFrom(SEED_SCHEMA);          // visszaállítás a többi teszthez

  assert(/REQUIRED/.test(sz), 'nincs kötelezőség-jelzés');
  assert(/a = Apple/.test(sz) && /Alma/.test(sz), `nincs gépi értékfelsorolás: ${sz}`);
});

atest('minden mező útmutatója a HELYES mezőn van', async () => {
  // A séma útmutatóit egy szkript vitte be a valódi adatbekérőből, és a
  // beszúrás egyszer el is csúszott egy mezővel (a 'door' szövege a
  // 'position'-re került). Ezért mezőnként, géppel vetjük össze.
  const vart = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'fixtures/adatbekero-hints.json'), 'utf8'));
  const ws = G.wb.getWorksheet('Data');

  const kulcsok = [];
  ws.getRow(1).eachCell({ includeEmpty: false }, c => kulcsok.push(String(c.value)));

  const rossz = [];
  kulcsok.forEach((kulcs, i) => {
    const elvart = vart[kulcs];
    if (!elvart) { rossz.push(`${kulcs}: nincs elvárt útmutató a fixture-ben`); return; }
    const kapott = noteSzoveg(ws.getRow(2).getCell(i + 1));
    if (!kapott.includes(elvart)) {
      rossz.push(`${kulcs}: az útmutató hiányzik vagy más mezőé`);
    }
  });

  assertEq(kulcsok.length, 44, 'nem 44 oszlop');
  assert(rossz.length === 0, `${rossz.length} hibás mező:\n      ` + rossz.slice(0, 8).join('\n      '));
});

atest('az üres sablon védett – a rejtett kulcssor nem fedhető fel', async () => {
  const ws = G.wb.getWorksheet('Data');
  assert(ws.protect || ws.sheetProtection, 'nincs lapvédelem');
  const sp = ws.sheetProtection || {};
  assertEq(sp.sheet, true, 'a lap nincs védve');
  // A sorformázás tiltása az, ami a rejtett 1. sort rejtve tartja
  assertEq(sp.formatRows === false || sp.formatRows === undefined, true,
    'a sorformázás engedélyezett – az 1. sor felfedhető lenne');
});

atest('védelem mellett is KITÖLTHETŐ marad – ez a védelem buktatója', async () => {
  // Lapvédelem alatt minden cella alapból zárolt. Ha az adatsorokat nem
  // oldjuk fel, a kitöltő egyetlen karaktert sem tud beírni – a sablon
  // használhatatlan lenne, ráadásul némán.
  const ws = G.wb.getWorksheet('Data');
  const zarolt = c => c.protection && c.protection.locked === false ? false : true;

  assertEq(zarolt(ws.getRow(3).getCell(2)), false,  'az első adatsor zárolt – nem lehet kitölteni');
  assertEq(zarolt(ws.getRow(32).getCell(2)), false, 'az utolsó adatsor zárolt');
  assertEq(zarolt(ws.getRow(2).getCell(2)), true,   'a címkesor nincs zárolva');
});

atest('a feltöltött export NEM védett – azt magunk dolgozzuk fel', async () => {
  const { wb } = await generalt([{
    id: 'x', identifiers: [], fields: { surname: 'Teszt', forename: 'Elek' },
  }]);
  const sp = wb.getWorksheet('Data').sheetProtection || {};
  assert(!sp.sheet, 'a feltöltött export is védett lett');
});

atest('az üres sablon neve adatbekero.xlsx – se dátum, se cégnév', async () => {
  assertEq(XlsxWrite.suggestFilename(PROFILE, false), 'adatbekero.xlsx');
});

atest('a feltöltött export neve megkülönböztethető és dátumos', async () => {
  const nev = XlsxWrite.suggestFilename(PROFILE, true);
  assert(/^adatbekero-adatok-\d{8}\.xlsx$/.test(nev), `váratlan fájlnév: ${nev}`);
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

// Szándékos kulcsrövidítés: a nyelvjelölés kikerült a kulcsból, mert a magyar
// alakot már a szótár adja. A régi kulcs jelölőként megmarad, ezért a korábban
// kiküldött adatbekérők importja változatlanul működik.
const ROVIDULT_KULCSOK = {
  place_of_birth_country_hun:     'place_of_birth_country',
  professional_qualification_hun: 'professional_qualification',
  previous_country_hun:           'previous_country',
};

atest('az oszlopkulcsok és a sorrend megegyezik az eredetivel', async () => {
  const wg = G.wb.getWorksheet('Data');
  const generaltKulcsok = [];
  wg.getRow(1).eachCell({ includeEmpty: false }, c => generaltKulcsok.push(String(c.value).trim()));
  const vart = eredetiSor(1).map(k => ROVIDULT_KULCSOK[k] || k);
  assertEq(generaltKulcsok.join(','), vart.join(','), 'eltérő oszlopkulcs vagy sorrend');
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

atest('a választható értékek az import által várt kanonikus alakban mennek ki', async () => {
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
  assertEq(XlsxRead._toIsoDate('1990. 03. 15.'), '1990-03-15');   // magyar tagolás
  assertEq(XlsxRead._toIsoDate('nem dátum'), null);
  assertEq(XlsxRead._toIsoDate('15/11/2027'), null);              // kétértelmű: nem találgatunk
});

// Ez a teszt egy valódi adatvesztésre született: a kitöltött táblázatokból
// eltűnt a születési idő, az útlevél-dátumok és a belépés/kilépés. Az ok: a
// beolvasó a cella MEGJELENÍTETT szövegét nézte, ami a kitöltő gépének területi
// beállításától függ – amerikai formátumban „3/15/90", amit joggal utasított el.
// A cellában tárolt sorszám viszont mindig ugyanaz.
atest('a valódi Excel-dátumcella a területi beállítástól függetlenül beolvasódik', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.getRow(1).values = ['surname', 'forename', 'date_of_birth', 'pp_validity'];
  ws.getRow(2).values = ['x', 'x', 'x', 'x'];
  ws.getRow(3).values = ['Nagy', 'Béla', new Date(Date.UTC(1990, 2, 15)), new Date(Date.UTC(2030, 5, 30))];
  // Amerikai megjelenítés – pontosan az az eset, amitől korábban kiesett a sor
  ws.getRow(3).getCell(3).numFmt = 'm/d/yy';
  ws.getRow(3).getCell(4).numFmt = 'm/d/yy';
  const buf = await wb.xlsx.writeBuffer();

  const { rows } = XlsxRead.readRows(buf, { schema: SchemaStore.get() });
  assertEq(rows[0].fields.date_of_birth, '1990-03-15', 'a születési idő nem olvasódott be');
  assertEq(rows[0].fields.pp_validity,   '2030-06-30', 'az útlevél lejárata nem olvasódott be');
  assertEq(rows[0].problems.length, 0, 'hibát jelzett érvényes dátumra');
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
// ════════════════════════════════════════════════════════════════════════════
// Az xlsx-kiírás időkorlátja
//
// A fejlesztés során egyszer előfordult, hogy a writeBuffer() nem tért vissza,
// és a felület némán megállt. Reprodukálni nem sikerült, ezért az okát nem
// ismerjük — de az őrnek, ami hibává alakítja a fagyást, működnie kell.
// A forrás egy másolatán rövidített határidővel próbáljuk ki, hogy a teszt
// gyors maradjon; minden más a valódi kód.
asection('Az xlsx-kiírás nem fagyhat be némán');

function xlsxWriteRovidHataridovel(writeBufferFn) {
  const forras = fs.readFileSync(path.join(__dirname, '../js/services/xlsx-write.js'), 'utf8')
    .replace('const IRAS_HATARIDO_MS = 30000;', 'const IRAS_HATARIDO_MS = 80;');
  if (!/IRAS_HATARIDO_MS = 80/.test(forras)) {
    throw new Error('nem találom az időkorlát-konstanst — átnevezték?');
  }

  // Valódi ExcelJS, hogy a build() rendesen lefusson; csak a záró hívást cseréljük.
  class AkadoWorkbook extends ExcelJS.Workbook {
    constructor() { super(); this.xlsx.writeBuffer = writeBufferFn; }
  }

  const sb = { ...sandbox, ExcelJS: { ...ExcelJS, Workbook: AkadoWorkbook } };
  sb.globalThis = sb; sb.window = sb; sb.self = sb;
  vm.createContext(sb);
  for (const [rel, name] of modules) {
    let code = fs.readFileSync(path.join(__dirname, rel), 'utf8');
    if (rel.endsWith('xlsx-write.js')) code = forras;
    code += `\nglobalThis.${name} = ${name};`;
    vm.runInContext(code, sb, { filename: rel });
  }
  sb.SchemaStore.loadFrom(sb.SEED_SCHEMA);
  sb.ExportProfiles.loadFrom(null);
  return sb;
}

atest('a beragadt kiírás hibává alakul, nem néma fagyássá', async () => {
  const sb = xlsxWriteRovidHataridovel(() => new Promise(() => {}));   // sosem tér vissza
  const kezdet = Date.now();
  let hiba = null;
  try {
    await sb.XlsxWrite.toBuffer({ schema: sb.SchemaStore.get(), profile: sb.ExportProfiles.get('adatbekero'), employees: [] });
  } catch (e) { hiba = e; }

  assert(hiba, 'nem dobott hibát — a felület némán fagyna');
  assert(/sem fejeződött be/.test(hiba.message), `váratlan hibaüzenet: ${hiba.message}`);
  const eltelt = Date.now() - kezdet;
  assert(eltelt < 3000, `túl sokáig várt: ${eltelt} ms`);
});

atest('a normál kiírást az őr nem zavarja', async () => {
  const sb = xlsxWriteRovidHataridovel(() => Promise.resolve(Buffer.from('xlsx-adat')));
  const buf = await sb.XlsxWrite.toBuffer({ schema: sb.SchemaStore.get(), profile: sb.ExportProfiles.get('adatbekero'), employees: [] });
  assert(buf && Buffer.from(buf).toString() === 'xlsx-adat', 'nem a várt puffert adta vissza');
});

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
