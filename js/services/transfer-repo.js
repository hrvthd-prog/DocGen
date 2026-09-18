'use strict';

/**
 * Eljárási díjak átutalási naplója — tároló réteg.
 *
 * Ez váltja ki a `Procedural-Fee-Transfer-Log.xlsm` munkafüzetet. A makró két
 * munkalapja (beviteli lap + archívum) itt EGY fogalom: a köteg, státusszal.
 * A kettő között ugyanis nem szerkezeti a különbség, hanem annyi, hogy a pénz
 * elindult-e már. Egy mező, nem két adatszerkezet — így nem is térhet el
 * egymástól ugyanaz a sor két helyen.
 *
 * A köteg alakja:
 *   {
 *     id, label            belső azonosító és emberi címke („2026-09-18/1")
 *     status               'elokeszites' | 'kifizetve'
 *     paidOn               a tényleges utalás napja (ISO), amíg nincs: null
 *     createdAt / createdBy
 *     rows[]               a tételek
 *   }
 *
 * A tétel alakja — PILLANATKÉP, nem hivatkozás:
 *   {
 *     id, caseId, employeeId    honnan jött (a visszakereséshez)
 *     name, personnelNo, dob, nationality, identifier, amount, handler
 *   }
 *
 * ── Miért pillanatkép ─────────────────────────────────────────────────────
 * A makró archívuma szándékosan a feloldott ÉRTÉKET másolta, nem a képletet:
 * „the archive must stand on its own". Ugyanez az ok itt is. Egy kifizetett
 * tétel azt bizonyítja, mi szerepelt a banki közleményben — ha holnap javul a
 * dolgozó neve, vagy törlődik az ügy (a `CaseRepo.destroy()` létezik), a
 * bizonyíték nem változhat visszamenőleg. Az előkészítés alatti kötegnél
 * viszont van „frissítés az ügyből", hogy a friss adat se maradjon le.
 *
 * ── Miért külön, csak hozzáfűzhető napló ──────────────────────────────────
 * Az `audit[]` nem a soron belül él, mint a `CaseRepo` `events[]`-e. A
 * legfontosabb naplózandó művelet ugyanis a TÖRLÉS — annak a sorba ágyazott
 * naplója magával a sorral tűnne el. A `BevLogger` sem megoldás: memóriapuffer,
 * az ablak bezárásával elvész.
 *
 * ponytail: ez egy JSON az adatmappában — aki a fájlhoz fér, átírhatja. Nem
 * kriptografikus bizonyíték, hanem „ki mit csinált" visszakövetés jóhiszemű
 * használat mellett. Ha egyszer bizonyító erő kell, a továbblépés hash-lánc
 * vagy külön, csak hozzáfűzhető naplófájl.
 */
