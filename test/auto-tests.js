'use strict';

// BEVapp Automatizált Tesztek — Node-alapú
// Futtatás: node test/auto-tests.js
//
// Lefedi azokat a logikai funkciókat, amelyek nem igényelnek DOM-ot
// vagy aktív böngészőt. A DOM-igényes részekhez static-analysis grep.
// Exit code: 0 = mind sikeres, 1 = legalább 1 hibás teszt.

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

let passed = 0, failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
    failed++;
    failures.push({ name, error: e.message });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'assertEq'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function section(name) {
  console.log(`\n[${name}]`);
}

// ── Sandbox helper a böngésző-stílusú modulokhoz ────────────────────────────
// A modulok `const FooModule = (() => { ... })()` formátumúak. A const NEM kerül
// automatikusan a sandbox globaljába; expose-olnunk kell. Detektáljuk a top-level
// const deklarációkat és kézzel kibontjuk a sandbox-ba.
function loadInSandbox(filePath, extraGlobals = {}) {
  let code = fs.readFileSync(filePath, 'utf8');

  // Detektáljuk a top-level `const Name = (...)` mintát és appendoljuk az expose-t.
  // Pl. `const BevLogger = (() => { ... })();` → globalThis.BevLogger = BevLogger;
  const constMatches = [...code.matchAll(/^const\s+([A-Z][A-Za-z0-9_]+)\s*=/gm)];
  const exposeNames = constMatches.map(m => m[1]);

  const exposeCode = exposeNames.map(n => `globalThis.${n} = ${n};`).join('\n');
  if (exposeCode) code += '\n\n// AUTO-EXPOSE FOR TESTS\n' + exposeCode + '\n';

  const sandbox = Object.assign({
    console,
    Date, Math, JSON, Set, Map, Object, Array, String, Number, Boolean,
    Error, RegExp, Symbol, Promise,
    setTimeout, clearTimeout, setInterval, clearInterval,
    window: {},
    document: { querySelector: () => null, getElementById: () => null },
    location: { href: '' },
    fetch: () => Promise.resolve({ ok: true, text: () => Promise.resolve('') }),
    URL,
    encodeURIComponent, decodeURIComponent,
  }, extraGlobals);
  sandbox.global = sandbox;
  sandbox.self   = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: filePath });
  return sandbox;
}

// ════════════════════════════════════════════════════════════════════════════
// P3 — BevLogger (logger.js)
// ════════════════════════════════════════════════════════════════════════════
section('P3: BevLogger API + funkcionális');

let bevLoggerSandbox;
test('logger.js betölthető Node sandbox-ban', () => {
  bevLoggerSandbox = loadInSandbox(path.join(__dirname, '../js/logger.js'));
  assert(typeof bevLoggerSandbox.BevLogger === 'object', 'BevLogger nincs exportálva');
});

test('BevLogger.init, log, error, warn, info, debug, snapshot, initGlobalHandlers léteznek', () => {
  const b = bevLoggerSandbox.BevLogger;
  ['init', 'log', 'error', 'warn', 'info', 'debug', 'snapshot', 'initGlobalHandlers'].forEach(m => {
    assert(typeof b[m] === 'function', `BevLogger.${m} nem függvény`);
  });
});

test('BevLogger.snapshot serializálja a Set-et és Map-et', () => {
  const b = bevLoggerSandbox.BevLogger;
  const result = b.snapshot({ s: new Set([1, 2, 3]), m: new Map([['a', 1]]) });
  const parsed = JSON.parse(result);
  assert(Array.isArray(parsed.s) && parsed.s.length === 3, 'Set nem lett array');
  assert(parsed.m.a === 1, 'Map nem lett objektum');
});

test('BevLogger.snapshot nem dobja meg circular reference esetén', () => {
  const b = bevLoggerSandbox.BevLogger;
  const obj = { foo: 'bar' };
  obj.self = obj;
  const result = b.snapshot(obj);
  assert(typeof result === 'string', 'snapshot nem string circular esetén');
});

