'use strict';

/**
 * „Hosszabbítások” fül + a fejléc csengője és az Összesítő ablak.
 * Terv: plans/TERV-hosszabbitasi-dontesek.md 3.7, 3.9. A számítás a
 * `Hosszabbitas` szolgáltatásban van (Node-tesztelt); ez csak rajzol.
 *
 * Minden szintnek ugyanaz a fül, a tartalma a jogok szerint más:
 *   K2 (és helyettese)  — a saját dolgozói, döntés gombbal
 *   közvetlen vezető     — a saját dolgozói, csak olvas
 *   HRBP / ügyintéző     — mindenki, + adatminőség és teljes napló
 *
 * ── Amit ez a fül NEM ad ───────────────────────────────────────────────────
 * Felületi szűkítés: a vezető ugyanabból a mappából olvas, mint a HR. A valódi
 * határ az NTFS (2. fázis, TERV-fiokok.md 4.) — mint az Ügyállásnál.
 */
const HosszabbitasModule = (() => {

  let container = null;
  const pickerek = {};
  const kijelolt = { var: [], igen: [], nem: [], naplo: [] };
  let korabbiak = false;

  const DONT = { igen: 'Hosszabbít', nem: 'Nem hosszabbít' };
  const TIPUS_CIMKE = { DONTES: 'Döntés', MODOSITAS: 'Módosítás', JEGYZET: 'Jegyzet', NYUGTA: 'Nyugtázás' };

  function fiok() {
    if (Auth.isProba()) return { name: '(próba mód)', proba: true };
    return Auth.byName(Auth.currentUser());
  }
  function lathat()  { return Auth.can('renewals.read') || Auth.can('renewals.read.own'); }
  function mindent() { return Auth.can('renewals.read'); }
  function aktiv()   { return !!container && container.classList.contains('active'); }
  function safe(fn, d = '') { try { return fn(); } catch { return d; } }
  const ido = at => String(at || '').replace('T', ' ').slice(0, 16);

  // ── Indítás ────────────────────────────────────────────────────────────────
  function init(el) {
    container = el;
    window.addEventListener('docgenTabActivated', e => {
      if (e.detail === 'hosszabbitas') ujratolt();
    });
    // Valós idejű frissítés nincs: fülváltáskor és az ablak visszatérésekor
    // olvassuk újra a naplót (4.).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') ujratolt({ csendes: true });
    });
    // Összevonva: egy tömeges import dolgozónként jelez, és minden jelzésre az
    // egész értesítéslistát újraszámolni a felületet megfogná.
    let idozito = null;
    const ujra = () => {
      clearTimeout(idozito);
      idozito = setTimeout(() => { frissitCsengo(); if (aktiv()) render(); }, 250);
    };
    Hosszabbitas.onChange(ujra);
    EmployeeRepo.onChange(ujra);
    try { CaseRepo.onChange(ujra); } catch { /* betöltés előtt */ }
    const b = document.getElementById('header-bell');
    if (b) b.addEventListener('click', osszesito);
    render();
  }

  async function ujratolt({ csendes = false } = {}) {
    try { await Hosszabbitas.load(); }
    catch (e) { if (!csendes) toast('A döntésnapló nem olvasható: ' + e.message, 'error'); }
    frissitCsengo();
    if (aktiv()) render();
  }

  /** Belépés után: ha van olvasatlan tétel, magától megnyílik az Összesítő. */
  function indulaskor() {
    frissitCsengo();
    if (lathat() && olvasatlan().length) osszesito();
  }

  // ── Fül ────────────────────────────────────────────────────────────────────
  function render() {
    if (!container) return;
    for (const k of Object.keys(pickerek)) { safe(() => pickerek[k].destroy()); delete pickerek[k]; }
    if (!lathat()) { container.innerHTML = ''; return; }

    const f = fiok();
    const ma = Auth.today();
    const varo = Hosszabbitas.dontesreVar(f, ma);
    const dontesek = Hosszabbitas.dontesek(f, { ma, korabbiak });
    const igen = dontesek.filter(d => d.kor.dontes.dontes === 'igen');
    const nem  = dontesek.filter(d => d.kor.dontes.dontes === 'nem');
    const serult = Hosszabbitas.serult();

    container.innerHTML = `
      <div class="workspace">
        <div class="workspace-col">
          ${serult ? `<div class="hs-alert">A döntésnapló (<code>${escHtml(Hosszabbitas.FILENAME)}</code>)
            nem olvasható: ${escHtml(serult.message)}. Amíg ez fennáll, döntést nem lehet
            rögzíteni — szólj az adminnak.</div>` : ''}
          <div class="ws-card">
            <div class="ws-card-header">
              <span class="ws-card-title">Döntésre vár</span>
              <span class="rg-count">${varo.length} dolgozó</span>
            </div>
            <div class="ws-card-body">
              <p class="sv-intro">${bevezeto()}</p>
              ${jelmagyarazat()}
              ${varo.length ? `<div id="hs-var"></div><div class="rg-bulk" id="hs-var-bulk"></div>`
                : '<div class="login-empty">Nincs döntésre váró dolgozó.</div>'}
            </div>
          </div>
          <div class="ws-card">
            <div class="ws-card-header">
              <span class="ws-card-title">Döntések</span>
              <label class="check-row hs-korabbi"><input type="checkbox" id="hs-korabbi"
                ${korabbiak ? 'checked' : ''}><span>Korábbi körök is</span></label>
            </div>
            <div class="ws-card-body">
              <div class="hs-szakasz hs-szakasz--igen">✔ Hosszabbít — ${igen.length}</div>
              ${igen.length ? `<div id="hs-igen"></div><div class="rg-bulk" id="hs-igen-bulk"></div>`
                : '<div class="login-empty">Nincs ilyen döntés.</div>'}
              <div class="hs-szakasz hs-szakasz--nem">✖ Nem hosszabbít — ${nem.length}</div>
              ${nem.length ? `<div id="hs-nem"></div><div class="rg-bulk" id="hs-nem-bulk"></div>`
                : '<div class="login-empty">Nincs ilyen döntés.</div>'}
            </div>
          </div>
          ${mindent() ? adatminosegKartya(ma) : ''}
          ${mindent() ? `
          <div class="ws-card">
            <div class="ws-card-header">
              <span class="ws-card-title">Teljes napló</span>
              <span class="rg-count">${Hosszabbitas.osszes().length} esemény</span>
            </div>
            <div class="ws-card-body">
              <p class="sv-intro">Minden esemény, csak hozzáfűzve: ki, mikor, milyen minőségben,
                miről mire, melyik lejáratra és melyik sávban döntött. Nem törölhető.</p>
              ${Hosszabbitas.osszes().length ? `<div id="hs-naplo"></div><div class="rg-bulk" id="hs-naplo-bulk"></div>`
                : '<div class="login-empty">Még nincs bejegyzés.</div>'}
            </div>
          </div>` : ''}
        </div>
      </div>`;

    const vis = mindent() ? null : ['K2', 'HRBP', 'Törzsszám'];
    tabla('var', varo.map(varSor), VAR_OSZLOPOK, vis, r => `hs-sav--${r.__sav}`);
    tabla('igen', igen.map(dontesSor), DONTES_OSZLOPOK, vis, dontesOsztaly);
    tabla('nem', nem.map(dontesSor), DONTES_OSZLOPOK, vis, dontesOsztaly);
    if (mindent()) tabla('naplo', Hosszabbitas.osszes().reverse().map(naploSor), NAPLO_OSZLOPOK, null);
    const kb = document.getElementById('hs-korabbi');
    if (kb) kb.addEventListener('change', () => { korabbiak = kb.checked; render(); });
    container.querySelectorAll('[data-hs-emp]').forEach(el =>
      el.addEventListener('click', () => elozmeny(el.dataset.hsEmp)));
  }

  function bevezeto() {
    if (mindent()) {
      return `Minden dolgozó, akinek az engedélye ${Hosszabbitas.hatarok().lista} napon belül
        lejár, és az aktuális körben még nincs K2-döntése. A K2 a <b>„K2”</b> mezőből jön.`;
    }
    return `Azok a dolgozók, akiknek K2-je vagy közvetlen vezetője vagy (és akiket ma
      helyettesítesz). <b>Dönteni K2-ként</b> tudsz: jelöld ki a sort, majd <b>Döntés…</b>
      (vagy dupla kattintás). A döntés naplózva van, és bármikor módosítható.`;
  }

  function jelmagyarazat() {
    const h = Hosszabbitas.hatarok();
    const tart = { tajekoztato: `${h.lista}–${h.tajekoztato}`, kozeleg: `${h.tajekoztato - 1}–${h.kozeleg}`,
      esedekes: `${h.kozeleg - 1}–${h.esedekes}`, kesesben: `${h.esedekes - 1}–${h.kesesben}`,
      utolso: `${h.kesesben - 1}–${h.utolso}`, vismaior: `${h.utolso - 1}–${h.vismaior}`,
      nemadhato: `${h.vismaior - 1}–0`, lejart: '< 0' };
    return `<div class="hs-legend">${Hosszabbitas.SAVOK.map(s =>
      `<span class="hs-chip hs-sav--${s.key}" title="${tart[s.key]} nap">${escHtml(s.label)}
        <small>${tart[s.key]}</small></span>`).join('')}</div>`;
  }

  // ── Táblák ─────────────────────────────────────────────────────────────────
  const VAR_OSZLOPOK = ['Dolgozó', 'Törzsszám', 'Közvetlen vezető', 'K2', 'HRBP', 'Lejárat',
    'Hátralévő nap', 'Sáv', 'Jelzés', 'Utolsó jegyzet'];
  const DONTES_OSZLOPOK = ['Dolgozó', 'Törzsszám', 'K2', 'HRBP', 'Döntés ideje', 'Ki rögzítette',
    'Módosítva', 'Ügy állása', 'Indoklás', 'Lejárat', 'Sáv a döntéskor', 'Jelzés'];
  const NAPLO_OSZLOPOK = ['Időpont', 'Esemény', 'Dolgozó', 'Törzsszám', 'K2', 'Lejárat', 'Nap',
    'Sáv', 'Döntés', 'Előző', 'Rögzítette', 'Minőség', 'Forrás', 'Szöveg', 'Ügy futott'];

  function jelzesek(a) {
    const j = [];
    if (a.emp.noRenewal) j.push('HR: nem hosszabbítjuk');
    if (a.lejaratValtozott) j.push(`⚠ a lejárat a döntés óta módosult: ${a.lejaratValtozott.regi} → ${a.lejaratValtozott.uj}`);
    if (a.kor.parhuzamos) j.push('párhuzamos rögzítés');
    return j;
  }

  function varSor(a) {
    return {
      __id: a.emp.id, __emp: a.emp.id, __sav: a.sav,
      'Dolgozó': Hosszabbitas.nev(a.emp), 'Törzsszám': Hosszabbitas.torzsszam(a.emp),
      'Közvetlen vezető': Hosszabbitas.vezetoOf(a.emp), 'K2': Hosszabbitas.k2Of(a.emp) || '—',
      'HRBP': String((a.emp.fields || {}).hr_hrbp || ''),
      'Lejárat': a.lejarat, 'Hátralévő nap': a.napok,
      'Sáv': Hosszabbitas.savLabel(a.sav),
      'Jelzés': jelzesek(a).join(' · '),
      'Utolsó jegyzet': a.utolsoJegyzet ? `${a.utolsoJegyzet.szoveg} (${a.utolsoJegyzet.rogzitette})` : '',
    };
  }

  function kiRogzitette(e) {
    if (!e) return '';
    if (e.minoseg === 'k2') return e.rogzitette;
    const fr = e.forras ? `, forrás: ${e.forras.tipus}${e.forras.megj ? ' — ' + e.forras.megj : ''}` : '';
    return e.minoseg === 'helyettes'
      ? `${e.rogzitette} (${e.k2} helyetteseként)`
      : `${e.rogzitette} (HRBP, ${e.k2 || '—'} nevében${fr})`;
  }

  function dontesSor(x) {
    const d = x.kor.dontes, a = x.allapot;
    const j = x.aktualis ? jelzesek(a) : ['lezárt kör'];
    const nyitott = Hosszabbitas.osszes().filter(e => e.empId === x.emp.id && Hosszabbitas.nyugtazando(e)
      && !Hosszabbitas.nyugtazva(e.id));
    if (nyitott.length) j.unshift('❗ nyugtázandó módosítás');
    return {
      __id: `${x.emp.id}|${d.id}`, __emp: x.emp.id, __mod: x.kor.modositasok, __eros: !!nyitott.length,
      'Dolgozó': Hosszabbitas.nev(x.emp), 'Törzsszám': Hosszabbitas.torzsszam(x.emp),
      'K2': Hosszabbitas.k2Of(x.emp) || d.k2 || '', 'HRBP': String((x.emp.fields || {}).hr_hrbp || ''),
      'Döntés ideje': ido(d.at), 'Ki rögzítette': kiRogzitette(d),
      'Módosítva': x.kor.modositasok ? `Módosítva (${x.kor.modositasok}×)` : '',
      'Ügy állása': Hosszabbitas.ugyAllasa(x.emp, x.kor),
      'Indoklás': (d.mezok || {}).indoklas || '',
      'Lejárat': d.lejarat || '', 'Sáv a döntéskor': Hosszabbitas.savLabel(d.sav),
      'Jelzés': j.join(' · '),
    };
  }

  function dontesOsztaly(r) {
    return [r.__mod ? 'hs-mod' : '', r.__eros ? 'hs-eros' : ''].filter(Boolean).join(' ');
  }

  function naploSor(e) {
    return {
      __id: e.id, __emp: e.empId,
      'Időpont': String(e.at || '').replace('T', ' ').slice(0, 23), 'Esemény': TIPUS_CIMKE[e.tipus] || e.tipus,
      'Dolgozó': e.nev || '', 'Törzsszám': e.torzsszam || '', 'K2': e.k2 || '',
      'Lejárat': e.lejarat || '', 'Nap': e.napok == null ? '' : e.napok,
      'Sáv': Hosszabbitas.savLabel(e.sav), 'Döntés': DONT[e.dontes] || '',
      'Előző': DONT[e.elozo] || '', 'Rögzítette': e.rogzitette || '',
      'Minőség': Hosszabbitas.MINOSEG[e.minoseg] || '',
      'Forrás': e.forras ? `${e.forras.tipus}${e.forras.megj ? ' — ' + e.forras.megj : ''}` : '',
      'Szöveg': e.tipus === 'JEGYZET' ? e.szoveg
        : e.tipus === 'NYUGTA' ? 'tudomásul vette a módosítást'
        : Object.entries(e.mezok || {}).filter(([, v]) => v !== '' && v !== false)
            .map(([k, v]) => `${(Hosszabbitas.mezok().find(m => m.key === k) || {}).label || k}: ${v === true ? 'igen' : v}`).join(' · '),
      'Ügy futott': e.ugyFutott ? 'igen' : '',
    };
  }

  function tabla(kulcs, rows, oszlopok, rejtett, rowClass = null) {
    const box = document.getElementById(`hs-${kulcs}`);
    if (!box || !rows.length) return;
    pickerek[kulcs] = ClientPicker.inline({
      container: box, rows, columns: oszlopok,
      visibleColumns: oszlopok.filter(o => !(rejtett || []).includes(o)),
      columnTypes: { 'Hátralévő nap': 'number', 'Nap': 'number' },
      rowKey: r => r.__id,
      storageKey: Settings.userKey(`docgen-hossz-${kulcs}`),
      rowClass: rowClass || undefined,
      onSelectionChange: keys => { kijelolt[kulcs] = keys; bulk(kulcs); },
      onRowOpen: r => (kulcs === 'var' && Hosszabbitas.minoseg(fiok(), EmployeeRepo.get(r.__emp)))
        ? dontesAblak(r.__emp) : elozmeny(r.__emp),
    });
    kijelolt[kulcs] = pickerek[kulcs].selectedKeys();
    bulk(kulcs);
    document.getElementById(`hs-${kulcs}-bulk`).addEventListener('click', ev => onBulk(kulcs, ev));
  }

  function egyEmp(kulcs) {
    if (kijelolt[kulcs].length !== 1) return null;
    const p = pickerek[kulcs];
    const r = p && p.view().rows.find(x => x.__id === kijelolt[kulcs][0]);
    return r ? EmployeeRepo.get(r.__emp) : null;
  }

  function bulk(kulcs) {
    const bar = document.getElementById(`hs-${kulcs}-bulk`);
    if (!bar) return;
    const n = kijelolt[kulcs].length;
    const emp = egyEmp(kulcs);
    const dont = emp && kulcs !== 'naplo' && Hosszabbitas.minoseg(fiok(), emp);
    bar.innerHTML = `
      <span class="rg-bulk-count">${n ? `<b>${n}</b> kijelölve`
        : 'Kijelölés nélkül a lista (szűrt) egésze megy ki'}</span>
      ${kulcs !== 'naplo' ? `
        <button class="btn btn-primary btn-sm" data-hs="dont" ${dont ? '' : 'disabled'}
          title="${dont ? 'Döntés rögzítése vagy módosítása' : 'Jelölj ki egy dolgozót, akiről dönthetsz'}">Döntés…</button>
        <button class="btn btn-ghost btn-sm" data-hs="jegyzet" ${dont ? '' : 'disabled'}>Jegyzet…</button>` : ''}
      <button class="btn btn-ghost btn-sm" data-hs="elozmeny" ${emp ? '' : 'disabled'}>Előzmény</button>
      <button class="btn btn-ghost btn-sm" data-hs="xlsx">Xlsx</button>
      <button class="btn btn-ghost btn-sm" data-hs="print">Nyomtatás</button>
      <button class="btn btn-ghost btn-sm" data-hs="clear" ${n ? '' : 'disabled'}>Kijelölés törlése</button>`;
  }

  function kimenet(kulcs) {
    const v = pickerek[kulcs].view();
    const kell = new Set(kijelolt[kulcs]);
    return { columns: v.columns, rows: kell.size ? v.rows.filter(r => kell.has(r.__id)) : v.rows };
  }

  const CIM = { var: 'Döntésre vár', igen: 'Hosszabbít', nem: 'Nem hosszabbít', naplo: 'Döntésnapló' };

  function onBulk(kulcs, ev) {
    const b = ev.target.closest('[data-hs]:not([disabled])');
    if (!b) return;
    const emp = egyEmp(kulcs);
    switch (b.dataset.hs) {
      case 'dont':     if (emp) dontesAblak(emp.id); break;
      case 'jegyzet':  if (emp) jegyzetAblak(emp.id); break;
      case 'elozmeny': if (emp) elozmeny(emp.id); break;
      case 'clear':    pickerek[kulcs].clearSelection(); kijelolt[kulcs] = []; bulk(kulcs); break;
      case 'xlsx':     xlsx(CIM[kulcs], kimenet(kulcs)).catch(e => toast(`Az xlsx nem készült el: ${e.message}`, 'error')); break;
      case 'print':    nyomtat(CIM[kulcs], kimenet(kulcs)); break;
    }
  }

  async function xlsx(cim, { columns, rows }) {
    if (typeof ExcelJS === 'undefined') throw new Error('Az ExcelJS könyvtár nem érhető el.');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(cim.slice(0, 31));
    ws.columns = columns.map(c => ({ header: c, key: c, width: c === 'Dolgozó' ? 26 : 18 }));
    ws.getRow(1).font = { bold: true };
    for (const r of rows) ws.addRow(columns.map(c => String(r[c] == null ? '' : r[c])));
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    const buf = await wb.xlsx.writeBuffer();
    saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      `Hosszabbitas_${cim.replace(/\s+/g, '_')}_${Auth.today()}.xlsx`);
    toast(`✓ ${rows.length} sor xlsx-be mentve`, 'success');
  }

  function nyomtat(cim, { columns, rows }) {
    const fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
    document.body.appendChild(fr);
    const d = fr.contentDocument;
    d.open();
    d.write(`<!doctype html><html lang="hu"><head><meta charset="utf-8"><title>${escHtml(cim)}</title>
      <style>body{font:11px Calibri,Arial,sans-serif;margin:12mm}h1{font-size:15px;margin:0 0 4px}
      p{margin:0 0 10px;color:#555}table{border-collapse:collapse;width:100%}
      th,td{border:1px solid #999;padding:3px 5px;text-align:left;vertical-align:top}th{background:#eee}
      tr{page-break-inside:avoid}</style></head><body>
      <h1>Hosszabbítások — ${escHtml(cim)}</h1>
      <p>${escHtml(Auth.currentUser())} · ${escHtml(Auth.today())} · ${rows.length} sor</p>
      <table><thead><tr>${columns.map(c => `<th>${escHtml(c)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr>${columns.map(c => `<td>${escHtml(r[c] == null ? '' : String(r[c]))}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></body></html>`);
    d.close();
    setTimeout(() => { fr.contentWindow.focus(); fr.contentWindow.print(); setTimeout(() => fr.remove(), 1000); }, 100);
  }

  // ── Adatminőség (3.7): aki itt van, az az 1. listából némán kimaradna ────────
  function adatminosegKartya(ma) {
    const a = Hosszabbitas.adatminoseg(ma);
    const n = a.lejaratNelkul.length + a.k2Nelkul.length + a.k2NemFiok.length;
    const MAX = 40;
    const lista = (cim, emps, meta) => !emps.length ? '' : `
      <div class="dash-block__sub"><b>${cim} — ${emps.length}</b></div>
      <div class="dash-list">${emps.slice(0, MAX).map(e => `
        <button class="dash-row" type="button" data-hs-emp="${escHtml(e.id)}">
          <span class="dash-row__main">${escHtml(Hosszabbitas.nev(e))}</span>
          <span class="dash-row__meta">${escHtml(meta(e))}</span>
          <span class="dash-row__go">Előzmény</span>
        </button>`).join('')}</div>
      ${emps.length > MAX ? `<div class="dash-block__sub">… és még ${emps.length - MAX}</div>` : ''}`;
    return `
      <div class="ws-card">
        <div class="ws-card-header">
          <span class="ws-card-title">Adatminőség</span>
          <span class="rg-count">${n ? `${n} dolgozó kimaradna` : 'rendben'}</span>
        </div>
        <div class="ws-card-body">
          <p class="sv-intro">A lista csak annyira jó, amennyire a <b>lejárat</b> és a <b>K2</b>
            mező. Aki itt áll, az a „Döntésre vár” listából <b>némán kimarad</b>, vagy senki
            nem dönthet róla. Javítás: Nyilvántartás → a dolgozó adatlapja.</p>
          ${n ? lista('Aktív dolgozó lejárat nélkül', a.lejaratNelkul, () => 'nincs kitöltve az engedély lejárata')
              + lista('K2 nélkül', a.k2Nelkul, e => `lejárat: ${Hosszabbitas.lejaratOf(e)}`)
              + lista('A K2 nem fiók', a.k2NemFiok, e => `„${Hosszabbitas.k2Of(e)}” — nincs ilyen vezetői fiók`)
            : '<div class="login-empty">Minden lejáró engedélyű dolgozónál van K2-fiók és lejárat.</div>'}
        </div>
      </div>`;
  }

  // ── Döntés párbeszédablaka (3.7) ────────────────────────────────────────────
  function fejlecHtml(emp, a) {
    return `
      <div class="hs-fej hs-sav--${a.sav || 'tajekoztato'}">
        <div><b>${escHtml(Hosszabbitas.nev(emp))}</b> · törzsszám: ${escHtml(Hosszabbitas.torzsszam(emp) || '—')}</div>
        <div>Lejárat: <b>${escHtml(a.lejarat || '—')}</b> · ${a.napok == null ? '' : `${a.napok} nap`}
          · <b>${escHtml(Hosszabbitas.savLabel(a.sav) || 'a listán túl')}</b></div>
        <div>K2: ${escHtml(Hosszabbitas.k2Of(emp) || '—')} · Közvetlen vezető: ${escHtml(Hosszabbitas.vezetoOf(emp) || '—')}</div>
      </div>`;
  }

  function mezoHtml(m, kotelezo) {
    const id = `hs-m-${m.key}`;
    const cim = `${escHtml(m.label)}${kotelezo ? ' <strong>(kötelező)</strong>' : ' <span class="muted">(opcionális)</span>'}`;
    let input;
    if (m.type === 'textarea') input = `<textarea id="${id}" class="field-input" rows="3"></textarea>`;
    else if (m.type === 'date') input = `<input type="date" id="${id}" class="field-input">`;
    else if (m.type === 'checkbox') return `<label class="check-row"><input type="checkbox" id="${id}"><span>${cim}</span></label>`;
    else if (m.type === 'enum') input = `<select id="${id}" class="field-input"><option value="">—</option>${
      m.options.map(o => `<option>${escHtml(o)}</option>`).join('')}</select>`;
    else input = `<input type="text" id="${id}" class="field-input">`;
    return `<label class="cf-field"><span>${cim}</span>${input}</label>`;
  }

  function dontesAblak(empId) {
    const f = fiok();
    const emp = EmployeeRepo.get(empId);
    const mn = emp && Hosszabbitas.minoseg(f, emp);
    if (!mn) { toast('Erről a dolgozóról nem dönthetsz.', 'error'); return; }
    const a = Hosszabbitas.allapot(emp);
    const elozo = a.dontes;
    const kellIndok = !!(elozo && a.ugy);
    showDialog({
      title: elozo ? 'Döntés módosítása' : 'Döntés a hosszabbításról',
      body: `
        ${fejlecHtml(emp, a)}
        ${elozo ? `<div class="hs-alert hs-alert--soft">Jelenlegi döntés: <b>${DONT[elozo.dontes]}</b>
          — rögzítette: ${escHtml(kiRogzitette(elozo))}, ${escHtml(ido(elozo.at))}. A módosítás új sor
          a naplóban; a régi megmarad.</div>` : ''}
        ${kellIndok ? `<div class="hs-alert">A hosszabbítási ügy <b>már fut</b>
          (${escHtml(Hosszabbitas.ugyAllasa(emp, a.kor))}). A módosításhoz indoklás kell, és a HRBP
          meg az ügyintéző nyugtázandó figyelmeztetést kap.</div>` : ''}
        ${mn !== 'k2' ? `<div class="hs-alert hs-alert--soft">${mn === 'helyettes'
          ? `<b>${escHtml(Hosszabbitas.k2Of(emp))}</b> helyetteseként döntesz.`
          : `HRBP-ként <b>${escHtml(Hosszabbitas.k2Of(emp) || '(nincs K2)')}</b> nevében rögzítesz. A K2 értesítést kap róla.`}</div>` : ''}
        <div class="hs-valaszt">
          ${['igen', 'nem'].map(k => `<label class="hs-opt hs-opt--${k}">
            <input type="radio" name="hs-dontes" value="${k}" ${elozo && elozo.dontes === k ? 'disabled' : ''}>
            <span>${k === 'igen' ? '✔' : '✖'} ${DONT[k]}</span></label>`).join('')}
        </div>
        ${Hosszabbitas.mezok().map(m => mezoHtml(m, m.kotelezo || (m.key === 'indoklas' && kellIndok))).join('')}
        <p class="ef-hint">A HR is látja. Röviden, tényszerűen — a napló nem törölhető.</p>
        ${mn === 'hrbp' ? `
          <label class="cf-field"><span>Forrás <span class="muted">(opcionális)</span></span>
            <select id="hs-forras" class="field-input"><option value="">—</option>
              ${Hosszabbitas.FORRASOK.map(x => `<option>${escHtml(x)}</option>`).join('')}</select></label>
          <label class="cf-field"><span>A forrás megjegyzése <span class="muted">(opcionális)</span></span>
            <input type="text" id="hs-forras-megj" class="field-input" placeholder="pl. Kiss Anna e-mailje, 11. 04."></label>` : ''}`,
      footer: `<button class="btn btn-primary" id="hs-ok">Rögzítés</button>
               <button class="btn" onclick="closeDialog()">Mégse</button>`,
    });
    document.getElementById('hs-ok').addEventListener('click', async () => {
      const valasz = document.querySelector('input[name="hs-dontes"]:checked');
      if (!valasz) { toast('Válaszd ki: hosszabbít vagy nem hosszabbít.', 'warn'); return; }
      const mezok = {};
      for (const m of Hosszabbitas.mezok()) {
        const el = document.getElementById(`hs-m-${m.key}`);
        if (el) mezok[m.key] = m.type === 'checkbox' ? el.checked : el.value;
      }
      const fs = document.getElementById('hs-forras');
      const forras = fs && fs.value
        ? { tipus: fs.value, megj: document.getElementById('hs-forras-megj').value } : null;
      const gomb = document.getElementById('hs-ok');
      gomb.disabled = true;
      try {
        await Hosszabbitas.dont(fiok(), empId, { dontes: valasz.value, mezok, forras });
        closeDialog();
        toast(`✓ Rögzítve: ${DONT[valasz.value]}`, 'success');
      } catch (e) {
        gomb.disabled = false;
        toast(e.message, 'error');
      }
    });
  }

  function jegyzetAblak(empId) {
    const emp = EmployeeRepo.get(empId);
    if (!emp || !Hosszabbitas.minoseg(fiok(), emp)) { toast('Ehhez a dolgozóhoz nem írhatsz jegyzetet.', 'error'); return; }
    showDialog({
      title: 'Jegyzet',
      body: `${fejlecHtml(emp, Hosszabbitas.allapot(emp))}
        <label class="cf-field"><span>Jegyzet</span><textarea id="hs-jegyzet" class="field-input" rows="3"></textarea></label>
        <p class="ef-hint">A HR is látja. Röviden, tényszerűen — a napló nem törölhető.
          A jegyzet nem döntés: a dolgozó a „Döntésre vár” listán marad.</p>`,
      footer: `<button class="btn btn-primary" id="hs-j-ok">Mentés</button>
               <button class="btn" onclick="closeDialog()">Mégse</button>`,
    });
    document.getElementById('hs-j-ok').addEventListener('click', async () => {
      try {
        await Hosszabbitas.jegyzet(fiok(), empId, document.getElementById('hs-jegyzet').value);
        closeDialog();
        toast('✓ Jegyzet mentve', 'success');
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  // ── Előzmény: a dolgozó összes eseménye minden körből ───────────────────────
  function elozmeny(empId) {
    const emp = EmployeeRepo.get(empId);
    const f = fiok();
    if (!emp || !Hosszabbitas.lathato(f, emp)) { toast('Ez a dolgozó nem látható neked.', 'error'); return; }
    const a = Hosszabbitas.allapot(emp);
    const mn = Hosszabbitas.minoseg(f, emp);
    const nyugtazhat = Auth.can('renewals.decide') || Auth.can('cases.write');
    const korok = a.korok.slice().reverse();
    const sor = e => `
      <tr class="${Hosszabbitas.nyugtazando(e) ? 'hs-eros' : ''}">
        <td>${escHtml(ido(e.at))}</td><td>${escHtml(TIPUS_CIMKE[e.tipus] || e.tipus)}</td>
        <td>${e.dontes ? `<b>${DONT[e.dontes]}</b>${e.elozo ? ` <span class="muted">(volt: ${DONT[e.elozo]})</span>` : ''}` : ''}
          ${e.szoveg ? escHtml(e.szoveg) : ''}${(e.mezok || {}).indoklas ? `<div class="muted">Indoklás: ${escHtml(e.mezok.indoklas)}</div>` : ''}</td>
        <td>${escHtml(kiRogzitette(e) || e.rogzitette || '')}</td>
        <td>${escHtml(e.lejarat || '')}${e.napok != null ? ` · ${e.napok} nap` : ''}${e.sav ? ` · ${escHtml(Hosszabbitas.savLabel(e.sav))}` : ''}</td>
        <td>${Hosszabbitas.nyugtazando(e) ? (Hosszabbitas.nyugtazva(e.id)
          ? `nyugtázta: ${escHtml(Hosszabbitas.nyugtazva(e.id).rogzitette)}`
          : nyugtazhat ? `<button class="btn btn-sm btn-primary" data-hs-nyugta="${escHtml(e.id)}">Tudomásul vettem</button>` : 'nyugtázásra vár')
          : ''}</td>
      </tr>`;
    showDialog({
      title: `Előzmény — ${Hosszabbitas.nev(emp)}`,
      body: `${fejlecHtml(emp, a)}
        ${korok.map((k, i) => `
          <div class="hs-kor">${i === 0 ? 'Aktuális kör' : `Lezárt kör — ${escHtml(Hosszabbitas.ugyAllasa(emp, k))}`}
            ${k.dontes ? ` · <b>${DONT[k.dontes.dontes]}</b>` : ' · nincs döntés'}</div>
          ${(k.dontesek.length + k.jegyzetek.length) ? `<table class="data-table hs-elozmeny">
            <thead><tr><th>Időpont</th><th>Esemény</th><th>Tartalom</th><th>Rögzítette</th><th>Lejárat / sáv</th><th></th></tr></thead>
            <tbody>${[...k.dontesek, ...k.jegyzetek].sort((x, y) => String(y.at).localeCompare(String(x.at))).map(sor).join('')}</tbody>
          </table>` : ''}`).join('')}`,
      footer: `${mn ? `<button class="btn btn-primary btn-sm" id="hs-e-dont">Döntés…</button>
                       <button class="btn btn-ghost btn-sm" id="hs-e-jegyzet">Jegyzet…</button>` : ''}
               <button class="btn btn-sm" onclick="closeDialog()">Bezárás</button>`,
    });
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    on('hs-e-dont', () => dontesAblak(empId));
    on('hs-e-jegyzet', () => jegyzetAblak(empId));
    document.querySelectorAll('[data-hs-nyugta]').forEach(b => b.addEventListener('click', async () => {
      try { await Hosszabbitas.nyugtaz(fiok(), b.dataset.hsNyugta); toast('✓ Nyugtázva', 'success'); elozmeny(empId); }
      catch (e) { toast(e.message, 'error'); }
    }));
  }

  // ── Csengő és Összesítő (3.9) ──────────────────────────────────────────────
  // Az olvasottság KÉNYELMI adat: a böngészőben, fiókonként. Ha elvész, a
  // tételek újra olvasatlannak látszanak — kár nem lesz belőle.
  function olvasottak() { return new Set(safe(() => Settings.getUser('hossz_olvasott', []), []) || []); }
  function mentOlvasott(set, aktualis) {
    const marad = [...set].filter(id => aktualis.has(id));      // ne nőjön a végtelenbe
    Settings.setUser('hossz_olvasott', marad);
  }
  function mindenHrbp() { return !!safe(() => Settings.getUser('hossz_hrbp_mind', false), false); }

  function tetelek() {
    if (!lathat() && !Auth.can('cases.write')) return [];
    return safe(() => Hosszabbitas.ertesitesek(fiok(), { mindenHrbp: mindenHrbp() }), []);
  }

  /** Olvasatlan: amit még nem nyitott meg, és a nyugtázatlan erős tétel mindig. */
  function olvasatlan(lista = tetelek()) {
    const o = olvasottak();
    return lista.filter(t => t.nyugtazando || !o.has(t.id));
  }

  function frissitCsengo() {
    const b = document.getElementById('header-bell');
    if (!b) return;
    const lat = !!Auth.currentRole() || Auth.isProba();
    b.hidden = !lat || !(lathat() || Auth.can('cases.write'));
    if (b.hidden) return;
    const l = tetelek(), n = olvasatlan(l).length;
    const eros = l.some(t => t.nyugtazando);
    const szam = document.getElementById('header-bell-n');
    if (szam) { szam.textContent = n ? String(n) : ''; szam.hidden = !n; }
    b.classList.toggle('is-eros', eros);
    b.title = n ? `Összesítő — ${n} olvasatlan tétel` : 'Összesítő — nincs új tétel';
  }

  const CSOPORT_SOR = ['Nyugtázandó', 'Teendők', 'Döntésre vár', 'Döntések', 'Ügyek'];

  function osszesito() {
    const l = tetelek();
    const o = olvasottak();
    const csop = new Map();
    for (const t of l.sort((x, y) => String(y.at).localeCompare(String(x.at)))) {
      if (!csop.has(t.csoport)) csop.set(t.csoport, []);
      csop.get(t.csoport).push(t);
    }
    const rang = c => { const i = CSOPORT_SOR.indexOf(c); return i < 0 ? 99 : i; };
    const sorrend = [...csop.keys()].sort((a, b) => rang(a) - rang(b));
    const hrbp = Auth.can('renewals.decide');
    showDialog({
      title: 'Összesítő',
      body: `
        ${hrbp ? `<label class="check-row"><input type="checkbox" id="hs-o-mind" ${mindenHrbp() ? 'checked' : ''}>
          <span>HRBP: mindenki dolgozóiról (alapból csak akiknek te vagy a HRBP-je)</span></label>` : ''}
        ${l.length ? sorrend.map(c => `
          <div class="hs-kor">${escHtml(c)} — ${csop.get(c).length}</div>
          <div class="dash-list">${csop.get(c).map(t => `
            <div class="hs-tetel hs-tetel--${t.erosseg} ${o.has(t.id) && !t.nyugtazando ? 'is-olvasott' : ''}">
              <button class="dash-row" type="button" data-hs-t="${escHtml(t.id)}" data-hs-temp="${escHtml(t.empId || '')}">
                <span class="dash-row__main">${o.has(t.id) && !t.nyugtazando ? '' : '<span class="hs-uj">új</span> '}${escHtml(t.szoveg)}</span>
                <span class="dash-row__meta">${escHtml(String(t.at || '').slice(0, 10))}</span>
              </button>
              ${t.nyugtazando ? `<button class="btn btn-primary btn-sm" data-hs-ny="${escHtml(t.ref)}">Tudomásul vettem</button>` : ''}
            </div>`).join('')}</div>`).join('')
          : '<div class="login-empty">Nincs új tétel. Minden rendben.</div>'}`,
      footer: `${l.length ? '<button class="btn btn-ghost btn-sm" id="hs-o-olvas">Mind olvasott</button>' : ''}
               <button class="btn btn-primary btn-sm" onclick="closeDialog()">Bezárás</button>`,
    });
    const aktualis = new Set(l.map(t => t.id));
    const olvas = ids => { const s = olvasottak(); ids.forEach(i => s.add(i)); mentOlvasott(s, aktualis); frissitCsengo(); };
    const mind = document.getElementById('hs-o-mind');
    if (mind) mind.addEventListener('change', () => { Settings.setUser('hossz_hrbp_mind', mind.checked); osszesito(); frissitCsengo(); });
    const mo = document.getElementById('hs-o-olvas');
    if (mo) mo.addEventListener('click', () => { olvas(l.map(t => t.id)); osszesito(); });
    document.querySelectorAll('[data-hs-t]').forEach(b => b.addEventListener('click', () => {
      olvas([b.dataset.hsT]);
      closeDialog();
      if (typeof switchTab === 'function' && lathat()) switchTab('hosszabbitas');
      if (b.dataset.hsTemp && lathat()) elozmeny(b.dataset.hsTemp);
      else if (Auth.can('cases.write') && typeof switchTab === 'function') switchTab('cases');
    }));
    document.querySelectorAll('[data-hs-ny]').forEach(b => b.addEventListener('click', async () => {
      try { await Hosszabbitas.nyugtaz(fiok(), b.dataset.hsNy); toast('✓ Nyugtázva', 'success'); osszesito(); }
      catch (e) { toast(e.message, 'error'); }
    }));
  }

  // ── Beállítások → „Hosszabbítások” kártya (settings.schema) ────────────────
  function beallitasKartya() {
    const h = Hosszabbitas.hatarok();
    const s = Hosszabbitas.config().savok;
    const mezo = (k, cimke) => `<label class="cf-field"><span>${cimke}</span>
      <input type="number" class="field-input" id="hs-cfg-${k}" value="${s[k]}" step="1"></label>`;
    return `
      <div class="ws-card">
        <div class="ws-card-header"><span class="ws-card-title">Hosszabbítások — sávhatárok</span></div>
        <div class="ws-card-body">
          <p class="sv-intro">A K2-döntések listájának színes sávjai (nap a lejáratig). A
            <b>${h.esedekes} / ${h.utolso} / ${h.vismaior}</b> határ a meghosszabbítási ügytípus
            benyújtási ablakából jön (legkorábban / jogszabályi határidő / legvégső nap) — azt
            itt nem lehet átírni, egy forrás. Az alábbi négy a saját határ.</p>
          <div class="cf-grid">
            ${mezo('lista', 'A listára kerül: ennyi nappal a lejárat előtt')}
            ${mezo('tajekoztato', '„Tájékoztató” alsó határa (nap)')}
            ${mezo('kozeleg', '„Közeleg” alsó határa (nap)')}
            ${mezo('kesesben', '„Késésben” alsó határa (nap)')}
          </div>
          <div class="sv-toolbar"><button class="btn btn-primary btn-sm" id="hs-cfg-save">Mentés</button></div>
        </div>
      </div>`;
  }

  function bindBeallitas() {
    const b = document.getElementById('hs-cfg-save');
    if (!b) return;
    b.addEventListener('click', async () => {
      const v = {};
      for (const k of Object.keys(Hosszabbitas.SEED.savok)) v[k] = Number(document.getElementById(`hs-cfg-${k}`).value);
      try { await Hosszabbitas.setSavok(v); toast('✓ Sávhatárok mentve', 'success'); }
      catch (e) { toast(e.message, 'error'); }
    });
  }

  return { init, render, indulaskor, frissitCsengo, osszesito, elozmeny,
           beallitasKartya, bindBeallitas };
})();
