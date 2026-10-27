'use strict';

// Tömeges ügyintézés, hiánypótlás, legutóbbi változások — a böngésző nélkül
// mérhető rész. Futtatás: node test/bulk-case.test.js
//
// A kérdések, amikre ez a készlet felel (TERV-tomeges-ugyintezes.md):
//   - a tömeges címváltozás pontosan azt írja-e a nyilvántartásba, amit az
//     összesítő mutatott (az üres mező törlődik!), és a tárolóba is eljut-e;
//   - dolgozónként egy ügy nyílik-e, közös kötegben;
//   - a hiányzó-adat napló jelölőiből a helyes mezők jönnek-e ki;
//   - a „Legutóbbi változások” tényleg a legfrissebbel kezd-e.

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
const sandbox = {
  console, Date, Math, JSON, Set, Map, Object, Array, String, Number, Boolean,
  Error, RegExp, Promise, isNaN, parseInt, parseFloat, crypto, setTimeout, clearTimeout,
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);

for (const [rel, name] of [
  ['../js/services/employee-repo.js',         'EmployeeRepo'],
  ['../js/schema/value-codec.js',             'ValueCodec'],
  ['../js/schema/seed-schema.js',             'SEED_SCHEMA'],
  ['../js/schema/schema-store.js',            'SchemaStore'],
  ['../js/schema/case-types.js',              'CaseTypes'],
  ['../js/services/case-repo.js',             'CaseRepo'],
  ['../js/modules/docgen/missing-log.js',     'DocgenMissingLog'],
  ['../js/modules/registry/employee-history.js', 'EmployeeHistory'],
  ['../js/modules/cases/bulk-case.js',        'BulkCase'],
]) {
  let code = fs.readFileSync(path.join(__dirname, rel), 'utf8');
  code += `\nglobalThis.${name} = ${name};`;
  vm.runInContext(code, sandbox, { filename: rel });
}
const { EmployeeRepo, SchemaStore, SEED_SCHEMA, CaseTypes, CaseRepo,
        DocgenMissingLog, EmployeeHistory, BulkCase } = sandbox;
SchemaStore.loadFrom(SEED_SCHEMA);
CaseTypes.loadFrom(null);

let tarolo = null;
async function tisztaAllapot() {
  tarolo = EmployeeRepo.createMemoryBackend();
  EmployeeRepo.useBackend(tarolo);
  CaseRepo.useBackend(CaseRepo.createMemoryBackend());
  await EmployeeRepo.load();
  await CaseRepo.load();
}

const REGI_CIM = {
  postal_code: '1024', locality: 'Budapest', name_of_public_place: 'Fő',
  type_of_public_place: 'utca', street_number: '12', floor: '3', door: '14',
};
function ujDolgozo(nev, extra = {}) {
  const [surname, forename] = nev.split(' ');
  return EmployeeRepo.create({ fields: Object.assign({ surname, forename }, REGI_CIM, extra) });
}
const UJ_CIM = {
  postal_code: '9027', locality: 'Győr', name_of_public_place: 'Ipar',
  type_of_public_place: 'utca', street_number: '5',
};
const SZALLAS = () => BulkCase.tipus('szallashely');

// ── CaseRepo: köteg ─────────────────────────────────────────────────────────
asection('Ügy — kötegazonosító');

atest('régi ügy betöltéskor batchId: null', async () => {
  EmployeeRepo.useBackend(EmployeeRepo.createMemoryBackend());
  await EmployeeRepo.load();
  CaseRepo.useBackend(CaseRepo.createMemoryBackend({
    version: 1, cases: [{ id: 'u1', employeeId: 'x', type: 'szallashely_valtozas' }],
  }));
  await CaseRepo.load();
  assertEq(CaseRepo.get('u1').batchId, null);
});

