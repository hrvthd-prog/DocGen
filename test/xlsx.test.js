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
vm.runInContext(fs.readFileSync(path.join(__dirname, '../vendor/pizzip.min.js'), 'utf8'),
  sandbox, { filename: 'pizzip.min.js' });

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

/**
 * Egy mező oszlopszáma a generált lapon, a rejtett kulcssorból.
 *
 * A tesztek korábban rögzített oszlopszámokat használtak („a surname a 2.").
 * Amikor az oszlopsorrend a hatósági nyomtatványé lett, ettől tizenhat teszt
 * bukott el úgy, hogy közben semmi nem romlott el. A sorrendet egy helyen, a
 * `schema.test.js` HATOSAGI_SORREND listája őrzi — itt kulcs szerint keresünk.
 */
function oszlop(ws, kulcs) {
  let n = 0;
  ws.getRow(1).eachCell({ includeEmpty: false }, (c, i) => {
    if (String(c.value).trim() === kulcs) n = i;
  });
  if (!n) throw new Error(`nincs ilyen oszlop a lapon: ${kulcs}`);
  return n;
}

// ════════════════════════════════════════════════════════════════════════════
asection('Üres sablon előállítása');

let G = null;
atest('a sablon legenerálható és megnyitható', async () => {
  G = await generalt();
  assert(G.wb.getWorksheet('Data'), 'nincs Data munkalap');
  assert(G.wb.getWorksheet('Útmutató'), 'nincs Útmutató munkalap');
});

atest('minden tárolt mező kikerül oszlopként, a profil (sections) sorrendjében', async () => {
  const ws = G.wb.getWorksheet('Data');
  const kulcsok = [];
  ws.getRow(1).eachCell({ includeEmpty: false }, c => kulcsok.push(String(c.value)));
  const vart = ExportProfiles.columnsOf(PROFILE, SchemaStore.get()).map(f => f.key);
  assertEq(kulcsok.join(','), vart.join(','), 'eltérő oszlopkulcs vagy sorrend');
  assertEq(kulcsok[0], 'surname');
});

/**
 * AZ ADATBEKÉRŐ OSZLOPSORRENDJÉNEK SZERZŐDÉSE.
 *
 * 2026-08-17-től 2026-08-18-ig a hatósági nyomtatvány (9. sz. kérelem)
 * rovatsorrendje volt a szerződés (akkor ez EGYBEN a séma belső sorrendje is
 * volt, l. schema.test.js). 2026-08-18-án ezt tudatosan letettük egy téma
 * szerinti sorrend mellett (Personal Data → Documents → ID Numbers →
 * Address → Employment → Skills → Address Abroad → HR Info → Contacts) –
 * ez a kitöltőnek könnyebben áttekinthető, mint a hatósági rovatsorrend.
 *
 * A sorrend forrása `export-profiles.js` → `PROFILE.sections`; ha az ott
 * elcsúszik, ez a teszt bukik.
 */
const ADATBEKERO_SORREND = [
  'surname', 'forename', 'surname_at_birth', 'forename_at_birth',
  'mothers_surname_at_birth', 'mothers_forename_at_birth', 'date_of_birth',
  'citizenship', 'hr_dual_citizenship', 'place_of_birth_country',
  'place_of_birth_locality', 'sex', 'marital_status',
  'pp_number', 'pp_issuance_date', 'pp_issuance_place', 'pp_validity',
  'passport_type', 'number_of_rp', 'expiration_of_rp',
  'personnel_reg_number', 'tax_number', 'TAJ',
  'postal_code', 'locality', 'name_of_public_place', 'type_of_public_place',
  'street_number', 'building', 'stairway', 'floor', 'door',
  'position', 'feor', 'employment_start', 'employment_end',
  'gross_salary', 'residence_purpose',
  'occupation_before_arrival', 'hr_previous_employer', 'hr_previous_employment_end',
  'educational_attainment', 'professional_qualification', 'hr_education_completion_date',
  'hr_education_institution', 'hr_education_specialization', 'hr_degree_document_number',
  'mother_tongue', 'speaks_hungarian', 'hr_computer_skills', 'hr_language_skills',
  'previous_country', 'previous_town', 'previous_street',
  'hr_bank_account', 'hr_bank_name', 'hr_children', 'hr_department_cost_center',
  'hr_direct_leader', 'hr_sg_category',
  'email', 'telephone', 'hr_emergency_contact_name', 'hr_emergency_contact_phone',
];

