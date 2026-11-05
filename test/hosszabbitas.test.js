'use strict';

// K2-döntések az engedély-hosszabbításról (plans/TERV-hosszabbitasi-dontesek.md).
// Futtatás: node test/hosszabbitas.test.js
//
// A felületet (fül, párbeszéd, összesítő ablak) böngésző nélkül nem lehet
// mérni; ez a készlet a mögötte álló számítást őrzi: sávok, ki dönthet, a kör,
// a párhuzamos írás, az ügyintézői teendők és az értesítések szabálytáblája.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); failed++; }
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
    async mentesElotte() { return null; },
    async getSubDir() { return null; },
    async listFiles() { return []; },
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
    ['../js/services/hosszabbitas.js',  'Hosszabbitas'],
    ['../js/modules/cases/cases-dashboard.js', 'CasesDashboard'],
  ]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, rel), 'utf8') +
      `\nglobalThis.${name}=${name};`, sandbox, { filename: rel });
  }
  const { EmployeeRepo, Roles, Auth, Leaders, CaseTypes, CaseRepo, Hosszabbitas,
          CasesDashboard } = sandbox;
  CaseTypes.loadFrom(null);
  CasesDashboard.init({ dolgozoNeve: id => id });
  CaseRepo.useBackend(CaseRepo.createMemoryBackend());
  await CaseRepo.load();
  Roles.loadFrom(null);
  Auth.useBackend(Auth.createFileBackend({ name: 'proba' }));
  await Auth.load();
  await Auth.create({ name: 'Admin A', role: 'admin', pin: '1111' });
  await Auth.create({ name: 'Kiss Anna', role: 'megtekinto', pin: '2222' });    // K2
  await Auth.create({ name: 'Nagy Nándor', role: 'megtekinto', pin: '3333' });  // másik K2
  await Auth.create({ name: 'Vezető Vera', role: 'megtekinto', pin: '4444' });  // közvetlen vezető
  await Auth.create({ name: 'HR Bea', role: 'hrbp', pin: '5555' });
  await Auth.create({ name: 'HR Péter', role: 'hrbp', pin: '6666' });
  await Auth.create({ name: 'Ügy Ugó', role: 'ugyintezo', pin: '7777' });
  await Auth.login('Admin A', '1111');
  EmployeeRepo.useBackend(EmployeeRepo.createMemoryBackend());
  await EmployeeRepo.load();
  Hosszabbitas.useBackend(Hosszabbitas.createFileBackend({ name: 'proba' }));
  await Hosszabbitas.load();

  const MA = Auth.today();
  const nap = n => { const d = new Date(MA); d.setDate(d.getDate() + n); return CaseTypes.isoDate(d); };
  const fiok = n => Auth.byName(n);
  let i = 0;
  const uj = (napok, extra = {}) => EmployeeRepo.create({ fields: Object.assign({
    surname: 'Dolgozó', forename: String(++i), personnel_reg_number: String(1000 + i),
    expiration_of_rp: nap(napok), hr_k2: 'Kiss Anna', hr_direct_leader: 'Vezető Vera',
  }, extra) });
  return { EmployeeRepo, Roles, Auth, Leaders, CaseTypes, CaseRepo, Hosszabbitas,
           CasesDashboard, MA, nap, fiok, uj, fajlok };
}

