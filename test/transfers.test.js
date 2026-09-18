'use strict';

// Az eljárási díjak átutalási naplójának tesztjei.
// Futtatás: node test/transfers.test.js
//
// A súlypont három helyen van, mert ez a három dolog kerül pénzbe:
//   – a közlemény pontosan az legyen, amit a bank elfogad;
//   – a dupla fizetés kiderüljön, mielőtt megtörténik;
//   – a napló akkor is megmaradjon, ha a sort vagy a köteget törlik.

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
function assertThrows(fn, m) {
  try { fn(); } catch { return; }
  throw new Error(m || 'nem dobott hibát');
}
function section(n) { console.log(`\n[${n}]`); }

// ── Réteg betöltése ─────────────────────────────────────────────────────────
const sandbox = {
  console, Date, Math, JSON, Set, Map, Object, Array, String, Number, Boolean,
  Error, RegExp, Promise, isNaN, parseInt, parseFloat, crypto, setTimeout, clearTimeout,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const [rel, name] of [
  ['../js/services/employee-repo.js',  'EmployeeRepo'],
  ['../js/schema/value-codec.js',      'ValueCodec'],
  ['../js/schema/seed-schema.js',      'SEED_SCHEMA'],
  ['../js/schema/schema-store.js',     'SchemaStore'],
  ['../js/services/transfer-repo.js',  'TransferRepo'],
]) {
  const code = fs.readFileSync(path.join(__dirname, rel), 'utf8') + `\nglobalThis.${name} = ${name};`;
  vm.runInContext(code, sandbox, { filename: rel });
}
const { TransferRepo: Repo, SchemaStore, SEED_SCHEMA } = sandbox;
SchemaStore.loadFrom(SEED_SCHEMA);

// ── Próbaadat ───────────────────────────────────────────────────────────────
const UGY = {
  id: 'ugy-1', employeeId: 'dolg-1',
  ehNumber: 'EH16262629', fileNumber: '',
};
const DOLGOZO = {
  id: 'dolg-1',
  fields: {
    surname: 'Kőműves', forename: 'Győző',
    personnel_reg_number: '01234',
    date_of_birth: '1996-04-23',
    citizenship: 'magyar',
  },
};

function jóSor(extra = {}) {
  return Object.assign(Repo.rowFromCase(UGY, DOLGOZO, { amount: 26000, handler: 'Horváth D' }), extra);
}

async function frissRepo() {
  Repo.useBackend(Repo.createMemoryBackend());
  await Repo.load();
}

