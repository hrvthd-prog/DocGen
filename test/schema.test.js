'use strict';

// Séma-réteg tesztjei (value-codec + schema-store + kiinduló séma)
// Futtatás: node test/schema.test.js

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
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || 'assertEq'}: várt ${JSON.stringify(b)}, kapott ${JSON.stringify(a)}`);
}
function section(name) { console.log(`\n[${name}]`); }

// ── A séma-réteg betöltése egy közös sandboxba ──────────────────────────────
const sandbox = {
  console, Date, Math, JSON, Set, Map, Object, Array, String, Number, Boolean,
  Error, RegExp, Promise, isNaN, parseInt, parseFloat,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['value-codec.js', 'seed-schema.js', 'schema-store.js']) {
  let code = fs.readFileSync(path.join(__dirname, '../js/schema/', f), 'utf8');
  code += `\nglobalThis.${f === 'value-codec.js' ? 'ValueCodec' : f === 'seed-schema.js' ? 'SEED_SCHEMA' : 'SchemaStore'} = ${
    f === 'value-codec.js' ? 'ValueCodec' : f === 'seed-schema.js' ? 'SEED_SCHEMA' : 'SchemaStore'};`;
  vm.runInContext(code, sandbox);
}
const { ValueCodec, SchemaStore, SEED_SCHEMA } = sandbox;

SchemaStore.loadFrom(SEED_SCHEMA);

// ════════════════════════════════════════════════════════════════════════════
section('Kiinduló séma épsége');

// A hatósági formanyomtatvány (9. melléklet) hat olyan rovatot kér, ami az
// eredeti 44 oszlopos adatbekérőben nem szerepelt. Külön soroljuk fel őket,
// hogy a bővülés szándékos maradjon: aki új mezőt vesz fel, ide is beírja.
const FORMANYOMTATVANY_MEZOK = [
  'pp_issuance_place', 'stairway', 'topographical_number',
  'other_accommodation', 'occupation_before_arrival',
];

// A HR korábbi „Personal Data Sheet" űrlapjából átvett rovatok. Egyetlen irat
// sem hivatkozik rájuk – azért vannak a sémában, hogy EGY táblázat menjen ki a
// munkavállalóhoz. A `hr_` prefix kötelező: ez zárja ki, hogy az importáló
// címke szerint egy idegenrendészeti mezőbe kösse őket.
const HR_MEZOK = [
  'hr_emergency_contact_name', 'hr_emergency_contact_phone', 'hr_dual_citizenship',
  'hr_bank_account', 'hr_bank_name', 'hr_education_completion_date',
  'hr_education_institution', 'hr_education_specialization', 'hr_degree_document_number',
  'hr_computer_skills', 'hr_language_skills', 'hr_children', 'hr_previous_employer',
  'hr_previous_employment_end',
  'hr_department_cost_center', 'hr_direct_leader', 'hr_sg_category',
];

// Két HR-rovat szándékosan NINCS a sémában, mert már van rá mező:
//   „Identity Card Number"    → az útlevélszám (pp_number) viszi
//   „Professional Background" → occupation_before_arrival
test('a duplikált HR-rovatok nincsenek felvéve', () => {
  for (const k of ['hr_id_number', 'hr_professional_background']) {
    assertEq(SchemaStore.field(k), null, `felesleges mező a sémában: ${k}`);
  }
});

// Valódi hibából született: friss telepítésen nem, egy RÉGEBBI, már MENTETT
// sémánál viszont bennmaradt ez a két mező, és kiment az adatbekérő BM/BN
// oszlopában. Az `addMissingSeedFields` csak hozzáad, ezért kell a párja.
test('a visszavont mezők a már mentett sémából is kiesnek', () => {
  const regi = JSON.parse(JSON.stringify(SEED_SCHEMA));
  regi.fields.push(
    { key: 'hr_id_number', label: { hu: 'Személyi igazolvány száma', en: 'Identity Card Number' },
      group: 'hr_belso', type: 'text' },
    { key: 'hr_professional_background', label: { hu: 'Szakmai háttér', en: 'Professional Background' },
      group: 'hr_belso', type: 'text' },
    { key: 'sajat_mezo', label: { hu: 'Saját mező', en: 'Own field' }, group: 'hr_belso', type: 'text' });
  SchemaStore.loadFrom(regi);
  assert(SchemaStore.field('hr_id_number'), 'a teszt előfeltétele nem áll');

  assertEq(SchemaStore.removeRetiredFields(), 2, 'nem két mező esett ki');
  assertEq(SchemaStore.field('hr_id_number'), null);
  assertEq(SchemaStore.field('hr_professional_background'), null);
  assert(SchemaStore.field('sajat_mezo'), 'a felhasználó saját mezőjét is elvitte');
  assert(SchemaStore.field('pp_number'), 'hatósági mező esett áldozatul');
  assertEq(SchemaStore.removeRetiredFields(), 0, 'a második futás nem idempotens');

  SchemaStore.loadFrom(SEED_SCHEMA);   // a többi teszt tiszta sémát vár
  assertEq(SchemaStore.removeRetiredFields(), 0, 'friss seeden nincs mit törölni');
});

test('az eredeti 44 mező megvan, a formanyomtatvány és a HR mezőivel kiegészítve', () => {
  const kulcsok = SchemaStore.storedFields().map(f => f.key);
  assertEq(kulcsok.length, 44 + FORMANYOMTATVANY_MEZOK.length + HR_MEZOK.length);

  const hianyzo = FORMANYOMTATVANY_MEZOK.concat(HR_MEZOK).filter(k => !kulcsok.includes(k));
  assertEq(hianyzo.length, 0, 'hiányzó mező: ' + hianyzo.join(', '));
});

/**
 * A HR-mezők nem üthetnek ütközésbe az idegenrendészeti adatkörrel.
 *
 * Az importáló a fejlécet kulcs, majd magyar/angol CÍMKE és jelölő szerint
 * próbálja mezőhöz kötni (xlsx-read.js matchByLabel). Ha két mezőnek egyezik a
 * címkéje, a HR-rovat tartalma egy hatósági iratba kerülhetne – ezért mérjük.
 * A `validateSchema` a kulcsot, a magyar címkét és a jelölőket vizsgálja, az
 * ANGOL címkét viszont nem: azt itt ellenőrizzük.
 */
test('a HR-mezők nem ütköznek az idegenrendészeti mezőkkel', () => {
  const norm = s => String(s).toLowerCase().replace(/[\s._-]+/g, ' ').trim();
  const hrKulcsok = new Set(HR_MEZOK);
  const idegen = SchemaStore.fields().filter(f => !hrKulcsok.has(f.key));
  const foglalt = new Set();
  for (const f of idegen) {
    for (const t of [f.key, f.label.hu, f.label.en].concat(f.tags || [])) {
      if (t) foglalt.add(norm(t));
    }
  }

  const utkozes = [];
  for (const key of HR_MEZOK) {
    const f = SchemaStore.field(key);
    assert(f, `nincs ilyen HR-mező: ${key}`);
    assert(/^hr_/.test(f.key), `a HR-mező kulcsa nem hr_ előtaggal kezdődik: ${f.key}`);
    assertEq((f.tags || []).length, 0, `a HR-mezőnek nem lehet jelölője: ${f.key}`);
    for (const t of [f.key, f.label.hu, f.label.en]) {
      if (t && foglalt.has(norm(t))) utkozes.push(`${f.key}: „${t}"`);
    }
  }
  assertEq(utkozes.length, 0, 'ütköző címke: ' + utkozes.join(' | '));
});

