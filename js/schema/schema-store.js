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

  /**
   * Dokumentum-jelölő feloldása mezővé.
   * A találat kis/nagybetűre és az aláhúzás/szóköz különbségre érzéketlen,
   * és a kulcsot, a jelölő-aliasokat és a magyar címkét is figyelembe veszi.
   * Az `_EN` végződés az angol nyelvű megjelenítést kéri.
   */
  function resolveTag(tag) {
    ensureLoaded();
    let raw = String(tag == null ? '' : tag).trim();
    let lang = 'hu';
    const m = /^(.*?)[ _-]?(EN|ENG)$/i.exec(raw);
    if (m && m[1]) { raw = m[1].trim(); lang = 'en'; }

    const norm = s => String(s).toLowerCase().replace(/[\s._-]+/g, ' ').trim();
    const needle = norm(raw);

    for (const f of schema.fields) {
      const candidates = [f.key, f.label.hu, f.label.en].concat(f.tags || []);
      if (candidates.filter(Boolean).some(c => norm(c) === needle)) return { field: f, lang };
    }
    return null;
  }

  // ── Számított mezők ────────────────────────────────────────────────────────

  /** Egy számított mező értéke a tárolt mezőkből. */
  function computeField(f, values, lang = 'hu') {
    const parts = (f.computed.from || [])
      .map(k => {
        const src = field(k);
        if (!src) return '';
        return src.type === 'enum'
          ? ValueCodec.render(src, values[k], lang)
          : (values[k] == null ? '' : String(values[k]));
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
      out[f.key] = f.type === 'enum'
        ? ValueCodec.render(f, storedValues[f.key], lang)
        : (storedValues[f.key] == null ? '' : String(storedValues[f.key]));
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
    resolveTag, resolveValues, computeField,
    validateValues, validateSchema,
    migrateValues, renameFieldKey, usageOf,
    _normalize: normalize,
  };
})();
