'use strict';

/**
 * KIINDULÓ SÉMA — csak adat, nem logika.
 *
 * Ez a `munkavallaloi_adatbekero_sablon` 44 mezőjének leképezése. Kizárólag
 * az *első indításkor* kerül felhasználásra: onnantól az élő séma a
 * `data/docgen-config.json` fájlban él, és a Beállítások fülről szerkeszthető.
 * Mezőt felvenni, átnevezni, enum-értéket bővíteni tehát nem itt kell –
 * ez a fájl csak a kezdőállapot.
 *
 * A mezők sorrendje szándékosan az adatbekérő oszlopsorrendje (1–44), mert
 * az export profil ezt veszi alapul. Az űrlap ettől függetlenül a `group`
 * szerint csoportosít.
 *
 * Az enum-értékeknél az `accepts` lista a felismert írásmódokat sorolja. Ez
 * azért fontos, mert a forrásfájl önmagával sincs szinkronban: a cellakomment
 * „ffi"/„noeoe"-t említ, a tényleges legördülő viszont „male"/„female".
 */
const SEED_SCHEMA = {
  version: 1,

  groups: [
    { key: 'alap',          label: 'Alapadatok' },
    { key: 'szuletes',      label: 'Születési adatok' },
    { key: 'azonosito',     label: 'Hatósági azonosítók' },
    { key: 'okmany',        label: 'Okmányok' },
    { key: 'kapcsolat',     label: 'Kapcsolat' },
    { key: 'lakcim',        label: 'Magyarországi lakcím' },
    { key: 'korabbi',       label: 'Korábbi (külföldi) lakcím' },
    { key: 'foglalkoztatas',label: 'Foglalkoztatás' },
    { key: 'vegzettseg',    label: 'Végzettség és nyelv' },
    { key: 'szamitott',     label: 'Számított mezők' },
  ],

  fields: [
    { key: 'personnel_reg_number', group: 'azonosito', type: 'text',
      label: { hu: 'Személyügyi törzsszám', en: 'Personnel Registration Number' },
      tags: ['Törzsszám'] },

    { key: 'surname', group: 'alap', type: 'text', required: true,
      label: { hu: 'Vezetéknév', en: 'Surname (as in passport)' },
      tags: ['Vezetéknév'] },

    { key: 'forename', group: 'alap', type: 'text', required: true,
      label: { hu: 'Keresztnév', en: 'Forename (as in passport)' },
      tags: ['Keresztnév'] },

    { key: 'date_of_birth', group: 'alap', type: 'date', required: true,
      label: { hu: 'Születési idő', en: 'Date of Birth' },
      tags: ['Születési idő'] },

    { key: 'citizenship', group: 'alap', type: 'text', required: true,
      label: { hu: 'Állampolgárság', en: 'Citizenship' },
      tags: ['Állampolgárság'] },

    { key: 'sex', group: 'alap', type: 'enum',
      label: { hu: 'Neme', en: 'Sex' },
      tags: ['Neme', 'Nem'],
      values: [
        { id: 'male',   hu: 'Férfi', en: 'Male',
          accepts: ['male', 'm', 'ferfi', 'ffi', 'férfi'] },
        { id: 'female', hu: 'Nő', en: 'Female',
          accepts: ['female', 'no', 'noeoe', 'nő', 'noi', 'női'] },
      ] },

    { key: 'surname_at_birth', group: 'szuletes', type: 'text',
      label: { hu: 'Születési vezetéknév', en: 'Surname at Birth' },
      tags: ['Születési vezetéknév'] },

    { key: 'forename_at_birth', group: 'szuletes', type: 'text',
      label: { hu: 'Születési keresztnév', en: 'Forename at Birth' },
      tags: ['Születési keresztnév'] },

    { key: 'mothers_surname_at_birth', group: 'szuletes', type: 'text',
      label: { hu: 'Anyja születési vezetékneve', en: "Mother's Maiden Surname" },
      tags: ['Anyja vezetékneve'] },

    { key: 'mothers_forename_at_birth', group: 'szuletes', type: 'text',
      label: { hu: 'Anyja születési keresztneve', en: "Mother's Maiden Forename" },
      tags: ['Anyja keresztneve'] },

    { key: 'place_of_birth_country_hun', group: 'szuletes', type: 'text',
      label: { hu: 'Születési ország', en: 'Place of Birth (country)' },
      tags: ['Születési hely ország'] },

    { key: 'place_of_birth_locality', group: 'szuletes', type: 'text',
      label: { hu: 'Születési hely (település)', en: 'Place of Birth (town)' },
      tags: ['Születési hely város'] },

    { key: 'marital_status', group: 'alap', type: 'enum',
      label: { hu: 'Családi állapot', en: 'Marital Status' },
      tags: ['Családi állapot'],
      values: [
        { id: 'unmarried', hu: 'Nőtlen/hajadon', en: 'Single',
          accepts: ['unmarried', 'single', 'notlen', 'nőtlen', 'hajadon', 'nőtlen/hajadon', 'egyedulallo'] },
        { id: 'married',   hu: 'Házas', en: 'Married',
          accepts: ['married', 'hazas', 'házas'] },
        { id: 'divorced',  hu: 'Elvált', en: 'Divorced',
          accepts: ['divorced', 'elvalt', 'elvált'] },
        { id: 'widow',     hu: 'Özvegy', en: 'Widowed',
          accepts: ['widow', 'widowed', 'ozvegy', 'özvegy'] },
      ] },

    { key: 'pp_number', group: 'okmany', type: 'text',
      label: { hu: 'Útlevélszám', en: 'Number of Passport' },
      tags: ['Útlevél száma'] },

    { key: 'pp_issuance_date', group: 'okmany', type: 'date',
      label: { hu: 'Útlevél kiállítás dátuma', en: 'Issuance Date of Passport' },
      tags: ['Útlevél kiállításának dátuma'] },

    { key: 'pp_validity', group: 'okmany', type: 'date',
      label: { hu: 'Útlevél érvényessége', en: 'Validity of Passport' },
      tags: ['Útlevél lejáratának dátuma'] },

    { key: 'passport_type', group: 'okmany', type: 'enum',
      label: { hu: 'Útlevél típusa', en: 'Type of Passport' },
      tags: ['Útlevél típusa'],
      values: [
        { id: 'private',  hu: 'Magán', en: 'Private',
          accepts: ['private', 'magan', 'magán'] },
        { id: 'official', hu: 'Szolgálati', en: 'Official',
          accepts: ['official', 'service', 'szolgalati', 'szolgálati'] },
      ] },

    { key: 'number_of_rp', group: 'okmany', type: 'text',
      label: { hu: 'Tartózkodási engedély száma', en: 'Number of Residence Permit' },
      tags: ['Tartózkodási engedély száma'] },

    { key: 'expiration_of_rp', group: 'okmany', type: 'date',
      label: { hu: 'Tartózkodási engedély lejárata', en: 'Expiration Date of Residence Permit' },
      tags: ['TE lejárata'] },

    { key: 'tax_number', group: 'azonosito', type: 'text',
      label: { hu: 'Adóazonosító jel', en: 'Tax Number' },
      tags: ['Adószám'] },

    { key: 'TAJ', group: 'azonosito', type: 'text',
      label: { hu: 'TAJ-szám', en: 'TAJ Number' },
      tags: ['TAJ szám'] },

    { key: 'email', group: 'kapcsolat', type: 'text',
      label: { hu: 'E-mail cím', en: 'E-mail address' },
      tags: ['Email cím'] },

    { key: 'telephone', group: 'kapcsolat', type: 'text',
      label: { hu: 'Telefonszám', en: 'Telephone Number' },
      tags: ['Telefonszám'] },

    { key: 'postal_code', group: 'lakcim', type: 'text',
      label: { hu: 'Irányítószám', en: 'Postal Code' },
      tags: ['Állandó lakcím irányítószám'] },

    { key: 'locality', group: 'lakcim', type: 'text',
      label: { hu: 'Település', en: 'Locality (Town)' },
      tags: ['Állandó lakcím település'] },

    { key: 'name_of_public_place', group: 'lakcim', type: 'text',
      label: { hu: 'Közterület neve', en: 'Name of Public Place' },
      tags: ['Állandó lakcím közterület'] },

    { key: 'type_of_public_place', group: 'lakcim', type: 'text',
      label: { hu: 'Közterület jellege', en: 'Type of Public Place' },
      tags: ['Állandó lakcím közterület jellege'] },

    { key: 'street_number', group: 'lakcim', type: 'text',
      label: { hu: 'Házszám', en: 'Street Number' },
      tags: ['Állandó lakcím házszám'] },

    { key: 'building', group: 'lakcim', type: 'text',
      label: { hu: 'Épület', en: 'Building' } },

    { key: 'floor', group: 'lakcim', type: 'text',
      label: { hu: 'Emelet', en: 'Floor' } },

    { key: 'door', group: 'lakcim', type: 'text',
      label: { hu: 'Ajtó', en: 'Door' } },

    { key: 'position', group: 'foglalkoztatas', type: 'text',
      label: { hu: 'Munkakör', en: 'Position' },
      tags: ['Munkakör'] },

    { key: 'feor', group: 'foglalkoztatas', type: 'text',
      label: { hu: 'FEOR-szám', en: 'FEOR' },
      tags: ['FEOR'] },

    { key: 'employment_start', group: 'foglalkoztatas', type: 'date',
      label: { hu: 'Belépés dátuma', en: 'Expected Start of Employment' },
      tags: ['Munkaviszony kezdete'] },

    { key: 'employment_end', group: 'foglalkoztatas', type: 'date',
      label: { hu: 'Kilépés dátuma', en: 'Expected End of Employment' },
      tags: ['Munkaviszony vége'] },

    { key: 'gross_salary', group: 'foglalkoztatas', type: 'number',
      label: { hu: 'Bruttó bér', en: 'Gross Salary' },
      tags: ['Bér', 'Bruttó bér'] },

    { key: 'residence_purpose', group: 'foglalkoztatas', type: 'text',
      label: { hu: 'Tartózkodás célja', en: 'Purpose of Residence' },
      tags: ['Tartózkodás célja'] },

    { key: 'educational_attainment', group: 'vegzettseg', type: 'enum',
      label: { hu: 'Iskolai végzettség', en: 'Highest Educational Attainment' },
      tags: ['Legmagasabb iskolai végzettség megnevezése'],
      values: [
        { id: 'none',      hu: 'Nincs', en: 'None',
          accepts: ['none', 'nincs', 'no education'] },
        { id: 'primary',   hu: 'Alapfokú', en: 'Primary',
          accepts: ['primary', 'elementary', 'elementary school', 'alapfoku', 'alapfokú', 'altalanos iskola'] },
        { id: 'secondary', hu: 'Középfokú', en: 'Secondary',
          accepts: ['secondary', 'high school', 'high school graduation', 'vocational',
                    'vocational school', 'grammar school', 'technical school', 'highschool',
                    'kozepfoku', 'középfokú', 'erettsegi'] },
        { id: 'tertiary',  hu: 'Felsőfokú', en: 'Tertiary',
          accepts: ['tertiary', 'college', 'university', 'higher education',
                    'felsofoku', 'felsőfokú', 'egyetem', 'foiskola', 'főiskola'] },
      ] },

    { key: 'professional_qualification_hun', group: 'vegzettseg', type: 'text',
      label: { hu: 'Szakképesítés', en: 'Professional Qualification' },
      tags: ['Szakképesítés'] },

    { key: 'mother_tongue', group: 'vegzettseg', type: 'text',
      label: { hu: 'Anyanyelv', en: 'Mother Tongue' },
      tags: ['Anyanyelv'] },

    { key: 'speaks_hungarian', group: 'vegzettseg', type: 'enum',
      label: { hu: 'Beszél-e magyarul', en: 'Do you speak Hungarian?' },
      tags: ['Beszél magyarul'],
      values: [
        { id: 'yes', hu: 'Igen', en: 'Yes', accepts: ['yes', 'y', 'igen', 'true', '1'] },
        { id: 'no',  hu: 'Nem',  en: 'No',  accepts: ['no', 'n', 'nem', 'false', '0'] },
      ] },

    { key: 'previous_country_hun', group: 'korabbi', type: 'text',
      label: { hu: 'Korábbi ország', en: 'Previous Address (Country)' },
      tags: ['Korábbi lakcím ország'] },

    { key: 'previous_town', group: 'korabbi', type: 'text',
      label: { hu: 'Korábbi település', en: 'Previous Address (Locality)' },
      tags: ['Korábbi lakcím település'] },

    { key: 'previous_street', group: 'korabbi', type: 'text',
      label: { hu: 'Korábbi utca/cím', en: 'Previous Address (Street)' },
      tags: ['Korábbi lakcím utca'] },

    // ── Számított mezők ──────────────────────────────────────────────────────
    // Nem tárolt adat: más mezőkből állnak elő, és a dokumentum-jelölőkben
    // ugyanúgy használhatók. (A BEVapp-ban ez kódba volt drótozva – itt adat.)
    { key: 'mothers_name', group: 'szamitott', type: 'computed',
      label: { hu: 'Anyja neve', en: "Mother's Name" },
      tags: ['Anyja neve'],
      computed: { from: ['mothers_surname_at_birth', 'mothers_forename_at_birth'], sep: ' ' } },

    { key: 'place_of_birth', group: 'szamitott', type: 'computed',
      label: { hu: 'Születési helye', en: 'Place of Birth' },
      tags: ['Születési helye'],
      computed: { from: ['place_of_birth_country_hun', 'place_of_birth_locality'], sep: ', ' } },

    { key: 'full_name', group: 'szamitott', type: 'computed',
      label: { hu: 'Teljes név', en: 'Full Name' },
      tags: ['Név', 'Teljes név'],
      computed: { from: ['surname', 'forename'], sep: ' ' } },

    { key: 'address', group: 'szamitott', type: 'computed',
      label: { hu: 'Állandó lakcím', en: 'Address' },
      tags: ['Állandó lakcím', 'Lakcím'],
      computed: { from: ['postal_code', 'locality', 'name_of_public_place',
                         'type_of_public_place', 'street_number'], sep: ' ' } },

    { key: 'previous_address', group: 'szamitott', type: 'computed',
      label: { hu: 'Korábbi lakcím', en: 'Previous Address' },
      tags: ['Korábbi lakcím'],
      computed: { from: ['previous_country_hun', 'previous_town', 'previous_street'], sep: ', ' } },
  ],
};
