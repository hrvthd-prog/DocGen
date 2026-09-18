'use strict';

// Betűkészlet-csomagoló: vendor/fonts/*.ttf → vendor/carlito-fonts.js
//
// Futtatás: node tools/font-bundle.js
//
// MIÉRT KELL EZ EGYÁLTALÁN
// Az app `file://` protokollról fut, ahol a `fetch()` tiltott (a böngésző
// átlátszatlan origint ad a helyi fájloknak). A .ttf fájlt tehát nem lehet
// futásidőben beolvasni – a betűkészletnek JS-forrásként kell megérkeznie,
// mert `<script src=...>` az egyetlen út, ami file:// alatt is működik.
//
// A .ttf marad a forrás (vendor/fonts/), ez a szkript csak leképezi. Ha a
// betűkészlet cserélődik, itt kell újrafuttatni – kézzel szerkeszteni a
// generált fájlt értelmetlen.

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const VENDOR = path.join(__dirname, '..', 'vendor');
const FONTS  = path.join(VENDOR, 'fonts');
const OUT    = path.join(VENDOR, 'carlito-fonts.js');

const SOURCES = [
  { key: 'regular', file: 'Carlito-Regular.ttf' },
  { key: 'bold',    file: 'Carlito-Bold.ttf' },
];

/**
 * A GSUB (glyph substitution) tábla eltávolítása.
 *
 * MIÉRT: a Carlito `liga` táblája tartalmaz „ti" és „fi" ligatúrát (Calibri-
 * örökség). A pdf-lib a szöveget a fontkit `layout()`-jával alakítja glifákká,
 * ami ezeket alapból alkalmazza — a PDF-be viszont hibás Unicode-visszaképzés
 * kerül: a „Nationality" szóból „Nati onality" lesz a lapon, a szövegrétegben
 * pedig „Naࢢonality" (U+08A2). Név és banki közlemény esetén ez elfogadhatatlan.
 *
 * A PDF-ben nincs szükségünk helyettesítésre: azt akarjuk, hogy egy karakter
 * egy glifa legyen, és a látható szöveg pontosan egyezzen a kimásolhatóval.
 * A GSUB nélkül a fontkit nem tud mit helyettesíteni. A GPOS (kerning) marad.
 *
 * A vietnámi és cirill betűket ez nem érinti: azok előkomponált glifák, és a
 * PdfService NFC-re normalizál, tehát nem kell `ccmp`-összevonás.
 *
 * A head.checkSumAdjustment ettől elavul. Sem a fontkit, sem a pdf-lib, sem a
 * PDF-olvasók nem ellenőrzik — az sfnt ellenőrzőösszeg a gyakorlatban halott
 * mező. Az EGYES táblák ellenőrzőösszege érintetlen marad, mert a tábla-
 * tartalmakhoz nem nyúlunk, csak elhagyunk egyet.
 */
function gsubNelkul(buf) {
  const numTables = buf.readUInt16BE(4);
  const tablak = [];
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    const tag = buf.toString('latin1', o, o + 4);
    if (tag === 'GSUB') continue;
    tablak.push({
      tag,
      checkSum: buf.readUInt32BE(o + 4),
      adat: buf.slice(buf.readUInt32BE(o + 8), buf.readUInt32BE(o + 8) + buf.readUInt32BE(o + 12)),
      hossz: buf.readUInt32BE(o + 12),
    });
  }
  if (tablak.length === numTables) return buf;          // nem volt GSUB

  tablak.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));

  const n = tablak.length;
  const kettoHatvany = Math.pow(2, Math.floor(Math.log2(n)));
  const fej = Buffer.alloc(12 + n * 16);
  buf.copy(fej, 0, 0, 4);                                // sfntVersion
  fej.writeUInt16BE(n, 4);
  fej.writeUInt16BE(kettoHatvany * 16, 6);               // searchRange
  fej.writeUInt16BE(Math.floor(Math.log2(n)), 8);        // entrySelector
  fej.writeUInt16BE(n * 16 - kettoHatvany * 16, 10);     // rangeShift

  const darabok = [fej];
  let offset = fej.length;
  tablak.forEach((t, i) => {
    const o = 12 + i * 16;
    fej.write(t.tag, o, 4, 'latin1');
    fej.writeUInt32BE(t.checkSum, o + 4);
    fej.writeUInt32BE(offset, o + 8);
    fej.writeUInt32BE(t.hossz, o + 12);
    darabok.push(t.adat);
    offset += t.adat.length;
    const toltelek = (4 - (t.adat.length % 4)) % 4;      // a tábláknak 4 bájtra kell igazodniuk
    if (toltelek) { darabok.push(Buffer.alloc(toltelek)); offset += toltelek; }
  });

  return Buffer.concat(darabok);
}

const parts = [];
const jegyzek = [];

for (const { key, file } of SOURCES) {
  const teljes = path.join(FONTS, file);
  if (!fs.existsSync(teljes)) {
    console.error(`Hiányzik: vendor/fonts/${file}`);
    process.exit(1);
  }
  const eredeti = fs.readFileSync(teljes);
  const buf = gsubNelkul(eredeti);
  const sha = crypto.createHash('sha256').update(eredeti).digest('hex');
  parts.push(`  ${key}: '${buf.toString('base64')}',`);
  jegyzek.push(`//   ${file}  ${(eredeti.length / 1024).toFixed(0)} kB  sha256:${sha}`);
  console.log(`${file} → ${key} (${(eredeti.length / 1024).toFixed(0)} kB → ` +
    `${(buf.length / 1024).toFixed(0)} kB GSUB nélkül)`);
}

const tartalom = `'use strict';

// GENERÁLT FÁJL – NE SZERKESZD KÉZZEL.
// Forrás: vendor/fonts/*.ttf, előállító: tools/font-bundle.js
//
${jegyzek.join('\n')}
//
// A sha256 az EREDETI .ttf-re vonatkozik; a base64 a GSUB tábla nélküli
// változatot tartalmazza (ligatúra-mentesítés, lásd gsubNelkul()).
//
// Carlito (SIL Open Font License 1.1) – a licenc szövege: vendor/fonts/Carlito-OFL.txt
// Letöltve: https://github.com/googlefonts/carlito
//
// Metrikában Calibri-kompatibilis, ezért a generált lap ugyanúgy néz ki, mint
// a kiváltott Excel-munkafüzet. Lefedi a magyar, vietnámi, cirill, török,
// román, lengyel és horvát betűket – vagyis a nyilvántartásban ténylegesen
// előforduló neveket.
//
// Base64, mert file:// alatt a fetch() tiltott: a betűkészlet csak
// <script src=...> úton juthat be a lapra.

const CARLITO_FONTS = {
${parts.join('\n')}
};

if (typeof window !== 'undefined') window.CARLITO_FONTS = CARLITO_FONTS;
if (typeof module !== 'undefined') module.exports = CARLITO_FONTS;
`;

fs.writeFileSync(OUT, tartalom, 'utf8');
console.log(`\n✓ vendor/carlito-fonts.js  (${(tartalom.length / 1024 / 1024).toFixed(2)} MB)`);
