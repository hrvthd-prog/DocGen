'use strict';

// Közvetlen vezetők (TERV-fiokok.md 10.). Futtatás: node test/leaders.test.js
//
// A vezető NEVE a dolgozó mezőjében él (az iratokra is az megy ki); ezek a
// tesztek azt őrzik, hogy a név ne sodródjon el a fiókoktól.

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
async function throws(fn, re) {
  let e = null;
  try { await fn(); } catch (x) { e = x; }
  assert(e, 'nem dobott hibát');
  if (re) assert(re.test(e.message), `váratlan hibaüzenet: ${e.message}`);
}
function section(n) { console.log(`\n[${n}]`); }

async function kornyezet() {
  const fajlok = {};
  const FsService = {
    async readTextFromDir(dir, nev) {
      if (!(nev in fajlok)) { const e = new Error('nincs'); e.name = 'NotFoundError'; throw e; }
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
    Error, RegExp, Promise, Uint8Array, ArrayBuffer, isNaN, parseInt, parseFloat,
    setTimeout, clearTimeout, crypto, FsService,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const [rel, name] of [
    ['../js/services/employee-repo.js', 'EmployeeRepo'],
    ['../js/schema/roles.js',           'Roles'],
    ['../js/services/auth-service.js',  'Auth'],
    ['../js/services/leaders.js',       'Leaders'],
    ['../js/schema/case-types.js',      'CaseTypes'],
    ['../js/services/case-repo.js',     'CaseRepo'],
    ['../js/modules/cases/cases-dashboard.js', 'CasesDashboard'],
    ['../js/modules/allapot.js',        'AllapotModule'],
  ]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, rel), 'utf8') +
      `\nglobalThis.${name}=${name};`, sandbox, { filename: rel });
  }
  const { EmployeeRepo, Roles, Auth, Leaders, CaseTypes, CaseRepo, CasesDashboard,
          AllapotModule } = sandbox;
  CaseTypes.loadFrom(null);
  CasesDashboard.init({ dolgozoNeve: id => id });
  CaseRepo.useBackend(CaseRepo.createMemoryBackend());
  await CaseRepo.load();
  Roles.loadFrom(null);
  Auth.useBackend(Auth.createFileBackend({ name: 'proba' }));
  await Auth.load();
  await Auth.create({ name: 'Admin A', role: 'admin', pin: '1111' });
  await Auth.create({ name: 'Szabó Sára', role: 'megtekinto', pin: '2222' });
  await Auth.create({ name: 'Kovács Kálmán', role: 'megtekinto', pin: '3333' });
  await Auth.create({ name: 'Ügy Ugó', role: 'ugyintezo', pin: '4444' });
  await Auth.login('Admin A', '1111');
  EmployeeRepo.useBackend(EmployeeRepo.createMemoryBackend());
  await EmployeeRepo.load();
  const uj = (vez, extra = {}) => EmployeeRepo.create({
    fields: Object.assign({ surname: 'Dolgozó', forename: String(Math.random()).slice(2, 7),
                            hr_direct_leader: vez }, extra) });
  return { EmployeeRepo, Auth, Leaders, CaseRepo, CasesDashboard, AllapotModule, uj };
}

