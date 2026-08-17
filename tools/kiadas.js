'use strict';

/**
 * Kiadás: tesztek, klón-próba, verziólépés — egyetlen paranccsal.
 *
 *   node tools/kiadas.js                 teljes kiadás
 *   node tools/kiadas.js --csak-ellenoriz   nem ír semmit, csak jelent
 *
 * Miért kell: a fejlesztés alatt HÁROMSZOR fordult elő, hogy a böngésző a
 * régi kódot adta, mert elmaradt a `?v=N` léptetése. Éles használatban ez azt
 * jelenti, hogy frissítés után a felhasználók csendben a frissítés ELŐTTI
 * kódot futtatják, amíg valaki Ctrl+F5-öt nem nyom.
 *
 * Miért nem teszt: egy teszt nem tudja, hogy „változott-e a JS az utolsó
 * kiadás óta" – ehhez állapotot kellene tárolnia, ami maga is elavulhat.
 * A kiadás viszont amúgy is tudatos pillanat: oda való a lépés.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const GYOKER = path.join(__dirname, '..');
const csakEllenoriz = process.argv.includes('--csak-ellenoriz');

function fejlec(szoveg) {
  console.log('\n' + '═'.repeat(60));
  console.log(szoveg);
  console.log('═'.repeat(60));
}

function futtat(cimke, args) {
  const r = spawnSync(process.execPath, args, { cwd: GYOKER, stdio: 'inherit' });
  if (r.status !== 0) {
    console.log(`\n✗ ${cimke} — a kiadás MEGÁLL.`);
    console.log('  Hibás kódot nem adunk ki.');
    process.exit(1);
  }
}

// ── 1. Tesztek ──────────────────────────────────────────────────────────────
fejlec('1/3  Tesztek');
futtat('A tesztek elbuktak', [path.join(GYOKER, 'test', 'run-all.js')]);

// ── 2. Klón-próba ───────────────────────────────────────────────────────────
fejlec('2/3  Klón-próba — a repó önmagában is teljes?');
futtat('A klón-próba elbukott', [path.join(__dirname, 'klon-proba.js')]);

// ── 3. Főverzió-lépés ───────────────────────────────────────────────────────
// Az alverziót minden commitnál a pre-commit hook lépteti; itt a FŐ verzió nő.
fejlec('3/3  Gyorsítótár-verzió');

const VERZIO = path.join(__dirname, 'verzio.js');

if (csakEllenoriz) {
  futtat('A verzió-ellenőrzés elbukott', [VERZIO, '--ellenoriz']);
  console.log('\n(--csak-ellenoriz: nem írtam semmit)');
  process.exit(0);
}

futtat('A verziólépés elbukott', [VERZIO, '--kiadas']);

console.log('');
console.log('═'.repeat(60));
console.log('✓ Kiadásra kész.');
console.log('');
console.log('Hátralévő lépések:');
console.log('  1. git add -A && git commit   (a hook lépteti az alverziót és tagel)');
console.log('  2. git push --follow-tags');
console.log('  3. a fájlok másolása a megosztott mappába');
console.log('');
console.log('A felhasználóknak NEM kell Ctrl+F5 — a verziólépés elintézi.');