atest('create batchId-vel → batch() visszaadja, más kötegét nem', async () => {
  await tisztaAllapot();
  const a = ujDolgozo('Nagy Béla'), b = ujDolgozo('Kis Anna');
  CaseRepo.create({ employeeId: a.id, type: 'szallashely_valtozas', batchId: 'K1' });
  CaseRepo.create({ employeeId: b.id, type: 'szallashely_valtozas', batchId: 'K1' });
  CaseRepo.create({ employeeId: b.id, type: 'szallashely_valtozas' });
  assertEq(CaseRepo.batch('K1').length, 2);
  assertEq(CaseRepo.batch(null).length, 0);
});

// ── EmployeeRepo.verifyStored ───────────────────────────────────────────────
asection('Visszaolvasó ellenőrzés');

atest('update után a tárolóban is az új érték áll → []', async () => {
  await tisztaAllapot();
  const a = ujDolgozo('Nagy Béla');
  EmployeeRepo.update(a.id, { fields: { locality: 'Győr' } });
  assertEq((await EmployeeRepo.verifyStored([a.id])).length, 0);
  const t = tarolo._peek().employees.find(e => e.id === a.id);
  assertEq(t.fields.locality, 'Győr', 'a tárolóban');
});

atest('ha a tároló nem írja ki, az eltérés kiderül', async () => {
  await tisztaAllapot();
  const a = ujDolgozo('Nagy Béla');
  await EmployeeRepo.flush();
  // „Néma” háttér: a mentés nem hibázik, csak nem ír semmit
  const elotte = JSON.parse(JSON.stringify(tarolo._peek()));
  EmployeeRepo.useBackend({ describe: () => 'néma',
    async load() { return JSON.parse(JSON.stringify(elotte)); }, async save() {} });
  await EmployeeRepo.load();
  EmployeeRepo.update(a.id, { fields: { locality: 'Győr' } });
  const elteres = await EmployeeRepo.verifyStored([a.id]);
  assertEq(elteres.length, 1);
  assertEq(elteres[0], a.id);
});

// ── BulkCase.terv ───────────────────────────────────────────────────────────
asection('Tömeges — összesítő (terv)');

atest('a mezők a séma lakcim csoportjából jönnek', () => {
  const kulcsok = BulkCase.mezoi(SZALLAS()).map(f => f.key);
  assert(kulcsok.includes('postal_code') && kulcsok.includes('door'), kulcsok.join(','));
  assert(!kulcsok.includes('surname'), 'csak a csoport mezői');
  assert(!kulcsok.includes('address'), 'számított mező nem szerkeszthető');
});

atest('az üresen hagyott mező TÖRLŐDIK, és ez a tervben látszik', async () => {
  await tisztaAllapot();
  const a = ujDolgozo('Nagy Béla');
  const [s] = BulkCase.terv(SZALLAS(), [a.id], UJ_CIM);
  const emelet = s.valtozasok.find(v => v.key === 'floor');
  assert(emelet, 'az emelet változásként szerepel');
  assertEq(emelet.from, '3');
  assertEq(emelet.to, '');
  assertEq(s.hibak.length, 0);
  assert(s.ujCim.includes('Győr'), s.ujCim);
  assert(s.regiCim.includes('Budapest'), s.regiCim);
});

atest('már ezen a címen lakó dolgozónál nincs változás', async () => {
  await tisztaAllapot();
  const a = ujDolgozo('Nagy Béla', { floor: '', door: '' });
  const [s] = BulkCase.terv(SZALLAS(), [a.id], REGI_CIM);
  // a REGI_CIM emeletet/ajtót is tartalmaz — ő most azt kapná meg
  assertEq(s.valtozasok.map(v => v.key).sort().join(','), 'door,floor');
  const [s2] = BulkCase.terv(SZALLAS(), [a.id], Object.assign({}, REGI_CIM, { floor: '', door: '' }));
  assertEq(s2.valtozasok.length, 0);
});

