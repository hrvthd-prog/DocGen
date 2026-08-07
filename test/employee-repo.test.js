'use strict';

// Munkavállalói nyilvántartás – tároló réteg tesztjei
// Futtatás: node test/employee-repo.test.js

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

// ── Modul betöltése ─────────────────────────────────────────────────────────
function loadRepo() {
  let code = fs.readFileSync(path.join(__dirname, '../js/services/employee-repo.js'), 'utf8');
  code += '\nglobalThis.EmployeeRepo = EmployeeRepo;';
  const sandbox = {
    console, Date, Math, JSON, Set, Map, Object, Array, String, Number, Boolean,
    Error, RegExp, Promise, setTimeout, clearTimeout, crypto,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.EmployeeRepo;
}

const Repo = loadRepo();

// Minden teszt tiszta memória-háttérrel indul
async function fresh() {
  Repo.useBackend(Repo.createMemoryBackend());
  await Repo.load();
}

// A szinkron teszt-keret miatt a promise-okat sorban futtatjuk
const queue = [];
function atest(name, fn) { queue.push({ name, fn }); }
function asection(name) { queue.push({ section: name }); }

// ════════════════════════════════════════════════════════════════════════════
asection('Alapműveletek');

atest('üres nyilvántartás betöltése', async () => {
  await fresh();
  assertEq(Repo.count(), 0);
});

atest('létrehozás egyedi belső azonosítót ad', async () => {
  await fresh();
  const a = Repo.create({ fields: { surname: 'Kovács', forename: 'Anna' } });
  const b = Repo.create({ fields: { surname: 'Nagy', forename: 'Béla' } });
  assert(a.id && b.id, 'nincs id');
  assert(a.id !== b.id, 'az azonosítók nem egyediek');
  assertEq(Repo.count(), 2);
});

atest('audit mezők kitöltődnek', async () => {
  await fresh();
  const e = Repo.create({ fields: { surname: 'Kovács' } });
  assert(e.createdAt && e.updatedAt, 'hiányzó időbélyeg');
  assert(typeof e.updatedBy === 'string', 'hiányzó updatedBy');
});

atest('módosítás összefésüli a mezőket', async () => {
  await fresh();
  const e = Repo.create({ fields: { surname: 'Kovács', forename: 'Anna' } });
  Repo.update(e.id, { fields: { forename: 'Anna Mária', email: 'a@b.hu' } });
  const u = Repo.get(e.id);
  assertEq(u.fields.surname, 'Kovács', 'a nem érintett mező elveszett');
  assertEq(u.fields.forename, 'Anna Mária');
  assertEq(u.fields.email, 'a@b.hu');
});

atest('puha törlés kiveszi a listából, de megőrzi a rekordot', async () => {
  await fresh();
  const e = Repo.create({ fields: { surname: 'Kovács' } });
  Repo.setArchived(e.id, true);
  assertEq(Repo.count(), 0, 'archivált rekord látszik az alaplistában');
  assertEq(Repo.count({ includeArchived: true }), 1, 'az archivált rekord elveszett');
  assert(Repo.get(e.id), 'a rekord nem kérhető le azonosítóval');
});

// ════════════════════════════════════════════════════════════════════════════
asection('Azonosító-történet (a SAP-szám problémája)');

atest('új azonosító lezárja a korábbi azonos típusút', async () => {
  await fresh();
  const e = Repo.create({
    fields: { surname: 'Kovács', forename: 'Anna' },
    identifiers: [{ type: 'sap', value: 'SAP-111', validFrom: '2024-01-01' }],
  });
  Repo.addIdentifier(e.id, { type: 'sap', value: 'SAP-222', validFrom: '2026-03-01' });

  const u = Repo.get(e.id);
  assertEq(u.identifiers.length, 2, 'a régi azonosító eltűnt');
  const regi = u.identifiers.find(i => i.value === 'SAP-111');
  const uj   = u.identifiers.find(i => i.value === 'SAP-222');
  assertEq(regi.current, false, 'a régi azonosító nem záródott le');
  assertEq(regi.validTo, '2026-03-01', 'a régi azonosító nem kapott érvényességi véget');
  assertEq(uj.current, true, 'az új azonosító nem aktuális');
});

atest('a lejárt azonosítóra is megtalálható a személy', async () => {
  await fresh();
  const e = Repo.create({
    fields: { surname: 'Kovács' },
    identifiers: [{ type: 'sap', value: 'SAP-111' }],
  });
  Repo.addIdentifier(e.id, { type: 'sap', value: 'SAP-222' });

  const byOld = Repo.findByIdentifier('SAP-111');
  assert(byOld, 'a lejárt azonosítóra nincs találat');
  assertEq(byOld.id, e.id);
  assertEq(Repo.findByIdentifier('SAP-222').id, e.id, 'az aktuálisra sincs találat');
});

atest('currentIdentifier az érvényeset adja vissza', async () => {
  await fresh();
  const e = Repo.create({ fields: {}, identifiers: [{ type: 'sap', value: 'SAP-111' }] });
  Repo.addIdentifier(e.id, { type: 'sap', value: 'SAP-222' });
  assertEq(Repo.currentIdentifier(Repo.get(e.id), 'sap').value, 'SAP-222');
});

atest('különböző típusú azonosítók egymást nem zárják le', async () => {
  await fresh();
  const e = Repo.create({ fields: {}, identifiers: [{ type: 'sap', value: 'SAP-111' }] });
  Repo.addIdentifier(e.id, { type: 'passport', value: 'AB123456' });
  const u = Repo.get(e.id);
  assertEq(u.identifiers.filter(i => i.current).length, 2, 'a más típusú azonosító lezárta a SAP-ot');
});

atest('ugyanaz az azonosító nem tartozhat két személyhez', async () => {
  await fresh();
  Repo.create({ fields: { surname: 'Kovács' }, identifiers: [{ type: 'sap', value: 'SAP-111' }] });
  const b = Repo.create({ fields: { surname: 'Nagy' } });
  let dobott = false;
  try { Repo.addIdentifier(b.id, { type: 'sap', value: 'SAP-111' }); }
  catch { dobott = true; }
  assert(dobott, 'engedte ugyanazt az azonosítót két személyhez');
});

atest('azonosító keresése ékezet- és kisbetű-érzéketlen', async () => {
  await fresh();
  const e = Repo.create({ fields: {}, identifiers: [{ type: 'passport', value: 'ab-123' }] });
  assertEq(Repo.findByIdentifier('AB-123').id, e.id, 'kisbetű/nagybetű nem egyezik');
});

// ════════════════════════════════════════════════════════════════════════════
asection('Párosítás importhoz');

atest('azonosító-egyezés erősebb a névnél', async () => {
  await fresh();
  const e = Repo.create({
    fields: { surname: 'Kovács', forename: 'Anna', date_of_birth: '1990-03-15' },
    identifiers: [{ type: 'sap', value: 'SAP-111' }],
  });
  const m = Repo.matchIncoming({
    identifiers: [{ type: 'sap', value: 'SAP-111' }],
    fields: { surname: 'Teljesen', forename: 'Más', date_of_birth: '1980-01-01' },
  });
  assertEq(m.matchedBy, 'identifier');
  assertEq(m.employee.id, e.id);
});

atest('a lejárt azonosítóval érkező sor sem hoz létre duplikátumot', async () => {
  await fresh();
  const e = Repo.create({ fields: { surname: 'Kovács' }, identifiers: [{ type: 'sap', value: 'SAP-111' }] });
  Repo.addIdentifier(e.id, { type: 'sap', value: 'SAP-222' });
  const m = Repo.matchIncoming({ identifiers: [{ type: 'sap', value: 'SAP-111' }], fields: {} });
  assertEq(m.employee && m.employee.id, e.id, 'a régi azonosítóval nem talált rá');
});

atest('azonosító híján a természetes kulcs párosít', async () => {
  await fresh();
  const e = Repo.create({ fields: { surname: 'Kovács', forename: 'Anna', date_of_birth: '1990-03-15' } });
  const m = Repo.matchIncoming({
    fields: { surname: 'kovács', forename: 'ANNA', date_of_birth: '1990-03-15' },
  });
  assertEq(m.matchedBy, 'naturalKey');
  assertEq(m.employee.id, e.id);
});

atest('azonos nevű, de eltérő születési dátumú személy külön marad', async () => {
  await fresh();
  Repo.create({ fields: { surname: 'Kovács', forename: 'Anna', date_of_birth: '1990-03-15' } });
  const m = Repo.matchIncoming({
    fields: { surname: 'Kovács', forename: 'Anna', date_of_birth: '1985-07-02' },
  });
  assertEq(m.employee, null, 'két különböző embert összevont');
});

atest('üres természetes kulcs nem párosít', async () => {
  await fresh();
  Repo.create({ fields: {} });
  const m = Repo.matchIncoming({ fields: {} });
  assertEq(m.employee, null, 'üres adattal is párosított');
});

// ════════════════════════════════════════════════════════════════════════════
asection('Keresés');

atest('szabad szavas keresés mezőben és azonosítóban is talál', async () => {
  await fresh();
  const e = Repo.create({
    fields: { surname: 'Kovács', forename: 'Anna', locality: 'Budapest' },
    identifiers: [{ type: 'passport', value: 'XY987654' }],
  });
  assertEq(Repo.search('budapest').length, 1, 'mező szerint nem talált');
  assertEq(Repo.search('xy9876').length, 1, 'azonosító szerint nem talált');
  assertEq(Repo.search('kovacs').length, 1, 'ékezet nélkül nem talált');
  assertEq(Repo.search('nincsilyen').length, 0, 'hamis találat');
});

atest('archivált rekord alapból kimarad a keresésből', async () => {
  await fresh();
  const e = Repo.create({ fields: { surname: 'Kovács' } });
  Repo.setArchived(e.id, true);
  assertEq(Repo.search('kovács').length, 0);
  assertEq(Repo.search('kovács', { includeArchived: true }).length, 1);
});

// ════════════════════════════════════════════════════════════════════════════
asection('Tárolás és visszatöltés');

atest('mentés után a rekordok visszaolvashatók', async () => {
  const backend = Repo.createMemoryBackend();
  Repo.useBackend(backend);
  await Repo.load();
  const e = Repo.create({
    fields: { surname: 'Kovács', forename: 'Anna' },
    identifiers: [{ type: 'sap', value: 'SAP-111' }],
  });
  Repo.addIdentifier(e.id, { type: 'sap', value: 'SAP-222' });
  await Repo.save();

  // Új példány ugyanarra a háttérre
  Repo.useBackend(backend);
  await Repo.load();
  assertEq(Repo.count(), 1);
  const u = Repo.all()[0];
  assertEq(u.fields.surname, 'Kovács');
  assertEq(u.identifiers.length, 2, 'az azonosító-történet nem maradt meg');
  assertEq(Repo.findByIdentifier('SAP-111').id, u.id, 'a régi azonosító elveszett');
});

atest('hiányos régi rekord betöltéskor felhozatalra kerül', async () => {
  const backend = Repo.createMemoryBackend({
    version: 1,
    employees: [{ fields: { surname: 'Régi' } }],   // nincs id, identifiers, audit
  });
  Repo.useBackend(backend);
  await Repo.load();
  const e = Repo.all()[0];
  assert(e.id, 'nem kapott azonosítót');
  assert(Array.isArray(e.identifiers), 'nincs identifiers tömb');
  assert(e.createdAt, 'nincs createdAt');
  assertEq(e.archived, false);
});

atest('sérült adat esetén üres nyilvántartással indul, nem omlik össze', async () => {
  Repo.useBackend({
    describe: () => 'teszt',
    async load() { return { valami: 'rossz alak' }; },
    async save() {},
  });
  await Repo.load();
  assertEq(Repo.count(), 0);
});

// ── Futtatás ────────────────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════════
// Az azonosító-tükrözés minden úton érvényesül
//
// A SAP-szám és az engedélyszám kétszer szerepel: az azonosító-történetben és
// az adatbekérő saját oszlopában. A tükrözés eddig CSAK az űrlapon futott le,
// ezért az addIdentifier()-en át rögzített új engedély után a mező a régi
// számot őrizte – az xlsx-export elavult adatot írt volna ki. Ez akkor sült
// volna ki élesben, amikor egy ügy lezárása rögzíti az új engedélyszámot.
asection('Azonosító-tükrözés a mezőkbe');

atest('új azonosító után a mező is az újat mutatja', async () => {
  Repo.useBackend(Repo.createMemoryBackend());
  await Repo.load();
  const e = Repo.create({
    fields: { surname: 'Tukor', forename: 'Elek', number_of_rp: 'RP-REGI' },
    identifiers: [{ type: 'residence_permit', value: 'RP-REGI' }],
  });
  Repo.addIdentifier(e.id, { type: 'residence_permit', value: 'RP-UJ' });

  const u = Repo.get(e.id);
  assertEq(u.fields.number_of_rp, 'RP-UJ', 'a mező a régi számot őrzi');
  assertEq(Repo.currentIdentifier(u, 'residence_permit').value, 'RP-UJ');
  assertEq(u.identifiers.filter(i => !i.current)[0].value, 'RP-REGI', 'a régi nem záródott le');
});

atest('létrehozáskor a mező az azonosítóból töltődik', async () => {
  Repo.useBackend(Repo.createMemoryBackend());
  await Repo.load();
  const e = Repo.create({
    fields: { surname: 'Tukor', forename: 'Anna' },      // nincs megadva mező
    identifiers: [{ type: 'sap', value: 'SAP-777' }],
  });
  assertEq(Repo.get(e.id).fields.personnel_reg_number, 'SAP-777');
});

atest('azonosító törlése NEM üríti a mezőt – kézi adat nem veszhet el', async () => {
  Repo.useBackend(Repo.createMemoryBackend());
  await Repo.load();
  const e = Repo.create({
    fields: { surname: 'Tukor', forename: 'Bela' },
    identifiers: [{ type: 'taj', value: '123456789' }],
  });
  Repo.removeIdentifier(e.id, '123456789', 'taj');
  assertEq(Repo.get(e.id).fields.TAJ, '123456789', 'a mező kiürült');
});

(async () => {
  for (const item of queue) {
    if (item.section) { console.log(`
[${item.section}]`); continue; }
    const { name, fn } = item;
    try { await fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) {
      console.log(`  ✗ ${name}`);
      console.log(`    ${e.message}`);
      failed++; failures.push({ name, error: e.message });
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