test('számított mező nem épít HR-adatra', () => {
  // Ha egy irat számított mezője HR-adatból származna, a „nem használjuk"
  // szabály csendben megszűnne.
  const rossz = SchemaStore.fields()
    .filter(f => f.type === 'computed')
    .filter(f => (f.computed.from || []).some(k => /^hr_/.test(k)))
    .map(f => f.key);
  assertEq(rossz.join(','), '', 'HR-adatra épülő számított mező');
});

/**
 * A SÉMA (schema.fields) BELSŐ TÁROLÁSI SORRENDJE.
 *
 * 2026-08-17-től 2026-08-18-ig ez a sorrend volt EGYBEN az adatbekérő xlsx
 * exportjának oszlopsorrendje is – onnantól a kettő szétvált: az exportot a
 * `js/schema/export-profiles.js` `sections` tömbje adja (téma szerinti
 * sorrend, lásd `test/xlsx.test.js` → „az adatbekérő oszlopsorrendje a
 * profil sections szerint"), a séma belső tárolási sorrendje viszont
 * változatlanul ez maradt (nincs oka átrendezni, ami eddig sem volt hiba).
 *
 * Ez a teszt tehát MA MÁR CSAK azt őrzi, hogy a séma belső sorrendje ne
 * csússzon el csendben – nem az exportét. Ha a sorrend elcsúszik, ez a teszt
 * bukik — a listát csak tudatosan szabad átírni.
 */
