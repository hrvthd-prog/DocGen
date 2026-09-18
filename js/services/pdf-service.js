'use strict';

/**
 * PDF-előállítás – az app SAJÁT rajzolású PDF-jeinek alapja.
 *
 * Két, élesen külön PDF-út van az appban, és ez a fájl csak az egyiket szolgálja ki:
 *
 *   Word-hű irat (sablonból generált kérelem, nyomtatvány)
 *       → a Word készíti (tools/docx-pdf.vbs). A docx belső tördelését egyedül
 *         a Word ismeri; ezt böngészőből nem lehet és nem is szabad utánozni.
 *
 *   Saját lap (díjátutalási lap, listák) ← EZ A FÁJL
 *       → mi rajzoljuk pdf-lib-bel. Nincs külső lépés, nincs kézi konverzió,
 *         determinisztikus és tesztelhető.
 *
 * Az összefűzés (modules/docgen/merge.js) továbbra is lapmásolás: a Word által
 * előállított oldalak változatlanul kerülnek a csomagba – betűkészlet nem kell hozzá.
 *
 * ── A betűkészlet kérdése ──────────────────────────────────────────────────
 * A pdf-lib beépített betűi WinAnsi-kódolásúak, amiben NINCS `ő` és `ű`. Magyar
 * iratot ezért csak beágyazott betűkészlettel lehet készíteni, ahhoz pedig a
 * pdf-lib fontkitet kér. Innen a két vendor-fájl.
 *
 * A Carlito metrikában Calibri-kompatibilis (a kiváltott Excel-munkafüzet betűje),
 * és lefedi a nyilvántartásban ténylegesen előforduló neveket: magyar, vietnámi,
 * cirill, török, román, lengyel, horvát.
 */
