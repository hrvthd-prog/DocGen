'use strict';

/**
 * Ügy létrehozása / szerkesztése és státusz-léptetés.
 *
 * Két párbeszéd:
 *   open()       – új ügy vagy a törzsadatok módosítása
 *   openStatus() – státuszváltás, lezáráskor kötelező kimenetellel
 *
 * Mindkettőben megadható EH szám és iktatószám: az iktatószám gyakran csak
 * beadáskor keletkezik, ezért a státuszváltásnál is kérjük.
 */
const CaseForm = (() => {

  function dolgozok() {
    try {
      return EmployeeRepo.all().map(e => {
        const v = SchemaStore.resolveValues(e.fields, 'hu');
        return { id: e.id, nev: [v.surname, v.forename].filter(Boolean).join(' ') || '(névtelen)' };
      }).sort((a, b) => a.nev.localeCompare(b.nev, 'hu'));
    } catch { return []; }
  }

  function mezoi(employeeId) {
    try { return (EmployeeRepo.get(employeeId) || {}).fields || {}; }
    catch { return {}; }
  }

  // ── Új ügy / szerkesztés ───────────────────────────────────────────────────

  function open({ caseId = null, employeeId = null, type = null, onSaved = null } = {}) {
    const szerkesztes = !!caseId;
    const c = szerkesztes ? CaseRepo.get(caseId) : null;
    if (szerkesztes && !c) { toast('Az ügy nem található', 'error'); return; }

    const emberek = dolgozok();
    const valasztottEmber = c ? c.employeeId : (employeeId || (emberek[0] || {}).id || '');
    const valasztottTipus = c ? c.type : (type || (CaseTypes.all()[0] || {}).key || '');

    showDialog({
      title: szerkesztes ? 'Ügy adatai' : 'Új ügy',
      body: `
        <div class="cf-grid">
          <label class="cf-field">
            <span>Munkavállaló</span>
            <select id="cf-emp" class="field-input" ${szerkesztes ? 'disabled' : ''}>
              ${emberek.map(e => `<option value="${escHtml(e.id)}" ${e.id === valasztottEmber ? 'selected' : ''}>${escHtml(e.nev)}</option>`).join('')}
            </select>
          </label>

          <label class="cf-field">
            <span>Ügytípus</span>
            <select id="cf-type" class="field-input">
              ${CaseTypes.all().map(t => `<option value="${escHtml(t.key)}" ${t.key === valasztottTipus ? 'selected' : ''}>${escHtml(t.label.hu)}</option>`).join('')}
            </select>
          </label>

          <label class="cf-field">
            <span id="cf-trigger-label">${escHtml(CaseTypes.triggerLabel(valasztottTipus))}</span>
            <input type="date" id="cf-trigger" class="field-input" value="${escHtml(c && c.triggerDate || '')}">
            <small id="cf-trigger-hint">Ebből számoljuk a határidőt. Amíg üres, nincs határidő.</small>
          </label>

          <label class="cf-field">
            <span>Határidő</span>
            <input type="date" id="cf-due" class="field-input" value="${escHtml(c && c.dueAt || '')}">
            <small id="cf-due-hint"></small>
          </label>

          <label class="cf-field">
            <span>EH szám</span>
            <input type="text" id="cf-eh" class="field-input" value="${escHtml(c && c.ehNumber || '')}"
                   placeholder="pl. EH-2026-001">
          </label>

          <label class="cf-field">
            <span>Iktatószám</span>
            <input type="text" id="cf-file" class="field-input" value="${escHtml(c && c.fileNumber || '')}"
                   placeholder="pl. 12345-2/2026">
          </label>

          <label class="cf-field cf-field--wide">
            <span>Megjegyzés</span>
            <textarea id="cf-note" class="field-input" rows="2">${escHtml(c && c.note || '')}</textarea>
          </label>
        </div>

        <div id="cf-window" class="cf-window"></div>
      `,
      footer: `
        <button class="btn btn-ghost btn-sm" onclick="closeDialog()">Mégse</button>
        <button class="btn btn-primary btn-sm" id="cf-save">${szerkesztes ? 'Mentés' : 'Ügy megnyitása'}</button>
      `,
    });

    const q = s => document.getElementById(s);
    const tipusEl = q('cf-type'), triggerEl = q('cf-trigger'), dueEl = q('cf-due');
    let dueKezzel = !!(c && c.dueAt);

    dueEl.addEventListener('input', () => { dueKezzel = true; frissit(); });

    function frissit() {
      const tk = tipusEl.value;
      q('cf-trigger-label').textContent = CaseTypes.triggerLabel(tk);

      // A határidő a kezdő dátumból számolódik, ha nem írták felül kézzel
      if (!dueKezzel) {
        dueEl.value = CaseTypes.suggestDueDate(tk, triggerEl.value || null) || '';
      }
      q('cf-due-hint').textContent = dueEl.value
        ? (CaseTypes.isAdvisoryDeadline(tk)
            ? 'Tájékoztató – a megadott naptól számolva'
            : 'A hatóság ügyintézési határideje')
        : 'Add meg a kezdő dátumot, vagy írd be kézzel';

      // Benyújtási ablak előnézete
      const empId = q('cf-emp').value;
      const ablak = CaseTypes.submissionWindow(tk, mezoi(empId));
      q('cf-window').innerHTML = ablak
        ? CaseTimeline.renderWindowBar(
            { window: ablak, phase: CaseTypes.windowPhase(ablak),
              text: benyujtasSzoveg(ablak), done: false },
            CaseTypes.isoDate(new Date()))
        : '';
    }

    function benyujtasSzoveg(a) {
      const f = CaseTypes.windowPhase(a);
      return {
        korai:   'Még nem adható be',
        idealis: 'Beadható',
        siess:   'Sürgős – közeleg a legvégső nap',
        lekesve: 'A benyújtási határidő lejárt',
      }[f] || '';
    }

    tipusEl.addEventListener('change', () => { dueKezzel = false; frissit(); });
    triggerEl.addEventListener('change', () => { dueKezzel = false; frissit(); });
    q('cf-emp').addEventListener('change', frissit);
    frissit();

    q('cf-save').addEventListener('click', () => {
      const adat = {
        type:        tipusEl.value,
        triggerDate: triggerEl.value || null,
        dueAt:       dueEl.value || null,
        ehNumber:    q('cf-eh').value,
        fileNumber:  q('cf-file').value,
        note:        q('cf-note').value,
      };
      try {
        let id;
        if (szerkesztes) {
          CaseRepo.update(caseId, adat);
          id = caseId;
        } else {
          id = CaseRepo.create(Object.assign({ employeeId: q('cf-emp').value }, adat)).id;
        }
        closeDialog();
        toast(szerkesztes ? '✓ Ügy mentve' : '✓ Ügy megnyitva', 'success');
        if (onSaved) onSaved(id);
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  // ── Státusz-léptetés ───────────────────────────────────────────────────────

  function openStatus({ caseId, onSaved = null } = {}) {
    const c = CaseRepo.get(caseId);
    if (!c) { toast('Az ügy nem található', 'error'); return; }

    const statuszok = CaseTypes.statusesOf(c.type);
    const jelenlegi = statuszok.findIndex(s => s.key === c.status);
    const kovetkezo = statuszok[Math.min(jelenlegi + 1, statuszok.length - 1)];

    showDialog({
      title: `Státusz rögzítése — ${CaseTypes.label(c.type)}`,
      body: `
        <div class="cf-grid">
          <label class="cf-field cf-field--wide">
            <span>Új státusz</span>
            <select id="cs-status" class="field-input">
              ${statuszok.map(s => `<option value="${escHtml(s.key)}" ${s.key === kovetkezo.key ? 'selected' : ''}>${escHtml(s.label)}${s.terminal ? ' (lezárás)' : ''}</option>`).join('')}
            </select>
          </label>

          <label class="cf-field cf-field--wide" id="cs-outcome-wrap" style="display:none">
            <span>Kimenetel <strong>(lezáráshoz kötelező)</strong></span>
            <select id="cs-outcome" class="field-input">
              <option value="">— válassz —</option>
              ${CaseTypes.outcomes().map(o => `<option value="${escHtml(o.key)}">${escHtml(o.label)}</option>`).join('')}
            </select>
          </label>

          <label class="cf-field">
            <span>EH szám</span>
            <input type="text" id="cs-eh" class="field-input" value="${escHtml(c.ehNumber || '')}">
          </label>

          <label class="cf-field">
            <span>Iktatószám</span>
            <input type="text" id="cs-file" class="field-input" value="${escHtml(c.fileNumber || '')}">
          </label>

          <label class="cf-field cf-field--wide">
            <span>Megjegyzés</span>
            <textarea id="cs-note" class="field-input" rows="2"
                      placeholder="Mi történt? Ez kerül az idővonalra."></textarea>
          </label>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost btn-sm" onclick="closeDialog()">Mégse</button>
        <button class="btn btn-primary btn-sm" id="cs-save">Rögzítés</button>
      `,
    });

    const q = s => document.getElementById(s);
    const statusEl = q('cs-status');

    function frissit() {
      const zaro = CaseTypes.isTerminal(c.type, statusEl.value);
      q('cs-outcome-wrap').style.display = zaro ? '' : 'none';
    }
    statusEl.addEventListener('change', frissit);
    frissit();

    q('cs-save').addEventListener('click', () => {
      try {
        CaseRepo.setStatus(caseId, statusEl.value, {
          note:       q('cs-note').value,
          outcome:    q('cs-outcome').value || null,
          ehNumber:   q('cs-eh').value,
          fileNumber: q('cs-file').value,
        });
        closeDialog();
        toast('✓ Státusz rögzítve', 'success');
        if (onSaved) onSaved(caseId);
        ajanljAzonositot(caseId);
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  /**
   * Ha egy sikeresen lezárt kérelem azonosítót hoz, azt itt kérjük be –
   * különben a dolgozó azonosító-történetéből kimaradna, és az xlsx-export
   * a régi engedélyszámot vinné tovább.
   */
  function ajanljAzonositot(caseId) {
    const c = CaseRepo.get(caseId);
    if (!c || !c.closedAt || c.outcome !== 'megadva' || c.producedId) return;
    const t = CaseTypes.byKey(c.type);
    if (!t || !t.producesIdentifier) return;

    showDialog({
      title: 'Új azonosító rögzítése',
      body: `
        <p style="font-size:12px;color:var(--c-muted);margin-bottom:10px">
          Az ügy megadással zárult. Írd be az új számot – a korábbi automatikusan
          lezárul, és az adatbekérő is ezt fogja tartalmazni.
        </p>
        <label class="cf-field cf-field--wide">
          <span>${escHtml(EmployeeRepo.idTypeLabel(t.producesIdentifier))}</span>
          <input type="text" id="ci-value" class="field-input" autofocus>
        </label>`,
      footer: `
        <button class="btn btn-ghost btn-sm" onclick="closeDialog()">Később</button>
        <button class="btn btn-primary btn-sm" id="ci-save">Rögzítés</button>`,
    });

    document.getElementById('ci-save').addEventListener('click', () => {
      const ertek = document.getElementById('ci-value').value.trim();
      if (!ertek) { toast('Az azonosító nem lehet üres', 'warn'); return; }
      try {
        CaseRepo.recordProducedIdentifier(caseId, { value: ertek });
        closeDialog();
        toast('✓ Azonosító rögzítve', 'success');
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  return { open, openStatus };
})();
