'use strict';

/**
 * Tesztanyag előállítása: próbasablonok (.docx) és importálható táblázat (.xlsx).
 *
 *   node tools/tesztanyag-keszito.js
 *
 * A kimenet a test/fixtures/ mappába kerül, és VERZIÓKEZELT — de a szkript is
 * az. Ha a séma változik, a tesztanyag újragenerálható; egy kézzel gyártott,
 * reprodukálhatatlan bináris fixture pár hónap alatt hazuggá válik.
 *
 * Kitalált emberek, kitalált számok. Valós személyes adat nem kerül a repóba.
 */

const fs = require('fs');
const path = require('path');

global.window = global;
require(path.join(__dirname, '../vendor/pizzip.min.js'));
const PizZip = global.PizZip;
const ExcelJS = require(path.join(__dirname, '../vendor/exceljs.min.js'));

const KI = path.join(__dirname, '../test/fixtures');
const SABLONOK = path.join(KI, 'sablonok');

// ── Minimális, de érvényes .docx ────────────────────────────────────────────
// A .docx egy zip néhány XML-lel. Ennyi kell ahhoz, hogy a Word megnyissa és a
// docxtemplater feldolgozza.

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Egy futam (`<w:r>`) – ez a Word legkisebb szöveg-egysége. */
function r(t) { return `<w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`; }

/** Bekezdés egy futamból. */
function p(text) { return `<w:p>${r(text)}</w:p>`; }

/** Bekezdés ELŐRE MEGADOTT futamokból – a tördelt sablonhoz. */
function pRuns(darabok) { return `<w:p>${darabok.map(r).join('')}</w:p>`; }

/** Címsor-szerű bekezdés (félkövér). */
function cim(text) {
  return `<w:p><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>` +
         `<w:r><w:rPr><w:b/><w:sz w:val="28"/></w:rPr>` +
         `<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}

function docx(bekezdesek) {
  const body = bekezdesek.join('');
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>` +
    `<w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417"/></w:sectPr></w:body></w:document>`;

  const zip = new PizZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.folder('_rels').file('.rels', RELS);
  zip.folder('word').file('document.xml', xml);
  return zip.generate({ type: 'nodebuffer' });
}

// ── A négy sablon ───────────────────────────────────────────────────────────

function sablon01() {
  return docx([
    cim('Munkavállalói adatlap — próbasablon'),
    p('Ez a sablon minden egyszerű és számított mezőt megszólít.'),

    cim('Személyazonosító adatok'),
    p('Teljes név: {{Teljes név}}'),
    p('Vezetéknév: {{Vezetéknév}}     Keresztnév: {{Keresztnév}}'),
    p('Születési idő: {{Születési idő}}'),
    p('Születési helye: {{Születési helye}}'),
    p('Anyja neve: {{Anyja neve}}'),
    p('Állampolgárság: {{Állampolgárság}}'),

    cim('Elérhetőség'),
    p('Állandó lakcím: {{Állandó lakcím}}'),
    p('Korábbi lakcím: {{Korábbi lakcím}}'),
    p('E-mail: {{E-mail}}     Telefon: {{Telefonszám}}'),

    cim('Okmányok'),
    p('Útlevélszám: {{Útlevélszám}}'),
    p('Útlevél érvényessége: {{Útlevél érvényessége}}'),
    p('Tartózkodási engedély száma: {{Tartózkodási engedély száma}}'),
    p('Adóazonosító: {{Adóazonosító jel}}     TAJ: {{TAJ-szám}}'),

    cim('Foglalkoztatás'),
    p('Munkakör: {{Munkakör}}     FEOR: {{FEOR}}'),
    p('Bruttó bér: {{Bruttó bér}} Ft'),

    p(''),
    p('Azonosító: {{Azonosító}}'),
    p('Kelt: {{mai nap}}'),
  ]);
}

