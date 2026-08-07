'use strict';

/**
 * Ügytípusok – adatként, nem kódban.
 *
 * Ugyanaz az elv, mint a mezősémánál: a típusokat, státuszokat és határidőket
 * a felületről lehet szerkeszteni, a kód csak értelmezi őket. Ha egy eljárás
 * megváltozik, típust szerkesztünk, nem kódot írunk.
 *
 * Az itteni lista SEED adat – az élő definíciók a data/docgen-config.json-ban
 * élnek, és a CaseTypes.loadFrom() tölti be őket.
 */

/** Az ügy kimenete – ez zárja le, és ezt kell tudni visszakeresni. */
const CASE_OUTCOMES = [
  { key: 'megadva',        label: 'Megadva',                          positive: true },
  { key: 'elutasitva',     label: 'Elutasítva' },
  // Az eljárás lezárul anélkül, hogy a hatóság a kérelem tartalmát vizsgálta
  // volna (pl. a kérelmező visszavonta, vagy okafogyottá vált).
  { key: 'megszuntetve',   label: 'Megszüntetve' },
  // Formai okból elutasított kérelem – nem a tartalma miatt bukott el, ezért
  // gyakran ismételten benyújtható. Külön kell látszania az elutasítástól.
  { key: 'elutasitva_ervn', label: 'Elutasítva érdemi vizsgálat nélkül' },
  { key: 'visszavonva',    label: 'Visszavonva (általunk)' },
];

/**
 * Kérelmek ügyintézési határideje: az összevont kérelmezési eljárásban
 * előterjesztett kérelmekben az idegenrendészeti hatóságnak 70 napon belül
 * kell döntést hoznia.
 *
 * Kiinduló érték: ügyenként felülírható, mert a hatóság az eljárást
 * felfüggesztheti vagy meghosszabbíthatja.
 */
const DEFAULT_APPLICATION_DAYS = 70;

/**
 * MINDEN határidő egy kézzel rögzített naptól fut – egy sincs, amit a program
 * magától tudna.
 *
 *   kérelem     → az OIF általi érkeztetés napja (amikor az iktatószám
 *                 megérkezik). A 70 nap az érkeztetés napját KÖVETŐ naptól
 *                 indul, ezért a lejárat az érkeztetés + 70. nap: az első nap
 *                 az érkeztetés + 1, és a hetvenedik így az érkeztetés + 70.
 *   bejelentés  → a tény bekövetkezésének napja (költözés, munkaviszony
 *                 kezdete vagy megszűnése).
 *
 * Ebből következik a legfontosabb szabály: kezdő dátum nélkül NINCS határidő.
 * Kitalálni egyet az ügy megnyitásából félrevezetés lenne – a program nem
 * tudja, mikor érkeztette az OIF a kérelmet, sem azt, mikor költözött a
 * dolgozó.
 */

/**
 * Mennyire megbízható a határidő:
 *
 *   'hatosagi'   – a hatóság saját ügyintézési határideje, dokumentált naptól
 *                  (az érkeztetés napja az iktatószámmal igazolható). Erre
 *                  lehet hivatkozni.
 *
 *   'tajekoztato' – olyan tényből számol, amit sem a program, sem irat nem
 *                  igazol (mikor költözött a dolgozó). Annyit ér, amennyit a
 *                  beírt dátum, ezért a felület nem állíthatja, hogy mulasztás
 *                  történt – csak azt, hogy a megadott nap szerint mennyi
 *                  van hátra.
 */
const DEADLINE_KIND = { AUTHORITY: 'hatosagi', ADVISORY: 'tajekoztato' };

/** Kérelmekre közös státuszsor – a kimenet a lezáráskor derül ki. */
function applicationStatuses() {
  return [
    { key: 'elokeszites', label: 'Előkészítés' },
    { key: 'beadva',      label: 'Beadva' },
    { key: 'hianypotlas', label: 'Hiánypótlás', alert: true },
    { key: 'elbiralas',   label: 'Elbírálás alatt' },
    { key: 'lezarva',     label: 'Lezárva', terminal: true },
  ];
}

/** Bejelentéseknél nincs elbírálás – vagy megtörtént, vagy nem. */
function notificationStatuses() {
  return [
    { key: 'elokeszites', label: 'Előkészítés' },
    { key: 'beadva',      label: 'Benyújtva' },
    { key: 'lezarva',     label: 'Tudomásul véve', terminal: true },
  ];
}