atest('az adatbekérő oszlopsorrendje a profil sections szerint', async () => {
  const ws = G.wb.getWorksheet('Data');
  const kulcsok = [];
  ws.getRow(1).eachCell({ includeEmpty: false }, c => kulcsok.push(String(c.value)));
  assertEq(kulcsok.join('\n'), ADATBEKERO_SORREND.join('\n'), 'elcsúszott adatbekérő-oszlopsorrend');
});

atest('két mező (topographical_number, other_accommodation) a sémában marad, de nem export-oszlop', async () => {
  // 2026-08-18: szándékosan kimaradnak az adatbekérőből – ezeket a HR viszi
  // fel manuálisan –, de a séma/DB-ből nem törlődtek.
  const ws = G.wb.getWorksheet('Data');
  const kulcsok = [];
  ws.getRow(1).eachCell({ includeEmpty: false }, c => kulcsok.push(String(c.value)));
  assert(!kulcsok.includes('topographical_number'), 'a helyrajzi szám mégis oszlop lett');
  assert(!kulcsok.includes('other_accommodation'), 'az egyéb jogcím mégis oszlop lett');
  assert(SchemaStore.field('topographical_number'), 'a helyrajzi szám kikerült a sémából is');
  assert(SchemaStore.field('other_accommodation'), 'az egyéb jogcím kikerült a sémából is');
});

atest('a 3. sorban (labelRow) az angol címkék állnak, a 2. sor a szakaszcímeké', async () => {
  const ws = G.wb.getWorksheet('Data');
  assertEq(String(ws.getRow(PROFILE.labelRow).getCell(oszlop(ws, 'surname')).value),
    'Surname (as in passport)');
  assertEq(String(ws.getRow(PROFILE.sectionRow).getCell(oszlop(ws, 'surname')).value),
    'Personal Data');
});

atest('a szakaszcím-sor összevonja a saját szakaszának oszlopait', async () => {
  // A „Hungarian Address" szakasz első oszlopa postal_code, utolsója door –
  // ha az összevonás működik, mindkét cella (ExcelJS-ben: a master és a rá
  // mutató MergedCell) ugyanazt a szakaszcímet adja vissza.
  const ws = G.wb.getWorksheet('Data');
  const elso   = String(ws.getRow(PROFILE.sectionRow).getCell(oszlop(ws, 'postal_code')).value);
  const utolso = String(ws.getRow(PROFILE.sectionRow).getCell(oszlop(ws, 'door')).value);
  assertEq(elso, 'Hungarian Address', 'a szakasz első oszlopán nincs a cím');
  assertEq(utolso, 'Hungarian Address', 'a szakasz utolsó (összevont) oszlopán nem olvasható vissza a cím');
});

atest('a fejléc színe a SZAKASZÉ, egyformán mind a 3 fejlécsoron', async () => {
  // 2026-08-19: a szín nem a `group`-é és nem a kötelezőségé – egy valódi,
  // a felhasználó által kézzel megformázott mintafájlból vettük át. A
  // kötelezőséget a fejléc színe többé NEM jelzi (arra a cellakomment
  // „REQUIRED" szövege szolgál).
  const ws = G.wb.getWorksheet('Data');
  const fill = c => (c.fill && c.fill.fgColor && c.fill.fgColor.argb) || '';
  for (const r of [1, PROFILE.sectionRow, PROFILE.labelRow]) {
    assertEq(fill(ws.getRow(r).getCell(oszlop(ws, 'postal_code'))), 'FF806000', `lakcím, ${r}. sor`);
    assertEq(fill(ws.getRow(r).getCell(oszlop(ws, 'position'))), 'FFC55A11', `foglalkoztatás, ${r}. sor`);
    // A hr_sg_category az „Information for HR" szakaszban van, aminek a
    // színe UGYANAZ, mint az „Identification Numbers"-é a mintafájlban.
    assertEq(fill(ws.getRow(r).getCell(oszlop(ws, 'hr_sg_category'))), 'FF1F3864', `csak HR, ${r}. sor`);
  }
});

