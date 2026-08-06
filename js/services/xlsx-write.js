'use strict';

/**
 * xlsx kiírás – ExcelJS-szel.
 *
 * Miért nem a SheetJS?
 *   A SheetJS ingyenes kiadása nem tud cellastílust, kitöltőszínt,
 *   adatérvényesítést (legördülőt) és cellakommentet *írni*. Márpedig az
 *   adatbekérő minősége pont ezeken áll. Az ExcelJS (MIT) mindezt tudja, és
 *   szintén egyetlen, telepítést nem igénylő böngészős fájl.
 *
 * Két üzemmód:
 *   – üres sablon: kitöltésre kiküldhető
 *   – feltöltött export: a nyilvántartás tartalmával, importra kész
 */
const XlsxWrite = (() => {

  function argb(v) { return { argb: v }; }

  // ── Munkafüzet felépítése ──────────────────────────────────────────────────

  /**
   * @param {object}   opts.schema     az élő séma
   * @param {object}   opts.profile    export profil
   * @param {Array}    opts.employees  rekordok (üres tömb → üres sablon)
   */
  async function build({ schema, profile, employees = [] }) {
    if (typeof ExcelJS === 'undefined') {
      throw new Error('Az ExcelJS könyvtár nem érhető el.');
    }
    const st = profile.style;
    const cols = ExportProfiles.columnsOf(profile, schema);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'DocGen';
    wb.created = new Date();

    const ws = wb.addWorksheet(profile.sheetName, {
      views: [{ state: 'frozen', ySplit: profile.labelRow }],
    });

    // Oszlopszélességek: a magyar címke hossza alapján, ésszerű határok között
    ws.columns = cols.map(f => ({
      width: Math.min(38, Math.max(10, (f.label.hu || f.key).length + 4)),
    }));

    writeHeader(ws, cols, profile, st);
    writeValidations(ws, cols, profile, st);
    writeRows(ws, cols, profile, schema, employees);

    addGuideSheet(wb, schema, cols, profile);
    return wb;
  }

  /** 1. sor: gépi kulcsok (kötelező = piros), 2. sor: angol címkék. */
  function writeHeader(ws, cols, profile, st) {
    const keyRow   = ws.getRow(profile.keyRow);
    const labelRow = ws.getRow(profile.labelRow);

    cols.forEach((f, i) => {
      const c = i + 1;

      const kc = keyRow.getCell(c);
      kc.value = f.key;
      kc.font = { name: st.headerFont.name, size: st.headerFont.size,
                  bold: st.headerFont.bold, color: argb(st.headerFont.color) };
      kc.fill = { type: 'pattern', pattern: 'solid',
                  fgColor: argb(f.required ? st.requiredFill : st.optionalFill) };
      kc.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      kc.border = { bottom: { style: 'thin' } };
      kc.note = buildNote(f);

      const lc = labelRow.getCell(c);
      lc.value = f.label.en || f.label.hu;
      lc.font = { name: st.headerFont.name, size: st.headerFont.size,
                  bold: st.headerFont.bold, color: argb(st.headerFont.color) };
      lc.fill = { type: 'pattern', pattern: 'solid', fgColor: argb(st.labelFill) };
      lc.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      lc.border = { bottom: { style: 'medium' } };
    });

    keyRow.height   = st.keyRowHeight;
    labelRow.height = st.labelRowHeight;
  }

  /** Magyar magyarázat a fejléc-cellák kommentjében. */
  function buildNote(f) {
    const sorok = [f.label.hu];
    if (f.required) sorok.push('KÖTELEZŐ – nem maradhat üres!');
    if (f.type === 'date') sorok.push('DÁTUM: ÉÉÉÉ-HH-NN (pl. 1990-03-15)');
    if (f.type === 'number') sorok.push('Szám');
    if (f.type === 'enum') {
      sorok.push('Lehetséges értékek: ' + f.values.map(v => v.id).join(', '));
      sorok.push('Magyarul: ' + f.values.map(v => v.hu).join(', '));
    }
    return { texts: [{ text: sorok.join('\n') }] };
  }

  /** Legördülők a választható mezőkre. */
  function writeValidations(ws, cols, profile, st) {
    const utolso = profile.firstDataRow + (st.validationRows || 200) - 1;
    cols.forEach((f, i) => {
      if (f.type !== 'enum' || !f.values.length) return;
      const betu = colLetter(i + 1);
      const lista = f.values.map(v => encodeEnum(f, v.id, profile)).join(',');
      ws.dataValidations.add(`${betu}${profile.firstDataRow}:${betu}${utolso}`, {
        type: 'list',
        allowBlank: true,
        formulae: [`"${lista}"`],
        showErrorMessage: true,
        errorStyle: 'warning',
        errorTitle: 'Nem a listából választott érték',
        error: 'Válassz a legördülő listából, vagy hagyd üresen.',
      });
    });
  }

  /** Adatsorok – csak feltöltött exportnál. */
  function writeRows(ws, cols, profile, schema, employees) {
    employees.forEach((emp, ri) => {
      const row = ws.getRow(profile.firstDataRow + ri);
      cols.forEach((f, ci) => {
        const cell = row.getCell(ci + 1);
        cell.value = cellValue(f, emp.fields ? emp.fields[f.key] : '', profile);
        // A dátumot szövegként tartjuk, hogy az ISO alak biztosan megmaradjon
        if (f.type === 'date') cell.numFmt = '@';
      });
    });
  }

  function cellValue(f, raw, profile) {
    if (raw == null || String(raw).trim() === '') return '';
    if (f.type === 'enum') return encodeEnum(f, raw, profile);
    if (f.type === 'number') {
      const n = Number(String(raw).replace(/\s/g, '').replace(',', '.'));
      return isNaN(n) ? String(raw) : n;
    }
    return String(raw);
  }

  function encodeEnum(f, value, profile) {
    return ValueCodec.encode(f, value, profile.enumEncoding || 'id');
  }

  function colLetter(n) {
    let s = '';
    while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
    return s;
  }

  // ── Útmutató munkalap ──────────────────────────────────────────────────────

  /** A kitöltési útmutató is a sémából áll elő – nem kézzel karbantartott szöveg. */
  function addGuideSheet(wb, schema, cols, profile) {
    if (!profile.guideSheetName) return;
    const ws = wb.addWorksheet(profile.guideSheetName);
    ws.columns = [{ width: 30 }, { width: 34 }, { width: 24 }, { width: 12 }, { width: 46 }];

    const cim = ws.getRow(1);
    cim.getCell(1).value = 'Munkavállalói adatbekérő – kitöltési útmutató';
    cim.getCell(1).font = { name: 'Arial', size: 12, bold: true };
    ws.getRow(2).getCell(1).value =
      `DocGen · generálva: ${new Date().toISOString().slice(0, 10)} · séma v${schema.version}`;
    ws.getRow(2).getCell(1).font = { name: 'Arial', size: 9, color: argb('FF808080') };

    const szabalyok = [
      'FONTOS – hogy az import ne törjön meg',
      `1. Az ${profile.keyRow}. sort (gépi oszlopnevek) NE írd át és NE töröld – az importáló ezeket keresi.`,
      '2. A piros fejlécű mezők kötelezők: soronként mindet ki kell tölteni.',
      '3. Minden dátum ÉÉÉÉ-HH-NN alakban (pl. 1990-03-15).',
      '4. A legördülős mezőkbe a listából válassz.',
      '5. Egy fájlon belül ne szerepeljen kétszer ugyanaz a személy.',
      '6. Magyar magyarázat: vidd az egeret az oszlopnév cella sarkán lévő jelre.',
    ];
    szabalyok.forEach((s, i) => {
      const r = ws.getRow(4 + i);
      r.getCell(1).value = s;
      if (i === 0) r.getCell(1).font = { name: 'Arial', size: 10, bold: true };
    });

    const fejlecSor = 4 + szabalyok.length + 1;
    const fejlec = ['Oszlopnév (gépi)', 'Magyar jelentés', 'Csoport', 'Kötelező', 'Megjegyzés / lehetséges értékek'];
    const fr = ws.getRow(fejlecSor);
    fejlec.forEach((h, i) => {
      const c = fr.getCell(i + 1);
      c.value = h;
      c.font = { name: 'Arial', size: 10, bold: true, color: argb('FFFFFFFF') };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: argb('FF1F3864') };
      c.alignment = { vertical: 'middle', wrapText: true };
    });

    const csoportNev = k => (schema.groups.find(g => g.key === k) || {}).label || k;
    cols.forEach((f, i) => {
      const r = ws.getRow(fejlecSor + 1 + i);
      r.getCell(1).value = f.key;
      r.getCell(2).value = f.label.hu;
      r.getCell(3).value = csoportNev(f.group);
      r.getCell(4).value = f.required ? 'IGEN' : '';
      let megj = '';
      if (f.type === 'enum') {
        megj = f.values.map(v => `${v.id} = ${v.hu}`).join(' · ');
      } else if (f.type === 'date') {
        megj = 'dátum: ÉÉÉÉ-HH-NN';
      } else if (f.type === 'number') {
        megj = 'szám';
      }
      r.getCell(5).value = megj;
      r.getCell(5).alignment = { wrapText: true };
      if (f.required) r.getCell(4).font = { bold: true, color: argb('FFC00000') };
    });

    ws.views = [{ state: 'frozen', ySplit: fejlecSor }];
  }

  // ── Kimenet ────────────────────────────────────────────────────────────────

  async function toBuffer(opts) {
    const wb = await build(opts);
    return wb.xlsx.writeBuffer();
  }

  function suggestFilename(profile, filled) {
    const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const alap = (profile.id || 'export').replace(/[^a-zA-Z0-9_-]/g, '');
    return `${alap}-${filled ? 'adatok' : 'sablon'}-${d}.xlsx`;
  }

  return { build, toBuffer, suggestFilename, _colLetter: colLetter };
})();
