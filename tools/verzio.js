'use strict';

/**
 * Verziókezelés: `fő.al` — a fő a kiadás, az al a commit sorszáma.
 *
 *   node tools/verzio.js --leptet      alverzió a commit-számból (pre-commit hook hívja)
 *   node tools/verzio.js --kiadas      főverzió +1 (a kiadas.js hívja)
 *   node tools/verzio.js --tagel       git tag a most született commitra (post-commit hook)
 *   node tools/verzio.js --ellenoriz   nem ír semmit, csak jelent
 *
 * Miért a commit-szám és nem külön számláló: a számláló állapot, az állapot
 * elcsúszik és merge-nél ütközik. A `git rev-list --count HEAD` mindig
 * kiszámolható, mindig nő, és nincs mit karbantartani rajta.
 *
 * A commit SHA-ját NEM lehet a commit tartalmába írni (körkörös volna), ezért
 * a verzió → commit megfeleltetést a git tag adja: `v10.27`. Ez látszik a
 * GitHubon, és egy kattintással elvezet a pontos diffhez.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const GYOKER      = path.join(__dirname, '..');
const LAPOK       = ['index.html', 'print.html'];
const VERZIO_FAJL = path.join(GYOKER, 'js', 'version.js');
const REPO        = 'https://github.com/hrvthd-prog/DocGen';

// Csak valódi hivatkozásra illesztünk. A `?v=` előfordulhat kommentben is
// (pl. magyarázó szövegben), azt nem szabad verziónak venni.
const HIVATKOZAS = /((?:src|href)="[^"]*)\?v=([\d.]+)"/g;

// ── Tiszta függvények (ezekre van teszt) ────────────────────────────────────

/** A lapon szereplő verziószámok, előfordulási sorrendben. */
function verziok(html) {
  return [...html.matchAll(HIVATKOZAS)].map(m => m[2]);
}

/** Minden hivatkozás verziója `uj`-ra. Visszaad: { szoveg, db }. */
function atir(html, uj) {
  let db = 0;
  const szoveg = html.replace(HIVATKOZAS, (_, elo) => { db++; return `${elo}?v=${uj}"`; });
  return { szoveg, db };
}

/** '10.27' → 10 ; '10' → 10 */
function foResz(v) { return Number(String(v).split('.')[0]) || 0; }

// ── Repó-műveletek ──────────────────────────────────────────────────────────

function git(...args) {
  return execFileSync('git', args, { cwd: GYOKER, encoding: 'utf8' }).trim();
}

/** Hány commit van HEAD-ig? Üres repóban 0. */
function commitSzam() {
  try { return Number(git('rev-list', '--count', 'HEAD')) || 0; } catch { return 0; }
}

function olvasLapok() {
  return LAPOK
    .map(nev => ({ nev, ut: path.join(GYOKER, nev) }))
    .filter(l => fs.existsSync(l.ut))
    .map(l => ({ ...l, html: fs.readFileSync(l.ut, 'utf8') }));
}

/** A repó jelenlegi verziója: a lapokon talált legnagyobb főverzió szerinti alak. */
function jelenlegi() {
  const osszes = olvasLapok().flatMap(l => verziok(l.html));
  if (!osszes.length) return null;
  const egyedi = [...new Set(osszes)];
  const legnagyobb = egyedi.slice().sort((a, b) => foResz(a) - foResz(b)).pop();
  return { verzio: legnagyobb, db: osszes.length, vegyes: egyedi.length > 1, egyedi };
}

/** A `uj` verzió beírása mindkét lapra és a js/version.js-be. */
function ir(uj) {
  let osszes = 0;
  for (const l of olvasLapok()) {
    const { szoveg, db } = atir(l.html, uj);
    if (szoveg !== l.html) fs.writeFileSync(l.ut, szoveg);
    console.log(`  ${l.nev.padEnd(14)} ${db} hivatkozás`);
    osszes += db;
  }

  const datum = new Date().toISOString().slice(0, 10);
  const tartalom =
`'use strict';

// Ezt a fájlt a tools/verzio.js írja minden commitnál. Kézzel ne szerkeszd.
window.APP_VERZIO = { verzio: '${uj}', datum: '${datum}', repo: '${REPO}' };
`;
  fs.writeFileSync(VERZIO_FAJL, tartalom);
  return osszes;
}

// ── Parancsok ───────────────────────────────────────────────────────────────

function most() {
  const m = jelenlegi();
  if (!m) {
    console.log('✗ Nem találtam „?v=" hivatkozást a lapokon.');
    console.log('  A gyorsítótár-védelem eltűnt – ez önmagában hiba.');
    process.exit(1);
  }
  return m;
}

function leptet({ ujFo = null } = {}) {
  const m = most();
  if (m.vegyes) console.log(`Vegyes verziószámok: ${m.egyedi.join(', ')} – most egységesítjük.`);

  // A pre-commit hook FUTÁSAKOR a commit még nem létezik, ezért +1.
  const al = commitSzam() + (ujFo === null ? 1 : 0);
  const uj = `${ujFo === null ? foResz(m.verzio) : ujFo}.${al}`;

  if (uj === m.verzio && !m.vegyes) {
    console.log(`A verzió változatlan: ${uj}`);
    return uj;
  }
  console.log(`Verzió: ${m.verzio} → ${uj}`);
  ir(uj);
  return uj;
}

function tagel() {
  const m = most();
  const tag = 'v' + m.verzio;
  const megvan = git('tag', '--list', tag);
  if (megvan) { console.log(`A ${tag} tag már létezik – kihagyva.`); return; }
  git('tag', tag);
  console.log(`✓ ${tag} – push: git push --follow-tags`);
}

function ellenoriz() {
  const m = most();
  console.log(`Lapok:      ${m.verzio}  (${m.db} hivatkozás)`);
  let hiba = 0;

  if (m.vegyes) { console.log(`✗ Vegyes verziószámok: ${m.egyedi.join(', ')}`); hiba++; }

  if (!fs.existsSync(VERZIO_FAJL)) {
    console.log('✗ Hiányzik a js/version.js.');
    hiba++;
  } else {
    const benne = /verzio: '([\d.]+)'/.exec(fs.readFileSync(VERZIO_FAJL, 'utf8'));
    console.log(`version.js: ${benne ? benne[1] : '—'}`);
    if (!benne || benne[1] !== m.verzio) { console.log('✗ A version.js nem egyezik a lapokkal.'); hiba++; }
  }

  const hooks = (() => { try { return git('config', 'core.hooksPath'); } catch { return ''; } })();
  if (hooks !== 'tools/hooks') {
    console.log('✗ Nincs beállítva a hook-mappa. Egyszeri lépés ezen a gépen:');
    console.log('    git config core.hooksPath tools/hooks');
    hiba++;
  }

  if (hiba) process.exit(1);
  console.log('✓ A verzió mindenhol egységes.');
}

if (require.main === module) {
  const arg = process.argv[2];
  if      (arg === '--leptet')    leptet();
  else if (arg === '--kiadas')    leptet({ ujFo: foResz(most().verzio) + 1 });
  else if (arg === '--tagel')     tagel();
  else if (arg === '--ellenoriz') ellenoriz();
  else {
    console.log('Használat: node tools/verzio.js --leptet | --kiadas | --tagel | --ellenoriz');
    process.exit(1);
  }
}

module.exports = { verziok, atir, foResz };
