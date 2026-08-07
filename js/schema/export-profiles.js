'use strict';

/**
 * Export profilok – adatként, nem kódban.
 *
 * A profil köti össze a sémát a célformátummal: melyik oszlop hova kerül,
 * milyen kódolással megy ki egy választható érték, hogyan néz ki a fejléc.
 * Ha a célformátum változik, ezt a profilt szerkesztjük – az adatbázishoz nem
 * kell hozzányúlni.
 *
 * A `columns: null` azt jelenti, hogy a séma mezősorrendje az irányadó. Így egy
 * új mező felvétele után az export magától követi, külön beállítás nélkül.
 */
const DEFAULT_EXPORT_PROFILES = [
  {
    id: 'adatbekero',
    label: 'Munkavállalói adatbekérő',
    fileName: 'adatbekero',   // a letöltött üres sablon neve (.xlsx nélkül)
    sheetName: 'Data',
    guideSheetName: 'Útmutató',
    keyRow: 1,          // gépi kulcsok sora – a programnak kell, a kitöltőnek nem
    hideKeyRow: true,   // ezért alapból rejtett
    labelRow: 2,        // angol címkék sora – ide kerül a kitöltést segítő komment
    firstDataRow: 3,
    columns: null,      // null → a séma sorrendje
    enumEncoding: 'id', // az import a kanonikus értéket várja (male/female)
    dateFormat: 'iso',  // ÉÉÉÉ-HH-NN szövegként

    /**
     * Lapvédelem az ÜRES sablonhoz.
     *
     * Nem biztonsági eszköz – az xlsx lapvédelem percek alatt megkerülhető.
     * Egyetlen célja, hogy a kitöltő véletlenül se fedje fel a gépi kulcsok
     * sorát, és ne írja át a fejlécet. A jelszó ezért nyugodtan cserélhető
     * Excelben (Korrektúra → Lapvédelem feloldása).
     *
     * A `fillableRows` sor marad írhatóvá – védelem mellett a cellák
     * alapból zároltak, e nélkül a táblázat kitölthetetlen lenne.
     */
    protection: {
      enabled: true,
      password: 'Aumovio2026',
      fillableRows: 30,
    },
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
