'use strict';

// A naplózó tesztjei. Futtatás: node test/logger.test.js
//
// A legfontosabb itt nem a formázás, hanem a védőkorlát: a napló `context`
// mezője állapot-pillanatképet tartalmazhat, abban személyes adattal. Ezért
// a naplózóból SEMMI nem mehet ki hálózatra — ezt géppel őrizzük, nem
// emlékezetből. (Az örökölt változat egy helyi PDF-szerverre POST-olt.)

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
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function section(n) { console.log(`\n[${n}]`); }

const SRC = fs.readFileSync(path.join(__dirname, '../js/logger.js'), 'utf8');

// ── Betöltés sandboxban ─────────────────────────────────────────────────────
const kiirt = [];
const sandbox = {
  console: {
    log:   (...a) => kiirt.push(['log',   a[0]]),
    warn:  (...a) => kiirt.push(['warn',  a[0]]),
    error: (...a) => kiirt.push(['error', a[0]]),
  },
  Date, JSON, Error, String, Number, Object, Array, Set, Map,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(SRC + '\nglobalThis.BevLogger = BevLogger;', sandbox, { filename: 'logger.js' });
const L = sandbox.BevLogger;

// ════════════════════════════════════════════════════════════════════════════
section('Adatvédelmi korlát: a napló nem hagyja el a gépet');

test('nincs hálózati szállítás a forrásban', () => {
  const talalat = SRC.match(/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource)\b/g);
  assert(!talalat, `hálózati hívás került a naplózóba: ${talalat && talalat.join(', ')}`);
});

test('nincs szerver-végpont a forrásban', () => {
  assert(!/https?:\/\//.test(SRC), 'URL került a naplózóba');
});

// ════════════════════════════════════════════════════════════════════════════
section('Naplózás működése');

test('a bejegyzés visszaolvasható a dump()-ból', () => {
  L.init('teszt-fiok');
  L.info('PROBA', 'sima bejegyzés');
  L.error('PROBA_HIBA', 'hibás bejegyzés', 'stack-részlet', 'ctx=valami');
  const d = L.dump();
  assert(d.includes('sima bejegyzés'), 'hiányzik az info bejegyzés');
  assert(d.includes('hibás bejegyzés'), 'hiányzik a hiba bejegyzés');
  assert(d.includes('ctx=valami'), 'hiányzik a context');
});

test('a szint szerinti konzol-csatorna helyes', () => {
  assert(kiirt.some(([t, m]) => t === 'error' && /PROBA_HIBA/.test(m)), 'a HIBA nem console.error-ra ment');
  assert(kiirt.some(([t, m]) => t === 'log'   && /PROBA:/.test(m)),     'az INFO nem console.log-ra ment');
});

test('a puffer korlátos, hosszú munkamenet sem eszi a memóriát', () => {
  for (let i = 0; i < 600; i++) L.info('TOMEG', 'bejegyzés ' + i);
  const sorok = L.dump().split('\n').filter(s => /^\d{4}-\d{2}-\d{2}T/.test(s)).length;
  assert(sorok <= 500, `a puffer túlcsordult: ${sorok} bejegyzés`);
  assert(L.dump().includes('bejegyzés 599'), 'a legújabb bejegyzés kiesett');
});

test('a naplózás sosem dob, akkor sem ha az adat hibás', () => {
  const korkoros = {}; korkoros.self = korkoros;
  L.info('PROBA', 'körkörös', null, L.snapshot(korkoros)); // nem dobhat
  L.error('PROBA', null, undefined, undefined);
});

// ── Összegzés ───────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(60));
console.log(`Eredmény: ${passed} sikeres / ${failed} hibás (összesen ${passed + failed})`);
if (failed > 0) {
  console.log('\nHibás tesztek:');
  failures.forEach(f => console.log(`  - ${f.name}: ${f.error}`));
  process.exit(1);
}
console.log('Mind sikeres ✓');
process.exit(0);