atest('nyitott azonos típusú ügy jelzése', async () => {
  await tisztaAllapot();
  const a = ujDolgozo('Nagy Béla'), b = ujDolgozo('Kis Anna');
  CaseRepo.create({ employeeId: a.id, type: 'szallashely_valtozas' });
  const t = BulkCase.terv(SZALLAS(), [a.id, b.id], UJ_CIM);
  assertEq(t[0].nyitottUgy, true);
  assertEq(t[1].nyitottUgy, false);
});

atest('nem létező / törölt dolgozó kimarad', async () => {
  await tisztaAllapot();
  const a = ujDolgozo('Nagy Béla');
  assertEq(BulkCase.terv(SZALLAS(), [a.id, 'nincs-ilyen'], UJ_CIM).length, 1);
});

// ── BulkCase.rogzit ─────────────────────────────────────────────────────────
asection('Tömeges — rögzítés');

atest('mindenki megkapja a címet, a tárolóban is, a naplóban „tomeges_ugy” forrással', async () => {
  await tisztaAllapot();
  const a = ujDolgozo('Nagy Béla'), b = ujDolgozo('Kis Anna');
  const t = SZALLAS();
  const r = await BulkCase.rogzit(t, BulkCase.terv(t, [a.id, b.id], UJ_CIM), { triggerDate: '2026-10-20' });
  assertEq(r.hibak.length, 0);
  assertEq(r.nemMentett.length, 0);
  for (const id of [a.id, b.id]) {
    const t2 = tarolo._peek().employees.find(e => e.id === id);
    assertEq(t2.fields.locality, 'Győr');
    assertEq(t2.fields.floor, '', 'a régi emelet törlődött');
    const utolso = t2.history[t2.history.length - 1];
    assertEq(utolso.source, 'tomeges_ugy');
  }
});

atest('dolgozónként egy ügy, közös kötegben, a költözés napjából határidővel', async () => {
  await tisztaAllapot();
  const a = ujDolgozo('Nagy Béla'), b = ujDolgozo('Kis Anna');
  const t = SZALLAS();
  const r = await BulkCase.rogzit(t, BulkCase.terv(t, [a.id, b.id], UJ_CIM), { triggerDate: '2026-10-20' });
  const ugyek = CaseRepo.batch(r.batchId);
  assertEq(ugyek.length, 2);
  assert(ugyek.every(c => c.type === 'szallashely_valtozas'));
  assertEq(new Set(ugyek.map(c => c.employeeId)).size, 2);
  assertEq(ugyek[0].dueAt, '2026-10-23', '3 nap a költözéstől');
  const k = BulkCase.koteg(r.batchId);
  assertEq(k.ids.length, 2);
  assertEq(k.t.key, 'szallashely');
});

atest('költözés napja nélkül: ügy határidő nélkül (nem kötelező)', async () => {
  await tisztaAllapot();
  const a = ujDolgozo('Nagy Béla');
  const t = SZALLAS();
  const r = await BulkCase.rogzit(t, BulkCase.terv(t, [a.id], UJ_CIM));
  assertEq(CaseRepo.get(r.ugyek[0]).dueAt, null);
});

atest('változás nélküli dolgozónál is nyílik ügy, de a napló nem kap üres bejegyzést', async () => {
  await tisztaAllapot();
  const a = ujDolgozo('Nagy Béla', { floor: '', door: '' });
  const naploElotte = EmployeeRepo.get(a.id).history.length;
  const t = SZALLAS();
  const r = await BulkCase.rogzit(t, BulkCase.terv(t, [a.id], Object.assign({}, REGI_CIM, { floor: '', door: '' })));
  assertEq(r.ugyek.length, 1);
  assertEq(EmployeeRepo.get(a.id).history.length, naploElotte);
});

atest('előválasztás: csak a hozzárendelt ÉS meglévő sablon', () => {
  CaseTypes.byKey('szallashely_valtozas').templates = ['Bejelentő', 'Eltűnt sablon'];
  const v = BulkCase.elovalasztott('szallashely_valtozas', ['Bejelentő', 'Más']);
  assertEq(v.join('|'), 'Bejelentő');
  CaseTypes.loadFrom(null);
});

