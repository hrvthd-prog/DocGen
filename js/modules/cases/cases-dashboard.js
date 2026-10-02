'use strict';

/**
 * Ügyek — áttekintő.
 *
 * Az Ügyek fül részletező panelje eddig üresen állt, amíg valaki ki nem
 * választott egy ügyet. Ez tölti ki: az a nézet, ami reggel megnyitva
 * megmondja, mi a teendő.
 *
 * ── A vezérelv ────────────────────────────────────────────────────────────
 * A legfontosabb, amit egy ilyen felület mutathat, az az ügy, ami MÉG NINCS.
 * A lejárt ügy már látszik: piros pötty a fül címkéjén, saját szűrő a listán,
 * ott van a sorban. A nem létező ügy viszont láthatatlan, egészen addig, amíg
 * baj nem lesz belőle — ezért áll az első blokkban.
 *
 * Minden elemnek van kattintása és következő lépése. Ami csak számot mutat,
 * azt két hét után senki nem nézi.
 *
 * A számítás (`adatok`) szándékosan külön van a megjelenítéstől: a felületet
 * böngésző nélkül nem lehet mérni, a számokat viszont igen — lásd
 * test/cases-dashboard.test.js.
 */
const CasesDashboard = (() => {

  /**
   * Meddig előre nézünk a hiányzó ügyeknél?
   *
   * 90 nap — mert a benyújtási ablak pontosan ennyivel a lejárat előtt nyílik
   * (`SUBMISSION_WINDOW_DEFAULT.earliestDays: -90`). Ennél korábban felvetni
   * zaj: még beadni sem lehetne. A szám tehát nem ízlés kérdése, hanem a
   * jogszabályi ablaké — ha az változik, a case-types.js-ből kell követni.
   */
  const HORIZONT = 90;

  /**
   * A benyújtási ablak fázisai, amikhez TEENDŐ tartozik.
   * A `korai` kimarad: ott épp az a helyes, ha nem csinálunk semmit.
   */
  const SURGETO_FAZIS = ['siess', 'lekesve'];

  /**
   * A nyitott ügyek állapot szerinti bontásának címkéi.
   *
   * Miért saját címke, és nem `CaseTypes.statusLabel`? Ugyanaz a státuszkulcs
   * ügytípusonként más szót kap („Beadva" kérelemnél, „Benyújtva"
   * bejelentésnél), a bontás viszont típusokon ÁT csoportosít. Egy csoportnak
   * egy neve lehet — ezért a közös szó. Ismeretlen kulcsnál marad a típus
   * saját címkéje.
   */
  const ALLAPOT_CIMKE = {
    elokeszites: 'Előkészítés',
    beadva:      'Beadva',
    hianypotlas: 'Hiánypótlás',
    elbiralas:   'Elbírálás alatt',
  };
  const ALLAPOT_SORREND = Object.keys(ALLAPOT_CIMKE);

  /**
   * Nyitott ügyek állapot szerint, és azon belül: hol hiányzik még az
   * azonosító.
   *
   * „Nyitott" önmagában semmit nem mond arról, hogy hol tart az ügy. Ez a
   * bontás az, ami megmondja: még nálunk van, vagy már a hatóságnál — és ha
   * már beadtuk, megjött-e az iktatószám. Előkészítés alatt az azonosító
   * hiánya nem hiány, ott még nem is lehetne meg; ezért ott nem számoljuk.
   */
  function allapotBontas(ugyek = null) {
    const lista = ugyek || CaseRepo.openCases();
    const map = new Map();
    for (const c of lista) {
      const kulcs = c.status || 'elokeszites';
      if (!map.has(kulcs)) {
        map.set(kulcs, {
          key: kulcs,
          label: ALLAPOT_CIMKE[kulcs] || CaseTypes.statusLabel(c.type, kulcs) || kulcs,
          db: 0, iktatoNelkul: 0, ehNelkul: 0,
        });
      }
      const a = map.get(kulcs);
      a.db++;
      if (kulcs !== 'elokeszites') {
        if (!c.fileNumber) a.iktatoNelkul++;
        if (!c.ehNumber)   a.ehNelkul++;
      }
    }
    const rang = k => {
      const i = ALLAPOT_SORREND.indexOf(k);
      return i === -1 ? ALLAPOT_SORREND.length : i;
    };
    return [...map.values()].sort((a, b) =>
      rang(a.key) - rang(b.key) || a.label.localeCompare(b.label, 'hu'));
  }

  let ctx = null;
  function init(context) { ctx = context; }

  // ── Számítás ───────────────────────────────────────────────────────────────

  /**
   * Minden szám és lista, amit az áttekintő mutat.
   * `ma` csak a teszteknek — élesben a mai nap.
   */
  function adatok({ ma = null } = {}) {
    const ugyek = CaseRepo.openCases(ma);

    let dolgozok = [];
    try { dolgozok = EmployeeRepo.all(); } catch { dolgozok = []; }

    // 1. Hiányzó ügyek: lejáró engedély nyitott meghosszabbítás nélkül.
    let hianyzo = [];
    try { hianyzo = CaseRepo.suggestRenewals(dolgozok, { belul: HORIZONT, ma }); }
    catch { hianyzo = []; }

    // 2. Benyújtási ablak a nyitott ügyeken.
    const ablak = { korai: [], idealis: [], siess: [], lekesve: [] };
    const vanAblaka = new Set();
    for (const c of ugyek) {
      let st = null;
      try { st = CaseRepo.submissionStatus(c, mezok(c.employeeId), ma); } catch { st = null; }
      if (!st) continue;
      vanAblaka.add(c.id);
      if (st.done || !ablak[st.phase]) continue;
      ablak[st.phase].push({ ugy: c, allapot: st });
    }

    // 3. Amit semmi nem időzít.
    //
    //    Határidő híján a `daysLeft` null-t ad, az `urgency` ezért mindig
    //    'nyitott' — az ilyen ügy sosem pirosodik ki magától.
    //
    //    DE: a meghosszabbításnak jellemzően nincs is `dueAt`-je, viszont van
    //    benyújtási ablaka, ami pontosan megmondja, mikor kell cselekedni.
    //    Azt a fenti blokk mutatja, tehát ide nem való — kétszer jelentenénk
    //    ugyanazt. Ide csak az kerül, amit SEM határidő, SEM ablak nem időzít.
    const hataridoNelkul = ugyek.filter(c => !c.dueAt && !vanAblaka.has(c.id));

    let szamok = { lejart: 0, surgos: 0, nyitott: 0 };
    try { szamok = CaseRepo.summary(ma); } catch { /* marad a nulla */ }

    return {
      szamok,
      allapotok: allapotBontas(ugyek),
      hianyzo,
      ablak,
      surgetoAblak: SURGETO_FAZIS.flatMap(f => ablak[f]),
      hataridoNelkul,
      ugyekSzama: ugyek.length,
      // Van-e egyáltalán teendő? Ebből lesz a „minden rendben" állapot.
      vanTeendo: !!(szamok.lejart || hianyzo.length ||
                    SURGETO_FAZIS.some(f => ablak[f].length) || hataridoNelkul.length),
    };
  }

  function mezok(employeeId) {
    try { return (EmployeeRepo.get(employeeId) || {}).fields || {}; } catch { return {}; }
  }

  function nev(employeeId) {
    return ctx && ctx.dolgozoNeve ? ctx.dolgozoNeve(employeeId) : '';
  }

  function napSzoveg(n) {
    if (n == null) return '';
    if (n < 0)  return `${-n} napja lejárt`;
    if (n === 0) return 'ma jár le';
    return `${n} nap múlva`;
  }

  // ── Megjelenítés ───────────────────────────────────────────────────────────

  function render() {
    const d = adatok();

    return `
      <div class="dash">
        ${szamlalokHtml(d)}
        ${allapotHtml(d)}
        ${d.vanTeendo ? '' : rendbenHtml(d)}
        ${hianyzoHtml(d)}
        ${ablakHtml(d)}
        ${hataridoNelkulHtml(d)}
      </div>`;
  }

  function rendbenHtml(d) {
    return `
      <div class="dash-ok">
        <div class="dash-ok__title">Nincs teendő</div>
        <div class="dash-ok__sub">
          ${d.ugyekSzama
            ? `${d.ugyekSzama} nyitott ügy, mind határidőn belül, és nincs olyan lejáró
               engedély, amihez ne indult volna el az ügy.`
            : 'Nincs nyitott ügy.'}
        </div>
      </div>`;
  }

  /** A három szám a lista szűrőjét állítja — enélkül csak dísz lenne. */
  function szamlalokHtml(d) {
    const csempe = (kulcs, cimke, ertek, stilus) => `
      <button class="dash-stat dash-stat--${stilus} ${ertek ? '' : 'is-zero'}"
              data-filter="${kulcs}" type="button"
              title="Szűrés a listán: ${escHtml(cimke)}">
        <span class="dash-stat__num">${ertek}</span>
        <span class="dash-stat__label">${escHtml(cimke)}</span>
      </button>`;

    return `
      <div class="dash-stats">
        ${csempe('lejart',  'lejárt határidő', d.szamok.lejart,  'red')}
        ${csempe('surgos',  'sürgős (14 nap)', d.szamok.surgos,  'amber')}
        ${csempe('nyitott', 'nyitott ügy',     d.szamok.nyitott, 'neutral')}
      </div>`;
  }

  /**
   * Nyitott ügyek állapot szerint. A csempe a listát szűri (`st:<kulcs>`),
   * az alatta álló sor pedig azt mondja meg, mi hiányzik még ahhoz, hogy az
   * ügy azonosítható legyen a hatóságnál.
   */
  function allapotHtml(d) {
    if (!d.allapotok.length) return '';

    const csempe = a => `
      <button class="dash-stat dash-stat--slim" data-filter="st:${escHtml(a.key)}" type="button"
              title="Szűrés a listán: ${escHtml(a.label)}">
        <span class="dash-stat__num">${a.db}</span>
        <span class="dash-stat__label">${escHtml(a.label)}</span>
        ${a.iktatoNelkul || a.ehNelkul ? `<span class="dash-stat__hint">${
          [a.ehNelkul ? `${a.ehNelkul} EH szám nélkül` : '',
           a.iktatoNelkul ? `${a.iktatoNelkul} iktatószám nélkül` : ''
          ].filter(Boolean).join(' · ')}</span>` : ''}
      </button>`;

    return blokk(
      'Nyitott ügyek állapota',
      'Hol tart az ügy, és megjött-e már hozzá az azonosító.',
      `<div class="dash-stats dash-stats--sub">${d.allapotok.map(csempe).join('')}</div>`);
  }

  function blokk(cim, leiras, tartalom, stilus = '') {
    return `
      <section class="dash-block ${stilus}">
        <div class="dash-block__title">${cim}</div>
        ${leiras ? `<div class="dash-block__sub">${leiras}</div>` : ''}
        ${tartalom}
      </section>`;
  }

  function hianyzoHtml(d) {
    if (!d.hianyzo.length) return '';
    return blokk(
      `Nincs még ügye — ${d.hianyzo.length}`,
      `Lejáró tartózkodási engedély, amihez nem indult meghosszabbítás.
       A benyújtási ablak ${HORIZONT} nappal a lejárat előtt nyílik.`,
      `<div class="dash-list">
        ${d.hianyzo.map(j => `
          <button class="dash-row" data-new-for="${escHtml(j.employee.id)}" type="button"
                  title="Meghosszabbítási ügy nyitása">
            <span class="dash-row__main">${escHtml(nev(j.employee.id))}</span>
            <span class="dash-row__meta ${j.daysLeft < 0 ? 'is-late' : ''}">
              ${escHtml(napSzoveg(j.daysLeft))}
            </span>
            <span class="dash-row__go">Ügy nyitása</span>
          </button>`).join('')}
      </div>`,
      'dash-block--red');
  }

  function ablakHtml(d) {
    const surgeto = d.surgetoAblak;
    const beadhato = d.ablak.idealis.length;
    if (!surgeto.length && !beadhato) return '';

    // A sürgetők elöl, de a „most beadható" is listázódik: az is cselekvés, és
    // a pill önmagában csak annyit mondana, HOGY van ilyen — azt nem, hogy ki.
    const listazando = [...d.ablak.lekesve, ...d.ablak.siess, ...d.ablak.idealis];

    const fej = [];
    if (beadhato) fej.push(`<span class="dash-pill dash-pill--green">${beadhato} most beadható</span>`);
    if (d.ablak.siess.length)   fej.push(`<span class="dash-pill dash-pill--amber">${d.ablak.siess.length} ablak záródik</span>`);
    if (d.ablak.lekesve.length) fej.push(`<span class="dash-pill dash-pill--red">${d.ablak.lekesve.length} lekésve</span>`);

    return blokk(
      'Benyújtási ablak',
      `Meghosszabbításnál nem a határidő a kérdés, hanem hogy mikor lehet
       egyáltalán beadni.`,
      `<div class="dash-pills">${fej.join('')}</div>
       ${listazando.length ? `<div class="dash-list">
         ${listazando.map(t => `
           <button class="dash-row" data-open-case="${escHtml(t.ugy.id)}" type="button">
             <span class="dash-row__main">${escHtml(nev(t.ugy.employeeId))}</span>
             <span class="dash-row__meta ${t.allapot.phase === 'lekesve' ? 'is-late' : ''}">
               ${escHtml(t.allapot.text)}
             </span>
             <span class="dash-row__go">Megnyitás</span>
           </button>`).join('')}
       </div>` : ''}`,
      surgeto.length ? 'dash-block--amber' : '');
  }

  function hataridoNelkulHtml(d) {
    if (!d.hataridoNelkul.length) return '';
    return blokk(
      `Határidő nélkül — ${d.hataridoNelkul.length}`,
      `Sem határidejük, sem benyújtási ablakuk nincs, ezért sosem jeleznek
       maguktól. Add meg a kiváltó napot.`,
      `<div class="dash-list">
        ${d.hataridoNelkul.map(c => `
          <button class="dash-row" data-open-case="${escHtml(c.id)}" type="button">
            <span class="dash-row__main">${escHtml(nev(c.employeeId))}</span>
            <span class="dash-row__meta">hiányzik: ${escHtml(CaseTypes.triggerLabel(c.type) || CaseTypes.label(c.type))}</span>
            <span class="dash-row__go">Megnyitás</span>
          </button>`).join('')}
      </div>`);
  }

  return { init, render, adatok, allapotBontas, HORIZONT };
})();
