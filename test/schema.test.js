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

test('mind a 44 adatbekérő mező megvan', () => {
  assertEq(SchemaStore.storedFields().length, 44);
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

// ════════════════════════════════════════════════════════════════════════════
section('Számított mezők');

const minta = {
  surname: 'Kovács', forename: 'Anna',
  mothers_surname_at_birth: 'Szabó', mothers_forename_at_birth: 'Mária',
  place_of_birth_country_hun: 'Fülöp-szigetek', place_of_birth_locality: 'Manila',
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
