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
// A docx-service a böngésző `window`-jára néz betöltéskor (docxtemplater).
// Maga a RENDER DOMParser-t kér, az itt nincs – a jelölő-feloldás viszont
// (makeParser) tiszta JS, és pont az a kérdés, hogy egy jelölő mit talál meg.
sandbox.window = sandbox;
vm.createContext(sandbox);

for (const [rel, name] of [
  ['../js/services/employee-repo.js', 'EmployeeRepo'],
  ['../js/schema/value-codec.js',     'ValueCodec'],
  ['../js/schema/seed-schema.js',     'SEED_SCHEMA'],
  ['../js/schema/schema-store.js',    'SchemaStore'],
  ['../js/services/docx-service.js',  'DocxService'],
  // Csak a jelölőneveiért (`DOC_TAGS`): az ügyszám-jelölők listája ott él, és
  // ez a teszt AZT méri, nem egy ide másolt párját.
  ['../js/services/case-repo.js',     'CaseRepo'],
]) {
  let code = fs.readFileSync(path.join(__dirname, rel), 'utf8');
  code += `\nglobalThis.${name} = ${name};`;
  vm.runInContext(code, sandbox, { filename: rel });
}
const { SchemaStore, SEED_SCHEMA, ValueCodec, EmployeeRepo, DocxService, CaseRepo } = sandbox;
SchemaStore.loadFrom(SEED_SCHEMA);

// ── A docgen két segédfüggvényének kiemelt mása ─────────────────────────────
// Ugyanaz a logika, mint a js/modules/docgen.js-ben; itt DOM nélkül vizsgálható.
// (A docgen forrásában is ellenőrizzük, hogy ez a két függvény tényleg létezik.)

