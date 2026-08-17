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

    /**
     * NYOMTATÁSI LAPFÜL — a HR korábbi „Personal Data Sheet" elrendezése.
     *
     * Miért nem makró? Mert nem kell hozzá. A lap egyetlen vezérlőcellából
     * (a személy sorszáma) INDEX-képletekkel szedi össze az adatot a `Data`
     * lapról, a nyomtatás és a PDF-mentés pedig az Excel beépített funkciója.
     * Így a fájl `.xlsx` marad: nincs makróengedélyezés, a céges levélszűrők és
     * a DLP nem blokkolják, és a generálás továbbra is a DocGen-ből megy
     * (az ExcelJS nem tud VBA-projektet írni).
     *
     * A LAP ELRENDEZÉSE ADAT. Ha a HR átalakítja az adatlapját, ezt a
     * felsorolást kell átírni – a kód csak lerendereli.
     *
     * `from`: a séma mezőkulcsai. Több kulcs → a lap egyetlen cellába fűzi
     * őket. A szeparátor mindig szóköz + TRIM, mert vesszővel egy üres mező
     * lógó vesszőt hagyna („Szerbia, ") – ez a lap a HR-nek szól, nem hatósági
     * irat, ott a szóköz elég. Ismeretlen kulcsú sor kimarad, nem hibázik.
     */
    printSheet: {
      name:  'HR adatlap',
      title: 'Personal Data Sheet',
      selectorLabel: 'Employee row on the "Data" sheet (1–30) / A munkavállaló sora:',
      labelWidth: 46,
      valueWidth: 54,
      sections: [
        { title: 'Personal Data  ·  Személyes adatok', rows: [
          { label: 'Name:',                    from: ['surname', 'forename'] },
          { label: 'Maiden name:',              from: ['surname_at_birth', 'forename_at_birth'] },
          { label: "Mother's name:",            from: ['mothers_surname_at_birth', 'mothers_forename_at_birth'] },
          { label: 'Place of birth:',           from: ['place_of_birth_locality', 'place_of_birth_country'] },
          { label: 'Date of birth:',            from: ['date_of_birth'] },
          { label: 'Home address (abroad):',    from: ['previous_country', 'previous_town', 'previous_street'] },
          { label: 'Place of residence (HU):',  from: ['postal_code', 'locality', 'name_of_public_place',
                                                       'type_of_public_place', 'street_number', 'building',
                                                       'stairway', 'floor', 'door'] },
          { label: 'Phone number:',             from: ['telephone'] },
          { label: 'E-mail address:',           from: ['email'] },
          { label: 'Contact name in case of an emergency:',         from: ['hr_emergency_contact_name'] },
          { label: 'Contact phone number in case of an emergency:', from: ['hr_emergency_contact_phone'] },
          { label: 'Citizenship:',              from: ['citizenship'] },
          { label: 'Dual citizenship:',         from: ['hr_dual_citizenship'] },
          { label: 'Tax number:',               from: ['tax_number'] },
          // A HR-lap „ID number" rovatába az ÚTLEVÉLSZÁM kerül: a külföldi
          // munkavállalónak nincs magyar személyi igazolványa.
          { label: 'ID number (passport):',     from: ['pp_number'] },
          { label: 'TAJ number:',               from: ['TAJ'] },
          { label: 'Bank account number and name of bank:', from: ['hr_bank_account'] },
        ] },
        { title: 'Education  ·  Végzettség', rows: [
          { label: 'Highest completed education:',            from: ['educational_attainment'] },
          { label: 'Date of completion:',                     from: ['hr_education_completion_date'] },
          { label: 'Name of educational institution, faculty:', from: ['hr_education_institution'] },
          { label: 'Graduated specialization:',               from: ['hr_education_specialization'] },
          { label: 'Title of qualification:',                 from: ['professional_qualification'] },
          { label: "Degree's document number:",               from: ['hr_degree_document_number'] },
          { label: 'Computer skills:',                        from: ['hr_computer_skills'] },
          // A HR-lapon ez háromoszlopos alrács volt (nyelv / szint / vizsga),
          // három sorral. A táblázatban egyetlen szabad szöveges cella áll
          // mögötte, ezért itt is egy sor.
          { label: 'Language skills (language / level / exam):', from: ['hr_language_skills'] },
        ] },
        { title: 'Other  ·  Egyéb', rows: [
          { label: 'Children (name, date of birth):',  from: ['hr_children'] },
          { label: 'Previous employer:',               from: ['hr_previous_employer'] },
          { label: 'Professional background:',         from: ['occupation_before_arrival'] },
          { label: 'Date of final employment relationship termination:',
                                                       from: ['hr_previous_employment_end'] },
        ] },
        { title: 'HR department fills it  ·  A HR tölti ki', rows: [
          { label: 'Date of start:',           from: ['employment_start'] },
          { label: 'Department, cost center:',  from: ['hr_department_cost_center'] },
          { label: 'Direct leader:',            from: ['hr_direct_leader'] },
          { label: 'Position:',                 from: ['position'] },
          { label: 'SG category:',              from: ['hr_sg_category'] },
          { label: 'FEOR number:',              from: ['feor'] },
          { label: 'Salary:',                   from: ['gross_salary'] },
        ] },
      ],
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

      /**
       * Fejlécszín csoportonként.
       *
       * Hetven oszlop egyforma fejléccel átláthatatlan: a kitöltő nem látja,
       * hol ér véget a lakcím és hol kezdődik a foglalkoztatás. A szín a
       * séma CSOPORTJÁT jelöli, a színváltásnál pedig vastag vonal is van.
       *
       * A csoportok NEM egybefüggő blokkok: az oszlopsorrend a hatósági
       * nyomtatványé (lásd a séma szakasz-kommentjeit), abban pedig pl. a
       * szakképzettség a személyes adatok közé esik, a nyelvismeret viszont
       * csak a betétlapon szerepel. A szín tehát jelmagyarázat, nem
       * szakaszhatár – az Útmutató lap „Csoport" oszlopa ugyanezt a színt
       * viseli, így a kettő összeolvasható.
       *
       * A KÖTELEZŐ mező ettől függetlenül piros marad – az a jelzés erősebb,
       * mint a csoporté, és nem szabad elveszíteni. Aminek nincs színe itt,
       * az az `optionalFill`-t kapja.
       */
      groupFill: {
        azonosito:      'FF1F3864',
        kapcsolat:      'FF2E75B6',
        alap:           'FF2F5597',
        szuletes:       'FF548235',
        vegzettseg:     'FF1F6B5C',
        okmany:         'FF7030A0',
        lakcim:         'FF806000',
        csalad:         'FF9E480E',
        korabbi:        'FFA6761D',
        foglalkoztatas: 'FFC55A11',
        hr_belso:       'FF595959',   // szürke: ide a munkavállaló nem ír
      },

      /**
       * Ennyi oszlop marad állva vízszintes görgetéskor. Enélkül a 60. oszlop
       * kitöltésénél már nem látszik, kinek a sorában járunk.
       *
       * A 7 nem esetleges: a **vezeték- és keresztnévvel bezárólag** áll meg,
       * mert a hatósági rovatsorrendben a név csak a 6–7. oszlop (a nyomtatvány
       * borítója — engedélyszám, lejárat, telefon, e-mail — előbbre van).
       * Ha a mezősorrend változik, ezt a számot is igazítani kell, különben a
       * fagyasztás pont a nevet vágja le.
       */
      freezeColumns: 7,
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
