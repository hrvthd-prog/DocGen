'use strict';

/**
 * Kitölthető PDF-sablon kitöltése (TERV-pdf-nyomtatvany.md).
 *
 * A sablon egy PDF űrlapmezőkkel; a MEZŐ NEVE a DocGen-jelölő, ugyanaz a
 * szókincs, mint a Word-sablonban. A mezők helyére a saját, ékezetbiztos
 * betűnkkel (Carlito) rajzolunk, utána a mezőket eltávolítjuk — a kimenet
 * nem kitölthető, és minden nézőben ugyanúgy néz ki. A pdf-lib saját
 * mezőkitöltését szándékosan nem használjuk: a beépített betűi WinAnsi-
 * kódolásúak (nincs bennük ő/ű), és a megjelenést nézőnként újrarajzolják.
 *
 * A mezőnevek jelentése:
 *   surname                     szöveg: a jelölő értéke
 *   {postal_code} {locality}    több jelölő és közbülső szöveg egy mezőben;
 *                               az üres darab elválasztója nem marad ott
 *   date_of_birth_year#2        az érték 2. betűje — egyenetlen, betűnkénti
 *                               cellákhoz (minden cella külön mező)
 *   betűnkénti (comb) mező      egyenletes cellák: betűnként egy cella
 *   jelölőnégyzet „Neme=male”   X, ha a mező értéke a megadott (mint a
 *                               Word-sablon {{CHECK:Neme=male}} jelölője)
 *   jelölőnégyzet „Beszél magyarul”   X, ha a mező igaz
 *   választógomb-csoport „Neme” X annál a gombnál, amelyiknek az értéke egyezik
 *
 * Ha a sablon /Keywords-jében ott a `docgen-nagybetu` (a PDF Műhely Szerkesztés
 * fülén egy jelölő), minden érték nagybetűvel kerül ki — egyes nyomtatványok ezt
 * kérik („nyomtatott nagybetűkkel kell kitölteni”, NEAK NYT.53).
 *
 * ponytail: elforgatott lapon (/Rotate) a mező szövege nem fordul a lappal —
 * a hatósági nyomtatványok állók. Ha kell: a page.getRotation() szerint
 * drawText({ rotate }) és a koordináták forgatása.
 */