// Az `ugyTags` a docgenben `CaseRepo.docTags(emp.id)` – az ügyekből jövő
// EH szám és iktatószám. A választás szabályait a cases.test.js őrzi; itt az
// a kérdés, hogy a sorba bekerülve nem üt-e el semmit a sémából.
function buildRenderRow(emp, maiNap, ugyTags = {}) {
  const v = SchemaStore.resolveValues(emp.fields, 'hu');
  for (const f of SchemaStore.fields()) {
    const cimke = f.label.hu;
    if (cimke && v[cimke] === undefined) v[cimke] = v[f.key];
  }
  v['mai nap'] = maiNap;
  const sap = EmployeeRepo.currentIdentifier(emp, 'sap');
  if (sap) v['Azonosító'] = sap.value;
  Object.assign(v, ugyTags);
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

test('az ügyből jövő EH szám bekerül a sorba, a sémabeli mezőket nem bántja', () => {
  const r = buildRenderRow(EMP, '2026. augusztus 6.',
    { 'EH szám': 'EH18506859', 'Iktatószám': '106-1-12345-2/2026-T' });
  assertEq(r['EH szám'], 'EH18506859');
  assertEq(r['Iktatószám'], '106-1-12345-2/2026-T');
  assertEq(r['Vezetéknév'], 'Kovács');
  assertEq(r['mai nap'], '2026. augusztus 6.');
});

test('az ügyszám-jelölőket a séma NEM ismeri – ezért oldódnak fel a sorból', () => {
  // Ha valaha bekerülne egy ilyen nevű séma-mező, a feloldó nyerne a sor
  // előtt, és az ügy száma helyett a (soha ki nem töltött) mező menne ki.
  for (const nev of ['EH szám', 'EH-szám', 'ehNumber', 'Iktatószám', 'fileNumber']) {
    assertEq(resolve(nev), null, nev);
  }
});

test('a fájlnév-minta tokenjei feloldhatók a sorból', () => {
  // A DocxService NAME_TOKENS a magyar címkét keresi
  assertEq(row['Vezetéknév'], 'Kovács');
  assertEq(row['Keresztnév'], 'Anna');
});

// ════════════════════════════════════════════════════════════════════════════
section('A bér ezres tagolása');

test('a bér tagolva megy a sablonba, és a docx-oldal sem alakítja vissza', () => {
  const emp = { id: 'ber-1', identifiers: [], fields: { gross_salary: '450000' } };
  const row = buildRenderRow(emp, '2026. augusztus 6.');
  const parser = DocxService.makeParser(row, new Set(), makeSchemaResolver(emp));

  assertEq(parser('Bruttó bér').get(),  '450\u00A0000');
  assertEq(parser('gross_salary').get(), '450\u00A0000');
  // A `formatValue` a lebegőpontos Excel-alakok miatt normalizál számokat; a
  // tagolt érték nem szám többé, ezért érintetlenül megy tovább. Ha valaha
  // mégis visszaalakítaná, a tagolás némán eltűnne a dokumentumból.
  assertEq(DocxService.formatValue('450\u00A0000'), '450\u00A0000');
});

test('a tárolt érték tagolatlan marad', () => {
  const emp = { id: 'ber-2', identifiers: [], fields: { gross_salary: '450000' } };
  buildRenderRow(emp, '2026. augusztus 6.');
  assertEq(emp.fields.gross_salary, '450000');
});

// ════════════════════════════════════════════════════════════════════════════
section('Az ügyszám a sablonban');

// Itt már a VALÓDI feloldó fut (DocxService.makeParser), ugyanaz, amit a
// render hív – nem a normalizálási szabály másolata. A sorban ugyanazok a
// kulcsok vannak, amiket a CaseRepo.docTags ad.
function ugyszamos(tags) {
  const r = buildRenderRow(EMP, '2026. augusztus 6.', tags);
  const emptyTags = new Set();
  const parser = DocxService.makeParser(r, emptyTags, makeSchemaResolver(EMP));
  return { jelolo: nev => parser(nev).get(), emptyTags };
}

/** Amit a CaseRepo.docTags ad, csak kézzel megadott értékekkel. */
function ugyTags(ertekek) {
  const out = {};
  for (const mezo of Object.keys(CaseRepo.DOC_TAGS)) {
    for (const nev of CaseRepo.DOC_TAGS[mezo]) out[nev] = ertekek[mezo] || '';
  }
  return out;
}

const UGY_TAGS = ugyTags({ ehNumber: 'EH18506859', fileNumber: '106-1-12345-2/2026-T' });

test('az EH szám minden írásmódban ugyanazt adja', () => {
  const { jelolo } = ugyszamos(UGY_TAGS);
  for (const nev of ['EH szám', 'EH-szám', 'EH_szám', 'EH szam', 'EH_szam',
                     'ehNumber', 'eh_number', 'EH number']) {
    assertEq(jelolo(nev), 'EH18506859', `{{${nev}}}`);
  }
});

test('az iktatószám sem csúszik el a kötőjelen', () => {
  const { jelolo } = ugyszamos(UGY_TAGS);
  for (const nev of ['Iktatószám', 'Iktatoszam', 'fileNumber', 'file_number']) {
    assertEq(jelolo(nev), '106-1-12345-2/2026-T', `{{${nev}}}`);
  }
});

test('a szám formázás nélkül megy ki', () => {
  // A csupa számjegyű ügyszámot nem szabad számként kerekíteni, a vezető
  // nullát pedig levágni – az azonosító karakterről karakterre az, ami.
  const { jelolo } = ugyszamos(ugyTags({ ehNumber: '0018506859' }));
  assertEq(jelolo('EH szám'), '0018506859');
});

test('nyitott ügy nélkül üres, és bekerül a hiányzó adatok közé', () => {
  const { jelolo, emptyTags } = ugyszamos(ugyTags({}));
  assertEq(jelolo('EH szám'), '');
  assert(emptyTags.has('EH szám'), 'a hiányzó ügyszám némán maradt volna');
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
  assert(/generateDocx\([\s\S]{0,160}resolve:/.test(docgenSrc), 'a generálás nem kapja meg a feloldót');
});

test('a generálás átadja az összehasonlítót is', () => {
  // Enélkül a {{CHECK:Neme=male}} néma hibát adna: a szöveg-egyezésre esne
  // vissza, ami a magyarra renderelt „Férfi”-t hasonlítaná a „male”-hez,
  // és minden ilyen négyzet üresen maradna.
  assert(/makeSchemaMatcher/.test(docgenSrc), 'nincs séma-összehasonlító');
  assert(/generateDocx\([\s\S]{0,160}equals:/.test(docgenSrc),
    'a generálás nem kapja meg az összehasonlítót');
});

test('az ügyek EH száma bekerül a generálandó sorba', () => {
  // A munkavállalónak nincs EH szám mezője: az azonosító az ÜGYÉ. A docgen
  // ezért a CaseRepo-tól kéri el – ha ez a hívás elveszne, a jelölő némán
  // üresen maradna minden dokumentumon.
  assert(/CaseRepo\.docTags/.test(docgenSrc), 'a sor nem kapja meg az ügy azonosítóit');
  assert(/function buildRenderRow[\s\S]{0,1200}ugyJelolok\(emp\.id\)/.test(docgenSrc),
    'a buildRenderRow nem fűzi hozzá az ügy-jelölőket');
});

test('a több nyitott ügy közti választás naplózódik', () => {
  assert(/CASE_EH_AMBIGUOUS/.test(docgenSrc), 'a kétértelmű EH szám némán dőlne el');
});

test('a nyilvántartás változása frissíti a docgen listáját', () => {
  assert(/EmployeeRepo\.onChange/.test(docgenSrc), 'nincs feliratkozás a változásokra');
});

// ════════════════════════════════════════════════════════════════════════════
section('Szótár mindkét irányban');

// A szótár PÁR, nem irány: mindegy, melyik nyelven van az adat a
// nyilvántartásban. A nyelvet kizárólag a jelölő végződése választja.
function szotarral(parok) {
  SchemaStore.loadFrom(SEED_SCHEMA);
  SchemaStore.setDictionary(SchemaStore.dictionary().concat(parok));
}
const PAR = [{ en: 'EU Blue Card', hu: 'EU Kék Kártya' }];

test('magyarul tárolt érték: a végződés választ nyelvet', () => {
  szotarral(PAR);
  const v = { residence_purpose: 'EU Kék Kártya' };
  assertEq(SchemaStore.renderTag('residence_purpose', v),    'EU Kék Kártya');
  assertEq(SchemaStore.renderTag('residence_purpose_en', v), 'EU Blue Card');
});

test('ANGOLUL tárolt érték: ugyanaz a pár, ugyanaz az eredmény', () => {
  szotarral(PAR);
  const v = { residence_purpose: 'EU Blue Card' };
  assertEq(SchemaStore.renderTag('residence_purpose', v),    'EU Kék Kártya');
  assertEq(SchemaStore.renderTag('residence_purpose_en', v), 'EU Blue Card');
});

test('mind a négy végződés és a magyar címke egyezik', () => {
  szotarral(PAR);
  const v = { residence_purpose: 'EU Kék Kártya' };
  for (const t of ['residence_purpose_hu', 'residence_purpose_hun', 'Tartózkodás célja'])
    assertEq(SchemaStore.renderTag(t, v), 'EU Kék Kártya', t);
  for (const t of ['residence_purpose_en', 'residence_purpose_eng', 'Tartózkodás célja_EN'])
    assertEq(SchemaStore.renderTag(t, v), 'EU Blue Card', t);
});

test('az illesztés normalizál (ékezet, kis/nagybetű, elválasztó)', () => {
  szotarral(PAR);
  for (const nyers of ['eu kek kartya', 'EU-KÉK-KÁRTYA', '  Eu   Kék  Kártya  '])
    assertEq(SchemaStore.renderTag('residence_purpose_en', { residence_purpose: nyers }),
      'EU Blue Card', nyers);
});

test('nincs szótári pár: mindkét jelölő az eredetit adja', () => {
  szotarral([]);
  const v = { position: 'darukezelő' };
  assertEq(SchemaStore.renderTag('position', v),    'darukezelő');
  assertEq(SchemaStore.renderTag('position_en', v), 'darukezelő');
});

test('a szótár az ÉRTÉKRE illeszkedik, nem mezőre', () => {
  szotarral(PAR);
  // Ugyanaz az egy pár három különböző mezőn ugyanazt adja
  for (const kulcs of ['residence_purpose', 'position', 'hr_dual_citizenship'])
    assertEq(SchemaStore.renderTag(kulcs + '_en', { [kulcs]: 'EU Kék Kártya' }),
      'EU Blue Card', kulcs);
});

// ════════════════════════════════════════════════════════════════════════════
section('Fordítatlan értékek felismerése');

test('van adat, de nincs pár → fordítatlan', () => {
  szotarral([]);
  assert(SchemaStore.isUntranslated('position_en', { position: 'darukezelő' }),
    'nem ismerte fel a fordítatlan értéket');
});

test('van pár → nem fordítatlan', () => {
  szotarral(PAR);
  assert(!SchemaStore.isUntranslated('residence_purpose_en',
    { residence_purpose: 'EU Kék Kártya' }), 'lefordítottat jelölt meg');
});

test('üres adat és magyar jelölő nem fordítatlan', () => {
  szotarral([]);
  assert(!SchemaStore.isUntranslated('position_en', { position: '' }), 'üres érték');
  assert(!SchemaStore.isUntranslated('position',    { position: 'darukezelő' }), 'magyar jelölő');
  // Az enumnak saját értéklistája van, azt nem a szótár fordítja
  assert(!SchemaStore.isUntranslated('sex_en', { sex: 'male' }), 'enum mező');
});

// ════════════════════════════════════════════════════════════════════════════
section('Enum: angol fordítás nélkül se szivárogjon gépi azonosító');

test('hiányzó angol alak a MAGYARRA esik vissza, sosem az id-re', () => {
  const s = JSON.parse(JSON.stringify(SEED_SCHEMA));
  s.fields.push({ key: 'permit_type', group: 'foglalkoztatas', type: 'enum',
    label: { hu: 'Engedély típusa', en: 'Permit type' },
    values: [{ id: 'eu_blue_card', hu: 'EU Kék Kártya' }] });
  SchemaStore.loadFrom(s);
  assertEq(SchemaStore.renderTag('permit_type',    { permit_type: 'eu_blue_card' }), 'EU Kék Kártya');
  assertEq(SchemaStore.renderTag('permit_type_en', { permit_type: 'eu_blue_card' }), 'EU Kék Kártya');
});

// ════════════════════════════════════════════════════════════════════════════
section('A szótár integritás-ellenőrzése');

const dictHibak = d => SchemaStore.validateDictionary(d);

test('a seed séma szótára tiszta', () => {
  SchemaStore.loadFrom(SEED_SCHEMA);
  assertEq(SchemaStore.validateSchema().length, 0,
    'a seed sémán nem lehet ellentmondás: ' + SchemaStore.validateSchema().join(' | '));
});

test('ugyanaz a magyar alak két párban → jelez', () => {
  assertEq(dictHibak([{ en: 'airplane', hu: 'repülő' },
                      { en: 'plane',    hu: 'repülő' }]).length, 1);
});

test('fordítva felvitt pár → jelez', () => {
  const p = dictHibak([{ en: 'EU Kék Kártya', hu: 'EU Blue Card' }]);
  assertEq(p.length, 1);
  assert(/fordítva/.test(p[0]), 'nem a fordított sorrendre panaszkodik: ' + p[0]);
});

test('helyes sorrendű pár nem ad hamis riasztást', () => {
  assertEq(dictHibak([{ en: 'EU Blue Card', hu: 'EU Kék Kártya' },
                      { en: 'welder',       hu: 'hegesztő' },
                      { en: 'Serbia',       hu: 'Szerbia' }]).length, 0);
});

test('mindkét oldalon ékezetes pár nem ad hamis riasztást', () => {
  assertEq(dictHibak([{ en: 'Malmö', hu: 'Malmö' }]).length, 0);
});

test('ugyanaz a szöveg az egyik pár angol, a másik magyar oldalán → jelez', () => {
  assert(dictHibak([{ en: 'Serbia', hu: 'Szerbia' },
                    { en: 'Srbija', hu: 'Serbia'  }]).length >= 1);
});

test('a szótár hibái a séma-ellenőrzésben is megjelennek', () => {
  const s = JSON.parse(JSON.stringify(SEED_SCHEMA));
  s.dictionary = [{ en: 'EU Kék Kártya', hu: 'EU Blue Card' }];
  SchemaStore.loadFrom(s);
  assert(SchemaStore.validateSchema().some(p => /Szótár/.test(p)),
    'a validateSchema nem hozta át a szótár hibáit');
});

// A további tesztek a seed sémát várják
SchemaStore.loadFrom(SEED_SCHEMA);

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
