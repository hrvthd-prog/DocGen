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

          <label class="cf-field" id="cf-purpose-wrap">
            <span>Tartózkodási cél${szerkesztes ? '' : ' <strong>(kötelező)</strong>'}</span>
            <select id="cf-purpose" class="field-input">
              <option value="">— válassz —</option>
              ${CaseTypes.purposes().map(p => `<option value="${escHtml(p.key)}" ${c && c.purpose === p.key ? 'selected' : ''}>${escHtml(p.label)}</option>`).join('')}
            </select>
            <small>Ebből lesz az ügy neve, pl. „Nemzeti Kártya meghosszabbítása”.</small>
          </label>

          <label class="cf-field">
            <span id="cf-trigger-label">${escHtml(CaseTypes.triggerLabel(valasztottTipus))}</span>
            ${dateFieldHtml({ id: 'cf-trigger', value: c && c.triggerDate || '' })}
            <small id="cf-trigger-hint">Ebből számoljuk a határidőt. Amíg üres, nincs határidő.</small>
          </label>

          <label class="cf-field">
            <span>Határidő</span>
            ${dateFieldHtml({ id: 'cf-due', value: c && c.dueAt || '' })}
            <small id="cf-due-hint"></small>
          </label>

          <label class="cf-field">
            <span>EH szám</span>
            <input type="text" id="cf-eh" class="field-input" value="${escHtml(c && c.ehNumber || '')}"
                   placeholder="pl. EH18506859">
          </label>

          <label class="cf-field">
            <span>Iktatószám</span>
            <input type="text" id="cf-file" class="field-input" value="${escHtml(c && c.fileNumber || '')}"
                   placeholder="pl. 106-1-12345-2/2026-T">
          </label>

          ${c && CaseRepo.teendok(c) ? `
          <label class="cf-field">
            <span>Engedély érvényes (a határozat szerint)</span>
            ${dateFieldHtml({ id: 'cf-valid', value: c.validUntil || '' })}
          </label>` : ''}

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
    // A maszkolt dátummező `input`-ot ad gépelés közben – a `change` csak
    // fókuszvesztéskor jönne, addig a határidő-előnézet elavult maradna.
    triggerEl.addEventListener('input', () => { dueKezzel = false; frissit(); });

    function frissit() {
      const tk = tipusEl.value;
      q('cf-trigger-label').textContent = CaseTypes.triggerLabel(tk);
      q('cf-purpose-wrap').style.display = CaseTypes.needsPurpose(tk) ? '' : 'none';

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
      const celKell = CaseTypes.needsPurpose(tipusEl.value);
      // Új ügynél kötelező; a régi, cél nélküli ügy szerkesztése nem akad meg rajta.
      if (celKell && !szerkesztes && !q('cf-purpose').value) {
        toast('Add meg a tartózkodási célt', 'warn');
        q('cf-purpose').focus();
        return;
      }
      const adat = {
        type:        tipusEl.value,
        purpose:     celKell ? (q('cf-purpose').value || null) : null,
        ...(q('cf-valid') ? { validUntil: q('cf-valid').value || null } : {}),
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
      title: `Státusz rögzítése — ${CaseTypes.title(c)}`,
      body: `
        <div class="cf-grid">
          <label class="cf-field">
            <span>Új státusz</span>
            <select id="cs-status" class="field-input">
              ${statuszok.map(s => `<option value="${escHtml(s.key)}" ${s.key === kovetkezo.key ? 'selected' : ''}>${escHtml(s.label)}${s.terminal ? ' (lezárás)' : ''}</option>`).join('')}
            </select>
          </label>

          <label class="cf-field">
            <span>Mikor történt?</span>
            ${dateFieldHtml({ id: 'cs-occurred', value: CaseTypes.isoDate(new Date()) })}
            <small>Ha napokkal később viszed fel, állítsd a tényleges napra.</small>
          </label>

          <label class="cf-field cf-field--wide" id="cs-outcome-wrap" style="display:none">
            <span>Kimenetel <strong>(lezáráshoz kötelező)</strong></span>
            <select id="cs-outcome" class="field-input">
              <option value="">— válassz —</option>
              ${CaseTypes.outcomes().map(o => `<option value="${escHtml(o.key)}">${escHtml(o.label)}</option>`).join('')}
            </select>
          </label>

          <label class="cf-field" id="cs-valid-wrap" style="display:none">
            <span>Engedély érvényes <strong>(a határozat szerint)</strong></span>
            ${dateFieldHtml({ id: 'cs-valid' })}
            <small>A sorozatszám az okmánnyal jön — az később, a teendők között.</small>
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

    const azonositot = !!(CaseTypes.byKey(c.type) || {}).producesIdentifier;
    const ervenyesKell = () => azonositot && CaseTypes.isTerminal(c.type, statusEl.value) &&
                               q('cs-outcome').value === 'megadva';
    function frissit() {
      const zaro = CaseTypes.isTerminal(c.type, statusEl.value);
      q('cs-outcome-wrap').style.display = zaro ? '' : 'none';
      q('cs-valid-wrap').style.display = ervenyesKell() ? '' : 'none';
    }
    statusEl.addEventListener('change', frissit);
    q('cs-outcome').addEventListener('change', frissit);
    frissit();

    q('cs-save').addEventListener('click', () => {
      if (ervenyesKell() && !q('cs-valid').value) {
        toast('Add meg, meddig érvényes az új engedély (a határozatban áll)', 'warn');
        q('cs-valid').focus();
        return;
      }
      try {
        CaseRepo.setStatus(caseId, statusEl.value, {
          note:       q('cs-note').value,
          outcome:    q('cs-outcome').value || null,
          validUntil: ervenyesKell() ? q('cs-valid').value : null,
          ehNumber:   q('cs-eh').value,
          fileNumber: q('cs-file').value,
          occurredAt: q('cs-occurred').value || null,
        });
        closeDialog();
        toast('✓ Státusz rögzítve', 'success');
        if (onSaved) onSaved(caseId);
        tajekoztat(caseId);
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  /**
   * Engedélyezés után: mi a teendő, és mikorra. A munkaviszony megkezdését a
   * döntéstől számított 5 napon belül be kell jelenteni — ezt mondjuk ki elsőként.
   * Utána a következő meghosszabbítás előjegyzése (ha az ügy hozott lejáratot).
   */
  function tajekoztat(caseId) {
    const lista = CaseRepo.teendok(CaseRepo.get(caseId));
    if (!lista) return;
    const bej = lista.find(t => t.key === 'bejelentes');
    showDialog({
      title: 'Engedélyezve — a teendők',
      body: `
        <p style="font-size:12.5px;margin-bottom:8px">
          A munkaviszony megkezdését <strong>${escHtml(CaseTimeline.huDatum(bej.hatarido))}</strong>-ig
          be kell jelenteni (a döntéstől számított 5 nap).
        </p>
        <ul style="font-size:12px;margin:0 0 8px 18px">
          ${lista.map(t => `<li>${escHtml(t.label)}</li>`).join('')}
        </ul>
        <p style="font-size:11.5px;color:var(--c-muted)">A lista az ügy idővonalának tetején
          van; ott pipálható, és ott készül a SAP-táblázat is.</p>`,
      footer: `<button class="btn btn-primary btn-sm" id="ct-info-ok">Rendben</button>`,
    });
    document.getElementById('ct-info-ok').addEventListener('click', () => {
      closeDialog();
      ajanljKovetkezot(caseId);
    });
  }

  /**
   * Az okmány megjött: a sorozatszám rögzítése. Enélkül a dolgozó azonosító-
   * történetéből kimaradna, és az xlsx-export a régi engedélyszámot vinné tovább.
   * A lejárat a határozatból rögzített érvényességgel előtöltve — ha a kártyán
   * más áll, az nyer (ez az „érvényességi idő ellenőrzése”).
   */
  function openSorozatszam({ caseId } = {}) {
    const c = CaseRepo.get(caseId);
    if (!c || c.producedId) return;
    const t = CaseTypes.byKey(c.type);
    if (!t || !t.producesIdentifier) return;

    showDialog({
      title: 'Megérkezett az okmány — sorozatszám',
      body: `
        <p style="font-size:12px;color:var(--c-muted);margin-bottom:10px">
          Írd be az új okmány számát – a korábbi automatikusan lezárul, és az
          adatbekérő is ezt fogja tartalmazni. Ellenőrizd az érvényességet a kártyán.
        </p>
        <div class="cf-grid">
          <label class="cf-field">
            <span>${escHtml(EmployeeRepo.idTypeLabel(t.producesIdentifier))}</span>
            <input type="text" id="ci-value" class="field-input" autofocus>
          </label>
          <label class="cf-field">
            <span>Érvényes (a kártyán)</span>
            ${dateFieldHtml({ id: 'ci-expires', value: c.validUntil || '' })}
            <small id="ci-hint">${c.validUntil
              ? `A határozat szerint: ${escHtml(CaseTimeline.huDatum(c.validUntil))}`
              : 'Ebből számoljuk a következő benyújtási ablakot.'}</small>
          </label>
        </div>`,
      footer: `
        <button class="btn btn-ghost btn-sm" onclick="closeDialog()">Később</button>
        <button class="btn btn-primary btn-sm" id="ci-save">Rögzítés</button>`,
    });

    const lejarEl = document.getElementById('ci-expires');
    lejarEl.addEventListener('input', () => {
      if (c.validUntil && lejarEl.value && lejarEl.value !== c.validUntil) {
        document.getElementById('ci-hint').innerHTML =
          `<strong>Eltér a határozattól</strong> (${escHtml(CaseTimeline.huDatum(c.validUntil))}) — a kártya nyer.`;
      }
    });

    document.getElementById('ci-save').addEventListener('click', () => {
      const ertek = document.getElementById('ci-value').value.trim();
      const lejar = lejarEl.value || null;
      if (!ertek) { toast('Az azonosító nem lehet üres', 'warn'); return; }
      try {
        CaseRepo.recordProducedIdentifier(caseId, { value: ertek, expiresAt: lejar });
        closeDialog();
        toast('✓ Azonosító rögzítve', 'success');
        if (lejar) ajanljKovetkezot(caseId);
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  /**
   * A meghosszabbítás nem egyszeri esemény, hanem ciklus: amint megvan az új
   * engedély lejárata, azonnal tudható, mikor nyílik a következő ablak.
   * Egy kattintással láncba fűzhető, hogy ne kelljen évek múlva emlékezni rá.
   */
  function ajanljKovetkezot(caseId) {
    const c = CaseRepo.get(caseId);
    if (!c) return;
    const emp = EmployeeRepo.get(c.employeeId);
    if (!emp) return;

    if (CaseRepo.hasOpenCaseOfType(emp.id, 'rp_hosszabbitas')) return;   // már van
    const ablak = CaseTypes.submissionWindow('rp_hosszabbitas', emp.fields);
    if (!ablak) return;

    showDialog({
      title: 'Következő meghosszabbítás előjegyzése',
      body: `
        <p style="font-size:12px;color:var(--c-text);margin-bottom:10px">
          Az új engedély <strong>${escHtml(CaseTimeline.huDatum(ablak.basis))}</strong>-ig érvényes.
          A következő meghosszabbítási kérelem benyújtási ablaka:
        </p>
        <div style="border:1px solid var(--c-border);border-radius:6px">
          ${CaseTimeline.renderWindowBar(
            { window: ablak, phase: CaseTypes.windowPhase(ablak),
              text: 'A következő ciklus ablaka', done: false },
            CaseTypes.isoDate(new Date()))}
        </div>
        <p style="font-size:11px;color:var(--c-muted);margin-top:10px">
          Előjegyezve az ügy már most megjelenik az Ügyek listában, és időben
          figyelmeztet. Bármikor törölhető.
        </p>`,
      footer: `
        <button class="btn btn-ghost btn-sm" onclick="closeDialog()">Most nem</button>
        <button class="btn btn-primary btn-sm" id="cn-save">Előjegyzem</button>`,
    });

    document.getElementById('cn-save').addEventListener('click', () => {
      try {
        CaseRepo.openNextCase(caseId);
        closeDialog();
        toast('✓ Következő meghosszabbítás előjegyezve', 'success');
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  /**
   * A SAP-ticket táblázata (plans/TERV-kimenet-es-ugyek.md 6.3). A Kilépés és az
   * Új belépés szabadon megadandó: egyik sem vezethető le a döntésből, ezért
   * üresen nyílnak. A táblázat a dolgozó 01_Elokeszitett mappájába kerül.
   */
  function openSap({ caseId } = {}) {
    const c = CaseRepo.get(caseId);
    if (!c || !c.closedAt) return;
    showDialog({
      title: 'SAP-táblázat a back office-nak',
      body: `
        <div class="cf-grid">
          <label class="cf-field">
            <span>Kilépés</span>
            ${dateFieldHtml({ id: 'sap-ki' })}
          </label>
          <label class="cf-field">
            <span>Új belépés</span>
            ${dateFieldHtml({ id: 'sap-be' })}
          </label>
        </div>
        <p style="font-size:11.5px;color:var(--c-muted);margin-top:8px">
          A többi oszlop a nyilvántartásból és az ügyből jön (törzsszám, közvetlen vezető,
          időrögzítési ügyintéző, K2, érvényesség, iktatószám, döntés napja).</p>`,
      footer: `
        <button class="btn btn-ghost btn-sm" onclick="closeDialog()">Mégse</button>
        <button class="btn btn-primary btn-sm" id="sap-save">Táblázat mentése</button>`,
    });
    document.getElementById('sap-save').addEventListener('click', async () => {
      // Az engedélykérés a kattintás része kell legyen: előbb kérjük, csak utána építünk.
      const rootP = DocgenModule.requestOutputDir().catch(() => null);
      try {
        const { buffer, hianyzik } = await CaseXlsx.sap(c, {
          kilepes: document.getElementById('sap-ki').value || null,
          belepes: document.getElementById('sap-be').value || null,
        });
        const ut = await DocgenModule.mentesDolgozonak({
          root: await rootP, employeeId: c.employeeId, name: CaseXlsx.sapFilename(c), buf: buffer,
        });
        closeDialog();
        toast(`✓ SAP-táblázat ${ut ? 'mentve: ' + ut : 'letöltve'}`, 'success');
        if (hianyzik.length) toast(`Üresen maradt: ${hianyzik.join(', ')}`, 'warn');
      } catch (e) {
        BevLogger.error('SAP_XLSX', 'A SAP-táblázat nem készült el', e.message, '');
        toast('A SAP-táblázat nem készült el: ' + e.message, 'error');
      }
    });
  }

  // ── Bejegyzés utólagos javítása ────────────────────────────────────────────

  /**
   * Elgépelt dátum, megjegyzés vagy ROSSZ STÁTUSZ javítása egy meglévő
   * idővonal-bejegyzésen.
   *
   * A státusz azért szerkeszthető, mert mellényúlni a legördülőben egy
   * pillanat (hiánypótlás vs. elbírálás alatt), és eddig nem volt rá visszaút.
   */
  function openEvent({ caseId, index, onSaved = null } = {}) {
    const c = CaseRepo.get(caseId);
    if (!c || !c.events[index]) { toast('A bejegyzés nem található', 'error'); return; }
    const e = c.events[index];
    const statuszok = e.status ? CaseTypes.statusesOf(c.type) : [];

    showDialog({
      title: 'Bejegyzés javítása',
      body: `
        <div class="cf-grid">
          ${statuszok.length ? `
          <label class="cf-field">
            <span>Státusz</span>
            <select id="ce-status" class="field-input">
              ${statuszok.map(st => `<option value="${escHtml(st.key)}" ${st.key === e.status ? 'selected' : ''}>${escHtml(st.label)}${st.terminal ? ' (lezárás)' : ''}</option>`).join('')}
            </select>
            <small>Rossz státuszt választottál? Itt javítható.</small>
          </label>

          <label class="cf-field" id="ce-outcome-wrap" style="display:none">
            <span>Kimenetel <strong>(lezáráshoz kötelező)</strong></span>
            <select id="ce-outcome" class="field-input">
              <option value="">— válassz —</option>
              ${CaseTypes.outcomes().map(o => `<option value="${escHtml(o.key)}" ${o.key === e.outcome ? 'selected' : ''}>${escHtml(o.label)}</option>`).join('')}
            </select>
          </label>` : ''}

          <label class="cf-field">
            <span>Mikor történt?</span>
            ${dateFieldHtml({ id: 'ce-occurred', value: e.occurredAt || '' })}
          </label>
          <div class="cf-field">
            <span>Rögzítve</span>
            <div style="font-size:12px;padding-top:6px;color:var(--c-muted)">
              ${escHtml(CaseTimeline.huDatum(String(e.at).slice(0, 10)))}
              ${e.user ? ` · ${escHtml(e.user)}` : ''}
            </div>
            <small>Ez az audit-nyom, nem módosítható.</small>
          </div>
          <label class="cf-field cf-field--wide">
            <span>Megjegyzés</span>
            <textarea id="ce-note" class="field-input" rows="2">${escHtml(e.note || '')}</textarea>
          </label>
        </div>`,
      footer: `
        <button class="btn btn-ghost btn-sm" onclick="closeDialog()">Mégse</button>
        <button class="btn btn-primary btn-sm" id="ce-save">Mentés</button>`,
    });

    const statusEl = document.getElementById('ce-status');
    if (statusEl) {
      const frissit = () => {
        document.getElementById('ce-outcome-wrap').style.display =
          CaseTypes.isTerminal(c.type, statusEl.value) ? '' : 'none';
      };
      statusEl.addEventListener('change', frissit);
      frissit();
    }

    document.getElementById('ce-save').addEventListener('click', () => {
      try {
        CaseRepo.updateEvent(caseId, index, Object.assign({
          occurredAt: document.getElementById('ce-occurred').value,
          note:       document.getElementById('ce-note').value,
        }, statusEl ? {
          status:  statusEl.value,
          outcome: document.getElementById('ce-outcome').value || null,
        } : {}));
        closeDialog();
        toast('✓ Bejegyzés javítva', 'success');
        if (onSaved) onSaved();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  return { open, openStatus, openEvent, openSorozatszam, openSap };
})();
