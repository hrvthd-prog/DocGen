'use strict';

/**
 * Hova kerül egy generált irat a kimeneti mappában (09_OIF_kerelmek)?
 * Terv: plans/TERV-kimenet-es-ugyek.md 3.
 *
 *   <gyökér>\01_Hosszabbitasok\<ÉÉÉÉ.HH>\<Név>\01_Elokeszitett …   meghosszabbítás
 *   <gyökér>\02_Kiadasok\<Név>\01_Elokeszitett …                     kiadás
 *       a dolgozói mappában mindig: 01_Elokeszitett, 02_Feltoltheto, 03_Beerkezett, 04_TAJ
 *   <gyökér>\03_Bejelentesek\01_Munkaviszony_megszunes\              közvetlenül
 *   <gyökér>\03_Bejelentesek\02_Szallashelyvaltozasok\<ÉÉÉÉ.HH>\     közvetlenül
 *
 * A dolgozót minden generáláskor BEJÁRÁSSAL keressük, nem indexből: a mappák kézzel
 * mozognak (a lezárt ügy a személyi anyagba kerül, az üres hónapmappa törlődik),
 * egy tárolt index épp ettől avulna el. A válasz munkamenetre megjegyződik.
 *
 * A felső szintű mappákat a program SOSEM hozza létre: ha hiányoznak, nem a
 * 09_OIF_kerelmek a kimeneti mappa, és nem szabad ott új szerkezetet növeszteni.
 */