const HATOSAGI_SORREND = [
  // fejrész: engedélyszám, elérhetőség
  'personnel_reg_number', 'number_of_rp', 'expiration_of_rp', 'telephone', 'email',
  // 1. pont — személyes adatok
  'surname', 'forename', 'surname_at_birth', 'forename_at_birth',
  'mothers_surname_at_birth', 'mothers_forename_at_birth', 'sex', 'marital_status',
  'date_of_birth', 'place_of_birth_locality', 'place_of_birth_country', 'citizenship',
  'hr_dual_citizenship', 'professional_qualification', 'educational_attainment',
  'hr_education_completion_date', 'hr_education_institution', 'hr_education_specialization',
  'hr_degree_document_number', 'occupation_before_arrival',
  // 2. pont — útlevél (szám → kiállítás ideje → HELYE → típus → érvényesség)
  'pp_number', 'pp_issuance_date', 'pp_issuance_place', 'passport_type', 'pp_validity',
  // 3. pont — magyarországi szálláshely (helyrajzi szám elöl)
  'topographical_number', 'postal_code', 'locality', 'name_of_public_place',
  'type_of_public_place', 'street_number', 'building', 'stairway', 'floor', 'door',
  'other_accommodation',
  // 6. pont — eltartott hozzátartozók
  'hr_children',
  // 7. pont — érkezést megelőző lakcím
  'previous_country', 'previous_town', 'previous_street',
  // betétlap
  'gross_salary', 'residence_purpose', 'position', 'feor',
  'employment_start', 'employment_end',
  'mother_tongue', 'hr_language_skills', 'speaks_hungarian', 'hr_computer_skills',
  'hr_previous_employer', 'hr_previous_employment_end',
  // nem a nyomtatványról
  'tax_number', 'TAJ', 'hr_emergency_contact_name', 'hr_emergency_contact_phone',
  'hr_bank_account', 'hr_bank_name', 'hr_department_cost_center', 'hr_direct_leader',
  'hr_sg_category',
];

test('a séma belső mezősorrendje nem csúszott el', () => {
  const kulcsok = SchemaStore.storedFields().map(f => f.key);
  assertEq(kulcsok.join('\n'), HATOSAGI_SORREND.join('\n'), 'elcsúszott mezősorrend');
});

test('az útlevél kiállításának helye a kiállítás dátuma után áll', () => {
  // A nyomtatványon egyetlen rovat: „kiállításának ideje, helye". Korábban a
  // kiállítás helye a személyes adatok közé került, ami átvezetéskor ugrálást
  // okozott.
  const k = SchemaStore.storedFields().map(f => f.key);
  assertEq(k.indexOf('pp_issuance_place'), k.indexOf('pp_issuance_date') + 1);
  assertEq(k.indexOf('passport_type'), k.indexOf('pp_issuance_place') + 1);
});

test('a kötelező mezők jelölve vannak', () => {
  const req = SchemaStore.storedFields().filter(f => f.required).map(f => f.key).sort();
  assertEq(req.join(','), 'citizenship,date_of_birth,forename,surname');
});

test('mind az öt legördülő mező enum típusú', () => {
  const enums = SchemaStore.fields().filter(f => f.type === 'enum').map(f => f.key).sort();
  assertEq(enums.join(','),
    'educational_attainment,marital_status,passport_type,sex,speaks_hungarian');
});

test('a séma önmagában ellentmondásmentes', () => {
  const problems = SchemaStore.validateSchema();
  assertEq(problems.length, 0, 'talált problémák: ' + problems.join(' | '));
});

test('minden mezőnek van magyar és angol címkéje', () => {
  const rossz = SchemaStore.fields().filter(f => !f.label.hu || !f.label.en).map(f => f.key);
  assertEq(rossz.length, 0, 'hiányos címke: ' + rossz.join(', '));
});

// ════════════════════════════════════════════════════════════════════════════
section('Érték-kódolás: magyar/angol írásmódok');

test('a nem mező mindkét nyelven és a komment írásmódjával is felismerhető', () => {
  const f = SchemaStore.field('sex');
  for (const raw of ['male', 'Male', 'MALE', 'férfi', 'Férfi', 'ferfi', 'ffi', 'm']) {
    assertEq(ValueCodec.decode(f, raw), 'male', `nem ismerte fel: ${raw}`);
  }
  for (const raw of ['female', 'Nő', 'no', 'noeoe', 'női']) {
    assertEq(ValueCodec.decode(f, raw), 'female', `nem ismerte fel: ${raw}`);
  }
});

test('a családi állapot mind a négy értéke felismerhető magyarul és angolul', () => {
  const f = SchemaStore.field('marital_status');
  const vart = {
    'married': 'married', 'Házas': 'married', 'hazas': 'married',
    'unmarried': 'unmarried', 'single': 'unmarried', 'nőtlen': 'unmarried', 'hajadon': 'unmarried',
    'divorced': 'divorced', 'Elvált': 'divorced', 'elvalt': 'divorced',
    'widow': 'widow', 'Özvegy': 'widow', 'ozvegy': 'widow',
  };
  for (const [raw, id] of Object.entries(vart)) {
    assertEq(ValueCodec.decode(f, raw), id, `nem ismerte fel: ${raw}`);
  }
});