function sablon02() {
  return docx([
    cim('Kétnyelvű nyilatkozat — próbasablon'),
    p('Ugyanaz a mező magyarul és angolul. / The same field in Hungarian and English.'),

    cim('Neme / Sex'),
    p('magyarul: {{Neme}}     in English: {{Neme_EN}}'),

    cim('Családi állapot / Marital status'),
    p('magyarul: {{Családi állapot}}     in English: {{Családi állapot_EN}}'),

    cim('Útlevél típusa / Type of passport'),
    p('magyarul: {{Útlevél típusa}}     in English: {{Útlevél típusa_EN}}'),

    cim('Iskolai végzettség / Educational attainment'),
    p('magyarul: {{Iskolai végzettség}}     in English: {{Iskolai végzettség_EN}}'),

    cim('Beszél magyarul / Speaks Hungarian'),
    p('magyarul: {{Beszél magyarul}}     in English: {{Beszél magyarul_EN}}'),

    p(''),
    p('Név / Name: {{Teljes név}}'),
  ]);
}

function sablon03() {
  return docx([
    cim('Jelölőnégyzetek és hiányzó adatok — próbasablon'),
    p('A {{CHECK:…}} jelölő ☒ vagy ☐ karaktert ad az érték szerint.'),

    cim('Jelölőnégyzetek'),
    p('{{CHECK:Beszél magyarul}} Beszél magyarul'),
    p('{{CHECK:Van érvényes útlevele}} Van érvényes útlevele (ilyen mező NINCS a sémában)'),

    cim('Szándékosan hiányzó mezők'),
    p('Ezeket direkt nem tölti ki senki – a hiányzó adatok naplójában kell megjelenniük.'),
    p('Épület: {{Épület}}     Emelet: {{Emelet}}     Ajtó: {{Ajtó}}'),
    p('Szakképzettség: {{Szakképzettség}}'),
    p('Anyanyelv: {{Anyanyelv}}'),

    p(''),
    p('Kitöltő: {{Teljes név}}'),
  ]);
}

/**
 * Tördelt jelölők — a leggyakoribb valós hiba forrása.
 *
 * A Word gépelés közben szétvágja a szöveget `<w:r>` futamokra: elég egy
 * szóköz vagy egy formázás, és a `{{Neme}}` jelölőből `{{Ne` + `me}}` lesz az
 * XML-ben. A docxtemplaternek van előfeldolgozója erre, de ha nem teszteljük,
 * csak hisszük, hogy működik.
 *
 * Wordben ezt nem lehet megbízhatóan reprodukálni, ezért írjuk kézzel.
 */
function sablon04() {
  return docx([
    cim('Tördelt jelölők — próbasablon'),
    p('A jelölők itt több futamra vannak szétvágva, ahogy a Word teszi.'),

    cim('Kettévágva'),
    pRuns(['Teljes név: ', '{{Teljes ', 'név}}']),

    cim('Több darabra vágva'),
    pRuns(['Neme: ', '{{', 'Ne', 'me', '}}']),

    cim('A nyitó és a záró jel is külön futamban'),
    pRuns(['Lakcím: ', '{{', 'Állandó lakcím', '}}', ' — vége']),

    cim('Kétnyelvű, tördelve'),
    pRuns(['magyarul: ', '{{Csal', 'ádi álla', 'pot}}', '   angolul: ',
           '{{Családi ', 'állapot_EN}}']),

    cim('Jelölőnégyzet tördelve'),
    pRuns(['{{CHECK:', 'Beszél ', 'magyarul}}', ' Beszél magyarul']),
  ]);
}

/**
 * Dátum-részek és szótár — a hatósági formanyomtatvány mintájára.
 *
 * A tartózkodási engedély kérelmén a dátum három külön rovatba megy
 * („____ year ____ month ____ day"), az ország pedig magyarul kell, miközben
 * a kitöltő angolul adta meg. Mindkettő jelölő-szinten oldódik meg, adatbeviteli
 * körök nélkül.
 */
