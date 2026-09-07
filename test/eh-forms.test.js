'use strict';

// Enter Hungary űrlapleírás tesztjei. Futtatás: node test/eh-forms.test.js
//
// Két dolgot őriz, amit másképp csak az EH-n, kitöltés közben vennénk észre –
// némán elutasított mezőként:
//   1. a leírás minden `key`-e létező sémamezőre mutat-e,
//   2. a cégadatok átmennek-e az EH SAJÁT `pattern`-jein.

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
vm.createContext(sandbox);

// A `setting:` sorok a Settings-bol jonnek; ahhoz localStorage kell.
const tarolo = new Map();
sandbox.localStorage = {
  getItem: k => (tarolo.has(k) ? tarolo.get(k) : null),
  setItem: (k, v) => tarolo.set(k, String(v)),
  removeItem: k => tarolo.delete(k),
};

for (const [rel, name] of [
  ['../js/schema/value-codec.js', 'ValueCodec'],
  ['../js/schema/seed-schema.js', 'SEED_SCHEMA'],
  ['../js/schema/schema-store.js', 'SchemaStore'],
  ['../js/schema/eh-forms.js', 'EhForms'],
  ['../js/services/settings-service.js', 'Settings'],
  ['../js/modules/cases/case-eh.js', 'CaseEh'],
]) {
  let code = fs.readFileSync(path.join(__dirname, rel), 'utf8');
  code += `\nglobalThis.${name} = ${name};`;
  vm.runInContext(code, sandbox, { filename: rel });
}
const { EhForms, SchemaStore, SEED_SCHEMA, Settings, CaseEh } = sandbox;
sandbox.EH_EMPLOYER = sandbox.EhForms.EMPLOYER;
const EMP = EhForms.EMPLOYER;

// A séma a kiinduló készletből – a leírás erre hivatkozik.
SchemaStore.loadFrom(JSON.parse(JSON.stringify(SEED_SCHEMA)));

const FO = EhForms._FO.filter(r => r.eh);
const BETET = EhForms._BETET.filter(r => r.eh);
const MIND = FO.concat(BETET);

// ── A leírás épsége ─────────────────────────────────────────────────────────
asection('Űrlapleírás');

atest('minden `key` létező, nem computed sémamező', () => {
  for (const r of MIND) {
    if (!r.key) continue;
    const f = SchemaStore.field(r.key);
    assert(f, `ismeretlen sémakulcs: ${r.key} (${r.eh})`);
    assert(f.type !== 'computed' || r.key === 'transport_type',
      `computed mezőre csak a transport_type hivatkozhat: ${r.key}`);
  }
});

atest('minden `fallback` létező sémamező', () => {
  for (const r of MIND) {
    if (!r.fallback) continue;
    assert(SchemaStore.field(r.fallback), `ismeretlen fallback: ${r.fallback}`);
  }
});

atest('minden `employer` útvonal értéket ad', () => {
  for (const r of MIND) {
    if (!r.employer) continue;
    const v = EhForms.employerValue(r.employer);
    assert(typeof v === 'string', `nem oldható fel: ${r.employer}`);
  }
});

atest('az `eh` nevek lapon belül egyediek', () => {
  for (const [nev, lista] of [['fő űrlap', FO], ['betétlap', BETET]]) {
    const latott = new Set();
    for (const r of lista) {
      assert(!latott.has(r.eh), `${nev}: ismétlődő eh név: ${r.eh}`);
      latott.add(r.eh);
    }
  }
});

atest('minden sornak van címkéje', () => {
  for (const r of MIND) assert(r.label && r.label.trim(), `nincs címke: ${r.eh}`);
});

// ── A másolható / listás szétválasztás ──────────────────────────────────────
asection('Másolható vs. listás');

atest('`max` csak másolható soron van, `list` mellett soha', () => {
  for (const r of MIND) {
    if (r.max) assert(!r.list, `listás soron nincs értelme a max-nak: ${r.eh}`);
  }
});

atest('a fő űrlapon 29 másolható és 10 listás DB-s mező van', () => {
  const dbs = FO.filter(r => r.key);
  // A 29. a hozzátartozó-sor (`hr_children`): az EH nyolcszor 19 rovatot kér,
  // a DB egy szabad szöveget tárol. Másolhatónak hagyjuk – a szétbontás kézi,
  // de a nyers szöveg vágólapra tehető.
  assertEq(dbs.filter(r => !r.list).length, 29, 'másolható DB-s mező');
  assertEq(dbs.filter(r => r.list).length, 10, 'listás DB-s mező');
});