(async () => {

  section('Köteg életciklusa');

  await test('Az első nyitott köteg magától létrejön, a második hívás ugyanazt adja', async () => {
    await frissRepo();
    const a = Repo.openBatch();
    const b = Repo.openBatch();
    assertEq(a.id, b.id, 'két párhuzamos nyitott köteg keletkezett');
    assertEq(Repo.all().length, 1);
    assertEq(a.status, Repo.STATUS.ELOKESZITES);
  });

  await test('A címke naponta újraszámozódik', async () => {
    await frissRepo();
    const a = Repo.createBatch();
    const b = Repo.createBatch();
    assert(a.label.endsWith('/1'), a.label);
    assert(b.label.endsWith('/2'), b.label);
  });

  await test('Kifizetés után a köteg nem nyitott, és van dátuma', async () => {
    await frissRepo();
    const b = Repo.openBatch();
    Repo.addRow(b.id, jóSor());
    Repo.markPaid(b.id, '2026-09-18');
    assertEq(Repo.get(b.id).status, Repo.STATUS.KIFIZETVE);
    assertEq(Repo.get(b.id).paidOn, '2026-09-18');
    assertEq(Repo.isOpen(Repo.get(b.id)), false);
  });

  await test('Üres köteget nem lehet kifizetettnek jelölni', async () => {
    await frissRepo();
    const b = Repo.openBatch();
    assertThrows(() => Repo.markPaid(b.id, '2026-09-18'), 'üres köteget kifizetettnek jelölt');
  });

  await test('A rossz alakú dátumot visszautasítja', async () => {
    await frissRepo();
    const b = Repo.openBatch();
    Repo.addRow(b.id, jóSor());
    assertThrows(() => Repo.markPaid(b.id, '2026.09.18'), 'elfogadta a pontos dátumformát');
    assertThrows(() => Repo.markPaid(b.id, 'ma'), 'elfogadta a szöveget');
  });

  section('Pillanatkép az ügyből');

  await test('Az ügy és a dolgozó adatai átkerülnek a tételbe', async () => {
    await frissRepo();
    const r = Repo.rowFromCase(UGY, DOLGOZO, { amount: 26000, handler: 'Horváth D' });
    assertEq(r.name, 'Kőműves Győző');
    assertEq(r.personnelNo, '01234');
    assertEq(r.dob, '1996-04-23');
    assertEq(r.nationality, 'magyar');
    assertEq(r.identifier, 'EH16262629');
    assertEq(r.caseId, 'ugy-1');
    assertEq(r.employeeId, 'dolg-1');
  });

  await test('EH szám híján az iktatószám lesz az azonosító', async () => {
    const r = Repo.rowFromCase({ id: 'u2', employeeId: 'd', ehNumber: '', fileNumber: '106-2-12545/2025-T' }, DOLGOZO);
    assertEq(r.identifier, '106-2-12545/2025-T');
  });

  await test('A pillanatkép nem változik, ha a dolgozó adata utólag módosul', async () => {
    await frissRepo();
    const b = Repo.openBatch();
    const r = Repo.addRow(b.id, jóSor());
    DOLGOZO.fields.surname = 'Kovács';          // a nyilvántartásban javítanak
    assertEq(Repo.getRow(b.id, r.id).name, 'Kőműves Győző', 'a kifizetett tétel visszamenőleg megváltozott');
    DOLGOZO.fields.surname = 'Kőműves';
  });

  await test('Kérésre viszont frissíthető az ügyből', async () => {
    await frissRepo();
    const b = Repo.openBatch();
    const r = Repo.addRow(b.id, jóSor());
    DOLGOZO.fields.surname = 'Kovács';
    Repo.refreshRow(b.id, r.id, UGY, DOLGOZO);
    assertEq(Repo.getRow(b.id, r.id).name, 'Kovács Győző');
    assertEq(Repo.getRow(b.id, r.id).amount, 26000, 'a frissítés felülírta az összeget');
    DOLGOZO.fields.surname = 'Kőműves';
  });

  section('Közlemény — ezt olvassa a bank');

  await test('A munkafüzet képletével azonos alakú', async () => {
    assertEq(Repo.reference(jóSor()), 'Kőműves Győző 1996-04-23 EH16262629');
  });

  await test('Hiányos adatnál üres, nem féloldalas', async () => {
    assertEq(Repo.reference(jóSor({ identifier: '' })), '');
    assertEq(Repo.reference(jóSor({ dob: '' })), '');
    assertEq(Repo.reference(null), '');
  });

  await test('A 96 karakteres korlát túllépése hibaként jelenik meg', async () => {
    const hosszu = jóSor({ name: 'A'.repeat(90) });
    assert(Repo.reference(hosszu).length > Repo.MAX_REF_LEN);
    assert(Repo.rowIssues(hosszu).some(h => h.includes('közlemény')), 'nem jelezte a hosszú közleményt');
  });

  section('Ellenőrzés — a makró DataIssues-ának megfelelője');

  await test('A hibátlan sornak nincs kifogása', async () => {
    assertEq(Repo.rowIssues(jóSor()).length, 0, JSON.stringify(Repo.rowIssues(jóSor())));
  });

  await test('Az összeg csak 26 000 vagy 47 000 lehet', async () => {
    assertEq(Repo.rowIssues(jóSor({ amount: 47000 })).length, 0);
    assert(Repo.rowIssues(jóSor({ amount: 30000 })).some(h => h.includes('összeg')));
    assert(Repo.rowIssues(jóSor({ amount: 0 })).some(h => h.includes('összeg')));
  });

  await test('Az azonosító formátuma kötött', async () => {
    assertEq(Repo.rowIssues(jóSor({ identifier: 'EH12345678' })).length, 0);
    assertEq(Repo.rowIssues(jóSor({ identifier: '106-2-12545/2025-T' })).length, 0);
    assertEq(Repo.rowIssues(jóSor({ identifier: '106-2-1/2025-T' })).length, 0);
    assert(Repo.rowIssues(jóSor({ identifier: 'EH123' })).some(h => h.includes('azonosító')));
    assert(Repo.rowIssues(jóSor({ identifier: 'valami' })).some(h => h.includes('azonosító')));
  });

  await test('A személyi szám legfeljebb 5 számjegy', async () => {
    assertEq(Repo.rowIssues(jóSor({ personnelNo: '1' })).length, 0);
    assert(Repo.rowIssues(jóSor({ personnelNo: '123456' })).some(h => h.includes('személyi')));
    assert(Repo.rowIssues(jóSor({ personnelNo: 'abc' })).some(h => h.includes('személyi')));
    assert(Repo.rowIssues(jóSor({ personnelNo: '' })).some(h => h.includes('személyi')));
  });

  await test('A hiányzó törzsadatokat egyenként jelzi', async () => {
    assert(Repo.rowIssues(jóSor({ dob: '' })).some(h => h.includes('születési')));
    assert(Repo.rowIssues(jóSor({ nationality: '' })).some(h => h.includes('állampolgárság')));
    assert(Repo.rowIssues(jóSor({ handler: '' })).some(h => h.includes('ügyintéző')));
  });

  section('Dupla fizetés elleni védelem');

  await test('Ugyanaz az azonosító kétszer a kötegben: jelzés', async () => {
    await frissRepo();
    const b = Repo.openBatch();
    Repo.addRow(b.id, jóSor());
    Repo.addRow(b.id, jóSor());
    const hibak = Repo.batchIssues(b.id);
    assertEq(hibak.length, 2, 'nem mindkét sort jelölte meg');
    assert(hibak[0].hibak.some(h => h.includes('többször')), JSON.stringify(hibak[0]));
  });

  await test('Korábbi KIFIZETETT kötegben szereplő azonosító: jelzés', async () => {
    await frissRepo();
    const regi = Repo.openBatch();
    Repo.addRow(regi.id, jóSor());
    Repo.markPaid(regi.id, '2026-09-01');

    const uj = Repo.createBatch();
    Repo.addRow(uj.id, jóSor());
    const hibak = Repo.batchIssues(uj.id);
    assertEq(hibak.length, 1);
    assert(hibak[0].hibak.some(h => h.includes('már ki lett fizetve')), JSON.stringify(hibak[0]));
  });

  await test('Előkészítés alatti másik köteg NEM számít kifizetettnek', async () => {
    await frissRepo();
    const a = Repo.createBatch();
    Repo.addRow(a.id, jóSor());
    const b = Repo.createBatch();
    Repo.addRow(b.id, jóSor());
    assertEq(Repo.batchIssues(b.id).length, 0, 'előkészítés alatti kötegre is dupla fizetést jelzett');
  });

  await test('A saját köteg nem jelzi magára a kifizetettséget', async () => {
    await frissRepo();
    const b = Repo.openBatch();
    Repo.addRow(b.id, jóSor());
    Repo.markPaid(b.id, '2026-09-18');
    assertEq(Repo.batchIssues(b.id).length, 0, 'a köteg saját magára jelzett duplát');
  });

  await test('caseInAnyBatch megmondja, hol szerepel már az ügy', async () => {
    await frissRepo();
    const b = Repo.openBatch();
    Repo.addRow(b.id, jóSor());
    const hol = Repo.caseInAnyBatch('ugy-1');
    assert(hol && hol.batchId === b.id, 'nem találta meg a kötegben lévő ügyet');
    assertEq(Repo.caseInAnyBatch('nincs-ilyen'), null);
  });

  section('Napló — ez a visszakövethetőség');

  await test('A köteg és a tétel létrehozása is bekerül', async () => {
    await frissRepo();
    const b = Repo.openBatch();
    Repo.addRow(b.id, jóSor());
    const napló = Repo.audit();
    assert(napló.some(a => a.action === 'batch.create'), 'nincs batch.create');
    assert(napló.some(a => a.action === 'row.add'), 'nincs row.add');
  });

  await test('A módosítás mezőnként, előtte-utána értékkel naplózódik', async () => {
    await frissRepo();
    const b = Repo.openBatch();
    const r = Repo.addRow(b.id, jóSor());
    Repo.updateRow(b.id, r.id, { amount: 47000 });
    const be = Repo.audit().find(a => a.action === 'row.update');
    assert(be, 'nincs row.update bejegyzés');
    assertEq(be.field, 'amount');
    assertEq(be.before, 26000);
    assertEq(be.after, 47000);
  });

  await test('A változatlan érték nem szemetel a naplóba', async () => {
    await frissRepo();
    const b = Repo.openBatch();
    const r = Repo.addRow(b.id, jóSor());
    const elotte = Repo.audit().length;
    Repo.updateRow(b.id, r.id, { amount: 26000, name: 'Kőműves Győző' });
    assertEq(Repo.audit().length, elotte, 'azonos érték is naplóbejegyzést csinált');
  });

  await test('A TÖRLÉS is nyomot hagy — a sorral együtt nem tűnik el', async () => {
    await frissRepo();
    const b = Repo.openBatch();
    const r = Repo.addRow(b.id, jóSor());
    Repo.removeRow(b.id, r.id);
    assertEq(Repo.get(b.id).rows.length, 0);
    const be = Repo.audit().find(a => a.action === 'row.remove');
    assert(be, 'a törlésről nincs napló');
    assert(String(be.before).includes('EH16262629'), `a törölt tétel adata nincs a naplóban: ${be.before}`);
  });

  await test('A köteg törlése után is megvan a napló', async () => {
    await frissRepo();
    const b = Repo.openBatch();
    Repo.addRow(b.id, jóSor());
    Repo.destroyBatch(b.id);
    assertEq(Repo.all().length, 0);
    const be = Repo.audit().find(a => a.action === 'batch.destroy');
    assert(be, 'a köteg törléséről nincs napló');
    assert(String(be.before).includes('1 tétel'), be.before);
  });

  await test('A naplóba mindig kerül felhasználó és időpont', async () => {
    await frissRepo();
    Repo.openBatch();
    const be = Repo.audit()[0];
    assert(be.user, 'nincs felhasználó');
    assert(/^\d{4}-\d{2}-\d{2}T/.test(be.at), `rossz időbélyeg: ${be.at}`);
  });

  await test('Kötegre szűrve csak a saját bejegyzései jönnek', async () => {
    await frissRepo();
    const a = Repo.createBatch();
    const b = Repo.createBatch();
    Repo.addRow(a.id, jóSor());
    const csakB = Repo.audit({ batchId: b.id });
    assertEq(csakB.length, 1, 'idegen bejegyzés szivárgott be');
    assertEq(csakB[0].action, 'batch.create');
  });

  section('Tárolás');

  await test('Mentés után visszatöltve minden megvan', async () => {
    const hatter = Repo.createMemoryBackend();
    Repo.useBackend(hatter);
    await Repo.load();
    const b = Repo.openBatch();
    Repo.addRow(b.id, jóSor());
    Repo.markPaid(b.id, '2026-09-18');
    await Repo.save();

    Repo.useBackend(hatter);
    await Repo.load();
    const vissza = Repo.all();
    assertEq(vissza.length, 1);
    assertEq(vissza[0].rows.length, 1);
    assertEq(vissza[0].paidOn, '2026-09-18');
    assertEq(vissza[0].rows[0].name, 'Kőműves Győző');
    assert(Repo.audit().length >= 3, 'a napló nem élte túl a mentést');
  });

  await test('Üres tárolóból üres nyilvántartás indul, nem hiba', async () => {
    Repo.useBackend(Repo.createMemoryBackend());
    assertEq(await Repo.load(), 0);
    assertEq(Repo.all().length, 0);
  });

  await test('Régi alakú rekord is betöltődik — hiányzó mező nem hiba', async () => {
    Repo.useBackend(Repo.createMemoryBackend({
      version: 1, batches: [{ rows: [{ name: 'Régi Elek' }] }],
    }));
    await Repo.load();
    const b = Repo.all()[0];
    assert(b.id, 'nem kapott azonosítót');
    assertEq(b.status, Repo.STATUS.ELOKESZITES);
    assertEq(b.rows[0].amount, 0);
    assertEq(b.rows[0].identifier, '');
  });

  await test('Betöltés nélkül minden művelet érthető hibát ad', async () => {
    Repo.useBackend(Repo.createMemoryBackend());
    assertThrows(() => Repo.all(), 'betöltés nélkül is válaszolt');
  });

  await test('Az összeg összegzése köteg szinten helyes', async () => {
    await frissRepo();
    const b = Repo.openBatch();
    Repo.addRow(b.id, jóSor());
    Repo.addRow(b.id, jóSor({ identifier: 'EH99999999', amount: 47000 }));
    assertEq(Repo.total(Repo.get(b.id)), 73000);
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
