'use strict';

// Ügykövetés tesztjei. Futtatás: node test/cases.test.js
//
// A hangsúly azon van, amit hatósági ügyintézésnél utólag meg kell tudni
// mondani: mikor mi történt, milyen kimenettel zárult, és melyik kérelemből
// származik egy engedélyszám.

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
async function assertThrows(fn, minta, m) {
  let dobott = null;
  try { await fn(); } catch (e) { dobott = e; }
  assert(dobott, m || 'nem dobott hibát');
  if (minta) assert(minta.test(dobott.message), `váratlan hibaüzenet: ${dobott.message}`);
}

// ── Sandbox ─────────────────────────────────────────────────────────────────
const sandbox = {
  console, Date, Math, JSON, Set, Map, Object, Array, String, Number, Boolean,
  Error, RegExp, Promise, isNaN, parseInt, parseFloat, crypto, setTimeout, clearTimeout,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const [rel, name] of [
  ['../js/services/employee-repo.js', 'EmployeeRepo'],
  ['../js/schema/case-types.js',      'CaseTypes'],
  ['../js/services/case-repo.js',     'CaseRepo'],
]) {
  let code = fs.readFileSync(path.join(__dirname, rel), 'utf8');
  code += `\nglobalThis.${name} = ${name};`;
  vm.runInContext(code, sandbox, { filename: rel });
}
const { EmployeeRepo, CaseTypes, CaseRepo } = sandbox;
CaseTypes.loadFrom(null);

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

// ════════════════════════════════════════════════════════════════════════════
asection('Ügytípusok és határidők');

atest('a kérelmek alapértelmezett határideje 70 nap', async () => {
  assertEq(CaseTypes.DEFAULT_APPLICATION_DAYS, 70);
  for (const t of CaseTypes.all().filter(x => x.kind === 'kerelem')) {
    assertEq(t.defaultDurationDays, 70, `${t.key} határideje nem 70 nap`);
  }
});

atest('a 70 nap az OIF-érkeztetéstől számol', async () => {
  // A határidő az érkeztetés napját KÖVETŐ naptól indul, ezért a hetvenedik
  // nap pontosan az érkeztetés + 70.
  assertEq(CaseTypes.suggestDueDate('rp_elso', '2026-01-01'), '2026-03-12');
  assertEq(CaseTypes.suggestDueDate('rp_hosszabbitas', '2026-01-01'), '2026-03-12');
  assertEq(CaseTypes.suggestDueDate('letelepedes', '2026-01-01'), '2026-03-12');
});

atest('a kérelem kezdő napja az OIF-érkeztetés, nem az ügy megnyitása', async () => {
  // A program nem tudja, mikor érkeztette az OIF a kérelmet – ezt kézzel
  // kell rögzíteni, amikor megjön az iktatószám.
  assert(/érkeztet/i.test(CaseTypes.triggerLabel('rp_elso')),
    `nem az érkeztetést kéri: ${CaseTypes.triggerLabel('rp_elso')}`);
  assert(/iktatószám/i.test(CaseTypes.triggerLabel('rp_elso')));
  assert(/költözés/i.test(CaseTypes.triggerLabel('szallashely_valtozas')));
});

atest('a bejelentések határideje a TÉNY napjától fut, nem az ügy megnyitásától', async () => {
  // Szálláshely: költözéstől 3 nap
  assertEq(CaseTypes.suggestDueDate('szallashely_valtozas', '2026-08-10'),
    '2026-08-13', 'a szálláshely-bejelentés nem a költözéstől számol');
  // Munkaviszony megkezdése / megszűnése: a ténytől 5 nap
  assertEq(CaseTypes.suggestDueDate('munkaviszony_bejelentes', '2026-08-10'),
    '2026-08-15');
  assertEq(CaseTypes.suggestDueDate('munkaviszony_kijelentes', '2026-08-10'),
    '2026-08-15');
});

atest('két hete megtörtént költözésnél a határidő MÁR LEJÁRT', async () => {
  // Ha a megnyitástól számolnánk, a program azt mutatná, hogy még van időnk –
  // pedig a bejelentés elmulasztása jogszabálysértés.
  await tisztaAllapot();
  const emp = ujDolgozo();
  const MA = '2026-08-24';
  const ugy = CaseRepo.create({
    employeeId: emp.id, type: 'szallashely_valtozas',
    openedAt: MA, triggerDate: '2026-08-10',
  });
  assertEq(ugy.dueAt, '2026-08-13');
  assertEq(CaseRepo.urgency(ugy, MA), 'lejart', 'nem jelzi lejártnak');
  assertEq(CaseRepo.daysLeft(ugy, MA), -11);
});

atest('a kiváltó dátum javítása újraszámolja a határidőt', async () => {
  await tisztaAllapot();
  const emp = ujDolgozo();
  const ugy = CaseRepo.create({
    employeeId: emp.id, type: 'szallashely_valtozas', triggerDate: '2026-08-10',
  });
  assertEq(ugy.dueAt, '2026-08-13');

  // Elgépelt költözési dátum javítása
  CaseRepo.update(ugy.id, { triggerDate: '2026-08-18' });
  assertEq(CaseRepo.get(ugy.id).dueAt, '2026-08-21', 'a határidő a régi értéken maradt');
});

