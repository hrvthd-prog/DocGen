'use strict';

// Kitölthető PDF-sablon kitöltésének tesztjei (FormPdf).
// Futtatás: node test/form-pdf.test.js
//
// A sablont a teszt maga készíti pdf-lib-bel, minden mezőfajtával; a valódi
// NEAK NYT.52 sablon (test/fixtures) a végén körbe megy. A pdf-lib nem tud
// renderelni, ezért a hely a `placed` listából mérhető. A képet a sablon
// változásakor szemmel is meg kell nézni — FORM_PDF_KI=<mappa> környezeti
// változóval a teszt kiírja a kitöltött PDF-eket.
//
// A futó realmben töltünk (nem vm-sandboxban), mint a transfer-pdf tesztje: a
// pdf-lib `instanceof Array`-jel ellenőriz, ami egy másik realm tömbjén elbukna.

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
function section(n) { console.log(`\n[${n}]`); }

const PDFLib = require('../vendor/pdf-lib.min.js');
globalThis.PDFLib        = PDFLib;
globalThis.fontkit       = require('../vendor/fontkit.umd.min.js');
globalThis.CARLITO_FONTS = require('../vendor/carlito-fonts.js');
globalThis.window        = globalThis;          // a docx-service betöltéskor erre néz

function betolt(rel, nev) {
  vm.runInThisContext(
    fs.readFileSync(path.join(__dirname, rel), 'utf8') + `\nglobalThis.${nev} = ${nev};`,
    { filename: rel });
}
betolt('../js/services/pdf-service.js',   'PdfService');
betolt('../js/services/employee-repo.js', 'EmployeeRepo');
betolt('../js/schema/value-codec.js',     'ValueCodec');
betolt('../js/schema/seed-schema.js',     'SEED_SCHEMA');
betolt('../js/schema/schema-store.js',    'SchemaStore');
betolt('../js/services/docx-service.js',  'DocxService');
betolt('../js/services/form-pdf.js',      'FormPdf');
SchemaStore.loadFrom(SEED_SCHEMA);

const KI = process.env.FORM_PDF_KI || '';
const SZEMELYEK = require('./fixtures/proba-szemelyek.json');
const milan = SZEMELYEK[0];

// Ugyanaz a feloldás, mint a docgen.js-ben: makeParser a sémafeloldóval.
function feloldo(fields, extra = {}) {
  const ures = new Set();
  const row = Object.assign(SchemaStore.resolveValues(fields, 'hu'), { 'mai nap': '2026.10.05' }, extra);
  const parser = DocxService.makeParser(row, ures,
    tag => SchemaStore.renderTag(tag, fields),
    (tag, vart) => SchemaStore.tagEquals(tag, vart, fields));
  return {
    ures,
    text: n => parser(n).get(),
    checked: kif => parser('CHECK:' + kif).get() === DocxService.CHECKED,
  };
}

// ── Szintetikus sablon: minden mezőfajta ────────────────────────────────────
const R = {                                   // pdf-koordináta: bal alsó sarok, pt
  surname:  { x: 100, y: 700, width: 200, height: 16 },
  kozep:    { x: 100, y: 680, width: 200, height: 16 },
  hely:     { x: 100, y: 660, width: 300, height: 16 },
  irsz:     { x: 100, y: 640, width: 60,  height: 16 },
  ev:       [[100, 18], [118, 9], [127, 11], [138, 14]],      // egyenetlen cellák: [x, szélesség]
  gyerek:   { x: 100, y: 560, width: 120, height: 50 },
  szuk:     { x: 100, y: 540, width: 30,  height: 12 },
  male:     { x: 100, y: 520, width: 10, height: 10 },
  female:   { x: 150, y: 520, width: 10, height: 10 },
  married:  { x: 100, y: 500, width: 10, height: 10 },
  single:   { x: 150, y: 500, width: 10, height: 10 },
  ma:       { x: 100, y: 480, width: 40, height: 14 },
  ismeretlen: { x: 100, y: 460, width: 100, height: 14 },
  utca:     { x: 100, y: 440, width: 200, height: 14 },
  emelet:   { x: 320, y: 440, width: 60, height: 14 },
};

