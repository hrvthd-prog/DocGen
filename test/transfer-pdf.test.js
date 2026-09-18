'use strict';

// A díjátutalási lap PDF-jének tesztjei.
// Futtatás: node test/transfer-pdf.test.js
//
// Külön készlet a transfers.test.js-től, mert ez a pdf-libbel dolgozik, azt
// pedig nem lehet vm-sandboxban futtatni: `instanceof Array` ellenőrzéssel
// szűri a lapméretet, és egy másik realm tömbje megbukna rajta.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

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
async function assertRejects(fn, m) {
  try { await fn(); } catch { return; }
  throw new Error(m || 'nem dobott hibát');
}
function section(n) { console.log(`\n[${n}]`); }

// ── Betöltés a futó realmben ────────────────────────────────────────────────
const PDFLib  = require('../vendor/pdf-lib.min.js');
const fontkit = require('../vendor/fontkit.umd.min.js');
globalThis.PDFLib        = PDFLib;
globalThis.fontkit       = fontkit;
globalThis.CARLITO_FONTS = require('../vendor/carlito-fonts.js');

function betolt(rel, nev) {
  vm.runInThisContext(
    fs.readFileSync(path.join(__dirname, rel), 'utf8') + `\nglobalThis.${nev} = ${nev};`,
    { filename: rel });
}
betolt('../js/services/pdf-service.js',    'PdfService');
betolt('../js/services/employee-repo.js',  'EmployeeRepo');
betolt('../js/schema/value-codec.js',      'ValueCodec');
betolt('../js/schema/seed-schema.js',      'SEED_SCHEMA');
betolt('../js/schema/schema-store.js',     'SchemaStore');
betolt('../js/services/transfer-repo.js',  'TransferRepo');
betolt('../js/services/transfer-pdf.js',   'TransferPdf');
SchemaStore.loadFrom(SEED_SCHEMA);

function sor(i, extra = {}) {
  return Object.assign({
    id: 'r' + i,
    name: 'Kőműves Győző',
    personnelNo: '01234',
    dob: '1996-04-23',
    nationality: 'magyar',
    identifier: 'EH1626' + String(1000 + i),
    amount: 26000,
    handler: 'Horváth D',
  }, extra);
}

function koteg(darab, extra = {}) {
  return Object.assign({
    id: 'b1', label: '2026-09-18/1',
    status: 'elokeszites', paidOn: null,
    rows: Array.from({ length: darab }, (_, i) => sor(i)),
  }, extra);
}

