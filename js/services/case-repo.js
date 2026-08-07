'use strict';

/**
 * Ügyek – tároló réteg.
 *
 * Az ügy alakja:
 *   {
 *     id           belső UUID
 *     employeeId   melyik dolgozóhoz tartozik
 *     type         ügytípus kulcsa (CaseTypes)
 *     status       az ügytípus által megengedett státuszok egyike
 *     ehNumber     EH szám (hatósági ügyszám)
 *     fileNumber   iktatószám
 *     openedAt     indulás (ISO dátum)
 *     triggerDate  a kiváltó tény napja (költözés, munkaviszony kezdete) – ebből
 *                  fut a bejelentési határidő
 *     dueAt        határidő (ISO dátum) – javasolt, de kézzel felülírható
 *     closedAt     lezárás ideje, amíg nyitott: null
 *     outcome      a lezárás eredménye (CaseTypes.outcomes())
 *     producedId   ha az ügy azonosítót hozott: { type, value }
 *     note         szabad szöveg
 *     events[]     { at, status, outcome, note, user, ehNumber, fileNumber }
 *     createdAt / updatedAt / updatedBy
 *   }
 *
 * Miért külön fájlban, nem a dolgozó rekordjában?
 *   Egy dolgozónak évek alatt sok ügye lesz, mindegyik saját eseménytörténettel.
 *   A dolgozó rekordja így korlátlanul hízna, és minden mentés az egészet
 *   újraírná. Külön tárolva az ügyek önállóan is listázhatók (Ügyek fül).
 *
 * Az `events[]` a teljes állapotváltozás-történet: hatósági ügyintézésnél
 * utólag is meg kell tudni mondani, mikor mi történt és ki rögzítette.
 */