(async () => {
  section('Választéklista');
  {
    const { Leaders } = await kornyezet();
    await test('csak a vezetői (saját dolgozókat látó) fiókok', async () => {
      assertEq(Leaders.candidates().join('|'), 'Kovács Kálmán|Szabó Sára');
    });
    await test('a név ékezet- és kisbetű-függetlenül felismerhető', async () => {
      assert(Leaders.isAccountName('szabo sara'));
      assertEq(Leaders.canonical('SZABO SARA'), 'Szabó Sára');
      assert(!Leaders.isAccountName('Ügy Ugó'), 'ügyintéző is vezető lett');
      assert(!Leaders.isAccountName(''));
    });
  }

  section('Hozzárendelés');
  {
    const { EmployeeRepo, Leaders, uj } = await kornyezet();
    const a = uj(''), b = uj('Kovács Kálmán'), c = uj('Szabó Sára');
    await test('több dolgozóra egyszerre, a fiók pontos nevével', async () => {
      const r = Leaders.assign([a.id, b.id, c.id], 'szabo sara');
      assertEq(r.valtozott, 2, 'a már jó rekordot is újraírta');
      assertEq(EmployeeRepo.get(a.id).fields.hr_direct_leader, 'Szabó Sára');
      assertEq(Leaders.teamOf('Szabó Sára').length, 3);
    });
    await test('előzmény marad róla, „tömeges” forrással', async () => {
      const h = EmployeeRepo.get(a.id).history.slice(-1)[0];
      assertEq(h.source, 'tomeges');
    });
    await test('nem fiók név nem írható', async () => {
      await throws(() => Leaders.assign([a.id], 'Kitalált Kató'), /nem vezetői fiók/);
    });
    await test('üres név = a vezető törlése', async () => {
      Leaders.assign([a.id], '');
      assertEq(EmployeeRepo.get(a.id).fields.hr_direct_leader, '');
    });
  }

  section('Átnevezés és árvák');
  {
    const { EmployeeRepo, Auth, Leaders, uj } = await kornyezet();
    const a = uj('Szabó Sára'), b = uj('szabo sara'), c = uj('Kovács Kálmán');
    const k = uj('Szabó Sára');
    EmployeeRepo.setExited(k.id, true, '2026-01-31');
    await test('az átnevezés a dolgozók mezőjét is átírja — a kilépettekét is', async () => {
      await Auth.rename(Auth.byName('Szabó Sára').id, 'Szabó-Nagy Sára');
      const r = Leaders.renameCascade('Szabó Sára', 'Szabó-Nagy Sára');
      assertEq(r.valtozott, 3);
      for (const e of [a, b, k]) assertEq(EmployeeRepo.get(e.id).fields.hr_direct_leader, 'Szabó-Nagy Sára');
      assertEq(EmployeeRepo.get(c.id).fields.hr_direct_leader, 'Kovács Kálmán', 'mást is átírt');
      assertEq(EmployeeRepo.get(a.id).history.slice(-1)[0].source, 'fiok');
    });
    await test('vezető nélküli és nem fiók vezetőjű aktív dolgozó árva', async () => {
      const x = uj(''), y = uj('Régi Rezső');
      const ids = Leaders.orphans().map(e => e.id);
      assert(ids.includes(x.id) && ids.includes(y.id));
      assert(!ids.includes(c.id) && !ids.includes(k.id), 'a kilépett vagy a rendben lévő is árva');
    });
  }

  section('Ügyállás sorai (megtekintő)');
  {
    const { Auth, CaseRepo, AllapotModule, uj } = await kornyezet();
    await Auth.setSupervisor(Auth.byName('Kovács Kálmán').id, Auth.byName('Szabó Sára').id);
    const sajat = uj('Szabó Sára'), beosztott = uj('Kovács Kálmán'), idegen = uj('');
    const nyitott = CaseRepo.create({ employeeId: sajat.id, type: 'rp_elso' });
    const friss = CaseRepo.create({ employeeId: sajat.id, type: 'rp_hosszabbitas' });
    CaseRepo.setStatus(friss.id, 'lezarva', { outcome: 'megadva', occurredAt: '2026-10-01' });
    const regi = CaseRepo.create({ employeeId: sajat.id, type: 'szallashely_valtozas' });
    CaseRepo.setStatus(regi.id, 'lezarva', { outcome: 'megadva', occurredAt: '2026-08-01' });
    CaseRepo.create({ employeeId: idegen.id, type: 'rp_elso' });
    Auth.logout();
    await Auth.login('Szabó Sára', '2222');
    const sorok = AllapotModule.sorok('2026-10-15');

    await test('nyitott és 30 napon belül lezárt ügy látszik, a régebbi nem', async () => {
      const ids = sorok.map(r => r.__case).filter(Boolean);
      assert(ids.includes(nyitott.id) && ids.includes(friss.id), 'hiányzik ügy');
      assert(!ids.includes(regi.id), 'a 30 napnál régebben lezárt is látszik');
      const f = sorok.find(r => r.__case === friss.id);
      assertEq(f['Lezárva'], '2026-10-01');
      assert(f['Eredmény'], 'nincs kimenetel');
    });
    await test('a beosztott vezető dolgozója is sor (ügy nélkül is), az idegené nem', async () => {
      const b = sorok.find(r => r.__id === 'd:' + beosztott.id);
      assert(b, 'a beosztott vezető dolgozója hiányzik');
      assertEq(b['Közvetlen vezető'], 'Kovács Kálmán');
      assert(!sorok.some(r => r.__emp === idegen.id || r.__id === 'd:' + idegen.id), 'idegen dolgozó látszik');
    });
    await test('személyes adat nincs a sorokban — csak a tábla oszlopai', async () => {
      const kulcsok = new Set(sorok.flatMap(r => Object.keys(r)));
      for (const k of kulcsok) {
        assert(k.startsWith('__') || ['Dolgozó', 'Közvetlen vezető', 'Ügy', 'Állás', 'Határidő',
          'Következő lépés', 'Lezárva', 'Eredmény'].includes(k), `váratlan oszlop: ${k}`);
      }
    });
  }

  section('Áttekintés: vezető nélkül');
  {
    const { CasesDashboard, uj } = await kornyezet();
    const a = uj(''), b = uj('Szabó Sára'), c = uj('Régi Rezső');
    await test('a vezető nélküli és a nem fiók vezetőjű dolgozó listázódik, teendő nélkül', async () => {
      const d = CasesDashboard.adatok({ ma: '2026-10-15' });
      const ids = d.vezetoNelkul.map(e => e.id);
      assert(ids.includes(a.id) && ids.includes(c.id) && !ids.includes(b.id), JSON.stringify(ids));
      assertEq(d.vanTeendo, false, 'a tájékoztató blokk teendőnek számított');
    });
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`${passed} sikeres, ${failed} hibás`);
  if (failed) {
    failures.forEach(f => console.log(`  • ${f.name}: ${f.error}`));
    process.exit(1);
  }
})().catch(e => { console.error('\nA tesztkészlet elszállt:', e && e.stack || e); process.exit(1); });