// ── Hiányzó-adat napló: jelölő → mező ───────────────────────────────────────
asection('Hiánypótlás — jelölőből mező');

atest('egyszerű jelölő → a mező; nem sémabeli → egyéb', () => {
  const r = DocgenMissingLog.mezokreBont(['Állandó lakcím irányítószám', 'EH szám', 'mai nap'], {});
  assertEq(r.mezok.join(','), 'postal_code');
  assertEq(r.egyeb.join(','), 'EH szám,mai nap');
});

atest('számított jelölő → a forrásmezők közül az üresek', () => {
  const r = DocgenMissingLog.mezokreBont(['Állandó lakcím'],
    { postal_code: '1024', locality: 'Budapest', street_number: '' });
  assert(r.mezok.includes('name_of_public_place') && r.mezok.includes('street_number'), r.mezok.join(','));
  assert(!r.mezok.includes('postal_code'), 'a kitöltött forrás nem kell');
});

atest('dátumrész és „nem fér el” jelölés is a mezőre mutat', () => {
  const r = DocgenMissingLog.mezokreBont(['date_of_birth_year', 'Állandó lakcím település (nem fér el)'], {});
  assert(r.mezok.includes('date_of_birth'), r.mezok.join(','));
  assert(r.mezok.includes('locality'), r.mezok.join(','));
});

atest('pótolva: a mostani adattal már van értéke; a „nem fér el” sosem', () => {
  assertEq(DocgenMissingLog.potolva('Állandó lakcím irányítószám', { postal_code: '' }), false);
  assertEq(DocgenMissingLog.potolva('Állandó lakcím irányítószám', { postal_code: '9027' }), true);
  assertEq(DocgenMissingLog.potolva('EH szám', {}), false);
  assertEq(DocgenMissingLog.potolva('Település (nem fér el)', { locality: 'Győr' }), false);
});

atest('bejegyzés → dolgozó: azonosítóval, régi bejegyzésnél egyértelmű névvel', async () => {
  await tisztaAllapot();
  const a = ujDolgozo('Nagy Béla');
  ujDolgozo('Kis Anna'); ujDolgozo('Kis Anna');
  assertEq(DocgenMissingLog.dolgozoja({ employeeId: a.id }).id, a.id);
  assertEq(DocgenMissingLog.dolgozoja({ client: 'Nagy Béla' }).id, a.id);
  assertEq(DocgenMissingLog.dolgozoja({ client: 'Kis Anna' }), null, 'két azonos név → nem találgatunk');
  assertEq(DocgenMissingLog.dolgozoja({ employeeId: 'torolt' }), null);
});

// ── Legutóbbi változások ────────────────────────────────────────────────────
asection('Legutóbbi változások');

atest('minden dolgozó bejegyzése, legfrissebb elöl, a kilépett is', async () => {
  await tisztaAllapot();
  const a = ujDolgozo('Nagy Béla');
  await new Promise(r => setTimeout(r, 5));
  const b = ujDolgozo('Kis Anna');
  await new Promise(r => setTimeout(r, 5));
  EmployeeRepo.update(a.id, { fields: { locality: 'Győr' }, source: 'import' });
  EmployeeRepo.setExited(b.id, true, '2026-10-01');
  const l = EmployeeHistory._osszesBejegyzes();
  assertEq(l.length, 4);
  for (let i = 1; i < l.length; i++) assert(l[i - 1].h.at >= l[i].h.at, 'csökkenő időrend');
  assertEq(l[l.length - 1].h.action, 'letrehozas');
  assertEq(l[l.length - 1].emp.id, a.id, 'a legrégebbi a legelső felvitel');
  assert(l.some(x => x.h.source === 'import'));
});

atest('a forrás-címkék ismerik az új forrásokat', () => {
  assert(EmployeeHistory.SOURCE_LABEL.tomeges_ugy);
  assert(EmployeeHistory.SOURCE_LABEL.hianynaplo);
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