function sablon05() {
  return docx([
    cim('Dátum-részek és szótár — próbasablon'),

    cim('Dátum három rovatban'),
    p('date of birth: {{date_of_birth_year}} year {{date_of_birth_month}} month {{date_of_birth_day}} day'),
    p('útlevél lejárata: {{pp_validity_év}} év {{pp_validity_hónap}} hó {{pp_validity_nap}} nap'),
    p('teljes dátum: {{date_of_birth}}'),

    cim('Szótár: ugyanaz a mező két nyelven'),
    p('ország magyarul: {{previous_country_hun}}'),
    p('country in English: {{previous_country_eng}}'),
    p('munkakör magyarul: {{position_hun}}'),
  ]);
}

// ── Importálható táblázat ───────────────────────────────────────────────────

/**
 * A valódi adatbekérő szerkezetében: 1. sor gépi kulcsok, 2. sor angol
 * címkék, 3. sortól adat. Az XlsxRead pontosan ezt várja.
 *
 * A sorok szándékosan másképp „hibásak" — mindegyik más esetet állít.
 */
const IMPORT_SOROK = [
  // 1. Teljes, kanonikus értékek
  {
    personnel_reg_number: 'SAP-1001', surname: 'Próba', forename: 'Péter',
    date_of_birth: '1990-03-15', citizenship: 'Szerbia', sex: 'male',
    mothers_surname_at_birth: 'Kovács', mothers_forename_at_birth: 'Anna',
    place_of_birth_country: 'Szerbia', place_of_birth_locality: 'Szabadka',
    marital_status: 'married', pp_number: 'PP1001', pp_validity: '2030-06-30',
    passport_type: 'private', postal_code: '1024', locality: 'Budapest',
    name_of_public_place: 'Fő', type_of_public_place: 'utca', street_number: '12',
    email: 'proba.peter@example.invalid', telephone: '+36301111111',
    position: 'gepkezelo', gross_salary: '450000',
    educational_attainment: 'secondary', speaks_hungarian: 'yes',
    mother_tongue: 'Serbian',
  },

  // 2. Szinonimák és vegyes dátumalakok – ezeket fel kell ismerni
  {
    personnel_reg_number: 'SAP-1002', surname: 'Teszt', forename: 'Tímea',
    date_of_birth: '1985.07.22.', citizenship: 'Ukrajna', sex: 'ffi',
    marital_status: 'Hajadon', passport_type: 'Magán',
    educational_attainment: 'Felsőfokú', speaks_hungarian: 'Igen',
    pp_validity: '2029/01/05', expiration_of_rp: '2027.11.15.',
    postal_code: '4025', locality: 'Debrecen',
    name_of_public_place: 'Piac', type_of_public_place: 'utca', street_number: '5',
  },

  // 3. MEGLÉVŐ személy LEJÁRT SAP-számával – a történet alapján kell párosítani
  {
    personnel_reg_number: 'SAP-REGI-9', surname: 'Visszatérő', forename: 'Viktor',
    date_of_birth: '1978-02-10', citizenship: 'Fülöp-szigetek',
    number_of_rp: 'RP-2027-NEW', expiration_of_rp: '2027-05-20',
    sex: 'male',
  },

  // 4. Az 1. sor ismétlése – fájlon belüli duplikátum
  {
    surname: 'Próba', forename: 'Péter', date_of_birth: '1990-03-15',
    citizenship: 'Szerbia', sex: 'male',
  },

  // 5. Hiányzó kötelező mező (nincs keresztnév és születési dátum)
  {
    personnel_reg_number: 'SAP-1005', surname: 'Hiányos',
    citizenship: 'Szerbia',
  },

  // 6. Mind az öt azonosító – a tükrözés a mezőkbe
  {
    personnel_reg_number: 'SAP-1006', surname: 'Ötszámú', forename: 'Ödön',
    date_of_birth: '1995-12-01', citizenship: 'Vietnam', sex: 'female',
    number_of_rp: 'RP-1006', pp_number: 'PP1006',
    tax_number: '8123456789', TAJ: '123456789',
    expiration_of_rp: '2028-03-31',
  },

  // 7. KÉTÉRTELMŰ dátum – ezt el KELL utasítani, nem kitalálni.
  //    A „15/11/2027” lehet november 15. vagy (amerikai olvasatban) érvénytelen;
  //    a „05/11/2027” pedig május 11. és november 5. is. Ilyet találgatni
  //    hatósági ügyben elfogadhatatlan, ezért a beolvasó inkább hibát jelez.
  {
    personnel_reg_number: 'SAP-1007', surname: 'Kétértelmű', forename: 'Kázmér',
    date_of_birth: '1988-04-04', citizenship: 'Szerbia', sex: 'male',
    expiration_of_rp: '15/11/2027',
  },
];