async function sablon() {
  const doc = await PDFLib.PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const form = doc.getForm();
  // borderWidth: 0 — különben a pdf-lib a kerettel megnöveli a mező téglalapját.
  const opt = r => ({ ...r, borderWidth: 0 });
  const tx = (nev, r, f) => { const m = form.createTextField(nev); m.addToPage(page, opt(r)); if (f) f(m); return m; };
  tx('surname', R.surname);
  tx('forename', R.kozep, m => m.setAlignment(PDFLib.TextAlignment.Center));
  tx('{place_of_birth_locality}, {place_of_birth_country}', R.hely);
  tx('postal_code', R.irsz, m => { m.setMaxLength(4); m.enableCombing(); });
  R.ev.forEach(([x, w], i) => tx(`date_of_birth_year#${i + 1}`, { x, y: 620, width: w, height: 16 }));
  tx('hr_children', R.gyerek, m => m.enableMultiline());
  tx('previous_street', R.szuk);
  form.createCheckBox('Neme=male').addToPage(page, opt(R.male));
  form.createCheckBox('Neme=female').addToPage(page, opt(R.female));
  const rg = form.createRadioGroup('marital_status');
  rg.addOptionToPage('married', page, opt(R.married));
  rg.addOptionToPage('unmarried', page, opt(R.single));
  tx('mai nap_year', R.ma);
  tx('nincs_ilyen_jelolo', R.ismeretlen);
  tx('{name_of_public_place} {type_of_public_place}', R.utca);
  tx('{floor}/{door}', R.emelet);
  return doc.save();
}

const benne = (p, r) => p.x >= r.x - 0.01 && p.x + p.w <= r.x + r.width + 0.01 &&
                        p.y > r.y && p.y < r.y + r.height;
const szoveg = (res, nev) => res.placed.filter(p => p.name === nev).map(p => p.text).join('');