atest('a kötelező és az opcionális mező fejlécszíne AZONOS, ha egy szakaszban vannak', async () => {
  // surname (kötelező) és surname_at_birth (nem kötelező) mindkettő a
  // „Personal Data" szakaszban van – a mintafájlban is egyforma színnel.
  const ws = G.wb.getWorksheet('Data');
  const fill = c => (c.fill && c.fill.fgColor && c.fill.fgColor.argb) || '';
  assertEq(fill(ws.getRow(1).getCell(oszlop(ws, 'surname'))),
            fill(ws.getRow(1).getCell(oszlop(ws, 'surname_at_birth'))),
            'a kötelező és az opcionális mező színe eltér, pedig egy szakaszban vannak');
});

atest('a fejléc szegélye vékony, vízszintes vonalakból áll – nincs oszlophatár-szegély', async () => {
  // A szakaszhatárt a színváltás jelzi, nem egy vastag függőleges vonal –
  // ez is a mintafájl alapján dőlt el.
  const ws = G.wb.getWorksheet('Data');
  const c = ws.getRow(1).getCell(oszlop(ws, 'postal_code'));   // szakaszhatár: X oszlop
  assert(!c.border || !c.border.left, `a szakaszhatáron mégis van bal szegély: ${JSON.stringify(c.border)}`);
});

atest('a gépi kulcsok sora rejtett – a kitöltőnek nem kell látnia', async () => {
  const ws = G.wb.getWorksheet('Data');
  assertEq(ws.getRow(1).hidden, true, 'az 1. sor nincs elrejtve');
  assertEq(!!ws.getRow(PROFILE.sectionRow).hidden, false, 'a szakaszcím-sor nem lehet rejtett');
  assertEq(!!ws.getRow(PROFILE.labelRow).hidden, false, 'a label sor nem lehet rejtett');
});

atest('a fejlécsorok rögzítve vannak, hogy görgetéskor látszódjanak', async () => {
  const ws = G.wb.getWorksheet('Data');
  const v = ws.views && ws.views[0];
  assertEq(v && v.state, 'frozen');
  assertEq(v && v.ySplit, PROFILE.labelRow);
});

function noteSzoveg(cell) {
  const note = cell.note;
  if (!note) return '';
  return typeof note === 'string' ? note : (note.texts || []).map(t => t.text).join('');
}

atest('a kitöltést segítő komment a LÁTHATÓ label soron van', async () => {
  // Korábban az 1. sorra került – ami rejtett, tehát a kitöltő sosem látta.
  const ws = G.wb.getWorksheet('Data');
  assert(noteSzoveg(ws.getRow(PROFILE.labelRow).getCell(oszlop(ws, 'surname'))),
    'nincs komment a label sor cellájában');
});

atest('a komment angolul is eligazít – külföldi tölti ki', async () => {
  const ws = G.wb.getWorksheet('Data');
  const sz = noteSzoveg(ws.getRow(PROFILE.labelRow).getCell(oszlop(ws, 'surname')));   // kötelező mező
  assert(/REQUIRED/.test(sz), 'a kötelezőség nincs angolul jelezve');
  assert(/KÖTELEZŐ/.test(sz), 'a kötelezőség nincs magyarul jelezve');
  assert(/Vezetéknév/.test(sz), 'nincs magyar jelentés');
});

atest('a dátummezőnél a formátum angolul is szerepel', async () => {
  const ws = G.wb.getWorksheet('Data');
  const sz = noteSzoveg(ws.getRow(PROFILE.labelRow).getCell(oszlop(ws, 'date_of_birth')));
  assert(/YYYY-MM-DD/.test(sz), `nincs angol dátumformátum: ${sz.slice(0, 80)}`);
});

