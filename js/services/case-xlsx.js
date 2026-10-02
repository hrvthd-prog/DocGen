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
    { fej: 'Ügytípus',    szelesseg: 28, ertek: c => CaseTypes.label(c.type) },
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

  function suggestFilename() {
    return `ugyek-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`;
  }

  return { build, toBuffer, suggestFilename };
})();
