'use strict';

/**
 * Engedély-hosszabbítási döntések (K2) — sávok, döntésnapló, értesítések.
 * Terv: plans/TERV-hosszabbitasi-dontesek.md
 *
 * ── A napló ────────────────────────────────────────────────────────────────
 * `docgen-hosszabbitas.json`, CSAK HOZZÁFŰZÉS: eseményt nem írunk át és nem
 * törlünk. A mostani állapot az események összegzése. Külön fájl, mert (1) sok
 * vezető ír bele, és nem ütközhet a HR napi munkájával, (2) NTFS-szinten a
 * vezetőknek csak erre kell írási jog, (3) a K2 így soha nem írja a dolgozói
 * fájlt (3.4).
 *
 * Párhuzamos írásnál ITT szabad összefésülni (a TERV-adatbiztonsag.md 7. tiltja
 * általában): egyedi azonosítójú, hozzáfűzött eseményeknél nincs ütközés.
 *
 * ── A kör ──────────────────────────────────────────────────────────────────
 * Egy dolgozó aktuális köre az utolsó LEZÁRT `rp_hosszabbitas` ügy rögzítése
 * óta tart. Az ennél korábbi döntés egy előző engedélyről szólt. Nem kell hozzá
 * azonosító: a lezárással magától új kör nyílik.
 *
 * Az értesítéseket nem tároljuk, hanem kiszámoljuk (`ertesitesek`); csak az
 * olvasottság (böngésző, kényelmi) és a nyugtázás (`NYUGTA` esemény) tárolt.
 */
