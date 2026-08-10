'use strict';

/**
 * Formanyomtatvány-próba — BÖNGÉSZŐBEN fut (mint az e2e-browser.js).
 *
 * A hatósági „Application form for a residence permit" (9. melléklet) sablonon
 * méri, hogy a DocGen mit tud kitölteni és mit nem:
 *   – melyik jelölőt ismeri fel a séma, melyiket nem,
 *   – melyik marad üresen adathiány miatt,
 *   – hány jelölőnégyzet dől el adatból, és hány marad kézi jelölésre.
 *
 * A személyeket a `test/fixtures/proba-szemelyek.json` adja: ez a kitöltött
 * adatbekérőből, az XlsxRead importtal előállt nyilvántartás.
 *
 * HASZNÁLAT
 *   1. Indítsd a kiszolgálót és nyisd meg az index.html-t
 *   2. F12 → Console
 *   3. await fetch('test/formanyomtatvany-check.js').then(r=>r.text()).then(eval)
 *
 * Visszatérési érték: az összesítő objektum (géppel is kiértékelhető).
 */
window.formanyomtatvanyCheck = (async function () {

  const SABLON    = 'test/fixtures/sablonok/06-tartozkodasi-engedely-kerelem.docx';
  const SZEMELYEK = 'test/fixtures/proba-szemelyek.json';

  if (typeof SEED_SCHEMA !== 'undefined') SchemaStore.loadFrom(SEED_SCHEMA);

  const szemelyek = await (await fetch(SZEMELYEK)).json();
  const sablonBuf = new Uint8Array(await (await fetch(SABLON)).arrayBuffer());

  /** A docx olvasható szövege. */
  function docxSzoveg(uint8) {
    const xml = new PizZip(uint8).file('word/document.xml').asText();
    return xml
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  // ── 1. A sablon jelölői ────────────────────────────────────────────────────
  const sablonSzoveg = docxSzoveg(sablonBuf);
  const jelolok = [...new Set(
    (sablonSzoveg.match(/\{\{[^}]*\}\}/g) || []).map(s => s.slice(2, -2)))];

  // A CHECK: előtag és a `=érték` rész nem a mezőnév része – le kell venni,
  // különben minden jelölőnégyzetet ismeretlennek látnánk.
  const mezoNev = j => j.trim().replace(/^CHECK:/i, '').split('=')[0].trim();

  const felismert = [], ismeretlen = [];
  for (const j of jelolok) {
    const hit = SchemaStore.resolveTag(mezoNev(j));
    (hit ? felismert : ismeretlen).push(
      hit ? { jelolo: j, mezo: hit.field.key, resz: hit.part || '(teljes)' } : j);
  }

  // ── 2. Jelölőnégyzetek ─────────────────────────────────────────────────────
  // A sablonban kétféle négyzet lehet: a DocGen által kitöltött ({{CHECK:…}})
  // és a nyers karakter (☐/☒), amihez a program nem nyúl.
  const checkJelolok = jelolok.filter(j => /^CHECK:/i.test(j.trim()));
  const nyersNegyzet = (sablonSzoveg.match(/[☐☒]/g) || []).length;

  // ── 3. Renderelés ──────────────────────────────────────────────────────────
  function buildRenderRow(fields) {
    const v = SchemaStore.resolveValues(fields, 'hu');
    for (const f of SchemaStore.fields()) {
      const cimke = f.label.hu;
      if (cimke && v[cimke] === undefined) v[cimke] = v[f.key];
    }
    v['mai nap'] = '2026. augusztus 10.';
    return v;
  }
  function makeResolver(fields) {
    const cache = new Map();
    return name => {
      if (!cache.has(name)) cache.set(name, SchemaStore.renderTag(name, fields));
      return cache.get(name);
    };
  }

  const makeMatcher = fields => (name, vart) => SchemaStore.tagEquals(name, vart, fields);

  const dokumentumok = [];
  for (const fields of szemelyek) {
    const res = await DocxService.generateDocx(sablonBuf, buildRenderRow(fields),
      { resolve: makeResolver(fields), equals: makeMatcher(fields) });
    const szoveg = docxSzoveg(res.buffer);
    dokumentumok.push({
      nev: `${fields.surname} ${fields.forename}`,
      meret: res.buffer.length,
      emptyTags: res.emptyTags,
      maradekJelolo: [...new Set(szoveg.match(/\{\{[^}]*\}\}/g) || [])],
      bejelolt: (szoveg.match(/☒/g) || []).length,
      uresNegyzet: (szoveg.match(/☐/g) || []).length,
      szoveg,
    });
  }

  const osszegzes = {
    jelolokOsszesen:  jelolok.length,
    felismert,
    ismeretlen,
    checkJelolok,
    nyersNegyzet,
    dokumentumok: dokumentumok.map(d => ({
      nev: d.nev, meret: d.meret, emptyTags: d.emptyTags,
      maradekJelolo: d.maradekJelolo, bejelolt: d.bejelolt, uresNegyzet: d.uresNegyzet,
    })),
    _szovegek: dokumentumok.map(d => ({ nev: d.nev, szoveg: d.szoveg })),
  };

  console.log('jelölők:', jelolok.length,
              '| felismert:', felismert.length, '| ismeretlen:', ismeretlen.length);
  console.log('ismeretlen:', ismeretlen);
  console.log('CHECK jelölők:', checkJelolok.length, '| nyers ☐/☒:', nyersNegyzet);
  for (const d of osszegzes.dokumentumok) {
    console.log(`${d.nev}: ${d.meret} bájt, üres mező: ${d.emptyTags.length}, ` +
                `maradék jelölő: ${d.maradekJelolo.length}, ☒${d.bejelolt}/☐${d.uresNegyzet}`);
  }
  return osszegzes;
})();
