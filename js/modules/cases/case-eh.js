'use strict';

/**
 * Enter Hungary kitöltés-segéd.
 *
 * A munkavállaló adatai az EH ROVATSORRENDJÉBEN, egy kattintással másolható
 * formában. A munkamód: két böngészőablak egymás mellett (fele-fele, ~960 px),
 * és Alt+Tab közöttük — ezért a kéz a billentyűzeten van, és a másolás egy
 * Enter, nem egy egérrel megcélzott gomb.
 *
 * A KÉT SORFAJTA különbsége adja a modul arányait:
 *   - másolható mező: `<input readonly>` + másoló gomb. Ez a funkció lényege.
 *   - listás mező (`row.list`): az EH-n legördülő/rádiógomb, oda a vágólapról
 *     nem lehet értéket tenni. Csak megmutatjuk az értéket és egy tippet —
 *     semmilyen átalakító logika nem épül rá.
 *
 * Az űrlapleírás adat: `js/schema/eh-forms.js`.
 */
const CaseEh = (() => {

  // Ügyenként megjegyzett jogcím + a már másolt sorok. Egyik sem tárolódik:
  // a másolás-jelölés csak fogódzó ahhoz, hol tartasz a ~180 soros listában.
  const state = {
    jogcim:   {},          // caseId → 'c7' | 'c9' | 'c12'
    masolt:   new Set(),   // 'caseId|eh'
    fokusz:   null,        // az utoljára fókuszált sor eh-neve
    // A kézi sorok elrejthetők. Ezekre a panel semmit nem tud adni (nincs
    // mögöttük adat), a ~180 sorból viszont 77 ilyen — ennyi zaj elfedi a
    // munkát. Ez megjegyződik: aki elrejti, annak holnap is rejtve induljon.
    keziRejtve: Settings.get('eh_hide_manual', false),
  };

  // ── Értékfeloldás ──────────────────────────────────────────────────────────

  /**
   * A megjelenítendő érték és a hozzá tartozó jelzések.
   *
   * A dátum és a szám SZÁNDÉKOSAN a nyers, tárolt alakban megy: a
   * `resolveValues` olvashatóra formáz (1988.04.12., 450 000), az EH viszont
   * ÉÉÉÉ-HH-NN-t és tagolatlan számot vár – a formázott alakot elutasítaná.
   * Itt a másolhatóság a szempont, nem az olvashatóság.
   */
  function ertekOf(row, emp, feloldott, ugy) {
    if (row.const)    return { text: row.const,    fajta: 'const' };
    if (row.employer) return { text: EhForms.employerValue(row.employer), fajta: 'ceg' };
    if (row.setting)  return { text: Settings.ehContact()[row.setting] || '', fajta: 'beallitas' };
    if (row.fromCase) return { text: ugybolErtek(row, ugy), fajta: 'ugy' };
    if (!row.key)     return { text: '', fajta: 'kezi' };

    const mezo = SchemaStore.field(row.key);
    const nyersen = mezo && (mezo.type === 'date' || mezo.type === 'number');
    let text = nyersen
      ? String(emp.fields[row.key] || '')
      : String(feloldott[row.key] == null ? '' : feloldott[row.key]);

    if (!text && row.fallback) text = String(emp.fields[row.fallback] || '');

    const jelzes = [];
    // A `resolveValues` a szabad szöveget már fordítja; itt csak azt nézzük,
    // volt-e mihez nyúlnia. Fordítást NEM találunk ki.
    if (row.dict && text && SchemaStore.translate(text, 'hu') === null) {
      jelzes.push('nincs szótári pár — az EH magyar alakot kér');
    }
    if (row.max && text.length > row.max) {
      jelzes.push(`${text.length} karakter → az EH ${row.max}-re vágja`);
    }
    if (row.unsure) jelzes.push('nem pontosan ugyanaz a fogalom — ellenőrizd');

    return { text, fajta: 'db', jelzes };
  }

  /** Az ügyből jövő érték. Ma egyetlen ilyen van: meghosszabbítás-e a kérelem. */
  function ugybolErtek(row, ugy) {
    if (row.fromCase !== 'hosszabbitas') return '';
    return (ugy && ugy.type === 'rp_hosszabbitas') ? 'igen' : 'nem';
  }

  // ── Megjelenítés ───────────────────────────────────────────────────────────

  /**
   * A kézi sorok nélkül. Az üresen maradó PANELCÍMEK is kimaradnak: cím alatt
   * semmivel a rejtés félkésznek látszana.
   *
   * Hátulról előre megyünk, mert így a `out` utolsó eleme mindig az a sor,
   * ami az eredeti sorrendben `r` UTÁN következik — ebből egy lépésben
   * eldönthető, hogy a panel alatt maradt-e bármi.
   */
  function lathatoSorok(sorok) {
    const out = [];
    for (let i = sorok.length - 1; i >= 0; i--) {
      const r = sorok[i];
      if (r.manual) continue;
      if (r.panel && (!out.length || out[out.length - 1].panel)) continue;
      out.push(r);
    }
    return out.reverse();
  }

  function render(ugy, emp) {
    const jogcim = state.jogcim[ugy.id] || '';
    const mind   = EhForms.rows(jogcim);
    const sorok  = state.keziRejtve ? lathatoSorok(mind) : mind;
    const rejtve = mind.filter(r => r.manual).length;
    const feloldott = SchemaStore.resolveValues(emp.fields, 'hu');

    const valaszto = `
      <label class="eh-jogcim">
        <span>Jogcím</span>
        <select class="field-select" id="eh-jogcim">
          <option value=""${jogcim ? '' : ' selected'}>— válassz jogcímet —</option>
          ${EhForms.JOGCIMEK.map(j => `
            <option value="${escHtml(j.id)}"${j.id === jogcim ? ' selected' : ''}>${escHtml(j.label)}</option>`).join('')}
        </select>
      </label>`;

    const torzs = sorok.map(r => r.panel
      ? `<div class="eh-panel">${escHtml(r.panel)}</div>`
      : sorHtml(r, ertekOf(r, emp, feloldott, ugy), ugy.id)).join('');

    const masolhato = sorok.filter(r =>
      r.eh && !r.list && !r.manual && (r.key || r.employer || r.const || r.fromCase || r.setting)).length;

    return `
      <div class="eh-wrap" id="eh-wrap">
        <div class="eh-head">
          ${valaszto}
          <span class="eh-hint" title="Tab: következő másolható mező · Enter: másol és továbblép · F2: szerkesztés · Esc: elvet">
            ${masolhato} másolható mező · Tab / Enter</span>
          <button class="cv-filter eh-kezi${state.keziRejtve ? ' is-active' : ''}" type="button"
                  id="eh-kezi" aria-pressed="${state.keziRejtve}"
                  title="A kézzel töltendő sorok mögött nincs adat — a panel nem tud rájuk semmit adni">
            ${state.keziRejtve ? `${rejtve} kézi mező rejtve` : 'Kézi mezők elrejtése'}</button>
        </div>
        <div class="eh-rows">${torzs}</div>
      </div>`;
  }

  function sorHtml(row, ertek, caseId) {
    const jel = [
      row.req ? '<span class="eh-req" title="Az EH-n kötelező">*</span>' : '',
    ].join('');
    const megj = []
      .concat(ertek.jelzes || [])
      .concat(row.note ? [row.note] : [])
      .concat(typeof row.list === 'string' ? [row.list] : []);

    const cimke = `<span class="eh-label">${escHtml((row.label || row.eh).trim())}${jel}</span>`;
    const alsoSor = megj.length
      ? `<span class="eh-note">${megj.map(escHtml).join(' · ')}</span>` : '';

    // Listás sor: nincs másoló gomb és nincs a Tab-láncban – oda a vágólapról
    // úgysem lehet értéket tenni.
    if (row.list) {
      const ures = !ertek.text && row.req && ertek.fajta !== 'kezi';
      return `
        <div class="eh-row eh-row--list${ures ? ' is-missing' : ''}" data-eh="${escHtml(row.eh)}">
          ${cimke}
          <span class="eh-value eh-value--list">
            <span class="eh-chev" aria-hidden="true">▾</span>
            ${ertek.text ? escHtml(ertek.text)
                         : `<span class="eh-empty">${ertek.fajta === 'kezi' ? 'kézzel' : 'hiányzik'}</span>`}
          </span>
          <span class="eh-btnslot"></span>
          ${alsoSor}
        </div>`;
    }

    if (ertek.fajta === 'kezi') {
      return `
        <div class="eh-row eh-row--manual" data-eh="${escHtml(row.eh)}">
          ${cimke}
          <span class="eh-value"><span class="eh-empty">kézzel</span></span>
          <span class="eh-btnslot"></span>
          ${alsoSor}
        </div>`;
    }

    const masolt = state.masolt.has(caseId + '|' + row.eh);
    const hianyzik = row.req && !ertek.text;
    const szerkesztheto = ertek.fajta === 'db' && !!row.key;

    return `
      <div class="eh-row${masolt ? ' is-copied' : ''}${hianyzik ? ' is-missing' : ''}"
           data-eh="${escHtml(row.eh)}"${szerkesztheto ? ` data-key="${escHtml(row.key)}"` : ''}>
        ${cimke}
        <input class="eh-input" type="text" readonly value="${escHtml(ertek.text)}"
               data-eh-input="${escHtml(row.eh)}"
               ${hianyzik ? 'placeholder="hiányzik"' : ''}
               title="${szerkesztheto ? 'Enter: másol · F2: szerkesztés' : 'Enter: másol'}">
        <button class="eh-copy" type="button" tabindex="-1" title="Vágólapra">⧉</button>
        ${alsoSor}
      </div>`;
  }

  // ── Események ──────────────────────────────────────────────────────────────

  /**
   * @param {HTMLElement} gyoker  a panelt tartalmazó elem
   * @param {object} ugy, emp
   * @param {function} ujra       teljes újrarajzolás (jogcímváltásnál kell)
   */
  function bind(gyoker, ugy, emp, ujra) {
    const wrap = gyoker.querySelector('#eh-wrap');
    if (!wrap) return;

    const valaszto = gyoker.querySelector('#eh-jogcim');
    if (valaszto) valaszto.addEventListener('change', () => {
      state.jogcim[ugy.id] = valaszto.value;
      ujra();
    });

    const keziGomb = gyoker.querySelector('#eh-kezi');
    if (keziGomb) keziGomb.addEventListener('click', () => {
      state.keziRejtve = !state.keziRejtve;
      Settings.set('eh_hide_manual', state.keziRejtve);
      ujra();
    });

    wrap.querySelectorAll('.eh-copy').forEach(b => {
      b.addEventListener('click', () => {
        const sor = b.closest('.eh-row');
        masol(sor.querySelector('.eh-input'), ugy.id, false);
      });
    });

    wrap.querySelectorAll('.eh-input').forEach(inp => {
      // Fókuszáláskor kijelöljük – ettől a Ctrl+C saját kód nélkül működik.
      inp.addEventListener('focus', () => {
        state.fokusz = inp.dataset.ehInput;
        if (inp.readOnly) inp.select();
      });
      inp.addEventListener('keydown', e => kezelBillentyu(e, inp, ugy, emp));
      inp.addEventListener('change', () => ment(inp, emp));
      inp.addEventListener('dblclick', () => nyit(inp));
    });

    figyelAblakvaltast(wrap);
  }

  function kezelBillentyu(e, inp, ugy, emp) {
    // Szerkesztés közben: Enter ment, Esc elvet.
    if (!inp.readOnly) {
      if (e.key === 'Enter')  { e.preventDefault(); inp.blur(); inp.focus(); }
      if (e.key === 'Escape') {
        e.preventDefault();
        inp.value = inp.dataset.elozo != null ? inp.dataset.elozo : inp.value;
        zar(inp);
      }
      return;
    }
    if (e.key === 'Enter') { e.preventDefault(); masol(inp, ugy.id, true); }
    if (e.key === 'F2')    { e.preventDefault(); nyit(inp); }
  }

  /** Másolás; `ugras` esetén a fókusz a következő másolható mezőre kerül. */
  function masol(inp, caseId, ugras) {
    if (!inp) return;
    copyText(inp.value);
    state.masolt.add(caseId + '|' + inp.dataset.ehInput);
    const sor = inp.closest('.eh-row');
    if (sor) sor.classList.add('is-copied');
    if (ugras) kovetkezo(inp);
  }

  function kovetkezo(inp) {
    const mind = [...inp.closest('.eh-rows').querySelectorAll('.eh-input')];
    const i = mind.indexOf(inp);
    const k = mind[i + 1];
    if (k) { k.focus(); k.select(); }
  }

  function nyit(inp) {
    const sor = inp.closest('.eh-row');
    if (!sor || !sor.dataset.key) return;      // cégadat/konstans nem szerkeszthető
    inp.dataset.elozo = inp.value;
    inp.readOnly = false;
    sor.classList.add('is-editing');
    inp.setSelectionRange(inp.value.length, inp.value.length);
  }

  function zar(inp) {
    inp.readOnly = true;
    const sor = inp.closest('.eh-row');
    if (sor) sor.classList.remove('is-editing');
  }

  /**
   * Mentés a nyilvántartásba. A `change` blur-kor tüzel, tehát egy mezőnyi
   * javítás egy bejegyzés – nem minden leütés.
   *
   * A séma-szabályokat KÜLÖN kell ellenőrizni: az `EmployeeRepo.update`
   * validációja csak az azonosítókat nézi (egyediség, üres érték), a
   * „kötelező", a dátumformátum és az enum-értékek a `SchemaStore`-ban élnek.
   * Enélkül egy kötelező mező üresre törlése némán átmenne.
   */
  function ment(inp, emp) {
    const sor = inp.closest('.eh-row');
    if (!sor || !sor.dataset.key || inp.readOnly) return;
    const kulcs = sor.dataset.key;
    const uj = inp.value.trim();
    if (uj === (inp.dataset.elozo || '').trim()) { zar(inp); return; }

    const gond = SchemaStore
      .validateValues(Object.assign({}, emp.fields, { [kulcs]: uj }))
      .find(p => p.key === kulcs);
    if (gond) return visszaallit(inp, gond.message);

    try {
      EmployeeRepo.update(emp.id, { fields: { [kulcs]: uj }, source: 'eh-panel' });
      const mezo = SchemaStore.field(kulcs);
      toast('✓ Mentve: ' + ((mezo && mezo.label.hu) || kulcs), 'success');
      zar(inp);
    } catch (e) {
      visszaallit(inp, e.message);
    }
  }

  /** Némán elnyelni adatvesztés-érzetet ad: visszaállítunk és megmondjuk, miért. */
  function visszaallit(inp, uzenet) {
    inp.value = inp.dataset.elozo || '';
    zar(inp);
    toast(uzenet, 'error');
  }

  /**
   * Alt+Tab után a böngésző általában megőrzi a fókuszt, de nem mindig (egy
   * közbejött újrarajzolás elejti). Ilyenkor a semmibe nyomnál egy Entert.
   */
  function figyelAblakvaltast(wrap) {
    if (wrap.dataset.fokuszFigyelo) return;
    wrap.dataset.fokuszFigyelo = '1';
    window.addEventListener('focus', () => {
      if (!state.fokusz) return;
      if (document.activeElement && document.activeElement !== document.body) return;
      const cel = document.querySelector(`.eh-input[data-eh-input="${CSS.escape(state.fokusz)}"]`);
      if (cel) { cel.focus(); cel.select(); }
    });
  }

  return { render, bind, _state: state, _lathatoSorok: lathatoSorok };
})();
