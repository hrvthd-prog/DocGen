'use strict';

/**
 * Üres adatbekérő előállítása böngésző nélkül.
 *
 *   node tools/adatbekero.js [kimeneti-fájl]
 *
 * Ugyanaz a séma, ugyanaz az export profil és ugyanaz a XlsxWrite fut, mint a
 * Nyilvántartás fül „üres sablon" gombja mögött – tehát amit ez a szkript kiír,
 * az bitre az, amit az app is adna. Azért van, hogy a kiküldendő fájl
 * legenerálható legyen anélkül, hogy valaki megnyitná az appot és kiválasztaná
 * az adatmappát.
 *
 * Kiírás után VISSZA IS OLVASSA a fájlt az éles importálóval, és ellenőrzi a
 * két dolgot, amit el lehet rontani:
 *   – minden idegenrendészeti oszlop mezőhöz kötődik (nincs elveszett adat),
 *   – a HR-oszlopok is kötődnek, de kizárólag a SAJÁT hr_ mezőjükhöz
 *     (nincs átcsúszás egy hatósági mezőbe).
 * Ha bármelyik sérül, a szkript hibával áll meg – hibás sablont nem ad ki.
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ExcelJS = require(path.join(__dirname, '../vendor/exceljs.min.js'));

const sandbox = {
  console, Date, Math, JSON, Set, Map, Object, Array, String, Number, Boolean,
  Error, RegExp, Promise, isNaN, parseInt, parseFloat, isFinite,
  Uint8Array, Uint16Array, Int32Array, Float64Array, ArrayBuffer, DataView,
  TextDecoder, TextEncoder, Buffer, setTimeout, clearTimeout, crypto,
  ExcelJS,
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);

vm.runInContext(fs.readFileSync(path.join(__dirname, '../vendor/xlsx.full.min.js'), 'utf8'),
  sandbox, { filename: 'xlsx.full.min.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../vendor/pizzip.min.js'), 'utf8'),
  sandbox, { filename: 'pizzip.min.js' });

for (const [rel, name] of [
  ['../js/services/employee-repo.js', 'EmployeeRepo'],
  ['../js/schema/value-codec.js',     'ValueCodec'],
  ['../js/schema/seed-schema.js',     'SEED_SCHEMA'],
  ['../js/schema/schema-store.js',    'SchemaStore'],
  ['../js/schema/export-profiles.js', 'ExportProfiles'],
  ['../js/services/xlsx-write.js',    'XlsxWrite'],
  ['../js/services/xlsx-read.js',     'XlsxRead'],
]) {
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, rel), 'utf8') + `\nglobalThis.${name} = ${name};`,
    sandbox, { filename: rel });
}

const { SchemaStore, SEED_SCHEMA, ExportProfiles, XlsxWrite, XlsxRead } = sandbox;

SchemaStore.loadFrom(SEED_SCHEMA);
ExportProfiles.loadFrom(null);

const schema  = SchemaStore.get();
const profile = ExportProfiles.get('adatbekero');
const cols    = ExportProfiles.columnsOf(profile, schema);

const KI = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', XlsxWrite.suggestFilename(profile, false));

/** A kiírt fájl visszaolvasása az ÉLES importálóval. */
function ellenorzes(buf) {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const { unknownColumns } = XlsxRead.readRows(ab, {
    schema, sheetName: profile.sheetName,
    keyRow: profile.keyRow, firstDataRow: profile.firstDataRow,
  });
  if (unknownColumns.length) {
    throw new Error('az importáló nem ismer fel oszlopot: ' + unknownColumns.join(', '));
  }

  // Címke-átcsúszás: minden fejléc a saját mezőjéhez kötődik-e?
  const norm = s => String(s).toLowerCase().replace(/[\s._-]+/g, ' ').trim();
  const foglalt = new Map();
  for (const f of schema.fields) {
    for (const t of [f.key, f.label.hu, f.label.en].concat(f.tags || [])) {
      if (!t) continue;
      const n = norm(t);
      if (foglalt.has(n) && foglalt.get(n) !== f.key) {
        throw new Error(`a(z) „${t}" címke két mezőhöz tartozik: ${foglalt.get(n)} / ${f.key}`);
      }
      foglalt.set(n, f.key);
    }
  }

  const hr = cols.filter(f => /^hr_/.test(f.key));
  if (!hr.length) throw new Error('egyetlen HR-oszlop sem került ki');
  return { hr: hr.length, osszes: cols.length };
}

(async () => {
  const buf = Buffer.from(await XlsxWrite.toBuffer({ schema, profile, employees: [] }));
  const e = ellenorzes(buf);
  fs.writeFileSync(KI, buf);

  const csoportok = [...new Set(cols.map(f => f.group))];
  console.log(`Kész: ${KI}`);
  console.log(`  ${e.osszes} oszlop (${e.osszes - e.hr} idegenrendészeti + ${e.hr} HR),` +
              ` ${csoportok.length} csoport, ${profile.protection.fillableRows} kitölthető sor`);
  console.log(`  ellenőrzés: minden oszlop mezőhöz kötődik, nincs címke-ütközés`);
  console.log(`  lapvédelem jelszava: ${profile.protection.password}`);
})().catch(e => {
  console.error('HIBA – a sablon NEM készült el: ' + e.message);
  process.exit(1);
});