async function importTablazat(mezok) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DocGen tesztanyag-készítő';
  const ws = wb.addWorksheet('Data', { views: [{ state: 'frozen', ySplit: 2 }] });

  mezok.forEach((f, i) => {
    const c = i + 1;
    ws.getRow(1).getCell(c).value = f.key;                    // gépi kulcs
    ws.getRow(2).getCell(c).value = f.label.en || f.label.hu; // angol címke
    ws.getColumn(c).width = Math.min(30, Math.max(12, f.key.length + 3));
  });
  ws.getRow(1).font = { bold: true };
  ws.getRow(2).font = { bold: true };
  ws.getRow(1).hidden = true;   // ahogy az éles sablonban

  IMPORT_SOROK.forEach((sor, ri) => {
    const row = ws.getRow(3 + ri);
    mezok.forEach((f, i) => {
      if (sor[f.key] !== undefined) row.getCell(i + 1).value = sor[f.key];
    });
  });

  return wb.xlsx.writeBuffer();
}

// ── Séma betöltése (a fejléchez) ────────────────────────────────────────────

function semaMezok() {
  const vm = require('vm');
  const sb = {
    console, Date, JSON, Math, Object, Array, String, Number, Boolean,
    Set, Map, Error, RegExp, Promise, isNaN, parseInt, parseFloat, crypto,
  };
  sb.globalThis = sb;
  vm.createContext(sb);
  for (const [rel, n] of [
    ['../js/schema/value-codec.js', 'ValueCodec'],
    ['../js/schema/seed-schema.js', 'SEED_SCHEMA'],
    ['../js/schema/schema-store.js', 'SchemaStore'],
  ]) {
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, rel), 'utf8') + `\nglobalThis.${n} = ${n};`,
      sb, { filename: rel });
  }
  sb.SchemaStore.loadFrom(sb.SEED_SCHEMA);
  return sb.SchemaStore.fields().filter(f => f.type !== 'computed');
}

// ── Futtatás ────────────────────────────────────────────────────────────────

(async () => {
  fs.mkdirSync(SABLONOK, { recursive: true });

  const sablonok = [
    ['01-alap-adatlap.docx',          sablon01()],
    ['02-ketnyelvu-nyilatkozat.docx', sablon02()],
    ['03-jelolonegyzetek.docx',       sablon03()],
    ['04-tordelt-jelolok.docx',       sablon04()],
    ['05-datum-reszek.docx',          sablon05()],
  ];
  for (const [nev, buf] of sablonok) {
    fs.writeFileSync(path.join(SABLONOK, nev), buf);
    console.log(`  sablon:  ${nev.padEnd(32)} ${buf.length} bájt`);
  }

  const mezok = semaMezok();
  const xlsx = await importTablazat(mezok);
  fs.writeFileSync(path.join(KI, 'proba-import.xlsx'), Buffer.from(xlsx));
  console.log(`  táblázat: proba-import.xlsx${' '.repeat(23)}${xlsx.byteLength} bájt` +
              `  (${mezok.length} oszlop, ${IMPORT_SOROK.length} sor)`);

  console.log('\nKész. A fixture-ök a test/fixtures/ mappában.');
})();
