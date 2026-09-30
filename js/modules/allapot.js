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

  // ── Állapot-kivonat kiírása (TERV-fiokok.md 3.4, 2. fázis) ────────────────
  /**
   * A valódi adatminimalizálás: a megtekintő ne a teljes nyilvántartást olvassa.
   *
   * **Vezetőnként EGY fájl**, nem egy közös: csak így lehet később NTFS-szinten
   * szűkíteni (vagy egyszerűen elküldeni azt az egy fájlt). Egy közös fájlban
   * minden műszakvezető látná a többiek dolgozóit is — az nem minimalizálás.
   *
   * A kivonatban CSAK az az öt adat van, amit a megtekintő láthat. Amit nem írunk
   * bele, az nem is szivároghat: okmányszám, adóazonosító, bér, bankszámla, anyja
   * neve egyáltalán nem kerül a fájlba.
   */
  const KIVONAT_DIR = 'allapot';

  function kivonatSorok() {
    let emps = [];
    try { emps = EmployeeRepo.all(); } catch { return new Map(); }
    const perVezeto = new Map();
    for (const emp of emps) {
      const vez = String((emp.fields || {}).hr_direct_leader || '').trim();
      if (!vez) continue;                       // vezető nélkül nincs kinek kiírni
      const ugyek = ugyekOf(emp.id);
      const sorok = ugyek.length ? ugyek.map(u => ({
        nev:       nev(emp),
        ugy:       safe(() => CaseTypes.label(u.type)) || u.type || '',
        allapot:   safe(() => CaseTypes.statusLabel(u.type, u.status)) || u.status || '',
        hatarido:  safe(() => CaseRepo.deadlineText(u)) || '',
        kovetkezo: u.dueAt ? '' : safe(() => CaseTypes.triggerLabel(u.type)) || '',
      })) : [{ nev: nev(emp), ugy: '', allapot: 'nincs folyamatban lévő ügy',
               hatarido: '', kovetkezo: '' }];
      if (!perVezeto.has(vez)) perVezeto.set(vez, []);
      perVezeto.get(vez).push(...sorok);
    }
    return perVezeto;
  }

  /** Fájlnévbe illő alak — a vezető nevéből. */
  function fajlNev(vez) {
    const t = String(vez).replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
    return `${t || 'ismeretlen'}.json`;
  }

  async function kivonatKiir(dirHandle) {
    if (!dirHandle) throw new Error('Nincs beállított adatmappa.');
    const perVezeto = kivonatSorok();
    if (!perVezeto.size) {
      throw new Error('Egyetlen dolgozónál sincs kitöltve a „Közvetlen vezető" mező — '
                    + 'nincs kinek kivonatot írni.');
    }
    const dir = await FsService.getSubDir(dirHandle, KIVONAT_DIR, true);
    let db = 0;
    for (const [vez, sorok] of perVezeto) {
      await FsService.writeTextToDir(dir, fajlNev(vez), JSON.stringify({
        vezeto: vez,
        keszult: new Date().toISOString(),
        keszitette: Settings.currentUser(),
        // Szándékosan CSAK ez az öt mező. Bővítés előtt gondold át: amit
        // beírunk, azt a műszakvezető látja.
        sorok,
      }, null, 2));
      db++;
    }
    return { fajlok: db, sorok: [...perVezeto.values()].reduce((a, b) => a + b.length, 0) };
  }

  return { init, render, kivonatKiir, KIVONAT_DIR };
})();
