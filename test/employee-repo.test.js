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
  Repo.setExited(e.id, true, '2026-08-01');
  assertEq(Repo.count(), 0, 'kilépett rekord látszik az alaplistában');
  assertEq(Repo.count({ includeExited: true }), 1, 'a kilépett rekord elveszett');
  assert(Repo.get(e.id), 'a rekord nem kérhető le azonosítóval');
});

// ════════════════════════════════════════════════════════════════════════════
asection('Kilépés');

atest('a kilépés dátuma kötelező és formátumhoz kötött', async () => {
  await fresh();
  const e = Repo.create({ fields: { surname: 'Kovács' } });
  for (const rossz of [null, '', '2026.08.01', '2026-13-01', 'tegnap']) {
    let dobott = false;
    try { Repo.setExited(e.id, true, rossz); } catch { dobott = true; }
    assert(dobott, `dátum nélkül/rossz dátummal is kilépettnek jelölt: ${rossz}`);
  }
  assertEq(Repo.get(e.id).exited, false, 'a hibás próbálkozás mégis megjelölte');
});

atest('a kilépés napja a séma „Kilépés dátuma" mezőjébe is bekerül', async () => {
  await fresh();
  // A felvételkor TERVEZETT utolsó munkanap – a tényleges felülírja
  const e = Repo.create({ fields: { surname: 'Kovács', employment_end: '2029-12-31' } });
  Repo.setExited(e.id, true, '2026-08-10');
  assertEq(Repo.get(e.id).exitDate, '2026-08-10');
  assertEq(Repo.get(e.id).fields.employment_end, '2026-08-10',
    'az export a tervezett napot vinné a tényleges helyett');
});

atest('visszavételkor a kilépés dátuma törlődik', async () => {
  await fresh();
  const e = Repo.create({ fields: { surname: 'Kovács' } });
  Repo.setExited(e.id, true, '2026-08-10');
  Repo.setExited(e.id, false);
  assertEq(Repo.get(e.id).exited, false);
  assertEq(Repo.get(e.id).exitDate, null, 'ottmaradt egy megszűnt munkaviszony napja');
  assertEq(Repo.count(), 1, 'a visszavett dolgozó nem került vissza az aktív listába');
});

atest('a régi `archived` kulcs kilépéssé alakul betöltéskor', async () => {
  Repo.useBackend(Repo.createMemoryBackend({
    version: 1,
    employees: [{ id: 'x1', fields: { surname: 'Régi' }, archived: true }],
  }));
  await Repo.load();
  const e = Repo.get('x1');
  assertEq(e.exited, true, 'az archivált rekord aktívként jött vissza');
  assertEq(e.archived, undefined, 'a régi kulcs ottmaradt');
  // Dátum nincs – a korábbi archiválásoknál nem volt mit rögzíteni
  assertEq(e.exitDate, null);
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

atest('kilépett rekord alapból kimarad a keresésből', async () => {
  await fresh();
  const e = Repo.create({ fields: { surname: 'Kovács' } });
  Repo.setExited(e.id, true, '2026-08-01');
  assertEq(Repo.search('kovács').length, 0);
  assertEq(Repo.search('kovács', { includeExited: true }).length, 1);
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
  assertEq(e.exited, false);
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

// ════════════════════════════════════════════════════════════════════════════
// Sérült adatfájl
//
// A tároló korábban összemosta a „nincs még fájl" és a „van fájl, de
// olvashatatlan" esetet: mindkettő üres nyilvántartással indult. Egy sérült
// fájl (félbeszakadt mentés, lemezhiba) után az app tehát ÜRESEN indult,
// minden jelzés nélkül – és az első módosítás felülírta a még menthető
// tartalmat. Ezt a különbségtételt őrzik az alábbi tesztek.
asection('Sérült adatfájl felismerése');

/**
 * A VALÓDI createFileBackend-et hívjuk, hamis fájlrendszerrel.
 *
 * Kézzel írt mock-backend csak a mock-ot mérné; itt viszont az éles kódút fut,
 * beleértve a hiányzó/sérült megkülönböztetést.
 */
function ujRepoFajlrendszerrel(fajlok) {
  let code = fs.readFileSync(path.join(__dirname, '../js/services/employee-repo.js'), 'utf8');
  code += '\nglobalThis.EmployeeRepo = EmployeeRepo;';

  const FsService = {
    async readTextFromDir(dir, nev) {
      if (!(nev in fajlok)) throw new Error('nincs ilyen fájl');
      return fajlok[nev];
    },
    async writeTextToDir(dir, nev, szoveg) { fajlok[nev] = szoveg; },
    async fileExists(dir, nev) { return nev in fajlok; },
    async getSubDir() { return null; },
    async listFiles() { return []; },
    async deleteFromDir() { return true; },
  };

  const sandbox = {
    console, Date, Math, JSON, Set, Map, Object, Array, String, Number, Boolean,
    Error, RegExp, Promise, setTimeout, clearTimeout, crypto, FsService,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  const R = sandbox.EmployeeRepo;
  R.useBackend(R.createFileBackend({ name: 'proba' }));
  return R;
}

const FAJLNEV = 'docgen-employees.json';

atest('hiányzó fájl → üres nyilvántartás, ez rendben van', async () => {
  const R = ujRepoFajlrendszerrel({});           // egyáltalán nincs fájl
  assertEq(await R.load(), 0);
});

atest('ép fájl → betölt', async () => {
  const R = ujRepoFajlrendszerrel({
    [FAJLNEV]: JSON.stringify({ version: 1, employees: [{ id: 'a', fields: { surname: 'Ép' } }] }),
  });
  assertEq(await R.load(), 1);
});

atest('sérült fájl → HIBA, nem üres indulás', async () => {
  // Félbeszakadt írás: a JSON csonka
  const R = ujRepoFajlrendszerrel({
    [FAJLNEV]: '{"version":1,"employees":[{"id":"a","fields":{"surna',
  });
  let dobott = null;
  try { await R.load(); } catch (e) { dobott = e; }
  assert(dobott, 'némán üresen indult – a sérült adat felülíródna');
  assert(R.isCorruptError(dobott), `nem sérülés-hibát dobott: ${dobott.message}`);
  assert(/nem olvasható/.test(dobott.message), `érthetetlen üzenet: ${dobott.message}`);
});

atest('üres fájl is sérülésnek számít', async () => {
  // Nem ugyanaz, mint a hiányzó fájl: itt VOLT adat, csak elveszett
  const R = ujRepoFajlrendszerrel({ [FAJLNEV]: '   ' });
  let dobott = null;
  try { await R.load(); } catch (e) { dobott = e; }
  assert(dobott && R.isCorruptError(dobott), 'az üres fájlt jó adatnak vette');
});

atest('sérülés után a tároló NEM használható – nincs mit felülírni', async () => {
  const R = ujRepoFajlrendszerrel({ [FAJLNEV]: '{csonka' });
  try { await R.load(); } catch {}
  // A cache üresen maradt, ezért minden művelet leáll – nem tud menteni
  let hiba = null;
  try { R.create({ fields: { surname: 'Új' } }); } catch (e) { hiba = e; }
  assert(hiba, 'sérült betöltés után is engedett módosítást');
});

atest('a sérülés-hiba megkülönböztethető a többitől', async () => {
  assertEq(Repo.isCorruptError(new Error('valami más')), false);
  assertEq(Repo.isCorruptError(null), false);
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
