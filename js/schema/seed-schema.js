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

  // Angol↔magyar szótár a szabad szöveges mezőkhöz (ország, munkakör,
  // szakképesítés…). Ez csak a KIINDULÓ készlet: az első betöltés után az
  // élő szótár a config-fájlban él, és a Beállítások → Szótár lapon bővíthető
  // vagy javítható. Ide csak az kerül, ami minden ügyfélnél ugyanaz.
  //
  // A foglalkozás (occupation_before_arrival) szándékosan hiányzik: az
  // személyenként változik, nincs értelme előre felvenni.
  dictionary: [
    // Hazautazás módja. Nem a kitöltő adja meg: a `transport_type` számított
    // mező az állampolgárságból származtatja, a kimenetet ez fordítja magyarra.
    { en: 'bus',      hu: 'busz' },
    { en: 'airplane', hu: 'repülő' },
    { en: 'plane',    hu: 'repülő' },
    { en: 'train',    hu: 'vonat' },
    { en: 'car',      hu: 'autó' },

    // A leggyakoribb küldő országok
    { en: 'Serbia',      hu: 'Szerbia' },
    { en: 'Ukraine',     hu: 'Ukrajna' },
    { en: 'Philippines', hu: 'Fülöp-szigetek' },
    { en: 'Mexico',      hu: 'Mexikó' },
    { en: 'Brazil',      hu: 'Brazília' },

    // Szakképesítések, amikre a mező útmutatója is példát ad
    { en: 'welder',      hu: 'hegesztő' },
    { en: 'electrician', hu: 'villanyszerelő' },
  ],

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
    { key: 'hr',            label: 'HR-adatok (nem idegenrendészeti)' },
    { key: 'szamitott',     label: 'Számított mezők' },
  ],

  fields: [
    { key: 'personnel_reg_number', group: 'azonosito', type: 'text',
      label: { hu: 'Személyügyi törzsszám', en: 'Personnel Registration Number' },
      hint: { en: 'Personnel registration number used by the employer, if one has already been assigned.\nLeave empty if it is not known yet.' },
      tags: ['Törzsszám'] },

    { key: 'surname', group: 'alap', type: 'text', required: true,
      label: { hu: 'Vezetéknév', en: 'Surname (as in passport)' },
      hint: { en: 'Current family name, spelled exactly as in the passport.\nUse the Latin spelling of the passport\'s data page.' },
      tags: ['Vezetéknév'] },

    { key: 'forename', group: 'alap', type: 'text', required: true,
      label: { hu: 'Keresztnév', en: 'Forename (as in passport)' },
      hint: { en: 'Current given name(s), spelled exactly as in the passport.\nEnter all given names, in the passport\'s order.' },
      tags: ['Keresztnév'] },

    { key: 'date_of_birth', group: 'alap', type: 'date', required: true,
      label: { hu: 'Születési idő', en: 'Date of Birth' },
      hint: { en: 'Date format: YYYY-MM-DD\nExample: 1990-03-15' },
      tags: ['Születési idő'] },

    { key: 'citizenship', group: 'alap', type: 'text', required: true,
      label: { hu: 'Állampolgárság', en: 'Citizenship' },
      hint: { en: 'Country of citizenship, written in HUNGARIAN.\nExample: Szerbia, Ukrajna, Fulop-szigetek\nIn case of dual citizenship, enter the one in the passport used for this application.' },
      tags: ['Állampolgárság'] },

    { key: 'sex', group: 'alap', type: 'enum',
      label: { hu: 'Neme', en: 'Sex' },
      hint: { en: 'Choose from the drop-down list:\nmale / female' },
      tags: ['Neme', 'Nem'],
      values: [
        { id: 'male',   hu: 'Férfi', en: 'Male',
          accepts: ['male', 'm', 'ferfi', 'ffi', 'férfi'] },
        { id: 'female', hu: 'Nő', en: 'Female',
          accepts: ['female', 'no', 'noeoe', 'nő', 'noi', 'női'] },
      ] },

    { key: 'surname_at_birth', group: 'szuletes', type: 'text',
      label: { hu: 'Születési vezetéknév', en: 'Surname at Birth' },
      hint: { en: 'Family name at birth, if it differs from the current one (e.g. before marriage).\nIf it is the same, repeat the current family name.' },
      tags: ['Születési vezetéknév'] },

    { key: 'forename_at_birth', group: 'szuletes', type: 'text',
      label: { hu: 'Születési keresztnév', en: 'Forename at Birth' },
      hint: { en: 'Given name at birth, if it differs from the current one.\nIf it is the same, repeat the current given name.' },
      tags: ['Születési keresztnév'] },

    { key: 'mothers_surname_at_birth', group: 'szuletes', type: 'text',
      label: { hu: 'Anyja születési vezetékneve', en: "Mother's Maiden Surname" },
      hint: { en: 'The mother\'s family name at birth (maiden name), not her married name.' },
      tags: ['Anyja vezetékneve'] },

    { key: 'mothers_forename_at_birth', group: 'szuletes', type: 'text',
      label: { hu: 'Anyja születési keresztneve', en: "Mother's Maiden Forename" },
      hint: { en: 'The mother\'s given name at birth.' },
      tags: ['Anyja keresztneve'] },

    { key: 'place_of_birth_country', group: 'szuletes', type: 'text',
      label: { hu: 'Születési ország', en: 'Place of Birth (country)' },
      hint: { en: 'Country of birth. English is fine – the Hungarian form comes from the dictionary.\nExample: Serbia, Ukraine\nUse the country\'s current name.' },
      tags: ['Születési hely ország', 'place_of_birth_country_hun'] },

    { key: 'place_of_birth_locality', group: 'szuletes', type: 'text',
      label: { hu: 'Születési hely (település)', en: 'Place of Birth (town)' },
      hint: { en: 'Town or city of birth, exactly as in the passport.' },
      tags: ['Születési hely város'] },

    { key: 'marital_status', group: 'alap', type: 'enum',
      label: { hu: 'Családi állapot', en: 'Marital Status' },
      hint: { en: 'Choose from the drop-down list:\nmarried / unmarried / widow / divorced' },
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
      hint: { en: 'Passport number exactly as printed, without spaces.' },
      tags: ['Útlevél száma'] },

    { key: 'pp_issuance_date', group: 'okmany', type: 'date',
      label: { hu: 'Útlevél kiállítás dátuma', en: 'Issuance Date of Passport' },
      hint: { en: 'The date the passport was issued.\nFormat: YYYY-MM-DD (e.g. 2021-06-30)' },
      // A `pp_issuance` alias miatt a formanyomtatvány {{pp_issuance_year}}
      // alakú jelölői is feloldódnak, nem csak a {{pp_issuance_date_year}}.
      tags: ['Útlevél kiállításának dátuma', 'pp_issuance'] },

    { key: 'pp_issuance_place', group: 'okmany', type: 'text',
      label: { hu: 'Útlevél kiállításának helye', en: 'Place of Issuance of Passport' },
      hint: { en: 'The authority or place that issued the passport, as printed in it.\nExample: Beograd, MUP Subotica' },
      tags: ['Útlevél kiállításának helye'] },

    { key: 'pp_validity', group: 'okmany', type: 'date',
      label: { hu: 'Útlevél érvényessége', en: 'Validity of Passport' },
      hint: { en: 'The date the passport expires.\nFormat: YYYY-MM-DD (e.g. 2031-06-29)' },
      tags: ['Útlevél lejáratának dátuma'] },

    { key: 'passport_type', group: 'okmany', type: 'enum',
      label: { hu: 'Útlevél típusa', en: 'Type of Passport' },
      hint: { en: 'Choose from the drop-down list:\nprivate / official' },
      tags: ['Útlevél típusa'],
      values: [
        { id: 'private',  hu: 'Magán', en: 'Private',
          accepts: ['private', 'magan', 'magán'] },
        { id: 'official', hu: 'Szolgálati', en: 'Official',
          accepts: ['official', 'service', 'szolgalati', 'szolgálati'] },
      ] },

    { key: 'number_of_rp', group: 'okmany', type: 'text',
      label: { hu: 'Tartózkodási engedély száma', en: 'Number of Residence Permit' },
      hint: { en: 'Number of the current Hungarian residence permit, if the employee already has one.\nLeave empty if there is none yet.' },
      tags: ['Tartózkodási engedély száma'] },

    { key: 'expiration_of_rp', group: 'okmany', type: 'date',
      label: { hu: 'Tartózkodási engedély lejárata', en: 'Expiration Date of Residence Permit' },
      hint: { en: 'Expiry date of the current residence permit.\nFormat: YYYY-MM-DD\nLeave empty if there is no permit yet.' },
      tags: ['TE lejárata'] },

    { key: 'tax_number', group: 'azonosito', type: 'text',
      label: { hu: 'Adóazonosító jel', en: 'Tax Number' },
      hint: { en: 'Hungarian tax identification number (adoazonosito jel), 10 digits.\nLeave empty if it has not been issued yet.' },
      tags: ['Adószám'] },

    { key: 'TAJ', group: 'azonosito', type: 'text',
      label: { hu: 'TAJ-szám', en: 'TAJ Number' },
      hint: { en: 'Hungarian social security number (TAJ), 9 digits.\nLeave empty if it has not been issued yet.' },
      tags: ['TAJ szám'] },

    { key: 'email', group: 'kapcsolat', type: 'text',
      label: { hu: 'E-mail cím', en: 'E-mail address' },
      hint: { en: 'An e-mail address the employee can actually be reached at. One address only.' },
      tags: ['Email cím'] },

    { key: 'telephone', group: 'kapcsolat', type: 'text',
      label: { hu: 'Telefonszám', en: 'Telephone Number' },
      hint: { en: 'Phone number in international format.\nExample: +36301234567' },
      tags: ['Telefonszám'] },

    { key: 'postal_code', group: 'lakcim', type: 'text',
      label: { hu: 'Irányítószám', en: 'Postal Code' },
      hint: { en: 'Postal code of the Hungarian address, 4 digits.\nExample: 1052' },
      tags: ['Állandó lakcím irányítószám'] },

    { key: 'locality', group: 'lakcim', type: 'text',
      label: { hu: 'Település', en: 'Locality (Town)' },
      hint: { en: 'Town or city of the Hungarian address, without the district.\nExample: Budapest' },
      tags: ['Állandó lakcím település'] },

    { key: 'name_of_public_place', group: 'lakcim', type: 'text',
      label: { hu: 'Közterület neve', en: 'Name of Public Place' },
      hint: { en: 'The name of the street or square ONLY, without its type.\nExample: for \'Kossuth Lajos utca\' enter: Kossuth Lajos' },
      tags: ['Állandó lakcím közterület'] },

    { key: 'type_of_public_place', group: 'lakcim', type: 'text',
      label: { hu: 'Közterület jellege', en: 'Type of Public Place' },
      hint: { en: 'The type of the public place ONLY, in Hungarian.\nExample: utca, ter, ut, korut, sor' },
      tags: ['Állandó lakcím közterület jellege'] },

    { key: 'street_number', group: 'lakcim', type: 'text',
      label: { hu: 'Házszám', en: 'Street Number' },
      hint: { en: 'House number.\nExample: 12  or  12/B' },
      tags: ['Állandó lakcím házszám'] },

    { key: 'building', group: 'lakcim', type: 'text',
      label: { hu: 'Épület', en: 'Building' },
      hint: { en: 'Building marking, if any.\nExample: A\nLeave empty if not applicable.' } },

    { key: 'stairway', group: 'lakcim', type: 'text',
      label: { hu: 'Lépcsőház', en: 'Stairway' },
      hint: { en: 'Stairway marking, if any.\nExample: II\nLeave empty if not applicable.' } },

    { key: 'floor', group: 'lakcim', type: 'text',
      label: { hu: 'Emelet', en: 'Floor' },
      hint: { en: 'Floor, if any.\nExample: 3  or  fszt.\nLeave empty if not applicable.' } },

    { key: 'door', group: 'lakcim', type: 'text',
      label: { hu: 'Ajtó', en: 'Door' },
      hint: { en: 'Door number, if any.\nExample: 14\nLeave empty if not applicable.' } },

    { key: 'topographical_number', group: 'lakcim', type: 'text',
      label: { hu: 'Helyrajzi szám', en: 'Topographical LOT Number' },
      hint: { en: 'Parcel identification / land register reference number of the accommodation, if known.\nExample: 12345/6\nLeave empty if it is not known.' },
      tags: ['Helyrajzi szám'] },

    { key: 'other_accommodation', group: 'lakcim', type: 'text',
      label: { hu: 'Egyéb jogcím a szálláson', en: 'Other Legal Title of Residence' },
      hint: { en: 'Only if the legal title of residence is none of owner / (sub)tenant / family member / courtesy user.\nDescribe it in one short phrase.\nLeave empty otherwise.' } },

    { key: 'position', group: 'foglalkoztatas', type: 'text',
      label: { hu: 'Munkakör', en: 'Position' },
      hint: { en: 'Job title, written in HUNGARIAN, exactly as in the employment contract.\nExample: gepkezelo, minosegellenor' },
      tags: ['Munkakör'] },

    { key: 'feor', group: 'foglalkoztatas', type: 'text',
      label: { hu: 'FEOR-szám', en: 'FEOR' },
      hint: { en: 'The 4-digit Hungarian FEOR occupation code, if known.\nExample: 8121' },
      tags: ['FEOR'] },

    { key: 'employment_start', group: 'foglalkoztatas', type: 'date',
      label: { hu: 'Belépés dátuma', en: 'Expected Start of Employment' },
      hint: { en: 'Planned first day of work.\nFormat: YYYY-MM-DD' },
      tags: ['Munkaviszony kezdete'] },

    { key: 'employment_end', group: 'foglalkoztatas', type: 'date',
      label: { hu: 'Kilépés dátuma', en: 'Expected End of Employment' },
      hint: { en: 'Planned last day of work.\nFormat: YYYY-MM-DD\nLeave empty for an open-ended contract.' },
      tags: ['Munkaviszony vége'] },

    { key: 'gross_salary', group: 'foglalkoztatas', type: 'number',
      label: { hu: 'Bruttó bér', en: 'Gross Salary' },
      hint: { en: 'Gross monthly salary in HUF, digits only, without currency sign or spaces.\nExample: 450000' },
      tags: ['Bér', 'Bruttó bér'] },

    { key: 'residence_purpose', group: 'foglalkoztatas', type: 'text',
      label: { hu: 'Tartózkodás célja', en: 'Purpose of Residence' },
      hint: { en: 'The purpose of the stay in Hungary.\nFor a work-related application: employment' },
      tags: ['Tartózkodás célja'] },

    { key: 'educational_attainment', group: 'vegzettseg', type: 'enum',
      label: { hu: 'Iskolai végzettség', en: 'Highest Educational Attainment' },
      hint: { en: 'Choose from the drop-down list:\nprimary / secondary / tertiary / none' },
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

    { key: 'professional_qualification', group: 'vegzettseg', type: 'text',
      label: { hu: 'Szakképesítés', en: 'Professional Qualification' },
      hint: { en: 'Profession or qualification as in the diploma or certificate. English is fine – the Hungarian form comes from the dictionary.\nExample: welder, electrician\nLeave empty if there is none.' },
      tags: ['Szakképesítés', 'professional_qualification_hun'] },

    { key: 'occupation_before_arrival', group: 'vegzettseg', type: 'text',
      label: { hu: 'Foglalkozás Magyarországra érkezés előtt', en: 'Occupation before Arriving in Hungary' },
      hint: { en: 'What the employee did for a living before coming to Hungary. English is fine – the Hungarian form comes from the dictionary.\nExample: welder, student, unemployed' },
      tags: ['Korábbi foglalkozás'] },

    { key: 'mother_tongue', group: 'vegzettseg', type: 'text',
      label: { hu: 'Anyanyelv', en: 'Mother Tongue' },
      hint: { en: 'The employee\'s native language.\nExample: Serbian' },
      tags: ['Anyanyelv'] },

    { key: 'speaks_hungarian', group: 'vegzettseg', type: 'enum',
      label: { hu: 'Beszél-e magyarul', en: 'Do you speak Hungarian?' },
      hint: { en: 'Choose from the drop-down list:\nyes / no' },
      tags: ['Beszél magyarul'],
      values: [
        { id: 'yes', hu: 'Igen', en: 'Yes', accepts: ['yes', 'y', 'igen', 'true', '1'] },
        { id: 'no',  hu: 'Nem',  en: 'No',  accepts: ['no', 'n', 'nem', 'false', '0'] },
      ] },

    { key: 'previous_country', group: 'korabbi', type: 'text',
      label: { hu: 'Korábbi ország', en: 'Previous Address (Country)' },
      hint: { en: 'Country of the last address abroad. English is fine – the Hungarian form comes from the dictionary.\nExample: Serbia' },
      tags: ['Korábbi lakcím ország', 'previous_country_hun'] },

    { key: 'previous_town', group: 'korabbi', type: 'text',
      label: { hu: 'Korábbi település', en: 'Previous Address (Locality)' },
      hint: { en: 'Town or city of the last address abroad.' },
      tags: ['Korábbi lakcím település'] },

    { key: 'previous_street', group: 'korabbi', type: 'text',
      label: { hu: 'Korábbi utca/cím', en: 'Previous Address (Street)' },
      hint: { en: 'Street name and house number of the last address abroad, in this one cell.' },
      tags: ['Korábbi lakcím utca'] },


    // ── HR-adatok ────────────────────────────────────────────────────────────
    // A HR korábbi „Personal Data Sheet" álló űrlapjának azon rovatai, amiknek
    // NINCS párja a fenti idegenrendészeti adatkörben. Azért kerültek ide, hogy
    // egy táblázat menjen ki a munkavállalóhoz, ne kettő.
    //
    // Egyetlen dokumentum-jelölő sem hivatkozik rájuk, számított mező sem
    // épít rájuk – a DocGen tárolja és visszaexportálja őket, de az
    // idegenrendészeti iratokba nem kerülnek.
    //
    // A `hr_` prefix nem kozmetika: az importáló a fejlécet kulcs, majd
    // magyar/angol címke és jelölő szerint próbálja mezőhöz kötni
    // (xlsx-read.js matchByLabel). A prefixelt kulcs és a máshol nem használt
    // címkék zárják ki, hogy egy HR-rovat véletlenül egy idegenrendészeti
    // mezőbe költözzön. Új HR-mezőnél ez a szabály: egyedi kulcs, egyedi
    // magyar ÉS angol címke, jelölő (tag) nélkül.
    { key: 'hr_emergency_contact_name', group: 'hr', type: 'text',
      label: { hu: 'Vészhelyzeti kapcsolattartó neve', en: 'Emergency Contact — Name' },
      hint: { en: 'Who should we call if something happens to you at work?\nFull name of one person.' } },

    { key: 'hr_emergency_contact_phone', group: 'hr', type: 'text',
      label: { hu: 'Vészhelyzeti kapcsolattartó telefonszáma', en: 'Emergency Contact — Phone' },
      hint: { en: 'Phone number of the person above, in international format.\nExample: +36301234567' } },

    { key: 'hr_dual_citizenship', group: 'hr', type: 'text',
      label: { hu: 'Kettős állampolgárság', en: 'Dual Citizenship' },
      hint: { en: 'If you hold a second citizenship, name that country.\nLeave empty if you have only one.' } },

    { key: 'hr_id_number', group: 'hr', type: 'text',
      label: { hu: 'Személyi igazolvány száma', en: 'Identity Card Number' },
      hint: { en: 'Number of your national identity card (not the passport, not the residence permit).\nLeave empty if you do not have one.' } },

    { key: 'hr_bank_account', group: 'hr', type: 'text',
      label: { hu: 'Bankszámlaszám és a bank neve', en: 'Bank Account Number and Name of Bank' },
      hint: { en: 'The account your salary should be paid to, and the name of the bank.\nIBAN is preferred.\nExample: HU42 1177 3016 1111 1018 0000 0000 - OTP Bank' } },

    { key: 'hr_education_completion_date', group: 'hr', type: 'date',
      label: { hu: 'Végzettség megszerzésének dátuma', en: 'Date of Completion of Education' },
      hint: { en: 'When you finished your highest education.\nFormat: YYYY-MM-DD' } },

    { key: 'hr_education_institution', group: 'hr', type: 'text',
      label: { hu: 'Oktatási intézmény, szak neve', en: 'Name of Educational Institution and Faculty' },
      hint: { en: 'Name of the school or university, and the faculty.\nWrite it as it appears on the certificate.' } },

    { key: 'hr_education_specialization', group: 'hr', type: 'text',
      label: { hu: 'Végzett szakirány', en: 'Graduated Specialization' },
      hint: { en: 'The specialization you graduated in.\nExample: mechanical engineering' } },

    { key: 'hr_degree_document_number', group: 'hr', type: 'text',
      label: { hu: 'Oklevél/bizonyítvány száma', en: 'Document Number of Degree or Certificate' },
      hint: { en: 'The serial number printed on your diploma or certificate.' } },

    { key: 'hr_computer_skills', group: 'hr', type: 'text',
      label: { hu: 'Számítástechnikai ismeretek', en: 'Computer Skills' },
      hint: { en: 'Software you can use, in one cell, separated by commas.\nExample: Excel, SAP, AutoCAD\nWrite "none" if you have none.' } },

    // A nyelvvizsgák és a gyerekek a HR űrlapján több sort kaptak. Egy
    // „egy sor = egy ember" táblázatban ismétlődő blokk nem tárolható, ezért
    // egyetlen szabad szöveges cellába kerülnek. Gépi feldolgozásra így nem
    // alkalmasak – a HR olvassa el. Ha ez később kevés, fix rekeszekre kell
    // bontani (hr_language_1_name, _level, _exam …).
    { key: 'hr_language_skills', group: 'hr', type: 'text',
      label: { hu: 'Nyelvtudás (nyelv / szint / vizsga)', en: 'Language Skills (language / level / exam)' },
      hint: { en: 'All your languages in THIS ONE CELL. For each: language, level, type of exam.\nSeparate them with a semicolon.\nExample: English, B2, IELTS; German, A2, no exam' } },

    { key: 'hr_children', group: 'hr', type: 'text',
      label: { hu: 'Gyermekek (név, születési idő)', en: 'Children (name, date of birth)' },
      hint: { en: 'All your children in THIS ONE CELL: name and date of birth for each.\nSeparate them with a semicolon.\nExample: Anna Kovacs, 2015-04-02; Peter Kovacs, 2019-11-30\nWrite "none" if you have no children.' } },

    { key: 'hr_previous_employer', group: 'hr', type: 'text',
      label: { hu: 'Előző munkáltató', en: 'Previous Employer' },
      hint: { en: 'Name of the company you worked for before this job.' } },

    { key: 'hr_professional_background', group: 'hr', type: 'text',
      label: { hu: 'Szakmai előzmények', en: 'Professional Background' },
      hint: { en: 'Short summary of your work experience, in one cell.\nExample: 6 years welder at ABC Ltd, 2 years machine operator' } },

    { key: 'hr_previous_employment_end', group: 'hr', type: 'date',
      label: { hu: 'Előző munkaviszony megszűnésének dátuma', en: 'End Date of Previous Employment' },
      hint: { en: 'The last day of your previous employment.\nFormat: YYYY-MM-DD' } },

    // Az utolsó három rovatot a HR tölti ki, nem a munkavállaló. Az útmutató
    // ezt ki is írja, hogy a kitöltő ne találgasson.
    { key: 'hr_department_cost_center', group: 'hr', type: 'text',
      label: { hu: 'Szervezeti egység, költséghely', en: 'Department and Cost Center (filled by HR)' },
      hint: { en: 'FILLED BY HR — please leave empty.' } },

    { key: 'hr_direct_leader', group: 'hr', type: 'text',
      label: { hu: 'Közvetlen vezető', en: 'Direct Leader (filled by HR)' },
      hint: { en: 'FILLED BY HR — please leave empty.' } },

    { key: 'hr_sg_category', group: 'hr', type: 'text',
      label: { hu: 'SG kategória', en: 'SG Category (filled by HR)' },
      hint: { en: 'FILLED BY HR — please leave empty.' } },


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
      computed: { from: ['place_of_birth_country', 'place_of_birth_locality'], sep: ', ' } },

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
      computed: { from: ['previous_country', 'previous_town', 'previous_street'], sep: ', ' } },

    // A hatósági űrlap 5. pontja: mivel utazik haza a tartózkodás lejártakor.
    // NEM kérdezzük meg a kitöltőtől: az állampolgárságból következik, a
    // szomszédos országokból busszal, távolabbról repülővel megy haza az ember.
    // A lista a Beállítások → Séma lapon bővíthető, ha új küldő ország jön.
    { key: 'transport_type', group: 'szamitott', type: 'computed',
      label: { hu: 'Hazautazás módja', en: 'Means of Transport' },
      tags: ['Közlekedési eszköz'],
      computed: {
        from: ['citizenship'],
        lookup: {
          bus: ['Ausztria', 'Szlovákia', 'Ukrajna', 'Románia',
                'Szerbia', 'Horvátország', 'Szlovénia'],
        },
        default: 'airplane',
      } },
  ],
};
