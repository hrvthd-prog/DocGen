'use strict';

// Normalizálás: docxtemplater browser build window.docxtemplater-ként tölt be
const Docxtemplater = window.docxtemplater || window.Docxtemplater;

const DocxService = (() => {

  const CHECKED   = '☒';
  const UNCHECKED = '☐';
  const TRUTHY    = new Set(['true','1','igen','igaz','yes','y','x']);

  function formatValue(val) {
    if (val === null || val === undefined) return '';
    if (val instanceof Date) {
      if (isNaN(val.getTime())) return '';
      const y = val.getFullYear();
      const m = String(val.getMonth()+1).padStart(2,'0');
      const d = String(val.getDate()).padStart(2,'0');
      return `${y}.${m}.${d}`;
    }
    const s = String(val);
    if (s === '' || s.toLowerCase() === 'nan' || s.toLowerCase() === 'nat') return '';
    // A vezető nulla adat, nem formázás: a „03" hónap, a „0123456789" adószám.
    // Szám-normalizálás nélkül maradnak – a normalizálás az Excelből érkező
    // 450000.0-féle lebegőpontos alakok miatt kell, nem ezek miatt.
    if (/^0\d/.test(s.trim())) return s;
    const n = Number(val);
    if (!isNaN(n) && s.trim() !== '') {
      if (Number.isInteger(n)) return String(n);
      if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
    }
    return s;
  }

  /**
   * Jelölő-feloldó a sablonokhoz.
   *
   * @param data      sima objektum: kulcs = oszlopnév (a séma nélküli, régi mód)
   * @param emptyTags opcionális Set — ide kerülnek azok a jelölők, amikre nem volt adat
   * @param resolve   opcionális függvény: (mezőnév) => string | null
   *                  Ez a séma-alapú feloldás belépési pontja: ismeri a magyar és
   *                  angol változatot (`Neme` / `Neme_EN`) és a számított mezőket.
   *                  `null` = a séma nem ismeri, essünk vissza a sima kulcskeresésre.
   * @param equals    opcionális függvény: (mezőnév, várt érték) => bool | null
   *                  A `{{CHECK:Neme=male}}` alakhoz. `null` = a séma nem ismeri.
   */
  function makeParser(data, emptyTags, resolve, equals) {
    const normalized = {};
    for (const k of Object.keys(data || {})) {
      normalized[String(k).trim().toLowerCase()] = k;
    }

    function lookup(name) {
      if (resolve) {
        const v = resolve(name);
        if (v !== null && v !== undefined) return v;
      }
      const origKey = normalized[name.toLowerCase().replace(/_/g, ' ')]
                   ?? normalized[name.toLowerCase()]
                   ?? name;
      return data ? data[origKey] : '';
    }

    /**
     * Egy jelölőnégyzet állapota.
     *
     *   CHECK:Beszél magyarul   → a mező igaz-e (igen/yes/x…)
     *   CHECK:Neme=male         → a mező értéke a megadott-e
     *
     * A második alak azért kell, mert a hatósági űrlapok nem kiírják az
     * értéket, hanem a felsorolt lehetőségek közül jelölik be a jót:
     * „sex: ☐ male ☒ female". Ilyenkor soronként több négyzet ugyanarra a
     * mezőre néz, más-más várt értékkel.
     */
    function checkbox(expr) {
      const i = expr.indexOf('=');
      if (i < 0) {
        return TRUTHY.has(String(lookup(expr) ?? '').trim().toLowerCase());
      }
      const mezo = expr.slice(0, i).trim();
      const vart = expr.slice(i + 1).trim();
      if (!mezo || !vart) return false;

      if (equals) {
        const v = equals(mezo, vart);
        if (v !== null && v !== undefined) return v;
      }
      // Séma nélkül csak szöveg-egyezésre futja – kis/nagybetűre érzéketlenül.
      const ertek = String(lookup(mezo) ?? '').trim().toLowerCase();
      return !!ertek && ertek === vart.toLowerCase();
    }

    return (tag) => ({
      get: () => {
        let t = String(tag || '').trim();

        if (t.startsWith('CHECK:')) {
          return checkbox(t.slice(6).trim()) ? CHECKED : UNCHECKED;
        }

        if (t.startsWith('B:')) t = t.slice(2).trim();

        const result = formatValue(lookup(t));

        // Ha üres az eredmény és van tracker, rögzítjük a hiányzó mezőt
        if (emptyTags && result === '') emptyTags.add(t);

        return result;
      }
    });
  }

  function enrichClientRow(row) {
    const r = Object.assign({}, row);

    const anyjaV = String(r['Anyja vezetékneve'] || '').trim();
    const anyjaK = String(r['Anyja keresztneve'] || '').trim();
    if (anyjaV || anyjaK) r['Anyja neve'] = [anyjaV, anyjaK].filter(Boolean).join(' ');

    const szulOrszag = String(r['Születési hely ország'] || '').trim();
    const szulVaros  = String(r['Születési hely város']  || '').trim();
    if (szulOrszag || szulVaros) r['Születési helye'] = [szulOrszag, szulVaros].filter(Boolean).join(', ');

    r['Szállás cím']   = buildAddress(r, 'Szállás cím');
    r['Állandó lakcím'] = buildAddress(r, 'Állandó lakcím');

    return r;
  }

  function buildAddress(row, prefix) {
    const zip    = String(row[`${prefix} irányítószám`] || '').trim();
    const city   = String(row[`${prefix} település`]    || '').trim();
    const street = String(row[`${prefix} közterület`]   || '').trim();
    const type   = String(row[`${prefix} közterület jellege`] || '').trim();
    const num    = String(row[`${prefix} házszám`]      || '').trim();
    return [zip, city, [street, type].filter(Boolean).join(' '), num].filter(Boolean).join(' ');
  }

  // Visszatérési érték: { buffer: Uint8Array, emptyTags: string[] }
  // emptyTags: azon sablon-mezők nevei, melyekhez nem volt adat az import sorban
  //
  // opts.resolve: séma-alapú feloldó. Ha meg van adva, a számított mezőket a séma
  // adja, ezért az itteni (bedrótozott) összefűzés kimarad.
  async function generateDocx(templateBuffer, rowData, opts = {}) {
    const zip  = new PizZip(templateBuffer);
    const data = opts.resolve ? (rowData || {}) : enrichClientRow(rowData);
    const emptyTags = new Set();

    const doc = new Docxtemplater(zip, {
      delimiters: { start: '{{', end: '}}' },
      parser: makeParser(data, emptyTags, opts.resolve, opts.equals),
      nullGetter: () => '',
      paragraphLoop: true,
      linebreaks: true,
    });

    doc.render();

    const filled = doc.getZip().generate({ type: 'uint8array' });
    return {
      buffer:    processCheckboxes(filled, data),
      emptyTags: [...emptyTags].filter(t => t && !t.startsWith('CHECK:') && !t.startsWith('B:')),
    };
  }

  // ── sdt checkbox feldolgozás (jövőbeli Word content control sablonokhoz) ──

  const normalizeVal = v =>
    String(v === null || v === undefined ? '' : v).trim().toLowerCase().replace(/\s+/g,' ');

  function setCheckedInSdtPr(xml, checked) {
    const val = checked ? '1' : '0';
    const tagRe = /<w14:checked\b[^>]*\/?>/i;
    if (tagRe.test(xml)) {
      return xml.replace(tagRe, t =>
        /\bw14:val\s*=/.test(t)
          ? t.replace(/\bw14:val\s*=\s*(['"])(.*?)\1/i, `w14:val="${val}"`)
          : t.endsWith('/>') ? t.replace(/\/>$/, ` w14:val="${val}"/>`) : t.replace(/>$/, ` w14:val="${val}">`)
      );
    }
    return xml.replace(/<\/w:sdtPr>/i, `  <w14:checked w14:val="${val}"/></w:sdtPr>`);
  }

  function processSdt(sdtXml, rowData) {
    const prM = sdtXml.match(/<w:sdtPr\b[\s\S]*?<\/w:sdtPr>/i);
    if (!prM) return sdtXml;
    const tagM = prM[0].match(/<w:tag\b[^>]*\bw:val\s*=\s*(['"])(.*?)\1[^>]*\/?>/i);
    if (!tagM) return sdtXml;
    const raw = (tagM[2] || '').trim();
    if (!raw.includes(':')) return sdtXml;
    const [col, target] = raw.split(':').map(s => s.trim());
    if (!col) return sdtXml;
    const empVal  = normalizeVal(rowData[col] ?? '');
    const tgtVal  = normalizeVal(target);
    let checked;
    if (TRUTHY.has(tgtVal)) checked = TRUTHY.has(empVal);
    else if (new Set(['false','0','nem','hamis','no','n','']).has(tgtVal)) checked = !TRUTHY.has(empVal) && empVal !== '';
    else checked = empVal === tgtVal;
    const updatedPr = setCheckedInSdtPr(prM[0], checked);
    return sdtXml.replace(prM[0], updatedPr);
  }

  function processCheckboxes(uint8, rowData) {
    const zip = new PizZip(uint8);
    const entry = zip.file('word/document.xml');
    if (!entry) return uint8;
    const xml = entry.asText();
    const updated = xml.replace(/<w:sdt\b[\s\S]*?<\/w:sdt>/gi, sdt => processSdt(sdt, rowData));
    zip.file('word/document.xml', updated);
    return zip.generate({ type: 'uint8array' });
  }

  // Támogatott tokenek a P5 név-mintában — bővíthető struktúra
  const NAME_TOKENS = {
    '[Vezetéknév]': row => String(row['Vezetéknév'] || row['Last name'] || ''),
    '[Keresztnév]': row => String(row['Keresztnév'] || row['First name'] || ''),
  };

  // P5: ha van pattern → token-helyettesítés + .docx kiegészítés
  // Ha nincs (vagy üres/érvénytelen) → fallback a default „VEZ KER Sablon.docx" formára
  function outputFilename(templateBase, row, pattern) {
    if (pattern && typeof pattern === 'string' && pattern.trim()) {
      let result = pattern;
      for (const [token, fn] of Object.entries(NAME_TOKENS)) {
        result = result.split(token).join(fileSafe(fn(row)));
      }
      result = result.trim();
      // Védekező: ha tokenek után üres (mind üres mező volt) → fallback
      if (!result) {
        return _defaultFilename(templateBase, row);
      }
      // Whitespace-clean a token-cserék után (két szóköz között)
      result = result.replace(/\s{2,}/g, ' ').trim();
      // Tisztítás a tiltott karakterektől
      result = fileSafe(result);
      if (!result.toLowerCase().endsWith('.docx')) result += '.docx';
      return result;
    }
    return _defaultFilename(templateBase, row);
  }

  function _defaultFilename(templateBase, row) {
    const family = fileSafe(String(row['Vezetéknév'] || row['Last name'] || ''));
    const first  = fileSafe(String(row['Keresztnév'] || row['First name'] || ''));
    const tpl    = fileSafe(templateBase);
    return [family, first, tpl].filter(Boolean).join(' ') + '.docx';
  }

  // Auto-suffix: ütközéskor (n) hozzáadása
  // existing: Set<string> a már lefoglalt fájlnevekkel
  function uniqueFilename(base, existing) {
    if (!existing.has(base)) { existing.add(base); return base; }
    const dot = base.lastIndexOf('.');
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext  = dot > 0 ? base.slice(dot)    : '';
    for (let n = 2; n <= 9999; n++) {
      const candidate = `${stem} (${n})${ext}`;
      if (!existing.has(candidate)) { existing.add(candidate); return candidate; }
    }
    // Ultimate fallback (gyakorlatban sosem érjük el)
    const ts = Date.now();
    const final = `${stem}_${ts}${ext}`;
    existing.add(final);
    return final;
  }

  function fileSafe(s) { return s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim(); }
  function pad(n) { return String(n).padStart(2,'0'); }

  return {
    generateDocx,
    enrichClientRow,
    outputFilename,
    uniqueFilename,
    formatValue,
    NAME_TOKENS,
  };
})();
