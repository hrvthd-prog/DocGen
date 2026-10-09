'use strict';

/**
 * Ügyek fül – az összes dolgozó összes ügye egy helyen.
 *
 * ── Miért NÉGY NÉZET, és miért nincs oldalsáv? ────────────────────────────
 * Korábban egy kétoszlopos master–detail volt: bal oldalt egy 380 px-es
 * (dokkolt ablakban 300 px-es) sávban kereső + sürgősségi szűrők + állapot-
 * szűrők + a teljes dolgozólista + az ügylista, jobb oldalt a részletező.
 * Négy dolog osztozott egy hasábon, és mindegyik rosszul járt:
 *
 * - Az ügysor hat adatot hordoz (név, típus, állapot, EH szám, iktatószám,
 *   határidő). Egy 300 px-es hasábban ez két-három tördelt sor, és nem lehet
 *   végigfutni rajta — pont azt nem, hogy KINÉL hiányzik az iktatószám,
 *   mert a hiányok nem kerülnek egymás alá.
 * - Az áttekintő nem nézet volt, hanem a részletező ÜRES ÁLLAPOTA: az első
 *   megnyitott üggyel eltűnt, és csak Esc-cel jött vissza. A legfontosabb
 *   képernyő volt a legnehezebben elérhető.
 * - A részletező (főleg az EH-panel) a maradék helyen szorongott; ezt
 *   foltozta az Alt+L-es összecsukás és a 600 px-es töréspont.
 *
 * Ezért: EGY nézet látszik egyszerre, teljes szélességben, és a váltás
 * lapozás. Az ügylista táblázat lett (a hiányzó azonosító így oszlopba
 * kerül és szűrhető), az áttekintő önálló nézet, a dolgozólista is.
 * Ami a sávval elveszett — hogy a lista a részletező mellett is látszik —,
 * azt a részletező fejlécében a ‹ › lépkedés pótolja.
 */