const PdfService = (() => {

  // A4 fekvő, pontban. A pdf-lib PageSizes.A4 állót ad – itt a lapok fekvők.
  const A4_LANDSCAPE = [841.89, 595.28];

  let _fontsPromise = null;

  function _lib() {
    const L = (typeof PDFLib !== 'undefined') ? PDFLib
            : (typeof globalThis !== 'undefined' ? globalThis.PDFLib : null);
    if (!L) throw new Error('A pdf-lib könyvtár nem érhető el.');
    return L;
  }

  function _fontkit() {
    const fk = (typeof fontkit !== 'undefined') ? fontkit
             : (typeof globalThis !== 'undefined' ? globalThis.fontkit : null);
    if (!fk) throw new Error('A fontkit könyvtár nem érhető el.');
    return fk;
  }

  /** Van-e egyáltalán PDF-képessége az appnak? (a felület ezzel dönt gombokról) */
  function available() {
    try { _lib(); _fontkit(); return true; } catch { return false; }
  }

  /**
   * A betűkészlet 1,7 MB – ezért csak az első tényleges PDF-készítéskor töltjük be.
   *
   * `<script>` beszúrással, NEM fetch-csel: az app file:// protokollról fut, ahol
   * a fetch a helyi fájlokra tiltott (átlátszatlan origin). Ugyanez az ok, amiért
   * a betűkészlet base64-ként, JS-forrásban él (lásd tools/font-bundle.js).
   */
  function _loadFonts() {
    const kesz = (typeof CARLITO_FONTS !== 'undefined') ? CARLITO_FONTS
               : (typeof globalThis !== 'undefined' ? globalThis.CARLITO_FONTS : null);
    if (kesz) return Promise.resolve(kesz);

    if (typeof document === 'undefined') {
      return Promise.reject(new Error('A betűkészlet nincs betöltve (CARLITO_FONTS).'));
    }
    if (_fontsPromise) return _fontsPromise;

    _fontsPromise = new Promise((res, rej) => {
      const v = (typeof window !== 'undefined' && window.APP_VERZIO) ? window.APP_VERZIO.verzio : '';
      const s = document.createElement('script');
      s.src = 'vendor/carlito-fonts.js' + (v ? '?v=' + v : '');
      s.onload  = () => window.CARLITO_FONTS
        ? res(window.CARLITO_FONTS)
        : rej(new Error('A betűkészlet-fájl betöltődött, de üres.'));
      s.onerror = () => {
        _fontsPromise = null;          // maradjon újrapróbálható
        rej(new Error('A betűkészlet nem tölthető be: vendor/carlito-fonts.js'));
      };
      document.head.appendChild(s);
    });
    return _fontsPromise;
  }

  function _bytes(b64) {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /**
   * Új dokumentum beágyazott betűkészletekkel.
   *
   * ── MIÉRT NINCS RÉSZHALMAZOLÁS (subset) ────────────────────────────────────
   * A `subset: true` kézenfekvő lenne – 7 kB-os PDF-et ad 278 kB helyett –, de
   * ezzel a fontkit-építéssel MEGROMLANAK a betűk. Lemérve: a 34 glifás
   * részhalmazból 17 rajzolható, 4 üres, 13 pedig olvashatatlan. A lapon ez úgy
   * néz ki, hogy a szöveg fele egyszerűen hiányzik – miközben a PDF szövegrétege
   * hibátlan, tehát másolásnál és keresésnél minden rendben van.
   *
   * Ez a legrosszabb fajta hiba: a fájl érvényes, a teszt zöld lehet tőle, és
   * csak akkor derül ki, amikor valaki ránéz a kinyomtatott lapra. A méret nem
   * ok az elfogadására – a kiváltott Excel ugyanezt a lapot 319 kB-ban adta.
   *
   * A `test/pdf-service.test.js` a beágyazott betűkészlet MINDEN glifáját
   * ellenőrzi, hogy ez a döntés ne legyen véletlenül visszavonható.
   */
  async function newDocument() {
    const { PDFDocument } = _lib();
    const fonts = await _loadFonts();
    const doc = await PDFDocument.create();
    doc.registerFontkit(_fontkit());
    return {
      doc,
      font: await doc.embedFont(_bytes(fonts.regular), { subset: false }),
      bold: await doc.embedFont(_bytes(fonts.bold),    { subset: false }),
    };
  }

  function addPage(doc, meret = A4_LANDSCAPE) { return doc.addPage(meret); }

  /**
   * Megjeleníthetővé tesz egy tetszőleges forrásból jött szöveget.
   *
   * A nevek XLSX-importból jönnek, vagyis bármi lehet bennük. A vezérlőkarakter
   * a PDF-rajzolást elhasalasztja, a nem normalizált ékezet (`o` + kombináló jel)
   * pedig külön glifát keres, ami a beágyazott készletben nincs meg – a név
   * helyén üres négyzet jelenne meg. Mindkettő itt dől el, egy helyen.
   *
   * ponytail: a készletből HIÁNYZÓ írásjel (pl. kínai név) továbbra is .notdef
   * négyzetként jelenik meg – látható hiány, de nem hibás fájl. Ha valaha kell,
   * a továbblépés glifa-ellenőrzés fontkittel + jelzés a felhasználónak.
   */
  function sanitize(s) {
    const ki = [];
    for (const ch of String(s == null ? '' : s).normalize('NFC')) {
      const c = ch.codePointAt(0);
      if (c === 0x09 || c === 0x0A || c === 0x0D) { ki.push(' '); continue; }  // sortörés a cellában: szóköz
      if (c < 0x20) continue;                                   // egyéb vezérlőkarakter
      if (c >= 0x7F && c <= 0x9F) continue;                     // C1 vezérlőtartomány
      if (c >= 0x200B && c <= 0x200F) continue;                 // nulla szélességű és irányjelölők
      if (c === 0xFEFF) continue;                               // BOM a szöveg közepén
      ki.push(ch);
    }
    return ki.join('').replace(/ {2,}/g, ' ').trim();
  }

  /**
   * Szöveg kirajzolása igazítással és szélesség-korláttal.
   *
   * A korlát azért kell, mert a cellák fix szélesek: egy hosszú név vagy
   * közlemény enélkül átlógna a szomszéd oszlopba, és a lap olvashatatlan
   * lenne. Csonkoláskor `…` jelzi, hogy nem a teljes érték látszik.
   */
  function drawText(page, str, { x, y, size = 10, font, color = null, align = 'left', maxWidth = null }) {
    const { rgb } = _lib();
    let t = sanitize(str);
    if (!t) return 0;

    let w = font.widthOfTextAtSize(t, size);
    if (maxWidth && w > maxWidth) {
      while (t.length > 1 && font.widthOfTextAtSize(t + '…', size) > maxWidth) t = t.slice(0, -1);
      t += '…';
      w = font.widthOfTextAtSize(t, size);
    }

    const bx = align === 'right'  ? x - w
             : align === 'center' ? x - w / 2
             : x;
    page.drawText(t, { x: bx, y, size, font, color: color || rgb(0, 0, 0) });
    return w;
  }

  return { available, newDocument, addPage, drawText, sanitize, A4_LANDSCAPE };
})();
