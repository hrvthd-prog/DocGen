'use strict';

/**
 * Dokumentum-renderelés körbe-teszt — BÖNGÉSZŐBEN fut.
 *
 * Miért nem Node-ban: a docxtemplater `new DOMParser()`-t hív, ami Node-ban
 * nem létezik. Ezt lemértük; a kikerülés (@xmldom felvétele vagy saját
 * DOM-pótlék) többe kerülne, mint amennyit ér. Lásd TERV-tesztanyag.md 7.
 *
 * HASZNÁLAT
 *   1. Nyisd meg az appot (index.html)
 *   2. F12 → Console
 *   3. Illeszd be ennek a fájlnak a teljes tartalmát, Enter
 *
 * Az eredmény táblázatosan jelenik meg, és a visszatérési érték
 * { passed, failed, results } — így automatizálva is kiértékelhető.
 *
 * A sablonokat a lapról tölti be (fetch), ezért http:// kiszolgálóról kell
 * futtatni; `file://`-ről a böngésző tiltja a helyi fájlok olvasását.
 */
(async function e2eBrowser() {

  const FIX = 'test/fixtures/sablonok/';
  const eredmenyek = [];

  function ok(nev, felt, reszlet = '') {
    eredmenyek.push({ nev, sikeres: !!felt, reszlet });
    console.log(`${felt ? '✓' : '✗'} ${nev}${felt || !reszlet ? '' : '\n    ' + reszlet}`);
    return !!felt;
  }

  // ── Próbaszemély: ugyanaz, mint az import-táblázat 1. sora ────────────────
  const SZEMELY = {
    surname: 'Próba', forename: 'Péter', date_of_birth: '1990-03-15',
    citizenship: 'Szerbia', sex: 'male', marital_status: 'married',
    mothers_surname_at_birth: 'Kovács', mothers_forename_at_birth: 'Anna',
    place_of_birth_country_hun: 'Szerbia', place_of_birth_locality: 'Szabadka',
    postal_code: '1024', locality: 'Budapest',
    name_of_public_place: 'Fő', type_of_public_place: 'utca', street_number: '12',
    pp_number: 'PP1001', pp_validity: '2030-06-30', passport_type: 'private',
    educational_attainment: 'secondary', speaks_hungarian: 'yes',
    email: 'proba.peter@example.invalid', telephone: '+36301111111',
    position: 'gepkezelo', gross_salary: '450000',
  };

  // ── A docgen két segédfüggvényének mása (DOM nélkül is fut) ──────────────
  function buildRenderRow(fields) {
    const v = SchemaStore.resolveValues(fields, 'hu');
    for (const f of SchemaStore.fields()) {
      const cimke = f.label.hu;
      if (cimke && v[cimke] === undefined) v[cimke] = v[f.key];
    }
    v['mai nap'] = '2026. augusztus 8.';
    v['Azonosító'] = 'SAP-1001';
    return v;
  }

  function makeResolver(fields) {
    const gyorsito = new Map();
    return (name) => {
      if (gyorsito.has(name)) return gyorsito.get(name);
      let out = null;
      const hit = SchemaStore.resolveTag(name);
      if (hit) {
        out = hit.field.type === 'computed'
          ? SchemaStore.computeField(hit.field, fields, hit.lang)
          : ValueCodec.render(hit.field, fields[hit.field.key], hit.lang);
      }
      gyorsito.set(name, out);
      return out;
    };
  }

  /** A kész dokumentum olvasható szövege – a címkéket lecsupaszítva. */
  function docxSzoveg(uint8) {
    const xml = new PizZip(uint8).file('word/document.xml').asText();
    return xml
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  async function general(sablonNev) {
    const resp = await fetch(FIX + sablonNev);
    if (!resp.ok) throw new Error(`${sablonNev}: ${resp.status}`);
    const buf = new Uint8Array(await resp.arrayBuffer());

    const sor = buildRenderRow(SZEMELY);
    const res = await DocxService.generateDocx(buf, sor, { resolve: makeResolver(SZEMELY) });
    return { szoveg: docxSzoveg(res.buffer), emptyTags: res.emptyTags };
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('%c Dokumentum-renderelés körbe-teszt ', 'background:#0d7377;color:#fff');

  // Előfeltételek
  const hiany = ['SchemaStore', 'ValueCodec', 'DocxService', 'PizZip']
    .filter(n => typeof window[n] === 'undefined' && typeof eval(`typeof ${n}`) === 'undefined');
  if (!ok('a szükséges modulok betöltve', hiany.length === 0, `hiányzik: ${hiany.join(', ')}`)) {
    return { passed: 0, failed: 1, results: eredmenyek };
  }
  if (typeof SEED_SCHEMA !== 'undefined') SchemaStore.loadFrom(SEED_SCHEMA);

  // ── 1. Alap adatlap ─────────────────────────────────────────────────────
  try {
    const { szoveg } = await general('01-alap-adatlap.docx');

    ok('számított: teljes név két mezőből', szoveg.includes('Teljes név: Próba Péter'), szoveg.slice(0, 200));
    ok('számított: anyja neve', szoveg.includes('Anyja neve: Kovács Anna'));
    ok('számított: születési helye', szoveg.includes('Születési helye: Szerbia, Szabadka'));
    ok('számított: lakcím négy mezőből',
       szoveg.includes('Állandó lakcím: 1024 Budapest Fő utca 12'));
    ok('egyszerű mező', szoveg.includes('Vezetéknév: Próba'));
    ok('mai nap behelyettesítve', szoveg.includes('Kelt: 2026. augusztus 8.'));
    ok('azonosító behelyettesítve', szoveg.includes('Azonosító: SAP-1001'));
    ok('nem maradt kitöltetlen jelölő', !/\{\{|\}\}/.test(szoveg),
       (szoveg.match(/\{\{[^}]*\}\}/g) || []).join(', '));
  } catch (e) { ok('01-alap-adatlap.docx generálása', false, e.message); }

  // ── 2. Kétnyelvű ────────────────────────────────────────────────────────
  try {
    const { szoveg } = await general('02-ketnyelvu-nyilatkozat.docx');

    ok('neme magyarul ÉS angolul ugyanabból a mezőből',
       szoveg.includes('magyarul: Férfi') && szoveg.includes('in English: Male'));
    ok('családi állapot kétnyelvűen',
       szoveg.includes('magyarul: Házas') && szoveg.includes('in English: Married'));
    ok('útlevél típusa kétnyelvűen',
       szoveg.includes('magyarul: Magán') && szoveg.includes('in English: Private'));
    ok('iskolai végzettség kétnyelvűen',
       szoveg.includes('magyarul: Középfokú') && szoveg.includes('in English: Secondary'));
    ok('beszél magyarul kétnyelvűen',
       szoveg.includes('magyarul: Igen') && szoveg.includes('in English: Yes'));
  } catch (e) { ok('02-ketnyelvu-nyilatkozat.docx generálása', false, e.message); }

  // ── 3. Jelölőnégyzetek és hiányzó adatok ────────────────────────────────
  try {
    const { szoveg, emptyTags } = await general('03-jelolonegyzetek.docx');

    ok('igaz értékre ☒ kerül', szoveg.includes('☒ Beszél magyarul'), szoveg.slice(0, 300));
    ok('ismeretlen mezőre ☐ kerül', szoveg.includes('☐ Van érvényes útlevele'));
    ok('a hiányzó mezők a naplóba kerülnek',
       ['Épület', 'Emelet', 'Ajtó', 'Anyanyelv'].every(m => emptyTags.includes(m)),
       `emptyTags = ${emptyTags.join(', ')}`);
    ok('a CHECK: jelölők NEM kerülnek a hiányzó-naplóba',
       !emptyTags.some(t => t.startsWith('CHECK:')));
  } catch (e) { ok('03-jelolonegyzetek.docx generálása', false, e.message); }

  // ── 4. Tördelt jelölők — a leggyakoribb valós hiba ──────────────────────
  try {
    const { szoveg } = await general('04-tordelt-jelolok.docx');

    ok('kettévágott jelölő is behelyettesítődik',
       szoveg.includes('Teljes név: Próba Péter'), szoveg.slice(0, 300));
    ok('több darabra vágott jelölő', szoveg.includes('Neme: Férfi'));
    ok('külön futamban lévő nyitó/záró jel',
       szoveg.includes('Lakcím: 1024 Budapest Fő utca 12 — vége'));
    ok('tördelt kétnyelvű pár',
       szoveg.includes('magyarul: Házas') && szoveg.includes('angolul: Married'));
    ok('tördelt jelölőnégyzet', szoveg.includes('☒ Beszél magyarul'));
    ok('nem maradt kitöltetlen jelölő', !/\{\{|\}\}/.test(szoveg),
       (szoveg.match(/\{\{[^}]*\}\}/g) || []).join(', '));
  } catch (e) { ok('04-tordelt-jelolok.docx generálása', false, e.message); }

  // ── Összegzés ───────────────────────────────────────────────────────────
  const sikeres = eredmenyek.filter(r => r.sikeres).length;
  const bukott  = eredmenyek.length - sikeres;
  console.log('='.repeat(60));
  console.log(`Eredmény: ${sikeres} sikeres / ${bukott} hibás (összesen ${eredmenyek.length})`);
  if (bukott) {
    console.log('Hibás:');
    eredmenyek.filter(r => !r.sikeres).forEach(r => console.log(`  - ${r.nev}: ${r.reszlet}`));
  } else {
    console.log('Mind sikeres ✓');
  }

  return { passed: sikeres, failed: bukott, results: eredmenyek };
})();
