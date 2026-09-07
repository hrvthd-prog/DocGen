'use strict';

/**
 * ENTER HUNGARY ŰRLAPLEÍRÁS — csak adat, nem logika.
 *
 * Az enterhungary.gov.hu kitöltendő rovatai abban a sorrendben, ahogy az
 * oldalon végighaladsz. A leírás célja, hogy a DocGen az EH sorrendjében
 * mutassa a munkavállaló adatait, és egy kattintással másolhatóvá tegye.
 *
 * A váz a mentett HTML-ekből származik (2026-09-01 és 09-04): a `panel`-ek az
 * EH panelcímei, az `eh` a mező `name` attribútuma, a `label` a látható
 * címke, a `req` az EH `*` jelölése, a `max` a `maxlength`. Ezeket NE írd át
 * kézzel az EH ellenőrzése nélkül — a mezőnév a horgony, amire egy későbbi
 * automatizálás is épülhet.
 *
 * A KÉT SORFAJTA nem egyenrangú:
 *   - másolható (`<input type=text>`): a vágólapról bekerül az érték. Ez a
 *     funkció lényege, ide megy a munka.
 *   - listás (`list:` kulcs — legördülő, rádiógomb, checkbox): oda a
 *     vágólapról NEM lehet értéket tenni, a kitöltés ott mindenképp kézi.
 *     Ezért listás mezőre nem építünk átalakító logikát: a panel megmutatja a
 *     tárolt értéket és egy tippet, semmi többet.
 *
 * Sorkulcsok:
 *   eh        az EH `name` attribútuma
 *   label     az EH-n látható címke, szó szerint
 *   req       az EH-n `*`-gal jelölt kötelező mező
 *   key       DocGen sémakulcs, ahonnan az érték jön
 *   fallback  másodlagos sémakulcs, ha a `key` üres
 *   employer  a EH_EMPLOYER blokk útvonala (cégadat)
 *   const     minden kérelemnél ugyanaz az érték
 *   fromCase  az ügyből jövő érték
 *   setting   a Beállítások fülön megadott érték (Settings.ehContact)
 *   manual    nincs a DB-ben, kézzel töltendő
 *   list      listás mező; az értéke a soron megjelenő tipp, vagy `true`
 *   dict      a szótár fordítsa magyarra
 *   max       az EH `maxlength`-je — csak másolható mezőn, a hosszjelzéshez
 *   unsure    fogalmilag nem pontosan ugyanaz — ellenőrizd
 *   only      csak ezeken a jogcímeken jelenik meg
 *   note      egymondatos megjegyzés a soron
 */

/**
 * A munkáltató adatai — EH-ALAKBAN, nem a cégkivonatéban.
 *
 * Ez nem stílus kérdése: az EH `pattern` attribútummal validál, és a rossz
 * alakot a böngésző elutasítja. A KSH-szám mintája `\d{8} \d{4} \d{3} [012]\d`,
 * vagyis SZÓKÖZÖS — a cégkivonat viszont kötőjellel írja. Az adószámé
 * fordítva: `\d{10}|\d{8}-\d-\d\d`, ott a kötőjel kell. Ezért itt eleve a
 * helyes alak áll: nincs futásidejű átalakítás, egy adat egy alakban.
 *
 * Forrás: Tárolt cégkivonat 19-09-503741, hatályos 2026-08-30.
 */
const EH_EMPLOYER = {
  // A teljes név („AUMOVIO Hungary Korlátolt Felelősségű Társaság") 47 karakter,
  // az EH rovata 40-et enged — a cégkivonat 3/3. pontja szerinti rövidített alak:
  nev:      'AUMOVIO Hungary Kft.',
  adoszam:  '10518869-2-19',            // cégkivonat 21/6.
  kshszam:  '10518869 2611 113 19',     // cégkivonat 20/3. — ott: 10518869-2611-113-19
  teaor:    '2611',                     // TEÁOR'25 főtevékenység: Elektronikai alkatrész gyártása
  foglkoztatotip: 'kedvezményes foglalkoztató, amely a Kormánnyal érvényes '
                + 'stratégiai partnerségi megállapodással rendelkezik',

  // Cégkivonat 5/5.: 8200 Veszprém, Házgyári út 6-8.
  // A közterület neve a JELLEG NÉLKÜL megy — a jelleg külön legördülő.
  szekhely: {
    iranyitoszam: '8200', telepules: 'Veszprém', kerulet: '',
    kozteruletneve: 'Házgyári', kozteruletjellege: 'Út',
    hazszam: '6-8.', epulet: '', lepcsohaz: '', emelet: '', ajto: '',
  },

  // A munkavégzés tényleges helye ÉS a foglalkoztató levelezési címe.
  // Cégkivonat 7/2. szerint fióktelep; az EH-t a jogi besorolás nem érdekli.
  // A `kerulet` a levelezési blokkhoz kell — a munkavégzési blokkban nincs
  // ilyen rovat az EH-n, oda a panel egyszerűen nem hoz sort.
  munkavegzes: {
    iranyitoszam: '1106', telepules: 'Budapest', kerulet: 'X.',
    kozteruletneve: 'Napmátka', kozteruletjellege: 'Utca',
    hazszam: '6.', epulet: '', lepcsohaz: '', emelet: '', ajto: '',
  },

  // Ugyanaz a cím — hivatkozás, nem másolat, hogy ne csússzon szét.
  levelezesi: 'munkavegzes',
};

