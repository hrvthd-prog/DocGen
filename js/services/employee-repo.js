'use strict';

/**
 * Munkavállalói nyilvántartás – tároló réteg.
 *
 * A rekord alakja:
 *   {
 *     id:          belső UUID – soha nem változik, a felületen nem jelenik meg
 *     identifiers: [{ type, value, validFrom, validTo, current, note }]
 *     fields:      { <sémakulcs>: érték }   ← a séma értelmezi, a tároló átlátszatlanul kezeli
 *     archived:    puha törlés
 *     createdAt / updatedAt / updatedBy / schemaVersion
 *   }
 *
 * Miért van külön azonosító-lista?
 *   A SAP-azonosító minden új tartózkodási engedéllyel változik, és a régit nem
 *   adja ki újra. Kulcsnak tehát alkalmatlan – a *története* viszont értékes,
 *   mert korábbi iratok és hatósági ügyek a régi számra hivatkoznak. Ezért a
 *   személyazonosság belső UUID, a külső azonosítók pedig érvényességi
 *   időszakkal, teljes történettel tárolódnak.
 */
const EmployeeRepo = (() => {

  const SCHEMA_VERSION_UNKNOWN = 0;

  // Ismert azonosító-típusok. A lista bővíthető: ismeretlen típus nem hiba,
  // csak nem kap külön megjelenítési nevet.
  const ID_TYPES = {
    sap:              'SAP törzsszám',
    residence_permit: 'Tartózkodási engedély',
    passport:         'Útlevélszám',
    tax:              'Adóazonosító jel',
    taj:              'TAJ-szám',
  };

  // A természetes kulcs mezői – azonosító-egyezés hiányában ezekkel párosítunk.
  // (Az adatbekérő útmutatója is ezt a hármast használja duplikátumszűrésre.)
  const NATURAL_KEY_FIELDS = ['surname', 'forename', 'date_of_birth'];

  /**
   * Azonosító-típus → séma-mező megfeleltetés.
   *
   * Ezek a számok kétszer szerepelnének: egyszer az azonosító-történetben,
   * egyszer az adatbekérő saját oszlopaként. Kétszer bekérni hibaforrás, ezért
   * az azonosító-történet az elsődleges, és az *aktuális* érték automatikusan
   * átmásolódik a megfelelő mezőbe – így az xlsx-export is helyes marad.
   */
  const IDENTIFIER_FIELD_MAP = {
    sap:              'personnel_reg_number',
    residence_permit: 'number_of_rp',
    passport:         'pp_number',
    tax:              'tax_number',
    taj:              'TAJ',
  };

  /** Az aktuális azonosítók bemásolása a hozzájuk tartozó mezőkbe. */
  function applyIdentifiersToFields(identifiers = [], fields = {}) {
    const out = Object.assign({}, fields);
    for (const [type, key] of Object.entries(IDENTIFIER_FIELD_MAP)) {
      const cur = identifiers.find(i => i.type === type && i.current);
      if (cur) out[key] = cur.value;
    }
    return out;
  }

  /**
   * A tükrözés érvényesítése a rekordon.
   *
   * Minden olyan ponton le kell futnia, ahol az azonosítók változnak – nem
   * csak az űrlapon. Új tartózkodási engedély rögzítésekor (pl. egy ügy
   * lezárásakor) enélkül az `number_of_rp` mező a RÉGI számot őrizné, és az
   * xlsx-export elavult adatot írna ki.
   *
   * Törléskor szándékosan nem üríti a mezőt: a leképezés csak *rátölt* az
   * aktuális azonosítóból, hogy kézzel felvitt adatot ne semmisítsen meg.
   */
  function syncIdentifierFields(emp) {
    emp.fields = applyIdentifiersToFields(emp.identifiers, emp.fields);
  }

  let backend = null;
  let cache   = null;          // { employees: [], meta: {} }
  let dirty   = false;
  let saveTimer = null;
  const listeners = new Set();

  // ── Segédfüggvények ────────────────────────────────────────────────────────

  function normText(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')   // ékezetek levétele
      .toLowerCase().trim();
  }

  function newId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    // Tartalék, ha a crypto nem elérhető (régi böngésző, teszt-sandbox)
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function nowIso() { return new Date().toISOString(); }

  function currentUserName() {
    try { return (typeof Settings !== 'undefined' && Settings.currentUser()) || 'helyi'; }
    catch { return 'helyi'; }
  }

  function emit() {
    for (const fn of listeners) {
      try { fn(); } catch (e) { /* egy hibás figyelő ne akassza meg a többit */ }
    }
  }

  function ensureLoaded() {
    if (!cache) throw new Error('A nyilvántartás nincs betöltve (EmployeeRepo.load()).');
  }

  // ── Azonosítók ─────────────────────────────────────────────────────────────

  function normalizeIdentifier(raw) {
    const value = String(raw.value == null ? '' : raw.value).trim();
    if (!value) return null;
    return {
      type:      String(raw.type || 'sap'),
      value,
      validFrom: raw.validFrom || null,
      validTo:   raw.validTo   || null,
      current:   raw.current !== false,
      note:      raw.note || '',
    };
  }

  /** Egy adott típus korábbi "aktuális" azonosítóját lezárja. */
  function closePrevious(emp, type, validTo) {
    for (const idf of emp.identifiers) {
      if (idf.type === type && idf.current) {
        idf.current = false;
        if (!idf.validTo) idf.validTo = validTo || nowIso().slice(0, 10);
      }
    }
  }

  function identifierKey(type, value) {
    return String(type) + '␟' + normText(value);
  }

  /** Minden azonosító – a lejártakat is beleértve – kulcs → employee.id térkép. */
  function buildIdentifierIndex(employees) {
    const map = new Map();
    for (const emp of employees) {
      for (const idf of emp.identifiers || []) {
        map.set(identifierKey(idf.type, idf.value), emp.id);
      }
    }
    return map;
  }

  // ── Validáció ──────────────────────────────────────────────────────────────
  // A mezők (fields) tartalmát a séma-réteg ellenőrzi; itt csak a tároló saját
  // sértetlenségi szabályai futnak.

  function validate(emp, { employees = [], ignoreId = null } = {}) {
    const problems = [];
    if (!emp.id) problems.push('Hiányzó belső azonosító.');

    const seenTypeCurrent = new Set();
    for (const idf of emp.identifiers || []) {
      if (!String(idf.value || '').trim()) {
        problems.push('Üres értékű azonosító.');
        continue;
      }
      if (idf.current) {
        if (seenTypeCurrent.has(idf.type)) {
          problems.push(`Több aktuális azonosító ugyanazzal a típussal: ${idTypeLabel(idf.type)}.`);
        }
        seenTypeCurrent.add(idf.type);
      }
    }

    // Ugyanaz az azonosító nem tartozhat két különböző személyhez
    const index = buildIdentifierIndex(employees.filter(e => e.id !== ignoreId));
    for (const idf of emp.identifiers || []) {
      const owner = index.get(identifierKey(idf.type, idf.value));
      if (owner && owner !== emp.id) {
        problems.push(`A(z) „${idf.value}" azonosító már egy másik személyhez tartozik.`);
      }
    }

    return problems;
  }

  function idTypeLabel(type) {
    return ID_TYPES[type] || type;
  }

  // ── Betöltés / mentés ──────────────────────────────────────────────────────

  function emptyDb() {
    return { version: 1, savedAt: null, employees: [] };
  }

  async function load() {
    if (!backend) throw new Error('Nincs beállított tároló háttér.');
    const raw = await backend.load();
    cache = raw && Array.isArray(raw.employees) ? raw : emptyDb();
    cache.employees = cache.employees.map(migrate);
    dirty = false;
    emit();
    return cache.employees.length;
  }

  /** Régebbi alakú rekordok felhozatala – hiányzó mező soha nem hiba. */
  function migrate(emp) {
    const e = Object.assign({}, emp);
    if (!e.id) e.id = newId();
    if (!Array.isArray(e.identifiers)) e.identifiers = [];
    e.identifiers = e.identifiers.map(normalizeIdentifier).filter(Boolean);
    if (!e.fields || typeof e.fields !== 'object') e.fields = {};
    e.archived      = !!e.archived;
    e.createdAt     = e.createdAt || nowIso();
    e.updatedAt     = e.updatedAt || e.createdAt;
    e.updatedBy     = e.updatedBy || '';
    e.schemaVersion = e.schemaVersion || SCHEMA_VERSION_UNKNOWN;
    return e;
  }

  async function save() {
    ensureLoaded();
    if (!backend) throw new Error('Nincs beállított tároló háttér.');
    cache.savedAt = nowIso();
    await backend.save(cache);
    dirty = false;
    return true;
  }

  /** Automata mentés: több gyors módosítást egyetlen írásba fog össze. */
  function scheduleSave(delayMs = 800) {
    dirty = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      save().catch(err => {
        if (typeof BevLogger !== 'undefined') {
          BevLogger.error('REPO_SAVE', 'A nyilvántartás mentése nem sikerült', err.message, '');
        }
      });
    }, delayMs);
  }

  async function flush() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (dirty) await save();
  }

  // ── Lekérdezés ─────────────────────────────────────────────────────────────

  function all({ includeArchived = false } = {}) {
    ensureLoaded();
    return includeArchived ? cache.employees.slice()
                           : cache.employees.filter(e => !e.archived);
  }

  function get(id) {
    ensureLoaded();
    return cache.employees.find(e => e.id === id) || null;
  }

  function count({ includeArchived = false } = {}) {
    return all({ includeArchived }).length;
  }

  /**
   * Keresés bármely azonosítóra – a már lejártakra is. Ez a lényeg: egy két éve
   * lejárt engedélyszámra is meg kell találni az embert.
   */
  function findByIdentifier(value, type = null) {
    ensureLoaded();
    const needle = normText(value);
    if (!needle) return null;
    for (const emp of cache.employees) {
      for (const idf of emp.identifiers) {
        if (type && idf.type !== type) continue;
        if (normText(idf.value) === needle) return emp;
      }
    }
    return null;
  }

  function naturalKeyOf(fields) {
    return NATURAL_KEY_FIELDS.map(k => normText(fields && fields[k])).join('␟');
  }

  function findByNaturalKey(fields) {
    ensureLoaded();
    const key = naturalKeyOf(fields);
    // Üres kulccsal (nincs név és születési dátum) nem párosítunk – az minden
    // hiányos rekordot összeolvasztana.
    if (!key.replace(/␟/g, '')) return null;
    return cache.employees.find(e => naturalKeyOf(e.fields) === key) || null;
  }

  /**
   * Beérkező rekord párosítása a nyilvántartással (importhoz).
   * Sorrend: bármely azonosító egyezése → természetes kulcs → nincs találat.
   */
  function matchIncoming({ identifiers = [], fields = {} } = {}) {
    ensureLoaded();
    for (const raw of identifiers) {
      const idf = normalizeIdentifier(raw);
      if (!idf) continue;
      const hit = findByIdentifier(idf.value, idf.type);
      if (hit) return { employee: hit, matchedBy: 'identifier', identifier: idf };
    }
    const byName = findByNaturalKey(fields);
    if (byName) return { employee: byName, matchedBy: 'naturalKey' };
    return { employee: null, matchedBy: null };
  }

  /** Szabad szavas keresés a mezőkben és az azonosítókban (a lejártakban is). */
  function search(text, { includeArchived = false } = {}) {
    const needle = normText(text);
    const list = all({ includeArchived });
    if (!needle) return list;
    return list.filter(emp => {
      for (const v of Object.values(emp.fields)) {
        if (normText(v).includes(needle)) return true;
      }
      for (const idf of emp.identifiers) {
        if (normText(idf.value).includes(needle)) return true;
      }
      return false;
    });
  }

  // ── Módosítás ──────────────────────────────────────────────────────────────

  function create({ fields = {}, identifiers = [], schemaVersion = SCHEMA_VERSION_UNKNOWN } = {}) {
    ensureLoaded();
    const emp = {
      id: newId(),
      identifiers: identifiers.map(normalizeIdentifier).filter(Boolean),
      fields: Object.assign({}, fields),
      archived: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      updatedBy: currentUserName(),
      schemaVersion,
    };
    syncIdentifierFields(emp);
    const problems = validate(emp, { employees: cache.employees });
    if (problems.length) throw new Error(problems.join(' '));
    cache.employees.push(emp);
    scheduleSave();
    emit();
    return emp;
  }

  function update(id, { fields, identifiers, schemaVersion } = {}) {
    ensureLoaded();
    const emp = get(id);
    if (!emp) throw new Error('Nincs ilyen azonosítójú személy.');

    const next = Object.assign({}, emp);
    if (fields)      next.fields = Object.assign({}, emp.fields, fields);
    if (identifiers) next.identifiers = identifiers.map(normalizeIdentifier).filter(Boolean);
    if (schemaVersion != null) next.schemaVersion = schemaVersion;

    const problems = validate(next, { employees: cache.employees, ignoreId: id });
    if (problems.length) throw new Error(problems.join(' '));

    emp.fields       = next.fields;
    emp.identifiers  = next.identifiers;
    emp.schemaVersion = next.schemaVersion;
    if (identifiers) syncIdentifierFields(emp);
    emp.updatedAt    = nowIso();
    emp.updatedBy    = currentUserName();
    scheduleSave();
    emit();
    return emp;
  }

  /**
   * Új azonosító rögzítése – az azonos típusú korábbi automatikusan lezárul.
   * Ez az új tartózkodási engedély / új SAP-szám egylépéses útja.
   */
  function addIdentifier(id, raw) {
    ensureLoaded();
    const emp = get(id);
    if (!emp) throw new Error('Nincs ilyen azonosítójú személy.');
    const idf = normalizeIdentifier(raw);
    if (!idf) throw new Error('Az azonosító értéke nem lehet üres.');

    const owner = findByIdentifier(idf.value, idf.type);
    if (owner && owner.id !== id) {
      throw new Error(`A(z) „${idf.value}" azonosító már egy másik személyhez tartozik.`);
    }

    if (idf.current) closePrevious(emp, idf.type, idf.validFrom);
    if (!idf.validFrom) idf.validFrom = nowIso().slice(0, 10);
    emp.identifiers.push(idf);
    syncIdentifierFields(emp);
    emp.updatedAt = nowIso();
    emp.updatedBy = currentUserName();
    scheduleSave();
    emit();
    return emp;
  }

  function removeIdentifier(id, value, type) {
    ensureLoaded();
    const emp = get(id);
    if (!emp) throw new Error('Nincs ilyen azonosítójú személy.');
    const before = emp.identifiers.length;
    emp.identifiers = emp.identifiers.filter(
      i => !(normText(i.value) === normText(value) && (!type || i.type === type))
    );
    if (emp.identifiers.length !== before) {
      emp.updatedAt = nowIso();
      emp.updatedBy = currentUserName();
      scheduleSave();
      emit();
    }
    return emp;
  }

  /** Az adott típus aktuális azonosítója (pl. a most érvényes SAP-szám). */
  function currentIdentifier(emp, type) {
    if (!emp) return null;
    return emp.identifiers.find(i => i.type === type && i.current) || null;
  }

  function setArchived(id, archived) {
    ensureLoaded();
    const emp = get(id);
    if (!emp) throw new Error('Nincs ilyen azonosítójú személy.');
    emp.archived  = !!archived;
    emp.updatedAt = nowIso();
    emp.updatedBy = currentUserName();
    scheduleSave();
    emit();
    return emp;
  }

  /** Végleges törlés – csak téves felvitel javítására. */
  function destroy(id) {
    ensureLoaded();
    const i = cache.employees.findIndex(e => e.id === id);
    if (i === -1) return false;
    cache.employees.splice(i, 1);
    scheduleSave();
    emit();
    return true;
  }

  // ── Tároló háttér ──────────────────────────────────────────────────────────

  function useBackend(b) { backend = b; cache = null; }
  function hasBackend()   { return !!backend; }
  function describeBackend() { return backend ? backend.describe() : 'nincs'; }

  function onChange(fn)  { listeners.add(fn); return () => listeners.delete(fn); }

  /**
   * Fájl-alapú háttér: egy JSON az adatmappában, minden mentés előtt
   * időbélyeges biztonsági másolattal. Ez az elsődleges tárolás – látható,
   * másolható, menthető, nem tűnik el a böngésző-profillal.
   */
  function createFileBackend(dirHandle, {
    filename = 'docgen-employees.json',
    backupDir = 'backup',
    keepBackups = 20,
  } = {}) {
    return {
      describe: () => `fájl: ${dirHandle.name}/${filename}`,

      async load() {
        try {
          const text = await FsService.readTextFromDir(dirHandle, filename);
          return JSON.parse(text);
        } catch {
          return null;   // még nincs adatfájl – üres nyilvántartással indulunk
        }
      },

      async save(data) {
        // Mentés előtt félretesszük az előző állapotot
        try {
          if (await FsService.fileExists(dirHandle, filename)) {
            const prev = await FsService.readTextFromDir(dirHandle, filename);
            const bdir = await FsService.getSubDir(dirHandle, backupDir, true);
            if (bdir) {
              const stamp = nowIso().replace(/[:.]/g, '-').slice(0, 19);
              await FsService.writeTextToDir(bdir, `${stamp}-${filename}`, prev);
              await pruneBackups(bdir);
            }
          }
        } catch (e) {
          // A biztonsági másolat hibája ne akadályozza meg a mentést
          if (typeof BevLogger !== 'undefined') {
            BevLogger.warn('REPO_BACKUP', 'Biztonsági másolat nem készült', e.message, '');
          }
        }
        await FsService.writeTextToDir(dirHandle, filename, JSON.stringify(data, null, 2));
      },
    };

    async function pruneBackups(bdir) {
      const names = await FsService.listFiles(bdir, n => n.endsWith(filename));
      const extra = names.length - keepBackups;
      for (let i = 0; i < extra; i++) await FsService.deleteFromDir(bdir, names[i]);
    }
  }

  /** Tartalék háttér, ha a fájlrendszer-API nem elérhető. */
  function createIdbBackend(key = 'employees') {
    return {
      describe: () => 'böngésző tároló (IndexedDB)',
      async load() {
        try { return (await FsService.loadHandle('db_' + key)) || null; }
        catch { return null; }
      },
      async save(data) {
        await FsService.saveHandle('db_' + key, JSON.parse(JSON.stringify(data)));
      },
    };
  }

  /** Memória-háttér – teszteléshez és előnézethez. */
  function createMemoryBackend(initial = null) {
    let store = initial;
    return {
      describe: () => 'memória',
      async load() { return store ? JSON.parse(JSON.stringify(store)) : null; },
      async save(data) { store = JSON.parse(JSON.stringify(data)); },
      _peek: () => store,
    };
  }

  return {
    ID_TYPES, NATURAL_KEY_FIELDS, IDENTIFIER_FIELD_MAP, applyIdentifiersToFields,
    // tároló
    useBackend, hasBackend, describeBackend, onChange,
    createFileBackend, createIdbBackend, createMemoryBackend,
    load, save, scheduleSave, flush,
    // lekérdezés
    all, get, count, search, findByIdentifier, findByNaturalKey, matchIncoming,
    currentIdentifier, idTypeLabel, naturalKeyOf,
    // módosítás
    create, update, addIdentifier, removeIdentifier, setArchived, destroy,
    // belső, teszteléshez
    _validate: validate, _normText: normText,
  };
})();