test('az iskolai végzettség a régi angol változatokat is felismeri', () => {
  const f = SchemaStore.field('educational_attainment');
  assertEq(ValueCodec.decode(f, 'elementary school'), 'primary');
  assertEq(ValueCodec.decode(f, 'high school graduation'), 'secondary');
  assertEq(ValueCodec.decode(f, 'university'), 'tertiary');
  assertEq(ValueCodec.decode(f, 'Felsőfokú'), 'tertiary');
  assertEq(ValueCodec.decode(f, 'none'), 'none');
});

test('ismeretlen enum-érték null, nem néma hiba', () => {
  const f = SchemaStore.field('sex');
  assertEq(ValueCodec.decode(f, 'egyéb'), null);
  assertEq(ValueCodec.canDecode(f, 'egyéb'), false);
});

test('üres érték megengedett', () => {
  const f = SchemaStore.field('sex');
  assertEq(ValueCodec.decode(f, ''), '');
  assertEq(ValueCodec.canDecode(f, ''), true);
});

test('nem enum mező értéke változatlan marad', () => {
  const f = SchemaStore.field('surname');
  assertEq(ValueCodec.decode(f, '  Kovács  '), 'Kovács');
});

// ════════════════════════════════════════════════════════════════════════════
section('Kétnyelvű megjelenítés (HU-ENG sablonokhoz)');

test('ugyanaz az érték magyarul és angolul is renderelhető', () => {
  const f = SchemaStore.field('sex');
  assertEq(ValueCodec.render(f, 'male', 'hu'), 'Férfi');
  assertEq(ValueCodec.render(f, 'male', 'en'), 'Male');
  assertEq(ValueCodec.render(f, 'female', 'hu'), 'Nő');
  assertEq(ValueCodec.render(f, 'female', 'en'), 'Female');
});

test('a családi állapot mindkét nyelven helyes', () => {
  const f = SchemaStore.field('marital_status');
  assertEq(ValueCodec.render(f, 'married', 'hu'), 'Házas');
  assertEq(ValueCodec.render(f, 'married', 'en'), 'Married');
  assertEq(ValueCodec.render(f, 'unmarried', 'hu'), 'Nőtlen/hajadon');
  assertEq(ValueCodec.render(f, 'unmarried', 'en'), 'Single');
});

test('exporthoz a kanonikus id megy ki (ezt várja az adatbekérő)', () => {
  const f = SchemaStore.field('sex');
  assertEq(ValueCodec.encode(f, 'male', 'id'), 'male');
  assertEq(ValueCodec.encode(f, 'male', 'hu'), 'Férfi');
  assertEq(ValueCodec.encode(f, 'male', 'en'), 'Male');
});

// ════════════════════════════════════════════════════════════════════════════
section('Dokumentum-jelölők feloldása');

test('jelölő feloldása kulcs, magyar címke és alias alapján', () => {
  assertEq(SchemaStore.resolveTag('surname').field.key, 'surname');
  assertEq(SchemaStore.resolveTag('Vezetéknév').field.key, 'surname');
  assertEq(SchemaStore.resolveTag('Neme').field.key, 'sex');
  assertEq(SchemaStore.resolveTag('Nem').field.key, 'sex');
});

test('a feloldás kis/nagybetűre és aláhúzásra érzéketlen', () => {
  assertEq(SchemaStore.resolveTag('VEZETÉKNÉV').field.key, 'surname');
  assertEq(SchemaStore.resolveTag('date_of_birth').field.key, 'date_of_birth');
  assertEq(SchemaStore.resolveTag('Születési idő').field.key, 'date_of_birth');
});

test('_EN végződés az angol nyelvet kéri', () => {
  const r = SchemaStore.resolveTag('Neme_EN');
  assertEq(r.field.key, 'sex');
  assertEq(r.lang, 'en');
  assertEq(SchemaStore.resolveTag('Neme').lang, 'hu');
});

test('ismeretlen jelölő null', () => {
  assertEq(SchemaStore.resolveTag('NincsIlyenMező'), null);
});

test('_HUN végződés a magyar nyelvet kéri', () => {
  const r = SchemaStore.resolveTag('previous_country_hun');
  assertEq(r.field.key, 'previous_country');
  assertEq(r.lang, 'hu');
  assertEq(SchemaStore.resolveTag('previous_country_eng').lang, 'en');
});

// A teljes név elsőbbsége nem szőrszálhasogatás: a „Név" jelölő az `év`
// utótagra végződik, tehát utótag-elemzéssel „N" + év lenne belőle. Egy valódi
// mezőnév mindig erősebb, mint egy utótag-találgatás.
test('a teljes mezőnév erősebb, mint az utótag-értelmezés', () => {
  const r = SchemaStore.resolveTag('Név');
  assertEq(r.field.key, 'full_name');
  assertEq(r.part, null);
});