const CasesModule = (() => {

  let container = null;

  /** A fül nézetei. A sorrend a belépés sorrendje: a nap az áttekintővel kezd. */
  const NEZETEK = [
    { key: 'attekintes', label: 'Áttekintés' },
    { key: 'ugyek',      label: 'Ügyek' },
    { key: 'dolgozok',   label: 'Dolgozók' },
    { key: 'atutalasok', label: 'Átutalások' },
  ];

  const SZUROK = [
    { key: 'nyitott', label: 'Nyitott' },
    { key: 'lejart',  label: 'Lejárt' },
    { key: 'surgos',  label: 'Sürgős' },
    // Saját szűrő, mert ez a kérdés önállóan is felmerül: mely beadott ügyhöz
    // nem jött még meg a hatósági azonosító. Eddig csak az áttekintőn látszott.
    { key: 'hiany',   label: 'Azonosító nélkül' },
    { key: 'lezart',  label: 'Lezárt' },
    { key: 'mind',    label: 'Mind' },
  ];

  const state = {
    nezet:   Settings.get('cases_view', 'attekintes'),
    szuro:   'nyitott',
    kereses: '',
    // Ha van kiválasztott ügy, a részletező a NÉZET FÖLÉ kerül (bármelyikről
    // nyitható), és a „Vissza" egyszerűen leveszi. Nem kell külön megjegyezni,
    // honnan jöttünk: a nézet maga az, ahol állunk.
    kivalasztott: null,
    lap:     'idovonal',   // idovonal | eh – ügyváltáskor NEM áll vissza:
                           // aki EH-t tölt, sorra veszi a dolgozókat
    rend:    Settings.get('cases_sort', 'hatarido'),   // hatarido | nev | allapot
    irany:   Settings.get('cases_sort_dir', 1),
    dRend:   Settings.get('cases_emp_sort', 'nap'),    // nap | nev
    dIrany:  Settings.get('cases_emp_sort_dir', 1),
  };

  function init(el) {
    container = el;
    CasesDashboard.init({ dolgozoNeve });
    render();
    frissitJelzo();
    window.addEventListener('docgenTabActivated', e => {
      if (e.detail === 'cases') render();
    });

    // Esc: vissza a listához. Csak akkor, ha nincs nyitott párbeszéd és nem
    // egy mezőben gépel valaki – ott az Esc mást jelent.
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !state.kivalasztott) return;
      if (!container.classList.contains('active')) return;
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

  /** Írhat-e a felhasználó? A próbalapon nincs Auth – ott mindent szabad. */
  function irhat() {
    return typeof Auth === 'undefined' || Auth.can('cases.write');
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

  /** Hány tétel vár az előkészítés alatti átutalási kötegben? */
  function atutalasDb() {
    try {
      return TransferRepo.all().filter(TransferRepo.isOpen)
        .reduce((n, b) => n + b.rows.length, 0);
    } catch { return 0; }
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

  // ── Szűrés és rendezés ─────────────────────────────────────────────────────

  /** Beadott ügy, amihez még nem jött meg valamelyik hatósági azonosító. */
  function azonositoHianyos(c) {
    return !c.closedAt && (c.status || 'elokeszites') !== 'elokeszites' &&
           (!c.fileNumber || !c.ehNumber);
  }

  function szurtLista() {
    let lista = state.kereses ? CaseRepo.search(state.kereses) : CaseRepo.all();

    // Név szerinti kereséshez a dolgozó nevét is nézzük: a CaseRepo.search
    // csak az ügy saját mezőiben keres.
    if (state.kereses) {
      const talalt = new Set(lista.map(c => c.id));
      const needle = state.kereses.toLowerCase();
      for (const c of CaseRepo.all()) {
        if (talalt.has(c.id)) continue;
        if (dolgozoNeve(c.employeeId).toLowerCase().includes(needle)) lista.push(c);
      }
    }

    // A `st:<kulcs>` alakú szűrő az áttekintő állapot-csempéiről jön: nyitott
    // ügyek egyetlen szakaszban. Ugyanaz az egy szűrő-állapot vezérli, mint a
    // sürgősségi gombokat — két párhuzamos szűrődimenzió csak zavarna.
    if (state.szuro.startsWith('st:')) {
      const kulcs = state.szuro.slice(3);
      lista = lista.filter(c => CaseRepo.urgency(c) !== 'lezart' &&
                                (c.status || 'elokeszites') === kulcs);
    } else if (state.szuro === 'hiany') {
      lista = lista.filter(azonositoHianyos);
    } else if (state.szuro !== 'mind') {
      lista = lista.filter(c => {
        const s = CaseRepo.urgency(c);
        if (state.szuro === 'nyitott') return s !== 'lezart';
        return s === state.szuro;
      });
    }

    return rendez(lista);
  }

  /**
   * Rendezés. Az alapértelmezés a sürgősség: lejárt, sürgős, nyitott, lezárt,
   * azon belül határidő szerint — ez a „mi ég" sorrend, és ez a `hatarido`
   * oszlop növekvő iránya. A név és az állapot az oszlopfejlécről kapcsolható.
   */
  function rendez(lista) {
    const rang = { lejart: 0, surgos: 1, nyitott: 2, lezart: 3 };
    const ALLAPOTOK = ['elokeszites', 'beadva', 'hianypotlas', 'elbiralas'];
    const allapotRang = c => {
      const i = ALLAPOTOK.indexOf(c.status || 'elokeszites');
      return i === -1 ? ALLAPOTOK.length : i;
    };
    // A nevet egyszer kérjük el: a `dolgozoNeve` rekordot olvas és értéket old
    // fel, összehasonlításonként újra megtenni pazarlás.
    const nev = new Map(lista.map(c => [c.id, dolgozoNeve(c.employeeId)]));

    const alap = (a, b) => {
      const ra = rang[CaseRepo.urgency(a)], rb = rang[CaseRepo.urgency(b)];
      if (ra !== rb) return ra - rb;
      return String(a.dueAt || '9999').localeCompare(String(b.dueAt || '9999'));
    };

    const osszehasonlit =
        state.rend === 'nev'     ? (a, b) => nev.get(a.id).localeCompare(nev.get(b.id), 'hu')
      : state.rend === 'allapot' ? (a, b) => allapotRang(a) - allapotRang(b) || alap(a, b)
      :                            alap;

    return lista.slice().sort((a, b) => state.irany * osszehasonlit(a, b));
  }

  // ── Nézetváltó sáv ─────────────────────────────────────────────────────────

  function navHtml() {
    let ugyDb = 0, dolgozoDb = 0;
    try { ugyDb = CaseRepo.summary().nyitott; } catch { /* marad 0 */ }
    try { dolgozoDb = EmployeeRepo.all().length; } catch { /* marad 0 */ }
    const atDb = atutalasDb();
    const szam = { ugyek: ugyDb, dolgozok: dolgozoDb };

    return `
      <div class="cv-viewbar">
        ${NEZETEK.map(n => `
          <button class="cv-viewbtn ${state.nezet === n.key ? 'is-active' : ''}"
                  data-nezet="${n.key}" type="button">${n.label}${
            n.key === 'atutalasok' && atDb ? `<span class="cv-viewbtn__badge">${atDb}</span>` : ''}${
            szam[n.key] ? `<span class="cv-viewbtn__db">${szam[n.key]}</span>` : ''}</button>`).join('')}
        <button class="cv-export" id="cv-export" type="button"
                title="Ügyszámok, iktatószámok és a dolgozói adatok mentése xlsx-be">Mentés xlsx-be</button>
      </div>`;
  }

  // ── Ügylista (táblázat) ────────────────────────────────────────────────────

  /**
   * Állapot-szűrők: csak azok a szakaszok, amikben tényleg van nyitott ügy.
   * A bontás a dashboardból jön, hogy a csempe és a chip ugyanazt számolja.
   */
  function allapotSzurokHtml() {
    let bontas = [];
    try { bontas = CasesDashboard.allapotBontas(); } catch { return ''; }
    if (bontas.length < 2) return '';
    return bontas.map(a => `
      <button class="cv-filter cv-filter--allapot ${state.szuro === 'st:' + a.key ? 'is-active' : ''}"
              data-filter="st:${escHtml(a.key)}"
              title="${escHtml(a.label)} — ${a.db} nyitott ügy">${escHtml(a.label)} ${a.db}</button>`).join('');
  }

  function fejlecHtml(oszlop, cimke, extra = '') {
    const aktiv = state.rend === oszlop;
    return `
      <th class="cv-th cv-th--sort ${aktiv ? 'is-sorted' : ''} ${extra}" data-sort="${oszlop}"
          title="Rendezés: ${escHtml(cimke)}">${escHtml(cimke)}<span
          class="cv-th__arrow">${aktiv ? (state.irany > 0 ? '▲' : '▼') : ''}</span></th>`;
  }

  /**
   * Az azonosító-cella: mindkét szám egymás alá.
   *
   * Nem két oszlop, mert dokkolt ablakban nem férne el — és így is teljesül,
   * ami a lényeg: a hiányok egy hasábban, egymás alatt futnak, tehát végig
   * lehet pásztázni rajtuk. Előkészítés alatt (és lezárt ügynél) a hiány nem
   * hiány: ott az azonosító még nem is létezhetne, úgyhogy nem jelzünk.
   */
  function azonositoCella(c) {
    const beadva = !c.closedAt && (c.status || 'elokeszites') !== 'elokeszites';
    const sor = (cimke, ertek) => {
      if (!ertek) return beadva ? `<span class="cv-id is-missing">${cimke} hiányzik</span>` : '';
      return `<span class="cv-id">${onCimkezett(cimke, ertek) ? '' : cimke + ' '
        }<b>${escHtml(ertek)}</b></span>`;
    };
    return sor('EH', c.ehNumber) + sor('ikt.', c.fileNumber) ||
           '<span class="cv-id is-none">—</span>';
  }

  /**
   * Az EH szám maga is „EH"-val kezdődik, a címke elé írása tehát
   * „EH EH16262640"-et adna. Ilyenkor az érték magát jelöli.
   */
  function onCimkezett(cimke, ertek) {
    return cimke === 'EH' && /^EH/i.test(String(ertek));
  }

  function sorHtml(c) {
    const s = CaseRepo.urgency(c);
    return `
      <tr class="cv-tr cv-tr--${s} ${state.kivalasztott === c.id ? 'is-selected' : ''}"
          data-id="${escHtml(c.id)}" tabindex="0">
        <td class="cv-td--nev">
          <span class="cv-t__nev">${escHtml(dolgozoNeve(c.employeeId))}</span>
          <span class="cv-t__tip">${escHtml(CaseTypes.label(c.type))}</span>
        </td>
        <td class="cv-td--allapot">${escHtml(CaseTypes.statusLabel(c.type, c.status))}</td>
        <td class="cv-td--id">${azonositoCella(c)}</td>
        <td class="cv-td--due">${escHtml(CaseRepo.deadlineText(c))}</td>
      </tr>`;
  }

  function ugyekHtml() {
    const lista = szurtLista();
    return `
      <div class="cv-page">
        <div class="cv-toolbar">
          <input type="search" id="cv-search" class="field-input cv-search"
                 placeholder="Keresés: név, EH szám, iktatószám"
                 value="${escHtml(state.kereses)}">
          <div class="cv-filters">
            ${SZUROK.map(f => `
              <button class="cv-filter ${state.szuro === f.key ? 'is-active' : ''}"
                      data-filter="${f.key}">${f.label}</button>`).join('')}
            ${allapotSzurokHtml()}
          </div>
        </div>
        <div class="cv-table-wrap">
          ${lista.length ? `
            <table class="data-table cv-table">
              <thead><tr>
                ${fejlecHtml('nev', 'Név és ügytípus', 'cv-th--nev')}
                ${fejlecHtml('allapot', 'Állapot', 'cv-th--allapot')}
                <th class="cv-th cv-th--azon">Azonosítók</th>
                ${fejlecHtml('hatarido', 'Határidő', 'cv-th--hatarido')}
              </tr></thead>
              <tbody>${lista.map(sorHtml).join('')}</tbody>
            </table>`
          : '<div class="cv-empty">Nincs a szűrésnek megfelelő ügy.</div>'}
        </div>
        <div class="cv-foot">
          ${irhat() ? '<button class="btn btn-primary btn-sm" id="cv-new">Új ügy</button>' : ''}
          <span class="cv-count">${lista.length} ügy</span>
        </div>
      </div>`;
  }

  // ── Dolgozók ───────────────────────────────────────────────────────────────

  /** A dolgozó nyitott meghosszabbítási ügye, ha van. */
  function nyitottHosszabbitas(employeeId) {
    try {
      return CaseRepo.forEmployee(employeeId)
        .find(c => !c.closedAt && c.type === 'rp_hosszabbitas') || null;
    } catch { return null; }
  }

  /**
   * MINDEN dolgozó, nem csak a 90 napon belül lejárók — ez a nézet a belépő
   * ahhoz, hogy valakire egyáltalán ügyet lehessen nyitni. A napszámot a
   * `suggestRenewals` adja (ugyanaz a dátumszámítás, mint az áttekintőn);
   * akit az kihagy — nincs lejárata, vagy már van nyitott meghosszabbítása —,
   * azt utána fűzzük hozzá. Nyitott ügyű dolgozóra kattintva az ÜGY nyílik
   * meg, nem egy új: különben egy kattintással duplán nyitnánk ugyanazt.
   */
  function dolgozoLista() {
    let mind = [];
    try { mind = EmployeeRepo.all(); } catch { return []; }

    let sorok = [];
    try { sorok = CaseRepo.suggestRenewals(mind, { belul: Infinity }); }
    catch { sorok = []; }

    // A hozzáfűzés sorrendje adja a nap szerinti rendezést: a `suggestRenewals`
    // lejárat szerint rendezve ad, a napszám nélküliek utánuk kerülnek.
    const megvan = new Set(sorok.map(j => j.employee.id));
    for (const emp of mind) {
      if (megvan.has(emp.id)) continue;
      sorok.push({ employee: emp, expiresAt: null, daysLeft: null });
    }
    for (const j of sorok) j.nyitottUgy = nyitottHosszabbitas(j.employee.id);

    if (state.kereses) {
      const needle = state.kereses.toLowerCase();
      sorok = sorok.filter(j => dolgozoNeve(j.employee.id).toLowerCase().includes(needle));
    }

    if (state.dRend === 'nev') {
      const nev = new Map(sorok.map(j => [j.employee.id, dolgozoNeve(j.employee.id)]));
      sorok.sort((a, b) => nev.get(a.employee.id).localeCompare(nev.get(b.employee.id), 'hu'));
    }
    return state.dIrany > 0 ? sorok : sorok.reverse();
  }

  function napSzoveg(n) {
    if (n == null)  return 'nincs lejárat';
    if (n < 0)      return `${-n} napja lejárt`;
    if (n === 0)    return 'ma jár le';
    return `${n} nap`;
  }

  function ugyAllapot(c) {
    try {
      return CaseTypes.statusLabel(c.type, c.status || CaseTypes.firstStatus(c.type));
    } catch { return 'nyitott ügy'; }
  }

  function dFejlecHtml(oszlop, cimke) {
    const aktiv = state.dRend === oszlop;
    return `
      <th class="cv-th cv-th--sort ${aktiv ? 'is-sorted' : ''}" data-dsort="${oszlop}"
          title="Rendezés: ${escHtml(cimke)}">${escHtml(cimke)}<span
          class="cv-th__arrow">${aktiv ? (state.dIrany > 0 ? '▲' : '▼') : ''}</span></th>`;
  }

  function dolgozoSorHtml(j) {
    const lejart = j.daysLeft != null && j.daysLeft < 0;
    return `
      <tr class="cv-tr ${lejart ? 'cv-tr--lejart' : ''}" tabindex="0"
          ${j.nyitottUgy ? `data-open-case="${escHtml(j.nyitottUgy.id)}" title="Nyitott meghosszabbítási ügy — megnyitás"`
                         : `data-new-for="${escHtml(j.employee.id)}" title="Új ügy nyitása"`}>
        <td class="cv-td--nev"><span class="cv-t__nev">${escHtml(dolgozoNeve(j.employee.id))}</span></td>
        <td class="cv-td--date">${escHtml(j.expiresAt || '—')}</td>
        <td class="cv-td--due ${lejart ? 'is-late' : ''}">${escHtml(napSzoveg(j.daysLeft))}</td>
        <td>${j.nyitottUgy ? escHtml(ugyAllapot(j.nyitottUgy))
                           : '<span class="cv-id is-none">nincs nyitott ügy</span>'}</td>
        <td class="cv-td--go">${j.nyitottUgy ? 'Megnyitás' : (irhat() ? 'Ügy nyitása' : '')}</td>
      </tr>`;
  }

  function dolgozokHtml() {
    const sorok = dolgozoLista();
    return `
      <div class="cv-page">
        <div class="cv-toolbar">
          <input type="search" id="cv-search" class="field-input cv-search"
                 placeholder="Keresés név szerint" value="${escHtml(state.kereses)}">
        </div>
        <div class="cv-table-wrap">
          ${sorok.length ? `
            <table class="data-table cv-table cv-table--emp">
              <thead><tr>
                ${dFejlecHtml('nev', 'Név')}
                <th class="cv-th">Engedély lejárata</th>
                ${dFejlecHtml('nap', 'Hátralévő idő')}
                <th class="cv-th">Meghosszabbítás</th>
                <th class="cv-th cv-th--go"></th>
              </tr></thead>
              <tbody>${sorok.map(dolgozoSorHtml).join('')}</tbody>
            </table>`
          : '<div class="cv-empty">Nincs a keresésnek megfelelő dolgozó.</div>'}
        </div>
        <div class="cv-foot">
          ${irhat() ? '<button class="btn btn-primary btn-sm" id="cv-new">Új ügy</button>' : ''}
          <span class="cv-count">${sorok.length} dolgozó</span>
        </div>
      </div>`;
  }

  // ── Részletező ─────────────────────────────────────────────────────────────

  /**
   * A fejléc ‹ › lépkedése. Csak az Ügyek nézetben van értelme: ott a
   * „következő ügy" a szűrt lista következő sora. Az áttekintőről nyitott
   * ügynek nincs ilyen szomszédja — ott a Vissza az egyetlen kiút.
   */
  function lepkedesHtml() {
    if (state.nezet !== 'ugyek') return '';
    const lista = szurtLista();
    const i = lista.findIndex(c => c.id === state.kivalasztott);
    if (i === -1) return '';
    return `
      <div class="cv-step">
        <button class="cv-stepbtn" id="cv-prev" type="button" ${i === 0 ? 'disabled' : ''}
                title="Előző ügy a listában">‹</button>
        <span class="cv-step__num">${i + 1} / ${lista.length}</span>
        <button class="cv-stepbtn" id="cv-next" type="button"
                ${i === lista.length - 1 ? 'disabled' : ''}
                title="Következő ügy a listában">›</button>
      </div>`;
  }

  function reszletHtml() {
    const c = CaseRepo.get(state.kivalasztott);
    if (!c) return `
      <div class="cv-page">
        <div class="cv-dhead">
          <button class="cv-backbtn" id="cv-back" type="button">‹ Vissza</button>
        </div>
        <div class="ct-empty">Az ügy már nem létezik.</div>
      </div>`;

    const emp = EmployeeRepo.get(c.employeeId);

    // A fejléc alcíme összefogja, amit eddig a sor és az idővonal külön mondott:
    // típus, állapot, a két azonosító és a határidő. Ez az a négy-öt adat, ami
    // miatt eddig vissza kellett lépni a listára.
    const alcim = [
      CaseTypes.label(c.type),
      CaseTypes.statusLabel(c.type, c.status),
      c.ehNumber   ? (onCimkezett('EH', c.ehNumber) ? c.ehNumber : `EH ${c.ehNumber}`) : '',
      c.fileNumber ? `ikt. ${c.fileNumber}` : '',
      CaseRepo.deadlineText(c),
    ].filter(Boolean).join(' · ');

    const torzs = state.lap === 'eh'
      ? (emp ? CaseEh.render(c, emp)
             : '<div class="ct-empty">A dolgozó rekordja nem található.</div>')
      : CaseTimeline.render(c, dolgozoMezoi(c.employeeId));

    // Az EH-panel a teljes magasságot kapja: kitöltés közben az idővonal alatt
    // sosem látszana a lényeg, és pont ez a munkamenet a cél. Ezért a műveleti
    // sor csak az idővonal mellett jelenik meg.
    const muveletek = (state.lap === 'eh' || !irhat()) ? '' : `
      <div class="cv-actions">
        <button class="btn btn-ghost btn-sm" id="cv-edit">Adatok szerkesztése</button>
        ${c.closedAt ? '' : '<button class="btn btn-primary btn-sm" id="cv-advance">Státusz rögzítése</button>'}
        <button class="btn btn-secondary btn-sm" id="cv-fee">Díj a kötegbe</button>
        <button class="btn btn-ghost btn-sm cv-del" id="cv-delete">Ügy törlése</button>
      </div>`;

    return `
      <div class="cv-page cv-page--detail">
        <div class="cv-dhead">
          <button class="cv-backbtn" id="cv-back" type="button"
                  title="Vissza a listához (Esc)">‹ Vissza</button>
          <div class="cv-dhead__who">
            <span class="cv-dhead__nev">${escHtml(dolgozoNeve(c.employeeId))}</span>
            <span class="cv-dhead__sub">${escHtml(alcim)}</span>
          </div>
          ${lepkedesHtml()}
        </div>
        <div class="cv-tabs">
          <button class="cv-tab ${state.lap === 'idovonal' ? 'is-active' : ''}" data-lap="idovonal">Idővonal</button>
          <button class="cv-tab ${state.lap === 'eh' ? 'is-active' : ''}" data-lap="eh">Enter Hungary</button>
        </div>
        <div class="cv-dbody">${torzs}</div>
        ${muveletek}
      </div>`;
  }

  // ── Kimutatás ──────────────────────────────────────────────────────────────

  /**
   * Ügy- és dolgozói kimutatás xlsx-be. A gomb a kiírás idejére letilt: a
   * munkafüzet felépítése pár száz ügynél is érezhető, és a dupla kattintás
   * két letöltést indítana.
   */
  async function exportXlsx(gomb) {
    const eredeti = gomb.textContent;
    gomb.disabled = true;
    gomb.textContent = 'Mentés…';
    try {
      const { buffer, ugyekSzama, dolgozokSzama } = await CaseXlsx.toBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      if (typeof saveAs === 'function') saveAs(blob, CaseXlsx.suggestFilename());
      else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = CaseXlsx.suggestFilename();
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      }
      toast(`${ugyekSzama} ügy és ${dolgozokSzama} dolgozó mentve`, 'success');
    } catch (e) {
      BevLogger.error('CASE_XLSX', 'Ügykimutatás mentése sikertelen', e.message, '');
      toast('A mentés nem sikerült: ' + e.message, 'error');
    } finally {
      gomb.disabled = false;
      gomb.textContent = eredeti;
    }
  }

  // ── Törlés ─────────────────────────────────────────────────────────────────

  /**
   * Ügy végleges törlése.
   *
   * A dolgozót nem kell külön „visszaállítani" a lejárók közé: a Dolgozók
   * nézet a NYITOTT ügyekből számol élőben, ezért az ügy eltűnésével a
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
        // írna ki, ami zavaróbb, mint maga a lista.
        state.kivalasztott = null;
        toast('✓ Ügy törölve', 'success');
        render();
      } catch (e) {
        toast('A törlés nem sikerült: ' + e.message, 'error');
      }
    });
  }

  // ── Megjelenítés ───────────────────────────────────────────────────────────

  function valt(nezet) {
    state.nezet = nezet;
    state.kivalasztott = null;
    Settings.set('cases_view', nezet);
    render();
  }

  /** Ügy megnyitása — a nézet marad, a részletező kerül fölé. */
  function megnyit(id) {
    state.kivalasztott = id;
    render();
  }

  function render() {
    if (!container) return;

    if (!keszAll()) {
      container.innerHTML = `
        <div class="cv-notready">
          Előbb válaszd ki az adatmappát a <strong>Nyilvántartás</strong> fülön.
        </div>`;
      return;
    }

    container.innerHTML = `${navHtml()}<div class="cv-view" id="cv-view"></div>`;

    container.querySelectorAll('.cv-viewbtn').forEach(gomb => {
      gomb.addEventListener('click', () => valt(gomb.dataset.nezet));
    });
    const exportGomb = container.querySelector('#cv-export');
    if (exportGomb) exportGomb.addEventListener('click', () => exportXlsx(exportGomb));

    const el = container.querySelector('#cv-view');

    // Az Átutalások saját modul, és saját gyökeret kap – ott nincs mit kötni.
    if (!state.kivalasztott && state.nezet === 'atutalasok') {
      TransfersView.render(el);
      return;
    }

    if (state.kivalasztott)                el.innerHTML = reszletHtml();
    else if (state.nezet === 'attekintes') el.innerHTML =
      `<div class="cv-page cv-page--scroll">${CasesDashboard.render()}</div>`;
    else if (state.nezet === 'dolgozok')   el.innerHTML = dolgozokHtml();
    else                                   el.innerHTML = ugyekHtml();

    bind();
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

    // Az áttekintő számláló-csempéi ugyanazt csinálják, mint a szűrőgombok —
    // de át is visznek az Ügyek nézetre: enélkül egy olyan listát szűrnének,
    // ami épp nem látszik.
    container.querySelectorAll('.cv-filter, .dash-stat').forEach(b => {
      b.addEventListener('click', () => {
        state.szuro = b.dataset.filter;
        if (state.nezet === 'ugyek') { state.kivalasztott = null; render(); }
        else valt('ugyek');
      });
    });

    container.querySelectorAll('[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        if (state.rend === th.dataset.sort) state.irany = -state.irany;
        else { state.rend = th.dataset.sort; state.irany = 1; }
        Settings.set('cases_sort', state.rend);
        Settings.set('cases_sort_dir', state.irany);
        render();
      });
    });
    container.querySelectorAll('[data-dsort]').forEach(th => {
      th.addEventListener('click', () => {
        if (state.dRend === th.dataset.dsort) state.dIrany = -state.dIrany;
        else { state.dRend = th.dataset.dsort; state.dIrany = 1; }
        Settings.set('cases_emp_sort', state.dRend);
        Settings.set('cases_emp_sort_dir', state.dIrany);
        render();
      });
    });

    // A `<tr>` nem gomb, ezért a billentyűkezelés a miénk – enélkül a táblázat
    // csak egérrel lenne járható.
    const sorAktival = (el, fn) => {
      el.addEventListener('click', fn);
      el.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        fn();
      });
    };

    container.querySelectorAll('.cv-tr[data-id]').forEach(tr =>
      sorAktival(tr, () => megnyit(tr.dataset.id)));
    container.querySelectorAll('[data-open-case]').forEach(el =>
      sorAktival(el, () => megnyit(el.dataset.openCase)));
    container.querySelectorAll('[data-new-for]').forEach(el =>
      sorAktival(el, () => {
        if (!irhat()) return;
        CaseForm.open({
          employeeId: el.dataset.newFor, type: 'rp_hosszabbitas',
          onSaved: id => megnyit(id),
        });
      }));

    const vissza = q('#cv-back');
    if (vissza) vissza.addEventListener('click', () => { state.kivalasztott = null; render(); });

    const lep = irany => {
      const lista = szurtLista();
      const cel = lista[lista.findIndex(c => c.id === state.kivalasztott) + irany];
      if (cel) megnyit(cel.id);
    };
    const elozo = q('#cv-prev');
    if (elozo) elozo.addEventListener('click', () => lep(-1));
    const kovetkezo = q('#cv-next');
    if (kovetkezo) kovetkezo.addEventListener('click', () => lep(1));

    const uj = q('#cv-new');
    if (uj) uj.addEventListener('click', () => CaseForm.open({ onSaved: id => megnyit(id) }));

    const dij = q('#cv-fee');
    if (dij) dij.addEventListener('click', () => {
      const c = CaseRepo.get(state.kivalasztott);
      if (c && TransfersView.addFromCase(c)) render();
    });

    const szerk = q('#cv-edit');
    if (szerk) szerk.addEventListener('click', () => CaseForm.open({
      caseId: state.kivalasztott, onSaved: () => render(),
    }));

    const torol = q('#cv-delete');
    if (torol) torol.addEventListener('click', () => torlesMegerosites(state.kivalasztott));

    const statusz = q('#cv-advance');
    if (statusz) statusz.addEventListener('click', () => CaseForm.openStatus({
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

    if (state.lap === 'eh' && state.kivalasztott) {
      const c = CaseRepo.get(state.kivalasztott);
      const emp = c && EmployeeRepo.get(c.employeeId);
      if (emp) CaseEh.bind(container, c, emp, render);
    }
  }

  return { init, _render: render, _badge: frissitJelzo };
})();
