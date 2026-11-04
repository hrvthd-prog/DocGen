'use strict';

/**
 * Egy dolgozó adatlapja — csak olvasható.
 *
 * A szerkesztő űrlap minden mezőt beviteli dobozként mutat, ezért egy adat
 * MEGNÉZÉSÉHEZ is „bele kellett lépni". Itt az adatok szövegként állnak
 * (kijelölhetők, másolhatók), és ha valamit módosítani kell, a sorra
 * kattintás a szerkesztőt pont annál a mezőnél nyitja meg.
 *
 * Felépítés (2026-11-04-i újratervezés — a régi 3 oszlopos rács soronként
 * keverte az össze nem tartozó mezőket, és a lényeg csak görgetés után jött):
 *   1. fejléc: név, a legfontosabb tények, állapotcímkék;
 *   2. csempék: tartózkodási engedély, útlevél, a legsürgősebb nyitott ügy;
 *   3. kártyák témánként, olvasási sorrendben, két hasábban;
 *   4. az ügyek listája.
 *
 * Az üres mezők alapból rejtve, a címek egy sorban; a „Minden mező” kapcsoló
 * (felhasználónként megmarad) mindkettőt kibontja.
 */
const EmployeeSummary = (() => {

  const AZONOSITO = '__azonosito';   // a szerkesztő azonosító-blokkja

  // Olvasási sorrend: a személy és az okmányai, aztán a munka, a lakás, végül
  // a ritkábban nézett adatok. Ismeretlen (kézzel felvett) csoport a végére.
  const SORREND = ['alap', 'szuletes', 'okmany', 'azonosito', 'foglalkoztatas', 'hr_belso',
                   'lakcim', 'kapcsolat', 'vegzettseg', 'korabbi', 'csalad'];

  // A cím darabjai helyett egy sor — a számított teljes cím (a darabjai a
  // `computed.from`-ban). A „Minden mező” nézet szétszedi.
  const CIM = { lakcim: 'address', korabbi: 'previous_address' };

  // Ennyi napon belüli lejárat borostyán: a hosszabbítás benyújtási ablaka is
  // ekkor nyílik (SUBMISSION_WINDOW_DEFAULT.earliestDays).
  const HAMAROSAN = 90;

  /** `gorgetes`: a szerkesztőből visszatérve ugyanott álljon a lap (nem a tetején). */
  function open(id, { gorgetes = 0 } = {}) {
    const emp = EmployeeRepo.get(id);
    if (!emp) { toast('A dolgozó nem található.', 'error'); return; }
    const minden = !!Settings.getUser('emp_summary_empty', false);
    const v = SchemaStore.resolveValues(emp.fields, 'hu');
    const csoportok = SchemaStore.byGroup({ includeComputed: false });
    const hely = k => { const i = SORREND.indexOf(k); return i < 0 ? SORREND.length : i; };
    csoportok.sort((a, b) => hely(a.group.key) - hely(b.group.key));
    const uresDb = csoportok.reduce((n, g) =>
      n + g.fields.filter(f => !SchemaStore.renderValue(f, emp.fields[f.key], 'hu')).length, 0);

    showDialog({
      title: 'Dolgozói adatlap',
      body: `
        <div class="es-wrap">
          ${fejHtml(emp, v)}
          ${csempekHtml(emp, v)}
          <div class="es-cards">
            ${csoportok.map(g => kartyaHtml(g, emp, v, minden)).join('')}
            ${egyebAzonositokHtml(emp)}
          </div>
          ${ugyekHtml(emp)}
        </div>`,
      footer: `
        <label class="check-row es-empty-toggle" title="Az üres mezők és a cím darabjai is látszanak">
          <input type="checkbox" id="es-empty" ${minden ? 'checked' : ''}>
          <span>Minden mező${uresDb ? ` <span class="es-none">(${uresDb} üres)</span>` : ''}</span>
        </label>
        <button class="btn btn-ghost btn-sm" id="es-history">Előzmények</button>
        <button class="btn btn-ghost btn-sm" id="es-edit">Szerkesztés</button>
        <button class="btn btn-primary btn-sm" onclick="closeDialog()">Bezárás</button>`,
    });

    // A párbeszéd alapból a képernyő 90%-áig nő; egy adatlapnál a túl hosszú sor nehezen olvasható.
    document.querySelector('#dialog-overlay .dialog-box').classList.add('es-dialog');
    const torzs = document.querySelector('#dialog-overlay .dialog-body');
    if (torzs && gorgetes) torzs.scrollTop = gorgetes;
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
      open(id, { gorgetes: torzs ? torzs.scrollTop : 0 });
    });
    document.getElementById('es-edit').addEventListener('click', () => szerkeszt(id, null));
    document.getElementById('es-history').addEventListener('click', () => EmployeeHistory.open(emp));
  }

  /** A szerkesztő a kért mezőnél; mentés után vissza az adatlapra, ugyanoda. */
  function szerkeszt(id, kulcs) {
    const torzs = document.querySelector('#dialog-overlay .dialog-body');
    const gorgetes = torzs ? torzs.scrollTop : 0;
    closeDialog();
    EmployeeForm.open({ id, focus: kulcs, onSave: () => open(id, { gorgetes }) });
  }

  // ── Fejléc és csempék ──────────────────────────────────────────────────────

  function fejHtml(emp, v) {
    const nev = [v.surname, v.forename].filter(Boolean).join(' ') || '(névtelen)';
    const tenyek = [
      v.personnel_reg_number && `törzsszám ${v.personnel_reg_number}`,
      v.citizenship,
      v.date_of_birth && `szül. ${v.date_of_birth}`,
      v.position,
    ].filter(Boolean);
    return `
      <div class="es-hero">
        <div class="es-hero__main">
          <div class="es-name">${escHtml(nev)}</div>
          ${tenyek.length ? `<div class="es-facts">${tenyek.map(escHtml).join(' · ')}</div>` : ''}
        </div>
        <div class="es-hero__side">
          <div class="es-chips">
            <span class="es-chip ${emp.exited ? 'is-off' : 'is-on'}">${
              emp.exited ? `kilépett${emp.exitDate ? ' · ' + escHtml(emp.exitDate) : ''}` : 'aktív'}</span>
            ${emp.noRenewal ? '<span class="es-chip is-warn">nem hosszabbítjuk</span>' : ''}
          </div>
          <span class="es-hint">Kattints egy adatra a szerkesztéshez</span>
        </div>
      </div>`;
  }

  function csempekHtml(emp, v) {
    const ma = CaseTypes.isoDate(new Date());
    const lejarat = (cimke, szamKulcs, napKulcs) => {
      const nap = emp.fields[napKulcs] || '';
      const napok = nap ? Math.round((Date.parse(nap) - Date.parse(ma)) / 86400000) : null;
      const tonus = napok === null ? '' : napok < 0 ? ' is-late' : napok <= HAMAROSAN ? ' is-soon' : '';
      // A napszám csak közel van értelme („1334 nap múlva” semmit nem mond)
      const meta = !nap ? 'nincs lejárat megadva'
        : `${napok < 0 ? 'lejárt' : 'lejár'} ${v[napKulcs]}${
            tonus ? ` (${CaseTimeline.napSzoveg(nap, ma)})` : ''}`;
      return `
        <div class="es-tile${tonus}" data-es-key="${napKulcs}" title="Kattintás: szerkesztés">
          <span class="es-tile__k">${cimke}</span>
          <span class="es-tile__v">${escHtml(v[szamKulcs] || '—')}</span>
          <span class="es-tile__m">${escHtml(meta)}</span>
        </div>`;
    };

    // A legsürgősebb nyitott ügy (a legkorábbi határidő; határidő nélküli a végén)
    let nyitott = [];
    try { nyitott = CaseRepo.forEmployee(emp.id, { includeClosed: false }); } catch { /* ügyek nélkül is */ }
    nyitott.sort((a, b) => String(a.dueAt || '9999').localeCompare(String(b.dueAt || '9999')));
    const u = nyitott[0];
    return `
      <div class="es-tiles">
        ${lejarat('Tartózkodási engedély', 'number_of_rp', 'expiration_of_rp')}
        ${lejarat('Útlevél', 'pp_number', 'pp_validity')}
        <div class="es-tile es-tile--case">
          <span class="es-tile__k">Nyitott ügy${nyitott.length > 1 ? ` (${nyitott.length})` : ''}</span>
          <span class="es-tile__v">${u ? escHtml(CaseTypes.title(u)) : '—'}</span>
          <span class="es-tile__m">${u
            ? escHtml(`${CaseRepo.allapotSzoveg(u)} · ${CaseRepo.deadlineText(u)}`) : 'nincs nyitott ügye'}</span>
        </div>
      </div>`;
  }

  // ── Kártyák ────────────────────────────────────────────────────────────────

  function sorHtml({ kulcs, cimke, ertek }) {
    return `
      <div class="es-row" data-es-key="${escHtml(kulcs)}" title="Kattintás: szerkesztés">
        <span class="es-label">${escHtml(cimke)}</span>
        <span class="es-value">${ertek ? escHtml(ertek) : '<span class="es-none">—</span>'}</span>
      </div>`;
  }

  function kartyaHtml(g, emp, v, minden) {
    const cim = !minden && CIM[g.group.key];
    const mezo = cim && SchemaStore.field(cim);
    const reszek = (mezo && mezo.computed && mezo.computed.from) || [];
    const sorok = g.fields
      .filter(f => !reszek.includes(f.key))
      .map(f => ({ kulcs: f.key, cimke: f.label.hu, ertek: SchemaStore.renderValue(f, emp.fields[f.key], 'hu') }));
    // A cím sorára kattintva a szerkesztő az első darabjánál nyílik
    if (reszek.length && v[cim]) sorok.unshift({ kulcs: reszek[0], cimke: 'Cím', ertek: v[cim] });
    const lathato = minden ? sorok : sorok.filter(s => s.ertek);
    if (!lathato.length) return '';
    return `
      <section class="es-card">
        <h4 class="ef-group-title">${escHtml(g.group.label)}</h4>
        ${lathato.map(sorHtml).join('')}
      </section>`;
  }

  /**
   * Az ismert azonosítók (SAP, engedély, útlevél, adó, TAJ) aktuális értéke a
   * saját mezőjükben is áll — ott látszanak, nem kétszer. Csak az ismeretlen
   * típusú kerül ide, hogy ne tűnjön el.
   */
  function egyebAzonositokHtml(emp) {
    const egyeb = emp.identifiers.filter(i => i.current && !EmployeeRepo.IDENTIFIER_FIELD_MAP[i.type]);
    if (!egyeb.length) return '';
    return `
      <section class="es-card">
        <h4 class="ef-group-title">Egyéb azonosítók</h4>
        ${egyeb.map(i => sorHtml({ kulcs: AZONOSITO, cimke: EmployeeRepo.idTypeLabel(i.type), ertek: i.value })).join('')}
      </section>`;
  }

  function ugyekHtml(emp) {
    let ugyek = [];
    try { ugyek = CaseRepo.forEmployee(emp.id); } catch { return ''; }
    if (!ugyek.length) return '';
    return `
      <section class="es-card es-cases">
        <h4 class="ef-group-title">Ügyek (${ugyek.length})</h4>
        ${ugyek.map(c => `
          <div class="es-case${c.closedAt ? ' is-closed' : ''}">
            <b>${escHtml(CaseTypes.title(c))}</b>
            <span>${escHtml(CaseRepo.allapotSzoveg(c))}</span>
            <span class="es-none">${escHtml(c.closedAt
              ? 'lezárva ' + CaseTimeline.huDatum(c.closedAt) : CaseRepo.deadlineText(c))}</span>
            ${c.ehNumber ? `<span class="es-none">${escHtml(c.ehNumber)}</span>` : ''}
          </div>`).join('')}
      </section>`;
  }

  return { open, AZONOSITO };
})();
