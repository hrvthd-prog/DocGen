'use strict';

/**
 * „Ügyállás" fül — a `megtekinto` szint egyetlen nézete. Terv: `TERV-fiokok.md` 3.4.
 *
 * Miért külön, kicsi nézet, és nem a lecsupaszított Ügyek fül: az Ügyek fül gazdag
 * (űrlap, idővonal, dashboard, átutalások), és minden jövőbeni bővítésénél újra át
 * kellene gondolni, mit rejtsünk el. Egy elfelejtett elem ott adatot szivárogtatna.
 * Itt a nézet azt a öt adatot rajzolja ki, amit szabad — ami nincs a kódban, az
 * nem is jelenhet meg.
 *
 * ── Amit ez a nézet NEM ad ─────────────────────────────────────────────────
 * Ez felületi szűkítés. A `megtekinto` ugyanabból a fájlból olvas, mint a többi
 * szint, tehát aki a fájlhoz hozzáfér, mindent lát. A valódi adatminimalizálás a
 * 2. fázis: az admin kiír egy állapot-kivonatot, és a megtekintő NTFS-szinten is
 * csak azt olvashatja. Amíg az nincs, ez kényelem és rendezettség, nem védelem.
 */
const AllapotModule = (() => {

  let container = null;

  function init(el) {
    container = el;
    render();
    window.addEventListener('docgenTabActivated', e => {
      if (e.detail === 'allapot') render();
    });
    EmployeeRepo.onChange(() => render());
  }

  /** A saját dolgozók — a séma `hr_direct_leader` mezője a kapocs. */
  function sajatok() {
    let all = [];
    try { all = EmployeeRepo.all(); } catch { return []; }
    return all.filter(e => Auth.ownsEmployee(e));
  }

  function ugyekOf(empId) {
    try { return CaseRepo.forEmployee(empId, { includeClosed: false }); }
    catch { return []; }
  }

  function nev(emp) {
    const f = emp.fields || {};
    return [f.surname, f.forename].filter(Boolean).join(' ').trim()
        || [f['Vezetéknév'], f['Keresztnév']].filter(Boolean).join(' ').trim()
        || '(névtelen)';
  }

  function safe(fn) { try { return fn(); } catch { return ''; } }

  function render() {
    if (!container) return;

    if (!Auth.can('cases.read.own') && !Auth.can('cases.read')) {
      container.innerHTML = '';
      return;
    }

    const emps = sajatok();
    const sorok = [];
    for (const emp of emps) {
      const ugyek = ugyekOf(emp.id);
      if (!ugyek.length) {
        sorok.push({ nev: nev(emp), tipus: '—', allapot: 'nincs folyamatban lévő ügy',
                     hatarido: '', kovetkezo: '' });
        continue;
      }
      for (const u of ugyek) {
        sorok.push({
          nev:      nev(emp),
          tipus:    safe(() => CaseTypes.label(u.type)) || u.type || '—',
          allapot:  safe(() => CaseTypes.statusLabel(u.type, u.status)) || u.status || '—',
          hatarido: safe(() => CaseRepo.deadlineText(u)) || '',
          // „Mi hiányzik” helyett a KÖVETKEZŐ LÉPÉS: a tervben szereplő
          // „mi hiányzik” adatnak nincs forrása a DocGen-ben (azt a PDF Műhely
          // Áttekintője számolja az iratokból), és nem találunk ki egyet. A
          // határidő kezdő napja viszont valódi, meglévő jel.
          kovetkezo: u.dueAt ? '' : safe(() => CaseTypes.triggerLabel(u.type)) || '',
        });
      }
    }

    container.innerHTML = `
      <div class="workspace">
        <div class="workspace-col">
          <div class="ws-card">
            <div class="ws-card-header">
              <span class="ws-card-title">Ügyállás</span>
              <span class="rg-count">${emps.length} dolgozó · ${sorok.length} sor</span>
            </div>
            <div class="ws-card-body">
              <p class="sv-intro">
                A hozzád tartozó dolgozók ügyeinek állása. A hozzárendelés a
                nyilvántartás <b>„Közvetlen vezető"</b> mezőjéből jön — ha valaki
                hiányzik a listából, a HR-nél kell pontosítani.
                Személyes adatot (okmányszám, adóazonosító, bér) ez a nézet
                szándékosan nem mutat.
              </p>
              ${sorok.length ? tabla(sorok) : ures(emps.length)}
            </div>
          </div>
        </div>
      </div>`;
  }

  function ures(empDb) {
    return `<div class="login-empty">${empDb === 0
      ? 'Nincs hozzád rendelt dolgozó. Ha ez tévedés, a HR a „Közvetlen vezető” '
        + 'mezőben tudja beállítani.'
      : 'A dolgozóidhoz nincs rögzített ügy.'}</div>`;
  }

  function tabla(sorok) {
    return `
      <table class="data-table">
        <thead>
          <tr>
            <th>Dolgozó</th><th>Ügy</th><th>Állás</th>
            <th>Határidő</th><th>Következő lépés</th>
          </tr>
        </thead>
        <tbody>
          ${sorok.map(s => `
            <tr>
              <td>${escHtml(s.nev)}</td>
              <td>${escHtml(s.tipus)}</td>
              <td>${escHtml(s.allapot)}</td>
              <td>${escHtml(s.hatarido)}</td>
              <td>${escHtml(s.kovetkezo)}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  return { init, render };
})();