test('BevLogger fetch hívja a /log endpoint-ot', () => {
  let captured = null;
  const sb = loadInSandbox(path.join(__dirname, '../js/logger.js'), {
    fetch: (url, opts) => {
      captured = { url, body: opts && opts.body };
      return Promise.resolve({ ok: true });
    },
  });
  sb.BevLogger.init('test-user');
  sb.BevLogger.info('TEST_CAT', 'üzenet', 'tech-info', 'kontextus');
  assert(captured && captured.url.endsWith('/log'), 'POST /log nem hívódott');
  const body = JSON.parse(captured.body);
  assertEq(body.user, 'test-user');
  assertEq(body.level, 'INFO');
  assertEq(body.category, 'TEST_CAT');
  assertEq(body.human, 'üzenet');
});

test('BevLogger _trunc levágja a hosszú üzeneteket', () => {
  let captured = null;
  const sb = loadInSandbox(path.join(__dirname, '../js/logger.js'), {
    fetch: (url, opts) => { captured = JSON.parse(opts.body); return Promise.resolve({ ok: true }); },
  });
  const longStr = 'x'.repeat(3000);
  sb.BevLogger.error('CAT', longStr, longStr, longStr);
  assert(captured.human.length < 1000, `human nem rövidítve: ${captured.human.length}`);
  assert(captured.tech.length < 2000, `tech nem rövidítve: ${captured.tech.length}`);
  assert(captured.human.includes('… [+'), 'truncate marker hiányzik');
});

test('BevLogger auto stack-trace, ha nincs explicit tech', () => {
  let captured = null;
  const sb = loadInSandbox(path.join(__dirname, '../js/logger.js'), {
    fetch: (url, opts) => { captured = JSON.parse(opts.body); return Promise.resolve({ ok: true }); },
  });
  sb.BevLogger.error('CAT', 'üzenet'); // nincs tech
  assert(captured.tech && captured.tech.length > 0, 'auto stack-trace üres');
});

// ════════════════════════════════════════════════════════════════════════════
// P5 — DocxService név-minta + auto-suffix
// ════════════════════════════════════════════════════════════════════════════
section('P5: DocxService név-minta + auto-suffix');

let docxSandbox;
test('docx-service.js betölthető (PizZip + Docxtemplater nélkül is)', () => {
  docxSandbox = loadInSandbox(path.join(__dirname, '../js/services/docx-service.js'), {
    PizZip: function() {}, // stub
    docxtemplater: function() {},
  });
  assert(typeof docxSandbox.DocxService === 'object', 'DocxService nincs exportálva');
});

test('DocxService új API-jai elérhetőek', () => {
  const d = docxSandbox.DocxService;
  assert(typeof d.uniqueFilename === 'function', 'uniqueFilename hiányzik');
  assert(typeof d.NAME_TOKENS === 'object', 'NAME_TOKENS hiányzik');
  assert(typeof d.outputFilename === 'function', 'outputFilename hiányzik');
});

test('outputFilename pattern nélkül a default formára esik vissza', () => {
  const r = docxSandbox.DocxService.outputFilename('Sablon', { 'Vezetéknév': 'VEZ', 'Keresztnév': 'KER' });
  assertEq(r, 'VEZ KER Sablon.docx');
});

test('outputFilename pattern-ekkel: [Vezetéknév] és [Keresztnév] csere', () => {
  const r = docxSandbox.DocxService.outputFilename('Sablon',
    { 'Vezetéknév': 'KOVÁCS', 'Keresztnév': 'János' },
    'Nyilatkozat [Vezetéknév] [Keresztnév]');
  assertEq(r, 'Nyilatkozat KOVÁCS János.docx');
});

test('outputFilename üres pattern → default fallback', () => {
  const r = docxSandbox.DocxService.outputFilename('Sablon', { 'Vezetéknév': 'A', 'Keresztnév': 'B' }, '');
  assertEq(r, 'A B Sablon.docx');
});

test('outputFilename whitespace pattern → default fallback', () => {
  const r = docxSandbox.DocxService.outputFilename('Sablon', { 'Vezetéknév': 'A', 'Keresztnév': 'B' }, '   ');
  assertEq(r, 'A B Sablon.docx');
});