const CaseRepo = (() => {

  let backend = null;
  let cache   = null;          // { version, savedAt, cases: [] }
  let dirty   = false;
  let saveTimer = null;
  const listeners = new Set();

  // ── Segédfüggvények ────────────────────────────────────────────────────────

  function newId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'ugy-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function nowIso()  { return new Date().toISOString(); }
  function today()   { return nowIso().slice(0, 10); }

  function currentUserName() {
    try { return (typeof Settings !== 'undefined' && Settings.currentUser()) || 'helyi'; }
    catch { return 'helyi'; }
  }

  function emit() {
    for (const fn of listeners) {
      try { fn(); } catch { /* egy hibás figyelő ne akassza meg a többit */ }
    }
  }

  function ensureLoaded() {
    if (!cache) throw new Error('Az ügyek nincsenek betöltve (CaseRepo.load()).');
  }

  function normText(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().trim();
  }

  // ── Betöltés / mentés ──────────────────────────────────────────────────────

  function emptyDb() { return { version: 1, savedAt: null, cases: [] }; }

  async function load() {
    if (!backend) throw new Error('Nincs beállított tároló háttér.');
    const raw = await backend.load();
    cache = raw && Array.isArray(raw.cases) ? raw : emptyDb();
    cache.cases = cache.cases.map(migrate);
    dirty = false;
    emit();
    return cache.cases.length;
  }

  /** Régebbi alakú ügyek felhozatala – hiányzó mező soha nem hiba. */
  function migrate(c) {
    const o = Object.assign({}, c);
    if (!o.id) o.id = newId();
    o.employeeId = o.employeeId || '';
    o.type       = o.type   || '';
    o.status     = o.status || (o.type ? CaseTypes.firstStatus(o.type) : 'elokeszites');
    o.ehNumber   = o.ehNumber   || '';
    o.fileNumber = o.fileNumber || '';
    o.openedAt   = o.openedAt || today();
    o.triggerDate = o.triggerDate || null;
    o.dueAt      = o.dueAt    || null;
    o.closedAt   = o.closedAt || null;
    o.outcome    = o.outcome  || null;
    o.producedId = o.producedId || null;
    o.note       = o.note || '';
    o.events     = Array.isArray(o.events) ? o.events.map(normalizeEvent) : [];
    o.createdAt  = o.createdAt || nowIso();
    o.updatedAt  = o.updatedAt || o.createdAt;
    o.updatedBy  = o.updatedBy || '';
    return o;
  }

  function normalizeEvent(e) {
    return {
      at:         e.at || nowIso(),
      status:     e.status || '',
      outcome:    e.outcome || null,
      note:       e.note || '',
      user:       e.user || '',
      ehNumber:   e.ehNumber   || '',
      fileNumber: e.fileNumber || '',
    };
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
          BevLogger.error('CASE_SAVE', 'Az ügyek mentése nem sikerült', err.message, '');
        }
      });
    }, delayMs);
  }

  async function flush() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (dirty) await save();
  }

  // ── Lekérdezés ─────────────────────────────────────────────────────────────

  function all() { ensureLoaded(); return cache.cases.slice(); }
  function get(id) { ensureLoaded(); return cache.cases.find(c => c.id === id) || null; }

  /** Egy dolgozó ügyei, legfrissebb elöl. */
  function forEmployee(employeeId, { includeClosed = true } = {}) {
    ensureLoaded();
    return cache.cases
      .filter(c => c.employeeId === employeeId && (includeClosed || !c.closedAt))
      .sort((a, b) => String(b.openedAt).localeCompare(String(a.openedAt)));
  }

  function isOpen(c) { return !c.closedAt; }

  /**
   * Hány nap van a határidőig? Negatív = ennyi napja lejárt.
   * Lezárt ügynél null – ott a határidőnek már nincs jelentése.
   */
  function daysLeft(c, ma = null) {
    if (!c.dueAt || c.closedAt) return null;
    const most = ma ? new Date(ma) : new Date();
    const hat  = new Date(c.dueAt);
    if (isNaN(hat.getTime())) return null;
    // Naptári napokban számolunk, hogy a napszak ne befolyásolja
    const a = Date.UTC(most.getFullYear(), most.getMonth(), most.getDate());
    const b = Date.UTC(hat.getFullYear(), hat.getMonth(), hat.getDate());
    return Math.round((b - a) / 86400000);
  }

  /**
   * Sürgősségi besorolás – ez rendezi az Ügyek fül listáját.
   *
   * Határidő nélküli ügy is teljesen rendben van: bejelentésnél a határidő
   * csak akkor számolható, ha meg van adva a kiváltó tény napja, amit egyedül
   * a felhasználó tud. Ilyenkor 'nyitott' – nem hiányosság, nem hiba.
   */
  function urgency(c, ma = null, surgosNap = 14) {
    if (c.closedAt) return 'lezart';
    const n = daysLeft(c, ma);
    if (n === null) return 'nyitott';
    if (n < 0) return 'lejart';
    if (n <= surgosNap) return 'surgos';
    return 'nyitott';
  }

  /**
   * Tájékoztató-e ennek az ügynek a határideje?
   *
   * A bejelentések határideje egy külső tényből számol (költözés, munkakezdés),
   * amit a program nem ismer és nem tud ellenőrizni – annyit ér, amennyit a
   * beírt dátum. A felület ezért nem állíthatja, hogy mulasztás történt: csak
   * annyit mutathat, hogy a megadott nap szerint ennyi idő van hátra.
   *
   * A kérelmek 70 napos határideje ezzel szemben az ügy megnyitásából számol,
   * amit a program maga tud – arra lehet hivatkozni.
   */
  function isAdvisory(c) {
    return CaseTypes.isAdvisoryDeadline(c.type);
  }

  /** Emberi szöveg a határidőhöz – a felület ezt írja ki. */
  function deadlineText(c, ma = null) {
    if (c.closedAt) return 'Lezárva';
    // Határidő nélküli ügy nem hiányos: a kezdő nap csak akkor derül ki,
    // amikor megjön az iktatószám, illetve amikor tudjuk a tény napját.
    if (!c.dueAt) return `Nincs határidő – add meg: ${CaseTypes.triggerLabel(c.type)}`;
    const n = daysLeft(c, ma);
    const elozetes = isAdvisory(c) ? 'a megadott nap szerint ' : '';
    if (n === null)  return c.dueAt;
    if (n < 0)       return `${elozetes}${-n} napja lejárt`;
    if (n === 0)     return `${elozetes}ma jár le`;
    return `${elozetes}${n} nap van hátra`;
  }

  /** Nyitott ügyek sürgősség szerint, a legégetőbb elöl. */
  function openCases(ma = null) {
    const rang = { lejart: 0, surgos: 1, nyitott: 2 };
    return all()
      .filter(isOpen)
      .sort((a, b) => {
        const ra = rang[urgency(a, ma)], rb = rang[urgency(b, ma)];
        if (ra !== rb) return ra - rb;
        return String(a.dueAt || '9999').localeCompare(String(b.dueAt || '9999'));
      });
  }

  /** Keresés EH számra, iktatószámra és megjegyzésre. */
  function search(text) {
    const needle = normText(text);
    if (!needle) return all();
    return all().filter(c =>
      normText(c.ehNumber).includes(needle) ||
      normText(c.fileNumber).includes(needle) ||
      normText(c.note).includes(needle) ||
      c.events.some(e => normText(e.ehNumber).includes(needle) ||
                         normText(e.fileNumber).includes(needle))
    );
  }

  // ── Idővonal ───────────────────────────────────────────────────────────────

  /**
   * Egy ügy teljes idővonala: ami megtörtént, és ami még hátravan.
   *
   * Négyféle pont kerül rá:
   *   'esemeny'    – ami ténylegesen megtörtént (az events[]-ből)
   *   'ablak'      – a benyújtási ablak három mérföldköve (számított)
   *   'hatarido'   – az ügyintézési határidő
   *   'ma'         – a mai nap, hogy legyen viszonyítási pont
   *
   * Minden pont megkapja, hogy múltbeli, mai vagy jövőbeli – a felület ebből
   * színez. Számított (nem rögzített) pontnál `computed: true`, mert azok nem
   * tények, hanem következtetések: a felhasználónak látnia kell a különbséget.
   */
  function timeline(caseOrId, employeeFields = {}, ma = null) {
    const c = typeof caseOrId === 'string' ? get(caseOrId) : caseOrId;
    if (!c) return [];

    const maNap = (ma ? new Date(ma) : new Date());
    const maIso = CaseTypes.isoDate(maNap);
    const pontok = [];

    // 1. Ami megtörtént
    for (const e of c.events) {
      const nap = String(e.at).slice(0, 10);
      pontok.push({
        kind: 'esemeny',
        date: nap,
        at: e.at,
        label: CaseTypes.statusLabel(c.type, e.status) || e.status,
        note: e.note || '',
        user: e.user || '',
        outcome: e.outcome || null,
        ehNumber: e.ehNumber || '',
        fileNumber: e.fileNumber || '',
        computed: false,
      });
    }

    // 2. Benyújtási ablak – csak ha az engedély lejárata ismert
    const ablak = CaseTypes.submissionWindow(c.type, employeeFields);
    if (ablak) {
      pontok.push({ kind: 'ablak', date: ablak.earliest, computed: true,
        label: 'Benyújtás legkorábban', windowRole: 'earliest',
        note: 'Ennél korábban nem fogadják be' });
      pontok.push({ kind: 'ablak', date: ablak.latest, computed: true,
        label: 'Benyújtás ajánlott határnapja', windowRole: 'latest',
        note: 'Eddig érdemes beadni' });
      pontok.push({ kind: 'ablak', date: ablak.final, computed: true,
        label: 'Benyújtás legvégső napja', windowRole: 'final',
        note: 'Az utolsó nap, amikor még beadható' });
      pontok.push({ kind: 'ablak', date: ablak.basis, computed: true,
        label: 'A jelenlegi engedély lejár', windowRole: 'basis' });
    }

    // 3. Ügyintézési határidő
    if (c.dueAt) {
      pontok.push({
        kind: 'hatarido', date: c.dueAt, computed: true,
        label: isAdvisory(c) ? 'Határidő (tájékoztató)' : 'Ügyintézési határidő',
        note: c.triggerDate
          ? `${CaseTypes.triggerLabel(c.type)}: ${c.triggerDate}`
          : '',
        advisory: isAdvisory(c),
      });
    }

    // 4. A mai nap – csak nyitott ügynél, viszonyítási pontnak
    if (!c.closedAt) {
      pontok.push({ kind: 'ma', date: maIso, computed: false, label: 'Ma' });
    }

    // Időrend; azonos napon az esemény előbb, mint a számított pont
    const rang = { esemeny: 0, ma: 1, hatarido: 2, ablak: 3 };
    pontok.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return (rang[a.kind] ?? 9) - (rang[b.kind] ?? 9);
    });

    for (const p of pontok) {
      p.state = p.date < maIso ? 'mult' : (p.date === maIso ? 'ma' : 'jovo');
    }
    return pontok;
  }

  /**
   * A benyújtási ablak összefoglalója – ez kerül a kártya tetejére.
   * `null`, ha az ügytípusnak nincs ablaka vagy az engedély lejárata hiányzik.
   */
  function submissionStatus(caseOrId, employeeFields = {}, ma = null) {
    const c = typeof caseOrId === 'string' ? get(caseOrId) : caseOrId;
    if (!c) return null;
    const ablak = CaseTypes.submissionWindow(c.type, employeeFields);
    if (!ablak) return null;

    const fazis = CaseTypes.windowPhase(ablak, ma);
    const maIso = CaseTypes.isoDate(ma ? new Date(ma) : new Date());
    const napokig = d => {
      const a = new Date(maIso), b = new Date(d);
      return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
                         Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
    };

    // Beadás után az ablaknak már nincs jelentősége
    const beadva = c.events.some(e => e.status && e.status !== 'elokeszites');

    const szoveg = {
      korai:   () => `Még nem adható be – ${napokig(ablak.earliest)} nap múlva nyílik`,
      idealis: () => `Beadható – ajánlott ${napokig(ablak.latest)} napon belül`,
      siess:   () => `Sürgős: még ${napokig(ablak.final)} nap, utána nem adható be`,
      lekesve: () => `A benyújtási határidő ${-napokig(ablak.final)} napja lejárt`,
    }[fazis];

    return {
      window: ablak,
      phase: fazis,
      text: beadva ? 'Beadva – az ablak már nem releváns' : szoveg(),
      done: beadva,
    };
  }

  // ── Módosítás ──────────────────────────────────────────────────────────────

  function validate(c) {
    const gondok = [];
    if (!c.employeeId) gondok.push('Az ügy nincs dolgozóhoz rendelve.');
    if (!c.type) gondok.push('Nincs megadva ügytípus.');
    else if (!CaseTypes.byKey(c.type)) gondok.push(`Ismeretlen ügytípus: ${c.type}.`);
    else if (!CaseTypes.statusesOf(c.type).some(s => s.key === c.status)) {
      gondok.push(`A(z) „${c.status}" státusz nem tartozik ehhez az ügytípushoz.`);
    }
    return gondok;
  }

  /**
   * Új ügy. A határidő javaslata a típusból és a dolgozó adataiból jön
   * (kérelmeknél alapból 70 nap), de a hívó felülírhatja.
   */
  function create({ employeeId, type, dueAt, ehNumber = '', fileNumber = '',
                    note = '', openedAt = null,
                    triggerDate = null } = {}) {
    ensureLoaded();
    const indul = openedAt || today();
    const c = {
      id: newId(),
      employeeId,
      type,
      status: type ? CaseTypes.firstStatus(type) : 'elokeszites',
      ehNumber: String(ehNumber || '').trim(),
      fileNumber: String(fileNumber || '').trim(),
      openedAt: indul,
      triggerDate: triggerDate || null,
      dueAt: dueAt !== undefined && dueAt !== null
        ? dueAt
        : CaseTypes.suggestDueDate(type, triggerDate),
      closedAt: null,
      outcome: null,
      producedId: null,
      note: String(note || ''),
      events: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
      updatedBy: currentUserName(),
    };

    const gondok = validate(c);
    if (gondok.length) throw new Error(gondok.join(' '));

    c.events.push(normalizeEvent({
      at: nowIso(), status: c.status, note: 'Ügy megnyitva',
      user: c.updatedBy, ehNumber: c.ehNumber, fileNumber: c.fileNumber,
    }));

    cache.cases.push(c);
    scheduleSave();
    emit();
    return c;
  }

  /**
   * Az ügy törzsadatainak módosítása (határidő, EH szám, iktatószám, megjegyzés,
   * kiváltó dátum).
   *
   * Ha a kiváltó dátum változik és a határidőt nem írták felül kézzel, a
   * határidő magától újraszámolódik – különben egy elgépelt költözési dátum
   * javítása után a határidő a régi, hibás értéken maradna.
   */
  function update(id, { dueAt, ehNumber, fileNumber, note, type, triggerDate } = {}) {
    ensureLoaded();
    const c = get(id);
    if (!c) throw new Error('Nincs ilyen ügy.');

    const next = Object.assign({}, c);
    if (triggerDate !== undefined) {
      next.triggerDate = triggerDate || null;
      // A kezdő nap rögzítésekor (pl. megjött az iktatószám) magától
      // kiszámoljuk a határidőt – kivéve ha azt kézzel felülírták.
      if (dueAt === undefined) {
        next.dueAt = CaseTypes.suggestDueDate(next.type, next.triggerDate);
      }
    }
    if (dueAt !== undefined)      next.dueAt = dueAt || null;
    if (ehNumber !== undefined)   next.ehNumber = String(ehNumber || '').trim();
    if (fileNumber !== undefined) next.fileNumber = String(fileNumber || '').trim();
    if (note !== undefined)       next.note = String(note || '');
    if (type !== undefined && type !== c.type) {
      next.type = type;
      // Típusváltáskor a régi státusz értelmetlenné válhat
      if (!CaseTypes.statusesOf(type).some(s => s.key === next.status)) {
        next.status = CaseTypes.firstStatus(type);
      }
    }

    const gondok = validate(next);
    if (gondok.length) throw new Error(gondok.join(' '));

    Object.assign(c, next, { updatedAt: nowIso(), updatedBy: currentUserName() });
    scheduleSave();
    emit();
    return c;
  }

  /**
   * Státuszváltás – ez a fő művelet.
   *
   * Záró státuszba lépéshez KELL kimenetel: enélkül utólag nem lehetne
   * megmondani, hogy az ügy megadással vagy elutasítással zárult. A hatósági
   * ügyintézésnél pont ez a legfontosabb adat.
   */
  function setStatus(id, status, { note = '', outcome = null,
                                   ehNumber, fileNumber } = {}) {
    ensureLoaded();
    const c = get(id);
    if (!c) throw new Error('Nincs ilyen ügy.');

    const megengedett = CaseTypes.statusesOf(c.type).map(s => s.key);
    if (!megengedett.includes(status)) {
      throw new Error(`A(z) „${status}" státusz nem tartozik ehhez az ügytípushoz.`);
    }

    const zaro = CaseTypes.isTerminal(c.type, status);
    if (zaro && !outcome) {
      throw new Error('Lezáráshoz meg kell adni a kimenetelt (megadva, elutasítva, megszüntetve…).');
    }
    if (outcome && !CaseTypes.outcomes().some(o => o.key === outcome)) {
      throw new Error(`Ismeretlen kimenetel: ${outcome}.`);
    }

    if (ehNumber !== undefined)   c.ehNumber = String(ehNumber || '').trim();
    if (fileNumber !== undefined) c.fileNumber = String(fileNumber || '').trim();

    c.status   = status;
    c.outcome  = zaro ? outcome : null;
    c.closedAt = zaro ? nowIso() : null;
    c.updatedAt = nowIso();
    c.updatedBy = currentUserName();

    c.events.push(normalizeEvent({
      at: nowIso(), status, outcome: c.outcome, note,
      user: c.updatedBy, ehNumber: c.ehNumber, fileNumber: c.fileNumber,
    }));

    scheduleSave();
    emit();
    return c;
  }

  /** Esemény rögzítése státuszváltás nélkül (pl. „telefonon érdeklődtem"). */
  function addEvent(id, { note = '', ehNumber, fileNumber } = {}) {
    ensureLoaded();
    const c = get(id);
    if (!c) throw new Error('Nincs ilyen ügy.');
    if (!String(note).trim() && ehNumber === undefined && fileNumber === undefined) {
      throw new Error('Üres eseményt nem rögzítünk.');
    }
    if (ehNumber !== undefined)   c.ehNumber = String(ehNumber || '').trim();
    if (fileNumber !== undefined) c.fileNumber = String(fileNumber || '').trim();

    c.events.push(normalizeEvent({
      at: nowIso(), status: c.status, note,
      user: currentUserName(), ehNumber: c.ehNumber, fileNumber: c.fileNumber,
    }));
    c.updatedAt = nowIso();
    c.updatedBy = currentUserName();
    scheduleSave();
    emit();
    return c;
  }

  /**
   * A lezárt ügy által hozott azonosító rögzítése.
   *
   * Itt zárul be a kör az azonosító-történettel: az új engedélyszám bekerül a
   * dolgozóhoz (a régi automatikusan lezárul), az ügy pedig megjegyzi, hogy ő
   * hozta. Így utólag megválaszolható, melyik kérelemből származik egy szám.
   */
  function recordProducedIdentifier(id, { type, value, validFrom = null } = {}) {
    ensureLoaded();
    const c = get(id);
    if (!c) throw new Error('Nincs ilyen ügy.');
    const ertek = String(value || '').trim();
    if (!ertek) throw new Error('Az azonosító értéke nem lehet üres.');

    const tipus = type || (CaseTypes.byKey(c.type) || {}).producesIdentifier;
    if (!tipus) throw new Error('Ez az ügytípus nem hoz azonosítót.');

    EmployeeRepo.addIdentifier(c.employeeId, {
      type: tipus, value: ertek, validFrom: validFrom || today(), current: true,
    });

    c.producedId = { type: tipus, value: ertek };
    c.updatedAt  = nowIso();
    c.updatedBy  = currentUserName();
    c.events.push(normalizeEvent({
      at: nowIso(), status: c.status,
      note: `Új azonosító rögzítve: ${ertek}`,
      user: c.updatedBy, ehNumber: c.ehNumber, fileNumber: c.fileNumber,
    }));
    scheduleSave();
    emit();
    return c;
  }

  function destroy(id) {
    ensureLoaded();
    const i = cache.cases.findIndex(c => c.id === id);
    if (i === -1) return false;
    cache.cases.splice(i, 1);
    scheduleSave();
    emit();
    return true;
  }

  /** Egy dolgozó törlésekor az ügyei is mennek – ne maradjanak árván. */
  function destroyForEmployee(employeeId) {
    ensureLoaded();
    const elotte = cache.cases.length;
    cache.cases = cache.cases.filter(c => c.employeeId !== employeeId);
    const torolt = elotte - cache.cases.length;
    if (torolt) { scheduleSave(); emit(); }
    return torolt;
  }

  /**
   * Javaslat: kinek jár le hamarosan az engedélye anélkül, hogy nyitott
   * meghosszabbítási ügye lenne. Nem hoz létre semmit – felvet.
   */
  function suggestRenewals(employees, { belul = 30, ma = null } = {}) {
    ensureLoaded();
    const most = ma ? new Date(ma) : new Date();
    const out = [];
    for (const emp of employees) {
      const lejar = emp.fields && emp.fields.expiration_of_rp;
      if (!lejar) continue;
      const d = new Date(lejar);
      if (isNaN(d.getTime())) continue;
      const nap = Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) -
                              Date.UTC(most.getFullYear(), most.getMonth(), most.getDate())) / 86400000);
      if (nap > belul) continue;
      const vanNyitott = cache.cases.some(c =>
        c.employeeId === emp.id && !c.closedAt && c.type === 'rp_hosszabbitas');
      if (!vanNyitott) out.push({ employee: emp, expiresAt: lejar, daysLeft: nap });
    }
    return out.sort((a, b) => a.daysLeft - b.daysLeft);
  }

  // ── Tároló háttér ──────────────────────────────────────────────────────────

  function useBackend(b) { backend = b; cache = null; }
  function hasBackend()  { return !!backend; }
  function onChange(fn)  { listeners.add(fn); return () => listeners.delete(fn); }

  function createFileBackend(dirHandle, opts = {}) {
    return EmployeeRepo.createFileBackend(dirHandle,
      Object.assign({ filename: 'docgen-cases.json' }, opts));
  }

  /** Tartalék háttér, ha nincs kiválasztott adatmappa (ez az indulási alapeset). */
  function createIdbBackend(key = 'cases') {
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
    useBackend, hasBackend, onChange, createFileBackend, createIdbBackend, createMemoryBackend,
    load, save, scheduleSave, flush,
    all, get, forEmployee, isOpen, daysLeft, urgency, isAdvisory, deadlineText, openCases, search,
    timeline, submissionStatus,
    create, update, setStatus, addEvent, recordProducedIdentifier,
    destroy, destroyForEmployee, suggestRenewals,
    _validate: validate,
  };
})();
