'use strict';

// Fiókok és a négy jogosultsági szint (TERV-fiokok.md).
// Futtatás: node test/auth.test.js
//
// A jogosultsági mátrix a legfontosabb mérendő: egy elírás ott nem látszik a
// felületen, csak akkor derül ki, amikor valaki lát vagy ír valamit, amit nem
// szabadna. Ezért a mátrix MINDEN sorát végigmérjük, nem csak egy-két esetet.

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
async function throws(fn, re, m) {
  let msg = null;
  try { await fn(); } catch (e) { msg = e.message; }
  assert(msg !== null, (m || 'nem dobott hibát'));
  if (re) assert(re.test(msg), `${m || 'hibaüzenet'}: kapott „${msg}”`);
}
function section(n) { console.log(`\n[${n}]`); }

// ── Sandbox: a VALÓDI auth-service + a valódi createFileBackend ─────────────
// Kézzel írt mock-backend csak a mock-ot mérné; itt az éles kódút fut, a
// frissesség-ellenőrzéssel együtt.
function ujAuth(fajlok = {}) {
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
  const store = new Map();
  const sandbox = {
    console, Date, Math, JSON, Set, Map, Object, Array, String, Number, Boolean,
    Error, RegExp, Promise, Uint8Array, ArrayBuffer, isNaN, parseInt, parseFloat,
    setTimeout, clearTimeout, crypto, FsService,
    sessionStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const load = (rel, name) => vm.runInContext(
    fs.readFileSync(path.join(__dirname, rel), 'utf8') + `\nglobalThis.${name}=${name};`,
    sandbox, { filename: rel });
  load('../js/services/employee-repo.js', 'EmployeeRepo');
  load('../js/services/auth-service.js', 'Auth');
  const A = sandbox.Auth;
  A.useBackend(A.createFileBackend({ name: 'proba' }));
  return { A, fajlok };
}

// A terv 3. fejezetének mátrixa, MÁSODSZOR leírva — szándékosan. Ha a kódban
// elcsúszik egy halmaz, ez a független másolat kifogja; ha ugyanabból a
// forrásból generálnánk, a teszt csak önmagát mérné.
const MATRIX = {
  admin: {
    'registry.read': true,  'registry.read.own': true,  'registry.write': true,
    'registry.write.hr': true, 'docgen.generate': true, 'cases.read': true,
    'cases.read.own': true, 'cases.write': true, 'transfers.use': true,
    'settings.schema': true, 'settings.ehcontact': true,
    'accounts.manage': true, 'log.all': true,
  },
  ugyintezo: {
    'registry.read': true,  'registry.read.own': false, 'registry.write': true,
    'registry.write.hr': false, 'docgen.generate': true, 'cases.read': true,
    'cases.read.own': false, 'cases.write': true, 'transfers.use': true,
    'settings.schema': false, 'settings.ehcontact': true,
    'accounts.manage': false, 'log.all': false,
  },
  hrbp: {
    'registry.read': true,  'registry.read.own': false, 'registry.write': false,
    'registry.write.hr': true, 'docgen.generate': false, 'cases.read': true,
    'cases.read.own': false, 'cases.write': false, 'transfers.use': false,
    'settings.schema': false, 'settings.ehcontact': false,
    'accounts.manage': false, 'log.all': false,
  },
  megtekinto: {
    'registry.read': false, 'registry.read.own': true,  'registry.write': false,
    'registry.write.hr': false, 'docgen.generate': false, 'cases.read': false,
    'cases.read.own': true, 'cases.write': false, 'transfers.use': false,
    'settings.schema': false, 'settings.ehcontact': false,
    'accounts.manage': false, 'log.all': false,
  },
};

async function main() {
  section('A jogosultsági mátrix — minden szint, minden művelet');
  {
    const { A } = ujAuth();
    for (const role of A.ROLES) {
      // A munkamenetet közvetlenül állítjuk be, PIN nélkül: itt a mátrixot mérjük.
      A._CAN[role];                                  // létezik-e egyáltalán a sor
      await test(`a(z) ${role} szintnek van mátrixsora`, async () => {
        assert(A._CAN[role] instanceof Set, `nincs sor: ${role}`);
      });
    }
    await test('a mátrix nem hivatkozik ismeretlen műveletre', async () => {
      for (const role of A.ROLES) {
        for (const act of A._CAN[role]) {
          assert(A.ACTIONS.includes(act), `${role}: ismeretlen művelet „${act}”`);
        }
      }
    });
    await test('minden művelet szerepel legalább egy szinten', async () => {
      const all = new Set();
      for (const role of A.ROLES) for (const a of A._CAN[role]) all.add(a);
      for (const act of A.ACTIONS) assert(all.has(act), `holt művelet: ${act}`);
    });
  }

  for (const role of Object.keys(MATRIX)) {
    const { A, fajlok } = ujAuth();
    await A.load();
    await A.create({ name: 'Elso Admin', role: 'admin', pin: '1234' });
    if (role !== 'admin') await A.create({ name: 'Teszt Tibor', role, pin: '5678' });
    const belep = role === 'admin' ? ['Elso Admin', '1234'] : ['Teszt Tibor', '5678'];
    await test(`${role}: belépés`, async () => {
      assert(await A.login(...belep), 'nem tudott belépni');
      assertEq(A.currentRole(), role);
    });
    for (const [act, want] of Object.entries(MATRIX[role])) {
      await test(`${role} · ${act} -> ${want ? 'IGEN' : 'nem'}`, async () => {
        assertEq(A.can(act), want);
      });
    }
    assert(fajlok['docgen-accounts.json'], 'a fiókfájl nem íródott ki');
  }

  section('Próba mód (adatmappa nélkül)');
  {
    const { A } = ujAuth();
    A.setProba(true);
    await test('próba módban nincs bejelentkezett fiók', async () => {
      assertEq(A.currentRole(), null);
      assertEq(A.isProba(), true);
    });
    await test('próba módban a munka megy (nincs mit védeni)', async () => {
      for (const act of A.ACTIONS.filter(a => a !== 'accounts.manage')) {
        assertEq(A.can(act), true, act);
      }
    });
    await test('próba módban fiókot kezelni MÉGSEM lehet', async () => {
      assertEq(A.can('accounts.manage'), false,
               'fiókfájl nélkül ez csak a beállítottság látszatát adná');
    });
    await test('a próba mód kikapcsolható, és utána újra minden tilos', async () => {
      A.setProba(false);
      for (const act of A.ACTIONS) assertEq(A.can(act), false, act);
    });
  }

  section('Bejelentkezés nélkül minden tilos');
  {
    const { A } = ujAuth();
    await A.load();
    await test('nincs munkamenet -> can() mindenre hamis', async () => {
      assertEq(A.currentRole(), null);
      for (const act of A.ACTIONS) assertEq(A.can(act), false, act);
    });
    await test('nincs munkamenet -> csoportírás sem', async () => {
      assertEq(A.canWriteGroup(A.HR_GROUP), false);
      assertEq(A.canWriteGroup('alap'), false);
    });
  }

  section('PIN');
  {
    const { A } = ujAuth();
    await A.load();
    await A.create({ name: 'Pin Pal', role: 'ugyintezo', pin: '4321' });
    await test('helyes PIN -> belép', async () => {
      assert(await A.login('Pin Pal', '4321'));
    });
    A.logout();
    await test('rossz PIN -> nem lép be, és nem lesz munkamenet', async () => {
      assertEq(await A.login('Pin Pal', '9999'), null);
      assertEq(A.currentRole(), null);
    });
    await test('nem létező fiók -> null (nem árulja el, melyik volt a hibás)', async () => {
      assertEq(await A.login('Nincs Ilyen', '4321'), null);
    });
    await test('a PIN nyíltan NEM kerül a fájlba', async () => {
      const raw = JSON.stringify(A.accounts());
      assert(!raw.includes('4321'), 'a PIN olvashatóan benne van a fiókban');
      assert(/^[0-9a-f]{64}$/.test(A.byName('Pin Pal').pinHash), 'nem 256 bites hash');
      assert(/^[0-9a-f]{32}$/.test(A.byName('Pin Pal').pinSalt), 'nincs 16 bájtos só');
    });
    await test('ugyanaz a PIN két fióknál MÁS hash (fiókonkénti só)', async () => {
      await A.create({ name: 'Masik Maria', role: 'megtekinto', pin: '4321' });
      assert(A.byName('Pin Pal').pinHash !== A.byName('Masik Maria').pinHash,
             'azonos hash — a só nem fiókonkénti');
    });
    await test('a PIN alakja ellenőrzött', async () => {
      assert(A.validatePin('123'), 'a 3 jegyű átment');
      assert(A.validatePin('12ab'), 'a nem numerikus átment');
      assert(A.validatePin('1234567890123'), 'a túl hosszú átment');
      assertEq(A.validatePin('1234'), null);
    });
    await test('PIN-csere: a régi már nem jó, az új igen', async () => {
      await A.setPin(A.byName('Pin Pal').id, '8888');
      A.logout();
      assertEq(await A.login('Pin Pal', '4321'), null);
      assert(await A.login('Pin Pal', '8888'));
    });
  }

  section('Fiókkezelés');
  {
    const { A } = ujAuth();
    await A.load();
    await test('üres fiókfájl -> isEmpty', async () => assert(A.isEmpty()));
    const admin = await A.create({ name: 'Fo Admin', role: 'admin', pin: '1111' });
    await test('felvétel után nem üres', async () => assert(!A.isEmpty()));
    await test('ugyanaz a név mégegyszer -> hiba', async () =>
      throws(() => A.create({ name: 'Fo Admin', role: 'ugyintezo', pin: '2222' }),
             /már szerepel/));
    await test('a név ékezet-független az ütközésre', async () =>
      throws(() => A.create({ name: 'fő admin', role: 'ugyintezo', pin: '2222' }),
             /már szerepel/));
    await test('ismeretlen szint -> hiba', async () =>
      throws(() => A.create({ name: 'X Y', role: 'kiraly', pin: '2222' }),
             /Ismeretlen szint/));
    await test('PIN nélkül nem vehető fel fiók', async () =>
      throws(() => A.create({ name: 'Pin Nelkul', role: 'ugyintezo' }),
             /PIN/));
    await test('az UTOLSÓ admin nem fokozható le', async () =>
      throws(() => A.setRole(admin.id, 'ugyintezo'), /utolsó admin/));
    await test('az UTOLSÓ admin nem törölhető', async () =>
      throws(() => A.remove(admin.id), /utolsó admin/));
    await test('két admin közül az egyik már lefokozható', async () => {
      const m = await A.create({ name: 'Masodik Admin', role: 'admin', pin: '3333' });
      await A.setRole(m.id, 'hrbp');
      assertEq(A.get(m.id).role, 'hrbp');
    });
    await test('átnevezés: az új név él, a régi nem', async () => {
      const id = A.byName('Masodik Admin').id;
      await A.rename(id, 'Uj Nev');
      assert(A.byName('Uj Nev'), 'az új néven nem találja');
      assertEq(A.byName('Masodik Admin'), null);
    });
    await test('átnevezés meglévő névre -> hiba', async () =>
      throws(() => A.rename(A.byName('Uj Nev').id, 'Fo Admin'), /már szerepel/));
  }

  section('Munkamenet');
  {
    const { A } = ujAuth();
    await A.load();
    const u = await A.create({ name: 'Session Sanyi', role: 'ugyintezo', pin: '1234' });
    await A.login('Session Sanyi', '1234');
    await test('a munkamenet visszaállítható (lapújratöltés)', async () => {
      A.logout();
      assertEq(A.currentRole(), null);
      // a sessionStorage-t a logout törli, ezért újra belépünk, majd „új lap”
      await A.login('Session Sanyi', '1234');
      const s = A.restoreSession();
      assertEq(s && s.role, 'ugyintezo');
    });
    await test('a szint a FÁJLBÓL jön, nem a munkamenetből', async () => {
      // Admin közben átállította a szintet — a visszaállításnál ez látszik.
      await A.setRole(u.id, 'megtekinto');
      const s = A.restoreSession();
      assertEq(s.role, 'megtekinto', 'a régi szint ragadt be a munkamenetből');
    });
    await test('kilépés után nincs munkamenet', async () => {
      A.logout();
      assertEq(A.restoreSession(), null);
    });
  }

  section('HRBP mezőcsoport-kapu');
  {
    const { A } = ujAuth();
    await A.load();
    await A.create({ name: 'Admin A', role: 'admin', pin: '1111' });
    await A.create({ name: 'Hr Hilda', role: 'hrbp', pin: '2222' });
    await A.create({ name: 'Ugy Ugo', role: 'ugyintezo', pin: '3333' });
    await A.login('Hr Hilda', '2222');
    await test('HRBP: a „Csak HR tölti” csoport írható', async () =>
      assertEq(A.canWriteGroup(A.HR_GROUP), true));
    await test('HRBP: minden más csoport NEM írható', async () => {
      for (const g of ['alap', 'okmany', 'foglalkoztatas', 'lakcim', 'szuletes']) {
        assertEq(A.canWriteGroup(g), false, g);
      }
    });
    A.logout();
    await A.login('Ugy Ugo', '3333');
    await test('ügyintéző: minden csoport írható', async () => {
      for (const g of ['alap', 'okmany', A.HR_GROUP]) assertEq(A.canWriteGroup(g), true, g);
    });
  }

  section('Megtekintő: csak a hozzá tartozó dolgozók');
  {
    const { A } = ujAuth();
    await A.load();
    await A.create({ name: 'Admin A', role: 'admin', pin: '1111' });
    await A.create({ name: 'Szabó Müszakvezető', role: 'megtekinto', pin: '2222' });
    await A.create({ name: 'Ugy Ugo', role: 'ugyintezo', pin: '3333' });
    const sajat  = { fields: { hr_direct_leader: 'Szabó Müszakvezető' } };
    const masnak = { fields: { hr_direct_leader: 'Kovács Csoportvezető' } };
    const senkie = { fields: {} };

    await A.login('Szabó Müszakvezető', '2222');
    await test('a saját dolgozója látszik', async () => assertEq(A.ownsEmployee(sajat), true));
    await test('ékezet- és kisbetű-függetlenül is', async () =>
      assertEq(A.ownsEmployee({ fields: { hr_direct_leader: 'szabo muszakvezeto' } }), true));
    await test('MÁS vezető dolgozója NEM látszik', async () =>
      assertEq(A.ownsEmployee(masnak), false));
    await test('vezető nélküli dolgozó NEM látszik', async () =>
      assertEq(A.ownsEmployee(senkie), false));

    A.logout();
    await A.login('Ugy Ugo', '3333');
    await test('ügyintéző mindenkit lát, a vezető mezőtől függetlenül', async () => {
      assertEq(A.ownsEmployee(masnak), true);
      assertEq(A.ownsEmployee(senkie), true);
    });
  }

  section('A fiókfájl köre');
  {
    const { A, fajlok } = ujAuth();
    await A.load();
    await A.create({ name: 'Kor Karoly', role: 'hrbp', pin: '1234' });
    await test('kiírt fájl -> új példány beolvassa', async () => {
      const masodik = ujAuth(fajlok);           // ugyanaz a „fájlrendszer”
      await masodik.A.load();
      const a = masodik.A.byName('Kor Karoly');
      assert(a, 'nem találta a fiókot');
      assertEq(a.role, 'hrbp');
      assert(await masodik.A.login('Kor Karoly', '1234'), 'a PIN nem élte túl a kört');
    });
    await test('a fiókfájl külön áll, nem a config vagy az employees', async () => {
      assert('docgen-accounts.json' in fajlok, Object.keys(fajlok).join(', '));
      assert(!('docgen-config.json' in fajlok));
      assert(!('docgen-employees.json' in fajlok));
    });
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Eredmény: ${passed} sikeres / ${failed} hibás (összesen ${passed + failed})`);
  if (failed) {
    failures.forEach(f => console.log(`  ✗ ${f.name}: ${f.error}`));
    process.exit(1);
  }
  console.log('Mind sikeres ✓');
}

main();
