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

  /** Írhatja-e a felhasználó az ügyeket? (a dialógusok a Settings elől rejtve) */
  function irhat() {
    return typeof Auth === 'undefined' || Auth.can('cases.write');
  }

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

  /** Két ISO nap távolsága napokban (UTC, nyári időszámítástól mentes). */
  function napKulonbseg(a, b) {
    return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  }

  function napPlusz(iso, n) {
    return new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);
  }

  /** A legkésőbbi ISO dátum a listából (az üreseket kihagyva). */
  function legkesobbi(lista) {
    return lista.filter(Boolean).sort().pop();
  }

  const TICK_NAP = 30;      // ennyi naponként kap a sáv egy rovátkát

  /**
   * A sáv modellje — tiszta adat, HTML nélkül, ezért tesztelhető.
   *
   * BEADÁS ELŐTT a sáv a benyújtási ablakot mutatja: legkorábbi nap →
   * az engedély lejárata, benne a két belső mérföldkővel.
   *
   * BEADÁS UTÁN a benyújtási mérföldkövek már nem mondanak semmit (a kérelem
   * bent van), ezért a sáv átvált: a beadás napjától az engedély lejáratáig /
   * az ügyintézési határidőig tart. A kérdés ilyenkor nem az, hogy „mikorra
   * kell beadni", hanem hogy „mennyi van még hátra".
   *
   * A mérföldkövek a VALÓDI arányuknál állnak (nem egyenletesen elosztva, mint
   * korábban): a mai nap jelölője csak így olvasható hozzájuk. Minden
   * `pct` 0–100 közé vágva, hogy a sávon kívülre eső dátum se torzítsa a skálát.
   */
  function barModel(st, maIso) {
    const a = st.window;
    const done = !!st.done;

    const kezd = (done && st.submittedAt) ? st.submittedAt : a.earliest;
    const veg  = legkesobbi([a.basis, done ? st.dueAt : null, done ? maIso : null, kezd]);
    const teljes = Math.max(1, napKulonbseg(kezd, veg));

    const pct = iso => Math.max(0, Math.min(100, (napKulonbseg(kezd, iso) / teljes) * 100));

    const szakaszok = done
      // Az eltelt idő a beadás óta – a maradék a világos alapsáv.
      ? [{ cls: 'done', from: 0, to: pct(maIso) }]
      : [{ cls: 'ok',   from: 0,              to: pct(a.latest) },
         { cls: 'warn', from: pct(a.latest),  to: pct(a.final) },
         { cls: 'late', from: pct(a.final),   to: 100 }];

    const nyers = done
      ? [{ iso: st.submittedAt, label: 'beadva' },
         { iso: st.dueAt,       label: 'ügyintézési határidő' },
         { iso: a.basis,        label: 'engedély lejár' }]
      : [{ iso: a.earliest, label: 'legkorábbi' },
         { iso: a.latest,   label: 'ajánlott' },
         { iso: a.final,    label: 'legvégső' },
         { iso: a.basis,    label: 'engedély lejár' }];

    const jelolok = nyers
      .filter(m => m.iso)
      .sort((x, y) => x.iso.localeCompare(y.iso))
      .map((m, i) => {
        const p = pct(m.iso);
        return Object.assign({}, m, {
          pct: p,
          row: i % 2,                                     // sakktábla: ne fedjék egymást
          shift: p <= 8 ? '0' : (p >= 92 ? '-100%' : '-50%'),
        });
      });

    const rovatkak = [];
    for (let n = TICK_NAP; n < teljes; n += TICK_NAP) {
      rovatkak.push({ iso: napPlusz(kezd, n), pct: (n / teljes) * 100 });
    }

    return {
      from: kezd, to: veg, days: teljes, done,
      segments: szakaszok, marks: jelolok, ticks: rovatkak,
      now: { pct: pct(maIso), out: maIso < kezd || maIso > veg },
    };
  }

  function renderWindowBar(st, maIso) {
    if (!st) return '';
    const m = barModel(st, maIso);
    const szin = SZIN[st.phase] || 'var(--c-slate)';

    return `
      <div class="ct-window ${m.done ? 'ct-window--done' : ''}">
        <div class="ct-window__head">
          <span class="ct-window__badge" style="background:${m.done ? 'var(--c-slate)' : szin}">
            ${m.done ? 'Beadva' : escHtml(FAZIS_CIMKE[st.phase] || '')}
          </span>
          <span class="ct-window__text">${escHtml(st.text)}</span>
        </div>

        <div class="ct-window__bar">
          ${m.segments.map(sz => `
            <div class="ct-window__seg ct-window__seg--${sz.cls}"
                 style="left:${sz.from}%;width:${Math.max(0, sz.to - sz.from)}%"></div>`).join('')}
          ${m.ticks.map(t => `
            <i class="ct-window__tick" style="left:${t.pct}%"
               title="${escHtml(huDatum(t.iso))}"></i>`).join('')}
          ${m.marks.map(k => `
            <i class="ct-window__anchor ct-window__anchor--r${k.row}"
               style="left:${k.pct}%"></i>`).join('')}
          <div class="ct-window__now ${m.now.out ? 'ct-window__now--out' : ''}"
               style="left:${m.now.pct}%" title="Ma – ${escHtml(huDatum(maIso))}"></div>
        </div>

        <div class="ct-window__marks">
          ${m.marks.map(k => `
            <span class="ct-window__mark ct-window__mark--r${k.row}"
                  style="left:${k.pct}%;transform:translateX(${k.shift})">
              <strong>${escHtml(huDatum(k.iso))}</strong>${escHtml(k.label)}</span>`).join('')}
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

    // Csak a rögzített eseményeket lehet javítani – a számított pontokat nem,
    // és csak annak, aki az ügyeket írhatja (admin, ügyintéző).
    const szerkeszt = p.kind === 'esemeny' && irhat()
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

  return { render, renderWindowBar, barModel, huDatum, napSzoveg, FAZIS_CIMKE };
})();