const DocgenCelmappa = (() => {

  const HOSSZ = '01_Hosszabbitasok';
  const KIAD  = '02_Kiadasok';
  const BEJ   = '03_Bejelentesek';
  const MEGSZ = '01_Munkaviszony_megszunes';
  const SZALL = '02_Szallashelyvaltozasok';
  /** A dolgozói mappa négy almappája; a `03_Beerkezett`-be csak kézzel kerül irat. */
  const AL = { prep: '01_Elokeszitett', up: '02_Feltoltheto', be: '03_Beerkezett', taj: '04_TAJ' };

  // ── Tiszta függvények (Node-ban tesztelhetők) ──────────────────────────────

  /** Ékezet-, kisbetű- és szóközfüggetlen kulcs. Az NFD minden ékezetet levesz
   *  (ş, č, ễ is), nem csak a magyarokat — harmadik országbeli neveknél ez kell. */
  function fold(s) {
    return String(s || '').normalize('NFD').replace(/\p{M}/gu, '')
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /** „2026-11-15” → „2026.11” */
  function honap(iso) {
    const m = /^(\d{4})-(\d{2})/.exec(String(iso || ''));
    return m ? `${m[1]}.${m[2]}` : null;
  }

  /**
   * Az irat helye a sablon alapján.
   *   → { ut: [...] }        közvetlen hely a gyökér alatt
   *   → { dolgozo: almappa } a dolgozói mappa egyik almappája
   * `tipusSablonok`: ügytípus-kulcs → a hozzá rendelt sablonok (Ügytípus-sablonok).
   * `kesz`: aláírás nélkül kész PDF-nyomtatvány (02_Feltoltheto).
   */
  function szabaly(sablon, { tipusSablonok = {}, kesz = false, ma = '' } = {}) {
    if ((tipusSablonok.munkaviszony_kijelentes || []).includes(sablon)) return { ut: [BEJ, MEGSZ] };
    if ((tipusSablonok.szallashely_valtozas || []).includes(sablon)) {
      return { ut: [BEJ, SZALL, honap(ma)] };
    }
    // ponytail: a TAJ-sablon a fájlnév elejéről ismerszik meg; ha lesz TAJ-ügytípus,
    // a fenti hozzárendelés veszi át.
    if (/^TAJ[-\s]/i.test(sablon)) return { dolgozo: AL.taj };
    return { dolgozo: kesz ? AL.up : AL.prep };
  }

  /** Új dolgozói mappa a nyitott ügy szerint, vagy null (kérdezni kell). */
  function ujDolgozoUt({ ugyTipus, lejarat, nev }) {
    if (ugyTipus === 'rp_hosszabbitas' && honap(lejarat)) return [HOSSZ, honap(lejarat), nev];
    if (ugyTipus === 'rp_elso') return [KIAD, nev];
    return null;
  }

  /**
   * A név és a meglévő dolgozói mappák összevetése.
   *   pontos: fold-egyezés — ezt használjuk kérdés nélkül
   *   hasonlo: más sorrend vagy rész-egyezés („Ali” ↔ „Ali Khan”) — ilyenkor
   *            kérdezünk, és NEM hozunk létre új mappát: abból lenne a párhuzamos
   *            dolgozói mappa.
   */
  function egyeztet(nev, mappak) {
    const f = fold(nev);
    const pontos = mappak.filter(m => fold(m.nev) === f);
    if (pontos.length) return { pontos, hasonlo: [] };
    const szavak = f.split(' ').filter(Boolean);
    const hasonlo = mappak.filter(m => {
      const ms = fold(m.nev).split(' ').filter(Boolean);
      const [rov, hosszu] = ms.length <= szavak.length ? [ms, szavak] : [szavak, ms];
      return rov.length > 0 && rov.every(w => hosszu.includes(w));
    });
    return { pontos, hasonlo };
  }

  // ── Fájlrendszer ───────────────────────────────────────────────────────────

  /** A szegmensek mentén lefelé; `letrehoz` nélkül a hiányzó szint → null. */
  async function mappa(gyoker, ut, letrehoz = false) {
    let d = gyoker;
    for (const nev of ut) {
      d = await FsService.getSubDir(d, nev, letrehoz);
      if (!d) return null;
    }
    return d;
  }

  const _ellenorzott = new WeakSet();

  /** Hiba, ha a gyökér nem a 09_OIF_kerelmek (hiányzik valamelyik felső mappa). */
  async function ellenoriz(gyoker) {
    if (_ellenorzott.has(gyoker)) return;
    const hiany = [];
    for (const ut of [[HOSSZ], [KIAD], [BEJ, MEGSZ], [BEJ, SZALL]]) {
      if (!await mappa(gyoker, ut)) hiany.push(ut.join('\\'));
    }
    if (hiany.length) {
      throw new Error(`A kimeneti mappa (${gyoker.name}) nem a 09_OIF_kerelmek? ` +
                      `Hiányzik: ${hiany.join(', ')}`);
    }
    _ellenorzott.add(gyoker);
  }

  /** A meglévő dolgozói mappák: [{ ut, nev }]. */
  async function dolgozoMappak(gyoker) {
    const out = [];
    const hossz = await FsService.getSubDir(gyoker, HOSSZ);
    if (hossz) {
      for (const h of await FsService.listSubDirs(hossz)) {
        const hd = await FsService.getSubDir(hossz, h);
        for (const n of await FsService.listSubDirs(hd)) out.push({ ut: [HOSSZ, h, n], nev: n });
      }
    }
    const kiad = await FsService.getSubDir(gyoker, KIAD);
    if (kiad) for (const n of await FsService.listSubDirs(kiad)) out.push({ ut: [KIAD, n], nev: n });
    return out;
  }

  // Munkamenetre megjegyzett válasz: gyökér → (dolgozó-azonosító → út | null)
  const _valasz = new WeakMap();

  /**
   * Az irat célmappája. → { dir, ut } — `ut` a gyökérhez képesti út (a PDF-lánc
   * kísérőfájljához), vagy null, ha a felhasználó a kérdésre a kihagyást választotta.
   *
   * `kerdez({ nev, hasonlo, javaslatok })` → Promise<út | null>: a hívó párbeszéde,
   * ha a dolgozó mappája nem egyértelmű.
   */
  async function cel(gyoker, { empId, nev, sablon, kesz = false, tipusSablonok = {},
                               ugyTipus = null, lejarat = null, ma = '', kerdez }) {
    await ellenoriz(gyoker);
    const sz = szabaly(sablon, { tipusSablonok, kesz, ma });
    if (sz.ut) return { dir: await mappa(gyoker, sz.ut, true), ut: sz.ut };

    if (!_valasz.has(gyoker)) _valasz.set(gyoker, new Map());
    const emlek = _valasz.get(gyoker);
    if (!emlek.has(empId)) {
      const { pontos, hasonlo } = egyeztet(nev, await dolgozoMappak(gyoker));
      let ut = pontos.length === 1 ? pontos[0].ut : null;
      if (!ut && !pontos.length && !hasonlo.length) ut = ujDolgozoUt({ ugyTipus, lejarat, nev });
      if (!ut) {
        ut = await kerdez({
          nev,
          hasonlo: pontos.length ? pontos : hasonlo,     // több pontos: az is kérdés
          javaslatok: [ujDolgozoUt({ ugyTipus: 'rp_hosszabbitas', lejarat, nev }),
                       ujDolgozoUt({ ugyTipus: 'rp_elso', nev })].filter(Boolean),
        });
      }
      emlek.set(empId, ut || null);
    }
    const ut = emlek.get(empId);
    if (!ut) return null;

    const wd = await mappa(gyoker, ut, true);
    // Mind a négy almappa — új mappánál ez hozza létre, meglévőnél pótolja.
    for (const a of Object.values(AL)) await FsService.getSubDir(wd, a, true);
    return { dir: await FsService.getSubDir(wd, sz.dolgozo), ut: [...ut, sz.dolgozo] };
  }

  return { AL, fold, honap, szabaly, ujDolgozoUt, egyeztet, ellenoriz, dolgozoMappak, cel };
})();
