'use strict';

/**
 * Export profilok – adatként, nem kódban.
 *
 * A profil köti össze a sémát a célformátummal: melyik oszlop hova kerül,
 * milyen kódolással megy ki egy választható érték, hogyan néz ki a fejléc.
 * Ha a Horizontes formátuma változik, ezt a profilt szerkesztjük – az
 * adatbázishoz nem kell hozzányúlni.
 *
 * A `columns: null` azt jelenti, hogy a séma mezősorrendje az irányadó. Így egy
 * új mező felvétele után az export magától követi, külön beállítás nélkül.
 */
const DEFAULT_EXPORT_PROFILES = [
  {
    id: 'horizontes',
    label: 'Horizontes adatbekérő',
    sheetName: 'Data',
    guideSheetName: 'Útmutató',
    keyRow: 1,          // gépi kulcsok sora
    labelRow: 2,        // angol címkék sora
    firstDataRow: 3,
    columns: null,      // null → a séma sorrendje
    enumEncoding: 'id', // a Horizontes import a kanonikus értéket várja (male/female)
    dateFormat: 'iso',  // ÉÉÉÉ-HH-NN szövegként
    style: {
      headerFont:    { name: 'Arial', size: 10, bold: true, color: 'FFFFFFFF' },
      requiredFill:  'FFC00000',
      optionalFill:  'FF1F3864',
      labelFill:     'FF1F3864',
      keyRowHeight:   30,
      labelRowHeight: 34,
      defaultWidth:   18,
      validationRows: 200,   // meddig terjedjenek a legördülők
    },
  },
];

const ExportProfiles = (() => {

  let backend = null;
  let profiles = null;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function useBackend(b) { backend = b; profiles = null; }

  async function load() {
    let raw = null;
    if (backend) { try { raw = await backend.load(); } catch { raw = null; } }
    profiles = Array.isArray(raw) && raw.length ? raw.map(normalize)
                                                : clone(DEFAULT_EXPORT_PROFILES);
    return profiles;
  }

  function loadFrom(list) {
    profiles = (Array.isArray(list) && list.length ? list : clone(DEFAULT_EXPORT_PROFILES)).map(normalize);
    return profiles;
  }

  async function save() {
    if (backend && profiles) await backend.save(profiles);
    return true;
  }

  /** Hiányzó beállítások pótlása az alapértelmezett profilból. */
  function normalize(p) {
    const d = DEFAULT_EXPORT_PROFILES[0];
    const out = Object.assign({}, d, p);
    out.style = Object.assign({}, d.style, p.style || {});
    return out;
  }

  function list() { return profiles || loadFrom(null); }
  function get(id) { return list().find(p => p.id === id) || list()[0]; }

  /**
   * A profil oszloprendje mezőobjektumokként.
   * Számított mezők alapból kimaradnak: az adatbekérő tárolt oszlopokat vár.
   */
  function columnsOf(profile, schema) {
    const stored = schema.fields.filter(f => f.type !== 'computed');
    if (!profile.columns) return stored;
    return profile.columns
      .map(key => stored.find(f => f.key === key))
      .filter(Boolean);
  }

  return {
    DEFAULT_EXPORT_PROFILES,
    useBackend, load, loadFrom, save, list, get, columnsOf, normalize,
  };
})();
