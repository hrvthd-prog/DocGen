'use strict';

/**
 * Ügy- és dolgozói kimutatás xlsx-ben.
 *
 * Miért külön az adatbekérőtől (`XlsxWrite`)? Az adatbekérő egy KITÖLTENDŐ
 * űrlap: a szerkezetét a séma és az export-profil adja, és vissza is kell
 * tudni olvasni. Ez itt pillanatkép — nem megy vissza sehova, kézzel
 * olvassák, szűrik, nyomtatják. Két külön cél, két külön alak; egy fájlba
 * gyúrva mindkettő romlana.
 *
 * Két lap:
 *   „Ügyek"    – dolgozónként az ügyek, EH számmal (hatósági ügyszám) és
 *                iktatószámmal. Ez a lap a kimutatás lényege.
 *   „Dolgozók" – a nyilvántartás mezői, az export-profil oszlopsorrendjében.
 *
 * Minden érték SZÖVEGKÉNT megy ki, a tárolt alakban. Az ügyszámok és
 * iktatószámok tagolt azonosítók, amiket az Excel szívesen számmá vagy
 * dátummá alakítana — a nyers alak az egyetlen, ami hatóság előtt használható.
 */
const CaseXlsx = (() => {

  const UGY_OSZLOPOK = [
    { fej: 'Dolgozó',     szelesseg: 26, ertek: (c, nev) => nev },
    { fej: 'Ügytípus',    szelesseg: 28, ertek: c => CaseTypes.title(c) },
    { fej: 'Állapot',     szelesseg: 18, ertek: c => CaseTypes.statusLabel(c.type, c.status) || c.status },
    { fej: 'EH szám',     szelesseg: 22, ertek: c => c.ehNumber || '' },
    { fej: 'Iktatószám',  szelesseg: 22, ertek: c => c.fileNumber || '' },
    { fej: 'Indult',      szelesseg: 12, ertek: c => c.openedAt || '' },
    { fej: 'Határidő',    szelesseg: 12, ertek: c => c.dueAt || '' },
    { fej: 'Lezárva',     szelesseg: 12, ertek: c => (c.closedAt || '').slice(0, 10) },
    { fej: 'Eredmény',    szelesseg: 24, ertek: c => c.outcome ? (CaseTypes.outcomeLabel(c.outcome) || c.outcome) : '' },
    { fej: 'Megjegyzés',  szelesseg: 40, ertek: c => c.note || '' },
  ];

  function nevOf(emp) {
    if (!emp) return '(törölt személy)';
    const v = SchemaStore.resolveValues(emp.fields, 'hu');
    return [v.surname, v.forename].filter(Boolean).join(' ') || '(névtelen)';
  }

  /**
   * Cellánként írunk, nem `addRow([...])`-val.
   *
   * Az ExcelJS a tömböt `instanceof Array`-jel ismeri fel, ami a Node-tesztek
   * vm-sandboxában (más realm) hamis — ott az addRow néma, üres sorokat
   * hagyna. A cellánkénti írás realm-független, és ugyanitt a formátumot is
   * egy helyen adja meg.
   */
  function sorBe(ws, sorszam, ertekek, { fejlec = false } = {}) {
    const sor = ws.getRow(sorszam);
    ertekek.forEach((v, i) => {
      const cella = sor.getCell(i + 1);
      cella.value = v == null ? '' : String(v);
      if (!fejlec) cella.numFmt = '@';
    });
    if (fejlec) sor.font = { bold: true };
    sor.commit();
    return sor;
  }

  /** Fejlécsor: félkövér, fagyasztva, autoszűrővel — ezt úgyis mindenki szűri. */
  function fejlec(ws, oszlopok) {
    oszlopok.forEach((o, i) => { ws.getColumn(i + 1).width = o.szelesseg; });
    sorBe(ws, 1, oszlopok.map(o => o.fej), { fejlec: true });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 },
                      to: { row: 1, column: oszlopok.length } };
  }

  async function build() {
    if (typeof ExcelJS === 'undefined') {
      throw new Error('Az ExcelJS könyvtár nem érhető el.');
    }
    const wb = new ExcelJS.Workbook();
    wb.created = new Date();

    const dolgozok = EmployeeRepo.all({ includeExited: true });
    const nevek = new Map(dolgozok.map(e => [e.id, nevOf(e)]));

    // ── Ügyek ───────────────────────────────────────────────────────────────
    const ugyLap = wb.addWorksheet('Ügyek');
    fejlec(ugyLap, UGY_OSZLOPOK);

    const ugyek = CaseRepo.all().slice().sort((a, b) => {
      const na = nevek.get(a.employeeId) || '', nb = nevek.get(b.employeeId) || '';
      return na.localeCompare(nb, 'hu') ||
             String(a.openedAt || '').localeCompare(String(b.openedAt || ''));
    });
    ugyek.forEach((c, i) => {
      const nev = nevek.get(c.employeeId) || '(törölt személy)';
      sorBe(ugyLap, i + 2, UGY_OSZLOPOK.map(o => o.ertek(c, nev)));
    });

    // ── Dolgozók ────────────────────────────────────────────────────────────
    const schema = SchemaStore.get();
    const mezok = ExportProfiles.columnsOf(ExportProfiles.get(), schema);
    const dolgLap = wb.addWorksheet('Dolgozók');
    fejlec(dolgLap, mezok.map(f => ({ fej: f.label && f.label.hu ? f.label.hu : f.key, szelesseg: 20 })));
    dolgozok.forEach((e, i) => {
      sorBe(dolgLap, i + 2,
        mezok.map(f => SchemaStore.renderValue(f, (e.fields || {})[f.key], 'hu')));
    });

    return { wb, ugyekSzama: ugyek.length, dolgozokSzama: dolgozok.length };
  }

  async function toBuffer() {
    const { wb, ugyekSzama, dolgozokSzama } = await build();
    return { buffer: await wb.xlsx.writeBuffer(), ugyekSzama, dolgozokSzama };
  }

  // ── SAP-ticket táblázat (plans/TERV-kimenet-es-ugyek.md 6.3) ──────────────
  // A minta: Ticket_SAP_TR.xlsx (a back office-tól). Egy lap, „Munka1”; az 1. sor
  // szürke, keretes fejléc, alatta soronként egy dolgozó, középre zárt, keretes
  // cellák; a dátum valódi dátumcella a beépített rövid dátumformátummal.
  const SAP_OSZLOPOK = [
    ['Régi TSz', 9], ['Név', 28], ['Új TSZ', 9], ['Kilépés', 10.1], ['Új belépés', 12],
    ['Időrögzítési ügyintéző', 18], ['Felettes', 17.7], ['K2', 16.7],
    ['Új határozott idő lejárta', 21.9], ['Dokumentum jellege', 17.7],
    ['Dokumentum száma', 19.4], ['Dokumentum dátuma', 20.9],
  ];
  const UJ_TSZ = 2;          // az „Új TSZ”-t a back office adja — mindig üres

  /** „2026-10-27” → Date (UTC éjfél, hogy az Excel-sorszám pontosan az a nap legyen) */
  function napDatum(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  }

  /** → { buffer, hianyzik: [üresen maradt oszlopok] } */
  async function sap(c, { kilepes = null, belepes = null } = {}) {
    if (typeof ExcelJS === 'undefined') throw new Error('Az ExcelJS könyvtár nem érhető el.');
    const emp = EmployeeRepo.get(c.employeeId);
    const v = SchemaStore.resolveValues((emp && emp.fields) || {}, 'hu');
    const ertekek = [
      v.personnel_reg_number || '', emp ? nevOf(emp) : '', '',
      napDatum(kilepes), napDatum(belepes),
      v.hr_time_admin || '', v.hr_direct_leader || '', v.hr_k2 || '',
      napDatum(c.validUntil), 'Határozat', c.fileNumber || '', napDatum(c.closedAt),
    ];
    const hianyzik = SAP_OSZLOPOK.map(o => o[0]).filter((_, i) => i !== UJ_TSZ && !ertekek[i]);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Munka1');
    const keret = { top: { style: 'thin' }, left: { style: 'thin' },
                    bottom: { style: 'thin' }, right: { style: 'thin' } };
    // Cellánként (lásd sorBe): az addRow tömbje a vm-sandboxban néma maradna.
    SAP_OSZLOPOK.forEach(([fej, szel], i) => {
      ws.getColumn(i + 1).width = szel;
      const h = ws.getRow(1).getCell(i + 1);
      h.value = fej;
      h.border = keret;
      h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
      const d = ws.getRow(2).getCell(i + 1);
      d.value = ertekek[i] || null;
      d.border = keret;
      d.alignment = { horizontal: 'center', vertical: 'middle' };
      // 'mm-dd-yy' = a 14-es beépített formátum: a magyar Excel „2026. 10. 27.”-ként mutatja
      if (ertekek[i] instanceof Date) d.numFmt = 'mm-dd-yy';
    });
    return { buffer: await wb.xlsx.writeBuffer(), hianyzik };
  }

  /** A fájlnév a dokumentumtípus-elöl szabállyal. */
  function sapFilename(c) {
    const nev = nevOf(EmployeeRepo.get(c.employeeId)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
    return `SAP-ticket — ${nev}.xlsx`;
  }

  function suggestFilename() {
    return `ugyek-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`;
  }

  return { build, toBuffer, suggestFilename, sap, sapFilename, SAP_OSZLOPOK };
})();