const SEED_CASE_TYPES = {
  version: 1,
  types: [
    // ── Kérelmek ────────────────────────────────────────────────────────────
    {
      key: 'rp_elso',
      kind: 'kerelem',
      label: { hu: 'Tartózkodási engedély – első kérelem', en: 'Residence permit – first application' },
      triggerLabel: 'OIF érkeztetés napja (iktatószám megkapása)',
      statuses: applicationStatuses(),
      defaultDurationDays: DEFAULT_APPLICATION_DAYS,
      deadlineKind: DEADLINE_KIND.AUTHORITY,
      producesIdentifier: 'residence_permit',
      templates: [],
    },
    {
      key: 'rp_hosszabbitas',
      kind: 'kerelem',
      label: { hu: 'Tartózkodási engedély meghosszabbítása', en: 'Residence permit extension' },
      triggerLabel: 'OIF érkeztetés napja (iktatószám megkapása)',
      statuses: applicationStatuses(),
      defaultDurationDays: DEFAULT_APPLICATION_DAYS,
      deadlineKind: DEADLINE_KIND.AUTHORITY,
      producesIdentifier: 'residence_permit',
      templates: [],
    },
    {
      key: 'letelepedes',
      kind: 'kerelem',
      label: { hu: 'Letelepedési engedély', en: 'Settlement permit' },
      triggerLabel: 'OIF érkeztetés napja (iktatószám megkapása)',
      statuses: applicationStatuses(),
      defaultDurationDays: DEFAULT_APPLICATION_DAYS,
      deadlineKind: DEADLINE_KIND.AUTHORITY,
      producesIdentifier: 'residence_permit',
      templates: [],
    },

    // ── Bejelentések ────────────────────────────────────────────────────────
    // A határidő a TÉNY BEKÖVETKEZÉSÉTŐL fut, nem az ügy megnyitásától.
    {
      key: 'szallashely_valtozas',
      kind: 'bejelentes',
      label: { hu: 'Szálláshely-változás bejelentése', en: 'Change of accommodation' },
      triggerLabel: 'Költözés napja',
      statuses: notificationStatuses(),
      defaultDurationDays: 3,
      deadlineKind: DEADLINE_KIND.ADVISORY,
      templates: [],
    },
    {
      key: 'munkaviszony_bejelentes',
      kind: 'bejelentes',
      label: { hu: 'Munkaviszony megkezdésének bejelentése', en: 'Registration of employment' },
      triggerLabel: 'Munkaviszony kezdete',
      statuses: notificationStatuses(),
      defaultDurationDays: 5,
      deadlineKind: DEADLINE_KIND.ADVISORY,
      templates: [],
    },
    {
      key: 'munkaviszony_kijelentes',
      kind: 'bejelentes',
      label: { hu: 'Munkaviszony megszűnésének bejelentése', en: 'Deregistration of employment' },
      triggerLabel: 'Munkaviszony megszűnése',
      statuses: notificationStatuses(),
      defaultDurationDays: 5,
      deadlineKind: DEADLINE_KIND.ADVISORY,
      templates: [],
    },
    {
      key: 'adatvaltozas',
      kind: 'bejelentes',
      label: { hu: 'Adatváltozás bejelentése', en: 'Notification of data change' },
      triggerLabel: 'Változás napja',
      statuses: notificationStatuses(),
      // FIGYELEM: ez a nap-szám nincs megerősítve jogszabállyal – a 3 és az 5
      // napot igen. A Beállításokban átírható, ha kiderül a pontos érték.
      defaultDurationDays: 5,
      deadlineKind: DEADLINE_KIND.ADVISORY,
      templates: [],
    },
  ],
};