test('dátum-rész jelölők: év, hónap, nap', () => {
  const mezok = { date_of_birth: '1999-01-05' };
  assertEq(SchemaStore.renderTag('date_of_birth_year', mezok),  '1999');
  assertEq(SchemaStore.renderTag('date_of_birth_month', mezok), '01');
  assertEq(SchemaStore.renderTag('date_of_birth_day', mezok),   '05');
  // Utótag nélkül a TELJES dátum jön, magyar alakban – ez megy a hatósági iratba
  assertEq(SchemaStore.renderTag('date_of_birth', mezok),       '1999.01.05.');
  // magyar utótagok ugyanúgy
  assertEq(SchemaStore.renderTag('Születési idő_év', mezok),   '1999');
  assertEq(SchemaStore.renderTag('Születési idő_nap', mezok),  '05');
});

test('hiányzó vagy hibás dátumból nem találgatunk részt', () => {
  assertEq(SchemaStore.renderTag('date_of_birth_year', {}), '');
  assertEq(SchemaStore.renderTag('date_of_birth_year', { date_of_birth: 'tavaly' }), '');
});

test('a dátum magyar alakban jelenik meg, a tárolás ISO marad', () => {
  const mezok = { date_of_birth: '1988-04-12', pp_validity: '2031-06-29' };
  assertEq(SchemaStore.renderTag('date_of_birth', mezok), '1988.04.12.');
  assertEq(SchemaStore.renderTag('Útlevél érvényessége', mezok), '2031.06.29.');
  // a tárolt érték érintetlen – ez megy vissza az adatbekérőbe
  assertEq(mezok.date_of_birth, '1988-04-12');
  // a vezető nulla adat, nem formázás
  assertEq(SchemaStore.renderTag('date_of_birth', { date_of_birth: '2026-01-05' }), '2026.01.05.');
});

test('a magyar alak mellett a rovatok továbbra is jók', () => {
  // A rész a TÁROLT ISO-ból jön; ha a megjelenített alakból venné, a
  // pontokon elhasalna, és mindhárom rovat üres maradna.
  const mezok = { date_of_birth: '1988-04-12' };
  assertEq(SchemaStore.renderTag('date_of_birth_year', mezok),  '1988');
  assertEq(SchemaStore.renderTag('date_of_birth_month', mezok), '04');
  assertEq(SchemaStore.renderTag('date_of_birth_day', mezok),   '12');
});

test('csonka dátumot nem szépítünk', () => {
  assertEq(SchemaStore.renderTag('date_of_birth', { date_of_birth: '1988-04' }), '1988-04');
  assertEq(SchemaStore.renderTag('date_of_birth', { date_of_birth: '' }), '');
});

test('év-elöl alak akárhogy tagolva egységesül, ambigúzat nem alakítunk', () => {
  // Év elöl = egyértelmű, akárhogy tagolják → 1988.04.12.
  for (const raw of ['1988-04-12', '1988.04.12', '1988.04.12.', '1988.4.12', '1988/04/12']) {
    assertEq(SchemaStore.renderTag('date_of_birth', { date_of_birth: raw }), '1988.04.12.', raw);
  }
  // nap/hó vs hó/nap → találgatás lenne, ezért érintetlenül marad
  assertEq(SchemaStore.renderTag('date_of_birth', { date_of_birth: '04/12/88' }), '04/12/88');
  assertEq(SchemaStore.renderTag('date_of_birth', { date_of_birth: '04/12/1988' }), '04/12/1988');
});

// ════════════════════════════════════════════════════════════════════════════
section('Értékhez kötött jelölőnégyzet');
// A hatósági űrlap nem kiírja az értéket, hanem bejelöli: „☐ male ☒ female".
// Ilyenkor több négyzet néz ugyanarra a mezőre, más-más várt értékkel.

test('a mező értéke szerint dől el a négyzet', () => {
  assertEq(SchemaStore.tagEquals('sex', 'male',   { sex: 'male' }), true);
  assertEq(SchemaStore.tagEquals('sex', 'female', { sex: 'male' }), false);
});

test('a várt érték bármelyik elfogadott alakban írható', () => {
  const mezok = { sex: 'male' };
  for (const alak of ['male', 'Férfi', 'ffi', 'MALE']) {
    assertEq(SchemaStore.tagEquals('sex', alak, mezok), true, `nem ismerte fel: ${alak}`);
  }
  // a jelölő oldala is: magyar címke, alias
  assertEq(SchemaStore.tagEquals('Neme', 'male', mezok), true);
});