test('outputFilename automatikus .docx kiegészítés', () => {
  const r = docxSandbox.DocxService.outputFilename('Sablon',
    { 'Vezetéknév': 'A', 'Keresztnév': 'B' }, '[Vezetéknév]');
  assertEq(r, 'A.docx');
});

test('outputFilename már .docx-os pattern nem kap második .docx-ot', () => {
  const r = docxSandbox.DocxService.outputFilename('Sablon',
    { 'Vezetéknév': 'A', 'Keresztnév': 'B' }, '[Vezetéknév].docx');
  assertEq(r, 'A.docx');
});

test('outputFilename pattern-ben minden mező üres → default fallback', () => {
  const r = docxSandbox.DocxService.outputFilename('Sablon',
    { 'Vezetéknév': '', 'Keresztnév': '' }, '[Vezetéknév] [Keresztnév]');
  assertEq(r, 'Sablon.docx'); // family/first üres → tpl marad
});

test('uniqueFilename első előfordulás suffix nélkül', () => {
  const existing = new Set();
  const r = docxSandbox.DocxService.uniqueFilename('foo.docx', existing);
  assertEq(r, 'foo.docx');
});

test('uniqueFilename második előfordulás (2) suffix', () => {
  const existing = new Set(['foo.docx']);
  const r = docxSandbox.DocxService.uniqueFilename('foo.docx', existing);
  assertEq(r, 'foo (2).docx');
});

test('uniqueFilename harmadik előfordulás (3) suffix', () => {
  const existing = new Set(['foo.docx', 'foo (2).docx']);
  const r = docxSandbox.DocxService.uniqueFilename('foo.docx', existing);
  assertEq(r, 'foo (3).docx');
});

test('uniqueFilename kiterjesztés nélküli fájl is suffix-elve', () => {
  const existing = new Set(['bar']);
  const r = docxSandbox.DocxService.uniqueFilename('bar', existing);
  assertEq(r, 'bar (2)');
});

test('uniqueFilename a Set-be regisztrálja az új nevet (idempotens-bizonyítás)', () => {
  const existing = new Set();
  docxSandbox.DocxService.uniqueFilename('x.docx', existing);
  docxSandbox.DocxService.uniqueFilename('x.docx', existing);
  docxSandbox.DocxService.uniqueFilename('x.docx', existing);
  // 3 hívás → 3 unique név
  assertEq(existing.size, 3);
  assert(existing.has('x.docx') && existing.has('x (2).docx') && existing.has('x (3).docx'),
    'Nem mind a 3 variáció van a Set-ben');
});

test('outputFilename tiltott karakterek (fileSafe) eltávolítása', () => {
  const r = docxSandbox.DocxService.outputFilename('Sa<lon',
    { 'Vezetéknév': 'V/ez', 'Keresztnév': 'K|er' });
  assert(!r.includes('<'), '< nem eltávolítva');
  assert(!r.includes('/'), '/ nem eltávolítva');
  assert(!r.includes('|'), '| nem eltávolítva');
});

// ════════════════════════════════════════════════════════════════════════════
// P6 — Csoport-szint helpers
// ════════════════════════════════════════════════════════════════════════════
section('P6: Csoport-szint védekező logika');

// _groupDepth és _groupLeafName closure-ben vannak — string-grep ellenőrzés
const docgenSrc = fs.readFileSync(path.join(__dirname, '../js/modules/docgen.js'), 'utf8');

