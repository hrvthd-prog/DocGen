'use strict';

/**
 * Egy dolgozó összesítő lapja — csak olvasható.
 *
 * A szerkesztő űrlap minden mezőt beviteli dobozként mutat, ezért egy adat
 * MEGNÉZÉSÉHEZ is „bele kellett lépni". Itt az adatok szövegként állnak
 * (kijelölhetők, másolhatók), és ha valamit módosítani kell, a sorra
 * kattintás a szerkesztőt pont annál a mezőnél nyitja meg.
 *
 * Az üres mezők alapból rejtve: a séma ~száz mezőjéből egy dolgozónál
 * jellemzően a fele üres, az a lapot olvashatatlanná tenné. A kapcsoló
 * felhasználónként megmarad.
 */
const EmployeeSummary = (() => {

  const AZONOSITO = '__azonosito';   // a szerkesztő azonosító-blokkja

  function open(id) {
    const emp = EmployeeRepo.get(id);
    if (!emp) { toast('A dolgozó nem található.', 'error'); return; }
    const uresek = !!Settings.getUser('emp_summary_empty', false);
    const v = SchemaStore.resolveValues(emp.fields, 'hu');
    const nev = [v.surname, v.forename].filter(Boolean).join(' ') || '(névtelen)';

    showDialog({
      title: `Összesítő — ${nev}`,
      body: `
        <div class="es-wrap">
          <div class="es-chips">
            <span class="es-chip ${emp.exited ? 'is-off' : 'is-on'}">${
              emp.exited ? `kilépett${emp.exitDate ? ' · ' + escHtml(emp.exitDate) : ''}` : 'aktív'}</span>
            ${emp.noRenewal ? '<span class="es-chip is-warn">nem hosszabbítjuk</span>' : ''}
            <label class="check-row es-empty-toggle">
              <input type="checkbox" id="es-empty" ${uresek ? 'checked' : ''}>
              <span>Üres mezők is</span>
            </label>
          </div>
          <p class="ef-hint">Kattints egy adatra a szerkesztéshez — a szerkesztő annál
            a mezőnél nyílik meg. A szöveg kijelölhető és másolható.</p>
          ${azonositokHtml(emp)}
          ${SchemaStore.byGroup({ includeComputed: false })
              .map(g => csoportHtml(g, emp, uresek)).join('')}
          ${ugyekHtml(emp)}
        </div>`,
      footer: `
        <button class="btn btn-ghost btn-sm" id="es-history">Előzmények</button>
        <button class="btn btn-ghost btn-sm" id="es-edit">Szerkesztés</button>
        <button class="btn btn-primary btn-sm" onclick="closeDialog()">Bezárás</button>`,
    });

    const box = document.querySelector('.es-wrap');
    box.addEventListener('click', e => {
      const sor = e.target.closest('[data-es-key]');
      if (!sor) return;
      // Kijelölés közben nem nyílik a szerkesztő — a szöveg másolható marad
      const sel = window.getSelection && String(window.getSelection()).trim();
      if (sel) return;
      szerkeszt(id, sor.dataset.esKey);
    });
    document.getElementById('es-empty').addEventListener('change', e => {
      Settings.setUser('emp_summary_empty', e.target.checked);
      open(id);
    });
    document.getElementById('es-edit').addEventListener('click', () => szerkeszt(id, null));
    document.getElementById('es-history').addEventListener('click', () => EmployeeHistory.open(emp));
  }

  /** A szerkesztő a kért mezőnél; mentés után vissza az összesítőre. */
  function szerkeszt(id, kulcs) {
    closeDialog();
    EmployeeForm.open({ id, focus: kulcs, onSave: () => open(id) });
  }

  function sorHtml(kulcs, cimke, ertek) {
    return `
      <div class="es-row" data-es-key="${escHtml(kulcs)}" title="Kattintás: szerkesztés">
        <span class="es-label">${escHtml(cimke)}</span>
        <span class="es-value">${ertek ? escHtml(ertek) : '<span class="es-none">—</span>'}</span>
      </div>`;
  }

  function azonositokHtml(emp) {
    const aktualis = emp.identifiers.filter(i => i.current);
    return `
      <section class="es-group">
        <h4 class="ef-group-title">Azonosítók</h4>
        <div class="es-grid">
          ${aktualis.length
            ? aktualis.map(i => sorHtml(AZONOSITO, EmployeeRepo.idTypeLabel(i.type), i.value)).join('')
            : sorHtml(AZONOSITO, 'Azonosító', '')}
        </div>
      </section>`;
  }

  function csoportHtml(g, emp, uresek) {
    const sorok = g.fields
      .map(f => ({ f, ertek: SchemaStore.renderValue(f, emp.fields[f.key], 'hu') }))
      .filter(x => uresek || x.ertek);
    if (!sorok.length) return '';
    return `
      <section class="es-group">
        <h4 class="ef-group-title">${escHtml(g.group.label)}</h4>
        <div class="es-grid">
          ${sorok.map(x => sorHtml(x.f.key, x.f.label.hu, x.ertek)).join('')}
        </div>
      </section>`;
  }

  function ugyekHtml(emp) {
    let ugyek = [];
    try { ugyek = CaseRepo.forEmployee(emp.id); } catch { return ''; }
    if (!ugyek.length) return '';
    return `
      <section class="es-group">
        <h4 class="ef-group-title">Ügyek</h4>
        ${ugyek.map(c => `
          <div class="es-case${c.closedAt ? ' is-closed' : ''}">
            <b>${escHtml(CaseTypes.label(c.type))}</b>
            <span>${escHtml(CaseTypes.statusLabel(c.type, c.status))}</span>
            <span class="es-none">${escHtml(CaseRepo.deadlineText(c))}</span>
          </div>`).join('')}
      </section>`;
  }

  return { open, AZONOSITO };
})();