atest('a választható mezőnél a komment a legördülőre utal és felsorolja az értékeket', async () => {
  const ws = G.wb.getWorksheet('Data');
  const sz = noteSzoveg(ws.getRow(PROFILE.labelRow).getCell(oszlop(ws, 'sex')));
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
  const sz = noteSzoveg(wb.getWorksheet('Data').getRow(PROFILE.labelRow).getCell(1));
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
    const kapott = noteSzoveg(ws.getRow(PROFILE.labelRow).getCell(i + 1));
    if (!kapott.includes(elvart)) {
      rossz.push(`${kulcs}: az útmutató hiányzik vagy más mezőé`);
    }
  });

  assertEq(kulcsok.length, ExportProfiles.columnsOf(PROFILE, SchemaStore.get()).length,
    'nem minden export-oszlop került ki');
  assert(rossz.length === 0, `${rossz.length} hibás mező:\n      ` + rossz.slice(0, 8).join('\n      '));
});

atest('a kommentdoboz mindenhol nagyjából ugyanakkora, nem oszlopszám szerint', async () => {
  // Az ExcelJS minden kommentnek ugyanazt az apró (kb. 2 oszlop × 4 sor) VML
  // dobozt írja; a toBuffer() ezt utólag, nyers XML-ben igazítja
  // (enlargeNoteBoxes). Korábban FIX 5 oszlopot fogott át — csakhogy az
  // oszlopok 10 és 38 karakter között váltakoznak, így ugyanaz az „5 oszlop"
  // hol 200, hol 700 pont széles dobozt adott. A szerződés ezért pontban van.
  const zip = new sandbox.PizZip(G.buf);
  const vmlUt = Object.keys(zip.files).find(p => /^xl\/drawings\/vmlDrawing\d+\.vml$/.test(p));
  assert(vmlUt, 'nincs vmlDrawing a kiírt fájlban – nincs mit igazítani');
  const xml = zip.files[vmlUt].asText();
  const anchorok = [...xml.matchAll(/<x:Anchor>\s*([^<]+?)\s*<\/x:Anchor>/g)];
  assert(anchorok.length > 0, 'nincs egyetlen <x:Anchor> sem');

  const ws = G.wb.getWorksheet('Data');
  const pt = c => (((ws.getColumn(c) && ws.getColumn(c).width) || 8.43) * 7 + 5) * 0.75;

  for (const [, belso] of anchorok) {
    const [c1, , r1, , c2, , r2] = belso.split(',').map(s => Number(s.trim()));
    let szeles = 0;
    for (let c = c1; c < c2; c++) szeles += pt(c + 1);
    // A cél 200 pt; egy oszlop alá nem megyünk, ezért a határ nem hajszálpontos.
    // A régi, fix 5 oszlopos doboz itt 600 pt fölé is elment.
    assert(szeles >= 100 && szeles <= 300,
      `kilóg a kommentdoboz szélessége: ${Math.round(szeles)} pt (${belso})`);
    assertEq(r2 - r1, 6, `nem a várt 6 soros kommentdoboz: ${belso}`);
  }
});

atest('az üres sablon ALAPÉRTELMEZÉSBEN nem védett', async () => {
  // 2026-08-18 óta a lapvédelem szándékosan KI van kapcsolva (nem volt
  // biztonsági eszköz, csak akadályozta a kitöltőt) – de a `protectSheet`
  // kódja megmaradt, lásd a következő tesztet.
  const ws = G.wb.getWorksheet('Data');
  const sp = ws.sheetProtection || {};
  assert(!sp.sheet, 'a lap alapból védett lett, pedig protection.enabled = false');
});