const CaseTypes = (() => {

  let backend = null;
  let data = null;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function useBackend(b) { backend = b; data = null; }

  function loadFrom(raw) {
    data = normalize(raw && raw.types ? raw : SEED_CASE_TYPES);
    return data;
  }

  async function load() {
    let raw = null;
    if (backend) { try { raw = await backend.load(); } catch { raw = null; } }
    return loadFrom(raw);
  }

  async function save() {
    if (!backend) return false;
    await backend.save(clone(get()));
    return true;
  }

  /**
   * Hiányzó rész sosem hiba: a típus akkor is használható marad, ha egy régebbi
   * konfigurációból tölt be, és még nem ismer valamely új mezőt.
   */
  function normalize(raw) {
    const out = { version: Number(raw.version) || 1, types: [] };
    const latott = new Set();

    for (const t of (raw.types || [])) {
      if (!t || !t.key || latott.has(t.key)) continue;
      latott.add(t.key);

      const kind = t.kind === 'bejelentes' ? 'bejelentes' : 'kerelem';
      const statuses = (Array.isArray(t.statuses) && t.statuses.length)
        ? t.statuses.map(s => ({
            key:      String(s.key),
            label:    s.label || String(s.key),
            alert:    !!s.alert,
            terminal: !!s.terminal,
          }))
        : (kind === 'bejelentes' ? notificationStatuses() : applicationStatuses());

      // Záró státusz nélkül az ügy sosem lenne lezárható – az utolsót tesszük azzá.
      if (!statuses.some(s => s.terminal)) statuses[statuses.length - 1].terminal = true;

      out.types.push({
        key:   String(t.key),
        kind,
        label: { hu: (t.label && t.label.hu) || String(t.key),
                 en: (t.label && t.label.en) || '' },
        // Mit kérdezzen a felület a határidő kezdő napjánál – típusonként más
        // („OIF érkeztetés napja", „Költözés napja")
        triggerLabel: t.triggerLabel ||
          (kind === 'kerelem' ? 'OIF érkeztetés napja (iktatószám megkapása)'
                              : 'A tény bekövetkezésének napja'),
        statuses,
        defaultDurationDays: Number(t.defaultDurationDays) > 0
          ? Number(t.defaultDurationDays)
          : (kind === 'kerelem' ? DEFAULT_APPLICATION_DAYS : 5),
        deadlineKind: t.deadlineKind === DEADLINE_KIND.ADVISORY
          ? DEADLINE_KIND.ADVISORY
          : (t.deadlineKind === DEADLINE_KIND.AUTHORITY
              ? DEADLINE_KIND.AUTHORITY
              : (kind === 'bejelentes' ? DEADLINE_KIND.ADVISORY : DEADLINE_KIND.AUTHORITY)),
        producesIdentifier: t.producesIdentifier || null,
        templates: Array.isArray(t.templates) ? t.templates.slice() : [],
      });
    }
    return out;
  }

  function get() {
    if (!data) loadFrom(null);
    return data;
  }

  function all()       { return get().types.slice(); }
  function version()   { return get().version; }
  function byKey(key)  { return get().types.find(t => t.key === key) || null; }
  function label(key)  { const t = byKey(key); return t ? t.label.hu : key; }

  function statusesOf(typeKey) {
    const t = byKey(typeKey);
    return t ? t.statuses.slice() : [];
  }

  function statusLabel(typeKey, statusKey) {
    const s = statusesOf(typeKey).find(x => x.key === statusKey);
    return s ? s.label : statusKey;
  }

  function isTerminal(typeKey, statusKey) {
    const s = statusesOf(typeKey).find(x => x.key === statusKey);
    return !!(s && s.terminal);
  }

  function firstStatus(typeKey) {
    const s = statusesOf(typeKey);
    return s.length ? s[0].key : 'elokeszites';
  }

  function outcomes() { return CASE_OUTCOMES.slice(); }

  function outcomeLabel(key) {
    const o = CASE_OUTCOMES.find(x => x.key === key);
    return o ? o.label : (key || '');
  }

  /**
   * Javasolt határidő egy új ügyhöz.
   *
   * Bejelentésnél (deadlineFrom = 'trigger') a KIVÁLTÓ TÉNY napjától számol:
   * a költözéstől 3 nap, a munkaviszony megkezdésétől/megszűnésétől 5 nap.
   * Ha a tény két hete történt, a határidő már lejárt – a program ezt mutassa
   * is, ne azt, hogy még van időnk.
   *
   * A visszaadott érték JAVASLAT: az ügynél felülírható.
   */
  /**
   * Javasolt határidő a kezdő dátumból.
   *
   * Kezdő dátum nélkül `null` – nincs mit számolni. Ez nem hiba: a kérelem
   * érkeztetési napja csak az iktatószám megérkezésekor derül ki, addig
   * egyszerűen nem tudjuk, mikor jár le a 70 nap.
   *
   * A számítás mindkét esetben kezdő dátum + N nap. Kérelemnél a törvényi
   * szöveg szerint a határidő az érkeztetés napját KÖVETŐ naptól indul: az
   * első nap tehát az érkeztetés + 1, és a hetvenedik nap így pontosan az
   * érkeztetés + 70. A két eltolás kiejti egymást.
   *
   * A visszaadott érték JAVASLAT: ügyenként felülírható, mert a hatóság az
   * eljárást felfüggesztheti vagy meghosszabbíthatja.
   */
  function suggestDueDate(typeKey, triggerDate = null) {
    const t = byKey(typeKey);
    if (!t || !triggerDate) return null;
    const d = new Date(triggerDate);
    if (isNaN(d.getTime())) return null;
    d.setDate(d.getDate() + t.defaultDurationDays);
    return isoDate(d);
  }

  /** A határidő kezdő napjának megnevezése ennél a típusnál. */
  function triggerLabel(typeKey) {
    const t = byKey(typeKey);
    return t ? t.triggerLabel : 'A határidő kezdő napja';
  }

  /**
   * Tájékoztató-e a határidő?
   *
   * Igen, ha külső, a program által nem ismert tényből számol. Ilyenkor a
   * felület nem állíthatja, hogy mulasztás történt – csak annyit mutathat,
   * hogy a megadott dátum alapján ennyi idő van hátra.
   */
  function isAdvisoryDeadline(typeKey) {
    const t = byKey(typeKey);
    return !!(t && t.deadlineKind === DEADLINE_KIND.ADVISORY);
  }

  function isoDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const n = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${n}`;
  }

  return {
    SEED: SEED_CASE_TYPES,
    DEFAULT_APPLICATION_DAYS, DEADLINE_KIND,
    useBackend, load, loadFrom, save, get,
    all, version, byKey, label,
    statusesOf, statusLabel, isTerminal, firstStatus,
    outcomes, outcomeLabel,
    suggestDueDate, triggerLabel, isAdvisoryDeadline, isoDate,
  };
})();