const TransferRepo = (() => {

  /** A két jogszabályi díjtétel. A makró is csak ezt a kettőt fogadta el. */
  const AMOUNTS = [26000, 47000];

  /** A magyar belföldi átutalás közlemény-rovata ennyi karakter. */
  const MAX_REF_LEN = 96;

  /** EH12345678  vagy  106-2-12545/2025-T (1..5 jegyű sorszám) */
  const ID_RE = /^(EH\d{8}|106-\d-\d{1,5}\/\d{4}-T)$/;

  const STATUS = { ELOKESZITES: 'elokeszites', KIFIZETVE: 'kifizetve' };

  let backend = null;
  let cache   = null;
  let dirty   = false;
  let saveTimer = null;
  const listeners = new Set();

  // ── Segédfüggvények ────────────────────────────────────────────────────────

  function newId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'atu-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function nowIso() { return new Date().toISOString(); }
  function today()  { return nowIso().slice(0, 10); }

  function currentUserName() {
    try { return (typeof Settings !== 'undefined' && Settings.currentUser()) || 'helyi'; }
    catch { return 'helyi'; }
  }

  function emit() {
    for (const fn of listeners) { try { fn(); } catch { /* egy hibás figyelő ne akassza meg a többit */ } }
  }

  function ensureLoaded() {
    if (!cache) throw new Error('Az átutalások nincsenek betöltve (TransferRepo.load()).');
  }

  function txt(v) { return String(v == null ? '' : v).trim(); }

  /**
   * Dátum ISO alakra — a közleménybe ez megy.
   *
   * A séma magyar MEGJELENÍTÉSI alakot ad vissza („1996.04.23."), a banki
   * közlemény viszont a munkafüzet képlete szerint ÉÉÉÉ-HH-NN. A kettőt
   * összekeverve a közlemény más lenne, mint amit az OIF vár – ezért nem a
   * feloldott, hanem a nyers mezőértékből dolgozunk, és itt normalizálunk.
   */
  function isoDate(v) {
    const s = txt(v);
    if (!s) return '';
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?$/.exec(s);
    if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
    return s;                                  // ismeretlen alak: az ellenőrzés majd kifogásolja
  }

  // ── Betöltés / mentés ──────────────────────────────────────────────────────

  function emptyDb() { return { version: 1, savedAt: null, batches: [], audit: [] }; }

  async function load() {
    if (!backend) throw new Error('Nincs beállított tároló háttér.');
    const raw = await backend.load();
    cache = raw && Array.isArray(raw.batches) ? raw : emptyDb();
    cache.batches = cache.batches.map(migrateBatch);
    if (!Array.isArray(cache.audit)) cache.audit = [];
    dirty = false;
    emit();
    return cache.batches.length;
  }

  function migrateBatch(b) {
    const o = Object.assign({}, b);
    o.id        = o.id || newId();
    o.label     = o.label || today();
    o.status    = o.status === STATUS.KIFIZETVE ? STATUS.KIFIZETVE : STATUS.ELOKESZITES;
    o.paidOn    = o.paidOn || null;
    o.createdAt = o.createdAt || nowIso();
    o.createdBy = o.createdBy || '';
    o.rows      = Array.isArray(o.rows) ? o.rows.map(migrateRow) : [];
    return o;
  }

  function migrateRow(r) {
    const o = Object.assign({}, r);
    o.id          = o.id || newId();
    o.caseId      = o.caseId || '';
    o.employeeId  = o.employeeId || '';
    o.name        = txt(o.name);
    o.personnelNo = txt(o.personnelNo);
    o.dob         = isoDate(o.dob);
    o.nationality = txt(o.nationality);
    o.identifier  = txt(o.identifier);
    o.amount      = Number(o.amount) || 0;
    o.handler     = txt(o.handler);
    return o;
  }

  async function save() {
    ensureLoaded();
    if (!backend) throw new Error('Nincs beállított tároló háttér.');
    cache.savedAt = nowIso();
    await backend.save(cache);
    dirty = false;
    return true;
  }

  function scheduleSave(delayMs = 800) {
    dirty = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      save().catch(err => {
        if (typeof BevLogger !== 'undefined') {
          BevLogger.error('TRANSFER_SAVE', 'Az átutalások mentése nem sikerült', err.message, '');
        }
      });
    }, delayMs);
  }

  async function flush() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (dirty) await save();
  }

  // ── Napló ──────────────────────────────────────────────────────────────────

  /**
   * Naplóbejegyzés. Csak hozzáfűzünk; a felületről nincs törlés rá.
   * A `before`/`after` mezőnkénti módosításnál a régi és az új érték.
   */
  function logAudit(action, adat = {}) {
    ensureLoaded();
    cache.audit.push(Object.assign({
      at:   nowIso(),
      user: currentUserName(),
      action,
    }, adat));
  }

  function audit({ batchId = null } = {}) {
    ensureLoaded();
    const lista = batchId ? cache.audit.filter(a => a.batchId === batchId) : cache.audit;
    return lista.slice().reverse();          // legfrissebb elöl
  }

  // ── Lekérdezés ─────────────────────────────────────────────────────────────

  function all() { ensureLoaded(); return cache.batches.slice(); }

  function get(id) { ensureLoaded(); return cache.batches.find(b => b.id === id) || null; }

  function getRow(batchId, rowId) {
    const b = get(batchId);
    return b ? (b.rows.find(r => r.id === rowId) || null) : null;
  }

  function isOpen(b) { return !!b && b.status === STATUS.ELOKESZITES; }

  function total(b) {
    return (b && b.rows || []).reduce((s, r) => s + (Number(r.amount) || 0), 0);
  }

  /**
   * A nyitott (előkészítés alatti) köteg — ha nincs, létrehozzuk.
   * Egyszerre egy köteg készül: két párhuzamos „bevásárlókosár" csak
   * tévesztésre adna alkalmat.
   */
  function openBatch() {
    ensureLoaded();
    const megvan = cache.batches.find(isOpen);
    return megvan || createBatch();
  }

  function createBatch() {
    ensureLoaded();
    const nap = today();
    const aznap = cache.batches.filter(b => String(b.label).startsWith(nap)).length;
    const b = {
      id: newId(),
      label: `${nap}/${aznap + 1}`,
      status: STATUS.ELOKESZITES,
      paidOn: null,
      createdAt: nowIso(),
      createdBy: currentUserName(),
      rows: [],
    };
    cache.batches.push(b);
    logAudit('batch.create', { batchId: b.id, after: b.label });
    scheduleSave(); emit();
    return b;
  }

  function destroyBatch(id) {
    ensureLoaded();
    const i = cache.batches.findIndex(b => b.id === id);
    if (i === -1) return false;
    const b = cache.batches[i];
    // A napló a törlést is túléli – épp ezért nem a kötegen belül él.
    logAudit('batch.destroy', {
      batchId: id,
      before: `${b.label} · ${b.rows.length} tétel · ${total(b)} Ft · ${b.status}`,
    });
    cache.batches.splice(i, 1);
    scheduleSave(); emit();
    return true;
  }

  // ── Tételek ────────────────────────────────────────────────────────────────

  /**
   * Ügyből tétel: a pillanatkép itt készül.
   *
   * Az azonosító az EH szám, ennek hiányában az iktatószám — a makró is ezt a
   * kettőt fogadta el, és a közleménybe is ez megy.
   */
  function rowFromCase(caseObj, employee, { amount = null, handler = null } = {}) {
    const mezok = (employee && employee.fields) || {};
    let v = mezok;
    try { v = SchemaStore.resolveValues(mezok, 'hu'); } catch { v = mezok; }
    return {
      caseId:      (caseObj && caseObj.id) || '',
      employeeId:  (caseObj && caseObj.employeeId) || (employee && employee.id) || '',
      name:        [v.surname, v.forename].filter(Boolean).join(' '),
      personnelNo: txt(v.personnel_reg_number),
      dob:         isoDate(mezok.date_of_birth || v.date_of_birth),
      nationality: txt(v.citizenship),
      identifier:  txt((caseObj && caseObj.ehNumber) || (caseObj && caseObj.fileNumber)),
      amount:      amount == null ? 0 : Number(amount),
      handler:     handler == null ? currentUserName() : txt(handler),
    };
  }

  function addRow(batchId, adat) {
    ensureLoaded();
    const b = get(batchId);
    if (!b) throw new Error('Nincs ilyen köteg.');
    const r = migrateRow(Object.assign({ id: newId() }, adat));
    b.rows.push(r);
    logAudit('row.add', { batchId, rowId: r.id, after: `${r.name} · ${r.identifier} · ${r.amount} Ft` });
    scheduleSave(); emit();
    return r;
  }

  /**
   * Tétel módosítása — mezőnként naplózva.
   *
   * A hibajavítás a kifizetett kötegben is megengedett (elgépelt név, rossz
   * azonosító), de minden változás nyomot hagy: pont ezért van a napló.
   */
  function updateRow(batchId, rowId, patch) {
    ensureLoaded();
    const r = getRow(batchId, rowId);
    if (!r) throw new Error('Nincs ilyen tétel.');
    for (const [k, ertek] of Object.entries(patch || {})) {
      if (!(k in r) || k === 'id') continue;
      const uj = k === 'amount' ? (Number(ertek) || 0) : txt(ertek);
      if (r[k] === uj) continue;
      logAudit('row.update', { batchId, rowId, field: k, before: r[k], after: uj });
      r[k] = uj;
    }
    scheduleSave(); emit();
    return r;
  }

  function removeRow(batchId, rowId) {
    ensureLoaded();
    const b = get(batchId);
    if (!b) return false;
    const i = b.rows.findIndex(r => r.id === rowId);
    if (i === -1) return false;
    const r = b.rows[i];
    logAudit('row.remove', { batchId, rowId, before: `${r.name} · ${r.identifier} · ${r.amount} Ft` });
    b.rows.splice(i, 1);
    scheduleSave(); emit();
    return true;
  }

  /** Adatok újraolvasása az ügyből — csak előkészítés alatt, kézi kérésre. */
  function refreshRow(batchId, rowId, caseObj, employee) {
    const r = getRow(batchId, rowId);
    if (!r) throw new Error('Nincs ilyen tétel.');
    const friss = rowFromCase(caseObj, employee, { amount: r.amount, handler: r.handler });
    return updateRow(batchId, rowId, {
      name: friss.name, personnelNo: friss.personnelNo, dob: friss.dob,
      nationality: friss.nationality, identifier: friss.identifier,
    });
  }

  // ── Kifizetés ──────────────────────────────────────────────────────────────

  function markPaid(batchId, paidOn) {
    ensureLoaded();
    const b = get(batchId);
    if (!b) throw new Error('Nincs ilyen köteg.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(paidOn || ''))) {
      throw new Error('A kifizetés dátuma éééé-hh-nn alakban kell.');
    }
    if (!b.rows.length) throw new Error('Üres köteget nincs értelme kifizetettnek jelölni.');
    logAudit('batch.paid', { batchId, before: b.status, after: paidOn });
    b.status = STATUS.KIFIZETVE;
    b.paidOn = paidOn;
    scheduleSave(); emit();
    return b;
  }

  function reopen(batchId) {
    ensureLoaded();
    const b = get(batchId);
    if (!b) throw new Error('Nincs ilyen köteg.');
    logAudit('batch.reopen', { batchId, before: b.paidOn, after: null });
    b.status = STATUS.ELOKESZITES;
    b.paidOn = null;
    scheduleSave(); emit();
    return b;
  }

  // ── Közlemény ──────────────────────────────────────────────────────────────

  /**
   * A banki közlemény: „Név ÉÉÉÉ-HH-NN AZONOSÍTÓ".
   *
   * Pontosan az a képlet, ami a munkafüzet I oszlopában állt. Nem tároljuk,
   * mindig a tétel aktuális értékeiből számoljuk – így nem lehet olyan, hogy a
   * közlemény és a sor mást mond.
   */
  function reference(row) {
    if (!row) return '';
    const reszek = [txt(row.name), txt(row.dob), txt(row.identifier)].filter(Boolean);
    return reszek.length === 3 ? reszek.join(' ') : '';
  }

  // ── Ellenőrzés (a makró DataIssues-ának megfelelője) ───────────────────────

  /**
   * Egy tétel hibái. Figyelmeztetések, nem tiltások: a makró is megkérdezte,
   * hogy „mégis?" — hibajavítás közben kell tudni átmenetileg hiányos sort
   * tartani, különben a javítás maga válik lehetetlenné.
   */
  function rowIssues(row) {
    const hibak = [];
    if (!txt(row.name)) hibak.push('a név hiányzik');

    const sz = txt(row.personnelNo);
    if (!sz) hibak.push('a személyi szám hiányzik');
    else if (!/^\d{1,5}$/.test(sz)) hibak.push('a személyi szám legfeljebb 5 számjegy');

    if (!/^\d{4}-\d{2}-\d{2}$/.test(txt(row.dob))) hibak.push('a születési dátum hiányzik vagy hibás');
    if (!txt(row.nationality)) hibak.push('az állampolgárság hiányzik');

    const az = txt(row.identifier).toUpperCase();
    if (!ID_RE.test(az)) hibak.push(`a(z) „${az}" azonosító nem EH######## vagy 106-#-#####/####-T alakú`);

    if (!AMOUNTS.includes(Number(row.amount))) {
      hibak.push(`az összeg csak ${AMOUNTS.map(a => a.toLocaleString('hu-HU')).join(' vagy ')} Ft lehet`);
    }
    if (!txt(row.handler)) hibak.push('az ügyintéző hiányzik');

    const kozl = reference(row);
    if (kozl.length > MAX_REF_LEN) hibak.push(`a közlemény ${kozl.length} karakter (legfeljebb ${MAX_REF_LEN})`);

    return hibak;
  }

  /**
   * A köteg egészének hibái — a soronkéntiek, plusz ami csak együtt látszik:
   * ugyanaz az azonosító kétszer, vagy egy korábbi kötegben már kifizetve.
   */
  function batchIssues(batchId) {
    ensureLoaded();
    const b = get(batchId);
    if (!b) return [];

    const ki = [];
    const szamlalo = new Map();
    for (const r of b.rows) {
      const az = txt(r.identifier).toUpperCase();
      if (az) szamlalo.set(az, (szamlalo.get(az) || 0) + 1);
    }

    b.rows.forEach((r, i) => {
      const hibak = rowIssues(r);
      const az = txt(r.identifier).toUpperCase();
      if (az && szamlalo.get(az) > 1) hibak.push('ez az azonosító többször szerepel a kötegben (dupla fizetés?)');
      if (az && alreadyPaid(az, b.id)) hibak.push('ez az azonosító egy korábbi kötegben már ki lett fizetve');
      if (hibak.length) ki.push({ rowId: r.id, sorszam: i + 1, name: r.name, hibak });
    });
    return ki;
  }

  /** Szerepel-e ez az azonosító egy már KIFIZETETT kötegben? */
  function alreadyPaid(identifier, exceptBatchId = null) {
    ensureLoaded();
    const az = txt(identifier).toUpperCase();
    if (!az) return false;
    return cache.batches.some(b =>
      b.id !== exceptBatchId &&
      b.status === STATUS.KIFIZETVE &&
      b.rows.some(r => txt(r.identifier).toUpperCase() === az));
  }

  /** Szerepel-e ez az ügy BÁRMELYIK kötegben? (a felvevő listához) */
  function caseInAnyBatch(caseId) {
    ensureLoaded();
    for (const b of cache.batches) {
      if (b.rows.some(r => r.caseId === caseId)) {
        return { batchId: b.id, label: b.label, status: b.status };
      }
    }
    return null;
  }

  // ── Tároló háttér ──────────────────────────────────────────────────────────

  function useBackend(b) { backend = b; cache = null; }
  function hasBackend()  { return !!backend; }
  function onChange(fn)  { listeners.add(fn); return () => listeners.delete(fn); }

  function createFileBackend(dirHandle, opts = {}) {
    return EmployeeRepo.createFileBackend(dirHandle,
      Object.assign({ filename: 'docgen-transfers.json' }, opts));
  }

  function createIdbBackend(key = 'transfers') {
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
    AMOUNTS, MAX_REF_LEN, STATUS, ID_RE,
    useBackend, hasBackend, onChange, createFileBackend, createIdbBackend, createMemoryBackend,
    load, save, scheduleSave, flush,
    all, get, getRow, isOpen, total, openBatch, createBatch, destroyBatch,
    rowFromCase, addRow, updateRow, removeRow, refreshRow,
    markPaid, reopen,
    reference, rowIssues, batchIssues, alreadyPaid, caseInAnyBatch,
    audit,
  };
})();
