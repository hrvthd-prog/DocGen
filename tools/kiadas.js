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
const fs = require('fs');
const path = require('path');

const GYOKER = path.join(__dirname, '..');
const LAPOK  = ['index.html', 'print.html'];
const csakEllenoriz = process.argv.includes('--csak-ellenoriz');

function fejlec(szoveg) {
  console.log('\n' + '═'.repeat(60));
  console.log(szoveg);
  console.log('═'.repeat(60));
}

/** A jelenlegi verziószám az index.html-ből. */
function jelenlegiVerzio() {
  const s = fs.readFileSync(path.join(GYOKER, 'index.html'), 'utf8');
  // Csak valódi hivatkozásokra illesztünk. A `?v=` előfordulhat kommentben is
  // (pl. magyarázó szövegben), azt nem szabad verziónak venni.
  const talalatok = [...s.matchAll(/(?:src|href)="[^"]*\?v=(\d+)"/g)].map(m => Number(m[1]));
  if (!talalatok.length) return null;
  const egyedi = [...new Set(talalatok)];
  return { verzio: Math.max(...egyedi), db: talalatok.length, vegyes: egyedi.length > 1, egyedi };
}

function verzioLeptetes(ujVerzio) {
  let osszes = 0;
  for (const lap of LAPOK) {
    const ut = path.join(GYOKER, lap);
    if (!fs.existsSync(ut)) continue;
    const elotte = fs.readFileSync(ut, 'utf8');
    let db = 0;
    const utana = elotte.replace(/((?:src|href)="[^"]*)\?v=\d+"/g,
      (_, elo) => { db++; return `${elo}?v=${ujVerzio}"`; });
    fs.writeFileSync(ut, utana);
    console.log(`  ${lap.padEnd(14)} ${db} hivatkozás`);
    osszes += db;
  }
  return osszes;
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

// ── 3. Verziólépés ──────────────────────────────────────────────────────────
fejlec('3/3  Gyorsítótár-verzió');

const most = jelenlegiVerzio();
if (!most) {
  console.log('✗ Nem találtam „?v=" hivatkozást az index.html-ben.');
  console.log('  A gyorsítótár-védelem eltűnt – ez önmagában hiba.');
  process.exit(1);
}

if (most.vegyes) {
  console.log(`FIGYELEM: vegyes verziószámok vannak: ${most.egyedi.join(', ')}`);
  console.log('Egy részleges csere maradhatott félbe. Most egységesítjük.\n');
}

console.log(`Jelenlegi verzió: ${most.verzio}  (${most.db} hivatkozás)`);

if (csakEllenoriz) {
  console.log('\n(--csak-ellenoriz: nem írtam semmit)');
  process.exit(0);
}

const uj = most.verzio + 1;
console.log(`Léptetés:         ${most.verzio} → ${uj}\n`);
const osszes = verzioLeptetes(uj);

console.log('');
console.log('═'.repeat(60));
console.log(`✓ Kiadásra kész — verzió ${uj}, ${osszes} hivatkozás frissítve.`);
console.log('');
console.log('Hátralévő lépések:');
console.log('  1. git add -A && git commit');
console.log('  2. a fájlok másolása a megosztott mappába');
console.log('');
console.log('A felhasználóknak NEM kell Ctrl+F5 — a verziólépés elintézi.');
