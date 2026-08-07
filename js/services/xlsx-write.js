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

    // A védelem csak az ÜRES sablonra való (azt küldjük ki kitöltésre).
    // A feltöltött exportot magunk dolgozzuk fel, ott csak útban lenne.
    if (!employees.length) await protectSheet(ws, cols, profile);

    addGuideSheet(wb, schema, cols, profile);
    return wb;
  }

  /**
   * Lapvédelem: a fejléc és a rejtett kulcssor ne legyen módosítható,
   * a kitölthető sorok viszont igen.
   *
   * Fontos sorrend: védelem alatt MINDEN cella alapból zárolt, ezért előbb
   * fel kell oldani az adatsorokat – különben a kitöltő egy karaktert sem
   * tudna beírni. (Ezt géppel is ellenőrizzük a tesztekben.)
   */
  async function protectSheet(ws, cols, profile) {
    const p = profile.protection;
    if (!p || !p.enabled) return;

    const elsoSor = profile.firstDataRow;
    const utolsoSor = elsoSor + (p.fillableRows || 30) - 1;

    for (let r = elsoSor; r <= utolsoSor; r++) {
      const sor = ws.getRow(r);
      for (let c = 1; c <= cols.length; c++) {
        sor.getCell(c).protection = { locked: false };
      }
    }

    // Az alapértelmezés minden szerkesztést tilt, a kijelölést engedi.
    // A sorformázás tiltása az, ami miatt a rejtett kulcssor rejtve marad.
    await ws.protect(p.password || '', {
      selectLockedCells:   true,
      selectUnlockedCells: true,
      formatColumns:       true,   // oszlopszélesség állítható maradjon
      formatRows:          false,  // ezzel nem fedhető fel az 1. sor
    });
  }

  /**
   * 1. sor: gépi kulcsok (kötelező = piros) – a programnak kell az importhoz,
   *         ezért alapból REJTETT (profile.hideKeyRow).
   * 2. sor: angol címkék – ez az, amit a kitöltő lát, ezért a kitöltést segítő
   *         komment is IDE kerül, nem a rejtett sorba.
   */
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

      const lc = labelRow.getCell(c);
      lc.value = f.label.en || f.label.hu;
      lc.font = { name: st.headerFont.name, size: st.headerFont.size,
                  bold: st.headerFont.bold, color: argb(st.headerFont.color) };
      lc.fill = { type: 'pattern', pattern: 'solid',
                  fgColor: argb(f.required ? st.requiredFill : st.labelFill) };
      lc.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      lc.border = { bottom: { style: 'medium' } };
      lc.note = buildNote(f);
    });

    keyRow.height   = st.keyRowHeight;
    labelRow.height = st.labelRowHeight;

    // A kulcssor a programé, nem a kitöltőé – ne kelljen ránéznie.
    // (Rejtve is beolvasható importáláskor.)
    if (profile.hideKeyRow) keyRow.hidden = true;
  }

  /**
   * A kitöltést segítő komment – ANGOLUL ELŐL.
   *
   * A táblázatot külföldi munkavállalók töltik ki, ezért az angol az elsődleges;
   * a magyar megfelelő utána jön, hogy az ügyintéző is értse. A 2. sor
   * celláira kerül, mert az 1. sor rejtett.
   */
  function buildNote(f) {
    const sorok = [];

    sorok.push(f.label.en || f.label.hu);
    if (f.label.hu && f.label.hu !== f.label.en) sorok.push(`(magyarul: ${f.label.hu})`);

    sorok.push('');
    sorok.push(f.required
      ? 'REQUIRED — must not be left empty / KÖTELEZŐ'
      : 'Optional / Nem kötelező');

    // Ha van kézzel írt útmutató a sémában, az a mérvadó: pontosabb, mint amit
    // a típusból ki lehet találni (példát ad, kivételeket említ). Ilyenkor a
    // gépi formátum- és értékfelsorolás elmarad, mert az útmutató már tartalmazza.
    const utmutato = f.hint && (f.hint.en || f.hint.hu);
    if (utmutato) {
      sorok.push('');
      if (f.hint.en) sorok.push(f.hint.en);
      if (f.hint.hu) sorok.push(f.hint.hu);
    } else {
      if (f.type === 'date') {
        sorok.push('Format: YYYY-MM-DD (e.g. 1990-03-15)');
        sorok.push('Formátum: ÉÉÉÉ-HH-NN');
      }
      if (f.type === 'number') {
        sorok.push('Numbers only / Csak szám');
      }
      if (f.type === 'enum') {
        sorok.push('Choose from the drop-down list:');
        for (const v of f.values) {
          sorok.push(`  ${v.id} = ${v.en || v.id}  (${v.hu})`);
        }
      }
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

  // A fejlesztés során EGYSZER előfordult, hogy a writeBuffer() nem tért vissza
  // (a UI némán megállt). Sokszori újraméréssel nem sikerült reprodukálni –
  // minden alkalommal 17–26 ms alatt lefutott –, ezért az okát nem ismerjük.
  //
  // Amíg nem tudjuk, legalább ne néma fagyás legyen belőle: ha a kiírás
  // ésszerű időn belül nem fejeződik be, hibát dobunk, amit a hívó meg tud
  // jeleníteni és a napló rögzít. A határ ezerszerese a mért időnek, tehát
  // lassú gépen sem szólal meg tévesen.
  const IRAS_HATARIDO_MS = 30000;

  async function toBuffer(opts) {
    const wb = await build(opts);

    let idozito;
    const hatarido = new Promise((_, elutasit) => {
      idozito = setTimeout(() => elutasit(new Error(
        `Az xlsx kiírása ${IRAS_HATARIDO_MS / 1000} másodperc alatt sem fejeződött be. ` +
        'Próbáld újra; ha ismétlődik, jelezd — ez egy ismert, még nem tisztázott hiba.'
      )), IRAS_HATARIDO_MS);
    });

    try {
      return await Promise.race([wb.xlsx.writeBuffer(), hatarido]);
    } finally {
      clearTimeout(idozito);
    }
  }

  /**
   * Az ÜRES sablon neve fix: ezt küldjük ki kitöltésre, ott a dátumos-verziós
   * név csak zavar. A FELTÖLTÖTT export viszont pillanatkép az adatokról,
   * ahol a dátum hasznos – különben az egymás utáni mentések felülírnák egymást.
   */
  function suggestFilename(profile, filled) {
    const alap = (profile.fileName || profile.id || 'adatbekero')
      .replace(/[^a-zA-Z0-9_-]/g, '');
    if (!filled) return `${alap}.xlsx`;
    const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `${alap}-adatok-${d}.xlsx`;
  }

  return { build, toBuffer, suggestFilename, _colLetter: colLetter };
})();