atest('a jogcím-szűrés kihagyja az idegen sorokat', () => {
  const c9 = EhForms.rows('c9').filter(r => r.eh);
  assert(!c9.some(r => r.eh === 'foglkoztatotip'), 'c7-only sor a c9-en');
  assert(!c9.some(r => r.eh === 'okmanyatvetelhelye'), 'c12-only sor a c9-en');
  assert(c9.some(r => r.eh === 'mentessegmpiac'), 'a c7/c9 közös sor hiányzik');

  const c12 = EhForms.rows('c12').filter(r => r.eh);
  assert(c12.some(r => r.eh === 'okmanyatvetelhelye'), 'c12-only sor hiányzik');
  assert(!c12.some(r => r.eh === 'mentessegmpiac'), 'c7/c9-only sor a c12-n');
});

atest('jogcím nélkül csak a fő űrlap jön', () => {
  assertEq(EhForms.rows('').filter(r => r.eh).length, FO.length);
});

// ── Beállításból jövő sorok ─────────────────────────────────────────────────
asection('Beállításból jövő elérhetőség');

// Az „Az okmány átvétele" panel e-mail/telefon rovata az ÜGYINTÉZŐÉ, nem a
// munkavállalóé — a Beállítások fülről jön. Ha a sor `setting:` neve és a
// `Settings.ehContact()` kulcsai elcsúsznak, a panel némán üreset másolna.
atest('minden `setting` név értéket ad a Beállításokból', () => {
  const c = Settings.ehContact();
  const sorok = MIND.filter(r => r.setting);
  assert(sorok.length, 'nincs `setting:` sor — elmaradt a bekötés?');
  for (const r of sorok) {
    assert(c[r.setting], `a Settings.ehContact() nem ismeri: ${r.setting} (${r.eh})`);
  }
});

atest('a mentett érték felülírja az alapértelmezettet, az üres üres marad', () => {
  Settings.setEhContact({ email: 'a@b.hu', telefon: '' });
  assertEq(Settings.ehContact().email, 'a@b.hu');
  assertEq(Settings.ehContact().telefon, '');
  Settings.remove('eh_contact');
  assertEq(Settings.ehContact().email, Settings.EH_CONTACT_DEFAULT.email);
});

// ── Kézi sorok elrejtése ────────────────────────────────────────────────────
asection('Kézi sorok elrejtése');

// A ~180 sorból 77 kézi: mögöttük nincs adat, a panel nem tud rájuk semmit
// adni. Elrejtve viszont könnyű üresen hagyni egy PANELCÍMET – az félkésznek
// látszik. A szűrés hátulról előre megy, ezért érdemes rögzíteni, mit ad.
atest('a kézi sorok kimaradnak, a többi sorrendje marad', () => {
  const mind = EhForms.rows('c7');
  const latszik = CaseEh._lathatoSorok(mind);
  assert(!latszik.some(r => r.manual), 'kézi sor maradt a listában');
  const varhato = mind.filter(r => !r.panel && !r.manual);
  assertEq(JSON.stringify(latszik.filter(r => !r.panel).map(r => r.eh)),
           JSON.stringify(varhato.map(r => r.eh)), 'az adatsorok sorrendje');
});

atest('nem marad üres panelcím', () => {
  const latszik = CaseEh._lathatoSorok(EhForms.rows('c7'));
  latszik.forEach((r, i) => {
    if (!r.panel) return;
    const kov = latszik[i + 1];
    assert(kov && !kov.panel, `üresen maradt panel: ${r.panel}`);
  });
  assert(latszik.length, 'minden sor eltűnt');
});

atest('kézi sor nélküli listán semmit nem vesz el', () => {
  const be = [{ panel: 'P' }, { eh: 'a', key: 'surname' }, { eh: 'b', const: 'x' }];
  assertEq(CaseEh._lathatoSorok(be).length, 3);
});

// ── Cégadat: átmegy-e az EH saját validációján ──────────────────────────────
asection('Cégadat EH-alakban');

// A minták a mentett c7 lap `pattern` attribútumaiból származnak, szó szerint.
atest('KSH-szám: SZÓKÖZÖS alak (a cégkivonat kötőjelest ír)', () => {
  const pattern = /^\d\d\d\d\d\d\d\d \d\d\d\d \d\d\d [012]\d$/;
  assert(pattern.test(EMP.kshszam), `nem felel meg az EH mintájának: ${EMP.kshszam}`);
  // Ellenpróba: ha a kötőjeles alak is átmenne, felesleges lenne az átírás.
  assert(!pattern.test('10518869-2611-113-19'), 'a kötőjeles alaknak buknia kell');
});

atest('adószám: KÖTŐJELES alak', () => {
  const pattern = /^(\d{10}|(\d{8}[-]\d[-]\d\d))$/;
  assert(pattern.test(EMP.adoszam), `nem felel meg az EH mintájának: ${EMP.adoszam}`);
});