(async () => {

  section('Sablon ellenőrzése');

  await test('mező nélküli PDF: érthető hiba, nem kitöltés', async () => {
    const d = await PDFLib.PDFDocument.create(); d.addPage();
    let hiba = null;
    try { await FormPdf.check(await d.save()); } catch (e) { hiba = e; }
    assert(hiba && /nincs űrlapmező/.test(hiba.message), hiba ? hiba.message : 'nem dobott');
  });

  const SABLON = await sablon();
  await test('mezős PDF: a mezők száma', async () => {
    assertEq(await FormPdf.check(SABLON), 17);   // a választógomb-csoport egy mező
  });

  section('Mezőnév → érték');

  const t = { a: 'Hanoi', b: 'Vietnám', u: '', f: '3', d: '14' };
  const tx = n => t[n] ?? '';
  await test('sima jelölő', () => assertEq(FormPdf.value('a', tx), 'Hanoi'));
  await test('minta: {a}, {b}', () => assertEq(FormPdf.value('{a}, {b}', tx), 'Hanoi, Vietnám'));
  await test('az üres darab elválasztója nem marad ott', () => {
    assertEq(FormPdf.value('{u}, {b}', tx), 'Vietnám');
    assertEq(FormPdf.value('{a}, {u}', tx), 'Hanoi');
    assertEq(FormPdf.value('{f}/{u}', tx), '3');
    assertEq(FormPdf.value('{u}/{d}', tx), '14');
    assertEq(FormPdf.value('{u}/{u}', tx), '');
  });
  await test('állandó előtag/utótag csak akkor, ha van érték', () => {
    assertEq(FormPdf.value('Tel.: {f}', tx), 'Tel.: 3');
    assertEq(FormPdf.value('Tel.: {u}', tx), '');
  });

  section('Kitöltés — szintetikus sablon, minden mezőfajta');

  const f = feloldo({ ...milan, hr_children: 'Kovacevic Ana 2015.03.01, Kovacevic Marko 2018.11.20' });
  const r = await FormPdf.fill(SABLON, { ...f, keywords: 'teszt-belyeg' });
  if (KI) fs.writeFileSync(path.join(KI, 'szintetikus.pdf'), r.bytes);

  await test('sima szöveg és középre igazítás', () => {
    assertEq(szoveg(r, 'surname'), 'Kovacevic');
    const p = r.placed.find(x => x.name === 'forename');
    assertEq(p.text, 'Milan');
    assert(Math.abs(p.x + p.w / 2 - (R.kozep.x + R.kozep.width / 2)) < 0.01, 'nincs középen');
  });

  await test('minta: város, ország (szótárral)', () => {
    assertEq(szoveg(r, '{place_of_birth_locality}, {place_of_birth_country}'), 'Subotica, Szerbia');
    assertEq(szoveg(r, '{name_of_public_place} {type_of_public_place}'), 'Kossuth Lajos utca');
    assertEq(szoveg(r, '{floor}/{door}'), '3/14');
  });

  await test('comb mező: betűnként egy egyenletes cella közepén', () => {
    const betuk = r.placed.filter(p => p.name === 'postal_code');
    assertEq(betuk.map(p => p.text).join(''), '1052');
    const cw = R.irsz.width / 4;
    betuk.forEach((p, i) => assert(Math.abs(p.x + p.w / 2 - (R.irsz.x + (i + 0.5) * cw)) < 0.01, `${i}. betű`));
  });

  await test('#n mezők: egyenetlen cellák, mindegyikben a saját betűje középen', () => {
    R.ev.forEach(([x, w], i) => {
      const p = r.placed.find(q => q.name === `date_of_birth_year#${i + 1}`);
      assertEq(p.text, '1988'[i]);
      assert(Math.abs(p.x + p.w / 2 - (x + w / 2)) < 0.01, `${i + 1}. cella`);
    });
  });

  await test('többsoros mező: tördel, és a dobozban marad', () => {
    const sorok = r.placed.filter(p => p.name === 'hr_children');
    assert(sorok.length >= 2, `sorok: ${sorok.length}`);
    sorok.forEach(p => assert(benne(p, R.gyerek), `kilóg: ${p.text}`));
    assert(!r.overflow.includes('hr_children'), 'overflow-nak jelölte');
  });

  await test('jelölőnégyzet (Neme=male) és választógomb (marital_status)', () => {
    const x = r.placed.filter(p => p.text === 'X');
    const hol = x.map(p => [R.male, R.female, R.married, R.single].findIndex(q => benne(p, q)));
    assertEq(JSON.stringify(hol.sort()), JSON.stringify([0, 2]), 'férfi + házas');
  });

  await test('nem sémabeli dátum darabja: {{mai nap_year}}', () => {
    assertEq(szoveg(r, 'mai nap_year'), '2026');
  });

  await test('ismeretlen jelölő: üres rovat, és a hiánylistán (mint a Word-sablonnál)', () => {
    assertEq(szoveg(r, 'nincs_ilyen_jelolo'), '');
    assert(f.ures.has('nincs_ilyen_jelolo'), [...f.ures].join(', '));
  });

  await test('a legkisebb betűvel sem férő szöveg ki van írva, de jelzett', () => {
    assert(r.overflow.includes('previous_street'), r.overflow.join(', '));
    assertEq(szoveg(r, 'previous_street'), 'Trg Slobode 4');
  });

  await test('minden kirajzolt szöveg a saját mezőjében (a kilógón kívül)', () => {
    const doboz = { surname: R.surname, forename: R.kozep, postal_code: R.irsz, 'mai nap_year': R.ma,
      '{place_of_birth_locality}, {place_of_birth_country}': R.hely, hr_children: R.gyerek,
      '{name_of_public_place} {type_of_public_place}': R.utca, '{floor}/{door}': R.emelet };
    for (const p of r.placed) if (doboz[p.name]) assert(benne(p, doboz[p.name]), `${p.name}: ${p.text}`);
  });

  await test('a kimeneten nincs űrlapmező, és megvan a bélyeg', async () => {
    const d = await PDFLib.PDFDocument.load(r.bytes, { updateMetadata: false });
    assertEq(d.getForm().getFields().length, 0);
    assertEq(d.getKeywords(), 'teszt-belyeg');
  });

  await test('ékezet: ő és ű változatlanul', async () => {
    const f2 = feloldo({ ...milan, surname: 'Kőműves', forename: 'Győző Űrsula' });
    const r2 = await FormPdf.fill(SABLON, f2);
    assertEq(szoveg(r2, 'surname'), 'Kőműves');
    assertEq(szoveg(r2, 'forename'), 'Győző Űrsula');
  });

  await test('női dolgozónál a nő-négyzet', async () => {
    const r2 = await FormPdf.fill(SABLON, feloldo({ ...milan, sex: 'female' }));
    const x = r2.placed.filter(p => p.text === 'X');
    assert(x.some(p => benne(p, R.female)) && !x.some(p => benne(p, R.male)));
  });

  section('Bélyeg');

  await test('aláírás nélkül kész (02): a Műhely bélyege, „docgen” sehol', () => {
    const k = FormPdf.stampFor('up', { who: 'Kovacevic Milan', tipus: 'TAJ-megrendelő', today: new Date(2026, 9, 5) });
    assertEq(k, 'pdf-muhely=1;dolgozo=Kovacevic Milan;tipus=TAJ-megrendelő;hely=02_Feltoltheto;datum=2026-10-05');
    assert(!/docgen/i.test(k));
  });
  await test('aláírásra vár (01): DocGen-bélyeg, mint a Wordből készült PDF', () => {
    assertEq(FormPdf.stampFor('prep', { docgenMark: 'docgen;v10.72' }), 'docgen;v10.72');
  });
  await test('a pdf-lib Producere sem tartalmaz „docgen”-t', async () => {
    const d = await PDFLib.PDFDocument.load(r.bytes, { updateMetadata: false });
    assert(!/docgen/i.test(d.getProducer() || ''), d.getProducer());
  });

  section('A valódi sablon: NEAK NYT.52');

  const NYT = path.join(__dirname, '..', 'pdf-sablonok', 'TAJ-megrendelő (NYT.52).pdf');
  const n52 = await FormPdf.fill(fs.readFileSync(NYT), feloldo(milan));
  if (KI) fs.writeFileSync(path.join(KI, 'nyt52.pdf'), n52.bytes);

  await test('kitölthető sablon, a mezők olvashatók', async () => {
    assert(await FormPdf.check(fs.readFileSync(NYT)) > 30);
  });
  await test('teljes adatnál nincs kilógás, és a döntések szerinti értékek', () => {
    assertEq(n52.overflow.length, 0, n52.overflow.join(', '));
    const s = n => szoveg(n52, n);
    assertEq(s('surname'), 'Kovacevic');
    assertEq(s('surname_at_birth'), 'Kovacevic');                       // mindig a születési név
    assertEq(s('{place_of_birth_locality}, {place_of_birth_country}'), 'Subotica, Szerbia');
    assertEq(['#1', '#2', '#3', '#4'].map(i => s('date_of_birth_year' + i)).join(''), '1988');
    assertEq(['#1', '#2', '#3', '#4'].map(i => s('postal_code' + i)).join(''), '1052');  // a LAKÓHELY-be
    assertEq(['#1', '#2', '#3', '#4'].map(i => s('employment_start_year' + i)).join(''), '2026');
    assertEq(s('mai nap_year') + s('mai nap_month') + s('mai nap_day'), '20261005');
  });
  await test('jelölés: férfi; a tartózkodási hely üres', () => {
    assert(n52.placed.some(p => p.name === 'Neme=male'), 'nincs X a férfinál');
    assert(!n52.placed.some(p => p.name === 'Neme=female'));
  });
  await test('5 MB alatt', () => {
    assert(n52.bytes.length < 5_000_000, n52.bytes.length);
    console.log(`      (méret: ${(n52.bytes.length / 1024).toFixed(0)} KB)`);
  });

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`${passed} sikeres, ${failed} hibás`);
  if (failed) {
    console.log('\nHibák:');
    failures.forEach(x => console.log(`  • ${x.name}: ${x.error}`));
    process.exit(1);
  }
})().catch(e => {
  console.error('\nA tesztkészlet elszállt:', e && e.stack || e);
  process.exit(1);
});