const EhForms = (() => {

  /** A választható jogcímek. A fő űrlap mindnél közös, ezért nincs köztük. */
  const JOGCIMEK = [
    { id: 'c7',  tipus: 'tartcelharm-c7',  label: 'Vendégmunkás-tartózkodási engedély' },
    { id: 'c9',  tipus: 'tartcelharm-c9',  label: 'EU Kék Kártya' },
    { id: 'c12', tipus: 'tartcelharm-c12', label: 'Nemzeti Kártya' },
  ];

  /**
   * A fő űrlap (`tipus=tartcelharm`). Minden jogcímnél ugyanez: az EH-n a
   * `tipus` generikus, a jogcímet egy külön `tartcel` rejtett mező hordozza.
   *
   * A 8 eltartott hozzátartozó blokkja (8 × 19 rovat) NINCS benne: a DB
   * `hr_children` mezője szabad szöveg, gépi leképezés nem lehetséges. Egy
   * sor képviseli, a nyers szöveggel.
   */
  const FO_ROWS = [
    { panel: 'Tartózkodási engedély első kérelem/hosszabbítás' },
    { eh: 'nemfizetek', label: 'Kijelentem, hogy az eljárás díjmentes.', req: true,
      const: 'nem', list: true },
    { eh: 'tartenghosszab', label: 'Tartózkodási engedély meghosszabbítása', req: true,
      fromCase: 'hosszabbitas', list: true },
    { eh: 'beutazashelye', label: 'beutazás helye', manual: true },
    { eh: 'beutazasideje', label: 'beutazás ideje', manual: true },
    { eh: 'elozotarengszama', label: 'előző tartózkodási engedély száma ', req: true,
      key: 'number_of_rp' },
    { eh: 'elozotarengideje', label: 'előző tartózkodási engedély érvényességi ideje', req: true,
      key: 'expiration_of_rp' },

    { panel: 'A kérelmező személyes adatai' },
    { eh: 'kerelmezonevelotag', label: 'előnév', manual: true },
    { eh: 'kerelmezonevelotag2', label: 'előnév', manual: true },
    { eh: 'kerelmezocsaladnev', label: 'családi név (útlevél szerint)', req: true,
      key: 'surname' },
    { eh: 'kerelmezoutonev', label: 'utónév (útlevél szerint)', req: true, key: 'forename' },
    { eh: 'kerelmezoszulcsaladnev', label: 'születési családi név', req: true,
      key: 'surname_at_birth' },
    { eh: 'kerelmezoszulutonev', label: 'születési utónév', req: true,
      key: 'forename_at_birth' },
    { eh: 'kerelmezoanyjacsaladnev', label: 'anyja születési családi neve', req: true,
      key: 'mothers_surname_at_birth' },
    { eh: 'kerelmezoanyjautonev', label: 'anyja születési utóneve', req: true,
      key: 'mothers_forename_at_birth' },
    { eh: 'kerelmezoszulorszag', label: 'születési ország', req: true,
      key: 'place_of_birth_country', list: true, dict: true },
    { eh: 'kerelmezoszulhely', label: 'születési város', req: true,
      key: 'place_of_birth_locality' },
    { eh: 'kerelmezoszulido', label: 'születési idő', req: true, key: 'date_of_birth' },
    { eh: 'kerelmezonem', label: 'neme', req: true, key: 'sex', list: true },
    { eh: 'kerelmezoap', label: 'állampolgárság', req: true,
      key: 'citizenship', list: 'melléknévi alakot kér: Szerbia → Szerb' },
    { eh: 'kerelmezonemzetiseg', label: 'nemzetisége', manual: true, list: true },
    { eh: 'csaladiallapot', label: 'családi állapot', req: true,
      key: 'marital_status', list: true },
    { eh: 'szakkepzettseg', label: 'szakképzettsége', req: true,
      key: 'professional_qualification', dict: true },
    { eh: 'vegzettseg', label: 'iskolai végzettsége', req: true,
      key: 'educational_attainment', list: true },
    { eh: 'kerelmezokulfoldifoglakozas', label: 'Magyarországra érkezést megelőző foglalkozás', req: true,
      key: 'occupation_before_arrival', dict: true, max: '30' },

    { panel: 'A kérelmező útlevelének adatai' },
    { eh: 'utlevelszama', label: 'útlevél száma', req: true, key: 'pp_number' },
    { eh: 'utleveltipus', label: 'útlevél típusa', req: true,
      key: 'passport_type', list: 'a Szolgálati itt „Szolgálati Útlevél"' },
    { eh: 'utleveltipusegyeb', label: 'éspedig', manual: true },
    { eh: 'kiallitashelye', label: 'kiállításának helye', req: true,
      key: 'pp_issuance_place' },
    { eh: 'kiallitasideje', label: 'kiállításának ideje', req: true,
      key: 'pp_issuance_date' },
    { eh: 'ervenyessegiideje', label: 'érvényességi ideje', req: true, key: 'pp_validity' },

    { panel: 'A kérelmező magyarországi szálláshelyének adatai' },
    { eh: 'iranyitoszam', label: 'irányítószám', req: true, key: 'postal_code' },
    { eh: 'telepules', label: 'település', req: true, key: 'locality', max: '27' },
    { eh: 'kozteruletneve', label: 'közterület neve', req: true,
      key: 'name_of_public_place', max: '25' },
    { eh: 'kozteruletjellege', label: 'közterület jellege', req: true,
      key: 'type_of_public_place', list: 'a listában kisbetűs' },
    { eh: 'hazszam', label: 'házszám/helyrajzi szám', req: true,
      key: 'street_number', max: '8', fallback: 'topographical_number' },
    { eh: 'epulet', label: 'épület', key: 'building' },
    { eh: 'lepcsohaz', label: 'lépcsőház', key: 'stairway', max: '4' },
    { eh: 'emelet', label: 'emelet', key: 'floor', list: '01…19 vagy földszint' },
    { eh: 'ajto', label: 'ajtó', key: 'door', max: '4' },
    { eh: 'tartjogcim', label: 'tartózkodás jogcíme', req: true, manual: true, list: true },
    { eh: 'tartjogcimegyeb', label: 'éspedig', key: 'other_accommodation' },

    { panel: 'Teljes körű egészségbiztosítás feltételei' },
    { eh: 'ebmagyartart', label: 'Magyarországi tartózkodása idejére rendelkezik-e teljes körű egészségbiztosítással?', req: true,
      const: 'Foglalkoztatási Jogviszony Alapján', list: true },
    { eh: 'ebmagyartartegyeb', label: 'éspedig', manual: true },

    { panel: 'A vissza- vagy továbbutazás feltételei' },
    { eh: 'tovabborszag', label: 'Jogszerű tartózkodása lejártakor mely országba utazik vissza vagy tovább?', req: true,
      key: 'citizenship', list: 'itt országnév kell (Szerbia)' },
    { eh: 'mivel', label: 'Milyen közlekedési eszközzel?', key: 'transport_type',
      dict: true },
    { eh: 'utlevel', label: 'Útlevél', req: true, manual: true, list: true },
    { eh: 'vizum', label: 'vízummal?', req: true, manual: true, list: true },
    { eh: 'jegy', label: 'menetjeggyel?', req: true, manual: true, list: true },
    { eh: 'penz', label: 'anyagi fedezettel?', req: true, manual: true, list: true },
    { eh: 'osszeg', label: 'összeg', manual: true },
    { eh: 'osszegpenznem', label: 'pénznem', manual: true, list: true },

    { panel: 'Amennyiben a Kérelmezönek van eltartott házastársa, gyermeke, szülöje, válassza ki a megfelelö számú hozzátartózót!' },

    { panel: 'Kérelmező eltartott házastársa, gyermeke, szülője' },

    { panel: 'Kérelmező eltartott házastársa, gyermeke, szülője' },

    { panel: 'Kérelmező eltartott házastársa, gyermeke, szülője' },

    { panel: 'Kérelmező eltartott házastársa, gyermeke, szülője' },

    { panel: 'Kérelmező eltartott házastársa, gyermeke, szülője' },

    { panel: 'Kérelmező eltartott házastársa, gyermeke, szülője' },

    { panel: 'Kérelmező eltartott házastársa, gyermeke, szülője' },

    { panel: 'Kérelmező eltartott házastársa, gyermeke, szülője' },

    { panel: 'Magyarországra érkezését megelőző állandó vagy szokásos tartózkodási helye*' },
    { eh: 'moelotttarthelyorszag', label: 'ország', req: true,
      key: 'previous_country', list: true, dict: true },
    { eh: 'moelotttarthelytelepules', label: 'település', req: true, key: 'previous_town' },
    { eh: 'moelotttarthelykozteruletneve', label: 'közterület neve', key: 'previous_street',
      note: 'a DB egy mezőben tárolja az egész címet — a többi rovat kézi' },
    { eh: 'moelotttarthelykozteruletjellege', label: 'közterület jellege', manual: true },
    { eh: 'moelotttarthelyhazszam', label: 'házszám/helyrajzi szám', manual: true },
    { eh: 'moelotttarthelyepulet', label: 'épület', manual: true },
    { eh: 'moelotttarthelylepcsohaz', label: 'lépcsőház', manual: true },
    { eh: 'moelotttarthelyemelet', label: 'emelet', manual: true, list: true },
    { eh: 'moelotttarthelyajto', label: 'ajtó', manual: true },

    { panel: 'Rendelkezik-e más schengeni tagállamban érvényes tartózkodásra jogosító okmánnyal?*:' },
    { eh: 'schengeniokmany', label: 'label>', req: true, manual: true, list: true },
    { eh: 'engedelytipus', label: 'engedély típusa', manual: true },
    { eh: 'engdszama', label: 'engedély száma', manual: true },
    { eh: 'engedelyerv', label: 'engedély érvényessége', manual: true },

    { panel: 'Egyéb adatok' },
    { eh: 'korabbielut', label: 'Volt-e már korábban elutasított tartózkodási engedély iránti kérelme?', req: true,
      manual: true, list: true },
    { eh: 'korabbibuntetes', label: 'Volt-e korábban büntetve? ', req: true,
      manual: true, list: true },
    { eh: 'orszag', label: 'ország', manual: true, list: true },
    { eh: 'korabbibuntetesdatum', label: 'dátum', manual: true },
    { eh: 'bunticselekmenyleiras', label: 'bűncselekmény leírása', manual: true },
    { eh: 'buntileirasa', label: 'büntetés leírása', manual: true },
    { eh: 'korabbikiut', label: 'Kiutasították-e korábban Magyarországról, ha igen, mikor?', req: true,
      manual: true, list: true },
    { eh: 'korabbikiutdatum', label: 'korábbi kiutasítás dátuma', manual: true },
    { eh: 'beteg', label: 'Tudomása szerint szenved-e gyógykezelésre szoruló HIV/AIDS, továbbá tbc, hepatitis B, luesz, lepra, hastífusz fertőző betegségekben, illetve hordozza-e szervezetében a HIV, a hepatitis B, valamint a hastífusz vagy paratífusz kórokozóit?', req: true,
      manual: true, list: true },
    { eh: 'reszesulkezelesben', label: 'Ha a fenti megbetegedésekben szenved, fertőzőképes, illetve kórokozó hordozó állapotban van, részesül-e kötelező és rendszeres egészségügyi ellátásban?', manual: true,
      list: true },
    { eh: 'kijelentemgyerek', label: 'Kijelentem, hogy az útlevelemben szereplő kiskorú gyermekem velem együtt Magyarországra utazik.', req: true,
      manual: true, list: true },

    { panel: 'A tartózkodás tervezett időtartama és indokai' },
    { eh: 'meddig', label: 'Meddig kérelmezi tartózkodása engedélyezését?', req: true,
      key: 'employment_end', unsure: true },

    { panel: 'Az okmány átvétele' },
    { eh: 'email', label: 'e-mail cím', req: true, setting: 'email',
      note: 'az ügyintézőé — a Beállítások fülön állítható' },
    { eh: 'telefon', label: 'telefonszám', setting: 'telefon',
      note: 'az ügyintézőé — a Beállítások fülön állítható' },
    { eh: 'atvetel', label: 'Az okmány átvétele', req: true,
      const: 'A kérelmező az okmányt a kiállító hatóságnál veszi át', list: true },
    { eh: 'atvetel_cim', label: 'Postai kézbesítés címe', manual: true, list: true },

    { panel: 'Nyilatkozat' },
    { eh: 'nyilatkozat1', label: 'label>Kijelentem, hogy a kérelmemben és az ahhoz csatolt betétlap(ok)on leírt adatok a valóságnak megfelelnek. Tudomásul veszem, hogy valótlan adatok közlése a kérelem elutasítását vonja maga után.', req: true,
      const: 'bepipálva', list: true },
    { eh: 'nyilatkozat2', label: 'label>Kijelentem, hogy vállalom az Európai Unió tagállamai és más schengeni államok területének önkéntes elhagyását az 5. pont (a vissza- vagy továbbutazás feltételei) szerinti országba, amennyiben', req: true,
      const: 'bepipálva', list: true },

    { panel: 'Eltartott hozzátartozók' },
    { eh: 'hozzatartozo1', label: 'Eltartott házastárs, gyermek, szülő',
      key: 'hr_children',
      note: 'a DB egy szabad szöveges mezőben tárolja; az EH 8 × 19 rovatot kér — kézi' },
  ];

  /**
   * A munkavállalási betétlap. A három lap (c7 / c9 / c12) 93 mezője AZONOS,
   * ezért egyetlen listában áll: a 12 eltérő sor `only:` jelölést kap.
   */
  const BETET_ROWS = [
    { panel: 'Benyújtó' },
    { eh: 'benyujto', label: 'Benyújtó', req: true, const: 'foglalkoztató', list: true },

    { panel: 'A foglalkoztató részére az okmány postai úton kerül megküldésre' },

    { panel: 'Levelezési címe' },
    { eh: 'fogllevcimiranyitoszam', label: 'irányítószám', employer: 'levelezesi.iranyitoszam',
       },
    { eh: 'fogllevcimtelepules', label: 'település', employer: 'levelezesi.telepules',
      max: '27' },
    { eh: 'fogllevcimkerulet', label: 'kerület', employer: 'levelezesi.kerulet' },
    { eh: 'fogllevcimkozteruletneve', label: 'közterület neve', employer: 'levelezesi.kozteruletneve',
      max: '25' },
    { eh: 'fogllevcimkozteruletjellege', label: 'közterület jellege', employer: 'levelezesi.kozteruletjellege',
      list: true },
    { eh: 'fogllevcimhazszam', label: 'házszám', employer: 'levelezesi.hazszam', max: '8' },
    { eh: 'fogllevcimepulet', label: 'épület', employer: 'levelezesi.epulet' },
    { eh: 'fogllevcimlepcsohaz', label: 'lépcsőház', employer: 'levelezesi.lepcsohaz',
      max: '4' },
    { eh: 'fogllevcimemelet', label: 'emelet', employer: 'levelezesi.emelet', list: true },
    { eh: 'fogllevcimajto', label: 'ajtó', employer: 'levelezesi.ajto', max: '4' },

    { panel: 'Székhely' },
    { eh: 'foglszekhelyiranyitoszam', label: 'irányítószám', employer: 'szekhely.iranyitoszam',
       },
    { eh: 'foglszekhelytelepules', label: 'település', employer: 'szekhely.telepules',
      max: '27' },
    { eh: 'foglszekhelykerulet', label: 'kerület', employer: 'szekhely.kerulet' },
    { eh: 'foglszekhelykozteruletneve', label: 'közterület neve', employer: 'szekhely.kozteruletneve',
      max: '25' },
    { eh: 'foglszekhelykozteruletjellege', label: 'közterület jellege', employer: 'szekhely.kozteruletjellege',
      list: true },
    { eh: 'foglszekhelyhazszam', label: 'házszám', employer: 'szekhely.hazszam', max: '8' },
    { eh: 'foglszekhelyepulet', label: 'épület', employer: 'szekhely.epulet' },
    { eh: 'foglszekhelylepcsohaz', label: 'lépcsőház', employer: 'szekhely.lepcsohaz',
      max: '4' },
    { eh: 'foglszekhelyemelet', label: 'emelet', employer: 'szekhely.emelet', list: true },
    { eh: 'foglszekhelyajto', label: 'ajtó', employer: 'szekhely.ajto', max: '4' },

    { panel: 'A külföldön tartózkodó harmadik országbeli állampolgár kérelmének kedvezményes foglalkoztató vagy minősített kölcsönbead' },
    { eh: 'vizumatvetelorszag', label: 'ország', manual: true, list: true },
    { eh: 'vizumatvetelvaros', label: 'város', manual: true },

    { panel: 'A kérelmező magyarországi megélhetésére vonatkozó adatok' },
    { eh: 'varhatojovedelemosszege', label: 'várható jövedelem összege', req: true,
      key: 'gross_salary' },
    { eh: 'varhatojovedelemosszegepenznem', label: 'pénznem', const: 'Forint', list: true },
    { eh: 'adozottjovedelem', label: 'előző évi magyarországi adózott jövedelme', manual: true,
       },
    { eh: 'adozottjovedelempenznem', label: 'pénznem', manual: true, list: true },
    { eh: 'megtakaritas', label: 'megtakarítás összege', manual: true },
    { eh: 'megtakaritaspenznem', label: 'pénznem', manual: true, list: true },
    { eh: 'jovedelemvagyon', label: 'egyéb kiegészítő jövedelem/vagyon', manual: true },
    { eh: 'jovedelemvagyonpenznem', label: 'pénznem', manual: true, list: true },

    { panel: 'Az összevont engedélyezési eljáráshoz szükséges adatok' },

    { panel: 'Magyarországi munkáltató adatai' },
    { eh: 'munkaltatomunkaltatoneve', label: 'rövid cégnév', req: true,
      employer: 'nev', max: '40' },
    { eh: 'munkaltatoiranyitoszam', label: 'irányítószám', req: true,
      employer: 'szekhely.iranyitoszam' },
    { eh: 'munkaltatotelepules', label: 'település', req: true,
      employer: 'szekhely.telepules', max: '27' },
    { eh: 'munkaltatokozteruletneve', label: 'közterület neve', req: true,
      employer: 'szekhely.kozteruletneve', max: '25' },
    { eh: 'munkaltatokozteruletjellege', label: 'közterület jellege', req: true,
      employer: 'szekhely.kozteruletjellege', list: true },
    { eh: 'munkaltatohazszam', label: 'házszám/helyrajzi szám', req: true,
      employer: 'szekhely.hazszam', max: '11' },
    { eh: 'munkaltatoepulet', label: 'épület', employer: 'szekhely.epulet' },
    { eh: 'munkaltatolepcsohaz', label: 'lépcsőház', employer: 'szekhely.lepcsohaz',
      max: '4' },
    { eh: 'munkaltatoemelet', label: 'emelet', employer: 'szekhely.emelet', list: true },
    { eh: 'munkaltatoajto', label: 'ajtó', employer: 'szekhely.ajto', max: '4' },
    { eh: 'munkaltatoteaorszam', label: 'TEÁOR száma [2025]', req: true,
      employer: 'teaor', list: true },
    { eh: 'munkaltatokshszam', label: 'KSH-szám', req: true, employer: 'kshszam' },
    { eh: 'munkaltatomunkaltatoadoszama', label: 'munkáltató adószáma/adóazonosító jele', req: true,
      employer: 'adoszam' },

    { panel: 'Foglalkoztató' },
    { eh: 'foglkoztatotip', label: 'Foglalkoztató', req: true,
      employer: 'foglkoztatotip', list: true, only: ['c7'] },
    { eh: 'btatv34', label: 'A foglalkoztató a Btátv. 34. §-a szerinti nyilvántartásban szerepel', req: true,
      manual: true, list: true, only: ['c7'] },
    { eh: 'btatv34nap', label: 'Nyilvántartásba vétel napja', req: true,
      manual: true, only: ['c7'] },
    { eh: 'btatv34szam', label: 'Nyilvántartási száma', req: true,
      manual: true, only: ['c7'] },

    { panel: 'Munkakör betöltéséhez szükséges szakképzettsége' },
    { eh: 'szakkepzettseg', label: 'szakképzettsége', key: 'professional_qualification',
      dict: true, max: '30' },
    { eh: 'vegzettseg', label: 'iskolai végzettsége', req: true,
      key: 'educational_attainment', list: 'a betétlap részletesebb: Középfokú → Gimnázium / Szakközépiskola / Szakmunkásképző / Szakiskola / Technikum; Felsőfokú → Főiskola / Egyetem' },
    { eh: 'kulfoldifoglakozas', label: 'Magyarországra érkezést megelőző foglalkozás', key: 'occupation_before_arrival',
      dict: true, max: '30' },

    { panel: 'Munkavégzés helye(i)' },
    { eh: 'egymunkahely', label: 'label>egyetlen munkavégzési hely van', const: 'bepipálva',
      list: true },
    { eh: 'munkavegzeshelyeiranyitoszam', label: 'irányítószám', employer: 'munkavegzes.iranyitoszam',
       },
    { eh: 'munkavegzeshelyetelepules', label: 'település', employer: 'munkavegzes.telepules',
       },
    { eh: 'munkavegzeshelyekozteruletneve', label: 'közterület neve', employer: 'munkavegzes.kozteruletneve',
       },
    { eh: 'munkavegzeshelyekozteruletjellege', label: 'közterület jellege', employer: 'munkavegzes.kozteruletjellege',
      list: true },
    { eh: 'munkavegzeshelyehazszam', label: 'házszám/helyrajzi szám', employer: 'munkavegzes.hazszam',
       },
    { eh: 'munkavegzeshelyeepulet', label: 'épület', employer: 'munkavegzes.epulet' },
    { eh: 'munkavegzeshelyelepcsohaz', label: 'lépcsőház', employer: 'munkavegzes.lepcsohaz',
       },
    { eh: 'munkavegzeshelyeemelet', label: 'emelet', employer: 'munkavegzes.emelet',
      list: true },
    { eh: 'munkavegzeshelyeajto', label: 'ajtó', employer: 'munkavegzes.ajto' },
    { eh: 'munkatobbmegye', label: 'label>a munka természetéből adódóan a munkavégzés helye több vármegye területére terjed ki', const: 'üresen',
      list: true },
    { eh: 'munkatobbmegyeiranyitoszam', label: 'irányítószám', manual: true },
    { eh: 'munkatobbmegyetelepules', label: 'település', manual: true },
    { eh: 'munkatobbmegyekozteruletneve', label: 'közterület neve', manual: true },
    { eh: 'munkatobbmegyekozteruletjellege', label: 'közterület jellege', manual: true,
      list: true },
    { eh: 'munkatobbmegyehazszam', label: 'házszám/helyrajzi szám', manual: true },
    { eh: 'munkatobbmegyeepulet', label: 'épület', manual: true },
    { eh: 'munkatobbmegyelepcsohaz', label: 'lépcsőház', manual: true },
    { eh: 'munkatobbmegyeemelet', label: 'emelet', manual: true, list: true },
    { eh: 'munkatobbmegyeajto', label: 'ajtó', manual: true },
    { eh: 'foglalkoztatastobbmegyeben', label: 'label>a foglalkoztató több – különböző vármegye területén lévő – telephelyén fog dolgozni', const: 'üresen',
      list: true },
    { eh: 'foglakoztataskezdete', label: 'foglalkoztatóval kötött előzetes megállapodás kelte', req: true,
      key: 'employment_start', unsure: true },
    { eh: 'feorszam', label: 'munkakör (FEOR szám)', req: true,
      key: 'feor', list: 'a 4 jegyű kód alapján keresd a listában' },

    { panel: 'A munkakör ellátásához szükséges készségei, ismeretei' },
    { eh: 'gyakorlatiido', label: 'az ellátandó munkakörre vonatkozó szakmai gyakorlati ideje (években)', manual: true,
       },
    { eh: 'specialisismeretek', label: 'az ellátandó munkakörrel összefüggő speciális ismerete, képessége', manual: true,
      note: 'támpont: Számítástechnikai ismeretek' },
    { eh: 'anyanyelv', label: 'anyanyelve', req: true,
      key: 'mother_tongue', list: 'magyar nyelvnév a listából', dict: true },
    { eh: 'egyebnyelv', label: 'egyéb nyelvismerete', key: 'hr_language_skills',
      list: 'a DB több nyelvet tart egy cellában' },
    { eh: 'tudmagyarul', label: 'Beszél magyarul? ', req: true,
      key: 'speaks_hungarian', list: true },
    { eh: 'korabbandolgozottmo', label: 'Korábban dolgozott már Magyarországon?', req: true,
      manual: true, list: true },
    { eh: 'korabbimomunkaltatonev', label: 'munkáltató neve', key: 'hr_previous_employer' },
    { eh: 'korabbimomunkahelyiranyitoszam', label: 'irányítószám', manual: true },
    { eh: 'korabbimomunkahelytelepules', label: 'település', manual: true },
    { eh: 'korabbimomunkahelykozteruletneve', label: 'közterület neve', manual: true },
    { eh: 'korabbimomunkahelykozteruletjellege', label: 'közterület jellege', manual: true,
      list: true },
    { eh: 'korabbimomunkahelyhazszam', label: 'házszám/helyrajzi szám', manual: true },
    { eh: 'korabbimomunkahelyepulet', label: 'épület', manual: true },
    { eh: 'korabbimomunkahelylepcsohaz', label: 'lépcsőház', manual: true },
    { eh: 'korabbimomunkahelyemelet', label: 'emelet', manual: true, list: true },
    { eh: 'korabbimomunkahelyajto', label: 'ajtó', manual: true },
    { eh: 'elozeengervido', label: 'Előző engedélyének érvényességi ideje', key: 'expiration_of_rp',
       },

    { panel: 'Nyilatkozat' },
    { eh: 'tavorszag', label: 'E körben nyilatkozom, hogy a távozást önként vállalom, a távozási kötelezettségemnek', req: true,
      key: 'citizenship', list: 'itt országnév kell', only: ['c7', 'c12'] },
    { eh: 'kiutasitasceltip', label: 'A kiutasítás célországa', req: true,
      const: 'az állampolgárságom szerinti állam', list: true, only: ['c7', 'c12'] },
    { eh: 'kiutasitasceltipus', label: 'beutazáshoz szükséges engedély típusa', req: true,
      manual: true, only: ['c7', 'c12'] },
    { eh: 'kiutasitascelengedely', label: 'engedély száma', req: true,
      manual: true, only: ['c7', 'c12'] },
    { eh: 'mentessegkhiv', label: '<b>Az összevont kérelmezési eljárásban a Kormányhivatal nem működik közre szakhatóságként a 2023. évi XC. törvény 242. § (7) bekezdésében felsorolt esetekben. Ezek valamelyike a kérelmező esetében fennáll</b>', req: true,
      manual: true, list: true },
    { eh: 'mentessegkhivpont', label: 'a 2023. évi XC. törvény 242. § (7) bekezdés pontja', req: true,
      manual: true },
    { eh: 'mentessegmunkavallas', label: '<b>A kérelmező foglalkoztatása munkavállalási engedély alól mentes a 445/2013. (XI. 28.) Korm. rendelet 15. § (1) bekezdése alapján</b>', req: true,
      manual: true, list: true },
    { eh: 'mentessegmunkavallaspont', label: '445/2013. (XI. 28.) Korm. rendelet 15. § (1) bekezdés pontja', req: true,
      manual: true },
    { eh: 'mentessegmpiac', label: '<b>A kérelmező foglalkoztatása mentes a munkaerőpiaci helyzet vizsgálata alól a 445/2013. (XI. 28.) Korm. rendelet 9. § (1) bekezdése alapján</b>', req: true,
      manual: true, list: true, only: ['c7', 'c9'] },
    { eh: 'mentessegmpiachivpont', label: '445/2013. (XI. 28.) Korm. rendelet 15. § (1) bekezdés pontja', req: true,
      manual: true, only: ['c7', 'c9'] },
    { eh: 'okmanyatvetelhelye', label: 'Az okmány átvételének helye', req: true,
      manual: true, list: true, only: ['c12'] },
    { eh: 'atvetel', label: 'Az okmány átvétele', req: true,
      const: 'A kiállító hatóságnál', list: true, only: ['c12'] },
  ];

  // ── Lekérdezés ─────────────────────────────────────────────────────────────

  /**
   * Egy kérelem sorai: a fő űrlap, majd — ha van jogcím — a betétlap.
   * Jogcím nélkül csak a fő űrlap jön, az úgyis közös.
   */
  function rows(jogcim) {
    const out = FO_ROWS.slice();
    if (!jogcim) return out;
    out.push({ panel: '── BETÉTLAP: ' + (labelOf(jogcim) || jogcim) + ' ──' });
    for (const r of BETET_ROWS) {
      if (r.only && !r.only.includes(jogcim)) continue;
      out.push(r);
    }
    return out;
  }

  function labelOf(jogcim) {
    const j = JOGCIMEK.find(x => x.id === jogcim);
    return j ? j.label : '';
  }

  /**
   * Cégadat útvonal szerint: 'nev', 'szekhely.telepules', 'levelezesi.hazszam'.
   * A `levelezesi` egy másik blokkra mutató szöveg — feloldjuk.
   */
  function employerValue(path) {
    const [blokk, mezo] = String(path).split('.');
    let v = EH_EMPLOYER[blokk];
    if (typeof v === 'string' && mezo) v = EH_EMPLOYER[v];   // levelezesi → munkavegzes
    if (!mezo) return typeof v === 'string' ? v : '';
    return (v && v[mezo] != null) ? v[mezo] : '';
  }

  return { JOGCIMEK, rows, labelOf, employerValue, EMPLOYER: EH_EMPLOYER,
           _FO: FO_ROWS, _BETET: BETET_ROWS };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = { EhForms, EH_EMPLOYER };