test('üres mezőnél egyetlen négyzet sem jelölődik be', () => {
  for (const v of ['unmarried', 'married', 'divorced', 'widow']) {
    assertEq(SchemaStore.tagEquals('marital_status', v, {}), false, v);
    assertEq(SchemaStore.tagEquals('marital_status', v, { marital_status: '' }), false, v);
  }
});

test('ismeretlen értékre NEM jelölünk be mindent', () => {
  // Két fel nem ismert érték egyformán `null`-ra dekódolódik – ha ezt
  // egyezésnek vennénk, egy elgépelt adat MINDEN négyzetet bejelölne.
  assertEq(SchemaStore.tagEquals('sex', 'male',   { sex: 'egyéb' }), false);
  assertEq(SchemaStore.tagEquals('sex', 'kutyus', { sex: 'egyéb' }), false);
});

test('szabad szöveges mezőn ékezet- és kisbetű-tűrő az egyezés', () => {
  assertEq(SchemaStore.tagEquals('residence_purpose', 'employment',
    { residence_purpose: 'Employment' }), true);
  assertEq(SchemaStore.tagEquals('residence_purpose', 'studies',
    { residence_purpose: 'Employment' }), false);
});

test('ismeretlen jelölőre null – a hívó eshet vissza másra', () => {
  assertEq(SchemaStore.tagEquals('nincs_ilyen_mezo', 'x', {}), null);
});

// ════════════════════════════════════════════════════════════════════════════
section('Szabály szerint származtatott mező');
// A hazautazás módját nem a kitöltő adja meg: az állampolgárságból következik.

test('szomszédos országból busz, távolabbról repülő', () => {
  SchemaStore.setDictionary([{ en: 'bus', hu: 'busz' }, { en: 'airplane', hu: 'repülő' }]);
  const mod = a => SchemaStore.renderTag('transport_type', { citizenship: a });

  for (const a of ['Szerbia', 'Ukrajna', 'Románia', 'Ausztria', 'Horvátország']) {
    assertEq(mod(a), 'busz', `${a} nem busz`);
  }
  for (const a of ['Fülöp-szigetek', 'Mexikó', 'Brazília', 'Vietnám']) {
    assertEq(mod(a), 'repülő', `${a} nem repülő`);
  }
});

test('a felismerés ékezet- és kisbetű-tűrő', () => {
  assertEq(SchemaStore.renderTag('transport_type', { citizenship: 'szerbia' }), 'busz');
  assertEq(SchemaStore.renderTag('transport_type', { citizenship: 'UKRAJNA' }), 'busz');
});

test('állampolgárság nélkül üres marad – nem találgatunk', () => {
  assertEq(SchemaStore.renderTag('transport_type', {}), '');
  assertEq(SchemaStore.renderTag('transport_type', { citizenship: '  ' }), '');
  SchemaStore.setDictionary([]);
});

test('a származtatott mező NEM kerül ki az adatbekérőbe', () => {
  // Számított mező: nincs értelme megkérdezni, amit ki tudunk számolni.
  assertEq(SchemaStore.storedFields().some(f => f.key === 'transport_type'), false);
});

// ════════════════════════════════════════════════════════════════════════════
section('Szótár: szabad szöveg angolról magyarra');

test('a szótár mindkét irányban felismer, és nyelvet vált', () => {
  SchemaStore.setDictionary([{ en: 'Serbia', hu: 'Szerbia' }, { en: 'welder', hu: 'hegesztő' }]);
  const mezok = { previous_country: 'Serbia', position: 'welder' };
  assertEq(SchemaStore.renderTag('previous_country_hun', mezok), 'Szerbia');
  assertEq(SchemaStore.renderTag('previous_country_eng', mezok), 'Serbia');
  assertEq(SchemaStore.renderTag('previous_country', mezok),     'Szerbia');
  assertEq(SchemaStore.renderTag('position_hun', mezok),         'hegesztő');
  // magyarul beírt érték is felismerhető, és visszaadható angolul
  assertEq(SchemaStore.renderTag('previous_country_eng', { previous_country: 'Szerbia' }), 'Serbia');
});

test('szótárban nem szereplő érték változatlanul megy tovább', () => {
  assertEq(SchemaStore.renderTag('previous_country_hun', { previous_country: 'Fantázia' }), 'Fantázia');
});

test('a szótár az enum mezőket nem bántja', () => {
  SchemaStore.setDictionary([{ en: 'Male', hu: 'Hímnemű' }]);
  assertEq(SchemaStore.renderTag('Neme', { sex: 'male' }), 'Férfi');
  SchemaStore.setDictionary([]);
});