const FormPdf = (() => {

  const MIN_SIZE = 6;       // eddig kisebbedik a betű, ha a szöveg nem fér el
  const DEF_SIZE = 10;      // ha a mező nem ad betűméretet (automatikus)
  const PAD = 2;            // belső margó a mező szélén

  // A PDF Műhely alkönyvtárai (FsService.DIR_UP / DIR_PREP) — a bélyegbe.
  const HELY = { up: '02_Feltoltheto', prep: '01_Elokeszitett' };

  function _fields(doc) {
    try { return doc.getForm().getFields(); } catch { return []; }
  }

  /** Hiba, ha a PDF nem olvasható, vagy nincs rajta űrlapmező. -> a mezők száma */
  async function check(pdfBytes) {
    const doc = await PDFLib.PDFDocument.load(pdfBytes, { updateMetadata: false });
    const n = _fields(doc).length;
    if (!n) {
      throw new Error('A PDF-en nincs űrlapmező, ezért nem sablon. Mezőt a PDF Műhely ' +
        'Szerkesztés fülén lehet rátenni (a mező neve a DocGen-jelölő).');
    }
    return n;
  }

  /** „date_of_birth_year#2” → { base: 'date_of_birth_year', nth: 2 } */
  function _split(name) {
    const m = /^(.*?)#(\d+)$/.exec(name);
    return m ? { base: m[1], nth: +m[2] } : { base: name, nth: 0 };
  }

  /** A mező értéke: egy jelölő, vagy {jelölő}-kből és szövegből álló minta. */
  function value(name, text) {
    if (!name.includes('{')) return PdfService.sanitize(text(name));
    const reszek = name.split(/\{([^}]+)\}/);     // páros index: szöveg, páratlan: jelölő
    let out = '', volt = false;
    for (let i = 1; i < reszek.length; i += 2) {
      const v = PdfService.sanitize(text(reszek[i].trim()));
      if (!v) continue;                           // az üres darab elválasztója is elmarad
      out += (volt ? reszek[i - 1] : '') + v;
      volt = true;
    }
    return volt ? PdfService.sanitize(reszek[0] + out + reszek[reszek.length - 1]) : '';
  }

  /** A mező betűmérete a /DA-ból; 0 vagy hiány = automatikus. */
  function _daSize(field) {
    try {
      const m = /([\d.]+)\s+Tf/.exec(field.acroField.getDefaultAppearance() || '');
      return m ? parseFloat(m[1]) : 0;
    } catch { return 0; }
  }

  function _wrap(font, text, size, maxW) {
    const sorok = [];
    let sor = '';
    for (const szo of text.split(' ')) {
      const proba = sor ? sor + ' ' + szo : szo;
      if (sor && font.widthOfTextAtSize(proba, size) > maxW) { sorok.push(sor); sor = szo; }
      else sor = proba;
    }
    if (sor) sorok.push(sor);
    return sorok;
  }

  /**
   * A sablon kitöltése.
   *
   * @param text     (jelölő) → szöveg; az üres jelölőt a hívó gyűjti (makeParser)
   * @param checked  (kifejezés, pl. 'Neme=male') → bool
   * @param keywords a kimenet /Keywords mezője (stampFor)
   * @returns {{ bytes, placed, overflow }}
   *   placed   a kirajzolt szövegek: { name, text, x, y, size, w } (pdf-koordináta)
   *   overflow a legkisebb betűvel sem férő mezők neve (kiírva, de átlóg)
   */
  async function fill(pdfBytes, { text, checked, keywords = '' }) {
    const { doc, font } = await PdfService.loadDocument(pdfBytes);
    const L = PDFLib;
    const form = doc.getForm();
    const placed = [], overflow = [];
    const nagy = /(^|;)\s*docgen-nagybetu\s*(;|$)/i.test(doc.getKeywords() || '');

    function draw(page, name, t, x, y, size) {
      page.drawText(t, { x, y, size, font });
      placed.push({ name, text: t, x, y, size, w: font.widthOfTextAtSize(t, size) });
    }
    const kozepre = (page, name, t, r, s) =>
      draw(page, name, t, r.x + (r.width - font.widthOfTextAtSize(t, s)) / 2,
           r.y + r.height / 2 - s * 0.35, s);

    const ertek = new Map();               // jelölőnként egyszer (a hiánynapló miatt is)
    const kerdez = n => {
      if (!ertek.has(n)) ertek.set(n, value(n, text));
      return ertek.get(n);
    };

    for (const field of form.getFields()) {
      const name = field.getName();
      const widgets = field.acroField.getWidgets();

      if (field instanceof L.PDFCheckBox || field instanceof L.PDFRadioGroup) {
        // Több gombos csoportnál a gomb saját értéke a várt érték („Neme” + „male”).
        const opciok = field instanceof L.PDFRadioGroup ? field.getOptions() : null;
        widgets.forEach((w, i) => {
          const sajat = opciok ? opciok[i] : (w.getOnValue()?.decodeText() || '');
          const kif = (opciok || widgets.length > 1) ? `${name}=${sajat}` : name;
          if (!checked(kif)) return;
          const r = w.getRectangle();
          kozepre(form.findWidgetPage(w), name, 'X', r, Math.min(r.width, r.height) * 0.9);
        });
        continue;
      }
      if (!(field instanceof L.PDFTextField || field instanceof L.PDFDropdown ||
            field instanceof L.PDFOptionList)) continue;      // gomb, aláírás: csak eltávolítjuk

      const { base, nth } = _split(name);
      let t = kerdez(base);
      if (nagy) t = t.toLocaleUpperCase('hu-HU');
      if (nth) t = [...t][nth - 1] || '';
      if (!t) continue;

      const tx = field instanceof L.PDFTextField;
      const comb = tx && field.isCombed() ? field.getMaxLength() || 0 : 0;
      const multi = tx && field.isMultiline();
      const align = tx ? field.getAlignment() : 0;

      for (const w of widgets) {
        const page = form.findWidgetPage(w);
        const r = w.getRectangle();
        const max = _daSize(field) || Math.min(DEF_SIZE, r.height * 0.75);

        if (nth) {                                   // egy betű a saját cellájában
          kozepre(page, name, t, r, Math.min(max, r.height * 0.75));
          continue;
        }
        if (comb) {                                  // egyenletes cellák
          const betuk = [...t];
          if (betuk.length > comb) overflow.push(name);
          const cw = r.width / comb;
          const s = Math.min(max, r.height * 0.75);
          betuk.slice(0, comb).forEach((ch, i) =>
            kozepre(page, name, ch, { x: r.x + i * cw, y: r.y, width: cw, height: r.height }, s));
          continue;
        }

        const hely = r.width - 2 * PAD;
        let s = max;
        if (multi) {
          let sorok = _wrap(font, t, s, hely);
          while (s > MIN_SIZE && sorok.length * s * 1.15 > r.height - PAD) {
            s -= 0.5;
            sorok = _wrap(font, t, s, hely);
          }
          if (sorok.length * s * 1.15 > r.height - PAD ||
              sorok.some(x => font.widthOfTextAtSize(x, s) > hely)) overflow.push(name);
          sorok.forEach((sor, i) =>
            draw(page, name, sor, r.x + PAD, r.y + r.height - PAD - s * (0.85 + 1.15 * i), s));
          continue;
        }
        while (s > MIN_SIZE && font.widthOfTextAtSize(t, s) > hely) s -= 0.5;
        const sw = font.widthOfTextAtSize(t, s);
        if (sw > hely) overflow.push(name);
        const x = align === 1 ? r.x + (r.width - sw) / 2
                : align === 2 ? r.x + r.width - PAD - sw
                : r.x + PAD;
        draw(page, name, t, x, r.y + r.height / 2 - s * 0.35, s);
      }
    }

    // A kimenet kész irat, nem kitölthető űrlap: a mezők eltűnnek.
    for (const field of form.getFields()) form.removeField(field);
    try { form.deleteXFA(); } catch { /* nincs XFA */ }

    if (keywords) doc.setKeywords([keywords]);
    return { bytes: await doc.save(), placed, overflow };
  }

  /**
   * A kimenet bélyege. Az aláírás nélkül kész (02) irat a PDF Műhely bélyegét
   * kapja, NEM a DocGenét: a Műhely a DocGen-bélyegből azt olvassa, hogy az irat
   * még nincs aláírva, és a Rendezés 01-be vinné. Az aláírásra váró (01) irat
   * DocGen-bélyeget kap, mint a Wordből készült PDF.
   */
  function stampFor(target, { who = '', tipus = '', today = new Date(), docgenMark = 'docgen' } = {}) {
    if (target !== 'up') return docgenMark;
    const tiszta = v => String(v || '').replace(/[;=]/g, ' ').trim();
    const p2 = n => String(n).padStart(2, '0');
    const iso = `${today.getFullYear()}-${p2(today.getMonth() + 1)}-${p2(today.getDate())}`;
    return ['pdf-muhely=1', `dolgozo=${tiszta(who)}`, `tipus=${tiszta(tipus)}`,
            `hely=${HELY.up}`, `datum=${iso}`].join(';');
  }

  return { check, fill, value, stampFor, HELY };
})();
