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
    lap:        'idovonal',     // idovonal | eh  – ügyváltáskor NEM áll vissza:
                                // aki EH-t tölt, sorra veszi a dolgozókat
    // Az ügylista elrejthető. Egy kérelem előkészítése közben ritkán kell, a
    // helye viszont dokkolt (fél képernyős) ablakban a legdrágább.
    savZarva:   Settings.get('cases_side_collapsed', false),
    // A közelgő lejáratok rendezése. A nap szerinti a kiindulás (az ég sürgősebb),
    // de névsorban keresni is kell tudni, ha valakit név szerint keresünk.
    javaslatRend: Settings.get('cases_suggest_sort', 'nap'),
    // Ügylista vagy átutalások. A fül SZINTJÉN váltunk, mert egy átutalási
    // köteg sok ügyet fog át – egy kiválasztott ügy alá zárva folyton ki
    // kellene lépni belőle.
    nezet: Settings.get('cases_view', 'ugyek'),
  };

  const RENDEZESEK = [
    { key: 'nap',     label: 'nap szerint' },
    { key: 'nev-fel', label: 'A → Z' },
    { key: 'nev-le',  label: 'Z → A' },
  ];

  const SZUROK = [
    { key: 'nyitott', label: 'Nyitott' },
    { key: 'lejart',  label: 'Lejárt' },
    { key: 'surgos',  label: 'Sürgős' },
    { key: 'lezart',  label: 'Lezárt' },
    { key: 'mind',    label: 'Mind' },
  ];

  function init(el) {
    container = el;
    CasesDashboard.init({ dolgozoNeve });
    render();
    frissitJelzo();
    window.addEventListener('docgenTabActivated', e => {
      if (e.detail === 'cases') render();
    });
    // Alt+L: a lista be/ki. Az Alt+1..4 a füleké (app.js), az „L" szabad.
    document.addEventListener('keydown', e => {
      if (!e.altKey || e.key.toLowerCase() !== 'l') return;
      if (!container.classList.contains('active')) return;
      e.preventDefault();
      savValt();
    });

    // Esc: vissza az áttekintőhöz. Csak akkor, ha nincs nyitott párbeszéd és
    // nem egy mezőben gépel valaki – ott az Esc mást jelent.
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !state.kivalasztott) return;
      if (!container.classList.contains('active')) return;
      if (state.nezet !== 'ugyek') return;
      const dlg = document.getElementById('dialog-overlay');
      if (dlg && !dlg.classList.contains('hidden')) return;
      const a = document.activeElement;
      if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
      e.preventDefault();
      state.kivalasztott = null;
      render();
    });
    CaseRepo.onChange(() => { render(); frissitJelzo(); });
    TransferRepo.onChange(() => { if (state.nezet === 'atutalasok') render(); });
    // Az EH-panelen a mentés is ezt hívná, és a teljes újrarajzolás elvenné a
    // fókuszt a mezőről, ami épp aktív. Ott a sor magát frissíti.
    EmployeeRepo.onChange(() => { if (!ehPanelenDolgozunk()) render(); frissitJelzo(); });
  }

  /** Az EH-panel egyik mezőjén áll a fókusz? Akkor nem rajzolunk újra. */
  function ehPanelenDolgozunk() {
    const a = document.activeElement;
    return !!(a && a.closest && a.closest('.eh-wrap'));
  }

  /**
   * Ügylista mutatása / elrejtése.
   *
   * Dokkolt (fél képernyős) ablakban a bal sáv a hely harmada, miközben egy
   * kérelem előkészítése közben alig kell. Az állapot megjegyződik: aki
   * becsukja, annak holnap is csukva induljon.
   */
  function savValt() {
    state.savZarva = !state.savZarva;
    Settings.set('cases_side_collapsed', state.savZarva);
    render();
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

  /** Kis szám az Átutalások gombon: hány tétel vár az előkészítés alatti kötegben. */
  function atutalasJelzo() {
    try {
      const nyitott = TransferRepo.all().filter(TransferRepo.isOpen);
      const db = nyitott.reduce((n, b) => n + b.rows.length, 0);
      return db ? ` <span class="cv-viewbtn__badge">${db}</span>` : '';
    } catch { return ''; }
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

  function kivalasztottNeve() {
    const c = CaseRepo.get(state.kivalasztott);
    return c ? dolgozoNeve(c.employeeId) : '';
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

    container.innerHTML = `
      <div class="cv-viewbar">
        <button class="cv-viewbtn ${state.nezet === 'ugyek' ? 'is-active' : ''}"
                data-nezet="ugyek" type="button">Ügylista</button>
        <button class="cv-viewbtn ${state.nezet === 'atutalasok' ? 'is-active' : ''}"
                data-nezet="atutalasok" type="button">Átutalások${atutalasJelzo()}</button>
      </div>
      <div class="cv-view" id="cv-view"></div>`;

    container.querySelectorAll('.cv-viewbtn').forEach(gomb => {
      gomb.addEventListener('click', () => {
        state.nezet = gomb.dataset.nezet;
        Settings.set('cases_view', state.nezet);
        render();
      });
    });

    const nezetEl = container.querySelector('#cv-view');
    if (state.nezet === 'atutalasok') { TransfersView.render(nezetEl); return; }

    const lista = szurtLista();
    const felvetes = javaslatokHtml();
    const zart = state.savZarva;

    nezetEl.innerHTML = `
      <div class="cv-wrap${zart ? ' is-collapsed' : ''}">
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
          <div class="cv-bar">
            <button class="cv-sidetoggle" id="cv-sidetoggle" type="button"
                    title="${zart ? 'Ügylista mutatása' : 'Ügylista elrejtése'} (Alt+L)"
                    aria-expanded="${zart ? 'false' : 'true'}">${zart ? '›' : '‹'}</button>
            ${zart ? `<span class="cv-bar__lista">${lista.length} ügy</span>` : ''}
            ${state.kivalasztott ? `<button class="cv-back" id="cv-back" type="button"
                    title="Vissza az áttekintőhöz (Esc)">⌂ Áttekintés</button>` : ''}
            <span class="cv-bar__person">${state.kivalasztott ? escHtml(kivalasztottNeve()) : ''}</span>
          </div>
          ${reszletHtml()}
        </section>
      </div>`;

    bind();
  }

  function reszletHtml() {
    // Nincs kiválasztott ügy → áttekintő. Ez a panel korábban üresen állt, és
    // épp a leghasznosabb pillanatban nem mondott semmit: megnyitáskor.
    if (!state.kivalasztott) return CasesDashboard.render();
    const c = CaseRepo.get(state.kivalasztott);
    if (!c) return '<div class="ct-empty">Az ügy már nem létezik.</div>';

    const emp = EmployeeRepo.get(c.employeeId);
    const fulek = `
      <div class="cv-tabs">
        <button class="cv-tab ${state.lap === 'idovonal' ? 'is-active' : ''}" data-lap="idovonal">Idővonal</button>
        <button class="cv-tab ${state.lap === 'eh' ? 'is-active' : ''}" data-lap="eh">Enter Hungary</button>
      </div>`;

    // Az EH-panel a teljes magasságot kapja: kitöltés közben az idővonal
    // alatt sosem látszana a lényeg, és pont ez a munkamenet a cél.
    if (state.lap === 'eh') {
      return `
        ${fulek}
        ${emp ? CaseEh.render(c, emp)
              : '<div class="ct-empty">A dolgozó rekordja nem található.</div>'}`;
    }

    return `
      ${fulek}
      ${CaseTimeline.render(c, dolgozoMezoi(c.employeeId))}
      <div class="cv-actions">
        <button class="btn btn-ghost btn-sm" id="cv-edit">Adatok szerkesztése</button>
        ${c.closedAt ? '' : '<button class="btn btn-primary btn-sm" id="cv-advance">Státusz rögzítése</button>'}
        <button class="btn btn-secondary btn-sm" id="cv-fee">Díj a kötegbe</button>
        <button class="btn btn-ghost btn-sm cv-del" id="cv-delete">Ügy törlése</button>
      </div>`;
  }

  /** A dolgozó nyitott meghosszabbítási ügye, ha van. */
  function nyitottHosszabbitas(employeeId) {
    try {
      return CaseRepo.forEmployee(employeeId)
        .find(c => !c.closedAt && c.type === 'rp_hosszabbitas') || null;
    } catch { return null; }
  }

  /**
   * A bal sáv dolgozó-listája — MINDENKI, nem csak a 90 napon belül lejárók.
   *
   * Korábban csak a közelgő lejáratok látszottak. Aki nem volt köztük, ahhoz
   * erről a fülről nem lehetett hozzáférni: sem ügyet nyitni, sem az EH-panelt
   * megnyitni rá — pedig ez a lista a fül belépője. A sürgősség így sem vész
   * el: a nap szerinti rendezés a legközelebbi lejárattal kezd, a lejárat
   * nélküliek a sor végére kerülnek.
   *
   * A napszámot a `suggestRenewals` adja (ugyanaz a dátumszámítás, mint eddig);
   * akit az kihagy — nincs lejárata, vagy már van nyitott meghosszabbítása —,
   * azt utána fűzzük hozzá. Nyitott ügyű dolgozóra kattintva az ÜGY nyílik meg,
   * nem egy új: különben egy kattintással duplán nyitnánk ugyanazt.
   */
  function javaslatokHtml() {
    let mind = [];
    try { mind = EmployeeRepo.all(); } catch { return ''; }

    let javaslatok = [];
    try { javaslatok = CaseRepo.suggestRenewals(mind, { belul: Infinity }); }
    catch { javaslatok = []; }

    // A hozzáfűzés sorrendje adja a nap szerinti rendezést: a `suggestRenewals`
    // lejárat szerint rendezve ad, a napszám nélküliek utánuk kerülnek.
    const megvan = new Set(javaslatok.map(j => j.employee.id));
    for (const emp of mind) {
      if (megvan.has(emp.id)) continue;
      javaslatok.push({ employee: emp, daysLeft: null, nyitottUgy: nyitottHosszabbitas(emp.id) });
    }

    // A keresőmező eddig csak az ügylistára hatott. Teljes névsor mellett ez
    // zavaró: aki nevet gépel, azt várja, hogy ez a lista is szűküljön.
    if (state.kereses) {
      const needle = state.kereses.toLowerCase();
      javaslatok = javaslatok.filter(j => dolgozoNeve(j.employee.id).toLowerCase().includes(needle));
    }
    if (!javaslatok.length) return '';

    // A CaseRepo nap szerint rendezve adja; a névsor a megjelenítés dolga.
    const rend = RENDEZESEK.find(r => r.key === state.javaslatRend) || RENDEZESEK[0];
    if (rend.key !== 'nap') {
      const irany = rend.key === 'nev-fel' ? 1 : -1;
      // A nevet egyszer kérjük el: a `dolgozoNeve` rekordot olvas és értéket
      // old fel, összehasonlításonként újra megtenni pazarlás.
      const nev = new Map(javaslatok.map(j => [j.employee.id, dolgozoNeve(j.employee.id)]));
      javaslatok.sort((a, b) => irany *
        nev.get(a.employee.id).localeCompare(nev.get(b.employee.id), 'hu'));
    }

    return `
      <div class="cv-suggest">
        <div class="cv-suggest__title">
          <span>Dolgozók (${javaslatok.length})</span>
          <button class="cv-filter cv-suggest__sort" type="button" id="cv-suggest-sort"
                  title="Rendezés váltása: nap szerint → A → Z → Z → A">${escHtml(rend.label)}</button>
        </div>
        <div class="cv-suggest__list">
          ${javaslatok.map(j => `
            <button class="cv-suggest__item" ${j.nyitottUgy
                ? `data-open-case="${escHtml(j.nyitottUgy.id)}" title="Nyitott meghosszabbítási ügy — megnyitás"`
                : `data-new-for="${escHtml(j.employee.id)}" title="Új ügy nyitása"`}>
              <span class="cv-suggest__nev">${escHtml(dolgozoNeve(j.employee.id))}</span>
              <span class="cv-suggest__days">${escHtml(javaslatMeta(j))}</span>
            </button>`).join('')}
        </div>
      </div>`;
  }

  /** A soron jobbra álló szöveg: a hátralévő napok, vagy ami helyettük áll. */
  function javaslatMeta(j) {
    if (j.daysLeft == null) return j.nyitottUgy ? 'nyitott ügy' : 'nincs lejárat';
    return j.daysLeft < 0 ? `${-j.daysLeft} napja lejárt` : `${j.daysLeft} nap`;
  }

  // ── Törlés ─────────────────────────────────────────────────────────────────

  /**
   * Ügy végleges törlése.
   *
   * A dolgozót nem kell külön „visszaállítani" a lejárók közé: a bal sáv
   * listája a NYITOTT ügyekből számol élőben, ezért az ügy eltűnésével a
   * dolgozó magától visszakapja a napszámát. Ami viszont NEM áll vissza, azt
   * ki kell írni — a lezáráskor rögzített új azonosító a dolgozónál marad.
   */
  function torlesMegerosites(caseId) {
    const c = CaseRepo.get(caseId);
    if (!c) { toast('Az ügy nem található', 'error'); return; }

    const nev  = dolgozoNeve(c.employeeId);
    const db   = (c.events || []).length;
    const lejar = (dolgozoMezoi(c.employeeId) || {}).expiration_of_rp;

    showDialog({
      title: 'Ügy végleges törlése',
      body: `
        <p style="font-size:13px;margin-bottom:10px">
          Biztosan véglegesen törlöd <b>${escHtml(nev)}</b>
          „${escHtml(CaseTypes.label(c.type))}" ügyét?
        </p>
        <ul class="sv-warn-list">
          <li><b>${db}</b> idővonal-bejegyzés elvész — köztük a rögzített
              státuszváltások és a hozzájuk fűzött megjegyzések.</li>
          ${c.producedId ? `<li>A lezáráskor rögzített azonosító
              (<b>${escHtml(c.producedId.value)}</b>) <b>a dolgozónál marad</b> —
              a törlés nem vonja vissza. Ha az is hibás, a Nyilvántartás fülön
              javítsd.</li>` : ''}
          ${lejar && !c.closedAt && c.type === 'rp_hosszabbitas'
            ? `<li>${escHtml(nev)} visszakerül a lejáró engedélyesek közé
                 (${escHtml(lejar)}), és újra nyitható rá ügy.</li>` : ''}
        </ul>
        <p class="ef-hint">
          A törlés a <code>data/backup/</code> mappából állítható vissza,
          ha adatmappát használsz.
        </p>`,
      footer: `
        <button class="btn btn-ghost btn-sm" onclick="closeDialog()">Mégse</button>
        <button class="btn btn-danger btn-sm" id="cv-delete-confirm">Végleges törlés</button>`,
    });

    document.getElementById('cv-delete-confirm').addEventListener('click', async () => {
      try {
        CaseRepo.destroy(caseId);
        await CaseRepo.flush();
        closeDialog();
        BevLogger.info('UGY_TORLES', `Ügy törölve: ${nev} – ${CaseTypes.label(c.type)}`,
                       '', `esemenyek=${db}`);
        // A kijelölés a törölt ügyre mutatna: a részletező „már nem létezik"-et
        // írna ki, ami zavaróbb, mint az üres állapot.
        state.kivalasztott = null;
        toast('✓ Ügy törölve', 'success');
        render();
      } catch (e) {
        toast('A törlés nem sikerült: ' + e.message, 'error');
      }
    });
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

    // Az áttekintő számláló-csempéi ugyanazt csinálják, mint a szűrőgombok:
    // kattintásra a lista szűrődik. Enélkül a szám csak dísz lenne.
    container.querySelectorAll('.cv-filter, .dash-stat').forEach(b => {
      b.addEventListener('click', () => { state.szuro = b.dataset.filter; render(); });
    });

    const vissza = q('#cv-back');
    if (vissza) vissza.addEventListener('click', () => { state.kivalasztott = null; render(); });

    container.querySelectorAll('.cv-row').forEach(b => {
      b.addEventListener('click', () => { state.kivalasztott = b.dataset.id; render(); });
    });

    const dij = q('#cv-fee');
    if (dij) dij.addEventListener('click', () => {
      const c = CaseRepo.get(state.kivalasztott);
      if (c && TransfersView.addFromCase(c)) render();
    });

    const rendGomb = q('#cv-suggest-sort');
    if (rendGomb) rendGomb.addEventListener('click', () => {
      const i = RENDEZESEK.findIndex(r => r.key === state.javaslatRend);
      state.javaslatRend = RENDEZESEK[(i + 1) % RENDEZESEK.length].key;
      Settings.set('cases_suggest_sort', state.javaslatRend);
      render();
    });

    container.querySelectorAll('[data-open-case]').forEach(b => {
      b.addEventListener('click', () => { state.kivalasztott = b.dataset.openCase; render(); });
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

    const torol = q('#cv-delete');
    if (torol) torol.addEventListener('click', () => torlesMegerosites(state.kivalasztott));

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

    container.querySelectorAll('.cv-tab').forEach(b => {
      b.addEventListener('click', () => { state.lap = b.dataset.lap; render(); });
    });

    const savGomb = q('#cv-sidetoggle');
    if (savGomb) savGomb.addEventListener('click', savValt);

    if (state.lap === 'eh' && state.kivalasztott) {
      const c = CaseRepo.get(state.kivalasztott);
      const emp = c && EmployeeRepo.get(c.employeeId);
      if (emp) CaseEh.bind(container, c, emp, render);
    }
  }

  return { init, _render: render, _badge: frissitJelzo };
})();
