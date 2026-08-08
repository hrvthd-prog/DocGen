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
 *     events[]     { at, occurredAt, status, outcome, note, user, ehNumber, fileNumber }
 *                  at = mikor rögzítettük (audit), occurredAt = mikor történt
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

  /**
   * Azonosító-típus → az a séma-mező, ami az érvényességét tárolja.
   *
   * Az EmployeeRepo.IDENTIFIER_FIELD_MAP a SZÁMOT tükrözi a mezőbe; ez a
   * lejáratot. A kettő külön oszlop az adatbekérőben, és a benyújtási ablak
   * ez utóbbiból számol.
   */
  const EXPIRY_FIELD_MAP = {
    residence_permit: 'expiration_of_rp',
    passport:         'pp_validity',
  };

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

  /**
   * Két időpont, és ez nem szőrszálhasogatás:
   *
   *   at         – mikor RÖGZÍTETTÜK. Audit-adat: sosem írjuk felül, ebből
   *                derül ki, hogy egy bejegyzés utólag került-e be.
   *   occurredAt – mikor TÖRTÉNT. Ezt adja meg a felhasználó, és az idővonal
   *                ez szerint rendez.
   *
   * A kettő gyakran eltér: a hiánypótlási felhívás múlt kedden érkezett, de
   * csak ma jutunk hozzá, hogy felvigyük. Ha csak a rögzítés ideje lenne meg,
   * az idővonal a gépelés sorrendjét mutatná a történések helyett – vagyis
   * pont azt nem tudná, amiért az egészet építjük.
   */
  function normalizeEvent(e) {
    const at = e.at || nowIso();
    return {
      at,
      occurredAt: (e.occurredAt || at).slice(0, 10),
      status:     e.status || '',
      outcome:    e.outcome || null,
      note:       e.note || '',
      user:       e.user || '',
      ehNumber:   e.ehNumber   || '',
      fileNumber: e.fileNumber || '',
    };
  }

  /** Utólag rögzített-e a bejegyzés? (a történés és a rögzítés napja eltér) */
  function isBackdated(e) {
    return !!(e.occurredAt && e.at && e.occurredAt !== String(e.at).slice(0, 10));
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
      const nap = e.occurredAt || String(e.at).slice(0, 10);
      pontok.push({
        kind: 'esemeny',
        date: nap,
        at: e.at,
        recordedAt: String(e.at).slice(0, 10),
        backdated: isBackdated(e),
        eventIndex: c.events.indexOf(e),
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
      at: nowIso(), occurredAt: indul, status: c.status, note: 'Ügy megnyitva',
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
                                   ehNumber, fileNumber, occurredAt = null } = {}) {
    ensureLoaded();
    const c = get(id);
    if (!c) throw new Error('Nincs ilyen ügy.');
    if (occurredAt && occurredAt > today()) {
      throw new Error('A történés napja nem lehet a jövőben.');
    }

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
    // A lezárás dátuma is a TÖRTÉNÉS napja: ha a döntés múlt héten érkezett,
    // az ügy akkor zárult le, nem ma.
    c.closedAt = zaro ? (occurredAt || today()) : null;
    c.updatedAt = nowIso();
    c.updatedBy = currentUserName();

    c.events.push(normalizeEvent({
      at: nowIso(), occurredAt, status, outcome: c.outcome, note,
      user: c.updatedBy, ehNumber: c.ehNumber, fileNumber: c.fileNumber,
    }));

    scheduleSave();
    emit();
    return c;
  }

  /** Esemény rögzítése státuszváltás nélkül (pl. „telefonon érdeklődtem"). */
  function addEvent(id, { note = '', ehNumber, fileNumber, occurredAt = null } = {}) {
    ensureLoaded();
    const c = get(id);
    if (!c) throw new Error('Nincs ilyen ügy.');
    if (!String(note).trim() && ehNumber === undefined && fileNumber === undefined) {
      throw new Error('Üres eseményt nem rögzítünk.');
    }
    if (occurredAt && occurredAt > today()) {
      throw new Error('A történés napja nem lehet a jövőben.');
    }
    if (ehNumber !== undefined)   c.ehNumber = String(ehNumber || '').trim();
    if (fileNumber !== undefined) c.fileNumber = String(fileNumber || '').trim();

    c.events.push(normalizeEvent({
      at: nowIso(), occurredAt, status: c.status, note,
      user: currentUserName(), ehNumber: c.ehNumber, fileNumber: c.fileNumber,
    }));
    c.updatedAt = nowIso();
    c.updatedBy = currentUserName();
    scheduleSave();
    emit();
    return c;
  }

  /**
   * Meglévő bejegyzés javítása – elgépelt dátum vagy megjegyzés.
   *
   * A rögzítés ideje (`at`) és a rögzítő szándékosan NEM módosítható: az az
   * audit-nyom. Csak azt írjuk át, amit a felhasználó eredetileg is megadott.
   */
  function updateEvent(id, index, { occurredAt, note } = {}) {
    ensureLoaded();
    const c = get(id);
    if (!c) throw new Error('Nincs ilyen ügy.');
    const e = c.events[index];
    if (!e) throw new Error('Nincs ilyen bejegyzés.');

    if (occurredAt !== undefined) {
      const nap = String(occurredAt || '').slice(0, 10);
      if (!nap) throw new Error('A történés napja nem lehet üres.');
      if (nap > today()) throw new Error('A történés napja nem lehet a jövőben.');
      e.occurredAt = nap;
      // Ha a lezáró bejegyzést javítjuk, a lezárás dátuma is követi
      if (e.outcome && c.closedAt) c.closedAt = nap;
    }
    if (note !== undefined) e.note = String(note || '');

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
  function recordProducedIdentifier(id, { type, value, validFrom = null,
                                          expiresAt = null } = {}) {
    ensureLoaded();
    const c = get(id);
    if (!c) throw new Error('Nincs ilyen ügy.');
    const ertek = String(value || '').trim();
    if (!ertek) throw new Error('Az azonosító értéke nem lehet üres.');

    const tipus = type || (CaseTypes.byKey(c.type) || {}).producesIdentifier;
    if (!tipus) throw new Error('Ez az ügytípus nem hoz azonosítót.');

    EmployeeRepo.addIdentifier(c.employeeId, {
      type: tipus, value: ertek, validFrom: validFrom || today(),
      validTo: expiresAt || null, current: true,
    });

    // Az ÚJ engedély lejárata a dolgozó adatai közé is bekerül – enélkül a
    // következő meghosszabbítás benyújtási ablaka a RÉGI, már lejárt engedély
    // dátumából számolna, és azonnal „lekésve" állapotot mutatna.
    if (expiresAt && EXPIRY_FIELD_MAP[tipus]) {
      EmployeeRepo.update(c.employeeId, {
        fields: { [EXPIRY_FIELD_MAP[tipus]]: expiresAt },
      });
    }

    c.producedId = { type: tipus, value: ertek, expiresAt: expiresAt || null };
    c.updatedAt  = nowIso();
    c.updatedBy  = currentUserName();
    c.events.push(normalizeEvent({
      at: nowIso(), occurredAt: validFrom || today(), status: c.status,
      note: `Új azonosító rögzítve: ${ertek}` + (expiresAt ? ` (érvényes: ${expiresAt})` : ''),
      user: c.updatedBy, ehNumber: c.ehNumber, fileNumber: c.fileNumber,
    }));
    scheduleSave();
    emit();
    return c;
  }

  /**
   * A következő ügy előjegyzése a most lezárult alapján.
   *
   * A meghosszabbítás nem egyszeri esemény, hanem ciklus: amint megvan az új
   * engedély, azonnal ismert, mikor nyílik a következő benyújtási ablak.
   * Ezt egy kattintással láncba fűzzük, hogy ne kelljen évek múlva emlékezni rá.
   *
   * Az új ügy `openedAt`-je a következő ablak legkorábbi napja – nem a mai –,
   * mert az ügy valójában akkor kezdődik.
   */
  function openNextCase(id, { type = 'rp_hosszabbitas' } = {}) {
    ensureLoaded();
    const c = get(id);
    if (!c) throw new Error('Nincs ilyen ügy.');

    const mezok = (EmployeeRepo.get(c.employeeId) || {}).fields || {};
    const ablak = CaseTypes.submissionWindow(type, mezok);
    if (!ablak) {
      throw new Error('Nem ismert az új engedély lejárata – előbb rögzítsd azt.');
    }

    const uj = create({
      employeeId: c.employeeId,
      type,
      openedAt: ablak.earliest,
      note: `Előjegyezve a(z) ${CaseTypes.label(c.type)} lezárása után.`,
    });
    return uj;
  }

  /**
   * Napi összefoglaló – ez kerül a fül címkéjére.
   *
   * Csak a lejárt ügyek számítanak jelzésnek: ha minden számot kiírnánk, a
   * jelzés zajjá válna, és pár nap alatt megszoknánk, hogy mindig ott van.
   */
  function summary(ma = null) {
    ensureLoaded();
    let lejart = 0, surgos = 0, nyitott = 0;
    for (const c of cache.cases) {
      const s = urgency(c, ma);
      if (s === 'lejart')  lejart++;
      if (s === 'surgos')  surgos++;
      if (s !== 'lezart')  nyitott++;
    }
    return { lejart, surgos, nyitott };
  }

  /** Van-e már előjegyezve következő ügy ehhez a dolgozóhoz? */
  function hasOpenCaseOfType(employeeId, type) {
    ensureLoaded();
    return cache.cases.some(c => c.employeeId === employeeId && c.type === type && !c.closedAt);
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
    create, update, setStatus, addEvent, updateEvent, recordProducedIdentifier,
    openNextCase, hasOpenCaseOfType, isBackdated, summary, EXPIRY_FIELD_MAP,
    destroy, destroyForEmployee, suggestRenewals,
    _validate: validate,
  };
})();
