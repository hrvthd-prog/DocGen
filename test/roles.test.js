'use strict';

// Jogosultsági szintek ADATKÉNT (js/schema/roles.js).
// Futtatás: node test/roles.test.js
//
// A szerkeszthetőség két új hibaosztályt hoz be, és ezek a legfontosabb mérendők:
//   1. az admin KIZÁRHATJA magát (senkinek nincs fiókkezelési joga),
//   2. frissítéskor egy új művelet vagy senkinek nem jut, vagy mindenkinek —
//      mindkettő rossz.
// Emellett azt is mérjük, hogy sérült config esetén a SEED jön, nem „minden szabad".

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
  assert(msg !== null, m || 'nem dobott hibát');
  if (re) assert(re.test(msg), `${m || 'hibaüzenet'}: kapott „${msg}”`);
}
function section(n) { console.log(`\n[${n}]`); }

/** Friss Roles példány, memóriában tartott config-háttérrel. */
function ujRoles(tarolt = null) {
  const sandbox = {
    console, Date, Math, JSON, Set, Map, Object, Array, String, Number, Boolean,
    Error, RegExp, Promise, isNaN, parseInt, parseFloat,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '../js/schema/roles.js'), 'utf8')
      + '\nglobalThis.Roles = Roles;',
    sandbox, { filename: 'roles.js' });
  const R = sandbox.Roles;
  const box = { cfg: tarolt };
  R.useBackend({
    async load() { return box.cfg; },
    async save(d) { box.cfg = JSON.parse(JSON.stringify(d)); },
  });
  const naplo = [];
  R.setAuditSink((action, adat) => naplo.push({ action, ...adat }));
  return { R, box, naplo };
}

