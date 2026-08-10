'use strict';

/**
 * Séma-tároló.
 *
 * A séma **adat**: a `data/docgen-config.json` fájlban él, és a felületről
 * szerkeszthető. A kód csak értelmezi. Új adatkör felvétele nem igényel
 * kódmódosítást.
 *
 * Feladatai:
 *   – betöltés / mentés (a nyilvántartással közös adatmappába)
 *   – verziókövetés és a rekordok migrálása séma-változás után
 *   – mezők lekérdezése (kulcs, dokumentum-jelölő, csoport szerint)
 *   – számított mezők feloldása
 *   – integritás-ellenőrzés (a szerkesztő védőkorlátjaihoz)
 *   – szótár: szabad szöveges értékek angol↔magyar megfeleltetése
 */
const SchemaStore = (() => {

  let backend = null;
  let schema  = null;
  const listeners = new Set();

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function nowIso() { return new Date().toISOString(); }

  function emit() {
    for (const fn of listeners) { try { fn(); } catch { /* egy hibás figyelő ne akassza meg a többit */ } }
  }

  function ensureLoaded() {
    if (!schema) throw new Error('A séma nincs betöltve (SchemaStore.load()).');
  }

  // ── Betöltés / mentés ──────────────────────────────────────────────────────

  function useBackend(b) { backend = b; schema = null; }
  function onChange(fn)  { listeners.add(fn); return () => listeners.delete(fn); }

  async function load() {
    let raw = null;
    if (backend) {
      try { raw = await backend.load(); } catch { raw = null; }
    }
    schema = normalize(raw && Array.isArray(raw.fields) ? raw : clone(SEED_SCHEMA));
    emit();
    return schema;
  }

  /** Séma betöltése memóriából – teszthez és előnézethez. */
  function loadFrom(obj) {
    schema = normalize(obj ? clone(obj) : clone(SEED_SCHEMA));
    emit();
    return schema;
  }

  async function save() {
    ensureLoaded();
    schema.updatedAt = nowIso();
    if (backend) await backend.save(schema);
    return true;
  }

  /** Hiányzó részek pótlása – a séma sosem bukhat el hiányos adat miatt. */
  function normalize(s) {
    const out = {
      version:   Number(s.version) || 1,
      updatedAt: s.updatedAt || null,
      groups:    Array.isArray(s.groups) ? s.groups.slice() : [],
      fields:    [],
      dictionary: normalizeDictionary(s.dictionary),
    };
    const seenKeys = new Set();
    for (const f of (s.fields || [])) {
      if (!f || !f.key || seenKeys.has(f.key)) continue;   // kulcs nélküli / duplikált mező kimarad
      seenKeys.add(f.key);
      const field = {
        key:      String(f.key),
        group:    f.group || 'egyeb',
        type:     f.type || 'text',
        required: !!f.required,
        label:    { hu: (f.label && f.label.hu) || f.key, en: (f.label && f.label.en) || '' },
        tags:     Array.isArray(f.tags) ? f.tags.slice() : [],
        // Kitöltési útmutató – az adatbekérő xlsx cellakommentjébe kerül.
        // A táblázatot külföldi munkavállaló tölti ki, ezért az angol a fontos;
        // a magyar változat opcionális.
        hint:     { en: (f.hint && f.hint.en) || '', hu: (f.hint && f.hint.hu) || '' },
      };
      if (field.type === 'enum') {
        field.values = (f.values || []).map(v => ({
          id:      String(v.id),
          hu:      v.hu || v.id,
          en:      v.en || v.id,
          accepts: Array.isArray(v.accepts) ? v.accepts.slice() : [],
        }));
      }
      if (field.type === 'computed') {
        field.computed = {
          from: (f.computed && Array.isArray(f.computed.from)) ? f.computed.from.slice() : [],
          sep:  (f.computed && f.computed.sep != null) ? f.computed.sep : ' ',
        };
      }
      out.fields.push(field);
    }
    // Csoport nélküli mezőkhöz gyűjtőcsoport
    if (out.fields.some(f => !out.groups.find(g => g.key === f.group))) {
      const missing = new Set(out.fields.map(f => f.group)
        .filter(g => !out.groups.find(x => x.key === g)));
      for (const key of missing) out.groups.push({ key, label: key });
    }
    return out;
  }

  // ── Szótár ─────────────────────────────────────────────────────────────────
  /**
   * Szabad szöveges értékek angol↔magyar megfeleltetése.
   *
   * A kitöltő angolul írja be az országot, a munkakört, az állampolgárságot –
   * a magyar hatósági iratba viszont a magyar alak kell. Korábban ezt két
   * oszloppal oldottuk meg az adatbekérőben (`previous_country_hun` és
   * `previous_country_eng`), vagyis ugyanazt az adatot kétszer kértük be.
   * Most egy oszlop érkezik, a fordítást pedig ez a szótár adja:
   *
   *   {{previous_country}}       → magyarul (ez az alapértelmezés)
   *   {{previous_country_hun}}   → magyarul
   *   {{previous_country_eng}}   → ahogy a táblázatban érkezett
   *
   * Az enum mezőket NEM érinti: azoknak saját, mezőhöz kötött értéklistájuk
   * van. A szótár a szabad szöveges (text) mezőkre hat, mezőtől függetlenül –
   * egy „Serbia → Szerbia" pár minden mezőben ugyanazt jelenti.
   */
  function normalizeDictionary(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    const latott = new Set();
    for (const e of raw) {
      const en = String((e && e.en) || '').trim();
      const hu = String((e && e.hu) || '').trim();
      if (!en || !hu) continue;                      // félkész pár nem fordít
      const kulcs = ValueCodec.normalize(en);
      if (latott.has(kulcs)) continue;               // első nyer, nincs kétértelműség
      latott.add(kulcs);
      out.push({ en, hu });
    }
    return out;
  }

  function dictionary() { ensureLoaded(); return schema.dictionary.slice(); }

  function setDictionary(list) {
    ensureLoaded();
    schema.dictionary = normalizeDictionary(list);
    return schema.dictionary;
  }

  /** Szótári megfelelő, vagy `null`, ha nincs ilyen bejegyzés. */
  function translate(value, lang) {
    ensureLoaded();
    const needle = ValueCodec.normalize(value);
    if (!needle) return null;
    for (const e of schema.dictionary) {
      if (ValueCodec.normalize(e.en) === needle || ValueCodec.normalize(e.hu) === needle) {
        return lang === 'en' ? e.en : e.hu;
      }
    }
    return null;
  }

  /**
   * Egyetlen mező értéke a kért nyelven: enum → értéklista, text → szótár,
   * minden más változatlanul. Ez az egyetlen hely, ahol nyelvet választunk.
   */
  function renderValue(f, raw, lang = 'hu') {
    if (f.type === 'enum') return ValueCodec.render(f, raw, lang);
    const s = raw == null ? '' : String(raw);
    if (f.type !== 'text' || !s) return s;
    return translate(s, lang) || s;
  }

  // ── Lekérdezés ─────────────────────────────────────────────────────────────

  function get() { ensureLoaded(); return schema; }
  function version() { ensureLoaded(); return schema.version; }
  function fields({ includeComputed = true } = {}) {
    ensureLoaded();
    return includeComputed ? schema.fields.slice()
                           : schema.fields.filter(f => f.type !== 'computed');
  }
  function groups() { ensureLoaded(); return schema.groups.slice(); }
  function field(key) {
    ensureLoaded();
    return schema.fields.find(f => f.key === key) || null;
  }
  function storedFields() { return fields({ includeComputed: false }); }

  /** Mezők csoportonként, a séma sorrendjét megtartva – az űrlaphoz. */
  function byGroup({ includeComputed = false } = {}) {
    ensureLoaded();
    const list = fields({ includeComputed });
    return schema.groups
      .map(g => ({ group: g, fields: list.filter(f => f.group === g.key) }))
      .filter(x => x.fields.length);
  }

  const TAG_NORM = s => String(s).toLowerCase().replace(/[\s._-]+/g, ' ').trim();

  // Dátum-rész utótagok. Kell, mert a hatósági formanyomtatványok a dátumot
  // három külön rovatba kérik: „____ year ____ month ____ day".
  const PART_RE  = /^(.*?)[\s._-]*(year|év|ev|month|hónap|honap|hó|ho|day|nap)$/i;
  const PART_MAP = {
    year: 'year', ev: 'year', 'év': 'year',
    month: 'month', honap: 'month', 'hónap': 'month', ho: 'month', 'hó': 'month',
    day: 'day', nap: 'day',
  };
  const LANG_RE = /^(.*?)[\s._-]*(en|eng|hu|hun)$/i;

  function findField(name) {
    const needle = TAG_NORM(name);
    if (!needle) return null;
    for (const f of schema.fields) {
      const candidates = [f.key, f.label.hu, f.label.en].concat(f.tags || []);
      if (candidates.filter(Boolean).some(c => TAG_NORM(c) === needle)) return f;
    }
    return null;
  }

  /**
   * Dokumentum-jelölő feloldása mezővé.
   * A találat kis/nagybetűre és az aláhúzás/szóköz különbségre érzéketlen,
   * és a kulcsot, a jelölő-aliasokat és a magyar címkét is figyelembe veszi.
   *
   * Utótagok — csak akkor értelmezzük őket, ha a TELJES név nem mező. Enélkül
   * a „Név" jelölőt „N" + év-utótagnak olvasnánk:
   *
   *   {{Neme_EN}}                → a mező angolul
   *   {{previous_country_hun}}   → a mező magyarul (szótár szerint)
   *   {{date_of_birth_year}}     → csak az évszám
   *
   * @returns {{field, lang: 'hu'|'en', part: null|'year'|'month'|'day'}}
   */
  function resolveTag(tag) {
    ensureLoaded();
    const teljes = String(tag == null ? '' : tag).trim();

    const kozvetlen = findField(teljes);
    if (kozvetlen) return { field: kozvetlen, lang: 'hu', part: null };

    let raw = teljes, lang = 'hu', part = null;

    const p = PART_RE.exec(raw);
    if (p && p[1].trim()) { raw = p[1].trim(); part = PART_MAP[p[2].toLowerCase()]; }

    const m = LANG_RE.exec(raw);
    if (m && m[1].trim()) { raw = m[1].trim(); lang = /^en/i.test(m[2]) ? 'en' : 'hu'; }

    const f = findField(raw);
    return f ? { field: f, lang, part } : null;
  }

  /** ISO dátum egy darabja. Ami nem ÉÉÉÉ-HH-NN, arra üres – nem találgatunk. */
  function datePart(value, part) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value == null ? '' : value).trim());
    if (!m) return '';
    return { year: m[1], month: m[2], day: m[3] }[part] || '';
  }

  /**
   * Egy dokumentum-jelölő teljes feloldása egy rekord mezőire.
   * `null` = a séma nem ismeri a jelölőt (a hívó eshet vissza sima kulcskeresésre).
   */
  function renderTag(tag, values = {}) {
    const hit = resolveTag(tag);
    if (!hit) return null;
    const ertek = hit.field.type === 'computed'
      ? computeField(hit.field, values, hit.lang)
      : renderValue(hit.field, values[hit.field.key], hit.lang);
    return hit.part ? datePart(ertek, hit.part) : ertek;
  }

  // ── Számított mezők ────────────────────────────────────────────────────────

  /** Egy számított mező értéke a tárolt mezőkből. */
  function computeField(f, values, lang = 'hu') {
    const parts = (f.computed.from || [])
      .map(k => {
        const src = field(k);
        return src ? renderValue(src, values[k], lang) : '';
      })
      .map(s => s.trim())
      .filter(Boolean);
    return parts.join(f.computed.sep);
  }

  /**
   * Teljes megjelenítendő értékkészlet egy rekordhoz: a tárolt mezők a kért
   * nyelvre renderelve, plusz a számított mezők. Ezt kapja a dokumentum-
   * generálás és az űrlap-előnézet.
   */
  function resolveValues(storedValues = {}, lang = 'hu') {
    ensureLoaded();
    const out = {};
    for (const f of schema.fields) {
      if (f.type === 'computed') continue;
      out[f.key] = renderValue(f, storedValues[f.key], lang);
    }
    for (const f of schema.fields) {
      if (f.type !== 'computed') continue;
      out[f.key] = computeField(f, storedValues, lang);
    }
    return out;
  }

  // ── Validáció ──────────────────────────────────────────────────────────────

  /** Egy rekord mezőértékeinek ellenőrzése a séma szerint. */
  function validateValues(values = {}) {
    ensureLoaded();
    const problems = [];
    for (const f of schema.fields) {
      if (f.type === 'computed') continue;
      const v = values[f.key];
      const empty = v == null || String(v).trim() === '';

      if (f.required && empty) {
        problems.push({ key: f.key, message: `A(z) „${f.label.hu}" mező kötelező.` });
        continue;
      }
      if (empty) continue;

      if (f.type === 'enum' && !ValueCodec.canDecode(f, v)) {
        problems.push({ key: f.key, message: `A(z) „${f.label.hu}" mező értéke ismeretlen: „${v}".` });
      }
      if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(v).trim())) {
        problems.push({ key: f.key, message: `A(z) „${f.label.hu}" mező dátumformátuma ÉÉÉÉ-HH-NN kell legyen.` });
      }
      if (f.type === 'number' && isNaN(Number(String(v).replace(/\s/g, '').replace(',', '.')))) {
        problems.push({ key: f.key, message: `A(z) „${f.label.hu}" mező értéke nem szám.` });
      }
    }
    return problems;
  }

  /** A séma belső ellentmondásai – a szerkesztő ezzel figyelmeztet. */
  function validateSchema(s = schema) {
    const problems = [];
    const keys = new Set();
    for (const f of s.fields) {
      if (keys.has(f.key)) problems.push(`Duplikált mezőkulcs: ${f.key}`);
      keys.add(f.key);
      if (f.type === 'enum') {
        for (const c of ValueCodec.findAmbiguities(f)) {
          problems.push(`A(z) „${f.label.hu}" mezőben a(z) „${c.form}" írásmód két értékhez is tartozik: ${c.between.join(' / ')}`);
        }
      }
      if (f.type === 'computed') {
        for (const src of f.computed.from) {
          if (!s.fields.find(x => x.key === src)) {
            problems.push(`A(z) „${f.label.hu}" számított mező ismeretlen mezőre hivatkozik: ${src}`);
          }
        }
      }
    }
    // Jelölő-ütközés: ugyanaz a jelölő két mezőre is illeszkedne
    const tagOwner = new Map();
    const norm = x => String(x).toLowerCase().replace(/[\s._-]+/g, ' ').trim();
    for (const f of s.fields) {
      for (const t of [f.key, f.label.hu].concat(f.tags || [])) {
        if (!t) continue;
        const n = norm(t);
        if (tagOwner.has(n) && tagOwner.get(n) !== f.key) {
          problems.push(`A(z) „${t}" jelölő két mezőhöz is tartozik: ${tagOwner.get(n)} / ${f.key}`);
        } else {
          tagOwner.set(n, f.key);
        }
      }
    }
    return problems;
  }

  // ── Migráció ───────────────────────────────────────────────────────────────

  /**
   * Egy tárolt rekord mezőinek felhozatala az aktuális sémára.
   * Hiányzó mező üres lesz, nem hiba. Az ismeretlen (sémából törölt) mezők
   * értékét **nem dobjuk el**, hanem megőrizzük – ha a mező visszakerül, az
   * adat is visszatér. Ez adatvesztés elleni védelem.
   */
  function migrateValues(values = {}) {
    ensureLoaded();
    const out = {};
    for (const f of schema.fields) {
      if (f.type === 'computed') continue;
      out[f.key] = values[f.key] != null ? values[f.key] : '';
    }
    const known = new Set(schema.fields.map(f => f.key));
    const orphans = {};
    for (const [k, v] of Object.entries(values)) {
      if (!known.has(k) && v != null && String(v).trim() !== '') orphans[k] = v;
    }
    if (Object.keys(orphans).length) out.__orphan = orphans;
    return out;
  }

  /** Mezőkulcs átnevezése – a rekordok adatai együtt mozognak. */
  function renameFieldKey(oldKey, newKey, employees = []) {
    ensureLoaded();
    if (!newKey || oldKey === newKey) return 0;
    if (schema.fields.find(f => f.key === newKey)) {
      throw new Error(`Már létezik mező ezzel a kulccsal: ${newKey}`);
    }
    const f = field(oldKey);
    if (!f) throw new Error(`Nincs ilyen mező: ${oldKey}`);
    f.key = newKey;
    for (const other of schema.fields) {
      if (other.type === 'computed') {
        other.computed.from = other.computed.from.map(k => (k === oldKey ? newKey : k));
      }
    }
    let moved = 0;
    for (const emp of employees) {
      if (emp.fields && Object.prototype.hasOwnProperty.call(emp.fields, oldKey)) {
        emp.fields[newKey] = emp.fields[oldKey];
        delete emp.fields[oldKey];
        moved++;
      }
    }
    schema.version++;
    return moved;
  }

  /**
   * Örökölt `_hun` mezőkulcsok rövidítése.
   *
   * Az adatbekérőben korábban két oszlop volt ugyanarra az adatra (magyar és
   * angol alak). Most egy oszlop van, a fordítást a szótár adja – a kulcsból
   * tehát elhagyható a nyelvjelölés. A régi kulcs jelölőként megmarad, hogy a
   * már kiküldött adatbekérők importja se törjön meg.
   *
   * Idempotens: a rekordok adatai a kulccsal együtt mozognak, és a második
   * futáskor már nincs mit átnevezni.
   */
  const LEGACY_KEYS = {
    place_of_birth_country_hun:     'place_of_birth_country',
    professional_qualification_hun: 'professional_qualification',
    previous_country_hun:           'previous_country',
  };

  function migrateLegacyKeys(employees = []) {
    ensureLoaded();
    let atnevezve = 0;
    for (const [regi, uj] of Object.entries(LEGACY_KEYS)) {
      if (!field(regi) || field(uj)) continue;
      renameFieldKey(regi, uj, employees);
      const f = field(uj);
      if (!f.tags.includes(regi)) f.tags.push(regi);
      atnevezve++;
    }
    return atnevezve;
  }

  /** Mező törlése előtti hatásvizsgálat – mi veszne el. */
  function usageOf(key, employees = []) {
    ensureLoaded();
    const withData = employees.filter(e =>
      e.fields && e.fields[key] != null && String(e.fields[key]).trim() !== '').length;
    const computedBy = schema.fields
      .filter(f => f.type === 'computed' && f.computed.from.includes(key))
      .map(f => f.label.hu);
    return { withData, computedBy };
  }

  return {
    useBackend, onChange, load, loadFrom, save,
    get, version, fields, storedFields, groups, field, byGroup,
    resolveTag, renderTag, resolveValues, computeField, renderValue,
    dictionary, setDictionary, translate,
    validateValues, validateSchema,
    migrateValues, renameFieldKey, migrateLegacyKeys, usageOf,
    _normalize: normalize, _datePart: datePart,
  };
})();