(async () => {
  section('Sávok (3.2) — határérték');
  {
    const { Hosszabbitas: H } = await kornyezet();
    await test('a benyújtási ablak -90 / -45 / -15, az ügytípusból', async () => {
      const a = H.ablak();
      assertEq(`${a.esedekes}/${a.utolso}/${a.vismaior}`, '90/45/15');
    });
    const varas = [[366, null], [365, 'tajekoztato'], [180, 'tajekoztato'], [179, 'kozeleg'],
      [120, 'kozeleg'], [119, 'esedekes'], [90, 'esedekes'], [89, 'kesesben'],
      [60, 'kesesben'], [59, 'utolso'], [45, 'utolso'], [44, 'vismaior'], [15, 'vismaior'],
      [14, 'nemadhato'], [0, 'nemadhato'], [-1, 'lejart']];
    await test('minden határ a helyén (365 … -1)', async () => {
      for (const [n, s] of varas) assertEq(H.sav(n), s, `${n} nap`);
    });
    await test('a saját sávhatár adat, és ellenőrzött', async () => {
      await H.setSavok({ kozeleg: 130 });
      assertEq(H.sav(135), 'kozeleg');
      assertEq(H.sav(125), 'esedekes', 'a feljebb tett határ alatt már esedékes');
      await throws(() => H.setSavok({ kozeleg: 80 }), /sorrend/);
      await throws(() => H.setSavok({ kesesben: 40 }), /Késésben/);
      await H.setSavok({ kozeleg: 120 });
    });
    await test('a döntés mezői adatok; az indoklás mindig ott van', async () => {
      assertEq(H.mezok().map(m => m.key).join(','), 'indoklas');
    });
  }

  section('Ki dönthet, ki lát (3.1)');
  {
    const { Hosszabbitas: H, Auth, Leaders, EmployeeRepo, fiok, uj, MA, nap } = await kornyezet();
    const e = uj(100);
    await test('a K2 dönt, K2 minőségben (ékezet- és kisbetű-függetlenül)', async () => {
      EmployeeRepo.update(e.id, { fields: { hr_k2: 'kiss anna' } });
      assertEq(H.minoseg(fiok('Kiss Anna'), EmployeeRepo.get(e.id), MA), 'k2');
    });
    await test('a közvetlen vezető lát, de nem dönt', async () => {
      assertEq(H.minoseg(fiok('Vezető Vera'), e, MA), null);
      assert(H.lathato(fiok('Vezető Vera'), e, MA));
    });
    await test('idegen vezető nem lát és nem dönt', async () => {
      assertEq(H.minoseg(fiok('Nagy Nándor'), e, MA), null);
      assert(!H.lathato(fiok('Nagy Nándor'), e, MA));
    });
    await test('a K2 helyettese a helyettesítés ideje alatt dönt', async () => {
      const anna = fiok('Kiss Anna'), nandor = fiok('Nagy Nándor');
      await Auth.addDeputy(anna.id, { deputyId: nandor.id, from: nap(-1), to: nap(1) });
      assertEq(H.minoseg(fiok('Nagy Nándor'), e, MA), 'helyettes');
      assertEq(H.minoseg(fiok('Nagy Nándor'), e, nap(5)), null, 'lejárt helyettesítés');
    });
    await test('HRBP bárki nevében; az ügyintéző lát, de nem dönt', async () => {
      assertEq(H.minoseg(fiok('HR Bea'), e, MA), 'hrbp');
      assertEq(H.minoseg(fiok('Ügy Ugó'), e, MA), null);
      assert(H.lathato(fiok('Ügy Ugó'), e, MA));
    });
    await test('az átnevezés a K2 mezőt is átírja', async () => {
      const k = uj(200, { hr_direct_leader: 'Kiss Anna' });
      await Auth.rename(fiok('Kiss Anna').id, 'Kiss-Tóth Anna');
      const r = Leaders.renameCascade('Kiss Anna', 'Kiss-Tóth Anna');
      assertEq(EmployeeRepo.get(e.id).fields.hr_k2, 'Kiss-Tóth Anna');
      assertEq(EmployeeRepo.get(k.id).fields.hr_k2, 'Kiss-Tóth Anna');
      assertEq(EmployeeRepo.get(k.id).fields.hr_direct_leader, 'Kiss-Tóth Anna');
      assertEq(r.valtozott, 2, 'egy dolgozó egyszer számít');
    });
  }

  section('Napló, módosítás, kör (3.3–3.6)');
  {
    const { Hosszabbitas: H, CaseRepo, EmployeeRepo, fiok, uj, MA, fajlok } = await kornyezet();
    const e = uj(100);
    const anna = fiok('Kiss Anna');
    await test('az 1. listán van, amíg nincs döntés', async () => {
      assert(H.dontesreVar(anna, MA).some(a => a.emp.id === e.id));
    });
    await test('a döntés pillanatképpel kerül a naplóba', async () => {
      const ev = await H.dont(anna, e.id, { dontes: 'igen', ma: MA });
      assertEq(ev.tipus, 'DONTES');
      assertEq(ev.sav, 'esedekes');
      assertEq(ev.napok, 100);
      assertEq(ev.minoseg, 'k2');
      assertEq(ev.elozo, null);
      assert(JSON.parse(fajlok['docgen-hosszabbitas.json']).events.length === 1, 'nincs a fájlban');
      assert(!H.dontesreVar(anna, MA).some(a => a.emp.id === e.id), 'a döntés után is vár');
    });
    await test('a módosítás új sor, az előzővel', async () => {
      const ev = await H.dont(anna, e.id, { dontes: 'nem', ma: MA });
      assertEq(ev.tipus, 'MODOSITAS');
      assertEq(ev.elozo, 'igen');
      assertEq(H.allapot(EmployeeRepo.get(e.id), MA).kor.modositasok, 1);
      await throws(() => H.dont(anna, e.id, { dontes: 'nem', ma: MA }), /már a rögzített/);
    });
    await test('futó ügynél a módosításhoz indoklás kell', async () => {
      CaseRepo.create({ employeeId: e.id, type: 'rp_hosszabbitas' });
      await throws(() => H.dont(anna, e.id, { dontes: 'igen', ma: MA }), /indoklás/);
      const ev = await H.dont(anna, e.id, { dontes: 'igen', mezok: { indoklas: 'mégis kell' }, ma: MA });
      assertEq(ev.ugyFutott, true);
      assert(H.nyugtazando(ev));
    });
    await test('idegen fiók nem dönthet', async () => {
      await throws(() => H.dont(fiok('Nagy Nándor'), e.id, { dontes: 'nem', ma: MA }), /nem dönthetsz/);
    });
    await test('HRBP-rögzítés forrással és anélkül', async () => {
      const b = uj(110), c = uj(115);
      const x = await H.dont(fiok('HR Bea'), b.id, { dontes: 'igen',
        forras: { tipus: 'e-mail', megj: 'Anna levele' }, ma: MA });
      assertEq(x.minoseg, 'hrbp');
      assertEq(x.k2, 'Kiss Anna');
      assertEq(x.forras.tipus, 'e-mail');
      const y = await H.dont(fiok('HR Bea'), c.id, { dontes: 'nem', ma: MA });
      assertEq(y.forras, null);
    });
    await test('lezárt hosszabbítás után új kör nyílik', async () => {
      const ugy = CaseRepo.forEmployee(e.id).find(c => c.type === 'rp_hosszabbitas');
      CaseRepo.setStatus(ugy.id, 'lezarva', { outcome: 'megadva', validUntil: H.lejaratOf(e).replace(/^\d{4}/, y => String(+y + 1)) });
      // az új lejárat ~465 nap múlva: a listahorizonton kívül, döntés nélkül
      const a = H.allapot(EmployeeRepo.get(e.id), MA);
      assertEq(a.dontes, null, 'az előző engedélyről szóló döntés áthúzódott');
      assertEq(a.korok.length, 2);
      const d = H.dontesek(anna, { ma: MA }).find(x => x.emp.id === e.id);
      assert(d && !d.aktualis, 'a lezárt kör döntése eltűnt a 2. listáról');
      assert(/^Engedélyezve \d{4}-\d{2}-\d{2}-ig$/.test(H.ugyAllasa(e, d.kor)), H.ugyAllasa(e, d.kor));
    });
    await test('a lejárat a döntés óta módosult → jelzés, a döntés marad', async () => {
      const f = uj(150);
      await H.dont(anna, f.id, { dontes: 'igen', ma: MA });
      EmployeeRepo.update(f.id, { fields: { expiration_of_rp: '2030-01-01' } });
      const a = H.allapot(EmployeeRepo.get(f.id), MA);
      assert(a.dontes && a.lejaratValtozott && a.lejaratValtozott.uj === '2030-01-01');
    });
    await test('a jegyzet közös, és az 1. listán marad a dolgozó', async () => {
      const g = uj(300);
      await H.jegyzet(anna, g.id, 'Valószínűleg marad');
      const a = H.dontesreVar(fiok('HR Bea'), MA).find(x => x.emp.id === g.id);
      assertEq(a.utolsoJegyzet.szoveg, 'Valószínűleg marad');
    });
  }

  section('Párhuzamos írás (3.4)');
  {
    const { Hosszabbitas: H, fiok, uj, MA, fajlok } = await kornyezet();
    const a = uj(100), b = uj(100);
    await test('két munkamenet egyszerre ír → mindkét esemény megmarad', async () => {
      await H.dont(fiok('Kiss Anna'), a.id, { dontes: 'igen', ma: MA });
      // Egy másik gép közben hozzáfűz (a mi betöltésünk óta)
      const d = JSON.parse(fajlok['docgen-hosszabbitas.json']);
      d.events.push({ id: 'masik-gep', at: new Date().toISOString(), tipus: 'DONTES',
        empId: b.id, dontes: 'nem', elozo: null, rogzitette: 'HR Péter', minoseg: 'hrbp' });
      fajlok['docgen-hosszabbitas.json'] = JSON.stringify(d);
      await H.dont(fiok('Kiss Anna'), a.id, { dontes: 'nem', ma: MA });
      const ids = JSON.parse(fajlok['docgen-hosszabbitas.json']).events.map(e => e.id);
      assertEq(ids.length, 3);
      assert(ids.includes('masik-gep'), 'a másik gép eseménye elveszett');
    });
    await test('két döntés ugyanarról → mindkettő marad, „párhuzamos” jelzés', async () => {
      const c = uj(100);
      await H.dont(fiok('Kiss Anna'), c.id, { dontes: 'igen', ma: MA });
      const d = JSON.parse(fajlok['docgen-hosszabbitas.json']);
      d.events.push({ id: 'hrbp-parh', at: new Date(Date.now() + 5).toISOString(), tipus: 'DONTES',
        empId: c.id, dontes: 'nem', elozo: null, rogzitette: 'HR Péter', minoseg: 'hrbp' });
      fajlok['docgen-hosszabbitas.json'] = JSON.stringify(d);
      await H.load();
      const a2 = H.allapot(c, MA);
      assertEq(a2.kor.dontesek.length, 2);
      assertEq(a2.dontes.dontes, 'nem', 'a későbbi érvényes');
      assert(a2.kor.parhuzamos);
    });
  }

  section('Jogok (3.10)');
  {
    const { Roles } = await kornyezet();
    await test('a beépített szint megkapja az új műveletet, a saját szint nem', async () => {
      const regi = Roles.ACTIONS.map(a => a.key).filter(k => !k.startsWith('renewals.'));
      Roles.loadFrom({ version: 1, knownActions: regi, roles: [
        { key: 'megtekinto', label: 'Csak megtekintő', builtin: true, can: ['registry.read.own', 'cases.read.own'] },
        { key: 'hrbp', label: 'HRBP', builtin: true, can: ['registry.read'] },
        { key: 'sajat', label: 'Saját', builtin: false, can: ['cases.read.own'] },
      ] });
      assert(Roles.can('megtekinto', 'renewals.decide.own'));
      assert(Roles.can('megtekinto', 'renewals.read.own'));
      assert(Roles.can('hrbp', 'renewals.decide'));
      assert(!Roles.can('sajat', 'renewals.read.own'), 'a saját szint is megkapta');
      assertEq(Roles.label('megtekinto'), 'Csak megtekintő', 'az élő név adat, nem írjuk át');
    });
  }

  section('Ügyintézői ág (3.8)');
  {
    const { Hosszabbitas: H, CasesDashboard, EmployeeRepo, CaseRepo, fiok, uj, MA } = await kornyezet();
    const anna = fiok('Kiss Anna');
    const igen = uj(110), nem = uj(100), nemFut = uj(80), vissza = uj(70), varo = uj(60);
    await H.dont(anna, igen.id, { dontes: 'igen', ma: MA });
    await H.dont(anna, nem.id, { dontes: 'nem', ma: MA });
    CaseRepo.create({ employeeId: nemFut.id, type: 'rp_hosszabbitas' });
    await H.dont(anna, nemFut.id, { dontes: 'nem', ma: MA });
    await H.dont(anna, vissza.id, { dontes: 'nem', ma: MA });
    EmployeeRepo.setNoRenewal(vissza.id, true, { source: 'k2' });
    await H.dont(anna, vissza.id, { dontes: 'igen', ma: MA });
    const t = H.teendok(MA);
    await test('Igen → indítható, a 90 napos horizonttól függetlenül', async () => {
      assertEq(t.indithato.map(a => a.emp.id).join(), igen.id);
    });
    await test('Nem → átvétel; futó ügynél a visszavonás is teendő', async () => {
      assertEq(t.atvetel.map(a => a.emp.id).sort().join(), [nem.id, nemFut.id].sort().join());
      assertEq(t.visszavonas.map(a => a.emp.id).join(), nemFut.id);
    });
    await test('Nem → Igen a „nem hosszabbítjuk” jelölés után → visszavétel', async () => {
      assertEq(t.visszavetel.map(a => a.emp.id).join(), vissza.id);
    });
    await test('az Áttekintés: a döntöttek nem „Nincs még ügye”-ként, a várók külön', async () => {
      const d = CasesDashboard.adatok({ ma: MA });
      assert(!d.hianyzo.some(j => [nem.id, vissza.id].includes(j.employee.id)), 'döntött a hiányzók közt');
      assert(d.hianyzo.some(j => j.employee.id === varo.id), 'a döntésre váró eltűnt');
      assertEq(d.k2.indithato.length, 1);
    });
    await test('az átvétel a meglévő jelölést állítja, „k2” forrással', async () => {
      EmployeeRepo.setNoRenewal(nem.id, true, { source: 'k2' });
      assertEq(EmployeeRepo.get(nem.id).history.slice(-1)[0].source, 'k2');
      assert(!H.teendok(MA).atvetel.some(a => a.emp.id === nem.id));
    });
  }

  section('Értesítések (3.9) — szabálytábla');
  {
    const { Hosszabbitas: H, EmployeeRepo, CaseRepo, fiok, uj, MA, nap } = await kornyezet();
    const anna = fiok('Kiss Anna'), bea = fiok('HR Bea'), peter = fiok('HR Péter'),
          ugo = fiok('Ügy Ugó'), vera = fiok('Vezető Vera');
    const ids = (f, o) => H.ertesitesek(f, Object.assign({ ma: MA }, o)).map(x => x.id);
    const e100 = uj(100, { hr_hrbp: 'HR Bea' });
    const e300 = uj(300), e10 = uj(10), eLej = uj(-3);
    await test('K2: sávváltás = egy tétel sávonként, nem naponta', async () => {
      const ma1 = ids(anna).filter(x => x.startsWith(`sav:${e100.id}`));
      const holnap = H.ertesitesek(anna, { ma: nap(1) }).map(x => x.id)
        .filter(x => x.startsWith(`sav:${e100.id}`));
      assertEq(ma1.length, 1);
      assertEq(holnap[0], ma1[0], 'másnap új tétel jött ugyanarra a sávra');
      const kesobb = H.ertesitesek(anna, { ma: nap(20) }).map(x => x.id)
        .filter(x => x.startsWith(`sav:${e100.id}`));
      assert(kesobb[0] !== ma1[0], 'sávváltáskor nem jött új tétel');
    });
    await test('K2: tájékoztató sáv, ≤ 14 nap és lejárt → nincs értesítés', async () => {
      const l = ids(anna);
      for (const e of [e300, e10, eLej]) assert(!l.some(x => x.includes(e.id)), e.fields.forename);
    });
    await test('HRBP: eszkaláció 90 napon belül, a saját dolgozóira', async () => {
      const e80 = uj(80, { hr_hrbp: 'HR Péter' }), e88 = uj(88, { hr_hrbp: 'hr bea' });
      assert(ids(bea).includes(`eszk:${e88.id}:${H.lejaratOf(e88)}`), 'a saját eszkaláció hiányzik');
      assert(!ids(bea).some(x => x.startsWith(`eszk:${e100.id}`)), '90 napon túl is eszkalált');
      assert(!ids(bea).some(x => x.startsWith(`eszk:${e80.id}`)), 'a más HRBP-é is jött');
      assert(ids(bea, { mindenHrbp: true }).some(x => x.startsWith(`eszk:${e80.id}`)), 'a kapcsoló nem hat');
    });
    await test('HRBP: üres hr_hrbp → minden HRBP megkapja', async () => {
      const e85 = uj(85);
      for (const f of [bea, peter]) assert(ids(f).some(x => x.startsWith(`eszk:${e85.id}`)), f.name);
    });
    await test('HRBP kap a K2 döntéséről; a K2 kap, ha a nevében döntöttek', async () => {
      const k = await H.dont(anna, e100.id, { dontes: 'igen', ma: MA });
      assert(ids(bea).includes(`ev:${k.id}`));
      assert(!ids(anna).includes(`ev:${k.id}`), 'a saját döntéséről is szólt');
      const e95 = uj(95);
      const h = await H.dont(bea, e95.id, { dontes: 'nem', ma: MA });
      assert(ids(anna).includes(`ev:${h.id}`), 'a K2 nem tudja, hogy a nevében döntöttek');
    });
    await test('futó ügynél módosítás → erős, nyugtázandó; nyugtázás után eltűnik', async () => {
      CaseRepo.create({ employeeId: e100.id, type: 'rp_hosszabbitas' });
      const m = await H.dont(anna, e100.id, { dontes: 'nem', mezok: { indoklas: 'átszervezés' }, ma: MA });
      for (const f of [bea, ugo]) {
        const t = H.ertesitesek(f, { ma: MA }).find(x => x.id === `ev:${m.id}`);
        assert(t && t.erosseg === 'eros' && t.nyugtazando, f.name);
      }
      await H.nyugtaz(ugo, m.id);
      assert(!H.ertesitesek(bea, { ma: MA }).some(x => x.nyugtazando), 'a nyugtázás nem hatott');
      assert(ids(ugo).includes(`visszavon:${m.id}`), 'nincs visszavonás-teendő');
    });
    await test('ügyintéző: Igen → indítható, Nem → átvétel', async () => {
      const a = uj(110), b = uj(105);
      const x = await H.dont(anna, a.id, { dontes: 'igen', ma: MA });
      const y = await H.dont(anna, b.id, { dontes: 'nem', ma: MA });
      assert(ids(ugo).includes(`ind:${x.id}`));
      assert(ids(ugo).includes(`atv:${y.id}`));
      assert(!ids(anna).includes(`ind:${x.id}`), 'a K2 ügyintézői teendőt kapott');
    });
    await test('lezárás → a K2 és a közvetlen vezető megtudja, meddig kapta meg', async () => {
      const z = uj(70);
      await H.dont(anna, z.id, { dontes: 'igen', ma: MA });
      const c = CaseRepo.create({ employeeId: z.id, type: 'rp_hosszabbitas' });
      CaseRepo.setStatus(c.id, 'lezarva', { outcome: 'megadva', validUntil: '2029-03-01' });
      for (const f of [anna, vera]) {
        const t = H.ertesitesek(f, { ma: MA }).find(x => x.id === `ugy:${c.id}`);
        assert(t && /2029-03-01-ig/.test(t.szoveg), f.name);
      }
    });
    await test('átszervezés: az új K2 kap értesítést a döntésre váróról', async () => {
      const w = uj(100, { hr_k2: 'Nagy Nándor' });
      EmployeeRepo.update(w.id, { fields: { hr_k2: 'Kiss Anna' } });
      assert(ids(anna).some(x => x.startsWith(`k2uj:${w.id}`)));
      assert(!ids(fiok('Nagy Nándor')).some(x => x.startsWith(`k2uj:${w.id}`)));
    });
    await test('„nem hosszabbítjuk” jelölésnél nincs sáv- és eszkaláció-értesítés', async () => {
      const n = uj(100);
      EmployeeRepo.setNoRenewal(n.id, true);
      assert(!ids(anna).some(x => x.includes(n.id)));
      assert(!ids(bea).some(x => x.includes(n.id)));
    });
  }

  console.log(`\nEredmény: ${passed} sikeres / ${failed} hibás (összesen ${passed + failed})`);
  if (failed) process.exit(1);
  console.log('Mind sikeres ✓');
})().catch(e => { console.error(e); process.exit(1); });