atest('rövid cégnév belefér az EH 40 karakterébe', () => {
  assert(EMP.nev.length <= 40, `${EMP.nev.length} karakter`);
  // A teljes cégnév nem férne bele – ezért a rövidített alak a helyes.
  assert('AUMOVIO Hungary Korlátolt Felelősségű Társaság'.length > 40);
});

atest('a székhely mezői beleférnek a hossz-korlátokba', () => {
  const sz = EMP.szekhely;
  assert(sz.telepules.length <= 27, 'település max 27');
  assert(sz.kozteruletneve.length <= 25, 'közterület neve max 25');
  assert(sz.hazszam.length <= 8, 'házszám max 8 (foglszekhelyhazszam)');
  assert(/^[0-9]+$/.test(sz.iranyitoszam), 'irányítószám csak számjegy');
  const isz = Number(sz.iranyitoszam);
  assert(isz >= 1011 && isz <= 9999, 'irányítószám az EH min/max-án belül');
});

atest('a közterület neve a JELLEG NÉLKÜL áll', () => {
  assert(!/\b(út|utca|tér|körút)\b/i.test(EMP.szekhely.kozteruletneve),
    'a jelleg külön rovat az EH-n');
  assert(!/\b(út|utca|tér|körút)\b/i.test(EMP.munkavegzes.kozteruletneve));
});

atest('a levelezési cím a munkavégzés helyére mutat (nem másolat)', () => {
  assertEq(EhForms.employerValue('levelezesi.telepules'), 'Budapest');
  assertEq(EhForms.employerValue('levelezesi.kerulet'), 'X.');
  assertEq(EhForms.employerValue('levelezesi.hazszam'), EMP.munkavegzes.hazszam);
});

// ── Dátum: az EH ÉÉÉÉ-HH-NN-t kér ───────────────────────────────────────────
asection('Dátumok');

atest('a séma dátummezőit a panel nyersen adja, nem magyar alakban', () => {
  // A `resolveValues` magyar alakra formáz (1988.04.12.) – az EH viszont
  // ÉÉÉÉ-HH-NN-t vár. A case-eh.js ezért a nyers értéket használja; itt azt
  // rögzítjük, hogy a kettő tényleg különbözik, vagyis a kivétel indokolt.
  const v = SchemaStore.resolveValues({ date_of_birth: '1988-04-12' }, 'hu');
  assert(v.date_of_birth !== '1988-04-12',
    'ha ez már nem formáz, a case-eh.js dátum-kivétele elhagyható');
  assertEq(v.date_of_birth, '1988.04.12.');
});

atest('a dátum-sorok mind létező date típusú mezőre mutatnak', () => {
  const datumok = ['expiration_of_rp', 'date_of_birth', 'pp_issuance_date',
                   'pp_validity', 'employment_start', 'employment_end'];
  for (const k of datumok) {
    const hasznalt = MIND.some(r => r.key === k);
    if (!hasznalt) continue;
    assertEq(SchemaStore.field(k).type, 'date', `${k} típusa`);
  }
});

// ── Mentés-védelem ──────────────────────────────────────────────────────────
asection('Szerkesztés védelme');

// Miért itt: a panel helyben szerkeszthető, és az `EmployeeRepo.update`
// validációja CSAK az azonosítókat nézi (egyediség, üres érték). A „kötelező",
// a dátumformátum és az enum-értékek a SchemaStore-ban élnek — ezért a
// case-eh.js a mentés előtt külön hívja a `validateValues`-t. Ha ez a
// munkamegosztás megváltozik, ezek a tesztek buknak, és nem az éles adat.

atest('a séma elkapja a kötelező mező üresre törlését', () => {
  const gond = SchemaStore.validateValues({ surname: '', forename: 'Juan' })
    .find(p => p.key === 'surname');
  assert(gond, 'a surname kötelező, üresen hibát kell adnia');
});

atest('a séma elkapja a rossz dátumformátumot', () => {
  const gond = SchemaStore.validateValues({ expiration_of_rp: '2026.11.30' })
    .find(p => p.key === 'expiration_of_rp');
  assert(gond, 'az ÉÉÉÉ-HH-NN-től eltérő alakot el kell utasítani');
  const jo = SchemaStore.validateValues({ expiration_of_rp: '2026-11-30' })
    .find(p => p.key === 'expiration_of_rp');
  assert(!jo, 'a helyes alaknak át kell mennie');
});

atest('érvényes érték nem akad fenn', () => {
  const gond = SchemaStore.validateValues({ locality: 'Budapest' })
    .find(p => p.key === 'locality');
  assert(!gond);
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
