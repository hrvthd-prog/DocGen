'use strict';

// Word content control (SDT) jelölőnégyzetek — a `06` hatósági űrlapon.
// Futtatás: node test/sdt-checkbox.test.js
//
// Azt méri, amit a böngésző-mentes körben mérni lehet: a DocxService a
// `<w:tag w:val="mező:érték">` alapú checkbox content control-okat helyesen
// jelöli-e be — VÉGIG a valódi kódon (PizZip + processCheckboxes), nem másolt
// logikán. A docxtemplater-render (DOMParser) itt nincs, ezért a sablonból a
// vezérlőkbe eleve csupasz ☐ glyph-et teszünk, mint egy hatósági űrlapban.

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓', name); }
  else { failed++; console.log('  ✗', name, extra ? '\n      ' + extra : ''); }
}

// ── Sandbox: a valódi böngésző-modulok Node alatt ──────────────────────────
const sandbox = {
  console, Date, Math, JSON, Set, Map, Object, Array, String, Number, Boolean,
  Error, RegExp, Promise, isNaN, parseInt, parseFloat, isFinite,
  Uint8Array, ArrayBuffer, DataView, Buffer, setTimeout, clearTimeout,
};
sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
vm.createContext(sandbox);

const load = (rel, name) => vm.runInContext(
  fs.readFileSync(path.join(__dirname, rel), 'utf8') + (name ? `\nglobalThis.${name}=${name};` : ''),
  sandbox, { filename: rel });

load('../vendor/pizzip.min.js');
load('../js/schema/value-codec.js',  'ValueCodec');
load('../js/schema/seed-schema.js',  'SEED_SCHEMA');
load('../js/schema/schema-store.js', 'SchemaStore');
load('../js/services/docx-service.js', 'DocxService');

const { SchemaStore, SEED_SCHEMA, DocxService, PizZip } = sandbox;
SchemaStore.loadFrom(SEED_SCHEMA);

const SABLON = path.join(__dirname, 'fixtures/sablonok/06-tartozkodasi-engedely-kerelem.docx');

// A sablont „hatósági" állapotba hozzuk: a vezérlőkben csupasz ☐, minden
// doboz alaphelyzetben üres (checked=0) – így minden bejelölés a kódtól jön.
function styleTwoBuffer() {
  const buf = fs.readFileSync(SABLON);
  const zip = new PizZip(buf);
  let xml = zip.file('word/document.xml').asText();
  xml = xml.replace(/<w:t>\{\{CHECK:[^}]*\}\}<\/w:t>/g, '<w:t>☐</w:t>');
  xml = xml.replace(/(<w14:checked w14:val=")1(")/g, '$10$2');
  zip.file('word/document.xml', xml);
  return zip.generate({ type: 'uint8array', compression: 'DEFLATE' });
}

// A tárolt (kanonikus) mezők és a belőlük renderelt sor + séma-egyeztető,
// pontosan úgy, ahogy a docgen.js hívja a generálást.
const stored = {
  marital_status: 'unmarried', sex: 'male',
  educational_attainment: 'tertiary', passport_type: 'private',
};
const rendered = SchemaStore.resolveValues(stored, 'hu');
const equals   = (name, vart) => SchemaStore.tagEquals(name, vart, stored);

const out = DocxService.processCheckboxes(styleTwoBuffer(), rendered, equals);

// Visszaolvasás: melyik tag doboza lett bejelölve (flag ÉS glyph szintjén).
const outXml = new PizZip(out).file('word/document.xml').asText();
const checkedTags = new Set();
const glyphOkTags = new Set();
outXml.replace(/<w:sdt\b[\s\S]*?<\/w:sdt>/gi, sdt => {
  const tag = (sdt.match(/<w:tag\b[^>]*\bw:val\s*=\s*"(.*?)"/i) || [])[1];
  if (!tag) return sdt;
  const flag  = /<w14:checked w14:val="1"/.test(sdt);
  const glyph = /☒/.test(sdt);   // ☒ a tartalomban
  if (flag) checkedTags.add(tag);
  if (flag === glyph && flag) glyphOkTags.add(tag);
  return sdt;
});

console.log('\n[SDT jelölőnégyzet — hatósági űrlap]');

// A rendered sor a magyar címkét adja („Nőtlen/hajadon") – a nyers egyezés
// ezt SOHA nem kötné az angol `unmarried` célhoz. A séma köti össze.
ok('rendered érték magyar címke, nem kanonikus id',
   rendered.marital_status === 'Nőtlen/hajadon', rendered.marital_status);

const kell = ['sex:male', 'marital_status:unmarried',
              'educational_attainment:tertiary', 'passport_type:private'];
for (const t of kell) {
  ok(`bejelölve: ${t}`, checkedTags.has(t));
  ok(`látható ☒ is: ${t}`, glyphOkTags.has(t));
}

// Egy enumból pontosan EGY doboz aktív – a többi családi állapot maradjon üres.
for (const t of ['marital_status:married', 'marital_status:divorced',
                 'marital_status:widow', 'sex:female']) {
  ok(`üresen marad: ${t}`, !checkedTags.has(t));
}

console.log('\n' + '='.repeat(60));
console.log(`Eredmény: ${passed} sikeres / ${failed} hibás (összesen ${passed + failed})`);
console.log(failed ? 'VAN hibás ✗' : 'Mind sikeres ✓');
process.exit(failed ? 1 : 0);
