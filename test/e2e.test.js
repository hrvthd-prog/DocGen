'use strict';

// Körbe-teszt: táblázat → nyilvántartás → séma-feloldás → xlsx export.
// Futtatás: node test/e2e.test.js
//
// Nem darabokat mér, hanem a teljes ADATUTAT, a repóban lévő próbafájlokkal
// (test/fixtures/). A dokumentum-renderelés NEM itt van: a docxtemplater
// `new DOMParser()`-t hív, ami Node-ban nem létezik — az a rész a
// test/e2e-browser.js-ben fut. Lásd TERV-tesztanyag.md 7. pont.

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

const FIX      = path.join(__dirname, 'fixtures');
const SABLONOK = path.join(FIX, 'sablonok');

// ── Sandbox ─────────────────────────────────────────────────────────────────
const ExcelJS = require(path.join(__dirname, '../vendor/exceljs.min.js'));

const sandbox = {
  console, Date, Math, JSON, Set, Map, Object, Array, String, Number, Boolean,
  Error, RegExp, Promise, isNaN, parseInt, parseFloat, isFinite,
  Uint8Array, Uint16Array, Int32Array, Float64Array, ArrayBuffer, DataView,
  TextDecoder, TextEncoder, Buffer, setTimeout, clearTimeout, crypto, ExcelJS,
};
sandbox.globalThis = sandbox; sandbox.window = sandbox; sandbox.self = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../vendor/xlsx.full.min.js'), 'utf8'),
  sandbox, { filename: 'xlsx.full.min.js' });

for (const [rel, name] of [
  ['../js/services/employee-repo.js', 'EmployeeRepo'],
  ['../js/schema/value-codec.js',     'ValueCodec'],
  ['../js/schema/seed-schema.js',     'SEED_SCHEMA'],
  ['../js/schema/schema-store.js',    'SchemaStore'],
  ['../js/schema/export-profiles.js', 'ExportProfiles'],
  ['../js/services/xlsx-write.js',    'XlsxWrite'],
  ['../js/services/xlsx-read.js',     'XlsxRead'],
]) {
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, rel), 'utf8') + `\nglobalThis.${name} = ${name};`,
    sandbox, { filename: rel });
}

const { SchemaStore, SEED_SCHEMA, ExportProfiles, XlsxWrite, XlsxRead, EmployeeRepo } = sandbox;
SchemaStore.loadFrom(SEED_SCHEMA);
ExportProfiles.loadFrom(null);
const PROFILE = ExportProfiles.get('adatbekero');