test('a féloldalas pár nem kerül be', () => {
  const megmaradt = SchemaStore.setDictionary([
    { en: 'Serbia', hu: '' }, { en: '', hu: 'Ukrajna' },
    { en: 'Serbia', hu: 'Szerbia' }, { en: 'serbia', hu: 'Másik' },
  ]);
  assertEq(megmaradt.length, 1, 'csak a teljes, nem ismétlődő pár marad');
  assertEq(megmaradt[0].hu, 'Szerbia');
  SchemaStore.setDictionary([]);
});

// ════════════════════════════════════════════════════════════════════════════
section('Számított mezők');

const minta = {
  surname: 'Kovács', forename: 'Anna',
  mothers_surname_at_birth: 'Szabó', mothers_forename_at_birth: 'Mária',
  place_of_birth_country: 'Fülöp-szigetek', place_of_birth_locality: 'Manila',
  postal_code: '1024', locality: 'Budapest',
  name_of_public_place: 'Fő', type_of_public_place: 'utca', street_number: '12',
  sex: 'male', marital_status: 'married',
};

test('anyja neve és születési helye összeáll', () => {
  const v = SchemaStore.resolveValues(minta, 'hu');
  assertEq(v.mothers_name, 'Szabó Mária');
  assertEq(v.place_of_birth, 'Fülöp-szigetek, Manila');
  assertEq(v.full_name, 'Kovács Anna');
  assertEq(v.address, '1024 Budapest Fő utca 12');
});

test('hiányzó összetevő nem hagy csúnya elválasztót', () => {
  const v = SchemaStore.resolveValues({ mothers_surname_at_birth: 'Szabó' }, 'hu');
  assertEq(v.mothers_name, 'Szabó');
  assertEq(v.place_of_birth, '');
});

test('a renderelt értékkészlet az enumokat is lefordítja', () => {
  const hu = SchemaStore.resolveValues(minta, 'hu');
  const en = SchemaStore.resolveValues(minta, 'en');
  assertEq(hu.sex, 'Férfi');
  assertEq(en.sex, 'Male');
  assertEq(hu.marital_status, 'Házas');
  assertEq(en.marital_status, 'Married');
});

// ════════════════════════════════════════════════════════════════════════════
section('Rekord-validáció');

test('kötelező mező hiánya hibát ad', () => {
  const p = SchemaStore.validateValues({ surname: 'Kovács' });
  const keys = p.map(x => x.key).sort();
  assertEq(keys.join(','), 'citizenship,date_of_birth,forename');
});

test('rossz dátumformátum hibát ad', () => {
  const p = SchemaStore.validateValues({
    surname: 'K', forename: 'A', citizenship: 'magyar', date_of_birth: '1990.03.15',
  });
  assert(p.some(x => x.key === 'date_of_birth'), 'nem jelezte a rossz dátumformátumot');
});

test('helyes rekord hibátlan', () => {
  const p = SchemaStore.validateValues({
    surname: 'Kovács', forename: 'Anna', citizenship: 'Fülöp-szigeteki',
    date_of_birth: '1990-03-15', sex: 'male',
  });
  assertEq(p.length, 0, 'váratlan hibák: ' + JSON.stringify(p));
});

test('ismeretlen enum-érték hibát ad', () => {
  const p = SchemaStore.validateValues({
    surname: 'K', forename: 'A', citizenship: 'magyar', date_of_birth: '1990-03-15',
    marital_status: 'elvált-özvegy',
  });
  assert(p.some(x => x.key === 'marital_status'), 'nem jelezte az ismeretlen enum-értéket');
});

// ════════════════════════════════════════════════════════════════════════════
section('Séma-változás és migráció');

test('hiányzó mező üresen jelenik meg, nem hiba', () => {
  const v = SchemaStore.migrateValues({ surname: 'Kovács' });
  assertEq(v.surname, 'Kovács');
  assertEq(v.forename, '');
  assertEq(Object.prototype.hasOwnProperty.call(v, 'citizenship'), true);
});

test('sémából hiányzó mező adata nem vész el', () => {
  const v = SchemaStore.migrateValues({ surname: 'Kovács', regi_mezo: 'megőrzendő' });
  assert(v.__orphan && v.__orphan.regi_mezo === 'megőrzendő', 'az árva adat elveszett');
});

test('mezőkulcs átnevezése a rekordokat is átmozgatja', () => {
  SchemaStore.loadFrom(SEED_SCHEMA);
  const employees = [
    { fields: { telephone: '+36301234567', surname: 'Kovács' } },
    { fields: { surname: 'Nagy' } },
  ];
  const moved = SchemaStore.renameFieldKey('telephone', 'phone_number', employees);
  assertEq(moved, 1, 'nem a megfelelő számú rekord mozdult');
  assertEq(employees[0].fields.phone_number, '+36301234567');
  assertEq(employees[0].fields.telephone, undefined, 'a régi kulcs megmaradt');
  assert(SchemaStore.field('phone_number'), 'a séma nem követte az átnevezést');
  SchemaStore.loadFrom(SEED_SCHEMA);
});

