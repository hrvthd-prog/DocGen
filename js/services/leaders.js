'use strict';

/**
 * Közvetlen vezetők — a dolgozók és a vezetői fiókok közti kapocs.
 * Terv: `TERV-fiokok.md` 10.
 *
 * A dolgozó a séma „Közvetlen vezető" mezőjében a vezető NEVÉT hordozza: az
 * iratokra is ez megy ki („Direct leader:"), ezért nem lehet belső azonosító.
 * Hogy a név mégse sodródjon el a fiókoktól, három dolog őrzi:
 *   – a kézi rögzítés csak a vezetői fiókok közül választ (`candidates`),
 *   – a fiók átnevezése a dolgozók mezőjét is átírja (`renameCascade`),
 *   – ami mégis eltér (pl. xlsx-importból), az látszik (`isAccountName`,
 *     `orphans`).
 *
 * A vezetők EGYMÁS közti kapcsolata (felettes, helyettes) nem itt, hanem a
 * fiókfájlban él, azonosítóval — lásd `Auth.setSupervisor` / `addDeputy`.
 */
const Leaders = (() => {

  /** A séma mezője. Egy helyen, hogy ne szóródjon szét a kódban. */
  const FIELD = 'hr_direct_leader';

  function leaderOf(emp) { return String(((emp && emp.fields) || {})[FIELD] || '').trim(); }

  /** A választéklista: a vezetői (saját dolgozókat látó) fiókok neve. */
  function candidates() {
    return Auth.accounts().filter(Auth.isLeader).map(a => a.name)
      .sort((a, b) => a.localeCompare(b, 'hu'));
  }

  /** A név (ékezet- és kisbetű-függetlenül) egy vezetői fiókhoz tartozik-e. */
  function isAccountName(nev) {
    const f = Auth.fold(nev);
    return !!f && candidates().some(c => Auth.fold(c) === f);
  }

  /** A fiók pontos neve a választékból (a beírt alak helyett), vagy ''. */
  function canonical(nev) {
    const f = Auth.fold(nev);
    return candidates().find(c => Auth.fold(c) === f) || '';
  }

  function teamOf(nev, { includeExited = false } = {}) {
    const f = Auth.fold(nev);
    if (!f) return [];
    return EmployeeRepo.all({ includeExited }).filter(e => Auth.fold(leaderOf(e)) === f);
  }

  /**
   * A vezető beírása (vagy '' = törlése) több dolgozóra. Csak vezetői fiók
   * neve írható — a szabad szöveg a kézi rögzítésből kimaradt (10.2).
   * -> { valtozott, hibak: [{ id, uzenet }] }
   */
  function assign(empIds, nev, { source = 'tomeges' } = {}) {
    const ertek = nev ? canonical(nev) : '';
    if (nev && !ertek) throw new Error(`„${nev}” nem vezetői fiók — előbb vedd fel fiókként.`);
    let valtozott = 0;
    const hibak = [];
    for (const id of [].concat(empIds)) {
      const emp = EmployeeRepo.get(id);
      if (!emp || leaderOf(emp) === ertek) continue;
      try {
        EmployeeRepo.update(id, { fields: { [FIELD]: ertek }, source });
        valtozott++;
      } catch (e) {
        // Egy hibás (pl. régi, érvénytelen adatú) rekord ne állítsa meg a többit.
        hibak.push({ id, uzenet: e.message });
      }
    }
    return { valtozott, hibak };
  }

  /** Fiók átnevezésekor a dolgozók mezője is követi — a kilépetteké is. */
  function renameCascade(regi, uj) {
    if (!Auth.fold(regi) || Auth.fold(regi) === Auth.fold(uj)) {
      return { valtozott: 0, hibak: [] };
    }
    const ids = teamOf(regi, { includeExited: true }).map(e => e.id);
    const hibak = [];
    let valtozott = 0;
    for (const id of ids) {
      try {
        EmployeeRepo.update(id, { fields: { [FIELD]: uj }, source: 'fiok' });
        valtozott++;
      } catch (e) { hibak.push({ id, uzenet: e.message }); }
    }
    return { valtozott, hibak };
  }

  /** Aktív dolgozók vezető nélkül, vagy fiókkal nem egyező vezetővel. */
  function orphans() {
    return EmployeeRepo.all().filter(e => !isAccountName(leaderOf(e)));
  }

  return { FIELD, leaderOf, candidates, isAccountName, canonical, teamOf, assign,
           renameCascade, orphans };
})();

if (typeof globalThis !== 'undefined' && typeof module === 'undefined') {
  globalThis.Leaders = Leaders;
}
