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
 * Kérelmek alapértelmezett ügyintézési határideje.
 * Ez csak KIINDULÓ érték: minden ügynél kézzel felülírható, mert a hatóság
 * felfüggesztheti vagy meghosszabbíthatja az eljárást.
 */
const DEFAULT_APPLICATION_DAYS = 70;

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
      statuses: applicationStatuses(),
      defaultDurationDays: DEFAULT_APPLICATION_DAYS,
      producesIdentifier: 'residence_permit',
      templates: [],
    },
    {
      key: 'rp_hosszabbitas',
      kind: 'kerelem',
      label: { hu: 'Tartózkodási engedély meghosszabbítása', en: 'Residence permit extension' },
      statuses: applicationStatuses(),
      defaultDurationDays: DEFAULT_APPLICATION_DAYS,
      // A határidőt a meglévő engedély lejáratából is javasolhatjuk: a kérelmet
      // a lejárat előtt kell beadni, ezért 30 nappal előbbre tesszük.
      dueFrom: { field: 'expiration_of_rp', offsetDays: -30 },
      producesIdentifier: 'residence_permit',
      templates: [],
    },
    {
      key: 'letelepedes',
      kind: 'kerelem',
      label: { hu: 'Letelepedési engedély', en: 'Settlement permit' },
      statuses: applicationStatuses(),
      defaultDurationDays: DEFAULT_APPLICATION_DAYS,
      producesIdentifier: 'residence_permit',
      templates: [],
    },

    // ── Bejelentések ────────────────────────────────────────────────────────
    {
      key: 'szallashely_valtozas',
      kind: 'bejelentes',
      label: { hu: 'Szálláshely-változás bejelentése', en: 'Change of accommodation' },
      statuses: notificationStatuses(),
      defaultDurationDays: 3,
      templates: [],
    },
    {
      key: 'munkaviszony_bejelentes',
      kind: 'bejelentes',
      label: { hu: 'Munkaviszony bejelentése', en: 'Registration of employment' },
      statuses: notificationStatuses(),
      defaultDurationDays: 15,
      templates: [],
    },
    {
      key: 'munkaviszony_kijelentes',
      kind: 'bejelentes',
      label: { hu: 'Munkaviszony megszűnésének bejelentése', en: 'Deregistration of employment' },
      statuses: notificationStatuses(),
      defaultDurationDays: 15,
      templates: [],
    },
    {
      key: 'adatvaltozas',
      kind: 'bejelentes',
      label: { hu: 'Adatváltozás bejelentése', en: 'Notification of data change' },
      statuses: notificationStatuses(),
      defaultDurationDays: 15,
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
        statuses,
        defaultDurationDays: Number(t.defaultDurationDays) > 0
          ? Number(t.defaultDurationDays)
          : (kind === 'kerelem' ? DEFAULT_APPLICATION_DAYS : 15),
        dueFrom: (t.dueFrom && t.dueFrom.field)
          ? { field: String(t.dueFrom.field), offsetDays: Number(t.dueFrom.offsetDays) || 0 }
          : null,
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
   * Két forrás lehet, ebben a sorrendben:
   *   1. dueFrom – a dolgozó egy mezőjéből számol (pl. az engedély lejárata
   *      előtt 30 nappal). Csak akkor, ha a mező ki van töltve ÉS a kapott
   *      dátum még nem múlt el – lejárt engedélynél a múltbeli határidő
   *      félrevezető lenne.
   *   2. defaultDurationDays – az indulástól számított nap (kérelmeknél 70).
   *
   * A visszaadott érték JAVASLAT: az ügy létrehozásakor felülírható, mert a
   * hatóság az eljárást felfüggesztheti vagy meghosszabbíthatja.
   */
  function suggestDueDate(typeKey, employeeFields = {}, fromDate = null) {
    const t = byKey(typeKey);
    if (!t) return null;
    const kezdet = fromDate ? new Date(fromDate) : new Date();

    if (t.dueFrom) {
      const alap = employeeFields[t.dueFrom.field];
      if (alap) {
        const d = new Date(alap);
        if (!isNaN(d.getTime())) {
          d.setDate(d.getDate() + t.dueFrom.offsetDays);
          if (d.getTime() >= kezdet.getTime()) return isoDate(d);
        }
      }
    }

    const d = new Date(kezdet);
    d.setDate(d.getDate() + t.defaultDurationDays);
    return isoDate(d);
  }

  function isoDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const n = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${n}`;
  }

  return {
    SEED: SEED_CASE_TYPES,
    DEFAULT_APPLICATION_DAYS,
    useBackend, load, loadFrom, save, get,
    all, version, byKey, label,
    statusesOf, statusLabel, isTerminal, firstStatus,
    outcomes, outcomeLabel,
    suggestDueDate, isoDate,
  };
})();