atest('ha valaki visszakapcsolja a védelmet, az továbbra is helyesen működik', async () => {
  const p = JSON.parse(JSON.stringify(PROFILE));
  p.protection.enabled = true;
  const buf = await XlsxWrite.toBuffer({ schema: SchemaStore.get(), profile: p, employees: [] });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('Data');

  assert(ws.protect || ws.sheetProtection, 'nincs lapvédelem');
  const sp = ws.sheetProtection || {};
  assertEq(sp.sheet, true, 'a lap nincs védve');
  // A sorformázás tiltása az, ami a rejtett 1. sort rejtve tartja
  assertEq(sp.formatRows === false || sp.formatRows === undefined, true,
    'a sorformázás engedélyezett – az 1. sor felfedhető lenne');

  // Lapvédelem alatt minden cella alapból zárolt. Ha az adatsorokat nem
  // oldjuk fel, a kitöltő egyetlen karaktert sem tud beírni.
  const zarolt = c => c.protection && c.protection.locked === false ? false : true;
  const elsoAdatsor   = p.firstDataRow;
  const utolsoAdatsor = elsoAdatsor + p.protection.fillableRows - 1;
  assertEq(zarolt(ws.getRow(elsoAdatsor).getCell(2)), false,   'az első adatsor zárolt – nem lehet kitölteni');
  assertEq(zarolt(ws.getRow(utolsoAdatsor).getCell(2)), false, 'az utolsó adatsor zárolt');
  assertEq(zarolt(ws.getRow(p.labelRow).getCell(2)), true,     'a label sor nincs zárolva');
});

