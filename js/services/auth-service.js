'use strict';

/**
 * Fiókok és négy jogosultsági szint. A terv: `TERV-fiokok.md`.
 *
 * ── Mit véd ez, és mit nem ─────────────────────────────────────────────────
 * Az app `file://` protokollról fut, megosztott mappán, kiszolgáló nélkül. Nincs
 * tehát mi kikényszerítse a szintet: a `sessionStorage` a felhasználó gépén van,
 * DevTools-ból egy sor átírni, a `docgen-employees.json` pedig ott a mappában —
 * aki olvasási joggal eléri, Jegyzettömbbel megnyitja.
 *
 * Ez a réteg ezért **munkafolyamat-korlát**: ki mit lát és mit tud elrontani.
 * A valódi határ a megosztott meghajtón az NTFS-jogosultság (a `TERV-fiokok.md`
 * 4. fejezetének mátrixa, amit az IT állít be). A kettő egymást kiegészíti: az
 * NTFS eldönti, ki nyithatja meg a fájlt, ez a réteg pedig azt, hogy aki
 * megnyitotta, mit tehet vele a felületen — és hogy ne véletlenül rontsa el.
 *
 * ── A PIN ──────────────────────────────────────────────────────────────────
 * PBKDF2-SHA-256, 100 000 iteráció, fiókonkénti véletlen sóval. Ez megállítja,
 * hogy valaki más fiókjával lépjen be (véletlenül vagy kényelemből), és a
 * naplóbejegyzések így tényleg ahhoz tartoznak, aki dolgozott.
 *
 * Amit NEM ad: egy 4-6 jegyű PIN keresési tere kicsi, és a só, a hash és az
 * ellenőrző kód is a kliensen van — ráérő támadó ellen nem véd. Ez tudatos:
 * a titok védelme az NTFS dolga, nem ezé.
 */