atest('a kézzel megadott határidőt a kiváltó dátum nem írja felül', async () => {
  await tisztaAllapot();
  const emp = ujDolgozo();
  const ugy = CaseRepo.create({
    employeeId: emp.id, type: 'szallashely_valtozas', triggerDate: '2026-08-10',
  });
  CaseRepo.update(ugy.id, { triggerDate: '2026-08-18', dueAt: '2026-09-01' });
  assertEq(CaseRepo.get(ugy.id).dueAt, '2026-09-01');
});

atest('a kérelemnek sincs határideje, amíg nem tudjuk az érkeztetés napját', async () => {
  // Beadás után, de az iktatószám megérkezése előtt egyszerűen nem tudjuk,
  // mikor jár le a 70 nap. Ilyenkor ne mutassunk kitalált dátumot.
  await tisztaAllapot();
  const emp = ujDolgozo();
  const ugy = CaseRepo.create({ employeeId: emp.id, type: 'rp_elso' });

  assertEq(ugy.dueAt, null, 'kitalált egy határidőt az érkeztetés ismerete nélkül');
  assertEq(CaseRepo.urgency(ugy, '2026-08-07'), 'nyitott');
  assert(/érkeztet/i.test(CaseRepo.deadlineText(ugy)),
    `nem az érkeztetést kéri: ${CaseRepo.deadlineText(ugy)}`);
});

atest('az érkeztetés rögzítésekor magától megjelenik a határidő', async () => {
  // Tipikus menet: beadjuk, majd megjön az iktatószám az érkeztetés napjával.
  await tisztaAllapot();
  const emp = ujDolgozo();
  const ugy = CaseRepo.create({ employeeId: emp.id, type: 'rp_elso' });
  assertEq(ugy.dueAt, null);

  CaseRepo.update(ugy.id, { triggerDate: '2026-01-01', fileNumber: 'IKT-42/2026' });
  const u = CaseRepo.get(ugy.id);
  assertEq(u.dueAt, '2026-03-12', 'nem számolta ki a 70 napot');
  assertEq(u.triggerDate, '2026-01-01');
  assertEq(u.fileNumber, 'IKT-42/2026');
});

atest('a bejelentés határideje tájékoztató, a kérelemé nem', async () => {
  // A bejelentés határideje egy külső tényből számol, amit a program nem
  // ismer és nem tud ellenőrizni – annyit ér, amennyit a beírt dátum.
  // A kérelem 70 napja az ügy megnyitásából számol, amit a program maga tud.
  assertEq(CaseTypes.isAdvisoryDeadline('szallashely_valtozas'), true);
  assertEq(CaseTypes.isAdvisoryDeadline('munkaviszony_kijelentes'), true);
  assertEq(CaseTypes.isAdvisoryDeadline('rp_elso'), false);
});

atest('kezdő dátum nélkül SEMMILYEN típusnál nincs határidő', async () => {
  // Egyetlen határidő sincs, amit a program magától tudna – mindegyik egy
  // kézzel rögzített naptól fut. Kitalált határidő rosszabb, mint a hiányzó.
  for (const t of CaseTypes.all()) {
    assertEq(CaseTypes.suggestDueDate(t.key, null), null, `${t.key}: kitalált egy határidőt`);
  }
});

atest('határidő nélküli ügy nem számít hiányosnak', async () => {
  await tisztaAllapot();
  const emp = ujDolgozo();
  const ugy = CaseRepo.create({ employeeId: emp.id, type: 'szallashely_valtozas' });

  assertEq(ugy.dueAt, null, 'kitalált egy határidőt');
  assertEq(CaseRepo.urgency(ugy, '2026-08-07'), 'nyitott', 'lejártnak vagy sürgősnek jelöli');
  assert(/Költözés napja/.test(CaseRepo.deadlineText(ugy)),
    `nem mondja meg, mit kell megadni: ${CaseRepo.deadlineText(ugy)}`);
});

atest('a tájékoztató határidő szövege nem állít mulasztást', async () => {
  await tisztaAllapot();
  const emp = ujDolgozo();
  const MA = '2026-08-24';

  const bejelentes = CaseRepo.create({
    employeeId: emp.id, type: 'szallashely_valtozas', triggerDate: '2026-08-10',
  });
  const kerelem = CaseRepo.create({
    employeeId: emp.id, type: 'rp_elso', dueAt: '2026-08-13',
  });

  const bSzoveg = CaseRepo.deadlineText(bejelentes, MA);
  const kSzoveg = CaseRepo.deadlineText(kerelem, MA);

  assert(/megadott nap szerint/.test(bSzoveg), `nem jelzi tájékoztatónak: ${bSzoveg}`);
  assert(!/megadott nap szerint/.test(kSzoveg), `a kérelmet is tájékoztatónak jelzi: ${kSzoveg}`);
  assert(/11 napja lejárt/.test(bSzoveg) && /11 napja lejárt/.test(kSzoveg),
    'a napszám hibás');
});

atest('mind a négy elutasítás-fajta rögzíthető', async () => {
  const kulcsok = CaseTypes.outcomes().map(o => o.key);
  for (const k of ['megadva', 'elutasitva', 'megszuntetve', 'elutasitva_ervn', 'visszavonva']) {
    assert(kulcsok.includes(k), `hiányzó kimenetel: ${k}`);
  }
  assert(/érdemi vizsgálat nélkül/i.test(CaseTypes.outcomeLabel('elutasitva_ervn')));
});

