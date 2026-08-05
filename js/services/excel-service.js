'use strict';

const ExcelService = (() => {

  async function _readBuf(fileHandleOrFile) {
    if (fileHandleOrFile instanceof File) return fileHandleOrFile.arrayBuffer();
    const file = await fileHandleOrFile.getFile();
    return file.arrayBuffer();
  }

  function _xlsxRead(buf, opts = {}) {
    // SheetJS full build kezeli: .xlsx, .xls, .xlsb, .xlsm, .ods stb.
    return XLSX.read(buf, { type: 'array', cellDates: true, ...opts });
  }

  // ── Látható munkalapok szűrése ─────────────────────────────────────────────
  // wb.Workbook.Sheets[i].Hidden: 0 = látható, 1 = rejtett, 2 = nagyon rejtett
  // VBA-modulok és makrólapok vagy rejtetten, vagy a SheetNames-ben sem szerepelnek
  // → csak a Hidden == 0 (illetve undefined) bejegyzéseket adjuk vissza.
  function _visibleSheetNames(wb) {
    const meta = wb.Workbook?.Sheets;
    if (!meta || !meta.length) return wb.SheetNames;   // fallback: nincs metaadat
    return meta
      .filter(s => !s.Hidden)                           // 0 / undefined → látható
      .map(s => s.name)
      .filter(n => wb.SheetNames.includes(n));          // csak ténylegesen létezők
  }

  // ── Adatolvasás (első munkalap) ────────────────────────────────────────────
  // { sheets: 0 } → SheetJS csak az első lapot parseolja; a többi cellaadata
  // fel sem töltődik memóriába → lényegesen gyorsabb nagy fájloknál.
  async function readRows(fileHandleOrFile) {
    const buf = await _readBuf(fileHandleOrFile);
    const wb = _xlsxRead(buf, { sheets: 0 });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return ws ? XLSX.utils.sheet_to_json(ws, { defval: '' }) : [];
  }

  // ── Adatolvasás (névvel megadott munkalap) ─────────────────────────────────
  // { sheets: sheetName } → csak a kért lap kerül beolvasásra; az összes többi
  // lap cellaadata kihagyásra kerül → nagy fájloknál percekről másodpercekre csökkenti
  // a feldolgozási időt.
  async function readRowsFromSheet(fileHandleOrFile, sheetName) {
    const buf = await _readBuf(fileHandleOrFile);
    const wb  = _xlsxRead(buf, { sheets: sheetName });
    let ws     = wb.Sheets[sheetName];
    if (!ws) {
      // Biztonsági fallback: ha a lapnév nem egyezik (pl. trim különbség),
      // az első lapot olvassuk be teljes újraparseoléssel.
      const wb0 = _xlsxRead(buf, { sheets: 0 });
      ws = wb0.Sheets[wb0.SheetNames[0]];
    }
    return ws ? XLSX.utils.sheet_to_json(ws, { defval: '' }) : [];
  }

  // ── Munkalap-nevek listázása ───────────────────────────────────────────────
  // bookSheets: true → a SheetJS CSAK a workbook metaadatait olvassa be
  // (lapnevek, láthatóság), a cellák tartalmát EGYÁLTALÁN NEM parseolja.
  // Ez a változtatás önmagában eliminál minden „percekig tart" jellegű késést.
  // Ezután _visibleSheetNames() kiszűri a rejtett / VBA lapokat.
  async function listSheets(fileHandleOrFile) {
    const buf = await _readBuf(fileHandleOrFile);
    const wb  = XLSX.read(buf, { type: 'array', bookSheets: true });
    return _visibleSheetNames(wb);
  }

  // ── Teljes munkafüzet (import modul írási műveleteihez) ───────────────────
  async function getWorkbook(fileHandleOrFile) {
    const buf = await _readBuf(fileHandleOrFile);
    return _xlsxRead(buf);
  }

  async function saveWorkbookToHandle(wb, fileHandle) {
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
    const writable = await fileHandle.createWritable();
    await writable.write(new Uint8Array(wbout));
    await writable.close();
  }

  function getHeaders(rows) {
    if (!rows.length) return [];
    return Object.keys(rows[0]);
  }

  function downloadWorkbook(wb, filename) {
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, filename);
  }

  function normalizeKey(str) {
    return String(str || '').trim().toLowerCase();
  }

  return {
    readRows,
    readRowsFromSheet,
    listSheets,
    getWorkbook,
    getHeaders,
    downloadWorkbook,
    saveWorkbookToHandle,
    normalizeKey,
  };
})();
