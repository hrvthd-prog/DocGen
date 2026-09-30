'use strict';

/**
 * Jogosultsági szintek — adatként, nem kódban.
 *
 * Ugyanaz az elv, mint a mezősémánál és az ügytípusoknál: a szinteket és a
 * jogaikat a felületről lehet szerkeszteni, a kód csak értelmezi őket. Ha a
 * munkamegosztás megváltozik, **szintet szerkesztünk, nem kódot írunk.**
 *
 * Az itteni lista SEED adat — az élő definíciók a `data/docgen-config.json`
 * `roles` kulcsában élnek, és a `Roles.loadFrom()` tölti be őket.
 *
 * ── Ami NEM lehet adat, és miért ────────────────────────────────────────────
 * A MŰVELETEK listája (`ACTIONS`) kódban van. Minden művelet egy ellenőrzési
 * pont, amit a kód hív (`Auth.can('registry.write')`); egy felületről kitalált
 * új műveletnek nincs hívási helye, tehát nem tenne semmit — csak azt a
 * látszatot adná, hogy beállítottunk valamit.
 *
 * Pontosan úgy, mint a sémánál: a MEZŐLISTA adat, de egy új mező TÍPUSA kódot
 * igényel. Amit a művelethez adatként adunk, az a címke és a magyarázat, hogy a
 * szerkesztő rács olvasható legyen.
 */

/** A kód ellenőrzési pontjai. Új elem ide CSAK új hívási hellyel együtt kerül. */
const ROLE_ACTIONS = [
  { key: 'registry.read',      label: 'Nyilvántartás olvasása',
    hint: 'A teljes munkavállalói adatkör megtekintése.' },
  { key: 'registry.read.own',  label: 'Csak a saját dolgozói',
    hint: 'A „Közvetlen vezető" mező alapján hozzárendelt dolgozók, státuszszinten.' },
  { key: 'registry.write',     label: 'Nyilvántartás írása',
    hint: 'Minden mező szerkesztése, új személy felvétele.' },
  { key: 'registry.write.hr',  label: 'Csak a HR-mezők írása',
    hint: 'A séma „Csak HR tölti" csoportja (bankszámla, költséghely, közvetlen vezető…).' },
  { key: 'docgen.generate',    label: 'Dokumentumgenerálás',
    hint: 'Iratok előállítása sablonból.' },
  { key: 'cases.read',         label: 'Ügyek olvasása',
    hint: 'Minden ügy, határidő és idővonal.' },
  { key: 'cases.read.own',     label: 'Csak a saját ügyei',
    hint: 'Az „Ügyállás" fül: a hozzárendelt dolgozók ügyei.' },
  { key: 'cases.write',        label: 'Ügyek írása',
    hint: 'Ügy nyitása, státuszváltás, esemény rögzítése.' },
  { key: 'transfers.use',      label: 'Átutalások',
    hint: 'Eljárási díjak kötegei és a banki közlemény.' },
  { key: 'settings.schema',    label: 'Séma és szótár',
    hint: 'Adatmezők, szótár, export profilok, ügytípusok — rendszerszintű beállítás.' },
  { key: 'settings.ehcontact', label: 'EH elérhetőség',
    hint: 'A kérelemre felmenő e-mail és telefonszám.' },
  { key: 'accounts.manage',    label: 'Fiókok és szintek kezelése',
    hint: 'Fiók felvétele, szint adása és elvétele, PIN-csere.' },
  { key: 'log.all',            label: 'Napló minden fiókra',
    hint: 'A hiányzó-adatok napló az összes fiók bejegyzéseivel.' },
];

/**
 * A négy kiinduló szint. Ez a KEZDŐÁLLAPOT: az élesben a felületről szerkesztett
 * változat él. A `builtin` jelölés annyit jelent, hogy frissítéskor az ÚJ
 * műveleteket a kiadás szándéka szerint kapja meg (lásd `mergeNewActions`).
 */
const SEED_ROLES = {
  version: 1,
  roles: [
    { key: 'admin', label: 'Legfőbb admin', builtin: true,
      hint: 'Mindent lát és állít, ő kezeli a fiókokat.',
      can: ROLE_ACTIONS.map(a => a.key) },
    { key: 'ugyintezo', label: 'Ügyintéző', builtin: true,
      hint: 'Nyilvántartás, dokumentumok, ügyek, átutalások.',
      can: ['registry.read', 'registry.write', 'docgen.generate',
            'cases.read', 'cases.write', 'transfers.use', 'settings.ehcontact'] },
    { key: 'hrbp', label: 'HR Business Partner', builtin: true,
      hint: 'Mindent olvas, de csak a „Csak HR tölti" mezőket írja.',
      can: ['registry.read', 'registry.write.hr', 'cases.read'] },
    { key: 'megtekinto', label: 'Csak megtekintő', builtin: true,
      hint: 'Csak a hozzá tartozó dolgozók ügyállását látja.',
      can: ['registry.read.own', 'cases.read.own'] },
  ],
};

