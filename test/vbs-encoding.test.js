'use strict';

// A Windows-szkriptek kódolásának védőkorlátja.
// Futtatás: node test/vbs-encoding.test.js
//
// Miért gépi ellenőrzés: a Windows Script Host a .vbs forrást ANSI-ként
// olvassa, hacsak nem UTF-16 LE BOM-mal kezdődik. UTF-8-ban minden ékezetes
// betű elromlik – nemcsak a párbeszédablakokban, hanem a Wordbe írt szövegben,
// tehát a kész PDF-ben is. UTF-8 BOM-mal pedig fordítási hibát ad, azaz el sem
// indul. Ez a hiba szerkesztéskor észrevétlenül visszakerülhet (a legtöbb
// szerkesztő UTF-8-ban ment), ezért őrizzük teszttel.
//
// A .bas (VBA) fordítva működik: a kódablak ANSI-alapú, és az „ő"/„ű" nincs
// benne a nyugati kódlapban – ott az ASCII-ra szorítkozás a védelem.

const fs = require('fs');
const path = require('path');

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

const GYOKER = path.join(__dirname, '..');

function osszesFajl(dir, kiterjesztes, gyujto = []) {
  for (const be of fs.readdirSync(dir, { withFileTypes: true })) {
    if (be.name === '.git' || be.name === 'node_modules' || be.name === 'data') continue;
    const ut = path.join(dir, be.name);
    if (be.isDirectory()) osszesFajl(ut, kiterjesztes, gyujto);
    else if (be.name.toLowerCase().endsWith(kiterjesztes)) gyujto.push(ut);
  }
  return gyujto;
}

// ════════════════════════════════════════════════════════════════════════════
section('VBS: UTF-16 LE BOM kötelező');

const vbsFajlok = osszesFajl(GYOKER, '.vbs');

test('van legalább egy .vbs fájl a projektben', () => {
  assert(vbsFajlok.length > 0, 'nem találtam .vbs fájlt – elmozdult a mappaszerkezet?');
});

for (const ut of vbsFajlok) {
  const rel = path.relative(GYOKER, ut).replace(/\\/g, '/');

  test(`${rel} – UTF-16 LE BOM-mal kezdődik`, () => {
    const b = fs.readFileSync(ut);
    assert(b.length >= 2, 'üres fájl');
    assert(b[0] === 0xFF && b[1] === 0xFE,
      `rossz BOM: ${b[0].toString(16)} ${b[1].toString(16)} – ` +
      'a Windows Script Host ANSI-ként olvassa, az ékezetek elromlanak');
  });

  test(`${rel} – az ékezetek épek`, () => {
    const szoveg = fs.readFileSync(ut).slice(2).toString('utf16le');
    // Ha ANSI-ként mentették és úgy kódolták vissza, jellegzetes szemét marad
    assert(!/Ã[¡©­³º±]|Å[±‘]|â€"/.test(szoveg),
      'sérült ékezetek nyoma a forrásban (kettős kódolás)');
    // A magyar szövegben lennie kell legalább egy hosszú ékezetes betűnek
    assert(/[őű�őŰáéíóúüöÁÉÍÓÚÜÖ]/.test(szoveg), 'nem találtam ékezetes betűt – tényleg magyar a fájl?');
  });
}

// ════════════════════════════════════════════════════════════════════════════
section('VBA (.bas): csak ASCII');

const basFajlok = osszesFajl(GYOKER, '.bas');

for (const ut of basFajlok) {
  const rel = path.relative(GYOKER, ut).replace(/\\/g, '/');

  test(`${rel} – nem tartalmaz ékezetes betűt`, () => {
    const szoveg = fs.readFileSync(ut, 'utf8');
    const rosszak = [...new Set(szoveg.match(/[^\x00-\x7F]/g) || [])];
    assert(rosszak.length === 0,
      `nem-ASCII karakter a VBA forrásban: ${rosszak.join(' ')} – ` +
      'a VBA kódablak ANSI-alapú, ezek elromolhatnak importáláskor');
  });
}

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