atest('a feltöltött export NEM védett, még ha a profil be is kapcsolná', async () => {
  const p = JSON.parse(JSON.stringify(PROFILE));
  p.protection.enabled = true;
  const buf = await XlsxWrite.toBuffer({
    schema: SchemaStore.get(), profile: p,
    employees: [{ id: 'x', identifiers: [], fields: { surname: 'Teszt', forename: 'Elek' } }],
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
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
  const ws2 = G.wb.getWorksheet('Data');
  const betu = k => XlsxWrite._colLetter(oszlop(ws2, k));
  assertEq(talalt[betu('sex')], 'male,female', 'a nem legördülője hibás');
  assertEq(talalt[betu('marital_status')], 'unmarried,married,divorced,widow',
    'a családi állapot legördülője hibás');
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

// A séma azóta bővült a formanyomtatvány mezőivel, ezért nem az EGYEZÉST
// mérjük, hanem azt, hogy az eredeti oszlopok mind megvannak, egymáshoz képest
// az eredeti sorrendben. Az elcsúszás – amitől ez a két teszt véd – így is
// kiderül; az új oszlopok pedig nem buktatják.
function eredetiOszlopok() {
  return eredetiSor(1).map(k => ROVIDULT_KULCSOK[k] || k);
}

atest('az eredeti oszlopok mind megvannak', async () => {
  // A SORRENDET már nem az eredeti fájl adja: 2026-08-17 óta a hatósági
  // nyomtatvány rovatsorrendje a szerződés (schema.test.js → HATOSAGI_SORREND).
  // Itt csak az számít, hogy egyetlen régi oszlop se vesszen el – különben egy
  // korábban kiküldött adatbekérő importja csendben adatot dobna el.
  const wg = G.wb.getWorksheet('Data');
  const generalt = [];
  wg.getRow(1).eachCell({ includeEmpty: false }, c => generalt.push(String(c.value).trim()));

  const hianyzo = eredetiOszlopok().filter(k => !generalt.includes(k));
  assertEq(hianyzo.length, 0, 'kimaradt eredeti oszlop: ' + hianyzo.join(', '));
});

atest('az angol címkék megegyeznek az eredetivel', async () => {
  // Mezőnként vetjük össze, nem pozíció szerint: a címke a kitöltő egyetlen
  // fogódzója, azt átrendezéskor sem szabad elrontani.
  const wg = G.wb.getWorksheet('Data');
  const kulcsok = [], cimkek = [];
  wg.getRow(1).eachCell({ includeEmpty: false }, c => kulcsok.push(String(c.value).trim()));
  wg.getRow(PROFILE.labelRow).eachCell({ includeEmpty: false }, c => cimkek.push(String(c.value).trim()));
  const most = new Map(kulcsok.map((k, i) => [k, cimkek[i]]));

  const eredetiCimkek = eredetiSor(2);
  const rossz = eredetiOszlopok()
    .map((k, i) => (most.get(k) === eredetiCimkek[i] ? null
                                                     : `${k}: „${most.get(k)}" ≠ „${eredetiCimkek[i]}"`))
    .filter(Boolean);
  assertEq(rossz.join(' | '), '', 'eltérő angol címke');
});

// ════════════════════════════════════════════════════════════════════════════
asection('Nyomtatási lapfül (HR adatlap)');

function keplet(cell) {
  const v = cell.value;
  return (v && typeof v === 'object' && v.formula) ? String(v.formula) : '';
}

/** A képletben hivatkozott Data-oszlopbetűk, előfordulási sorrendben, egyszer. */
function hivatkozottOszlopok(f) {
  const ki = [];
  const re = /INDEX\([^!]+!\$([A-Z]+):\$[A-Z]+/g;
  let m;
  while ((m = re.exec(f))) if (!ki.includes(m[1])) ki.push(m[1]);
  return ki;
}

atest('a nyomtatási lap létrejön és A4-re van állítva', async () => {
  const ws = G.wb.getWorksheet(PROFILE.printSheet.name);
  assert(ws, 'nincs nyomtatási lapfül');
  assertEq(ws.pageSetup.orientation, 'portrait');
  assertEq(ws.pageSetup.fitToWidth, 1, 'nem fér egy oldal szélességbe');
});

atest('a vezérlőcella az EGYETLEN írható cella', async () => {
  // Ha a képletcellák nem zároltak, a HR egyetlen elgépeléssel kitörli az
  // adatlap felét – és nem is venné észre, mert a lap utána is kinéz valahogy.
  const ws = G.wb.getWorksheet(PROFILE.printSheet.name);
  const sp = ws.sheetProtection || {};
  assertEq(sp.sheet, true, 'a nyomtatási lap nincs védve');
  // Védelem alatt a zároltság az alapértelmezés, ezért a képletcellán nincs
  // külön `protection` – csak a feloldást kell keresni.
  const zarolt = c => !(c.protection && c.protection.locked === false);
  assertEq(zarolt(ws.getCell('B2')), false, 'a vezérlőcella zárolt – nem lehet személyt váltani');
  assertEq(zarolt(ws.getCell('B5')), true, 'egy képletcella feloldva maradt');
});

atest('minden sor képlete a SAJÁT mezőjének oszlopára mutat', async () => {
  // Ez a lap legkockázatosabb pontja: az oszlopbetűket a séma sorrendje adja,
  // tehát egy átrendezés némán elcsúsztathatná a képleteket – a nyomtatványon
  // az útlevélszám helyén a TAJ jelenne meg, hibaüzenet nélkül.
  const data = G.wb.getWorksheet('Data');
  const ws   = G.wb.getWorksheet(PROFILE.printSheet.name);

  const varhato = [];
  for (const sz of PROFILE.printSheet.sections) {
    for (const sor of sz.rows) varhato.push(sor);
  }

  let ellenorzott = 0;
  const rossz = [];
  ws.eachRow(row => {
    const f = keplet(row.getCell(2));
    if (!f) return;
    const cimke = String(row.getCell(1).value || '');
    const sor = varhato.find(s => s.label === cimke);
    if (!sor) { rossz.push(`ismeretlen sor: ${cimke}`); return; }
    const vartBetuk = sor.from.map(k => XlsxWrite._colLetter(oszlop(data, k)));
    const kapott = hivatkozottOszlopok(f);
    if (kapott.join(',') !== vartBetuk.join(',')) {
      rossz.push(`${cimke}: ${kapott.join(',')} ≠ ${vartBetuk.join(',')} (${sor.from.join(',')})`);
    }
    ellenorzott++;
  });

  assertEq(rossz.join(' | '), '', 'elcsúszott képlet');
  assertEq(ellenorzott, varhato.length, 'nem minden sor került ki a nyomtatási lapra');
});

atest('a személy sorát a vezérlőcella választja ki', async () => {
  // A Data lapon az adat a 3. sortól áll, tehát az 1. személy a labelRow+1.
  const ws = G.wb.getWorksheet(PROFILE.printSheet.name);
  const f = keplet(ws.getCell('B5'));
  assert(f.includes(`$B$2+${PROFILE.labelRow}`), `rossz sorszámítás: ${f}`);
  assertEq(ws.getCell('B2').value, 1, 'a vezérlőcella nem 1-ről indul');
});

atest('ismeretlen mezőkulcsú sor kimarad, nem hibázik', async () => {
  const p = JSON.parse(JSON.stringify(PROFILE));
  p.printSheet.sections = [{ title: 'Próba', rows: [
    { label: 'Nincs ilyen:', from: ['nincs_ilyen_mezo'] },
    { label: 'Van:',         from: ['surname'] },
  ] }];
  const buf = await XlsxWrite.toBuffer({ schema: SchemaStore.get(), profile: p, employees: [] });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet(p.printSheet.name);
  const cimkek = [];
  ws.eachRow(r => { if (keplet(r.getCell(2))) cimkek.push(String(r.getCell(1).value)); });
  assertEq(cimkek.join(','), 'Van:', 'a hiányzó mező sora nem maradt ki');
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
  const r = ws.getRow(PROFILE.firstDataRow);
  assertEq(String(r.getCell(oszlop(ws, 'surname')).value), 'Kovács');
  assertEq(String(r.getCell(oszlop(ws, 'forename')).value), 'Anna');
  assertEq(String(r.getCell(oszlop(ws, 'date_of_birth')).value), '1990-03-15');
});

atest('a választható értékek az import által várt kanonikus alakban mennek ki', async () => {
  const emp = [{ fields: { surname: 'K', forename: 'A', sex: 'male', marital_status: 'married',
                           educational_attainment: 'tertiary', speaks_hungarian: 'yes' } }];
  const { wb } = await generalt(emp);
  const ws = wb.getWorksheet('Data');
  const r = ws.getRow(PROFILE.firstDataRow);
  assertEq(String(r.getCell(oszlop(ws, 'sex')).value), 'male',
    'a nem nem kanonikus alakban ment ki');
  assertEq(String(r.getCell(oszlop(ws, 'marital_status')).value), 'married',
    'a családi állapot nem kanonikus');
});

atest('magyar kimeneti profil esetén magyarul kerülnek ki az értékek', async () => {
  const p = Object.assign({}, PROFILE, { enumEncoding: 'hu' });
  const buf = await XlsxWrite.toBuffer({
    schema: SchemaStore.get(), profile: p,
    employees: [{ fields: { surname: 'K', sex: 'male', marital_status: 'married' } }],
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('Data');
  const r = ws.getRow(p.firstDataRow);
  assertEq(String(r.getCell(oszlop(ws, 'sex')).value), 'Férfi');
  assertEq(String(r.getCell(oszlop(ws, 'marital_status')).value), 'Házas');
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
  const { rows } = XlsxRead.readRows(buf, {
    schema: SchemaStore.get(), firstDataRow: PROFILE.firstDataRow,
  });

  assertEq(rows.length, 1, 'nem pontosan egy sor olvasódott vissza');
  for (const [k, v] of Object.entries(eredetiAdat)) {
    assertEq(rows[0].fields[k], v, `a(z) ${k} mező megváltozott a körben`);
  }
  assertEq(rows[0].problems.length, 0, 'váratlan olvasási gond: ' + rows[0].problems.join('; '));
});

// Valódi hibából született: a nyilvántartás importálója a beépített
// alapértelmezéssel (firstDataRow=3) olvasott, az élő sablonban viszont a
// 3. sor még az angol címkesor — így minden import létrehozott egy
// „címkesor” nevű személyt. A profil sorszámait kötelező átadni.
atest('az üres sablon csak a profil szerinti első adatsortól olvas', async () => {
  const { buf } = await generalt([]);

  const jo = XlsxRead.readRows(buf, {
    schema: SchemaStore.get(),
    keyRow: PROFILE.keyRow, firstDataRow: PROFILE.firstDataRow,
  });
  assertEq(jo.rows.length, 0, 'üres sablonból adatsor keletkezett');

  // A vesszőparaszt: alapértelmezéssel a címkesor bejönne személyként
  const rossz = XlsxRead.readRows(buf, { schema: SchemaStore.get() });
  assert(rossz.rows.length > 0,
    'a teszt elavult: a profil firstDataRow-ja már egyezik az alapértelmezéssel');
  assert(PROFILE.firstDataRow > 3, 'a profil firstDataRow-ja 3 vagy kisebb lett');
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