test('_groupDepth függvény definíció létezik', () => {
  assert(/function\s+_groupDepth\s*\(/.test(docgenSrc), '_groupDepth definíció hiányzik');
});

test('_groupLeafName függvény definíció létezik', () => {
  assert(/function\s+_groupLeafName\s*\(/.test(docgenSrc), '_groupLeafName definíció hiányzik');
});

test('_groupDepth normalizálja a slash-eket (regex jelenlét ellenőrzés)', () => {
  assert(/replace\(\/\^\\\/\+\|\\\/\+\$\/g/.test(docgenSrc) ||
         /\\\/\+\$/.test(docgenSrc),
    'slash-normalizálás regex hiányzik');
});

test('GROUP_TREE BevLogger.debug bejegyzés', () => {
  assert(/GROUP_TREE/.test(docgenSrc), 'GROUP_TREE log kategória nincs');
  assert(/BevLogger\.debug\([^)]*GROUP_TREE/.test(docgenSrc), 'GROUP_TREE debug hívás hiányzik');
});

test('GROUP_AUTOSYNC log bejegyzés', () => {
  assert(/GROUP_AUTOSYNC/.test(docgenSrc), 'GROUP_AUTOSYNC log kategória nincs');
});

test('autoEnsureSubdirGroups normalizeSubdir helper használata', () => {
  assert(/function\s+normalizeSubdir/.test(docgenSrc), 'normalizeSubdir nincs');
  assert(/filter\(Boolean\)/.test(docgenSrc), 'üres-szegmens szűrés hiányzik');
});

// ════════════════════════════════════════════════════════════════════════════
// P10 — Mapping ütközés
// ════════════════════════════════════════════════════════════════════════════
section('P1: UI quick wins');

test('dg-alt-toggle gomb törölve', () => {
  assert(!/dg-alt-toggle/.test(docgenSrc), 'dg-alt-toggle még létezik');
});

test('dg-alt-panel mindig nyitva (--open default)', () => {
  assert(/dg-alt-panel dg-alt-panel--open/.test(docgenSrc),
    'dg-alt-panel--open class nincs default-ban');
});

test('Másik sablonmappa választása gomb', () => {
  assert(/id="dg-switch-dir"/.test(docgenSrc), 'switch-dir gomb hiányzik');
  assert(/onSwitchTemplatesDir/.test(docgenSrc), 'onSwitchTemplatesDir handler hiányzik');
});

test('Switch dir confirm dialog (M5)', () => {
  assert(/dg-switch-confirm/.test(docgenSrc), 'switch-confirm dialog hiányzik');
  assert(/elveszik|elvész/.test(docgenSrc), 'figyelmeztető szöveg hiányzik');
});

// ════════════════════════════════════════════════════════════════════════════
// P2 — Output mappa restore
// ════════════════════════════════════════════════════════════════════════════
section('P2: Output mappa restore');

test('showOutputDirRestoreBanner definíció', () => {
  assert(/function\s+showOutputDirRestoreBanner/.test(docgenSrc), 'banner függvény nincs');
});

test('OUTPUT_DIR_RESTORE log kategória', () => {
  assert(/OUTPUT_DIR_RESTORE/.test(docgenSrc), 'OUTPUT_DIR_RESTORE log nincs');
});

// ════════════════════════════════════════════════════════════════════════════
// P4 — Sablon re-scan + reconcile
// ════════════════════════════════════════════════════════════════════════════
section('P4: Sablon re-scan + reconcile (M1)');

test('refreshTemplates silent opció', () => {
  assert(/refreshTemplates\(opts\s*=\s*\{\}\)/.test(docgenSrc),
    'refreshTemplates opts paraméter nincs');
});

test('M1: scanResult.ok feltétel a prune-hoz', () => {
  assert(/if\s*\(scanResult\.ok\)/.test(docgenSrc), 'scanResult.ok feltétel nincs');
});

test('TEMPLATE_RECONCILE, TEMPLATE_SCAN_FAIL log kategóriák', () => {
  assert(/TEMPLATE_RECONCILE/.test(docgenSrc), 'TEMPLATE_RECONCILE log nincs');
  assert(/TEMPLATE_SCAN_FAIL/.test(docgenSrc), 'TEMPLATE_SCAN_FAIL log nincs');
});

test('docgenTabActivated → docgen → refreshTemplates({silent:true})', () => {
  assert(/refreshTemplates\(\{\s*silent:\s*true\s*\}\)/.test(docgenSrc),
    'silent re-scan tab-aktiváción nincs');
});

// ════════════════════════════════════════════════════════════════════════════
// Záró összegzés
// ════════════════════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(60));
console.log(`Eredmény: ${passed} sikeres / ${failed} hibás (összesen ${passed + failed})`);
if (failed > 0) {
  console.log('\nHibás tesztek:');
  failures.forEach(f => console.log(`  - ${f.name}: ${f.error}`));
  process.exit(1);
} else {
  console.log('Mind sikeres ✓');
  process.exit(0);
}
