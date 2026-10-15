'use strict';

/**
 * „Ügyállás" fül — a `megtekinto` szint egyetlen nézete. Terv: `TERV-fiokok.md` 3.4.
 *
 * Miért külön, kicsi nézet, és nem a lecsupaszított Ügyek fül: az Ügyek fül gazdag
 * (űrlap, idővonal, dashboard, átutalások), és minden jövőbeni bővítésénél újra át
 * kellene gondolni, mit rejtsünk el. Egy elfelejtett elem ott adatot szivárogtatna.
 * Itt a nézet azt a öt adatot rajzolja ki, amit szabad — ami nincs a kódban, az
 * nem is jelenhet meg.
 *
 * ── Amit ez a nézet NEM ad ─────────────────────────────────────────────────
 * Ez felületi szűkítés. A `megtekinto` ugyanabból a fájlból olvas, mint a többi
 * szint, tehát aki a fájlhoz hozzáfér, mindent lát. A valódi adatminimalizálás a
 * 2. fázis: az admin kiír egy állapot-kivonatot, és a megtekintő NTFS-szinten is
 * csak azt olvashatja. Amíg az nincs, ez kényelem és rendezettség, nem védelem.
 */
const AllapotModule = (() => {

  let container = null;
  let picker    = null;     // a beágyazott ClientPicker-tábla
  let kijelolt  = [];       // a kijelölt sorok kulcsai

  /** Ennyi napig látszik még a lezárt ügy, a kimenetelével (10.3 V6). */
  const LEZART_NAPOK = 30;

  const OSZLOPOK = ['Dolgozó', 'Közvetlen vezető', 'Ügy', 'Állás', 'Határidő',
                    'Következő lépés', 'Lezárva', 'Eredmény'];

  function init(el) {
    container = el;
    render();
    window.addEventListener('docgenTabActivated', e => {
      if (e.detail === 'allapot') render();
    });
    EmployeeRepo.onChange(() => frissit());
    // Az ügy állása a CaseRepo-ban változik — eddig erre nem rajzolt újra.
    try { CaseRepo.onChange(() => frissit()); } catch { /* betöltés előtt */ }
  }

  /** A saját dolgozók — a séma `hr_direct_leader` mezője a kapocs. */
  function sajatok() {
    let all = [];
    try { all = EmployeeRepo.all(); } catch { return []; }
    return all.filter(e => Auth.ownsEmployee(e));
  }

  function nev(emp) {
    const f = emp.fields || {};
    return [f.surname, f.forename].filter(Boolean).join(' ').trim()
        || [f['Vezetéknév'], f['Keresztnév']].filter(Boolean).join(' ').trim()
        || '(névtelen)';
  }

  function safe(fn) { try { return fn(); } catch { return ''; } }

  function ugyekOf(empId) {
    try { return CaseRepo.forEmployee(empId, { includeClosed: false }); }
    catch { return []; }
  }

  /** Nyitott ügyek + az utolsó `LEZART_NAPOK` napban lezártak. */
  function lathatoUgyek(empId, ma) {
    let lista = [];
    try { lista = CaseRepo.forEmployee(empId, { includeClosed: true }); } catch { return []; }
    const hatar = new Date(ma);
    hatar.setDate(hatar.getDate() - LEZART_NAPOK);
    const hatarIso = hatar.toISOString().slice(0, 10);
    return lista.filter(u => !u.closedAt || String(u.closedAt).slice(0, 10) >= hatarIso);
  }

  /**
   * A tábla sorai. Ügyenként egy sor; akinek nincs látható ügye, az is kap egyet,
   * hogy a vezető lássa: nála nincs folyamatban semmi. `ma` csak a teszteknek.
   */
  function sorok(ma = null) {
    const nap = ma || Auth.today();
    const out = [];
    for (const emp of sajatok()) {
      const alap = { 'Dolgozó': nev(emp), 'Közvetlen vezető': Leaders.leaderOf(emp) };
      const ugyek = lathatoUgyek(emp.id, nap);
      if (!ugyek.length) {
        out.push(Object.assign({ __id: 'd:' + emp.id, __case: null }, alap, {
          'Ügy': '—', 'Állás': 'nincs folyamatban lévő ügy', 'Határidő': '',
          'Következő lépés': '', 'Lezárva': '', 'Eredmény': '' }));
        continue;
      }
      for (const u of ugyek) {
        out.push(Object.assign({ __id: u.id, __case: u.id, __emp: emp.id }, alap, {
          'Ügy':      safe(() => CaseTypes.label(u.type)) || u.type || '—',
          'Állás':    safe(() => CaseTypes.statusLabel(u.type, u.status)) || u.status || '—',
          'Határidő': u.closedAt ? '' : safe(() => CaseRepo.deadlineText(u)) || '',
          // „Mi hiányzik” helyett a KÖVETKEZŐ LÉPÉS: a tervben szereplő
          // „mi hiányzik” adatnak nincs forrása a DocGen-ben (azt a PDF Műhely
          // Áttekintője számolja az iratokból), és nem találunk ki egyet. A
          // határidő kezdő napja viszont valódi, meglévő jel.
          'Következő lépés': u.dueAt || u.closedAt ? '' : safe(() => CaseTypes.triggerLabel(u.type)) || '',
          'Lezárva':  u.closedAt ? String(u.closedAt).slice(0, 10) : '',
          'Eredmény': u.closedAt ? safe(() => CaseTypes.outcomeLabel(u.outcome)) || '' : '',
        }));
      }
    }
    return out;
  }

  function sajatFiok() {
    try { return Auth.byName(Auth.currentUser()); } catch { return null; }
  }

  function render() {
    if (!container) return;
    if (picker) { picker.destroy(); picker = null; }

    if (!Auth.can('cases.read.own') && !Auth.can('cases.read')) {
      container.innerHTML = '';
      return;
    }

    const emps = sajatok();
    const rows = sorok();
    const fiok = sajatFiok();
    const vezeto = fiok && Auth.isLeader(fiok);

    container.innerHTML = `
      <div class="workspace">
        <div class="workspace-col">
          <div class="ws-card">
            <div class="ws-card-header">
              <span class="ws-card-title">Ügyállás</span>
              <span class="rg-count" id="al-count">${emps.length} dolgozó · ${rows.length} sor</span>
            </div>
            <div class="ws-card-body">
              <p class="sv-intro">
                A hozzád tartozó dolgozók ügyeinek állása — a beosztott vezetőkéi és
                akiket épp helyettesítesz, azokéi is. A hozzárendelés a nyilvántartás
                <b>„Közvetlen vezető"</b> mezőjéből jön; ha valaki hiányzik, a HR-nél
                kell pontosítani. A lezárt ügyek ${LEZART_NAPOK} napig látszanak.
              </p>
              ${rows.length ? `
                <div id="al-table"></div>
                <div class="rg-bulk" id="al-bulk"></div>` : ures(emps.length)}
            </div>
          </div>
          ${vezeto ? helyettesKartya(fiok) : ''}
        </div>
      </div>`;

    if (rows.length) {
      picker = ClientPicker.inline({
        container: document.getElementById('al-table'),
        rows,
        columns: OSZLOPOK,
        visibleColumns: OSZLOPOK,
        rowKey: r => r.__id,
        storageKey: 'docgen-allapot',
        onSelectionChange: keys => { kijelolt = keys; renderBulk(); },
      });
      kijelolt = picker.selectedKeys();
      renderBulk();
      document.getElementById('al-bulk').addEventListener('click', onBulk);
    }
    if (vezeto) {
      const b = document.getElementById('al-dep-add');
      if (b) b.addEventListener('click', () => LeadersUI.openDeputyDialog(fiok.id, render));
      LeadersUI.bindDeputyDelete(container, render);
    }
  }

  /** Adatváltozáskor csak a sorok cserélődnek: a szűrés és a kijelölés megmarad. */
  function frissit() {
    if (!picker) { render(); return; }
    const rows = sorok();
    if (!rows.length) { render(); return; }
    picker.setRows(rows);
    kijelolt = picker.selectedKeys();
    const c = document.getElementById('al-count');
    if (c) c.textContent = `${sajatok().length} dolgozó · ${rows.length} sor`;
    renderBulk();
  }

  /** A vezető a saját helyettesét maga állítja be (pl. szabadság előtt). */
  function helyettesKartya(fiok) {
    return `
      <div class="ws-card">
        <div class="ws-card-header"><span class="ws-card-title">Helyettesítés</span></div>
        <div class="ws-card-body">
          <p class="sv-intro">Távollétedre kijelölhetsz helyettest: a megadott
            időszakban ő is látja a dolgozóid ügyállását.</p>
          ${LeadersUI.deputyListHtml(fiok)}
          <div class="sv-toolbar">
            <button class="btn btn-ghost btn-sm" id="al-dep-add">Helyettes kijelölése…</button>
          </div>
        </div>
      </div>`;
  }

  function renderBulk() {
    const bar = document.getElementById('al-bulk');
    if (!bar) return;
    const n = kijelolt.length;
    const egyUgy = n === 1 && !String(kijelolt[0]).startsWith('d:');
    bar.innerHTML = `
      <span class="rg-bulk-count">${n ? `<b>${n}</b> kijelölve`
        : 'Kijelölés nélkül a lista (szűrt) egésze megy ki'}</span>
      <button class="btn btn-ghost btn-sm" data-al="detail" ${egyUgy ? '' : 'disabled'}
              title="Egy kijelölt ügy idővonala">Részletek</button>
      <button class="btn btn-ghost btn-sm" data-al="xlsx">Xlsx</button>
      <button class="btn btn-ghost btn-sm" data-al="print">Nyomtatás</button>
      <button class="btn btn-ghost btn-sm" data-al="clear" ${n ? '' : 'disabled'}>Kijelölés törlése</button>`;
  }

  /** A kimenet sorai: a kijelöltek, kijelölés nélkül a szűrt lista — a látható oszlopokkal. */
  function kimenet() {
    const v = picker.view();
    const kell = new Set(kijelolt);
    const rows = kell.size ? v.rows.filter(r => kell.has(r.__id)) : v.rows;
    return { columns: v.columns, rows };
  }

  function onBulk(ev) {
    const b = ev.target.closest('[data-al]:not([disabled])');
    if (!b || !picker) return;
    switch (b.dataset.al) {
      case 'clear':  picker.clearSelection(); kijelolt = []; renderBulk(); break;
      case 'detail': reszletek(kijelolt[0]); break;
      case 'xlsx':   xlsx(kimenet()).catch(e => toast(`Az xlsx nem készült el: ${e.message}`, 'error')); break;
      case 'print':  nyomtat(kimenet()); break;
    }
  }

  /** Csak olvasható idővonal: a `cases.write` hiányában szerkesztőgomb nincs benne. */
  function reszletek(caseId) {
    const u = safe(() => CaseRepo.get(caseId));
    if (!u) { toast('Az ügy nem található.', 'error'); return; }
    const emp = safe(() => EmployeeRepo.get(u.employeeId));
    if (!emp || !Auth.ownsEmployee(emp)) { toast('Ez az ügy nem a te dolgozódé.', 'error'); return; }
    showDialog({
      title: `${nev(emp)} — ${safe(() => CaseTypes.label(u.type)) || u.type}`,
      body: `<div class="al-detail">${CaseTimeline.render(u, emp.fields || {})}</div>`,
      footer: `<button class="btn btn-primary btn-sm" onclick="closeDialog()">Bezárás</button>`,
    });
  }

  async function xlsx({ columns, rows }) {
    if (typeof ExcelJS === 'undefined') throw new Error('Az ExcelJS könyvtár nem érhető el.');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Ügyállás');
    ws.columns = columns.map(c => ({ header: c, key: c, width: c === 'Dolgozó' ? 26 : 20 }));
    ws.getRow(1).font = { bold: true };
    // Minden érték szövegként: a dátumot és az azonosítót az Excel ne alakítsa át.
    for (const r of rows) ws.addRow(columns.map(c => String(r[c] == null ? '' : r[c])));
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    const buf = await wb.xlsx.writeBuffer();
    const nap = Auth.today();
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, `Ugyallas_${nap}.xlsx`);
    toast(`✓ ${rows.length} sor xlsx-be mentve`, 'success');
  }

  /** Nyomtatás egy rejtett keretből: nem nyit új ablakot, a felugró-tiltó sem zavar. */
  function nyomtat({ columns, rows }) {
    const fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
    document.body.appendChild(fr);
    const d = fr.contentDocument;
    d.open();
    d.write(`<!doctype html><html lang="hu"><head><meta charset="utf-8">
      <title>Ügyállás — ${escHtml(Auth.today())}</title>
      <style>
        body { font: 11px Calibri, Arial, sans-serif; margin: 12mm; }
        h1 { font-size: 15px; margin: 0 0 4px; }
        p { margin: 0 0 10px; color: #555; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #999; padding: 3px 5px; text-align: left; vertical-align: top; }
        th { background: #eee; }
        tr { page-break-inside: avoid; }
      </style></head><body>
      <h1>Ügyállás</h1>
      <p>${escHtml(Auth.currentUser())} · ${escHtml(Auth.today())} · ${rows.length} sor</p>
      <table><thead><tr>${columns.map(c => `<th>${escHtml(c)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr>${columns.map(c =>
        `<td>${escHtml(r[c] == null ? '' : String(r[c]))}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></body></html>`);
    d.close();
    setTimeout(() => {
      fr.contentWindow.focus();
      fr.contentWindow.print();
      setTimeout(() => fr.remove(), 1000);
    }, 100);
  }

  function ures(empDb) {
    return `<div class="login-empty">${empDb === 0
      ? 'Nincs hozzád rendelt dolgozó. Ha ez tévedés, a HR a „Közvetlen vezető” '
        + 'mezőben tudja beállítani.'
      : 'A dolgozóidhoz nincs rögzített ügy.'}</div>`;
  }

  // ── Állapot-kivonat kiírása (TERV-fiokok.md 3.4, 2. fázis) ────────────────
  /**
   * A valódi adatminimalizálás: a megtekintő ne a teljes nyilvántartást olvassa.
   *
   * **Vezetőnként EGY fájl**, nem egy közös: csak így lehet később NTFS-szinten
   * szűkíteni (vagy egyszerűen elküldeni azt az egy fájlt). Egy közös fájlban
   * minden műszakvezető látná a többiek dolgozóit is — az nem minimalizálás.
   *
   * A kivonatban CSAK az az öt adat van, amit a megtekintő láthat. Amit nem írunk
   * bele, az nem is szivároghat: okmányszám, adóazonosító, bér, bankszámla, anyja
   * neve egyáltalán nem kerül a fájlba.
   */
  const KIVONAT_DIR = 'allapot';

  function kivonatSorok() {
    let emps = [];
    try { emps = EmployeeRepo.all(); } catch { return new Map(); }
    const perVezeto = new Map();
    for (const emp of emps) {
      const vez = String((emp.fields || {}).hr_direct_leader || '').trim();
      if (!vez) continue;                       // vezető nélkül nincs kinek kiírni
      const ugyek = ugyekOf(emp.id);
      const sorok = ugyek.length ? ugyek.map(u => ({
        nev:       nev(emp),
        ugy:       safe(() => CaseTypes.label(u.type)) || u.type || '',
        allapot:   safe(() => CaseTypes.statusLabel(u.type, u.status)) || u.status || '',
        hatarido:  safe(() => CaseRepo.deadlineText(u)) || '',
        kovetkezo: u.dueAt ? '' : safe(() => CaseTypes.triggerLabel(u.type)) || '',
      })) : [{ nev: nev(emp), ugy: '', allapot: 'nincs folyamatban lévő ügy',
               hatarido: '', kovetkezo: '' }];
      if (!perVezeto.has(vez)) perVezeto.set(vez, []);
      perVezeto.get(vez).push(...sorok);
    }
    return perVezeto;
  }

  /** Fájlnévbe illő alak — a vezető nevéből. */
  function fajlNev(vez) {
    const t = String(vez).replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
    return `${t || 'ismeretlen'}.json`;
  }

  async function kivonatKiir(dirHandle) {
    if (!dirHandle) throw new Error('Nincs beállított adatmappa.');
    const perVezeto = kivonatSorok();
    if (!perVezeto.size) {
      throw new Error('Egyetlen dolgozónál sincs kitöltve a „Közvetlen vezető" mező — '
                    + 'nincs kinek kivonatot írni.');
    }
    const dir = await FsService.getSubDir(dirHandle, KIVONAT_DIR, true);
    let db = 0;
    for (const [vez, sorok] of perVezeto) {
      await FsService.writeTextToDir(dir, fajlNev(vez), JSON.stringify({
        vezeto: vez,
        keszult: new Date().toISOString(),
        keszitette: Settings.currentUser(),
        // Szándékosan CSAK ez az öt mező. Bővítés előtt gondold át: amit
        // beírunk, azt a műszakvezető látja.
        sorok,
      }, null, 2));
      db++;
    }
    return { fajlok: db, sorok: [...perVezeto.values()].reduce((a, b) => a + b.length, 0) };
  }

  return { init, render, sorok, kivonatKiir, KIVONAT_DIR, LEZART_NAPOK };
})();
