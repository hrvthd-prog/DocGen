'use strict';

/**
 * Ügyek fül – az összes dolgozó összes ügye egy helyen.
 *
 * A cél, hogy reggel megnyitva azonnal látszódjon, mi ég: a lista
 * alapértelmezés szerint sürgősség szerint rendez, a lejárt és a közelgő
 * ügyek elöl. Egy ügyre kattintva megnyílik az idővonala.
 */
const CasesModule = (() => {

  let container = null;

  const state = {
    szuro:      'nyitott',      // nyitott | lejart | surgos | lezart | mind
    kereses:    '',
    kivalasztott: null,
  };

  const SZUROK = [
    { key: 'nyitott', label: 'Nyitott' },
    { key: 'lejart',  label: 'Lejárt' },
    { key: 'surgos',  label: 'Sürgős' },
    { key: 'lezart',  label: 'Lezárt' },
    { key: 'mind',    label: 'Mind' },
  ];

  function init(el) {
    container = el;
    render();
    frissitJelzo();
    window.addEventListener('docgenTabActivated', e => {
      if (e.detail === 'cases') render();
    });
    CaseRepo.onChange(() => { render(); frissitJelzo(); });
    EmployeeRepo.onChange(() => { render(); frissitJelzo(); });
  }

  /**
   * Lejárt ügyek száma a fül címkéjén.
   *
   * Csak a LEJÁRT ügyek kapnak jelzést. Ha minden számot kiírnánk, a jelzés
   * állandóan ott lenne, és pár nap alatt megszoknánk – így viszont a piros
   * pötty megjelenése tényleg jelent valamit.
   */
  function frissitJelzo() {
    const gomb = document.querySelector('.tab-btn[data-tab="cases"]');
    if (!gomb) return;

    let db = 0;
    try { db = CaseRepo.summary().lejart; } catch { db = 0; }

    let jelzo = gomb.querySelector('.tab-btn__badge');
    if (!db) { if (jelzo) jelzo.remove(); return; }

    if (!jelzo) {
      jelzo = document.createElement('span');
      jelzo.className = 'tab-btn__badge';
      gomb.appendChild(jelzo);
    }
    jelzo.textContent = db > 99 ? '99+' : String(db);
    jelzo.title = `${db} lejárt határidejű ügy`;
  }

  function keszAll() {
    try { CaseRepo.all(); EmployeeRepo.all(); return true; }
    catch { return false; }
  }

  function dolgozoNeve(employeeId) {
    try {
      const e = EmployeeRepo.get(employeeId);
      if (!e) return '(törölt személy)';
      const v = SchemaStore.resolveValues(e.fields, 'hu');
      return [v.surname, v.forename].filter(Boolean).join(' ') || '(névtelen)';
    } catch { return '(ismeretlen)'; }
  }

  function dolgozoMezoi(employeeId) {
    try { return (EmployeeRepo.get(employeeId) || {}).fields || {}; }
    catch { return {}; }
  }

  // ── Lista ──────────────────────────────────────────────────────────────────

  function szurtLista() {
    let lista = state.kereses ? CaseRepo.search(state.kereses) : CaseRepo.all();

    if (state.szuro !== 'mind') {
      lista = lista.filter(c => {
        const s = CaseRepo.urgency(c);
        if (state.szuro === 'nyitott') return s !== 'lezart';
        return s === state.szuro;
      });
    }

    // Név szerinti kereséshez a dolgozó nevét is nézzük
    if (state.kereses) {
      const talalt = new Set(lista.map(c => c.id));
      const needle = state.kereses.toLowerCase();
      for (const c of CaseRepo.all()) {
        if (talalt.has(c.id)) continue;
        if (dolgozoNeve(c.employeeId).toLowerCase().includes(needle)) lista.push(c);
      }
    }

    const rang = { lejart: 0, surgos: 1, nyitott: 2, lezart: 3 };
    return lista.sort((a, b) => {
      const ra = rang[CaseRepo.urgency(a)], rb = rang[CaseRepo.urgency(b)];
      if (ra !== rb) return ra - rb;
      return String(a.dueAt || '9999').localeCompare(String(b.dueAt || '9999'));
    });
  }

  function sorHtml(c) {
    const s = CaseRepo.urgency(c);
    const kivalasztva = state.kivalasztott === c.id;
    return `
      <button class="cv-row ${kivalasztva ? 'is-selected' : ''} cv-row--${s}" data-id="${escHtml(c.id)}">
        <span class="cv-row__dot cv-row__dot--${s}"></span>
        <span class="cv-row__main">
          <span class="cv-row__name">${escHtml(dolgozoNeve(c.employeeId))}</span>
          <span class="cv-row__type">${escHtml(CaseTypes.label(c.type))}</span>
        </span>
        <span class="cv-row__meta">
          <span class="cv-row__status">${escHtml(CaseTypes.statusLabel(c.type, c.status))}</span>
          <span class="cv-row__due">${escHtml(CaseRepo.deadlineText(c))}</span>
        </span>
      </button>`;
  }

  // ── Megjelenítés ───────────────────────────────────────────────────────────

  function render() {
    if (!container) return;

    if (!keszAll()) {
      container.innerHTML = `
        <div class="cv-wrap"><div class="cv-notready">
          Előbb válaszd ki az adatmappát a <strong>Nyilvántartás</strong> fülön.
        </div></div>`;
      return;
    }

    const lista = szurtLista();
    const felvetes = javaslatokHtml();

    container.innerHTML = `
      <div class="cv-wrap">
        <aside class="cv-side">
          <div class="cv-toolbar">
            <input type="search" id="cv-search" class="field-input" placeholder="Keresés: név, EH szám, iktatószám"
                   value="${escHtml(state.kereses)}">
            <div class="cv-filters">
              ${SZUROK.map(f => `
                <button class="cv-filter ${state.szuro === f.key ? 'is-active' : ''}"
                        data-filter="${f.key}">${f.label}</button>`).join('')}
            </div>
          </div>
          ${felvetes}
          <div class="cv-list">
            ${lista.length ? lista.map(sorHtml).join('')
                           : '<div class="cv-empty">Nincs a szűrésnek megfelelő ügy.</div>'}
          </div>
          <div class="cv-foot">
            <button class="btn btn-primary btn-sm" id="cv-new">Új ügy</button>
            <span class="cv-count">${lista.length} ügy</span>
          </div>
        </aside>

        <section class="cv-detail" id="cv-detail">
          ${reszletHtml()}
        </section>
      </div>`;

    bind();
  }

  function reszletHtml() {
    if (!state.kivalasztott) {
      return '<div class="ct-empty">Válassz ki egy ügyet a listából.</div>';
    }
    const c = CaseRepo.get(state.kivalasztott);
    if (!c) return '<div class="ct-empty">Az ügy már nem létezik.</div>';

    return `
      <div class="cv-detail__person">${escHtml(dolgozoNeve(c.employeeId))}</div>
      ${CaseTimeline.render(c, dolgozoMezoi(c.employeeId))}
      <div class="cv-actions">
        <button class="btn btn-ghost btn-sm" id="cv-edit">Adatok szerkesztése</button>
        ${c.closedAt ? '' : '<button class="btn btn-primary btn-sm" id="cv-advance">Státusz rögzítése</button>'}
      </div>`;
  }

  /**
   * Közelgő lejáratok, amikre még nincs nyitott meghosszabbítási ügy.
   * Csak felvet – nem hoz létre semmit magától.
   */
  function javaslatokHtml() {
    let javaslatok = [];
    try { javaslatok = CaseRepo.suggestRenewals(EmployeeRepo.all(), { belul: 90 }); }
    catch { return ''; }
    if (!javaslatok.length) return '';

    return `
      <div class="cv-suggest">
        <div class="cv-suggest__title">Közelgő lejárat, nyitott ügy nélkül</div>
        ${javaslatok.slice(0, 5).map(j => `
          <button class="cv-suggest__item" data-new-for="${escHtml(j.employee.id)}">
            <span>${escHtml(dolgozoNeve(j.employee.id))}</span>
            <span class="cv-suggest__days">${j.daysLeft < 0 ? `${-j.daysLeft} napja lejárt` : `${j.daysLeft} nap`}</span>
          </button>`).join('')}
        ${javaslatok.length > 5 ? `<div class="cv-suggest__more">… és további ${javaslatok.length - 5}</div>` : ''}
      </div>`;
  }

  // ── Események ──────────────────────────────────────────────────────────────

  function bind() {
    const q = s => container.querySelector(s);

    const kereso = q('#cv-search');
    if (kereso) {
      kereso.addEventListener('input', () => {
        state.kereses = kereso.value;
        render();
        const uj = container.querySelector('#cv-search');
        if (uj) { uj.focus(); uj.setSelectionRange(uj.value.length, uj.value.length); }
      });
    }

    container.querySelectorAll('.cv-filter').forEach(b => {
      b.addEventListener('click', () => { state.szuro = b.dataset.filter; render(); });
    });

    container.querySelectorAll('.cv-row').forEach(b => {
      b.addEventListener('click', () => { state.kivalasztott = b.dataset.id; render(); });
    });

    container.querySelectorAll('[data-new-for]').forEach(b => {
      b.addEventListener('click', () => CaseForm.open({
        employeeId: b.dataset.newFor, type: 'rp_hosszabbitas',
        onSaved: id => { state.kivalasztott = id; render(); },
      }));
    });

    const uj = q('#cv-new');
    if (uj) uj.addEventListener('click', () => CaseForm.open({
      onSaved: id => { state.kivalasztott = id; render(); },
    }));

    const szerk = q('#cv-edit');
    if (szerk) szerk.addEventListener('click', () => CaseForm.open({
      caseId: state.kivalasztott, onSaved: () => render(),
    }));

    const lep = q('#cv-advance');
    if (lep) lep.addEventListener('click', () => CaseForm.openStatus({
      caseId: state.kivalasztott, onSaved: () => render(),
    }));

    // Idővonal-bejegyzés javítása (elgépelt dátum, megjegyzés)
    container.querySelectorAll('.ct-edit').forEach(b => {
      b.addEventListener('click', () => CaseForm.openEvent({
        caseId: state.kivalasztott,
        index: Number(b.dataset.eventIndex),
        onSaved: () => render(),
      }));
    });
  }

  return { init, _render: render, _badge: frissitJelzo };
})();
