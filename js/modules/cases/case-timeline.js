'use strict';

/**
 * Ügy-idővonal megjelenítése.
 *
 * Két részből áll:
 *   1. Benyújtási sáv – csak ott, ahol számítható (meghosszabbítás). Egy
 *      pillantással megmutatja, hol tartunk a −90 / −40 / −10 napos ablakban.
 *   2. Függőleges idővonal – a megtörtént események és a még hátralévő
 *      mérföldkövek időrendben.
 *
 * A legfontosabb megjelenítési szabály: a SZÁMÍTOTT pontok (benyújtási
 * mérföldkövek, határidő) vizuálisan elkülönülnek a RÖGZÍTETT tényektől
 * (események). Előbbiek következtetések, utóbbiak megtörtént dolgok –
 * hatósági ügyben ezt nem szabad összemosni.
 */
const CaseTimeline = (() => {

  const SZIN = {
    korai:   'var(--c-slate)',
    idealis: 'var(--c-green)',
    siess:   'var(--c-amber)',
    lekesve: 'var(--c-red)',
  };

  const FAZIS_CIMKE = {
    korai:   'Még nem nyílt meg',
    idealis: 'Beadható',
    siess:   'Sürgős',
    lekesve: 'Lekésve',
  };

  function huDatum(iso) {
    if (!iso) return '';
    const [y, m, d] = String(iso).slice(0, 10).split('-');
    return `${y}. ${m}. ${d}.`;
  }

  /** Hány nap telt el / van hátra – rövid, olvasható alak. */
  function napSzoveg(iso, maIso) {
    const a = new Date(maIso), b = new Date(iso);
    const n = Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
                          Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
    if (n === 0) return 'ma';
    return n > 0 ? `${n} nap múlva` : `${-n} napja`;
  }

  // ── 1. Benyújtási sáv ──────────────────────────────────────────────────────

  /**
   * A sáv a legkorábbi naptól az engedély lejáratáig tart, benne a két belső
   * mérföldkővel és a mai nap jelölőjével. Ha a mai nap kilóg a sávból, a
   * jelölő a szélére kerül – nem tűnik el, csak nem torzítja a skálát.
   */
  function renderWindowBar(st, maIso) {
    if (!st) return '';
    const a = st.window;
    const kezd = new Date(a.earliest).getTime();
    const veg  = new Date(a.basis).getTime();
    const teljes = Math.max(1, veg - kezd);
    const pct = iso => {
      const t = new Date(iso).getTime();
      return Math.max(0, Math.min(100, ((t - kezd) / teljes) * 100));
    };

    const maT = new Date(maIso).getTime();
    const maKilog = maT < kezd || maT > veg;
    const maPct = pct(maIso);

    const szin = SZIN[st.phase] || 'var(--c-slate)';

    return `
      <div class="ct-window ${st.done ? 'ct-window--done' : ''}">
        <div class="ct-window__head">
          <span class="ct-window__badge" style="background:${st.done ? 'var(--c-slate)' : szin}">
            ${st.done ? 'Beadva' : escHtml(FAZIS_CIMKE[st.phase] || '')}
          </span>
          <span class="ct-window__text">${escHtml(st.text)}</span>
        </div>

        <div class="ct-window__bar">
          <div class="ct-window__seg ct-window__seg--ok"
               style="left:0;width:${pct(a.latest)}%"></div>
          <div class="ct-window__seg ct-window__seg--warn"
               style="left:${pct(a.latest)}%;width:${pct(a.final) - pct(a.latest)}%"></div>
          <div class="ct-window__seg ct-window__seg--late"
               style="left:${pct(a.final)}%;width:${100 - pct(a.final)}%"></div>
          ${st.done ? '' : `
            <div class="ct-window__now ${maKilog ? 'ct-window__now--out' : ''}"
                 style="left:${maPct}%" title="Ma – ${escHtml(huDatum(maIso))}"></div>`}
        </div>

        <div class="ct-window__marks">
          <span><strong>${escHtml(huDatum(a.earliest))}</strong><br>legkorábbi</span>
          <span><strong>${escHtml(huDatum(a.latest))}</strong><br>ajánlott</span>
          <span><strong>${escHtml(huDatum(a.final))}</strong><br>legvégső</span>
          <span><strong>${escHtml(huDatum(a.basis))}</strong><br>engedély lejár</span>
        </div>
      </div>`;
  }

  // ── 2. Függőleges idővonal ────────────────────────────────────────────────

  function pontIkon(p) {
    if (p.kind === 'ma')       return '◆';
    if (p.kind === 'esemeny')  return '●';
    if (p.kind === 'hatarido') return '▲';
    return '○';                                  // számított mérföldkő
  }

  function pontSzin(p) {
    if (p.kind === 'ma') return 'var(--c-blue)';
    if (p.kind === 'hatarido') {
      if (p.state === 'mult') return 'var(--c-red)';
      return p.advisory ? 'var(--c-slate)' : 'var(--c-amber)';
    }
    if (p.kind === 'ablak') {
      if (p.windowRole === 'final') return 'var(--c-red)';
      if (p.windowRole === 'latest') return 'var(--c-amber)';
      if (p.windowRole === 'basis') return 'var(--c-purple)';
      return 'var(--c-green)';
    }
    if (p.outcome) return 'var(--c-teal)';
    return 'var(--c-slate)';
  }

  function renderPoint(p, maIso, outcomeLabel) {
    const reszletek = [];
    if (p.note)        reszletek.push(escHtml(p.note));
    if (p.outcome)     reszletek.push(`<strong>${escHtml(outcomeLabel(p.outcome))}</strong>`);
    if (p.fileNumber)  reszletek.push(`iktatószám: ${escHtml(p.fileNumber)}`);
    if (p.ehNumber)    reszletek.push(`EH: ${escHtml(p.ehNumber)}`);
    if (p.user)        reszletek.push(`<span class="ct-user">${escHtml(p.user)}</span>`);

    // Utólag felvitt bejegyzésnél kiírjuk a rögzítés napját is: enélkül úgy
    // tűnne, mintha aznap dolgoztuk volna fel, ami hatósági ügyben téves kép.
    const utolagos = p.kind === 'esemeny' && p.backdated
      ? `<span class="ct-backdated" title="A történés és a rögzítés napja eltér">
           utólag rögzítve: ${escHtml(huDatum(p.recordedAt))}</span>`
      : '';

    // Csak a rögzített eseményeket lehet javítani – a számított pontokat nem
    const szerkeszt = p.kind === 'esemeny'
      ? `<button class="ct-edit" data-event-index="${p.eventIndex}"
                 title="Dátum vagy megjegyzés javítása">javít</button>`
      : '';

    return `
      <li class="ct-item ct-item--${p.state} ct-item--${p.kind}">
        <span class="ct-dot" style="color:${pontSzin(p)}">${pontIkon(p)}</span>
        <div class="ct-body">
          <div class="ct-line1">
            <span class="ct-label">${escHtml(p.label)}</span>
            ${p.computed ? '<span class="ct-calc" title="Számított érték, nem rögzített tény">számított</span>' : ''}
            ${szerkeszt}
          </div>
          <div class="ct-line2">
            <span class="ct-date">${escHtml(huDatum(p.date))}</span>
            <span class="ct-rel">${escHtml(napSzoveg(p.date, maIso))}</span>
            ${utolagos}
          </div>
          ${reszletek.length ? `<div class="ct-detail">${reszletek.join(' · ')}</div>` : ''}
        </div>
      </li>`;
  }

  /**
   * Teljes idővonal egy ügyhöz.
   *
   * @param ugy             a CaseRepo ügy-objektuma
   * @param employeeFields  a dolgozó mezői (a benyújtási ablakhoz kell)
   * @param ma              ISO dátum – teszteléshez rögzíthető
   */
  function render(ugy, employeeFields = {}, ma = null) {
    if (!ugy) return '<div class="ct-empty">Nincs kiválasztott ügy.</div>';

    const maIso = CaseTypes.isoDate(ma ? new Date(ma) : new Date());
    const pontok = CaseRepo.timeline(ugy, employeeFields, maIso);
    const st = CaseRepo.submissionStatus(ugy, employeeFields, maIso);

    const fejlec = `
      <div class="ct-head">
        <div class="ct-title">${escHtml(CaseTypes.label(ugy.type))}</div>
        <div class="ct-sub">
          ${escHtml(CaseTypes.statusLabel(ugy.type, ugy.status))}
          ${ugy.closedAt ? ` · lezárva: ${escHtml(CaseTypes.outcomeLabel(ugy.outcome))}` : ''}
          ${ugy.fileNumber ? ` · iktatószám: ${escHtml(ugy.fileNumber)}` : ''}
          ${ugy.ehNumber ? ` · EH: ${escHtml(ugy.ehNumber)}` : ''}
        </div>
      </div>`;

    if (!pontok.length) {
      return fejlec + '<div class="ct-empty">Ehhez az ügyhöz még nincs esemény.</div>';
    }

    return fejlec
      + renderWindowBar(st, maIso)
      + `<ul class="ct-list">${
          pontok.map(p => renderPoint(p, maIso, CaseTypes.outcomeLabel)).join('')
        }</ul>`;
  }

  return { render, renderWindowBar, huDatum, napSzoveg, FAZIS_CIMKE };
})();
