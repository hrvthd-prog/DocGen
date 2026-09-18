'use strict';

/**
 * Átutalások nézet — az Ügyek fül második oldala.
 *
 * Miért a fül SZINTJÉN van, és nem a kiválasztott ügy alatt: egy köteg sok ügyet
 * fog át, gyakran különböző dolgozókét. Egy ügy részletezőjébe zárva mindig
 * ki kellene lépni belőle, hogy a következő tétel bekerüljön.
 *
 * A gyors út viszont megmarad az ügy felől is: az ügylistán a kiválasztott ügy
 * műveletsorában ott a „Díj a kötegbe" gomb.
 */
const TransfersView = (() => {

  let gyoker = null;

  const state = {
    kivalasztott: null,           // köteg id
  };

  function keszAll() {
    try { TransferRepo.all(); return true; } catch { return false; }
  }

  function ft(n) { return Number(n || 0).toLocaleString('hu-HU') + ' Ft'; }

  function aktivKoteg() {
    const mind = TransferRepo.all();
    if (!mind.length) return null;
    const talalt = mind.find(b => b.id === state.kivalasztott);
    if (talalt) return talalt;
    state.kivalasztott = mind[mind.length - 1].id;
    return mind[mind.length - 1];
  }

  // ── Megjelenítés ───────────────────────────────────────────────────────────

  function render(el) {
    gyoker = el;
    if (!keszAll()) {
      gyoker.innerHTML = `<div class="cv-notready">
        Előbb válaszd ki az adatmappát a <strong>Nyilvántartás</strong> fülön.</div>`;
      return;
    }

    const kotegek = TransferRepo.all().slice().reverse();
    const b = aktivKoteg();

    gyoker.innerHTML = `
      <div class="tv-wrap">
        <aside class="tv-side">
          <div class="tv-side__head">Kötegek</div>
          <div class="tv-list">
            ${kotegek.length
              ? kotegek.map(kotegSorHtml).join('')
              : '<div class="cv-empty">Még nincs köteg.</div>'}
          </div>
          <div class="tv-side__foot">
            <button class="btn btn-primary btn-sm" id="tv-new">Új köteg</button>
          </div>
        </aside>
        <section class="tv-detail">${b ? kotegHtml(b) : uresHtml()}</section>
      </div>`;

    bind();
  }

  function uresHtml() {
    return `<div class="ct-empty">
      Nincs köteg. Hozz létre egyet, vagy az ügylistán egy ügynél nyomd meg a
      <strong>Díj a kötegbe</strong> gombot.</div>`;
  }

  function kotegSorHtml(b) {
    const kifizetve = b.status === TransferRepo.STATUS.KIFIZETVE;
    return `
      <button class="tv-row ${state.kivalasztott === b.id ? 'is-selected' : ''}" data-koteg="${escHtml(b.id)}">
        <span class="tv-row__dot tv-row__dot--${kifizetve ? 'paid' : 'open'}"></span>
        <span class="tv-row__main">
          <span class="tv-row__label">${escHtml(b.label)}</span>
          <span class="tv-row__meta">${b.rows.length} tétel · ${escHtml(ft(TransferRepo.total(b)))}</span>
        </span>
        <span class="tv-row__status">${kifizetve ? 'kifizetve' : 'előkészítés'}</span>
      </button>`;
  }

  function kotegHtml(b) {
    const kifizetve = b.status === TransferRepo.STATUS.KIFIZETVE;
    const hibak = TransferRepo.batchIssues(b.id);
    const hibasSorok = new Set(hibak.map(h => h.rowId));

    return `
      <div class="tv-bar">
        <div class="tv-bar__title">
          <strong>${escHtml(b.label)}</strong>
          <span class="tv-chip tv-chip--${kifizetve ? 'paid' : 'open'}">
            ${kifizetve ? 'kifizetve — ' + escHtml(b.paidOn) : 'előkészítés alatt'}
          </span>
        </div>
        <div class="tv-bar__sum">${b.rows.length} tétel · <strong>${escHtml(ft(TransferRepo.total(b)))}</strong></div>
      </div>

      <div class="tv-actions">
        <button class="btn btn-ghost btn-sm" id="tv-add">Ügy hozzáadása</button>
        <button class="btn btn-primary btn-sm" id="tv-pdf" ${b.rows.length ? '' : 'disabled'}>PDF</button>
        ${kifizetve
          ? `<button class="btn btn-ghost btn-sm" id="tv-reopen">Visszanyitás</button>`
          : `<button class="btn btn-secondary btn-sm" id="tv-paid" ${b.rows.length ? '' : 'disabled'}>Kifizetettnek jelöl</button>`}
        <button class="btn btn-ghost btn-sm" id="tv-log">Napló</button>
        <button class="btn btn-ghost btn-sm cv-del" id="tv-del">Köteg törlése</button>
      </div>

      <div id="tv-issues-slot">${hibak.length ? hibaPanelHtml(hibak) : ''}</div>

      <div class="tv-tablewrap">
        <table class="tv-table">
          <thead>
            <tr>
              <th>#</th><th>Név</th><th>Szem. sz.</th><th>Születés</th><th>Állampolg.</th>
              <th>Azonosító</th><th>Összeg</th><th>Ügyintéző</th><th>Közlemény</th><th></th>
            </tr>
          </thead>
          <tbody>
            ${b.rows.length
              ? b.rows.map((r, i) => sorHtml(b, r, i, hibasSorok.has(r.id))).join('')
              : `<tr><td colspan="10" class="tv-empty">Nincs tétel a kötegben.</td></tr>`}
          </tbody>
        </table>
      </div>`;
  }

  function hibaPanelHtml(hibak) {
    return `
      <div class="tv-issues">
        <div class="tv-issues__head">${hibak.length} sor ellenőrzendő</div>
        <ul>
          ${hibak.slice(0, 12).map(h =>
            `<li><strong>${h.sorszam}. ${escHtml(h.name || '(névtelen)')}</strong> — ${escHtml(h.hibak.join('; '))}</li>`
          ).join('')}
          ${hibak.length > 12 ? `<li>… és még ${hibak.length - 12} sor</li>` : ''}
        </ul>
        <div class="tv-issues__note">
          A hiányos sor nem akadályozza a PDF-et — a nyomtatott kép kell a javításhoz is.
        </div>
      </div>`;
  }

  function sorHtml(b, r, i, hibas) {
    const kozl = TransferRepo.reference(r);
    const mezo = (nev, ertek, extra = '') =>
      `<td><input class="tv-input" data-row="${escHtml(r.id)}" data-field="${nev}"
         value="${escHtml(ertek == null ? '' : ertek)}" ${extra}></td>`;

    return `
      <tr class="${hibas ? 'is-bad' : ''}">
        <td class="tv-no">${i + 1}</td>
        ${mezo('name', r.name)}
        ${mezo('personnelNo', r.personnelNo)}
        ${mezo('dob', r.dob, 'placeholder="ÉÉÉÉ-HH-NN"')}
        ${mezo('nationality', r.nationality)}
        ${mezo('identifier', r.identifier)}
        <td>
          <select class="tv-input" data-row="${escHtml(r.id)}" data-field="amount">
            <option value="0" ${!TransferRepo.AMOUNTS.includes(r.amount) ? 'selected' : ''}>— válassz —</option>
            ${TransferRepo.AMOUNTS.map(a =>
              `<option value="${a}" ${r.amount === a ? 'selected' : ''}>${a.toLocaleString('hu-HU')}</option>`).join('')}
          </select>
        </td>
        ${mezo('handler', r.handler)}
        <td class="tv-ref ${kozl.length > TransferRepo.MAX_REF_LEN ? 'is-long' : ''}"
            title="${escHtml(kozl)}">${escHtml(kozl) || '<span class="muted">hiányos</span>'}</td>
        <td><button class="tv-x" data-del="${escHtml(r.id)}" title="Tétel törlése">×</button></td>
      </tr>`;
  }

  // ── Események ──────────────────────────────────────────────────────────────

  function bind() {
    const q = sel => gyoker.querySelector(sel);

    gyoker.querySelectorAll('[data-koteg]').forEach(el =>
      el.addEventListener('click', () => { state.kivalasztott = el.dataset.koteg; render(gyoker); }));

    const uj = q('#tv-new');
    if (uj) uj.addEventListener('click', () => {
      state.kivalasztott = TransferRepo.createBatch().id;
      render(gyoker);
    });

    const b = aktivKoteg();
    if (!b) return;

    // A mezőszerkesztés `change`-re megy, nem `input`-ra: minden leütés külön
    // naplóbejegyzés lenne, és a napló a lényegről szólna kevesebbet.
    gyoker.querySelectorAll('.tv-input').forEach(el =>
      el.addEventListener('change', () => {
        TransferRepo.updateRow(b.id, el.dataset.row, { [el.dataset.field]: el.value });
        // NEM teljes újrarajzolás: a `change` akkor sül el, amikor a felhasználó
        // Tabbal már a következő mezőben van – az újraépített tábla épp onnan
        // venné el a fókuszt, és a sor közepén kellene újra odakattintani.
        frissitSor(b, el.dataset.row);
      }));

    gyoker.querySelectorAll('[data-del]').forEach(el =>
      el.addEventListener('click', () => torolTetel(b, el.dataset.del)));

    const add = q('#tv-add');   if (add) add.addEventListener('click', () => ugyValaszto(b));
    const pdf = q('#tv-pdf');   if (pdf) pdf.addEventListener('click', () => pdfKeszit(b));
    const log = q('#tv-log');   if (log) log.addEventListener('click', () => naploDialogus(b));
    const del = q('#tv-del');   if (del) del.addEventListener('click', () => torolKoteg(b));
    const fiz = q('#tv-paid');  if (fiz) fiz.addEventListener('click', () => kifizetesDialogus(b));
    const vn  = q('#tv-reopen'); if (vn) vn.addEventListener('click', () => {
      TransferRepo.reopen(b.id);
      toast('A köteg visszanyitva', '');
      render(gyoker);
    });
  }

  /**
   * Egy sor és a köteg-összegzők frissítése újraépítés nélkül.
   * Csak az változik, ami tényleg változott: a közlemény, a hibajelölés,
   * a végösszeg és a hibalista.
   */
  function frissitSor(b, rowId) {
    const inp = gyoker.querySelector(`.tv-input[data-row="${rowId}"]`);
    const tr  = inp && inp.closest('tr');
    const r   = TransferRepo.getRow(b.id, rowId);

    if (tr && r) {
      const kozl = TransferRepo.reference(r);
      const cella = tr.querySelector('.tv-ref');
      if (cella) {
        cella.innerHTML = kozl ? escHtml(kozl) : '<span class="muted">hiányos</span>';
        cella.title = kozl;
        cella.classList.toggle('is-long', kozl.length > TransferRepo.MAX_REF_LEN);
      }
      tr.classList.toggle('is-bad', TransferRepo.rowIssues(r).length > 0);
    }

    const sum = gyoker.querySelector('.tv-bar__sum');
    if (sum) sum.innerHTML = `${b.rows.length} tétel · <strong>${escHtml(ft(TransferRepo.total(b)))}</strong>`;

    const slot = gyoker.querySelector('#tv-issues-slot');
    if (slot) {
      const hibak = TransferRepo.batchIssues(b.id);
      slot.innerHTML = hibak.length ? hibaPanelHtml(hibak) : '';
    }
  }

  function torolTetel(b, rowId) {
    const r = TransferRepo.getRow(b.id, rowId);
    if (!r) return;
    showDialog({
      title: 'Tétel törlése',
      body: `<p style="font-size:13px;margin:0 0 8px">
               Törlöd ezt a tételt? <strong>${escHtml(r.name)}</strong> — ${escHtml(r.identifier)}</p>
             <p style="font-size:12px;color:var(--c-muted);margin:0">
               A törlés bekerül a naplóba, tehát utólag is visszakereshető.</p>`,
      footer: `<button class="btn btn-primary btn-sm" id="tv-del-ok">Törlés</button>
               <button class="btn btn-ghost btn-sm" onclick="closeDialog()">Mégse</button>`,
    });
    document.getElementById('tv-del-ok').addEventListener('click', () => {
      TransferRepo.removeRow(b.id, rowId);
      closeDialog();
      toast('Tétel törölve', '');
      render(gyoker);
    });
  }

  function torolKoteg(b) {
    showDialog({
      title: 'Köteg törlése',
      body: `<p style="font-size:13px;margin:0 0 8px">
               Törlöd a(z) <strong>${escHtml(b.label)}</strong> köteget ${b.rows.length} tétellel?</p>
             <p style="font-size:12px;color:var(--c-muted);margin:0">
               ${b.status === TransferRepo.STATUS.KIFIZETVE
                 ? 'Ez a köteg KIFIZETETT — a törlésével elvész a bizonyítéka annak, mi lett utalva. A napló megmarad.'
                 : 'A törlés bekerül a naplóba.'}</p>`,
      footer: `<button class="btn btn-primary btn-sm" id="tv-delb-ok">Törlés</button>
               <button class="btn btn-ghost btn-sm" onclick="closeDialog()">Mégse</button>`,
    });
    document.getElementById('tv-delb-ok').addEventListener('click', () => {
      TransferRepo.destroyBatch(b.id);
      state.kivalasztott = null;
      closeDialog();
      toast('Köteg törölve', '');
      render(gyoker);
    });
  }

  function kifizetesDialogus(b) {
    const hibak = TransferRepo.batchIssues(b.id);
    showDialog({
      title: 'Kifizetettnek jelölés',
      body: `
        ${hibak.length ? `
          <div style="background:var(--c-amber-bg,#fdf6e3);border:1px solid var(--c-amber);
              border-radius:8px;padding:8px 10px;margin-bottom:10px;font-size:12px">
            <strong>${hibak.length} sor ellenőrzendő</strong> — a rögzítés ettől még elvégezhető.
          </div>` : ''}
        <p style="font-size:13px;margin:0 0 8px">Mikor indult el ténylegesen az utalás?</p>
        <input type="date" id="tv-paid-date" class="field-input" value="${new Date().toISOString().slice(0, 10)}">
        <p style="font-size:12px;color:var(--c-muted);margin:10px 0 0">
          Ezután a köteg azonosítói „már kifizetve" jelzést kapnak, ha egy másik kötegbe
          is bekerülnének — ez akadályozza meg a dupla utalást.</p>`,
      footer: `<button class="btn btn-primary btn-sm" id="tv-paid-ok">Rögzítés</button>
               <button class="btn btn-ghost btn-sm" onclick="closeDialog()">Mégse</button>`,
    });
    document.getElementById('tv-paid-ok').addEventListener('click', () => {
      try {
        TransferRepo.markPaid(b.id, document.getElementById('tv-paid-date').value);
        closeDialog();
        toast('✓ Kifizetettként rögzítve', 'success');
        render(gyoker);
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  /** Ügyválasztó: a nyitott ügyek, jelölve, ami már szerepel valamelyik kötegben. */
  function ugyValaszto(b) {
    let ugyek = [];
    try { ugyek = CaseRepo.all().filter(c => !c.closedAt); } catch { ugyek = []; }

    const tetelek = ugyek.map(c => {
      const hol = TransferRepo.caseInAnyBatch(c.id);
      const emp = EmployeeRepo.get(c.employeeId);
      let nev = '(törölt személy)';
      if (emp) {
        const v = SchemaStore.resolveValues(emp.fields, 'hu');
        nev = [v.surname, v.forename].filter(Boolean).join(' ') || '(névtelen)';
      }
      const az = c.ehNumber || c.fileNumber || '';
      return { c, nev, az, hol };
    }).sort((a, b2) => a.nev.localeCompare(b2.nev, 'hu'));

    showDialog({
      title: 'Ügy hozzáadása a köteghez',
      body: `
        <p style="font-size:12px;color:var(--c-muted);margin:0 0 10px">
          Az összeget a felvétel után a táblázatban kell megadni (26 000 vagy 47 000 Ft).</p>
        <div class="checklist-scroll" style="max-height:330px">
          ${tetelek.length ? tetelek.map((t, i) => `
            <label class="template-radio-item" style="font-size:12.5px;min-height:30px;
                ${t.hol ? 'opacity:.6' : ''}">
              <input type="checkbox" name="tv-pick" value="${i}" ${t.hol ? 'disabled' : ''}>
              <span>
                <strong>${escHtml(t.nev)}</strong>
                <span style="color:var(--c-muted)"> · ${escHtml(t.az || 'nincs azonosító')}</span>
                ${t.hol ? `<span style="color:var(--c-amber)"> · már a(z) ${escHtml(t.hol.label)} kötegben</span>` : ''}
              </span>
            </label>`).join('')
          : '<div style="font-size:12px;color:var(--c-muted)">Nincs nyitott ügy.</div>'}
        </div>`,
      footer: `<button class="btn btn-primary btn-sm" id="tv-pick-ok">Hozzáadás</button>
               <button class="btn btn-ghost btn-sm" onclick="closeDialog()">Mégse</button>`,
    });

    document.getElementById('tv-pick-ok').addEventListener('click', () => {
      let db = 0;
      document.querySelectorAll('input[name="tv-pick"]:checked').forEach(cb => {
        const t = tetelek[Number(cb.value)];
        TransferRepo.addRow(b.id, TransferRepo.rowFromCase(t.c, EmployeeRepo.get(t.c.employeeId)));
        db++;
      });
      closeDialog();
      if (db) { toast(`${db} tétel hozzáadva`, 'success'); render(gyoker); }
    });
  }

  function naploDialogus(b) {
    const napló = TransferRepo.audit({ batchId: b.id });
    const cimke = {
      'batch.create':  'köteg létrehozva',
      'batch.destroy': 'köteg törölve',
      'batch.paid':    'kifizetettnek jelölve',
      'batch.reopen':  'visszanyitva',
      'row.add':       'tétel hozzáadva',
      'row.update':    'tétel módosítva',
      'row.remove':    'tétel törölve',
      'pdf.export':    'PDF készült',
    };

    showDialog({
      title: `Napló — ${b.label}`,
      body: `
        <p style="font-size:12px;color:var(--c-muted);margin:0 0 10px">
          Minden művelet bekerül, a törlés is. A napló a kötegek törlését is túléli.</p>
        <div class="checklist-scroll" style="max-height:360px">
          ${napló.length ? `<table class="tv-log">
            ${napló.map(a => `
              <tr>
                <td class="tv-log__at">${escHtml(String(a.at).replace('T', ' ').slice(0, 16))}</td>
                <td class="tv-log__who">${escHtml(a.user)}</td>
                <td>${escHtml(cimke[a.action] || a.action)}
                  ${a.field ? `<span class="muted"> · ${escHtml(a.field)}</span>` : ''}
                </td>
                <td class="tv-log__val">
                  ${a.before != null ? `<s>${escHtml(String(a.before))}</s>` : ''}
                  ${a.before != null && a.after != null ? ' → ' : ''}
                  ${a.after != null ? escHtml(String(a.after)) : ''}
                </td>
              </tr>`).join('')}
          </table>` : '<div style="font-size:12px;color:var(--c-muted)">Üres.</div>'}
        </div>`,
      footer: `<button class="btn btn-ghost btn-sm" onclick="closeDialog()">Bezárás</button>`,
    });
  }

  async function pdfKeszit(b) {
    const hibak = TransferRepo.batchIssues(b.id);
    if (hibak.length) {
      const folytat = await megerosit(
        'Ellenőrizd a PDF előtt',
        `<p style="font-size:13px;margin:0 0 8px">${hibak.length} sorral van gond:</p>
         <ul style="font-size:12px;margin:0 0 10px;padding-left:18px;max-height:180px;overflow-y:auto">
           ${hibak.slice(0, 12).map(h =>
             `<li><strong>${h.sorszam}.</strong> ${escHtml(h.hibak.join('; '))}</li>`).join('')}
         </ul>
         <p style="font-size:12px;color:var(--c-muted);margin:0">Elkészítsem így is?</p>`);
      if (!folytat) return;
    }

    try {
      let kimenet = null;
      try { kimenet = await FsService.loadHandle('output_dir'); } catch {}
      if (kimenet && !(await FsService.queryPermissionOnly(kimenet, true))) kimenet = null;

      const { nev, hova } = await TransferPdf.save(b, kimenet);
      toast(hova ? `✓ ${nev} — ${hova}` : `✓ ${nev} letöltve`, 'success');
      BevLogger.info('TRANSFER_PDF', `Díjátutalási lap: ${nev}`,
        `koteg=${b.label}, tetel=${b.rows.length}`, '');
    } catch (e) {
      toast(`A PDF nem készült el: ${e.message}`, 'error');
      BevLogger.error('TRANSFER_PDF', 'A díjátutalási lap nem készült el', e.message, '');
    }
  }

  function megerosit(cim, torzs) {
    return new Promise(res => {
      showDialog({
        title: cim, body: torzs,
        footer: `<button class="btn btn-primary btn-sm" id="tv-conf-ok">Folytatom</button>
                 <button class="btn btn-ghost btn-sm" id="tv-conf-no">Mégse</button>`,
      });
      document.getElementById('tv-conf-ok').addEventListener('click', () => { closeDialog(); res(true); });
      document.getElementById('tv-conf-no').addEventListener('click', () => { closeDialog(); res(false); });
    });
  }

  /**
   * Az ügylistából hívott gyors út: a nyitott kötegbe teszi az ügyet.
   * Ha nincs nyitott köteg, létrehoz egyet — a felhasználó egy kattintással
   * végezhessen, ne kelljen előbb „kosarat" nyitnia.
   */
  function addFromCase(caseObj) {
    const megvan = TransferRepo.caseInAnyBatch(caseObj.id);
    if (megvan) {
      toast(`Ez az ügy már a(z) ${megvan.label} kötegben van`, 'warn');
      return null;
    }
    const b = TransferRepo.openBatch();
    TransferRepo.addRow(b.id, TransferRepo.rowFromCase(caseObj, EmployeeRepo.get(caseObj.employeeId)));
    state.kivalasztott = b.id;
    toast(`✓ Hozzáadva a(z) ${b.label} köteghez`, 'success');
    return b;
  }

  return { render, addFromCase };
})();