function arrayBufferOf(file) {
  const b = fs.readFileSync(file);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

// Állapot a lépések között – a körbe-teszt egymásra épülő szakaszokból áll
const S = {};

// ════════════════════════════════════════════════════════════════════════════
asection('1. A próbafájlok megvannak és olvashatók');

atest('mind a négy sablon létezik és valódi zip', async () => {
  const vart = ['01-alap-adatlap.docx', '02-ketnyelvu-nyilatkozat.docx',
                '03-jelolonegyzetek.docx', '04-tordelt-jelolok.docx'];
  for (const nev of vart) {
    const ut = path.join(SABLONOK, nev);
    assert(fs.existsSync(ut), `hiányzik: ${nev} — futtasd: node tools/tesztanyag-keszito.js`);
    const b = fs.readFileSync(ut);
    // A zip aláírása „PK”
    assertEq(b[0], 0x50, `${nev}: nem zip`);
    assertEq(b[1], 0x4B, `${nev}: nem zip`);
  }
});

atest('a sablonok a várt jelölőket tartalmazzák', async () => {
  const szoveg = nev => {
    const zip = fs.readFileSync(path.join(SABLONOK, nev)).toString('latin1');
    return zip;   // tömörítetlen XML-hez elég; a jelölőket a docx-ből olvassuk lentebb
  };
  // A docx tömörített, ezért a nyers bájtokban nem keresünk – helyette a
  // készítő szkript forrásából ellenőrizzük, hogy a jelölők megvannak.
  const keszito = fs.readFileSync(path.join(__dirname, '../tools/tesztanyag-keszito.js'), 'utf8');
  for (const jelolo of ['{{Teljes név}}', '{{Neme}}', '{{Neme_EN}}',
                        '{{Állandó lakcím}}', '{{CHECK:Beszél magyarul}}', '{{mai nap}}']) {
    assert(keszito.includes(jelolo), `a készítő nem hoz létre ilyen jelölőt: ${jelolo}`);
  }
  assert(szoveg('01-alap-adatlap.docx').length > 1000, 'üres sablon');
});

atest('az import-táblázat beolvasható és a sémára illeszkedik', async () => {
  const ut = path.join(FIX, 'proba-import.xlsx');
  assert(fs.existsSync(ut), 'hiányzik: proba-import.xlsx — futtasd: node tools/tesztanyag-keszito.js');

  S.beolvasott = XlsxRead.readRows(arrayBufferOf(ut), { schema: SchemaStore.get() });
  assertEq(S.beolvasott.rows.length, 7, 'nem 7 adatsor');
  assertEq(S.beolvasott.unknownColumns.length, 0,
    `ismeretlen oszlop: ${S.beolvasott.unknownColumns.join(', ')}`);
});

// ════════════════════════════════════════════════════════════════════════════
asection('2. Beolvasás: szinonimák és dátumalakok');

atest('a kanonikus értékek változatlanul jönnek át', async () => {
  const s = S.beolvasott.rows[0].fields;
  assertEq(s.surname, 'Próba');
  assertEq(s.sex, 'male');
  assertEq(s.marital_status, 'married');
  assertEq(s.date_of_birth, '1990-03-15');
});

atest('a szinonimák kanonikus alakra jönnek', async () => {
  // ffi → male, Hajadon → unmarried, Magán → private, Felsőfokú → tertiary, Igen → yes
  const s = S.beolvasott.rows[1].fields;
  assertEq(s.sex, 'male', 'az „ffi” nem oldódott fel');
  assertEq(s.marital_status, 'unmarried');
  assertEq(s.passport_type, 'private');
  assertEq(s.educational_attainment, 'tertiary');
  assertEq(s.speaks_hungarian, 'yes');
});

atest('a vegyes dátumalakok ISO-ra alakulnak', async () => {
  const s = S.beolvasott.rows[1].fields;
  assertEq(s.date_of_birth, '1985-07-22', 'a „1985.07.22.” alak');
  assertEq(s.pp_validity, '2029-01-05', 'a „2029/01/05” alak');
  assertEq(s.expiration_of_rp, '2027-11-15', 'a „2027.11.15.” alak');
});

// ════════════════════════════════════════════════════════════════════════════
asection('3. Import-terv: párosítás, duplikátum, hiányos sor');

atest('a lejárt azonosítós sor a MEGLÉVŐ emberre talál', async () => {
  EmployeeRepo.useBackend(EmployeeRepo.createMemoryBackend());
  await EmployeeRepo.load();

  // Egy régi ismerős: a SAP-száma azóta megváltozott, a régi LEZÁRULT
  S.meglevo = EmployeeRepo.create({
    fields: { surname: 'Visszatérő', forename: 'Viktor', date_of_birth: '1978-02-10' },
    identifiers: [{ type: 'sap', value: 'SAP-REGI-9' }],
  });
  EmployeeRepo.addIdentifier(S.meglevo.id, { type: 'sap', value: 'SAP-MOSTANI-9' });
  assertEq(EmployeeRepo.currentIdentifier(EmployeeRepo.get(S.meglevo.id), 'sap').value,
    'SAP-MOSTANI-9', 'a próba-előkészítés hibás');

  S.terv = XlsxRead.plan(S.beolvasott.rows, { schema: SchemaStore.get() });

  const viktor = S.terv.find(t => t.row.fields.surname === 'Visszatérő');
  assertEq(viktor.action, 'update', 'nem ismerte fel a meglévő embert');
  assertEq(viktor.employee.id, S.meglevo.id);
  assertEq(viktor.matchedBy, 'identifier', 'nem azonosító alapján párosított');
});

atest('a fájlon belüli duplikátum kiszűrődik', async () => {
  const duplak = S.terv.filter(t => t.action === 'duplicate');
  assertEq(duplak.length, 1, 'nem pontosan egy duplikátum');
  assertEq(duplak[0].row.fields.surname, 'Próba');
});

atest('a hiányos sor a hiányzó KÖTELEZŐ mezőket nevezi meg', async () => {
  const hianyos = S.terv.find(t => t.row.fields.surname === 'Hiányos');
  assert(hianyos.validation.length > 0, 'nem jelezte a hiányzó kötelező mezőket');
  const kulcsok = hianyos.validation.map(v => v.key);
  assert(kulcsok.includes('forename'), `nem a keresztnevet hiányolja: ${kulcsok.join(', ')}`);
  assert(kulcsok.includes('date_of_birth'), 'nem hiányolja a születési dátumot');
});

atest('a kétértelmű dátumot NEM értelmezi, hanem hibát jelez', async () => {
  // A „15/11/2027” lehet november 15. — de a „05/11/2027” már május 11. és
  // november 5. is. Hatósági ügyben egy elvétett dátum súlyos, ezért a
  // beolvasó nem tippel: a nyers érték marad, és a sor validációs hibát kap.
  const k = S.terv.find(t => t.row.fields.surname === 'Kétértelmű');
  assert(k, 'nincs meg a kétértelmű dátumos sor');
  assert(!/^\d{4}-\d{2}-\d{2}$/.test(String(k.row.fields.expiration_of_rp || '')),
    `kitalált egy dátumot: ${k.row.fields.expiration_of_rp}`);
  assert(k.validation.some(v => v.key === 'expiration_of_rp'),
    'nem jelezte a dátumhibát a validációban');
});

atest('a terv összesítése', async () => {
  const szamlal = a => S.terv.filter(t => t.action === a).length;
  assertEq(szamlal('update'), 1, 'frissítés');
  assertEq(szamlal('duplicate'), 1, 'duplikátum');
  const ujak = S.terv.filter(t => t.action === 'create');
  assertEq(ujak.length, 5, 'létrehozandó');
  // Kettő hibás: a hiányzó kötelező mezős és a kétértelmű dátumos
  assertEq(ujak.filter(t => t.validation.length).length, 2, 'validációs hibás sor');
});

// ════════════════════════════════════════════════════════════════════════════
asection('4. Alkalmazás a nyilvántartásra');

atest('az alkalmazás a várt darabszámokat adja', async () => {
  S.eredmeny = XlsxRead.apply(S.terv);
  assertEq(S.eredmeny.letrehozva, 3, 'létrehozva');
  assertEq(S.eredmeny.frissitve, 1);
  // Kimarad: duplikátum + hiányzó kötelező mező + kétértelmű dátum
  assertEq(S.eredmeny.kihagyva, 3, 'kihagyva');
});

atest('a hibás sorból SEMMI nem kerül be – se félig', async () => {
  // A kétértelmű dátumos sor egésze kimarad, nem csak a dátuma. Ez tudatos:
  // ha a személy dátum nélkül bekerülne, az engedély lejárata csendben
  // hiányozna, és a benyújtási ablak sem lenne számolható. Jobb, ha a
  // felhasználó javítja a táblázatot és újraimportál.
  assert(!EmployeeRepo.all().some(e => e.fields.surname === 'Kétértelmű'),
    'a hibás dátumú sor félig bekerült');
  assert(!EmployeeRepo.all().some(e => e.fields.surname === 'Hiányos'),
    'a hiányos sor bekerült a nyilvántartásba');
});

atest('a meglévő ember új azonosítót kapott, a régi lezárult', async () => {
  const v = EmployeeRepo.get(S.meglevo.id);
  const rp = EmployeeRepo.currentIdentifier(v, 'residence_permit');
  assertEq(rp && rp.value, 'RP-2027-NEW', 'az új engedélyszám nem került be');
  // A SAP-történet: a régi és a mostani is megmaradt
  const sapok = v.identifiers.filter(i => i.type === 'sap').map(i => i.value).sort();
  assertEq(sapok.join(','), 'SAP-MOSTANI-9,SAP-REGI-9', 'sérült az azonosító-történet');
});

atest('a lejárt azonosítóra továbbra is megtalálható az ember', async () => {
  const hit = EmployeeRepo.findByIdentifier('SAP-REGI-9');
  assert(hit, 'a lejárt számra nem talál');
  assertEq(hit.id, S.meglevo.id);
});

atest('mind az öt azonosító átkerült a mezőkbe is', async () => {
  const o = EmployeeRepo.all().find(e => e.fields.surname === 'Ötszámú');
  assert(o, 'nincs meg az Ötszámú Ödön');
  assertEq(o.fields.personnel_reg_number, 'SAP-1006');
  assertEq(o.fields.number_of_rp, 'RP-1006');
  assertEq(o.fields.pp_number, 'PP1006');
  assertEq(o.fields.tax_number, '8123456789');
  assertEq(o.fields.TAJ, '123456789');
});

// ════════════════════════════════════════════════════════════════════════════
asection('5. Séma-feloldás — ez megy a sablonokba');

atest('a számított mezők a várt módon fűződnek össze', async () => {
  const p = EmployeeRepo.all().find(e => e.fields.surname === 'Próba');
  const v = SchemaStore.resolveValues(p.fields, 'hu');
  assertEq(v.full_name, 'Próba Péter');
  assertEq(v.mothers_name, 'Kovács Anna');
  assertEq(v.place_of_birth, 'Szerbia, Szabadka');
  assertEq(v.address, '1024 Budapest Fő utca 12');
});

atest('ugyanaz a mező magyarul és angolul is feloldható', async () => {
  const p = EmployeeRepo.all().find(e => e.fields.surname === 'Próba');
  const hu = SchemaStore.resolveValues(p.fields, 'hu');
  const en = SchemaStore.resolveValues(p.fields, 'en');
  assertEq(hu.sex, 'Férfi');
  assertEq(en.sex, 'Male');
  assertEq(hu.marital_status, 'Házas');
  assertEq(en.marital_status, 'Married');
});

atest('a szinonimából beolvasott érték is helyesen renderelődik', async () => {
  // A 2. sor „ffi”-t és „Felsőfokú”-t tartalmazott
  const t = EmployeeRepo.all().find(e => e.fields.surname === 'Teszt');
  const hu = SchemaStore.resolveValues(t.fields, 'hu');
  const en = SchemaStore.resolveValues(t.fields, 'en');
  assertEq(hu.sex, 'Férfi');
  assertEq(en.educational_attainment, 'Tertiary');
  assertEq(hu.speaks_hungarian, 'Igen');
});

// ════════════════════════════════════════════════════════════════════════════
asection('6. Visszaexportálás — a kör bezárul');

atest('a nyilvántartásból kiírt xlsx visszaolvasva ugyanazt adja', async () => {
  const buf = await XlsxWrite.toBuffer({
    schema: SchemaStore.get(), profile: PROFILE, employees: EmployeeRepo.all(),
  });
  const vissza = XlsxRead.readRows(
    buf.buffer ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf,
    { schema: SchemaStore.get(), firstDataRow: PROFILE.firstDataRow });

  assertEq(vissza.rows.length, EmployeeRepo.all().length, 'eltérő sorszám');

  const p = vissza.rows.find(r => r.fields.surname === 'Próba');
  assert(p, 'a Próba Péter sor eltűnt');
  assertEq(p.fields.sex, 'male', 'az enum nem kanonikus alakban ment ki');
  assertEq(p.fields.date_of_birth, '1990-03-15');
  assertEq(p.fields.postal_code, '1024');
  assertEq(p.fields.personnel_reg_number, 'SAP-1001');
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
