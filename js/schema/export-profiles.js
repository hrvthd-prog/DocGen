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
    sectionRow: 2,       // szakaszcímek (Personal Data, Contacts…) – a kitöltőnek segít tájékozódni
    labelRow: 3,        // angol címkék sora – ide kerül a kitöltést segítő komment
    firstDataRow: 4,
    columns: null,      // null → a `sections` sorrendje (lásd lent), ha nincs `sections`, a séma sorrendje
    enumEncoding: 'id', // az import a kanonikus értéket várja (male/female)
    dateFormat: 'iso',  // ÉÉÉÉ-HH-NN szövegként

    /**
     * Az oszlopok sorrendje, a 2. sori szakaszcímek ÉS a fejléc színe —
     * TÉMA szerint, nem a hatósági nyomtatvány rovatsorrendje szerint (ezt
     * 2026-08-18-án szándékosan váltottuk le a 2026-08-17-i „hatósági
     * sorrend" elvről: a kitöltőnek ez könnyebben áttekinthető). Minden
     * mezőkulcsnak PONTOSAN egy szakaszban kell szerepelnie – a `columnsOf`
     * innen építi az oszloprendet, a `writeHeader`/`writeSectionRow` pedig
     * ugyaninnen a fejléc mindhárom sorának színét és a 2. sor összevont
     * címeit.
     *
     * A `fill` egy valódi, a felhasználó által kézzel megformázott
     * mintafájlból származik (2026-08-19), NEM tetszőleges választás –
     * onnantól a kötelezőséget a fejléc színe többé NEM jelzi (arra a
     * cellakomment „REQUIRED" szövege szolgál), a színt kizárólag a szakasz
     * adja, minden mezőre és mindhárom fejlécsorra egyformán.
     */
    sections: [
      { title: 'Personal Data', fill: 'FFC00000', keys: [
        'surname', 'forename', 'surname_at_birth', 'forename_at_birth',
        'mothers_surname_at_birth', 'mothers_forename_at_birth', 'date_of_birth',
        'citizenship', 'hr_dual_citizenship', 'place_of_birth_country',
        'place_of_birth_locality', 'sex', 'marital_status',
      ] },
      { title: 'Data of Travel and Residence Documents', fill: 'FF7030A0', keys: [
        'pp_number', 'pp_issuance_date', 'pp_issuance_place', 'pp_validity',
        'passport_type', 'number_of_rp', 'expiration_of_rp',
      ] },
      { title: 'Identification Numbers', fill: 'FF1F3864', keys: [
        'personnel_reg_number', 'tax_number', 'TAJ',
      ] },
      { title: 'Hungarian Address', fill: 'FF806000', keys: [
        'postal_code', 'locality', 'name_of_public_place', 'type_of_public_place',
        'street_number', 'building', 'stairway', 'floor', 'door',
      ] },
      { title: 'Data of Employment', fill: 'FFC55A11', keys: [
        'position', 'feor', 'employment_start', 'employment_end',
        'gross_salary', 'residence_purpose',
      ] },
      { title: 'Skills and Experience', fill: 'FF1F6B5C', keys: [
        'occupation_before_arrival', 'hr_previous_employer', 'hr_previous_employment_end',
        'educational_attainment', 'professional_qualification', 'hr_education_completion_date',
        'hr_education_institution', 'hr_education_specialization', 'hr_degree_document_number',
        'mother_tongue', 'speaks_hungarian', 'hr_computer_skills', 'hr_language_skills',
      ] },
      { title: 'Address Abroad', fill: 'FFA6761D', keys: [
        'previous_country', 'previous_town', 'previous_street',
      ] },
      // Ugyanaz a szín, mint az „Identification Numbers"-é – a mintafájlban
      // is így volt, és mivel a két szakasz nem szomszédos, nem okoz zavart.
      { title: 'Information for HR', fill: 'FF1F3864', keys: [
        'hr_bank_account', 'hr_bank_name', 'hr_children', 'hr_department_cost_center',
        'hr_direct_leader', 'hr_sg_category',
      ] },
      // 2026-08-19 (2.): a sürgősségi kontakt ide költözött az „Information
      // for HR"-ből – a felhasználó szerint ide illik jobban.
      { title: 'Contacts', fill: 'FF2E75B6', keys: [
        'email', 'telephone', 'hr_emergency_contact_name', 'hr_emergency_contact_phone',
      ] },
    ],

    /**
     * Mezők, amik a SÉMÁBAN maradnak, de az adatbekérő-exportból szándékosan
     * kimaradnak: ezeket a HR viszi fel utólag, kézzel, a kitöltő nem adja meg
     * őket. (2026-08-18-i döntés – korábban mindkettő benne volt a lakcím-
     * szakaszban.)
     */
    excludeColumns: ['topographical_number', 'other_accommodation'],

    /**
     * Lapvédelem az ÜRES sablonhoz.
     *
     * 2026-08-18-tól KIKAPCSOLVA – szándékos döntés, nem hiba: a védelem soha
     * nem volt biztonsági eszköz (percek alatt megkerülhető), és a kitöltők
     * körében inkább akadályt jelentett, mint hasznot. A `password` és a
     * `fillableRows` a struktúra megtartása végett maradt – ha valaha vissza
     * kell kapcsolni, csak az `enabled`-et kell igazra állítani.
     */
    protection: {
      enabled: false,
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
      // A Data lap védelmétől FÜGGETLEN: ez a képletcellákat óvja a véletlen
      // felülírástól, nem a kitöltőt zavarja – 2026-08-18 után is bekapcsolva
      // marad, még úgy is, hogy a Data lap lapvédelme kikapcsolt.
      protected: true,
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
          { label: 'Bank account number and name of bank:', from: ['hr_bank_account', 'hr_bank_name'] },
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
      // Tartalékszín annak a mezőnek, ami még nincs egyik `sections`
      // szakaszban sem (l. `columnsOf` „végére illesztés") – ezért nincs
      // saját szakaszszíne.
      optionalFill:  'FF1F3864',
      keyRowHeight:     30,
      sectionRowHeight: 20,
      labelRowHeight:   34,
      defaultWidth:   18,
      validationRows: 200,   // meddig terjedjenek a legördülők

      /**
       * Fejlécszín csoportonként – ez CSAK az `Útmutató` munkalap „Csoport"
       * oszlopát színezi (l. `addGuideSheet`). A `Data` lap fejlécének színe
       * 2026-08-19-től a `sections[i].fill`-ből jön (l. `sectionFillOf` a
       * xlsx-write.js-ben) – a kettő emiatt NEM feltétlenül azonos egy adott
       * mezőnél, mert egy szakasz több csoportot is összefoghat (pl. a
       * „Personal Data" az `alap`-ot és a `szuletes`-t is).
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
       * A `sections` szerinti sorrendben a vezeték- és keresztnév már az 1–2.
       * oszlop, ezért elég ennyit fagyasztani – nem kell hét oszlopot állva
       * hagyni, mint a korábbi, hatósági sorrendű elrendezésben.
       */
      freezeColumns: 2,
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
   *
   * A sorrend forrása – ebben a sorrendben próbálkozunk:
   *   1. `profile.columns`     – explicit kulcslista, ha van (semmi mást nem told hozzá)
   *   2. `profile.sections`    – a szakaszok kulcsai összefűzve (ez adja a 2.
   *                              sori szakaszcímeket is, lásd `writeSectionRow`),
   *                              a szakaszokba még be nem sorolt mezők a VÉGÉRE
   *                              kerülnek, hogy egy új sémamező sose vesszen el
   *                              csak azért, mert még nincs szakasza
   *   3. a séma mezősorrendje  – ha egyik sincs
   *
   * Így a `sections` a fő hely, ahol az oszlopsorrendet karban kell tartani –
   * nem kell két, egymástól függő listát (sorrend + szakaszcím) szinkronban
   * tartani. A `profile.excludeColumns` a kivétel: olyan mező, aminek szándékosan
   * NINCS helye az exportban (pl. amit a HR utólag, kézzel visz fel) – ezt a
   * sémából nem törli, csak az adatbekérőből hagyja ki.
   */
  function columnsOf(profile, schema) {
    const stored = schema.fields.filter(f => f.type !== 'computed');

    if (profile.columns) {
      return profile.columns.map(key => stored.find(f => f.key === key)).filter(Boolean);
    }
    if (Array.isArray(profile.sections)) {
      const kizart = new Set(profile.excludeColumns || []);
      const besorolt = profile.sections.flatMap(s => s.keys);
      const rendezett = besorolt.map(key => stored.find(f => f.key === key)).filter(Boolean);
      const lefedve = new Set(besorolt);
      const tobbi = stored.filter(f => !lefedve.has(f.key) && !kizart.has(f.key));
      return rendezett.concat(tobbi);
    }
    return stored;
  }

  return {
    DEFAULT_EXPORT_PROFILES,
    useBackend, load, loadFrom, save, list, get, columnsOf, normalize,
  };
})();