atest('minden ügytípusnak van záró státusza – különben lezárhatatlan lenne', async () => {
  for (const t of CaseTypes.all()) {
    assert(t.statuses.some(s => s.terminal), `${t.key}: nincs záró státusz`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
asection('Benyújtási ablak (számított)');

atest('a három mérföldkő az engedély lejáratából számol', async () => {
  const a = CaseTypes.submissionWindow('rp_hosszabbitas', { expiration_of_rp: '2026-12-31' });
  assertEq(a.basis,    '2026-12-31');
  assertEq(a.earliest, '2026-10-02');   // −90 nap
  assertEq(a.latest,   '2026-11-21');   // −40 nap
  assertEq(a.final,    '2026-12-21');   // −10 nap
});

atest('engedély lejárata nélkül nincs ablak – nem talál ki dátumot', async () => {
  assertEq(CaseTypes.submissionWindow('rp_hosszabbitas', {}), null);
  assertEq(CaseTypes.submissionWindow('rp_hosszabbitas', { expiration_of_rp: '' }), null);
});

atest('első kérelemnél és bejelentésnél nincs ablak', async () => {
  // Az első kérelemhez nincs meglévő engedély, amiből számolni lehetne
  assertEq(CaseTypes.submissionWindow('rp_elso', { expiration_of_rp: '2026-12-31' }), null);
  assertEq(CaseTypes.submissionWindow('szallashely_valtozas', { expiration_of_rp: '2026-12-31' }), null);
});

atest('a négy szakasz helyesen különül el', async () => {
  const a = CaseTypes.submissionWindow('rp_hosszabbitas', { expiration_of_rp: '2026-12-31' });
  assertEq(CaseTypes.windowPhase(a, '2026-09-01'), 'korai',   'még nem nyílt meg');
  assertEq(CaseTypes.windowPhase(a, '2026-10-02'), 'idealis', 'a nyitónap már beadható');
  assertEq(CaseTypes.windowPhase(a, '2026-11-21'), 'idealis', 'az ajánlott határnap még ideális');
  assertEq(CaseTypes.windowPhase(a, '2026-11-22'), 'siess');
  assertEq(CaseTypes.windowPhase(a, '2026-12-21'), 'siess',   'a legvégső nap még beadható');
  assertEq(CaseTypes.windowPhase(a, '2026-12-22'), 'lekesve');
});

atest('az összefoglaló szöveg megmondja, mit kell tenni', async () => {
  await tisztaAllapot();
  const emp = EmployeeRepo.create({
    fields: { surname: 'Kis', forename: 'Éva', expiration_of_rp: '2026-12-31' },
  });
  const ugy = CaseRepo.create({ employeeId: emp.id, type: 'rp_hosszabbitas' });
  const F = emp.fields;

  assert(/nem adható be/.test(CaseRepo.submissionStatus(ugy, F, '2026-09-01').text));
  assert(/Beadható/.test(CaseRepo.submissionStatus(ugy, F, '2026-10-15').text));
  assert(/Sürgős/.test(CaseRepo.submissionStatus(ugy, F, '2026-12-01').text));
  assert(/lejárt/.test(CaseRepo.submissionStatus(ugy, F, '2026-12-25').text));
});

atest('beadás után az ablak már nem sürget', async () => {
  await tisztaAllapot();
  const emp = EmployeeRepo.create({
    fields: { surname: 'Kis', forename: 'Éva', expiration_of_rp: '2026-12-31' },
  });
  const ugy = CaseRepo.create({ employeeId: emp.id, type: 'rp_hosszabbitas' });
  CaseRepo.setStatus(ugy.id, 'beadva', { note: 'beadva' });

  const st = CaseRepo.submissionStatus(CaseRepo.get(ugy.id), emp.fields, '2026-12-25');
  assertEq(st.done, true);
  assert(/nem releváns/.test(st.text), `sürget beadás után is: ${st.text}`);
});

// ════════════════════════════════════════════════════════════════════════════
asection('Idővonal');

atest('az idővonal időrendben adja az eseményeket és a mérföldköveket', async () => {
  await tisztaAllapot();
  const emp = EmployeeRepo.create({
    fields: { surname: 'Kis', forename: 'Éva', expiration_of_rp: '2026-12-31' },
  });
  const ugy = CaseRepo.create({
    employeeId: emp.id, type: 'rp_hosszabbitas',
    openedAt: '2026-10-05', triggerDate: '2026-10-10',
  });

  const tl = CaseRepo.timeline(ugy, emp.fields, '2026-11-01');
  const datumok = tl.map(p => p.date);
  assertEq(datumok.join(','), [...datumok].sort().join(','), 'nincs időrendben');

  const fajtak = tl.map(p => p.kind);
  assert(fajtak.includes('esemeny'),  'nincs esemény');
  assert(fajtak.includes('ablak'),    'nincs benyújtási mérföldkő');
  assert(fajtak.includes('hatarido'), 'nincs határidő');
  assert(fajtak.includes('ma'),       'nincs mai nap');
});

atest('a számított pontok megkülönböztethetők a rögzített tényektől', async () => {
  await tisztaAllapot();
  const emp = EmployeeRepo.create({
    fields: { surname: 'Kis', forename: 'Éva', expiration_of_rp: '2026-12-31' },
  });
  const ugy = CaseRepo.create({
    employeeId: emp.id, type: 'rp_hosszabbitas', triggerDate: '2026-10-10',
  });
  const tl = CaseRepo.timeline(ugy, emp.fields, '2026-11-01');

  // Az esemény tény, az ablak és a határidő következtetés
  assertEq(tl.filter(p => p.kind === 'esemeny').every(p => !p.computed), true);
  assertEq(tl.filter(p => p.kind === 'ablak').every(p => p.computed), true);
  assertEq(tl.find(p => p.kind === 'hatarido').computed, true);
});

atest('minden pont tudja, hogy múltbeli, mai vagy jövőbeli', async () => {
  await tisztaAllapot();
  const emp = EmployeeRepo.create({
    fields: { surname: 'Kis', forename: 'Éva', expiration_of_rp: '2026-12-31' },
  });
  const ugy = CaseRepo.create({ employeeId: emp.id, type: 'rp_hosszabbitas' });
  const MA = '2026-11-01';
  const tl = CaseRepo.timeline(ugy, emp.fields, MA);

  for (const p of tl) {
    const vart = p.date < MA ? 'mult' : (p.date === MA ? 'ma' : 'jovo');
    assertEq(p.state, vart, `${p.label} (${p.date}) besorolása hibás`);
  }
  assertEq(tl.filter(p => p.kind === 'ma').length, 1, 'nincs vagy több a mai pont');
});

atest('lezárt ügy idővonalán nincs mai pont', async () => {
  await tisztaAllapot();
  const emp = ujDolgozo();
  const ugy = CaseRepo.create({ employeeId: emp.id, type: 'rp_elso' });
  CaseRepo.setStatus(ugy.id, 'lezarva', { outcome: 'megadva' });

  const tl = CaseRepo.timeline(CaseRepo.get(ugy.id), emp.fields, '2026-11-01');
  assertEq(tl.filter(p => p.kind === 'ma').length, 0, 'lezárt ügyön is ott a mai nap');
});

atest('az esemény megőrzi az iktatószámot és a kimenetelt', async () => {
  await tisztaAllapot();
  const emp = ujDolgozo();
  const ugy = CaseRepo.create({ employeeId: emp.id, type: 'rp_elso' });
  CaseRepo.setStatus(ugy.id, 'beadva', { fileNumber: 'IKT-5/2026', note: 'beadva' });
  CaseRepo.setStatus(ugy.id, 'lezarva', { outcome: 'elutasitva_ervn', note: 'formai hiba' });

  const tl = CaseRepo.timeline(CaseRepo.get(ugy.id), {}, '2026-11-01');
  const esemenyek = tl.filter(p => p.kind === 'esemeny');
  assert(esemenyek.some(e => e.fileNumber === 'IKT-5/2026'), 'elveszett az iktatószám');
  assert(esemenyek.some(e => e.outcome === 'elutasitva_ervn'), 'elveszett a kimenetel');
});

// ════════════════════════════════════════════════════════════════════════════
asection('Ügy életciklusa');

atest('új ügy a típus első státuszával indul', async () => {
  await tisztaAllapot();
  const emp = ujDolgozo();
  const ugy = CaseRepo.create({ employeeId: emp.id, type: 'rp_elso', openedAt: '2026-01-01' });

  assertEq(ugy.status, 'elokeszites');
  assertEq(ugy.closedAt, null);
  assertEq(ugy.events.length, 1, 'a megnyitás nem került a történetbe');
});

atest('megadott érkeztetéssel a határidő azonnal megvan', async () => {
  await tisztaAllapot();
  const emp = ujDolgozo();
  const ugy = CaseRepo.create({
    employeeId: emp.id, type: 'rp_elso',
    openedAt: '2026-01-05', triggerDate: '2026-01-01',
  });
  assertEq(ugy.dueAt, '2026-03-12', 'nem az érkeztetéstől számolt');
});

atest('a javasolt határidő kézzel felülírható', async () => {
  await tisztaAllapot();
  const emp = ujDolgozo();
  const ugy = CaseRepo.create({
    employeeId: emp.id, type: 'rp_elso', openedAt: '2026-01-01', dueAt: '2026-02-15',
  });
  assertEq(ugy.dueAt, '2026-02-15');

  CaseRepo.update(ugy.id, { dueAt: '2026-04-01' });
  assertEq(CaseRepo.get(ugy.id).dueAt, '2026-04-01', 'a módosított határidő nem rögzült');
});

atest('a státuszváltás bekerül az esemény-történetbe', async () => {
  await tisztaAllapot();
  const emp = ujDolgozo();
  const ugy = CaseRepo.create({ employeeId: emp.id, type: 'rp_elso' });

  CaseRepo.setStatus(ugy.id, 'beadva', { note: 'Személyesen benyújtva' });
  CaseRepo.setStatus(ugy.id, 'hianypotlas', { note: 'Hiányzik a szálláshely-igazolás' });

  const u = CaseRepo.get(ugy.id);
  assertEq(u.status, 'hianypotlas');
  assertEq(u.events.length, 3, 'nem minden lépés került a történetbe');
  assertEq(u.events[1].status, 'beadva');
  assert(/szálláshely/i.test(u.events[2].note), 'a megjegyzés elveszett');
});

atest('idegen státusz nem fogadható el', async () => {
  await tisztaAllapot();
  const emp = ujDolgozo();
  const ugy = CaseRepo.create({ employeeId: emp.id, type: 'szallashely_valtozas' });
  await assertThrows(() => CaseRepo.setStatus(ugy.id, 'elbiralas'),
    /nem tartozik ehhez az ügytípushoz/, 'elfogadott egy másik típus státuszát');
});

// ════════════════════════════════════════════════════════════════════════════
asection('Lezárás és kimenetel');

atest('lezáráshoz kötelező a kimenetel megadása', async () => {
  await tisztaAllapot();
  const emp = ujDolgozo();
  const ugy = CaseRepo.create({ employeeId: emp.id, type: 'rp_elso' });
  // Kimenetel nélkül utólag nem lehetne megmondani, mi lett az ügy vége
  await assertThrows(() => CaseRepo.setStatus(ugy.id, 'lezarva'),
    /kimenetelt/, 'kimenetel nélkül is lezárta');
});

atest('mind a négy negatív kimenetel rögzíthető és visszaolvasható', async () => {
  await tisztaAllapot();
  const emp = ujDolgozo();
  for (const kimenet of ['elutasitva', 'megszuntetve', 'elutasitva_ervn', 'visszavonva']) {
    const ugy = CaseRepo.create({ employeeId: emp.id, type: 'rp_elso' });
    CaseRepo.setStatus(ugy.id, 'lezarva', { outcome: kimenet, note: 'teszt' });
    const u = CaseRepo.get(ugy.id);
    assertEq(u.outcome, kimenet);
    assert(u.closedAt, `${kimenet}: nincs lezárási időpont`);
    assertEq(u.events[u.events.length - 1].outcome, kimenet, 'a kimenetel nincs a történetben');
  }
});

atest('ismeretlen kimenetelt nem fogad el', async () => {
  await tisztaAllapot();
  const emp = ujDolgozo();
  const ugy = CaseRepo.create({ employeeId: emp.id, type: 'rp_elso' });
  await assertThrows(() => CaseRepo.setStatus(ugy.id, 'lezarva', { outcome: 'talan' }),
    /Ismeretlen kimenetel/);
});

atest('lezárt ügynél a határidő már nem számít lejártnak', async () => {
  await tisztaAllapot();
  const emp = ujDolgozo();
  const ugy = CaseRepo.create({ employeeId: emp.id, type: 'rp_elso', dueAt: '2020-01-01' });
  assertEq(CaseRepo.urgency(ugy, '2026-08-07'), 'lejart');

  CaseRepo.setStatus(ugy.id, 'lezarva', { outcome: 'megadva' });
  assertEq(CaseRepo.urgency(CaseRepo.get(ugy.id), '2026-08-07'), 'lezart');
  assertEq(CaseRepo.daysLeft(CaseRepo.get(ugy.id), '2026-08-07'), null);
});

// ════════════════════════════════════════════════════════════════════════════
asection('EH szám és iktatószám');

atest('mindkettő megadható létrehozáskor és módosításkor', async () => {
  await tisztaAllapot();
  const emp = ujDolgozo();
  const ugy = CaseRepo.create({
    employeeId: emp.id, type: 'rp_elso',
    ehNumber: 'EH-2026-001', fileNumber: 'IKT-12345/2026',
  });
  assertEq(ugy.ehNumber, 'EH-2026-001');
  assertEq(ugy.fileNumber, 'IKT-12345/2026');

  CaseRepo.update(ugy.id, { ehNumber: 'EH-2026-002' });
  assertEq(CaseRepo.get(ugy.id).ehNumber, 'EH-2026-002');
});

atest('státuszváltáskor is megadható – gyakran ekkor derül ki', async () => {
  await tisztaAllapot();
  const emp = ujDolgozo();
  const ugy = CaseRepo.create({ employeeId: emp.id, type: 'rp_elso' });

  // Az iktatószám a beadáskor keletkezik
  CaseRepo.setStatus(ugy.id, 'beadva', { fileNumber: 'IKT-999/2026', note: 'beadva' });
  const u = CaseRepo.get(ugy.id);
  assertEq(u.fileNumber, 'IKT-999/2026');
  assertEq(u.events[1].fileNumber, 'IKT-999/2026', 'az esemény nem őrizte meg');
});

atest('EH számra és iktatószámra lehet keresni', async () => {
  await tisztaAllapot();
  const emp = ujDolgozo();
  CaseRepo.create({ employeeId: emp.id, type: 'rp_elso', ehNumber: 'EH-AAA-111' });
  CaseRepo.create({ employeeId: emp.id, type: 'letelepedes', fileNumber: 'IKT-BBB-222' });

  assertEq(CaseRepo.search('aaa-111').length, 1);
  assertEq(CaseRepo.search('bbb-222').length, 1);
  assertEq(CaseRepo.search('nincsilyen').length, 0);
});

// ════════════════════════════════════════════════════════════════════════════
asection('Kapcsolat az azonosító-történettel');

atest('a lezárt kérelem új engedélyszáma a dolgozóhoz kerül, a régi lezárul', async () => {
  await tisztaAllapot();
  const emp = EmployeeRepo.create({
    fields: { surname: 'Nagy', forename: 'Béla', number_of_rp: 'RP-REGI' },
    identifiers: [{ type: 'residence_permit', value: 'RP-REGI' }],
  });
  const ugy = CaseRepo.create({ employeeId: emp.id, type: 'rp_hosszabbitas' });
  CaseRepo.setStatus(ugy.id, 'lezarva', { outcome: 'megadva' });
  CaseRepo.recordProducedIdentifier(ugy.id, { value: 'RP-UJ-2026' });

  const u = EmployeeRepo.get(emp.id);
  assertEq(EmployeeRepo.currentIdentifier(u, 'residence_permit').value, 'RP-UJ-2026');
  assertEq(u.identifiers.filter(i => !i.current)[0].value, 'RP-REGI', 'a régi nem záródott le');
  // A tükrözött mező is követi – ezen múlik az xlsx-export helyessége
  assertEq(u.fields.number_of_rp, 'RP-UJ-2026', 'az xlsx-mező a régi számot őrzi');
});

atest('visszakereshető, MELYIK ügy hozta az azonosítót', async () => {
  await tisztaAllapot();
  const emp = ujDolgozo();
  const ugy = CaseRepo.create({ employeeId: emp.id, type: 'rp_elso', ehNumber: 'EH-777' });
  CaseRepo.setStatus(ugy.id, 'lezarva', { outcome: 'megadva' });
  CaseRepo.recordProducedIdentifier(ugy.id, { value: 'RP-ELSO-1' });

  const u = CaseRepo.get(ugy.id);
  assertEq(u.producedId.value, 'RP-ELSO-1');
  assertEq(u.producedId.type, 'residence_permit');
  assertEq(u.ehNumber, 'EH-777', 'az EH szám elveszett');
});

atest('bejelentésnél nem lehet azonosítót rögzíteni', async () => {
  await tisztaAllapot();
  const emp = ujDolgozo();
  const ugy = CaseRepo.create({ employeeId: emp.id, type: 'szallashely_valtozas' });
  await assertThrows(() => CaseRepo.recordProducedIdentifier(ugy.id, { value: 'X' }),
    /nem hoz azonosítót/);
});

// ════════════════════════════════════════════════════════════════════════════
asection('Határidő-figyelés');

atest('lejárt / sürgős / nyitott besorolás', async () => {
  await tisztaAllapot();
  const emp = ujDolgozo();
  const MA = '2026-08-07';
  const lejart  = CaseRepo.create({ employeeId: emp.id, type: 'rp_elso', dueAt: '2026-08-01' });
  const surgos  = CaseRepo.create({ employeeId: emp.id, type: 'rp_elso', dueAt: '2026-08-15' });
  const nyugodt = CaseRepo.create({ employeeId: emp.id, type: 'rp_elso', dueAt: '2026-12-01' });

  assertEq(CaseRepo.urgency(lejart, MA),  'lejart');
  assertEq(CaseRepo.urgency(surgos, MA),  'surgos');
  assertEq(CaseRepo.urgency(nyugodt, MA), 'nyitott');
  assertEq(CaseRepo.daysLeft(lejart, MA), -6);
});

atest('a nyitott ügyek listája a legégetőbbel kezd', async () => {
  await tisztaAllapot();
  const emp = ujDolgozo();
  const MA = '2026-08-07';
  CaseRepo.create({ employeeId: emp.id, type: 'rp_elso', dueAt: '2026-12-01' });
  CaseRepo.create({ employeeId: emp.id, type: 'rp_elso', dueAt: '2026-07-01' });
  CaseRepo.create({ employeeId: emp.id, type: 'rp_elso', dueAt: '2026-08-10' });

  const sorrend = CaseRepo.openCases(MA).map(c => c.dueAt);
  assertEq(sorrend.join(','), '2026-07-01,2026-08-10,2026-12-01');
});

atest('a közelgő lejáratot felveti, de csak ha nincs rá nyitott ügy', async () => {
  await tisztaAllapot();
  const emp = EmployeeRepo.create({
    fields: { surname: 'Kis', forename: 'Éva', expiration_of_rp: '2026-08-20' },
  });
  const MA = '2026-08-07';

  let javaslat = CaseRepo.suggestRenewals(EmployeeRepo.all(), { ma: MA });
  assertEq(javaslat.length, 1, 'nem vetette fel a közelgő lejáratot');
  assertEq(javaslat[0].daysLeft, 13);

  CaseRepo.create({ employeeId: emp.id, type: 'rp_hosszabbitas' });
  javaslat = CaseRepo.suggestRenewals(EmployeeRepo.all(), { ma: MA });
  assertEq(javaslat.length, 0, 'nyitott ügy mellett is felvetette');
});

// ════════════════════════════════════════════════════════════════════════════
asection('Tárolás és sértetlenség');

atest('az ügyek mentés-betöltés után változatlanok', async () => {
  await tisztaAllapot();
  const emp = ujDolgozo();
  const ugy = CaseRepo.create({
    employeeId: emp.id, type: 'rp_elso', ehNumber: 'EH-1', fileNumber: 'IKT-1',
  });
  CaseRepo.setStatus(ugy.id, 'beadva', { note: 'beadva' });
  CaseRepo.setStatus(ugy.id, 'lezarva', { outcome: 'elutasitva_ervn', note: 'formai hiba' });
  await CaseRepo.flush();

  await CaseRepo.load();
  const u = CaseRepo.get(ugy.id);
  assertEq(u.outcome, 'elutasitva_ervn');
  assertEq(u.ehNumber, 'EH-1');
  assertEq(u.events.length, 3);
  assert(/formai hiba/.test(u.events[2].note));
});

atest('a dolgozó törlésekor az ügyei sem maradnak árván', async () => {
  await tisztaAllapot();
  const a = ujDolgozo();
  const b = EmployeeRepo.create({ fields: { surname: 'Kis', forename: 'Éva' } });
  CaseRepo.create({ employeeId: a.id, type: 'rp_elso' });
  CaseRepo.create({ employeeId: a.id, type: 'letelepedes' });
  CaseRepo.create({ employeeId: b.id, type: 'rp_elso' });

  assertEq(CaseRepo.destroyForEmployee(a.id), 2);
  assertEq(CaseRepo.all().length, 1);
  assertEq(CaseRepo.forEmployee(b.id).length, 1);
});

atest('ügytípus nélkül nem hozható létre ügy', async () => {
  await tisztaAllapot();
  const emp = ujDolgozo();
  await assertThrows(() => CaseRepo.create({ employeeId: emp.id, type: 'nincs_ilyen' }),
    /Ismeretlen ügytípus/);
  await assertThrows(() => CaseRepo.create({ type: 'rp_elso' }),
    /nincs dolgozóhoz rendelve/);
});

// ════════════════════════════════════════════════════════════════════════════
asection('Visszamenőleges rögzítés');

atest('a történés napja megadható, a rögzítésé megmarad audit-nyomnak', async () => {
  await tisztaAllapot();
  const emp = ujDolgozo();
  const ugy = CaseRepo.create({ employeeId: emp.id, type: 'rp_elso' });

  // „Múlt kedden megjött a hiánypótlási felhívás"
  CaseRepo.setStatus(ugy.id, 'beadva', { occurredAt: '2026-07-20', note: 'beadva' });

  const e = CaseRepo.get(ugy.id).events[1];
  assertEq(e.occurredAt, '2026-07-20', 'a történés napja nem rögzült');
  assert(e.at.startsWith(new Date().toISOString().slice(0, 10)), 'a rögzítés ideje nem a mai');
  assertEq(CaseRepo.isBackdated(e), true, 'nem jelzi utólagosnak');
});

atest('az idővonal a TÖRTÉNÉS szerint rendez, nem a rögzítés szerint', async () => {
  await tisztaAllapot();
  const emp = ujDolgozo();
  const ugy = CaseRepo.create({ employeeId: emp.id, type: 'rp_elso', openedAt: '2026-07-01' });

  // Fordított sorrendben visszük fel őket
  CaseRepo.setStatus(ugy.id, 'elbiralas',   { occurredAt: '2026-07-25', note: 'késői' });
  CaseRepo.setStatus(ugy.id, 'beadva',      { occurredAt: '2026-07-10', note: 'korábbi' });

  const esemenyek = CaseRepo.timeline(CaseRepo.get(ugy.id), {}, '2026-08-01')
    .filter(p => p.kind === 'esemeny');
  const napok = esemenyek.map(e => e.date);
  assertEq(napok.join(','), '2026-07-01,2026-07-10,2026-07-25',
    'a rögzítés sorrendjét mutatja a történés helyett');
});

atest('a lezárás dátuma is a történés napja', async () => {
  await tisztaAllapot();
  const emp = ujDolgozo();
  const ugy = CaseRepo.create({ employeeId: emp.id, type: 'rp_elso' });
  CaseRepo.setStatus(ugy.id, 'lezarva', { outcome: 'megadva', occurredAt: '2026-07-15' });

  assertEq(CaseRepo.get(ugy.id).closedAt, '2026-07-15',
    'a döntés napja helyett a rögzítés napját írta be');
});

atest('jövőbeli történés nem fogadható el', async () => {
  await tisztaAllapot();
  const emp = ujDolgozo();
  const ugy = CaseRepo.create({ employeeId: emp.id, type: 'rp_elso' });
  await assertThrows(() => CaseRepo.setStatus(ugy.id, 'beadva', { occurredAt: '2099-01-01' }),
    /nem lehet a jövőben/);
});

atest('elgépelt dátum utólag javítható, az audit-nyom viszont nem', async () => {
  await tisztaAllapot();
  const emp = ujDolgozo();
  const ugy = CaseRepo.create({ employeeId: emp.id, type: 'rp_elso' });
  CaseRepo.setStatus(ugy.id, 'beadva', { occurredAt: '2026-07-02', note: 'beadva' });

  const eredetiAt = CaseRepo.get(ugy.id).events[1].at;
  CaseRepo.updateEvent(ugy.id, 1, { occurredAt: '2026-07-20', note: 'beadva (javított dátum)' });

  const e = CaseRepo.get(ugy.id).events[1];
  assertEq(e.occurredAt, '2026-07-20');
  assertEq(e.at, eredetiAt, 'a rögzítés ideje megváltozott – az audit-nyom sérült');
  assert(/javított/.test(e.note));
});

atest('a lezáró bejegyzés javítása a lezárás dátumát is viszi', async () => {
  await tisztaAllapot();
  const emp = ujDolgozo();
  const ugy = CaseRepo.create({ employeeId: emp.id, type: 'rp_elso' });
  CaseRepo.setStatus(ugy.id, 'lezarva', { outcome: 'megadva', occurredAt: '2026-07-15' });
  CaseRepo.updateEvent(ugy.id, 1, { occurredAt: '2026-07-18' });

  assertEq(CaseRepo.get(ugy.id).closedAt, '2026-07-18');
});

// ════════════════════════════════════════════════════════════════════════════
asection('Ügyek láncolása');

atest('az új engedély lejárata a dolgozó adatai közé is bekerül', async () => {
  await tisztaAllapot();
  const emp = EmployeeRepo.create({
    fields: { surname: 'Nagy', forename: 'Béla', expiration_of_rp: '2026-10-15' },
    identifiers: [{ type: 'residence_permit', value: 'RP-REGI' }],
  });
  const ugy = CaseRepo.create({ employeeId: emp.id, type: 'rp_hosszabbitas' });
  CaseRepo.setStatus(ugy.id, 'lezarva', { outcome: 'megadva' });
  CaseRepo.recordProducedIdentifier(ugy.id, { value: 'RP-UJ', expiresAt: '2028-10-15' });

  const u = EmployeeRepo.get(emp.id);
  assertEq(u.fields.expiration_of_rp, '2028-10-15', 'a régi lejárat maradt');
  assertEq(u.fields.number_of_rp, 'RP-UJ');
  assertEq(EmployeeRepo.currentIdentifier(u, 'residence_permit').validTo, '2028-10-15');
});

atest('a következő ügy az ÚJ engedély ablakából indul', async () => {
  await tisztaAllapot();
  const emp = EmployeeRepo.create({
    fields: { surname: 'Nagy', forename: 'Béla', expiration_of_rp: '2026-10-15' },
  });
  const ugy = CaseRepo.create({ employeeId: emp.id, type: 'rp_hosszabbitas' });
  CaseRepo.setStatus(ugy.id, 'lezarva', { outcome: 'megadva' });
  CaseRepo.recordProducedIdentifier(ugy.id, { value: 'RP-UJ', expiresAt: '2028-10-15' });

  const uj = CaseRepo.openNextCase(ugy.id);
  assertEq(uj.type, 'rp_hosszabbitas');
  // 2028-10-15 − 90 nap
  assertEq(uj.openedAt, '2028-07-17', 'nem az új ablak nyitónapjától indul');
  assertEq(uj.closedAt, null);

  const ablak = CaseTypes.submissionWindow('rp_hosszabbitas', EmployeeRepo.get(emp.id).fields);
  assertEq(ablak.final, '2028-10-05');
});

atest('lejárat ismerete nélkül nem lehet láncolni', async () => {
  await tisztaAllapot();
  const emp = ujDolgozo();
  const ugy = CaseRepo.create({ employeeId: emp.id, type: 'rp_hosszabbitas' });
  CaseRepo.setStatus(ugy.id, 'lezarva', { outcome: 'megadva' });
  CaseRepo.recordProducedIdentifier(ugy.id, { value: 'RP-UJ' });   // lejárat nélkül

  await assertThrows(() => CaseRepo.openNextCase(ugy.id), /Nem ismert az új engedély lejárata/);
});

atest('a kétszeri előjegyzés felismerhető', async () => {
  await tisztaAllapot();
  const emp = EmployeeRepo.create({
    fields: { surname: 'Nagy', forename: 'Béla', expiration_of_rp: '2028-10-15' },
  });
  assertEq(CaseRepo.hasOpenCaseOfType(emp.id, 'rp_hosszabbitas'), false);
  CaseRepo.create({ employeeId: emp.id, type: 'rp_hosszabbitas' });
  assertEq(CaseRepo.hasOpenCaseOfType(emp.id, 'rp_hosszabbitas'), true);
});

// ════════════════════════════════════════════════════════════════════════════
asection('Napi összefoglaló');

atest('a lejárt, sürgős és nyitott ügyek megszámolása', async () => {
  await tisztaAllapot();
  const emp = ujDolgozo();
  const MA = '2026-08-08';
  CaseRepo.create({ employeeId: emp.id, type: 'rp_elso', dueAt: '2026-08-01' }); // lejárt
  CaseRepo.create({ employeeId: emp.id, type: 'rp_elso', dueAt: '2026-08-15' }); // sürgős
  CaseRepo.create({ employeeId: emp.id, type: 'rp_elso', dueAt: '2026-12-01' }); // nyugodt
  const z = CaseRepo.create({ employeeId: emp.id, type: 'rp_elso', dueAt: '2026-08-01' });
  CaseRepo.setStatus(z.id, 'lezarva', { outcome: 'megadva' });

  const s = CaseRepo.summary(MA);
  assertEq(s.lejart, 1);
  assertEq(s.surgos, 1);
  assertEq(s.nyitott, 3, 'a lezárt is beleszámított');
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