const Auth = (() => {

  const FILENAME = 'docgen-accounts.json';
  const SESSION_KEY = 'docgen_session';

  // ── A négy szint ──────────────────────────────────────────────────────────
  const ROLES = ['admin', 'ugyintezo', 'hrbp', 'megtekinto'];

  const ROLE_LABEL = {
    admin:      'Legfőbb admin',
    ugyintezo:  'Ügyintéző',
    hrbp:       'HR Business Partner',
    megtekinto: 'Csak megtekintő',
  };

  const ROLE_HINT = {
    admin:      'Mindent lát és állít, ő kezeli a fiókokat.',
    ugyintezo:  'Nyilvántartás, dokumentumok, ügyek, átutalások.',
    hrbp:       'Mindent olvas, de csak a „Csak HR tölti” mezőket írja.',
    megtekinto: 'Csak a hozzá tartozó dolgozók ügyállását látja.',
  };

  /**
   * A jogosultsági mátrix ADAT, nem kód — egy halmaz szintenként. Új művelet
   * felvételéhez itt kell egy sor, nem szétszórt if-ek a felületen.
   *
   * Szándékosan NINCS öröklés (`admin ⊃ ugyintezo ⊃ …`): a HRBP nem „kevesebb
   * ügyintéző", hanem MÁS — többet olvas, kevesebbet ír.
   */
  const ACTIONS = [
    'registry.read',        // teljes nyilvántartás olvasása
    'registry.read.own',    // csak a hozzá tartozó dolgozók, státuszszinten
    'registry.write',       // teljes írás
    'registry.write.hr',    // csak a séma `hr_belso` csoportja
    'docgen.generate',
    'cases.read',
    'cases.read.own',
    'cases.write',
    'transfers.use',
    'settings.schema',      // séma, export profilok, ügytípusok
    'accounts.manage',
    'log.all',              // a hiányzó-adatok napló minden fiókra
  ];

  const CAN = {
    admin: new Set(ACTIONS),
    ugyintezo: new Set([
      'registry.read', 'registry.write', 'docgen.generate',
      'cases.read', 'cases.write', 'transfers.use',
    ]),
    hrbp: new Set([
      'registry.read', 'registry.write.hr', 'cases.read',
    ]),
    megtekinto: new Set([
      'registry.read.own', 'cases.read.own',
    ]),
  };

  /** A HRBP által írható mezőcsoport. A sémában már létezik: „Csak HR tölti”. */
  const HR_GROUP = 'hr_belso';

  // ── Állapot ───────────────────────────────────────────────────────────────
  let backend = null;
  let cache   = null;      // { version, accounts: [] }
  let session = null;      // { name, role }

  function roleLabel(role) { return ROLE_LABEL[role] || role; }
  function roleHint(role)  { return ROLE_HINT[role] || ''; }

  function nowIso() { return new Date().toISOString(); }

  function newId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'acc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  /** Ékezet- és kisbetű-független kulcs — az FsService.foldName párja. */
  function fold(s) {
    return String(s || '').toLowerCase()
      .replace(/[áéíóöőúüű]/g, c => ({ á:'a', é:'e', í:'i', ó:'o', ö:'o', ő:'o', ú:'u', ü:'u', ű:'u' }[c]))
      .trim();
  }

  // ── PIN ───────────────────────────────────────────────────────────────────
  const PIN_ITER = 100000;
  const PIN_MIN  = 4;
  const PIN_MAX  = 12;

  function _subtle() {
    const c = (typeof crypto !== 'undefined' && crypto) || null;
    if (!c || !c.subtle) {
      throw new Error('A böngésző nem támogatja a PIN-kódoláshoz szükséges Web Crypto API-t.');
    }
    return c;
  }

  function _hex(buf) {
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function newSalt() {
    const a = new Uint8Array(16);
    _subtle().getRandomValues(a);
    return _hex(a);
  }

  function _bytes(str) {
    // TextEncoder nem mindenhol van a tesztkörnyezetben; a PIN és a só ASCII.
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
    return out;
  }

  async function hashPin(pin, salt) {
    const c = _subtle();
    const key = await c.subtle.importKey('raw', _bytes(String(pin)), 'PBKDF2', false,
                                        ['deriveBits']);
    const bits = await c.subtle.deriveBits(
      { name: 'PBKDF2', salt: _bytes(salt), iterations: PIN_ITER, hash: 'SHA-256' },
      key, 256);
    return _hex(bits);
  }

  function validatePin(pin) {
    const s = String(pin == null ? '' : pin);
    if (!/^\d+$/.test(s)) return 'A PIN csak számjegyekből állhat.';
    if (s.length < PIN_MIN) return `A PIN legalább ${PIN_MIN} jegyű legyen.`;
    if (s.length > PIN_MAX) return `A PIN legfeljebb ${PIN_MAX} jegyű lehet.`;
    return null;
  }

  // ── Fiókfájl ──────────────────────────────────────────────────────────────
  function emptyDb() { return { version: 1, savedAt: null, accounts: [] }; }

  /**
   * A fiókok a KÖZÖS adatmappában élnek, külön fájlban.
   *
   * Nem `localStorage`-ban: az böngészőprofilonként külön, tehát megosztott
   * mappán minden gépen más lenne a lista és más a szint — egy szint, ami
   * gépenként különbözik, nem szint.
   *
   * És nem a `docgen-config.json`-ban: arról a README azt állítja, hogy nem
   * tartalmaz személyes adatot és gépek közt szabadon vihető; a fióknevek
   * viszont személyes adatok.
   */
  function useBackend(b) { backend = b; cache = null; }

  function createFileBackend(dirHandle) {
    return EmployeeRepo.createFileBackend(dirHandle, { filename: FILENAME });
  }

  async function load() {
    if (!backend) throw new Error('Nincs beállított fiók-háttér.');
    const raw = await backend.load();
    cache = raw && Array.isArray(raw.accounts) ? raw : emptyDb();
    cache.accounts = cache.accounts.map(migrate);
    return cache.accounts.length;
  }

  function migrate(a) {
    const o = Object.assign({}, a);
    o.id        = o.id || newId();
    o.name      = String(o.name || '').trim();
    o.role      = ROLES.includes(o.role) ? o.role : 'megtekinto';
    o.pinSalt   = o.pinSalt || '';
    o.pinHash   = o.pinHash || '';
    o.createdAt = o.createdAt || nowIso();
    o.createdBy = o.createdBy || '';
    return o;
  }

  function loaded()   { return !!cache; }
  function accounts() { return cache ? cache.accounts.slice() : []; }
  function isEmpty()  { return !cache || cache.accounts.length === 0; }

  async function save() {
    if (!backend) throw new Error('Nincs beállított fiók-háttér.');
    cache.savedAt = nowIso();
    await backend.save(cache);
    return true;
  }

  function byName(name) {
    const f = fold(name);
    return (cache ? cache.accounts : []).find(a => fold(a.name) === f) || null;
  }

  // ── Fiókkezelés (a felületen csak admin hívja) ────────────────────────────
  async function create({ name, role, pin }) {
    if (!cache) throw new Error('A fiókok nincsenek betöltve.');
    const n = String(name || '').trim();
    if (!n) throw new Error('A fiók neve nem lehet üres.');
    if (byName(n)) throw new Error(`Ez a név már szerepel: ${n}`);
    if (!ROLES.includes(role)) throw new Error(`Ismeretlen szint: ${role}`);
    const bad = validatePin(pin);
    if (bad) throw new Error(bad);
    const salt = newSalt();
    cache.accounts.push({
      id: newId(), name: n, role,
      pinSalt: salt, pinHash: await hashPin(pin, salt),
      createdAt: nowIso(), createdBy: (session && session.name) || '',
    });
    await save();
    return byName(n);
  }

  function get(id) {
    return (cache ? cache.accounts : []).find(a => a.id === id) || null;
  }

  /** Hány admin marad, ha `exceptId` fiókot töröljük vagy lefokozzuk. */
  function adminCount(exceptId = null) {
    return (cache ? cache.accounts : [])
      .filter(a => a.role === 'admin' && a.id !== exceptId).length;
  }

  async function setRole(id, role) {
    const a = get(id);
    if (!a) throw new Error('Nincs ilyen fiók.');
    if (!ROLES.includes(role)) throw new Error(`Ismeretlen szint: ${role}`);
    // Enélkül a rendszer kizárhatná magát: admin nélkül fiókot sem lehet kezelni.
    if (a.role === 'admin' && role !== 'admin' && adminCount(id) === 0) {
      throw new Error('Ez az utolsó admin — előbb vegyél fel másikat.');
    }
    a.role = role;
    await save();
    return a;
  }

  async function rename(id, name) {
    const a = get(id);
    if (!a) throw new Error('Nincs ilyen fiók.');
    const n = String(name || '').trim();
    if (!n) throw new Error('A fiók neve nem lehet üres.');
    const other = byName(n);
    if (other && other.id !== id) throw new Error(`Ez a név már szerepel: ${n}`);
    const old = a.name;
    a.name = n;
    await save();
    return { old, name: n };
  }

  async function setPin(id, pin) {
    const a = get(id);
    if (!a) throw new Error('Nincs ilyen fiók.');
    const bad = validatePin(pin);
    if (bad) throw new Error(bad);
    a.pinSalt = newSalt();
    a.pinHash = await hashPin(pin, a.pinSalt);
    await save();
    return true;
  }

  async function remove(id) {
    const a = get(id);
    if (!a) throw new Error('Nincs ilyen fiók.');
    if (a.role === 'admin' && adminCount(id) === 0) {
      throw new Error('Ez az utolsó admin — nem törölhető.');
    }
    cache.accounts = cache.accounts.filter(x => x.id !== id);
    await save();
    return true;
  }

  // ── Belépés ───────────────────────────────────────────────────────────────
  /** -> a fiók, vagy null ha a név/PIN nem jó. Szándékosan nem árulja el, melyik. */
  async function login(name, pin) {
    const a = byName(name);
    if (!a || !a.pinHash || !a.pinSalt) return null;
    const h = await hashPin(pin, a.pinSalt);
    if (h !== a.pinHash) return null;
    session = { name: a.name, role: a.role };
    _persistSession();
    return a;
  }

  function _persistSession() {
    try {
      if (typeof sessionStorage === 'undefined') return;
      if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else sessionStorage.removeItem(SESSION_KEY);
    } catch { /* privát mód: a munkamenet csak memóriában él */ }
  }

  /** Munkamenetre él: a böngésző bezárásakor elfelejtjük — a fiók nem ragad be. */
  function restoreSession() {
    try {
      if (typeof sessionStorage === 'undefined') return null;
      const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
      if (!s || !s.name || !ROLES.includes(s.role)) return null;
      // A szint a FÁJLBÓL jön, ha van: admin közben átállíthatta.
      const a = byName(s.name);
      session = a ? { name: a.name, role: a.role } : s;
      return session;
    } catch { return null; }
  }

  function logout() { session = null; _persistSession(); }

  function currentUser() { return session ? session.name : ''; }
  function currentRole() { return session ? session.role : null; }

  /**
   * Az egyetlen jogosultság-kérdés a felület felé. Bejelentkezés nélkül MINDEN
   * hamis — így egy elfelejtett kapu nem nyit meg semmit.
   */
  function can(action) {
    const r = currentRole();
    if (!r) return false;
    const set = CAN[r];
    return !!set && set.has(action);
  }

  /** Írható-e ez a sémamezőcsoport a mostani szinttel. */
  function canWriteGroup(groupKey) {
    if (can('registry.write')) return true;
    return can('registry.write.hr') && groupKey === HR_GROUP;
  }

  /**
   * A megtekintő a hozzá tartozó dolgozókat látja: a séma `hr_direct_leader`
   * mezője („Közvetlen vezető”) a kapocs. Nem kellett új mezőt felvenni.
   */
  function ownsEmployee(emp) {
    if (can('registry.read')) return true;
    if (!can('registry.read.own')) return false;
    const f = (emp && emp.fields) || {};
    return fold(f.hr_direct_leader) === fold(currentUser()) && fold(currentUser()) !== '';
  }

  return {
    ROLES, ROLE_LABEL, ACTIONS, HR_GROUP, PIN_MIN, PIN_MAX,
    roleLabel, roleHint,
    useBackend, createFileBackend, load, loaded, accounts, isEmpty, save,
    create, get, byName, setRole, rename, setPin, remove, adminCount,
    login, logout, restoreSession, currentUser, currentRole,
    can, canWriteGroup, ownsEmployee,
    validatePin, hashPin, newSalt, fold,
    // teszthez
    _CAN: CAN,
  };
})();

if (typeof globalThis !== 'undefined' && typeof module === 'undefined') {
  globalThis.Auth = Auth;
}