const Roles = (() => {

  let backend = null;
  let data    = null;      // { version, roles: [], knownActions: [] }
  let audit   = null;      // (action, adat) => void — az Auth állítja be

  const ACTION_KEYS = ROLE_ACTIONS.map(a => a.key);

  function useBackend(b) { backend = b; data = null; }

  /** Naplózó beállítása: a jogosultság adása/vétele tartós nyomot hagy. */
  function setAuditSink(fn) { audit = fn; }

  function _log(action, adat) {
    if (typeof audit === 'function') {
      try { audit(action, adat); } catch { /* a napló sosem állítja meg a munkát */ }
    }
  }

  function normalize(raw) {
    const src = (raw && Array.isArray(raw.roles) && raw.roles.length) ? raw : SEED_ROLES;
    const roles = src.roles.map(r => ({
      key:     String(r.key || '').trim(),
      label:   String(r.label || r.key || '').trim(),
      hint:    String(r.hint || ''),
      builtin: !!r.builtin,
      // Ismeretlen művelet kiesik: egy régi configban maradt kulcs ne adjon jogot
      // olyanra, amit a kód már nem ismer.
      can:     [...new Set((Array.isArray(r.can) ? r.can : [])
                 .filter(a => ACTION_KEYS.includes(a)))],
    })).filter(r => r.key);
    return {
      version: src.version || 1,
      roles,
      knownActions: Array.isArray(src.knownActions) ? src.knownActions : null,
    };
  }

  /**
   * Új művelet a kiadásban: a BEÉPÍTETT szintek a seed szerint kapják meg, a
   * saját szintek nem kapják meg automatikusan.
   *
   * Miért nem a seedet vesszük mindig alapul: az eltaposná a helyi
   * finomhangolást — pont azt, amiért szerkeszthetővé tettük. És miért nem
   * marad mindenkinél kikapcsolva: akkor egy frissítés után az új funkció
   * senkinél nem működne, amíg valaki rá nem jön.
   *
   * A `knownActions` mondja meg, mit ISMERT a mentett config — enélkül nem
   * tudnánk megkülönböztetni az „új műveletet" a „tudatosan elvett jogtól".
   * -> hány szint kapott új jogot
   */
  function mergeNewActions() {
    if (!data) return 0;
    const ismert = data.knownActions;
    // Első mentés előtt (nincs knownActions) nincs mit összefésülni: a seed az.
    const ujak = ismert === null ? [] : ACTION_KEYS.filter(a => !ismert.includes(a));
    if (!ujak.length) { data.knownActions = ACTION_KEYS.slice(); return 0; }

    let erintett = 0;
    for (const r of data.roles) {
      if (!r.builtin) continue;
      const seed = SEED_ROLES.roles.find(s => s.key === r.key);
      if (!seed) continue;
      const add = ujak.filter(a => seed.can.includes(a) && !r.can.includes(a));
      if (add.length) {
        r.can.push(...add);
        erintett++;
        _log('JOG_UJ_MUVELET', { role: r.key, muveletek: add.join(',') });
      }
    }
    data.knownActions = ACTION_KEYS.slice();
    return erintett;
  }

  function loadFrom(raw) {
    data = normalize(raw);
    return mergeNewActions();
  }

  async function load() {
    if (!backend) { loadFrom(null); return 0; }
    let raw = null;
    try { raw = await backend.load(); } catch { raw = null; }
    // Hiányzó vagy sérült config esetén a SEED a tartalék — NEM a
    // „nincs korlátozás": a hiba iránya inkább zárjon, mint nyisson.
    const n = loadFrom(raw);
    if (n) await save();
    return n;
  }

  async function save() {
    if (!data) return false;
    data.knownActions = ACTION_KEYS.slice();
    if (backend) await backend.save(data);
    return true;
  }

  function loaded() { return !!data; }
  function all()    { return data ? data.roles.map(r => ({ ...r, can: r.can.slice() })) : []; }
  function keys()   { return all().map(r => r.key); }
  function get(key) { return data ? data.roles.find(r => r.key === key) || null : null; }
  function label(key) { const r = get(key); return r ? r.label : key; }
  function hint(key)  { const r = get(key); return r ? r.hint : ''; }
  function actions()  { return ROLE_ACTIONS.map(a => ({ ...a })); }

  /** Az egyetlen jogosultság-kérdés. Ismeretlen szint -> semmi. */
  function can(roleKey, action) {
    const r = get(roleKey);
    return !!r && r.can.includes(action);
  }

  // ── Kizárás elleni védelem ────────────────────────────────────────────────
  // Szerkeszthető mátrixszal az admin két kattintással kizárhatja magát: ha
  // senkinek nincs `accounts.manage` joga, a fiókokhoz és a szintekhez többé
  // senki nem ér hozzá — csak a JSON kézi szerkesztésével.
  const KEY_ACTION = 'accounts.manage';

  function holdersOf(action, exceptKey = null) {
    return (data ? data.roles : [])
      .filter(r => r.key !== exceptKey && r.can.includes(action))
      .map(r => r.key);
  }

  function _guardKeyAction(roleKey, action, on, sajatRole) {
    if (action !== KEY_ACTION || on) return;
    if (sajatRole && roleKey === sajatRole) {
      throw new Error('A saját szintedből nem vehető el a fiókkezelés joga — '
                    + 'különben nem tudnád visszaadni.');
    }
    if (holdersOf(KEY_ACTION, roleKey).length === 0) {
      throw new Error('Ez az utolsó szint, amelyik a fiókokat kezelheti — '
                    + 'előbb adj jogot egy másiknak.');
    }
  }

  /** Egy jelölő át- vagy visszaállítása. `sajatRole`: a belépett fiók szintje. */
  async function setAction(roleKey, action, on, { sajatRole = null } = {}) {
    const r = get(roleKey);
    if (!r) throw new Error('Nincs ilyen szint.');
    if (!ACTION_KEYS.includes(action)) throw new Error(`Ismeretlen művelet: ${action}`);
    const most = r.can.includes(action);
    if (most === !!on) return r;
    _guardKeyAction(roleKey, action, !!on, sajatRole);
    r.can = on ? [...r.can, action] : r.can.filter(a => a !== action);
    await save();
    // A payload kulcsa `muvelet`, NEM `action`: az utóbbi a naplóesemény típusa,
    // és felülírná azt (ezt a teszt kapta el).
    _log(on ? 'JOG_ADAS' : 'JOG_VETEL', { role: roleKey, muvelet: action });
    return r;
  }

  function _newKey(label) {
    const base = String(label || 'szint').toLowerCase()
      .replace(/[áéíóöőúüű]/g, c => ({ á:'a', é:'e', í:'i', ó:'o', ö:'o', ő:'o', ú:'u', ü:'u', ű:'u' }[c]))
      .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'szint';
    let k = base, i = 2;
    while (get(k)) k = `${base}${i++}`;
    return k;
  }

  async function create({ label, hint = '', can = [] }) {
    if (!data) throw new Error('A szintek nincsenek betöltve.');
    const l = String(label || '').trim();
    if (!l) throw new Error('A szint neve nem lehet üres.');
    if (data.roles.some(r => r.label.toLowerCase() === l.toLowerCase())) {
      throw new Error(`Ez a név már szerepel: ${l}`);
    }
    const r = {
      key: _newKey(l), label: l, hint: String(hint || ''), builtin: false,
      can: [...new Set(can.filter(a => ACTION_KEYS.includes(a)))],
    };
    data.roles.push(r);
    await save();
    _log('SZINT_UJ', { role: r.key, label: r.label, can: r.can.join(',') });
    return r;
  }

  async function rename(key, label) {
    const r = get(key);
    if (!r) throw new Error('Nincs ilyen szint.');
    const l = String(label || '').trim();
    if (!l) throw new Error('A szint neve nem lehet üres.');
    if (data.roles.some(x => x.key !== key && x.label.toLowerCase() === l.toLowerCase())) {
      throw new Error(`Ez a név már szerepel: ${l}`);
    }
    const old = r.label;
    r.label = l;
    await save();
    _log('SZINT_ATNEVEZES', { role: key, from: old, to: l });
    return r;
  }

  /**
   * Szint törlése. `usedBy`: a szintet használó fiókok nevei — a hívó adja meg,
   * mert a fiókokat az Auth ismeri, nem ez a modul.
   */
  async function remove(key, { usedBy = [], sajatRole = null } = {}) {
    const r = get(key);
    if (!r) throw new Error('Nincs ilyen szint.');
    if (usedBy.length) {
      throw new Error(`Ezt a szintet ${usedBy.length} fiók használja `
        + `(${usedBy.slice(0, 3).join(', ')}${usedBy.length > 3 ? '…' : ''}) — `
        + 'előbb rendeld át őket másik szintre.');
    }
    if (key === sajatRole) throw new Error('A saját szintedet nem törölheted.');
    if (r.can.includes(KEY_ACTION) && holdersOf(KEY_ACTION, key).length === 0) {
      throw new Error('Ez az utolsó szint, amelyik a fiókokat kezelheti — nem törölhető.');
    }
    data.roles = data.roles.filter(x => x.key !== key);
    await save();
    _log('SZINT_TORLES', { role: key, label: r.label });
    return true;
  }

  /** Egy beépített szint visszaállítása a kiadás szerinti állapotra. */
  async function resetToSeed(key) {
    const r = get(key);
    const seed = SEED_ROLES.roles.find(s => s.key === key);
    if (!r || !seed) throw new Error('Ehhez a szinthez nincs kiadás szerinti alap.');
    r.can = seed.can.slice();
    await save();
    _log('SZINT_ALAPRA', { role: key });
    return r;
  }

  return {
    ACTIONS: ROLE_ACTIONS, SEED: SEED_ROLES, KEY_ACTION,
    useBackend, setAuditSink, loadFrom, load, save, loaded,
    all, keys, get, label, hint, actions, can,
    setAction, create, rename, remove, resetToSeed, holdersOf,
    mergeNewActions,
  };
})();
