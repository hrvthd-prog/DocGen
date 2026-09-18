'use strict';

// Az Ügyek-áttekintő számításainak tesztjei.
// Futtatás: node test/cases-dashboard.test.js
//
// A felületet böngésző nélkül nem lehet mérni, a mögötte álló számokat viszont
// igen — ezért van a `CasesDashboard.adatok()` elválasztva a `render()`-től.
// A súlypont azon van, amiért az áttekintő egyáltalán készült: hogy meglássa
// azt, ami NINCS (a még el sem indított ügyet), és azt, ami sosem jelez
// magától (a határidő nélküli ügyet).

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
const failures = [];

async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
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

// ── Sandbox ─────────────────────────────────────────────────────────────────
const sandbox = {
  console, Date, Math, JSON, Set, Map, Object, Array, String, Number, Boolean,
  Error, RegExp, Promise, isNaN, parseInt, parseFloat, crypto, setTimeout, clearTimeout,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const [rel, name] of [
  ['../js/services/employee-repo.js',        'EmployeeRepo'],
  ['../js/schema/case-types.js',             'CaseTypes'],
  ['../js/services/case-repo.js',            'CaseRepo'],
  ['../js/modules/cases/cases-dashboard.js', 'CasesDashboard'],
]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, rel), 'utf8') +
    `\nglobalThis.${name} = ${name};`, sandbox, { filename: rel });
}
const { EmployeeRepo, CaseTypes, CaseRepo, CasesDashboard } = sandbox;
CaseTypes.loadFrom(null);
CasesDashboard.init({ dolgozoNeve: id => id });

const MA = '2026-09-18';