test('átnevezés a számított mezők hivatkozásait is követi', () => {
  SchemaStore.loadFrom(SEED_SCHEMA);
  SchemaStore.renameFieldKey('postal_code', 'irsz', []);
  const addr = SchemaStore.field('address');
  assert(addr.computed.from.includes('irsz'), 'a számított mező a régi kulcsra hivatkozik');
  assertEq(SchemaStore.validateSchema().length, 0, 'az átnevezés ellentmondást hagyott');
  SchemaStore.loadFrom(SEED_SCHEMA);
});

test('meglévő kulcsra átnevezés nem engedett', () => {
  SchemaStore.loadFrom(SEED_SCHEMA);
  let dobott = false;
  try { SchemaStore.renameFieldKey('surname', 'forename', []); } catch { dobott = true; }
  assert(dobott, 'engedte az ütköző átnevezést');
});

test('a mentett sémából hiányzó seed-mezők pótlódnak', () => {
  // Éles gépen a séma a config-fájlban él, a SEED_SCHEMA csak az első
  // indításkor számít. Enélkül a kódba felvett HR-adatkör sosem jelenne meg a
  // már használatban lévő telepítésen – az adatbekérőből is kimaradna.
  const regi = JSON.parse(JSON.stringify(SEED_SCHEMA));
  regi.fields = regi.fields.filter(f => !/^hr_/.test(f.key));
  regi.groups = regi.groups.filter(g => g.key !== 'hr_belso' && g.key !== 'csalad');
  SchemaStore.loadFrom(regi);
  const verzioElotte = SchemaStore.version();
  assertEq(SchemaStore.field('hr_bank_account'), null, 'a próbaséma nem volt HR nélküli');

  const felvett = SchemaStore.addMissingSeedFields(SEED_SCHEMA);
  assertEq(felvett, HR_MEZOK.length, 'nem a HR-mezők kerültek fel');
  const hianyzo = HR_MEZOK.filter(k => !SchemaStore.field(k));
  assertEq(hianyzo.join(','), '', 'kimaradt mező');
  assert(SchemaStore.groups().find(g => g.key === 'hr_belso'), 'a HR csoport nem került fel');
  assertEq(SchemaStore.version(), verzioElotte + 1, 'a séma verziója nem lépett');
  assertEq(SchemaStore.validateSchema().length, 0, 'a pótlás ellentmondást hagyott');

  // Másodszor már nincs mit tenni – a lépés minden indításkor lefut.
  assertEq(SchemaStore.addMissingSeedFields(SEED_SCHEMA), 0, 'nem idempotens');
  SchemaStore.loadFrom(SEED_SCHEMA);
});

test('a pótlás nem írja át a meglévő mezőt', () => {
  const sajat = JSON.parse(JSON.stringify(SEED_SCHEMA));
  const f = sajat.fields.find(x => x.key === 'position');
  f.label.hu = 'Munkakör (saját elnevezés)';
  SchemaStore.loadFrom(sajat);
  SchemaStore.addMissingSeedFields(SEED_SCHEMA);
  assertEq(SchemaStore.field('position').label.hu, 'Munkakör (saját elnevezés)',
    'a helyben szerkesztett címke visszaállt a seedre');
  SchemaStore.loadFrom(SEED_SCHEMA);
});

test('mező törlése előtt látszik, mi veszne el', () => {
  SchemaStore.loadFrom(SEED_SCHEMA);
  const employees = [
    { fields: { postal_code: '1024' } },
    { fields: { postal_code: '' } },
    { fields: {} },
  ];
  const u = SchemaStore.usageOf('postal_code', employees);
  assertEq(u.withData, 1, 'rossz az érintett rekordok száma');
  assert(u.computedBy.includes('Állandó lakcím'), 'nem jelezte a számított mező függését');
});

// ════════════════════════════════════════════════════════════════════════════
section('Séma-tárolás');

test('hiányos séma betöltése nem omlik össze', () => {
  const s = SchemaStore.loadFrom({ fields: [{ key: 'a' }, { key: 'a' }, { nincs: 'kulcs' }] });
  assertEq(s.fields.length, 1, 'a duplikált/hibás mezők nem szűrődtek ki');
  assertEq(s.fields[0].label.hu, 'a', 'nincs helyettesítő címke');
  SchemaStore.loadFrom(SEED_SCHEMA);
});

test('teljesen üres séma is kezelhető', () => {
  const s = SchemaStore.loadFrom({});
  assert(Array.isArray(s.fields), 'nincs fields tömb');
  SchemaStore.loadFrom(SEED_SCHEMA);
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
