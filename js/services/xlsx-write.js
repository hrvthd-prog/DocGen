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

    // A fejlécen kívül az első néhány oszlop is álljon: hetven oszlopnál a
    // vízszintes görgetés után nem látszana, kinek a sorát töltjük ki.
    const ws = wb.addWorksheet(profile.sheetName, {
      views: [{ state: 'frozen', ySplit: profile.labelRow, xSplit: st.freezeColumns || 0 }],
    });

    // Oszlopszélességek: a magyar címke hossza alapján, ésszerű határok között
    ws.columns = cols.map(f => ({
      width: Math.min(38, Math.max(10, (f.label.hu || f.key).length + 4)),
    }));

    writeHeader(ws, cols, profile, st);
    writeDateFormats(ws, cols, profile);
    writeValidations(ws, cols, profile, st);
    writeRows(ws, cols, profile, schema, employees);

    // A védelem csak az ÜRES sablonra való (azt küldjük ki kitöltésre).
    // A feltöltött exportot magunk dolgozzuk fel, ott csak útban lenne.
    if (!employees.length) await protectSheet(ws, cols, profile);

    addGuideSheet(wb, schema, cols, profile);
    addPrintSheet(wb, schema, cols, profile);
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

      // Csoportszín, de a kötelezőség erősebb jelzés: az piros marad.
      const csoportSzin = (st.groupFill && st.groupFill[f.group]) || null;
      // A csoport első oszlopát vastag vonal választja el az előzőtől.
      const ujCsoport = i > 0 && cols[i - 1].group !== f.group;
      const bal = ujCsoport ? { left: { style: 'medium' } } : {};

      const kc = keyRow.getCell(c);
      kc.value = f.key;
      kc.font = { name: st.headerFont.name, size: st.headerFont.size,
                  bold: st.headerFont.bold, color: argb(st.headerFont.color) };
      kc.fill = { type: 'pattern', pattern: 'solid',
                  fgColor: argb(f.required ? st.requiredFill : (csoportSzin || st.optionalFill)) };
      kc.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      kc.border = Object.assign({ bottom: { style: 'thin' } }, bal);

      const lc = labelRow.getCell(c);
      lc.value = f.label.en || f.label.hu;
      lc.font = { name: st.headerFont.name, size: st.headerFont.size,
                  bold: st.headerFont.bold, color: argb(st.headerFont.color) };
      lc.fill = { type: 'pattern', pattern: 'solid',
                  fgColor: argb(f.required ? st.requiredFill : (csoportSzin || st.labelFill)) };
      lc.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      lc.border = Object.assign({ bottom: { style: 'medium' } }, bal);
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

  /**
   * Dátumoszlopok megjelenítési formátuma.
   *
   * Formátum nélkül az Excel a beírt „1990-03-15"-öt valódi dátummá alakítja,
   * és a KITÖLTŐ GÉPÉNEK területi beállítása szerint mutatja: angol
   * rendszeren „3/15/1990" lesz belőle. Az útmutató ÉÉÉÉ-HH-NN alakot kér,
   * a kitöltő viszont mást lát, mint amit beírt – ezért azt hiszi, elrontotta,
   * és átírja. (A beolvasás ettől függetlenül helyes: a tárolt sorszámot
   * olvassuk, nem a megjelenített szöveget.)
   *
   * A formátum az EGÉSZ oszlopra megy, nem csak a kitölthető sorokra: aki
   * beszúr egy sort, annak is ÉÉÉÉ-HH-NN-t mutasson.
   */
  function writeDateFormats(ws, cols, profile) {
    cols.forEach((f, i) => {
      if (f.type !== 'date') return;
      ws.getColumn(i + 1).numFmt = 'yyyy-mm-dd';
    });
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

  /**
   * A kitöltési útmutató is a sémából áll elő – nem kézzel karbantartott szöveg.
   *
   * KÉT OLVASÓJA VAN, ezért kétnyelvű: a táblázatot külföldi munkavállaló
   * tölti ki (neki az angol oszlopok és az angol szabályok szólnak), az
   * ügyintéző pedig a magyar jelentést és a gépi kulcsot keresi benne.
   *
   * Az angol útmutató-szöveg (`hint.en`) eddig CSAK a cellakommentben volt
   * elérhető. Aki nem tudta, hogy a fejlécre kell mutatni az egérrel, annak a
   * példák és a kivételek láthatatlanok maradtak – ezért itt is kiírjuk.
   */
  function addGuideSheet(wb, schema, cols, profile) {
    if (!profile.guideSheetName) return;
    const ws = wb.addWorksheet(profile.guideSheetName);
    ws.columns = [{ width: 30 }, { width: 34 }, { width: 24 }, { width: 12 },
                  { width: 40 }, { width: 34 }, { width: 62 }];

    const cim = ws.getRow(1);
    cim.getCell(1).value = 'Munkavállalói adatbekérő – kitöltési útmutató / Employee data sheet – how to fill it in';
    cim.getCell(1).font = { name: 'Arial', size: 12, bold: true };
    ws.getRow(2).getCell(1).value =
      `DocGen · generálva: ${new Date().toISOString().slice(0, 10)} · séma v${schema.version}`;
    ws.getRow(2).getCell(1).font = { name: 'Arial', size: 9, color: argb('FF808080') };

    const szabalyok = [
      ['HOW TO FILL IT IN / KITÖLTÉSI SZABÁLYOK', true],
      [`1. Fill in ONE ROW per person, starting in row ${profile.firstDataRow} of the "${profile.sheetName}" sheet.`, false],
      [`   Egy személy = egy sor, a "${profile.sheetName}" lap ${profile.firstDataRow}. sorától.`, false],
      ['2. RED header = mandatory. Every red column must be filled in, in every row.', false],
      ['   A piros fejlécű mezők kötelezők. A többi fejlécszín a rovatcsoportot jelöli.', false],
      ['3. All dates: YYYY-MM-DD (example: 1990-03-15).', false],
      ['   Minden dátum ÉÉÉÉ-HH-NN alakban.', false],
      ['4. In drop-down columns choose from the list — do not type your own wording.', false],
      ['   A legördülős mezőkbe a listából válassz.', false],
      ['5. Hover over a header cell: a help note appears with an example.', false],
      ['   Magyar magyarázat: vidd az egeret a fejléc cella sarkán lévő jelre.', false],
      ['6. Leave a cell EMPTY if you do not have the data. Do not write "-", "n/a" or a guess.', false],
      ['   Amit nem tudsz, hagyd üresen – ne írj bele találgatást.', false],
      [`7. Do not change or delete row ${profile.keyRow} and do not add new columns — the import reads those names.`, false],
      [`   Az ${profile.keyRow}. sort és az oszlopokat ne módosítsd.`, false],
      ['8. The same person must not appear twice in one file.', false],
      ['   Egy fájlon belül ne szerepeljen kétszer ugyanaz a személy.', false],
      ['', false],
      ['CONFIDENTIAL / BIZALMAS', true],
      ['This file contains personal data (passport, tax and social security number, bank account).', false],
      ['Send it back only to the requesting HR contact, and do not forward it to anyone else.', false],
      ['A fájl személyes és pénzügyi adatot tartalmaz – csak a bekérő HR-kapcsolattartónak küldd vissza.', false],
      ['Columns marked "filled by HR" are not for you to complete. / A „filled by HR" rovatokat a HR tölti ki.', false],
    ];
    szabalyok.forEach(([s, bold], i) => {
      const r = ws.getRow(4 + i);
      r.getCell(1).value = s;
      if (bold) r.getCell(1).font = { name: 'Arial', size: 10, bold: true };
    });

    const fejlecSor = 4 + szabalyok.length + 1;
    const fejlec = ['Oszlopnév (gépi)', 'Magyar jelentés', 'Csoport', 'Kötelező',
                    'Megjegyzés / lehetséges értékek', 'English label', 'Guidance / útmutató'];
    const fr = ws.getRow(fejlecSor);
    fejlec.forEach((h, i) => {
      const c = fr.getCell(i + 1);
      c.value = h;
      c.font = { name: 'Arial', size: 10, bold: true, color: argb('FFFFFFFF') };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: argb('FF1F3864') };
      c.alignment = { vertical: 'middle', wrapText: true };
    });

    const st = profile.style || {};
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
      r.getCell(6).value = f.label.en || '';
      r.getCell(7).value = [f.hint && f.hint.en, f.hint && f.hint.hu].filter(Boolean).join('\n');
      r.getCell(7).alignment = { wrapText: true, vertical: 'top' };
      if (f.required) r.getCell(4).font = { bold: true, color: argb('FFC00000') };
      // Ugyanaz a csoportszín, mint a Data lap fejlécén – a két lap így
      // összeköthető szemmel is.
      const szin = st.groupFill && st.groupFill[f.group];
      if (szin) {
        r.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: argb(szin) };
        r.getCell(3).font = { color: argb('FFFFFFFF') };
      }
    });

    ws.views = [{ state: 'frozen', ySplit: fejlecSor }];
  }

  // ── Nyomtatási lapfül (HR adatlap) ─────────────────────────────────────────

  /**
   * A HR „Personal Data Sheet"-je nyomtatható alakban, MAKRÓ NÉLKÜL.
   *
   * A lap tetején egyetlen írható cella áll: a személy sora a `Data` lapon.
   * Minden érték INDEX-képlettel onnan jön, tehát a lap magától frissül, és a
   * HR a szokásos Ctrl+P / „Mentés PDF-ként" úton kap kész dokumentumot.
   *
   * Miért képlet és nem VBA: a makrós munkafüzet `.xlsm`, azt a céges
   * levélszűrők és a makróvédelem blokkolhatja, az ExcelJS pedig nem tud
   * VBA-projektet írni – a sablon így nem lenne generálható. A képlet ugyanazt
   * adja, nulla üzemeltetési kockázattal.
   *
   * Az elrendezés a profilból jön (`profile.printSheet`): ez a függvény csak
   * lerendereli. Ismeretlen mezőkulcsú sor kimarad – ha valaki mezőt töröl a
   * sémából, a lap nem törik el, csak rövidebb lesz.
   */
  function addPrintSheet(wb, schema, cols, profile) {
    const p = profile.printSheet;
    if (!p || !Array.isArray(p.sections)) return;

    const ws = wb.addWorksheet(p.name);
    ws.columns = [{ width: p.labelWidth || 46 }, { width: p.valueWidth || 54 }];

    // A4, egy oldal szélességben – enélkül a hosszabb értékek átcsúsznak a
    // második oldalra, és a HR két lapot nyomtat egy adatlap helyett.
    ws.pageSetup = {
      paperSize: 9, orientation: 'portrait',
      fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.6, right: 0.4, top: 0.6, bottom: 0.5, header: 0.3, footer: 0.3 },
    };

    let r = 1;
    ws.mergeCells(r, 1, r, 2);
    const cim = ws.getCell(r, 1);
    cim.value = p.title || 'Personal Data Sheet';
    cim.font = { name: 'Arial', size: 14, bold: true };
    cim.alignment = { horizontal: 'center' };
    ws.getRow(r).height = 24;
    r += 1;

    // A vezérlőcella. Ez az EGYETLEN hely, ahova a HR ír.
    const valasztoSor = r;
    ws.getCell(r, 1).value = p.selectorLabel || 'Employee row (1–30):';
    ws.getCell(r, 1).font = { name: 'Arial', size: 10, bold: true };
    const valaszto = ws.getCell(r, 2);
    valaszto.value = 1;
    valaszto.font = { name: 'Arial', size: 12, bold: true };
    valaszto.alignment = { horizontal: 'center' };
    valaszto.fill = { type: 'pattern', pattern: 'solid', fgColor: argb('FFFFF2CC') };
    valaszto.border = {
      top: { style: 'medium' }, bottom: { style: 'medium' },
      left: { style: 'medium' }, right: { style: 'medium' },
    };
    ws.getRow(r).height = 20;
    r += 2;

    const valasztoRef = `$B$${valasztoSor}`;
    const lap = /^[A-Za-z0-9_]+$/.test(profile.sheetName) ? profile.sheetName
                                                         : `'${profile.sheetName}'`;
    const oszlopa = new Map(cols.map((f, i) => [f.key, colLetter(i + 1)]));

    for (const szakasz of p.sections) {
      ws.mergeCells(r, 1, r, 2);
      const sc = ws.getCell(r, 1);
      sc.value = szakasz.title;
      sc.font = { name: 'Arial', size: 10, bold: true, color: argb('FFFFFFFF') };
      sc.fill = { type: 'pattern', pattern: 'solid', fgColor: argb('FF1F3864') };
      sc.alignment = { vertical: 'middle' };
      ws.getRow(r).height = 18;
      r += 1;

      for (const sor of (szakasz.rows || [])) {
        const mezok = (sor.from || []).filter(k => oszlopa.has(k));
        if (!mezok.length) continue;   // a séma nem ismeri – kihagyjuk

        const lc = ws.getCell(r, 1);
        lc.value = sor.label;
        lc.font = { name: 'Arial', size: 10 };
        lc.alignment = { vertical: 'top', wrapText: true };
        lc.border = { bottom: { style: 'hair' } };

        const vc = ws.getCell(r, 2);
        vc.value = { formula: kepletFor(mezok, lap, oszlopa, valasztoRef, profile) };
        vc.font = { name: 'Arial', size: 10 };
        vc.alignment = { vertical: 'top', wrapText: true };
        vc.border = { bottom: { style: 'thin' } };

        // Egyetlen dátum- vagy számmező esetén a cella formátuma is stimmeljen:
        // az INDEX a tárolt értéket adja vissza, nem a megjelenítettet.
        if (mezok.length === 1) {
          const f = schema.fields.find(x => x.key === mezok[0]);
          if (f && f.type === 'date')   vc.numFmt = 'yyyy-mm-dd';
          if (f && f.type === 'number') vc.numFmt = '#,##0';
        }
        r += 1;
      }
      r += 1;
    }

    ws.headerFooter = {
      oddFooter: '&L&9Aumovio · Personal Data Sheet&C&9&D&R&9&P / &N',
    };

    // Védelem: a vezérlőcella kivételével minden zárolt, hogy a képletek ne
    // sérüljenek. Ugyanaz a jelszó, mint a Data lapon.
    const prot = profile.protection;
    if (prot && prot.enabled) {
      valaszto.protection = { locked: false };
      ws.protect(prot.password || '', {
        selectLockedCells: true, selectUnlockedCells: true, formatColumns: true,
      });
    }
  }

  /**
   * INDEX-képlet egy adatlap-sorhoz.
   *
   * Egy mező: `IF(INDEX(...)="","",INDEX(...))` – az üres cellát az INDEX
   * nullaként adná vissza, abból „0" vagy „1900-01-00" lenne a nyomtatványon.
   *
   * Több mező: szóközzel fűzzük és TRIM-elünk. A `&` operátor az üres cellát
   * üres szöveggé alakítja, a TRIM pedig a maradék szóközöket – így hiányzó
   * adatnál sem lesz lyuk vagy lógó elválasztó a sorban.
   */
  function kepletFor(mezok, lap, oszlopa, valasztoRef, profile) {
    const idx = k => {
      const b = oszlopa.get(k);
      return `INDEX(${lap}!$${b}:$${b},${valasztoRef}+${profile.labelRow})`;
    };
    if (mezok.length === 1) {
      return `IF(${idx(mezok[0])}="","",${idx(mezok[0])})`;
    }
    return `TRIM(${mezok.map(idx).join('&" "&')})`;
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