/** Napokkal eltolt ISO dátum a rögzített „mai" naphoz képest. */
function nap(n) {
  const d = new Date(MA);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

async function tisztaAllapot() {
  EmployeeRepo.useBackend(EmployeeRepo.createMemoryBackend());
  CaseRepo.useBackend(CaseRepo.createMemoryBackend());
  await EmployeeRepo.load();
  await CaseRepo.load();
}

function ujDolgozo(fields = {}) {
  return EmployeeRepo.create({
    fields: Object.assign({ surname: 'Nagy', forename: 'Béla' }, fields),
  });
}

function d(extra = {}) { return CasesDashboard.adatok(Object.assign({ ma: MA }, extra)); }

(async () => {

  section('Üres állapot');

  await test('Nyilvántartás nélkül nem hasal el, és nincs teendő', async () => {
    await tisztaAllapot();
    const a = d();
    assertEq(a.ugyekSzama, 0);
    assertEq(a.hianyzo.length, 0);
    assertEq(a.hataridoNelkul.length, 0);
    assertEq(a.vanTeendo, false);
  });

  section('Hiányzó ügyek — ez az áttekintő lényege');

  await test('Lejáró engedély nyitott ügy nélkül megjelenik', async () => {
    await tisztaAllapot();
    ujDolgozo({ expiration_of_rp: nap(40) });
    const a = d();
    assertEq(a.hianyzo.length, 1, 'nem vette észre a lejáró engedélyt');
    assertEq(a.hianyzo[0].daysLeft, 40);
    assertEq(a.vanTeendo, true);
  });

  await test('Ha van nyitott meghosszabbítás, NEM kerül a listára', async () => {
    await tisztaAllapot();
    const e = ujDolgozo({ expiration_of_rp: nap(40) });
    CaseRepo.create({ employeeId: e.id, type: 'rp_hosszabbitas' });
    assertEq(d().hianyzo.length, 0, 'a már elindított ügyet is felvetette');
  });

  await test('A 90 napos horizonton túli lejárat még nem teendő', async () => {
    await tisztaAllapot();
    ujDolgozo({ expiration_of_rp: nap(120) });
    assertEq(d().hianyzo.length, 0, '120 nappal előre is jelzett — ez zaj lenne');
  });

  await test('A horizont széle pontosan a benyújtási ablak nyílása', async () => {
    await tisztaAllapot();
    ujDolgozo({ expiration_of_rp: nap(CasesDashboard.HORIZONT) });
    assertEq(d().hianyzo.length, 1, 'a 90. napon már látszania kell — ekkor nyílik az ablak');
  });

  await test('A MÁR LEJÁRT engedély is bent van, nem esik ki a horizontból', async () => {
    await tisztaAllapot();
    ujDolgozo({ expiration_of_rp: nap(-10) });
    const a = d();
    assertEq(a.hianyzo.length, 1, 'a lejárt engedély kiesett — pont ez a legsúlyosabb eset');
    assert(a.hianyzo[0].daysLeft < 0, `pozitív napszám lejárt engedélynél: ${a.hianyzo[0].daysLeft}`);
  });

  await test('Lejárat nélküli dolgozó nem kerül a listára', async () => {
    await tisztaAllapot();
    ujDolgozo({});
    assertEq(d().hianyzo.length, 0);
  });

  section('Határidő nélküli ügyek — a csendes lyuk');

  await test('A határidő nélküli nyitott ügy külön megjelenik', async () => {
    await tisztaAllapot();
    const e = ujDolgozo();
    const c = CaseRepo.create({ employeeId: e.id, type: 'szallashely_valtozas' });
    assertEq(c.dueAt, null, 'a próbaügy határidőt kapott – más esetet mér a teszt');
    const a = d();
    assertEq(a.hataridoNelkul.length, 1);
    assertEq(a.vanTeendo, true);
  });

  await test('Ez az ügy a sürgősségi számlálókban NEM jelez — ezért kell külön', async () => {
    // A daysLeft null → az urgency 'nyitott' → sosem pirosodik ki. Ha ez a
    // teszt egyszer elbukik, az azt jelenti, hogy a jelzés máshol megoldódott,
    // és ez a blokk feleslegessé vált.
    await tisztaAllapot();
    const e = ujDolgozo();
    CaseRepo.create({ employeeId: e.id, type: 'szallashely_valtozas' });
    const a = d();
    assertEq(a.szamok.lejart, 0);
    assertEq(a.szamok.surgos, 0);
    assertEq(a.hataridoNelkul.length, 1, 'a határidő nélküli ügy sehol nem jelenne meg');
  });

  await test('Határidővel rendelkező ügy nem kerül ide', async () => {
    await tisztaAllapot();
    const e = ujDolgozo();
    CaseRepo.create({ employeeId: e.id, type: 'rp_hosszabbitas', dueAt: nap(30) });
    assertEq(d().hataridoNelkul.length, 0);
  });

  await test('A lezárt ügy nem számít, akkor sem ha nincs határideje', async () => {
    await tisztaAllapot();
    const e = ujDolgozo();
    const c = CaseRepo.create({ employeeId: e.id, type: 'szallashely_valtozas' });
    CaseRepo.setStatus(c.id, CaseTypes.statusesOf('szallashely_valtozas').slice(-1)[0].key,
      { outcome: 'megadva' });
    const a = d();
    assertEq(a.hataridoNelkul.length, 0, 'lezárt ügy is teendőként jelent meg');
  });

  section('Benyújtási ablak');

  await test('A nyitott ablakban álló ügy „beadható"-ként számít', async () => {
    await tisztaAllapot();
    // A lejárat 60 nap múlva: az ablak −90..−40 között ideális.
    const e = ujDolgozo({ expiration_of_rp: nap(60) });
    CaseRepo.create({ employeeId: e.id, type: 'rp_hosszabbitas' });
    const a = d();
    assertEq(a.ablak.idealis.length, 1, JSON.stringify(Object.keys(a.ablak).map(k => [k, a.ablak[k].length])));
    assertEq(a.surgetoAblak.length, 0, 'az ideális fázis teendőként jelent meg');
  });

  await test('A záródó ablak sürgető teendő', async () => {
    await tisztaAllapot();
    // 20 nap múlva jár le: a −40 már elmúlt, a −10 még nem → „siess"
    const e = ujDolgozo({ expiration_of_rp: nap(20) });
    CaseRepo.create({ employeeId: e.id, type: 'rp_hosszabbitas' });
    const a = d();
    assertEq(a.ablak.siess.length, 1);
    assertEq(a.surgetoAblak.length, 1);
    assertEq(a.vanTeendo, true);
  });

  await test('A lekésett ablak is sürgető', async () => {
    await tisztaAllapot();
    const e = ujDolgozo({ expiration_of_rp: nap(5) });   // a −10 nap már elmúlt
    CaseRepo.create({ employeeId: e.id, type: 'rp_hosszabbitas' });
    const a = d();
    assertEq(a.ablak.lekesve.length, 1);
    assertEq(a.surgetoAblak.length, 1);
  });

  await test('A korai fázis NEM teendő — ott a helyes a semmittevés', async () => {
    await tisztaAllapot();
    const e = ujDolgozo({ expiration_of_rp: nap(200) });
    CaseRepo.create({ employeeId: e.id, type: 'rp_hosszabbitas' });
    const a = d();
    assertEq(a.ablak.korai.length, 1);
    assertEq(a.surgetoAblak.length, 0);
    assertEq(a.vanTeendo, false, 'a korai fázis teendőként jelent meg');
  });

  await test('Ablak nélküli ügytípus kimarad a bontásból', async () => {
    await tisztaAllapot();
    const e = ujDolgozo({ expiration_of_rp: nap(60) });
    CaseRepo.create({ employeeId: e.id, type: 'szallashely_valtozas' });
    const a = d();
    const ossz = Object.values(a.ablak).reduce((n, x) => n + x.length, 0);
    assertEq(ossz, 0, 'bejelentésre is számolt benyújtási ablakot');
  });

  section('Számlálók');

  await test('A lejárt és a sürgős ügy a megfelelő számlálóba kerül', async () => {
    await tisztaAllapot();
    const e = ujDolgozo();
    CaseRepo.create({ employeeId: e.id, type: 'rp_hosszabbitas', dueAt: nap(-3) });
    CaseRepo.create({ employeeId: e.id, type: 'rp_elso',         dueAt: nap(7) });
    CaseRepo.create({ employeeId: e.id, type: 'letelepedes',     dueAt: nap(120) });
    const a = d();
    assertEq(a.szamok.lejart, 1);
    assertEq(a.szamok.surgos, 1);
    assertEq(a.szamok.nyitott, 3, 'a nyitott szám nem az összes nyitottat adja');
  });

  await test('Lejárt ügy esetén van teendő', async () => {
    await tisztaAllapot();
    const e = ujDolgozo();
    CaseRepo.create({ employeeId: e.id, type: 'rp_hosszabbitas', dueAt: nap(-3) });
    assertEq(d().vanTeendo, true);
  });

  section('Együtt');

  await test('Több teendő egyszerre, keveredés nélkül', async () => {
    await tisztaAllapot();
    const a1 = ujDolgozo({ expiration_of_rp: nap(30) });               // hiányzó ügy
    const a2 = ujDolgozo({ expiration_of_rp: nap(20) });               // záródó ablak
    CaseRepo.create({ employeeId: a2.id, type: 'rp_hosszabbitas' });
    const a3 = ujDolgozo();
    CaseRepo.create({ employeeId: a3.id, type: 'szallashely_valtozas' }); // határidő nélkül

    const a = d();
    assertEq(a.hianyzo.length, 1, 'hiányzó ügyek');
    assertEq(a.hianyzo[0].employee.id, a1.id);
    assertEq(a.surgetoAblak.length, 1, 'sürgető ablak');
    assertEq(a.surgetoAblak[0].ugy.employeeId, a2.id);
    assertEq(a.hataridoNelkul.length, 1, 'határidő nélkül');
    assertEq(a.hataridoNelkul[0].employeeId, a3.id);
    assertEq(a.vanTeendo, true);
  });

  await test('Minden rendben állapot: nyitott ügy van, teendő nincs', async () => {
    await tisztaAllapot();
    const e = ujDolgozo({ expiration_of_rp: nap(200) });
    CaseRepo.create({ employeeId: e.id, type: 'rp_hosszabbitas', dueAt: nap(150) });
    const a = d();
    assertEq(a.ugyekSzama, 1);
    assertEq(a.vanTeendo, false, 'teendőt jelzett, pedig minden rendben van');
  });

  // ── Összegzés ─────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`${passed} sikeres, ${failed} hibás`);
  if (failed) {
    console.log('\nHibák:');
    failures.forEach(f => console.log(`  • ${f.name}: ${f.error}`));
    process.exit(1);
  }
})().catch(e => {
  console.error('\nA tesztkészlet elszállt:', e && e.stack || e);
  process.exit(1);
});