async function main() {
  section('A seed: a négy kiinduló szint');
  {
    const { R } = ujRoles();
    await R.load();
    await test('négy szint jön', async () => assertEq(R.keys().length, 4));
    await test('az admin mindent tud', async () => {
      for (const a of R.ACTIONS) assertEq(R.can('admin', a.key), true, a.key);
    });
    await test('a megtekintő csak a két „own" jogot kapja', async () => {
      assertEq(R.get('megtekinto').can.sort().join(','),
               'cases.read.own,registry.read.own');
    });
    await test('a HRBP nem ír teljeset, csak HR-t', async () => {
      assertEq(R.can('hrbp', 'registry.write'), false);
      assertEq(R.can('hrbp', 'registry.write.hr'), true);
    });
    await test('ismeretlen szint -> semmi', async () =>
      assertEq(R.can('nincs_ilyen', 'registry.read'), false));
  }

  section('Sérült vagy hiányzó config -> SEED, nem „minden szabad"');
  {
    const { R } = ujRoles({ ize: 'kukac' });         // értelmezhetetlen tartalom
    await R.load();
    await test('a seed jön vissza', async () => assertEq(R.keys().length, 4));
    await test('nem lett mindenki admin', async () =>
      assertEq(R.can('megtekinto', 'registry.write'), false));
  }
  {
    const { R } = ujRoles({ version: 1, roles: [
      { key: 'x', label: 'X', can: ['registry.read', 'nincs.ilyen.muvelet'] }] });
    await R.load();
    await test('a configban maradt ISMERETLEN művelet kiesik', async () => {
      assertEq(R.can('x', 'registry.read'), true);
      assertEq(R.get('x').can.length, 1);
    });
  }

  section('Kizárás elleni védelem');
  {
    const { R } = ujRoles();
    await R.load();
    await test('a saját szintemből nem vehetem el a fiókkezelést', async () =>
      throws(() => R.setAction('admin', 'accounts.manage', false, { sajatRole: 'admin' }),
             /saját szintedből/));
    await test('más szintnek adható fiókkezelés', async () => {
      await R.setAction('hrbp', 'accounts.manage', true);
      assertEq(R.can('hrbp', 'accounts.manage'), true);
    });
    await test('ha másnak is van, az admintól már elvehető', async () => {
      await R.setAction('admin', 'accounts.manage', false, { sajatRole: 'hrbp' });
      assertEq(R.can('admin', 'accounts.manage'), false);
    });
    await test('az UTOLSÓ birtokostól nem vehető el', async () =>
      throws(() => R.setAction('hrbp', 'accounts.manage', false, { sajatRole: 'admin' }),
             /utolsó szint/));
    await test('holdersOf megmondja, ki kezelheti a fiókokat', async () =>
      assertEq(R.holdersOf('accounts.manage').join(','), 'hrbp'));
  }

  section('Saját szintek');
  {
    const { R, naplo } = ujRoles();
    await R.load();
    const r = await R.create({ label: 'Bérszámfejtő', hint: 'Csak a béradatok',
                               can: ['registry.read'] });
    await test('felvétel: ékezetmentes kulcs képződik', async () =>
      assertEq(r.key, 'berszamfejto'));
    await test('a saját szint nem builtin', async () => assertEq(r.builtin, false));
    await test('ugyanaz a név mégegyszer -> hiba', async () =>
      throws(() => R.create({ label: 'bérszámfejtő' }), /már szerepel/));
    await test('átnevezés', async () => {
      await R.rename('berszamfejto', 'Bérszámfejtés');
      assertEq(R.label('berszamfejto'), 'Bérszámfejtés');
    });
    await test('használatban lévő szint nem törölhető', async () =>
      throws(() => R.remove('berszamfejto', { usedBy: ['Kiss Anna', 'Nagy Béla'] }),
             /2 fiók használja/));
    await test('a saját szintem nem törölhető', async () =>
      throws(() => R.remove('berszamfejto', { sajatRole: 'berszamfejto' }), /saját szintedet/));
    await test('használaton kívüli szint törölhető', async () => {
      await R.remove('berszamfejto');
      assertEq(R.get('berszamfejto'), null);
    });
    await test('minden változás naplósort kapott', async () => {
      const a = naplo.map(x => x.action);
      assert(a.includes('SZINT_UJ') && a.includes('SZINT_ATNEVEZES')
             && a.includes('SZINT_TORLES'), a.join(','));
    });
  }

  section('Naplózás: a jogosultság adása és vétele');
  {
    const { R, naplo } = ujRoles();
    await R.load();
    await R.setAction('megtekinto', 'docgen.generate', true);
    await R.setAction('megtekinto', 'docgen.generate', false);
    await test('adás és vétel külön sort kap, a szinttel és a művelettel', async () => {
      const ad = naplo.find(x => x.action === 'JOG_ADAS');
      const el = naplo.find(x => x.action === 'JOG_VETEL');
      // A művelet kulcsa `muvelet`: ha `action` lenne, felülírná az esemény típusát.
      assert(ad && ad.role === 'megtekinto' && ad.muvelet === 'docgen.generate',
             JSON.stringify(ad));
      assert(el && el.role === 'megtekinto' && el.muvelet === 'docgen.generate',
             JSON.stringify(el));
    });
    await test('a változatlan állapot NEM naplóz (nincs zaj)', async () => {
      const elotte = naplo.length;
      await R.setAction('megtekinto', 'docgen.generate', false);
      assertEq(naplo.length, elotte);
    });
  }

  section('Frissítés: új művelet a kiadásban');
  {
    // Egy „korábbi verzió" configja: a knownActions nem ismeri a docgen.generate-et,
    // és az ügyintézőtől szándékosan EL is vették a transfers.use jogot.
    const AKTOK = ujRoles().R.ACTIONS.map(a => a.key).filter(a => a !== 'docgen.generate');
    const regi = {
      version: 1,
      knownActions: AKTOK,
      roles: [
        { key: 'admin', label: 'Legfőbb admin', builtin: true,
          can: AKTOK.slice() },
        { key: 'ugyintezo', label: 'Ügyintéző', builtin: true,
          can: ['registry.read', 'registry.write', 'cases.read', 'cases.write'] },
        { key: 'sajat', label: 'Saját szint', builtin: false,
          can: ['registry.read'] },
      ],
    };
    const { R, box, naplo } = ujRoles(regi);
    const erintett = await R.load();
    await test('a beépített szintek megkapják az új műveletet a seed szerint', async () => {
      assertEq(R.can('ugyintezo', 'docgen.generate'), true);
      assertEq(R.can('admin', 'docgen.generate'), true);
    });
    await test('a SAJÁT szint nem kapja meg automatikusan', async () =>
      assertEq(R.can('sajat', 'docgen.generate'), false));
    await test('a tudatosan ELVETT jog nem éled újra', async () =>
      assertEq(R.can('ugyintezo', 'transfers.use'), false,
               'a seedből visszakerült egy korábban elvett jog'));
    await test('az összefésülés naplósort kap', async () =>
      assert(naplo.some(x => x.action === 'JOG_UJ_MUVELET'), naplo.map(x => x.action).join(',')));
    await test('az érintett szintek száma visszajön, és a config elmentődött', async () => {
      assertEq(erintett, 2);
      assert(box.cfg.knownActions.includes('docgen.generate'),
             'a knownActions nem frissült — a következő indulás újra összefésülne');
    });
    await test('második betöltés már nem fésül', async () => {
      const ujra = ujRoles(box.cfg);
      assertEq(await ujra.R.load(), 0);
    });
  }

  section('Visszaállítás a kiadás szerinti alapra');
  {
    const { R } = ujRoles();
    await R.load();
    await R.setAction('hrbp', 'docgen.generate', true);
    await R.setAction('hrbp', 'registry.write.hr', false);
    await test('resetToSeed visszaadja a kiadás szerinti kört', async () => {
      await R.resetToSeed('hrbp');
      assertEq(R.can('hrbp', 'docgen.generate'), false);
      assertEq(R.can('hrbp', 'registry.write.hr'), true);
    });
    await test('saját szintnek nincs kiadás szerinti alapja', async () => {
      await R.create({ label: 'Egyedi' });
      await throws(() => R.resetToSeed('egyedi'), /nincs kiadás szerinti alap/);
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