const Hosszabbitas = (() => {

  const FILENAME = 'docgen-hosszabbitas.json';
  const UGYTIPUS = 'rp_hosszabbitas';
  const LEJARAT  = 'expiration_of_rp';
  const K2       = 'hr_k2';
  const VEZETO   = 'hr_direct_leader';
  const HRBP     = 'hr_hrbp';

  /** Ennyi napig látszik a lezárt kör döntése a 2. listán (mint az Ügyállásban),
   *  és ennyi napra visszamenőleg adnak értesítést a naplóesemények. */
  const LEZART_NAPOK = 30;

  // ── Beállítás: adat, seeddel (docgen-config.json → hosszabbitas) ─────────────
  /**
   * A sávok saját határai. A 90 / 45 / 15 NEM itt van: azok az `rp_hosszabbitas`
   * benyújtási ablakából jönnek (egy forrás, 3.2).
   *   lista       — eddig a napig kerül a dolgozó az 1. listára
   *   tajekoztato — ettől lefelé „Közeleg” (ez felett „Tájékoztató”)
   *   kozeleg     — ettől lefelé az ablak (90) „Döntés esedékes”-ig „Közeleg”
   *   kesesben    — „Késésben” határa (90 alatt, 45 felett)
   */
  const SEED = {
    savok: { lista: 365, tajekoztato: 180, kozeleg: 120, kesesben: 60 },
    // A döntés űrlapjának mezői — ADAT (5.). Új mező = egy új bejegyzés.
    // Típus: text | textarea | date | enum (options: [..]) | checkbox
    mezok: [
      { key: 'indoklas', type: 'textarea', label: 'Indoklás', kotelezo: false },
    ],
  };

  let cfgBackend = null;
  let cfg = null;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function normalizeCfg(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const s = Object.assign({}, SEED.savok, r.savok || {});
    for (const k of Object.keys(SEED.savok)) {
      const n = Number(s[k]);
      s[k] = Number.isFinite(n) ? Math.round(n) : SEED.savok[k];
    }
    const mezok = (Array.isArray(r.mezok) && r.mezok.length ? r.mezok : SEED.mezok)
      .filter(m => m && m.key)
      .map(m => ({ key: String(m.key), type: String(m.type || 'text'),
                   label: String(m.label || m.key), kotelezo: !!m.kotelezo,
                   options: Array.isArray(m.options) ? m.options.map(String) : [] }));
    // Az indoklás nem hagyható ki: futó ügynél a módosításhoz kötelező (3.5).
    if (!mezok.some(m => m.key === 'indoklas')) mezok.unshift(Object.assign({ options: [] }, SEED.mezok[0]));
    return { savok: s, mezok };
  }

  function useConfigBackend(b) { cfgBackend = b; cfg = null; }
  async function loadConfig() {
    let raw = null;
    if (cfgBackend) { try { raw = await cfgBackend.load(); } catch { raw = null; } }
    cfg = normalizeCfg(raw);
    return cfg;
  }
  function config() { if (!cfg) cfg = normalizeCfg(null); return cfg; }
  function mezok() { return config().mezok.map(m => Object.assign({}, m)); }

  /** A négy saját sávhatár mentése, ellenőrzéssel (Beállítások-kártya). */
  async function setSavok(uj) {
    const s = Object.assign({}, config().savok, uj);
    for (const k of Object.keys(SEED.savok)) {
      if (!Number.isInteger(Number(s[k]))) throw new Error('A sávhatár egész szám kell legyen.');
      s[k] = Number(s[k]);
    }
    const a = ablak();
    if (!(s.lista >= s.tajekoztato && s.tajekoztato > s.kozeleg && s.kozeleg > a.esedekes)) {
      throw new Error(`A sorrend: lista ≥ tájékoztató > közeleg > ${a.esedekes} (az ablak nyitása).`);
    }
    if (!(s.kesesben < a.esedekes && s.kesesben > a.utolso)) {
      throw new Error(`A „Késésben” határa ${a.utolso} és ${a.esedekes} közé essen.`);
    }
    cfg = Object.assign({}, config(), { savok: s });
    if (cfgBackend) await cfgBackend.save(clone(cfg));
    return cfg.savok;
  }

  // ── Sávok (3.2) ─────────────────────────────────────────────────────────────
  /** A benyújtási ablak napjai pozitív számként: { esedekes: 90, utolso: 45, vismaior: 15 }. */
  function ablak() {
    let w = null;
    try { w = (CaseTypes.byKey(UGYTIPUS) || {}).submissionWindow; } catch { w = null; }
    w = w || { earliestDays: -90, latestDays: -45, finalDays: -15 };
    return { esedekes: -w.earliestDays, utolso: -w.latestDays, vismaior: -w.finalDays };
  }

  /** Sorrendben, a legtávolabbitól. A szín a CSS-ben (`hs-sav--<key>`). */
  const SAVOK = [
    { key: 'tajekoztato', label: 'Tájékoztató' },
    { key: 'kozeleg',     label: 'Közeleg' },
    { key: 'esedekes',    label: 'Döntés esedékes' },
    { key: 'kesesben',    label: 'Késésben' },
    { key: 'utolso',      label: 'Utolsó lehetőség' },
    { key: 'vismaior',    label: 'Csak vis maior' },
    { key: 'nemadhato',   label: 'Már nem adható be' },
    { key: 'lejart',      label: 'Lejárt' },
  ];

  /** Az összes határ egy objektumban (alsó határok, a napok ≥ ennyi). */
  function hatarok() {
    const s = config().savok, a = ablak();
    return { lista: s.lista, tajekoztato: s.tajekoztato, kozeleg: s.kozeleg,
             esedekes: a.esedekes, kesesben: s.kesesben, utolso: a.utolso,
             vismaior: a.vismaior, nemadhato: 0 };
  }

  /**
   * A sáv a hátralévő napokból — az egyetlen hely, ami dönt róla. `h` csak a
   * teszteknek. -> sáv kulcsa, vagy null, ha a lejárat a listahorizonton túl van.
   */
  function sav(napok, h = hatarok()) {
    if (napok == null || !Number.isFinite(napok)) return null;
    if (napok > h.lista) return null;
    for (const k of ['tajekoztato', 'kozeleg', 'esedekes', 'kesesben', 'utolso',
                     'vismaior', 'nemadhato']) {
      if (napok >= h[k]) return k;
    }
    return 'lejart';
  }

  function savLabel(key) { const s = SAVOK.find(x => x.key === key); return s ? s.label : ''; }

  // ── Dátumok ─────────────────────────────────────────────────────────────────
  function today() { return Auth.today(); }

  /** Naptári napok a lejáratig — ugyanaz a számítás, mint a `suggestRenewals`. */
  function napokIg(lejarat, ma = today()) {
    if (!lejarat) return null;
    const d = new Date(lejarat), m = new Date(ma);
    if (isNaN(d.getTime()) || isNaN(m.getTime())) return null;
    return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) -
                       Date.UTC(m.getFullYear(), m.getMonth(), m.getDate())) / 86400000);
  }

  function napEltol(nap, n) {
    const d = new Date(nap);
    d.setDate(d.getDate() + n);
    return CaseTypes.isoDate(d);
  }

  function lejaratOf(emp) {
    const v = String(((emp && emp.fields) || {})[LEJARAT] || '').trim();
    return v && !isNaN(new Date(v).getTime()) ? v.slice(0, 10) : '';
  }
  function k2Of(emp)     { return String(((emp && emp.fields) || {})[K2] || '').trim(); }
  function vezetoOf(emp) { return String(((emp && emp.fields) || {})[VEZETO] || '').trim(); }
  function hrbpOf(emp)   { return String(((emp && emp.fields) || {})[HRBP] || '').trim(); }

  function nev(emp) {
    const f = (emp && emp.fields) || {};
    return [f.surname, f.forename].filter(Boolean).join(' ').trim() || '(névtelen)';
  }
  function torzsszam(emp) { return String(((emp && emp.fields) || {}).personnel_reg_number || ''); }

  // ── A napló ─────────────────────────────────────────────────────────────────
  const TIPUS = { DONTES: 'DONTES', MODOSITAS: 'MODOSITAS', JEGYZET: 'JEGYZET', NYUGTA: 'NYUGTA' };
  const MINOSEG = { k2: 'K2', helyettes: 'helyettes', hrbp: 'HRBP' };
  const FORRASOK = ['e-mail', 'telefon', 'személyesen', 'egyéb'];

  let backend = null;
  let cache = null;          // { version, events: [] }
  let hiba = null;           // sérült napló: nem írunk, hogy ne írjuk felül
  const listeners = new Set();

  function emit() { for (const fn of listeners) { try { fn(); } catch {} } }
  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  function newId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'h-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function useBackend(b) { backend = b; cache = null; hiba = null; }

  function createFileBackend(dirHandle) {
    return EmployeeRepo.createFileBackend(dirHandle, { filename: FILENAME });
  }

  /** Két eseménylista uniója `id` szerint, időrendben. */
  function egyesit(a, b) {
    const m = new Map();
    for (const e of [...(a || []), ...(b || [])]) if (e && e.id && !m.has(e.id)) m.set(e.id, e);
    return [...m.values()].sort((x, y) => String(x.at).localeCompare(String(y.at)));
  }

  /**
   * Betöltés — és újratöltés is (fülváltáskor, az ablak visszatérésekor): a
   * memóriában lévő, még ki nem írt események nem vesznek el, összefésülődnek.
   */
  async function load() {
    if (!backend) { cache = cache || { version: 1, events: [] }; return cache.events.length; }
    let raw;
    try { raw = await backend.load(); }
    catch (e) {
      hiba = e;
      if (typeof BevLogger !== 'undefined') {
        BevLogger.error('HOSSZ_NAPLO', 'A döntésnapló nem olvasható', e.message, '');
      }
      throw e;
    }
    hiba = null;
    const betoltott = raw && Array.isArray(raw.events) ? raw.events : [];
    cache = { version: 1, events: egyesit(betoltott, cache ? cache.events : []) };
    emit();
    return cache.events.length;
  }

  function loaded() { return !!cache; }
  function serult() { return hiba; }

  async function persist() {
    if (!backend) return;
    // Ütközésnél újraolvasunk, egyesítünk, újra írunk. Háromszor próbáljuk:
    // ennyi párhuzamos írás egy döntésnél a valóságban nem fordul elő.
    for (let i = 0; ; i++) {
      try { await backend.save(cache); return; }
      catch (e) {
        if (!(e && e.name === 'StaleWriteError') || i >= 2) throw e;
        const raw = await backend.load();
        cache.events = egyesit(raw && raw.events, cache.events);
      }
    }
  }

  /** Egy esemény hozzáfűzése és azonnali mentése. -> az esemény */
  async function hozzafuz(ev) {
    if (hiba) {
      throw new Error('A döntésnapló sérült, ezért nem írunk bele (felülírnánk). '
                    + 'Szólj az adminnak: a backup mappából visszaállítható.');
    }
    if (!cache) cache = { version: 1, events: [] };
    const e = Object.assign({ id: newId(), at: new Date().toISOString() }, ev);
    cache.events.push(e);
    try { await persist(); }
    catch (err) {
      // Ki nem írt esemény nem maradhat a képernyőn mentettnek látszva.
      cache.events = cache.events.filter(x => x.id !== e.id);
      emit();
      throw err;
    }
    emit();
    return e;
  }

  function osszes() { return cache ? cache.events.slice() : []; }
  function esemenyei(empId) { return osszes().filter(e => e.empId === empId); }

  // ── Kör és állapot (3.3) ────────────────────────────────────────────────────
  /** A lezárt hosszabbítási ügyek lezárásának RÖGZÍTÉSI ideje, időrendben. */
  function korHatarok(empId) {
    let ugyek = [];
    try { ugyek = CaseRepo.forEmployee(empId, { includeClosed: true }); } catch { ugyek = []; }
    return ugyek.filter(c => c.type === UGYTIPUS && c.closedAt).map(c => {
      const zaro = (c.events || []).filter(e => e.outcome || (e.status &&
        CaseTypes.isTerminal(c.type, e.status)));
      const utolso = zaro[zaro.length - 1];
      return { at: (utolso && utolso.at) || `${c.closedAt}T23:59:59.999Z`, ugy: c };
    }).sort((a, b) => a.at.localeCompare(b.at));
  }

  function nyitottUgy(empId) {
    try {
      return CaseRepo.forEmployee(empId, { includeClosed: false })
        .find(c => c.type === UGYTIPUS) || null;
    } catch { return null; }
  }

  const DONTES_TIPUS = [TIPUS.DONTES, TIPUS.MODOSITAS];

  /**
   * Egy dolgozó köreinek összegzése. -> [{ kezdet, vege (zárás ideje vagy null),
   *   ugy (a kört lezáró ügy), dontesek[], dontes (az utolsó), modositasok,
   *   parhuzamos, jegyzetek[] }], a legrégebbitől az aktuálisig. Az utolsó elem
   *   mindig az aktuális (nyitott) kör.
   */
  function korok(empId) {
    const hatar = korHatarok(empId);
    const evs = esemenyei(empId);
    const out = [];
    let kezdet = '';
    for (let i = 0; i <= hatar.length; i++) {
      const vege = i < hatar.length ? hatar[i].at : null;
      const benne = evs.filter(e => e.at > kezdet && (vege === null || e.at <= vege));
      const dontesek = benne.filter(e => DONTES_TIPUS.includes(e.tipus));
      // Párhuzamos rögzítés: a későbbi döntés nem a valódi előzőre épült (pl. a
      // K2 és a HRBP egyszerre rögzített). Mindkettő megmarad, a későbbi érvényes.
      const parhuzamos = dontesek.some((e, j) => j > 0 &&
        (e.tipus === TIPUS.DONTES || (e.elozo || null) !== dontesek[j - 1].dontes));
      out.push({
        kezdet, vege, ugy: i < hatar.length ? hatar[i].ugy : null,
        dontesek, dontes: dontesek[dontesek.length - 1] || null,
        modositasok: dontesek.filter(e => e.tipus === TIPUS.MODOSITAS).length,
        parhuzamos,
        jegyzetek: benne.filter(e => e.tipus === TIPUS.JEGYZET),
      });
      kezdet = vege;
    }
    return out;
  }

  /** Az aktuális kör + a jelzések egy dolgozóra. */
  function allapot(emp, ma = today()) {
    const k = korok(emp.id);
    const most = k[k.length - 1];
    const lejarat = lejaratOf(emp);
    const napok = napokIg(lejarat, ma);
    const d = most.dontes;
    return {
      emp, lejarat, napok, sav: sav(napok),
      kor: most, korok: k,
      dontes: d,
      // A döntés óta módosult a lejárat (adatjavítás) — a döntés nem vész el,
      // és nem is költözik át magától.
      lejaratValtozott: d && d.lejarat && lejarat && d.lejarat !== lejarat
        ? { regi: d.lejarat, uj: lejarat } : null,
      utolsoJegyzet: most.jegyzetek[most.jegyzetek.length - 1] || null,
      ugy: nyitottUgy(emp.id),
    };
  }

  // ── Ki mit lát, ki dönthet (3.1) ────────────────────────────────────────────
  function roleCan(fiok, action) {
    if (!fiok) return false;
    if (fiok.proba) return true;
    return Roles.can(fiok.role, action);
  }

  /** Helyettesíti-e ma a `fiok` a `k2Nev` nevű vezetőt. */
  function helyettesiti(fiok, k2Nev, nap) {
    const k2 = Auth.byName(k2Nev);
    return !!(k2 && fiok && fiok.id && (k2.deputies || []).some(d =>
      d.deputyId === fiok.id && Auth.isActiveDeputy(d, nap)));
  }

  /**
   * Milyen minőségben dönthet a fiók erről a dolgozóról. -> 'k2' | 'helyettes' |
   * 'hrbp' | null. A K2-ság KAPCSOLAT a dolgozóval, nem szint: a jog csak kapu.
   */
  function minoseg(fiok, emp, nap = today()) {
    if (!fiok || !emp) return null;
    const k2 = k2Of(emp);
    if (roleCan(fiok, 'renewals.decide.own') && k2) {
      if (Auth.fold(k2) === Auth.fold(fiok.name)) return 'k2';
      if (helyettesiti(fiok, k2, nap)) return 'helyettes';
    }
    return roleCan(fiok, 'renewals.decide') ? 'hrbp' : null;
  }

  /** K2-ként (vagy helyettesként) kötődik-e a dolgozóhoz. */
  function k2Kapcsolat(fiok, emp, nap) {
    const k2 = k2Of(emp);
    return !!k2 && (Auth.fold(k2) === Auth.fold(fiok.name) || helyettesiti(fiok, k2, nap));
  }

  /** Közvetlen vezetőként (a hierarchiával és helyettesítéssel) kötődik-e. */
  function vezetoKapcsolat(fiok, emp, nap) {
    const v = Auth.fold(vezetoOf(emp));
    return !!v && Auth.visibleLeaderNames(fiok.name, nap).has(v);
  }

  function lathato(fiok, emp, nap = today()) {
    if (!fiok || !emp) return false;
    if (roleCan(fiok, 'renewals.read')) return true;
    if (!roleCan(fiok, 'renewals.read.own')) return false;
    return k2Kapcsolat(fiok, emp, nap) || vezetoKapcsolat(fiok, emp, nap);
  }

  // ── Rögzítés ────────────────────────────────────────────────────────────────
  /**
   * Döntés (vagy módosítás) rögzítése. `fiok`: a belépett fiók ({ id, name,
   * role } vagy { name, proba: true }).
   *   dontes: 'igen' | 'nem'; mezok: { indoklas, … }; forras: { tipus, megj } | null
   */
  async function dont(fiok, empId, { dontes, mezok: ertekek = {}, forras = null,
                                      ma = today() } = {}) {
    const emp = EmployeeRepo.get(empId);
    if (!emp) throw new Error('Nincs ilyen dolgozó.');
    if (!['igen', 'nem'].includes(dontes)) throw new Error('A döntés: hosszabbít vagy nem hosszabbít.');
    const mn = minoseg(fiok, emp, ma);
    if (!mn) throw new Error('Erről a dolgozóról nem dönthetsz.');
    const a = allapot(emp, ma);
    const elozo = a.dontes ? a.dontes.dontes : null;
    if (elozo === dontes) throw new Error('Ez már a rögzített döntés.');
    const ugyFutott = !!a.ugy;

    const tiszta = {};
    for (const m of mezok()) {
      const v = ertekek[m.key];
      tiszta[m.key] = m.type === 'checkbox' ? !!v : String(v == null ? '' : v).trim();
    }
    for (const m of mezok()) {
      if (m.kotelezo && m.type !== 'checkbox' && !tiszta[m.key]) {
        throw new Error(`Kötelező: ${m.label}.`);
      }
    }
    // Futó ügynél a módosításhoz indoklás kell (3.5).
    if (elozo && ugyFutott && !tiszta.indoklas) {
      throw new Error('A hosszabbítási ügy már fut: a módosításhoz indoklás kell.');
    }
    let fr = null;
    if (mn === 'hrbp' && forras && forras.tipus) {
      if (!FORRASOK.includes(forras.tipus)) throw new Error('Ismeretlen forrás.');
      fr = { tipus: forras.tipus, megj: String(forras.megj || '').trim() };
    }

    return hozzafuz({
      tipus: elozo ? TIPUS.MODOSITAS : TIPUS.DONTES,
      empId: emp.id, nev: nev(emp), torzsszam: torzsszam(emp), k2: k2Of(emp),
      lejarat: a.lejarat, napok: a.napok, sav: a.sav,
      dontes, elozo, mezok: tiszta,
      rogzitette: fiok.name, minoseg: mn, forras: fr, ugyFutott,
    });
  }

  /** Jegyzet a dolgozóhoz — közös: a HR is látja. */
  async function jegyzet(fiok, empId, szoveg, { ma = today() } = {}) {
    const emp = EmployeeRepo.get(empId);
    if (!emp) throw new Error('Nincs ilyen dolgozó.');
    const t = String(szoveg || '').trim();
    if (!t) throw new Error('Üres jegyzet.');
    const mn = minoseg(fiok, emp, ma);
    if (!mn) throw new Error('Ehhez a dolgozóhoz nem írhatsz jegyzetet.');
    const a = allapot(emp, ma);
    return hozzafuz({ tipus: TIPUS.JEGYZET, empId: emp.id, nev: nev(emp),
      torzsszam: torzsszam(emp), k2: k2Of(emp), lejarat: a.lejarat, napok: a.napok,
      sav: a.sav, szoveg: t, rogzitette: fiok.name, minoseg: mn });
  }

  /** Egy erős figyelmeztetés tudomásulvétele — üzleti tény, ezért napló. */
  async function nyugtaz(fiok, refId) {
    const ref = osszes().find(e => e.id === refId);
    if (!ref) throw new Error('Nincs ilyen esemény.');
    if (nyugtazva(refId)) return null;
    return hozzafuz({ tipus: TIPUS.NYUGTA, ref: refId, empId: ref.empId, nev: ref.nev,
      torzsszam: ref.torzsszam, k2: ref.k2, rogzitette: fiok.name });
  }

  function nyugtazva(refId) {
    return osszes().find(e => e.tipus === TIPUS.NYUGTA && e.ref === refId) || null;
  }

  /** Erős, nyugtázandó: a K2 egy már futó ügynél módosított (3.5). */
  function nyugtazando(e) { return e.tipus === TIPUS.MODOSITAS && !!e.ugyFutott; }

  // ── Listák (3.3, 3.7) ───────────────────────────────────────────────────────
  function aktivDolgozok() {
    try { return EmployeeRepo.all(); } catch { return []; }
  }

  /** 1. lista: döntésre vár. Lejárt is benne van; a lejárat szerint növekvő. */
  function dontesreVar(fiok, ma = today()) {
    const out = [];
    for (const emp of aktivDolgozok()) {
      if (!lathato(fiok, emp, ma)) continue;
      const a = allapot(emp, ma);
      if (a.napok == null || a.sav == null || a.dontes) continue;
      out.push(a);
    }
    return out.sort((x, y) => x.napok - y.napok);
  }

  /**
   * 2. lista: döntések. Az aktuális kör döntése, és a lezárt kör döntése még
   * `LEZART_NAPOK` napig (így látszik az „Engedélyezve …-ig”). `korabbiak`:
   * minden korábbi kör is.
   */
  function dontesek(fiok, { ma = today(), korabbiak = false } = {}) {
    const hatar = napEltol(ma, -LEZART_NAPOK);
    const out = [];
    for (const emp of aktivDolgozok()) {
      if (!lathato(fiok, emp, ma)) continue;
      const a = allapot(emp, ma);
      a.korok.forEach((k, i) => {
        if (!k.dontes) return;
        const aktualis = i === a.korok.length - 1;
        if (!aktualis && !korabbiak && String(k.vege).slice(0, 10) < hatar) return;
        out.push({ emp, allapot: a, kor: k, aktualis });
      });
    }
    return out.sort((x, y) => String(y.kor.dontes.at).localeCompare(String(x.kor.dontes.at)));
  }

  /** Az ügy állása a döntéshez (2. lista). */
  function ugyAllasa(emp, kor) {
    const c = kor.ugy || nyitottUgy(emp.id);
    if (!c) return 'Nincs még ügy';
    if (!c.closedAt) {
      try { return CaseTypes.statusLabel(c.type, c.status); } catch { return c.status; }
    }
    if (c.outcome === 'megadva') {
      return c.validUntil ? `Engedélyezve ${c.validUntil}-ig` : 'Engedélyezve';
    }
    try { return CaseTypes.outcomeLabel(c.outcome) || 'Lezárva'; } catch { return 'Lezárva'; }
  }

  /**
   * Adatminőség (3.7): aki itt van, az az 1. listából NÉMÁN kimaradna.
   * K2-hiány csak a listahorizonton belül számít — a 2 év múlva lejárónál még
   * nem teendő.
   */
  function adatminoseg(ma = today()) {
    const out = { lejaratNelkul: [], k2Nelkul: [], k2NemFiok: [] };
    for (const emp of aktivDolgozok()) {
      const l = lejaratOf(emp);
      if (!l) { out.lejaratNelkul.push(emp); continue; }
      if (sav(napokIg(l, ma)) == null) continue;
      const k2 = k2Of(emp);
      if (!k2) out.k2Nelkul.push(emp);
      else if (!Leaders.isAccountName(k2)) out.k2NemFiok.push(emp);
    }
    return out;
  }

  /** Az ügyintéző teendői (3.8) az aktuális kör döntéseiből. */
  function teendok(ma = today()) {
    const out = { indithato: [], atvetel: [], visszavetel: [], visszavonas: [] };
    for (const emp of aktivDolgozok()) {
      const a = allapot(emp, ma);
      const d = a.dontes;
      if (!d) continue;
      if (d.dontes === 'igen') {
        if (emp.noRenewal) out.visszavetel.push(a);
        else if (!a.ugy) out.indithato.push(a);
      } else {
        if (a.ugy) out.visszavonas.push(a);
        if (!emp.noRenewal) out.atvetel.push(a);
      }
    }
    const rend = (x, y) => (x.napok ?? 1e9) - (y.napok ?? 1e9);
    for (const k of Object.keys(out)) out[k].sort(rend);
    return out;
  }

  // ── Értesítések (3.9) ───────────────────────────────────────────────────────
  /**
   * A fiók összesítője — kiszámolva, nem tárolva. Minden tételnek stabil `id`-je
   * van (az olvasottság ehhez kötődik); a sávváltás egy sávonként EGY tételt ad,
   * nem naponta egyet.
   *   -> [{ id, csoport, erosseg: normal|surgos|eros, szoveg, empId, at,
   *         nyugtazando, ref }]
   * `mindenHrbp`: a HRBP a mindenkiét kéri, nem csak a sajátjait.
   */
  function ertesitesek(fiok, { ma = today(), mindenHrbp = false } = {}) {
    if (!fiok) return [];
    const out = new Map();
    const tesz = t => { if (!out.has(t.id)) out.set(t.id, t); };
    const hatar = napEltol(ma, -LEZART_NAPOK);
    const friss = e => String(e.at).slice(0, 10) >= hatar;
    const en = Auth.fold(fiok.name);
    const k2Jog = roleCan(fiok, 'renewals.decide.own');
    const hrbpJog = roleCan(fiok, 'renewals.decide');
    const ugyJog = roleCan(fiok, 'cases.write');
    const mindentLat = roleCan(fiok, 'renewals.read');
    const DONT = { igen: 'hosszabbít', nem: 'nem hosszabbít' };
    const ERTESITO_SAV = ['esedekes', 'kesesben', 'utolso', 'vismaior'];
    const evs = osszes();

    for (const emp of aktivDolgozok()) {
      const a = allapot(emp, ma);
      const n = nev(emp);
      const k2Kap = k2Jog && k2Kapcsolat(fiok, emp, ma);

      // K2: döntés nélküli dolgozója sávot váltott (≤ 14 napnál és lejártnál nincs).
      if (k2Kap && !a.dontes && !emp.noRenewal && ERTESITO_SAV.includes(a.sav)) {
        tesz({ id: `sav:${emp.id}:${a.lejarat}:${a.sav}`, csoport: 'Döntésre vár',
          erosseg: a.sav === 'esedekes' ? 'normal' : 'surgos', empId: emp.id, at: ma,
          szoveg: `${n}: ${savLabel(a.sav)} — ${a.napok} nap a lejáratig (${a.lejarat})` });
      }
      // K2: átszervezés miatt új dolgozó került hozzá, döntésre várva. Csak a
      // K2-CSERE számít (volt előző K2): a mező első kitöltése bevezetéskor nem
      // „új dolgozó”, arról a sávértesítés szól.
      if (k2Kap && !a.dontes && a.sav) {
        const h = [...(emp.history || [])].reverse().find(x => (x.changes || []).some(c =>
          c.key === K2 && c.from && Auth.fold(c.to) === Auth.fold(k2Of(emp))));
        if (h && friss(h) && Auth.fold(k2Of(emp)) === en) {
          tesz({ id: `k2uj:${emp.id}:${h.at}`, csoport: 'Döntésre vár', erosseg: 'normal',
            empId: emp.id, at: h.at,
            szoveg: `Új dolgozó került hozzád K2-ként: ${n} (lejárat: ${a.lejarat})` });
        }
      }
      // K2 és közvetlen vezető: lezárult a hosszabbítás.
      if (!mindentLat && (k2Kapcsolat(fiok, emp, ma) || vezetoKapcsolat(fiok, emp, ma))) {
        for (const k of a.korok) {
          if (!k.ugy || String(k.ugy.closedAt) < hatar) continue;
          tesz({ id: `ugy:${k.ugy.id}`, csoport: 'Ügyek', erosseg: 'normal', empId: emp.id,
            at: k.ugy.closedAt, szoveg: k.ugy.outcome === 'megadva' && k.ugy.validUntil
              ? `${n} engedélyét ${k.ugy.validUntil}-ig meghosszabbították`
              : `${n}: a hosszabbítási ügy lezárult — ${ugyAllasa(emp, k)}` });
        }
      }
      // HRBP: eszkaláció — 90 napon belül, és még nincs döntés.
      const hrbpKor = hrbpJog && (mindenHrbp || !hrbpOf(emp) || Auth.fold(hrbpOf(emp)) === en);
      if (hrbpKor && !a.dontes && !emp.noRenewal && a.napok != null &&
          a.napok <= ablak().esedekes && a.napok >= ablak().vismaior) {
        tesz({ id: `eszk:${emp.id}:${a.lejarat}`, csoport: 'Döntésre vár', erosseg: 'surgos',
          empId: emp.id, at: ma,
          szoveg: `${n}: ${a.napok} nap a lejáratig, és a K2 (${k2Of(emp) || 'nincs megadva'}) még nem döntött` });
      }
      // Ügyintéző: teendők az aktuális kör döntéséből (az Áttekintésben is).
      const d = a.dontes;
      if (ugyJog && d) {
        const nap = String(d.at).slice(0, 10);
        if (d.dontes === 'igen' && emp.noRenewal) {
          tesz({ id: `vissza:${d.id}`, csoport: 'Teendők', erosseg: 'surgos', empId: emp.id,
            at: d.at, szoveg: `${n}: a K2 Igenre módosított — a „nem hosszabbítjuk” jelölés visszavétele` });
        } else if (d.dontes === 'igen' && !a.ugy) {
          tesz({ id: `ind:${d.id}`, csoport: 'Teendők', erosseg: 'normal', empId: emp.id,
            at: d.at, szoveg: `Indítható: ${n} — a K2 jóváhagyta (${nap})` });
        }
        if (d.dontes === 'nem' && a.ugy) {
          tesz({ id: `visszavon:${d.id}`, csoport: 'Teendők', erosseg: 'surgos', empId: emp.id,
            at: d.at, szoveg: `${n}: a K2 visszavonta — a kérelem visszavonása?` });
        }
        if (d.dontes === 'nem' && !emp.noRenewal) {
          tesz({ id: `atv:${d.id}`, csoport: 'Teendők', erosseg: 'normal', empId: emp.id,
            at: d.at, szoveg: `Nem hosszabbít — átvétel: ${n} (${nap})` });
        }
      }
    }

    // Naplóesemények: a nevében döntöttek (K2), döntés és módosítás (HRBP),
    // erős figyelmeztetés futó ügynél (HRBP, ügyintéző).
    const empById = new Map(aktivDolgozok().map(e => [e.id, e]));
    for (const e of evs) {
      if (!DONTES_TIPUS.includes(e.tipus)) continue;
      const emp = empById.get(e.empId);
      const sajat = Auth.fold(e.rogzitette) === en;
      const eros = nyugtazando(e) && !nyugtazva(e.id);
      const szoveg = e.tipus === TIPUS.MODOSITAS
        ? `${e.nev}: a döntés módosult — ${DONT[e.elozo] || e.elozo} → ${DONT[e.dontes]} (${e.rogzitette}${e.minoseg !== 'k2' ? ', ' + MINOSEG[e.minoseg] : ''})`
        : `${e.nev}: ${DONT[e.dontes]} (${e.rogzitette}${e.minoseg !== 'k2' ? ', ' + MINOSEG[e.minoseg] : ''})`;
      const alap = { id: `ev:${e.id}`, empId: e.empId, at: e.at, ref: e.id };

      if (eros && (hrbpJog || ugyJog) && !sajat) {
        tesz(Object.assign({}, alap, { csoport: 'Nyugtázandó', erosseg: 'eros', nyugtazando: true,
          szoveg: `${szoveg} — az ügy már fut! Indoklás: ${(e.mezok || {}).indoklas || '—'}` }));
        continue;
      }
      if (!friss(e) || sajat) continue;
      if (k2Jog && emp && Auth.fold(e.k2) === en && e.minoseg !== 'k2') {
        tesz(Object.assign({}, alap, { csoport: 'Döntések', erosseg: 'normal',
          szoveg: `A nevedben döntöttek — ${szoveg}` }));
      }
      if (hrbpJog && (mindenHrbp || !emp || !hrbpOf(emp) || Auth.fold(hrbpOf(emp)) === en)) {
        tesz(Object.assign({}, alap, { csoport: 'Döntések',
          erosseg: e.tipus === TIPUS.MODOSITAS ? 'eros' : 'normal', szoveg }));
      }
    }
    return [...out.values()];
  }

  return {
    FILENAME, UGYTIPUS, LEZART_NAPOK, SEED, SAVOK, TIPUS, MINOSEG, FORRASOK,
    useConfigBackend, loadConfig, config, mezok, setSavok,
    ablak, hatarok, sav, savLabel, napokIg,
    useBackend, createFileBackend, load, loaded, serult, onChange, osszes, esemenyei,
    korok, allapot, minoseg, lathato, k2Kapcsolat, vezetoKapcsolat,
    dont, jegyzet, nyugtaz, nyugtazva, nyugtazando,
    dontesreVar, dontesek, ugyAllasa, adatminoseg, teendok, ertesitesek,
    nev, torzsszam, k2Of, vezetoOf, lejaratOf,
  };
})();

if (typeof globalThis !== 'undefined' && typeof module === 'undefined') {
  globalThis.Hosszabbitas = Hosszabbitas;
}
