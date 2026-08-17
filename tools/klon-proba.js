'use strict';

/**
 * Klón-próba: friss klónban is lefutnak-e a tesztek?
 *
 *   node tools/klon-proba.js
 *
 * Miért kell: a `test/fixtures/adatbekero-minta.xlsx` hetekig HIÁNYZOTT a
 * repóból – a .gitignore `*.xlsx` szabálya kizárta. A tesztek nálam zölden
 * futottak, friss klónban viszont három elbukott. Nem kódhiba volt: a
 * tesztkészlet csak az egyik gépen volt teljes.
 *
 * Ez a szkript az egész hibaosztályt kizárja, nem csak azt az egy esetet:
 * bármi, ami verziókezelésből kimaradt, itt kiderül.
 *
 * A nem commitolt változtatásokat NEM viszi át – pont az a lényeg, hogy azt
 * mérje, ami tényleg a repóban van.
 */

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const GYOKER = path.join(__dirname, '..');

function fut(parancs, args, opts = {}) {
  return execFileSync(parancs, args, { encoding: 'utf8', ...opts }).trim();
}

function main() {
  // 1. Van-e nem commitolt változás? Ilyenkor a próba félrevezető lehet.
  let piszkos = '';
  try { piszkos = fut('git', ['status', '--porcelain'], { cwd: GYOKER }); } catch {}
  if (piszkos) {
    console.log('FIGYELEM: van nem commitolt változás. A klón-próba csak azt méri,');
    console.log('ami már a repóban van, tehát ezek NEM lesznek benne:\n');
    console.log(piszkos.split('\n').map(s => '  ' + s).join('\n'));
    console.log('');
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docgen-klon-'));
  const klon = path.join(tmp, 'klon');

  try {
    process.stdout.write('Klónozás… ');
    fut('git', ['clone', '--quiet', GYOKER, klon]);
    console.log('kész');

    // 2. Mi került át egyáltalán?
    const fixtureDir = path.join(klon, 'test', 'fixtures');
    const fixtureK = fs.existsSync(fixtureDir)
      ? fs.readdirSync(fixtureDir, { recursive: true }).filter(f => !fs.statSync(path.join(fixtureDir, f)).isDirectory())
      : [];
    console.log(`Fixture-ök a klónban: ${fixtureK.length}`);
    for (const f of fixtureK) console.log(`  ${String(f).replace(/\\/g, '/')}`);
    console.log('');

    // 3. Tesztfutás a klónban
    console.log('Tesztek a klónban:');
    console.log('─'.repeat(60));
    const r = spawnSync(process.execPath, [path.join(klon, 'test', 'run-all.js')],
      { cwd: klon, stdio: 'inherit' });
    console.log('─'.repeat(60));

    if (r.status !== 0) {
      console.log('\n✗ A KLÓNBAN NEM FUTNAK LE A TESZTEK.');
      console.log('  Valami hiányzik a verziókezelésből – nézd meg a .gitignore-t.');
      process.exit(1);
    }
    // 4. A hookok a repóban vannak, de a `core.hooksPath` a configban – azt a
    //    git szándékosan nem klónozza. Ez minden gépen egyszeri kézi lépés.
    const hookDir = path.join(klon, 'tools', 'hooks');
    if (!fs.existsSync(path.join(hookDir, 'pre-commit'))) {
      console.log('\n✗ A tools/hooks/pre-commit nincs a repóban – nem lenne verzióléptetés.');
      process.exit(1);
    }
    console.log('\nEmlékeztető: friss klónban egyszer le kell futtatni:');
    console.log('  git config core.hooksPath tools/hooks');

    console.log('\n✓ A friss klón önmagában is teljes.');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main();