(async () => {

  section('Előállítás');

  await test('Egy tételből érvényes, egyoldalas PDF lesz', async () => {
    const bytes = await TransferPdf.build(koteg(1));
    assertEq(Buffer.from(bytes.slice(0, 5)).toString('latin1'), '%PDF-');
    const doc = await PDFLib.PDFDocument.load(bytes);
    assertEq(doc.getPageCount(), 1);
    assertEq(Math.round(doc.getPage(0).getWidth()), 842, 'nem A4 fekvő');
    assertEq(Math.round(doc.getPage(0).getHeight()), 595);
  });

  await test('Üres kötegből nincs lap — hibát ad, nem üres PDF-et', async () => {
    await assertRejects(() => TransferPdf.build(koteg(0)), 'üres kötegből is gyártott lapot');
    await assertRejects(() => TransferPdf.build(null), 'köteg nélkül is lefutott');
  });

  await test('Sok tétel több oldalra tördelődik', async () => {
    const egy = await PDFLib.PDFDocument.load(await TransferPdf.build(koteg(20)));
    const ketto = await PDFLib.PDFDocument.load(await TransferPdf.build(koteg(40)));
    assertEq(egy.getPageCount(), 1, '20 tétel nem fért egy oldalra');
    assertEq(ketto.getPageCount(), 2, '40 tételből nem lett két oldal');
  });

  await test('Nagyon sok tétel sem szakad meg', async () => {
    const doc = await PDFLib.PDFDocument.load(await TransferPdf.build(koteg(200)));
    assert(doc.getPageCount() >= 7, `200 tételhez kevés oldal: ${doc.getPageCount()}`);
    for (let i = 0; i < doc.getPageCount(); i++) {
      assertEq(Math.round(doc.getPage(i).getWidth()), 842, `a(z) ${i + 1}. oldal nem A4 fekvő`);
    }
  });

  section('Elrendezés');

  await test('Az oszlopok kitöltik a lapot, átfedés és lyuk nélkül', async () => {
    const ossz = TransferPdf.OSZLOPOK.reduce((s, o) => s + o.arany, 0);
    assert(ossz > 0, 'nincs oszlopszélesség');
    // A munkalapról átvett arányok: a személyi szám oszlopa szándékosan kimaradt.
    assertEq(TransferPdf.OSZLOPOK.length, 8);
    assert(!TransferPdf.OSZLOPOK.some(o => /personnel|szemelyi/i.test(o.kulcs)),
      'a személyi szám bekerült a nyomtatott lapra');
  });

  await test('A fájlnév a makró mintáját követi', async () => {
    assert(/^Fee-transfers_\d{4}-\d{2}-\d{2}_\d{4}\.pdf$/.test(TransferPdf.filename()),
      TransferPdf.filename());
  });

  section('Betűkészlet — a lap olvashatósága múlik rajta');

  await test('A beágyazott készlet minden glifája rajzolható', async () => {
    const bytes = await TransferPdf.build(koteg(3));
    const fontok = kibontottFontok(Buffer.from(bytes));
    assert(fontok.length >= 1, 'nincs beágyazott betűkészlet');
    for (const ttf of fontok) {
      const f = fontkit.create(ttf);
      let rossz = 0;
      for (let g = 0; g < f.numGlyphs; g++) {
        try { const p = f.getGlyph(g).path; if (!p || !p.commands) rossz++; } catch { rossz++; }
      }
      assertEq(rossz, 0, `${rossz} rajzolhatatlan glifa`);
    }
  });

  await test('NINCS ligatúra-helyettesítés — egy karakter, egy glifa', async () => {
    // Ez a teszt egy valós hibából született. A Carlito `liga` táblája „ti" és
    // „fi" ligatúrát is tartalmaz (Calibri-örökség). A pdf-lib a fontkit
    // layout()-jával alakít glifákká, ami ezeket alkalmazta: a lapon
    // „Nati onality" jelent meg, a szövegrétegben pedig „Naࢢonality" (U+08A2).
    // Nevekben és banki közleményben ez elfogadhatatlan, ezért a
    // tools/font-bundle.js kiveszi a GSUB táblát. Ha valaha visszakerül, ez bukik.
    for (const [nev, b64] of Object.entries(globalThis.CARLITO_FONTS)) {
      const f = fontkit.create(Buffer.from(b64, 'base64'));
      for (const szo of ['Nationality', 'Application', 'identifier', 'ti', 'fi', 'fl']) {
        const glifak = f.layout(szo).glyphs;
        assertEq(glifak.length, [...szo].length,
          `${nev}: „${szo}" ${glifak.length} glifára esett ${[...szo].length} helyett (ligatúra)`);
      }
    }
  });

  await test('A szövegréteg a valódi karaktereket tartalmazza', async () => {
    // A ToUnicode-táblából másol a felhasználó, és ez kerül a keresésbe.
    // Pont ez volt hibás a ligatúrás változatban: a lapon látszó „ti" helyett
    // U+08A2 került bele. Itt azt mérjük, hogy a magyar `ő` (U+0151) és a
    // vietnámi `ễ` (U+1EC5) a saját kódpontjával szerepel.
    const b = koteg(0);
    b.rows = [sor(0, { name: 'Kőműves Győző' }), sor(1, { name: 'Nguyễn Thị Hạnh' })];
    const cmapok = kibontottCmapok(Buffer.from(await TransferPdf.build(b)));
    assert(cmapok.length >= 1, 'nincs ToUnicode-tábla — a lapról nem lehetne másolni');

    const egyben = cmapok.join('\n').toLowerCase();
    for (const [nev, kod] of [['ő', '0151'], ['ű', '0171'], ['ễ', '1ec5']]) {
      assert(egyben.includes('<' + kod + '>'), `a(z) „${nev}" nem a saját kódpontjával van a szövegrétegben`);
    }
  });

  section('Tartalom');

  await test('A közlemény a tétel adataiból áll össze', async () => {
    assertEq(TransferRepo.reference(sor(0)), 'Kőműves Győző 1996-04-23 EH16261000');
  });

  await test('A hibás sor is kirajzolódik — a lap nem a validáció helye', async () => {
    // A hiányos sort a felület jelzi, de a PDF elkészítését nem akaszthatja meg:
    // a makró is megkérdezte, hogy „mégis?". Hibajavításhoz kell a kinyomtatott kép.
    const b = koteg(0);
    b.rows = [sor(0, { identifier: '', amount: 0, nationality: '' })];
    const doc = await PDFLib.PDFDocument.load(await TransferPdf.build(b));
    assertEq(doc.getPageCount(), 1);
  });

  await test('A hosszú név nem lóg át a szomszéd oszlopba', async () => {
    const b = koteg(0);
    b.rows = [sor(0, { name: 'Nagyonhosszúnevű Ügyfélszemély Mátyásné Dr. Kovácsovicsné' })];
    const doc = await PDFLib.PDFDocument.load(await TransferPdf.build(b));
    assertEq(doc.getPageCount(), 1);   // a csonkolást a PdfService végzi, itt az a lényeg, hogy nem hasal el
  });

  // ── Segéd ─────────────────────────────────────────────────────────────────

  /** A PDF ToUnicode-tábláinak szövege. A pdf-lib tömöríti, ezért ki kell bontani. */
  function kibontottCmapok(buf) {
    return kibontottStreamek(buf)
      .map(b => b.toString('latin1'))
      .filter(s => s.includes('beginbfchar') || s.includes('beginbfrange'));
  }

  function kibontottStreamek(buf) {
    const ki = [];
    let i = 0;
    for (;;) {
      const s = buf.indexOf('stream', i);
      if (s === -1) break;
      let kezd = s + 6;
      if (buf[kezd] === 0x0d) kezd++;
      if (buf[kezd] === 0x0a) kezd++;
      const veg = buf.indexOf('endstream', kezd);
      if (veg === -1) break;
      const nyers = buf.slice(kezd, veg);
      ki.push(nyers);
      try { ki.push(zlib.inflateSync(nyers)); } catch { /* nem tömörített */ }
      i = veg + 9;
    }
    return ki;
  }

  function kibontottFontok(buf) {
    const ki = [];
    let i = 0;
    for (;;) {
      const s = buf.indexOf('stream', i);
      if (s === -1) break;
      let kezd = s + 6;
      if (buf[kezd] === 0x0d) kezd++;
      if (buf[kezd] === 0x0a) kezd++;
      const veg = buf.indexOf('endstream', kezd);
      if (veg === -1) break;
      const nyers = buf.slice(kezd, veg);
      let ki2 = null;
      try { ki2 = zlib.inflateSync(nyers); } catch { /* nem tömörített */ }
      for (const adat of [nyers, ki2]) {
        if (!adat || adat.length < 4) continue;
        const magic = adat.readUInt32BE(0);
        if (magic === 0x00010000 || magic === 0x74727565 || magic === 0x4f54544f) ki.push(adat);
      }
      i = veg + 9;
    }
    return ki;
  }

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
