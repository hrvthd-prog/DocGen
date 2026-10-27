'use strict';

/**
 * Tömeges ügyintézés — egy lépésben több dolgozó (TERV-tomeges-ugyintezes.md).
 *
 * Az első (és egyelőre egyetlen) típus a szálláshely-változás: ugyanaz az új
 * cím több dolgozónál. Eddig ez export → Excel → import → Dokumentumok fül volt.
 *
 * Lépések egy oldalon: típus → dolgozók → új adatok → összesítő és jóváhagyás →
 * rögzítés (nyilvántartás + dolgozónként egy ügy, közös `batchId`-vel) →
 * dokumentumgenerálás a modulon belül.
 *
 * A logika (`terv`, `rogzit`, `koteg`) böngésző nélkül tesztelhető
 * (test/bulk-case.test.js); a felület csak ezeket hívja. Itt van az ügytípus ↔
 * sablon hozzárendelés párbeszéde is (`openTemplates`), mert a generálás ebből
 * választ elő.
 */
const BulkCase = (() => {

  /**
   * A tömeges típusok KÓDBAN: mindegyikhez más mezőcsoport és ügytípus tartozik.
   * A mezők viszont a sémából jönnek — ha a csoport bővül, az űrlap is.
   */
  const TIPUSOK = [
    { key: 'szallashely', label: 'Szálláshely-változás',
      caseType: 'szallashely_valtozas', group: 'lakcim' },
  ];

  const SOURCE = 'tomeges_ugy';

  function tipus(key) { return TIPUSOK.find(t => t.key === key) || null; }

  /** A típus szerkeszthető mezői a sémából (számított mező nélkül). */
  function mezoi(t) {
    return SchemaStore.fields({ includeComputed: false }).filter(f => f.group === t.group);
  }

  function nevOf(emp) {
    if (!emp) return '(törölt személy)';
    const v = SchemaStore.resolveValues(emp.fields, 'hu');
    return [v.surname, v.forename].filter(Boolean).join(' ') || '(névtelen)';
  }

  /** Egysoros cím: a számított lakcím, ha a séma ismeri, különben a mezők sorban. */
  function cim(t, fields) {
    const v = SchemaStore.resolveValues(fields || {}, 'hu');
    if (v.address) return v.address;
    return mezoi(t).map(f => SchemaStore.renderValue(f, fields[f.key], 'hu')).filter(Boolean).join(' ');
  }

  const str = x => String(x == null ? '' : x).trim();

  // ── Logika ─────────────────────────────────────────────────────────────────

  /**
   * Mi fog változni? Semmit nem módosít.
   *
   * Az új cím TELJES CSERE: az üresen hagyott mező (emelet, ajtó…) törlődik,
   * különben a régi címből bent ragadna (döntés: TERV 9.). A validáció csak a
   * típus mezőire szól — egy máshol hiányzó kötelező mező nem akaszthatja meg
   * a címváltozást.
   *
   * → [{ emp, nev, uj, valtozasok: [{key, label, from, to}], hibak, regiCim, ujCim, nyitottUgy }]
   */
  function terv(t, employeeIds, ujErtekek = {}) {
    const kulcsok = mezoi(t).map(f => f.key);
    return employeeIds.map(id => EmployeeRepo.get(id)).filter(Boolean).map(emp => {
      const uj = {};
      for (const k of kulcsok) uj[k] = str(ujErtekek[k]);
      const utana = Object.assign({}, emp.fields, uj);
      const valtozasok = kulcsok
        .filter(k => str(emp.fields[k]) !== uj[k])
        .map(k => ({ key: k, label: SchemaStore.field(k).label.hu, from: str(emp.fields[k]), to: uj[k] }));
      const hibak = SchemaStore.validateValues(utana)
        .filter(p => kulcsok.includes(p.key)).map(p => p.message);
      let nyitottUgy = false;
      try { nyitottUgy = CaseRepo.hasOpenCaseOfType(emp.id, t.caseType); } catch { /* ügyek nélkül */ }
      return { emp, nev: nevOf(emp), uj, valtozasok, hibak,
               regiCim: cim(t, emp.fields), ujCim: cim(t, utana), nyitottUgy };
    });
  }

  /**
   * A jóváhagyott terv végrehajtása: a nyilvántartás (ugyanaz az út, mint az
   * importnál — napló, validáció, mentés), dolgozónként egy ügy közös köteggel,
   * majd mentés és VISSZAOLVASÁS a tárolóból.
   *
   * → { batchId, ugyek: [id], hibak: [{nev, uzenet}], nemMentett: [nev] }
   */
  async function rogzit(t, sorok, { triggerDate = null } = {}) {
    const batchId = CaseRepo.newId();
    const ugyek = [], hibak = [];
    for (const s of sorok) {
      try {
        if (s.valtozasok.length) EmployeeRepo.update(s.emp.id, { fields: s.uj, source: SOURCE });
        ugyek.push(CaseRepo.create({
          employeeId: s.emp.id, type: t.caseType, triggerDate: triggerDate || null, batchId,
          note: `Tömeges ügyintézés — ${sorok.length} dolgozó`,
        }).id);
      } catch (e) {
        hibak.push({ nev: s.nev, uzenet: e.message });
      }
    }
    const elteres = await EmployeeRepo.verifyStored(sorok.map(s => s.emp.id));
    await CaseRepo.flush();
    return { batchId, ugyek, hibak, nemMentett: elteres.map(id => nevOf(EmployeeRepo.get(id))) };
  }

  /** Egy köteg: az ügyei, a dolgozói és a típusa (a köteg újranyitásához). */
  function koteg(batchId) {
    const ugyek = CaseRepo.batch(batchId);
    if (!ugyek.length) return null;
    const t = TIPUSOK.find(x => x.caseType === ugyek[0].type) || null;
    return { ugyek, t, ids: [...new Set(ugyek.map(c => c.employeeId))],
             openedAt: ugyek[0].openedAt };
  }

  /** A generáláshoz előre kijelölt sablonok: az ügytípushoz rendeltek, amik meg is vannak. */
  function elovalasztott(caseType, elerheto) {
    const t = CaseTypes.byKey(caseType);
    const van = new Set(elerheto);
    return ((t && t.templates) || []).filter(n => van.has(n));
  }

  // ── Felület ────────────────────────────────────────────────────────────────

  const jog = k => typeof Auth === 'undefined' || Auth.can(k);

  /** Írhat-e tömegesen? Ügy ÉS nyilvántartás is változik. */
  function hasznalhato() { return jog('cases.write') && jog('registry.write'); }

  let gyoker = null, bezaras = null;
  let st = null;

  function ujAllapot() {
    return {
      tipus: TIPUSOK[0].key, ids: [], ertekek: {}, triggerDate: '',
      batchId: null, rogzites: null,     // rögzítés után: a `rogzit` eredménye
      sablonok: null,                    // Set; null = az ügytípus hozzárendelése
      outDir: null, perWorker: false, fut: false, eredmeny: null,
    };
  }

  /**
   * Az oldal megnyitása a megadott gyökérben. `batchId`: meglévő köteg — ilyenkor
   * a rögzítés már megtörtént, a generálási lépésnél nyílik.
   */
  function open(el, { batchId = null, onClose = null } = {}) {
    gyoker = el;
    bezaras = onClose;
    st = ujAllapot();
    if (batchId) {
      const k = koteg(batchId);
      if (k && k.t) {
        st.tipus = k.t.key;
        st.ids = k.ids.filter(id => EmployeeRepo.get(id));
        st.batchId = batchId;
        st.triggerDate = k.ugyek[0].triggerDate || '';
        st.rogzites = { batchId, ugyek: k.ugyek.map(c => c.id), hibak: [], nemMentett: [], korabbi: k.openedAt };
      }
    }
    rajzol();
  }

  function bezar() {
    if (st && st.fut) { toast('A generálás még fut — várd meg a végét.', 'warn'); return; }
    if (bezaras) bezaras();
  }

  function q(sel) { return gyoker.querySelector(sel); }

  function lepesHtml(n, cim, allapot, tartalom) {
    return `
      <section class="bk-step bk-step--${allapot}">
        <div class="bk-num">${allapot === 'done' ? '✓' : n}</div>
        <div class="bk-main">
          <h3 class="bk-title">${escHtml(cim)}</h3>
          ${tartalom}
        </div>
      </section>`;
  }

  function mezoHtml(f) {
    const id = 'bk-f-' + f.key;
    const val = str(st.ertekek[f.key]);
    let input;
    if (f.type === 'enum') {
      const opts = ValueCodec.options(f, 'hu');
      input = `<select class="field-select" id="${id}" data-key="${escHtml(f.key)}">
          <option value="">—</option>
          ${opts.map(o => `<option value="${escHtml(o.id)}"${o.id === val ? ' selected' : ''}>${escHtml(o.label)}</option>`).join('')}
        </select>`;
    } else if (f.type === 'date') {
      input = dateFieldHtml({ id, key: f.key, value: val });
    } else {
      input = `<input type="text" class="field-input" id="${id}" data-key="${escHtml(f.key)}" value="${escHtml(val)}">`;
    }
    return `
      <label class="ef-field" for="${id}">
        <span class="ef-label">${escHtml(f.label.hu)}${f.required ? '<span class="ef-req">*</span>' : ''}</span>
        ${input}
      </label>`;
  }

  function rajzol() {
    if (!gyoker || !st) return;
    const t = tipus(st.tipus);
    const kesz = !!st.rogzites;
    const vanDolgozo = st.ids.length > 0;

    const nevek = st.ids.map(id => nevOf(EmployeeRepo.get(id)));
    const dolgozoLista = vanDolgozo
      ? `<div class="bk-chips">${nevek.slice(0, 40).map(n => `<span class="bk-chip">${escHtml(n)}</span>`).join('')}${
          nevek.length > 40 ? `<span class="bk-chip is-more">+${nevek.length - 40}</span>` : ''}</div>`
      : '<div class="bk-hint">Még nincs kiválasztott dolgozó.</div>';

    const l1 = lepesHtml(1, 'Ügytípus', kesz ? 'done' : 'active', `
      <select class="field-select bk-type" id="bk-type" ${kesz ? 'disabled' : ''}>
        ${TIPUSOK.map(x => `<option value="${x.key}" ${x.key === st.tipus ? 'selected' : ''}>${escHtml(x.label)}</option>`).join('')}
      </select>
      <div class="bk-hint">Dolgozónként egy „${escHtml(CaseTypes.label(t.caseType))}” ügy nyílik, közös kötegben.</div>`);

    const l2 = lepesHtml(2, `Dolgozók${vanDolgozo ? ` (${st.ids.length})` : ''}`,
      kesz ? 'done' : (vanDolgozo ? 'done' : 'active'), `
      ${kesz ? '' : `<button type="button" class="btn btn-secondary btn-sm" id="bk-pick">${
        vanDolgozo ? 'Kiválasztás módosítása…' : 'Dolgozók kiválasztása…'}</button>`}
      ${dolgozoLista}`);

    const l3 = lepesHtml(3, 'Új szálláshely', kesz ? 'done' : (vanDolgozo ? 'active' : 'off'), kesz
      ? `<div class="bk-summary">${escHtml(cim(t, Object.assign({}, (EmployeeRepo.get(st.ids[0]) || {}).fields)) || '—')}${
          st.triggerDate ? ` · költözés: ${escHtml(st.triggerDate)}` : ''}</div>`
      : `<div class="ef-grid bk-grid">${mezoi(t).map(mezoHtml).join('')}
           <label class="ef-field" for="bk-trigger">
             <span class="ef-label">${escHtml(CaseTypes.triggerLabel(t.caseType))}</span>
             ${dateFieldHtml({ id: 'bk-trigger', value: st.triggerDate })}
           </label>
         </div>
         <div class="bk-hint">Az üresen hagyott mező a dolgozóknál <b>törlődik</b> — az új cím
           teljes csere. A ${escHtml(CaseTypes.triggerLabel(t.caseType)).toLowerCase()} nem kötelező:
           ebből jön az ügy határideje.</div>
         <div class="bk-err" id="bk-err"></div>`);

    const l4 = lepesHtml(4, 'Összesítő és rögzítés', kesz ? 'done' : (vanDolgozo ? 'active' : 'off'), kesz
      ? rogzitesEredmenyHtml()
      : `<button type="button" class="btn btn-primary btn-sm" id="bk-review" ${vanDolgozo ? '' : 'disabled'}>
           Mi fog változni? — összesítő…</button>
         <div class="bk-hint">Az összesítő után, jóváhagyással írunk a nyilvántartásba.</div>`);

    const l5 = lepesHtml(5, 'Dokumentumok generálása', kesz ? 'active' : 'off',
      kesz ? generalasHtml(t) : '<div class="bk-hint">A rögzítés után nyílik meg.</div>');

    gyoker.innerHTML = `
      <div class="cv-page cv-page--scroll bk">
        <div class="cv-dhead">
          <button class="cv-backbtn" id="bk-back" type="button">‹ Vissza</button>
          <div class="cv-dhead__who">
            <span class="cv-dhead__nev">Tömeges ügyintézés — ${escHtml(t.label)}</span>
            <span class="cv-dhead__sub">${kesz
              ? `Rögzítve · ${st.ids.length} dolgozó · ${st.rogzites.ugyek.length} ügy a kötegben`
              : 'Több dolgozó egyszerre: adatfrissítés, ügyek és iratok egy helyen'}</span>
          </div>
        </div>
        <div class="bk-body">${l1}${l2}${l3}${l4}${l5}</div>
      </div>`;
    kot(t);
  }

  function rogzitesEredmenyHtml() {
    const r = st.rogzites;
    if (r.korabbi) return `<div class="bk-ok">Rögzítve ${escHtml(r.korabbi)}-n — ${r.ugyek.length} ügy a kötegben.</div>`;
    const gond = r.hibak.length || r.nemMentett.length;
    return `
      <div class="${gond ? 'bk-warn' : 'bk-ok'}">
        ${r.nemMentett.length ? '' : `✓ ${st.ids.length - r.hibak.length} dolgozó adata mentve, és visszaolvasva a nyilvántartásból.`}
        ✓ ${r.ugyek.length} ügy megnyitva (Ügyek → „Tömeges” jelölés).
      </div>
      ${r.hibak.length ? `<ul class="bk-errlist">${r.hibak.map(h =>
          `<li><b>${escHtml(h.nev)}</b>: ${escHtml(h.uzenet)}</li>`).join('')}</ul>` : ''}
      ${r.nemMentett.length ? `<div class="bk-warn">⚠ Visszaolvasáskor eltérés — ezek NEM kerültek a
          tárolóba: ${r.nemMentett.map(escHtml).join(', ')}. Ellenőrizd az adatmappát, és töltsd újra.</div>` : ''}`;
  }

  function generalasHtml(t) {
    if (!jog('docgen.generate')) return '<div class="bk-hint">Dokumentumot generálni a mostani szinttel nem lehet.</div>';
    if (!DocgenModule.templatesReady()) {
      return `<div class="bk-hint">A sablonmappához nincs hozzáférés (a böngésző indulásonként elveszi).</div>
              <button type="button" class="btn btn-secondary btn-sm" id="bk-tpl-dir">Sablonmappa engedélyezése</button>`;
    }
    const elerheto = DocgenModule.templateNames().slice().sort((a, b) => a.localeCompare(b, 'hu'));
    if (!st.sablonok) st.sablonok = new Set(elovalasztott(t.caseType, elerheto));
    const hozzarendelt = new Set((CaseTypes.byKey(t.caseType) || {}).templates || []);
    const hianyzo = [...hozzarendelt].filter(n => !elerheto.includes(n));
    const db = st.sablonok.size * st.ids.length;
    const kellMappa = FsService.hasFsApi;

    return `
      <div class="bk-gen">
        <div class="bk-gen__col">
          <div class="bk-subtitle">Sablonok
            <a href="#" class="bk-link" id="bk-tpl-map">Hozzárendelés az ügytípushoz…</a></div>
          ${hozzarendelt.size ? '' : `<div class="bk-hint">Ehhez az ügytípushoz még nincs sablon rendelve —
            jelöld ki itt, vagy rendeld hozzá, hogy legközelebb előre ki legyenek választva.</div>`}
          <div class="bk-tpls">
            ${elerheto.map(n => `
              <label class="check-row bk-tpl">
                <input type="checkbox" data-tpl="${escHtml(n)}" ${st.sablonok.has(n) ? 'checked' : ''}>
                <span>${escHtml(n)}</span>${hozzarendelt.has(n) ? '<span class="bk-tag">ügytípus</span>' : ''}
              </label>`).join('') || '<div class="bk-hint">A sablonmappában nincs sablon.</div>'}
            ${hianyzo.map(n => `<div class="bk-tpl is-missing" title="Hozzárendelve, de nincs a sablonmappában">
              ${escHtml(n)} — nem található</div>`).join('')}
          </div>
        </div>
        <div class="bk-gen__col">
          <div class="bk-subtitle">Kimeneti mappa</div>
          <div class="bk-out">
            <button type="button" class="btn btn-secondary btn-sm" id="bk-out">Tallózás…</button>
            <span class="bk-outname">${st.outDir ? '📁 ' + escHtml(st.outDir.name)
              : (kellMappa ? 'nincs kiválasztva' : 'letöltésként érkeznek')}</span>
          </div>
          <button type="button" class="bk-toggle ${st.perWorker ? 'is-on' : ''}" id="bk-perworker"
                  aria-pressed="${st.perWorker}">
            <span class="bk-toggle__dot"></span>
            Külön mappa minden dolgozónak
          </button>
          <div class="bk-hint">${st.perWorker
            ? `Minden dolgozó a saját mappájába kap: <code>&lt;Név&gt;\\${escHtml(FsService.DIR_PREP)}</code>
               (a meglévő mappát megtalálja, ha nincs, kérdés nélkül létrehozza; ha több hasonló
               nevű van, rákérdez).`
            : 'Minden fájl közvetlenül a választott mappába kerül.'}</div>
          <div class="bk-actions">
            <button type="button" class="btn btn-primary" id="bk-gen-pdf"
                    ${(!db || (kellMappa && !st.outDir) || st.fut) ? 'disabled' : ''}>DOCX + PDF (${db} fájl)</button>
            <button type="button" class="btn btn-secondary" id="bk-gen-docx"
                    ${(!db || (kellMappa && !st.outDir) || st.fut) ? 'disabled' : ''}>Csak DOCX</button>
          </div>
          <div class="bk-progress" id="bk-progress" ${st.fut ? '' : 'hidden'}><div id="bk-progress-bar"></div></div>
          <div class="bk-status" id="bk-status"></div>
          <div id="bk-result">${eredmenyHtml()}</div>
        </div>
      </div>`;
  }

  function eredmenyHtml() {
    const e = st.eredmeny;
    if (!e) return '';
    return `
      <div class="${e.errors.length ? 'bk-warn' : 'bk-ok'}">
        ${e.errors.length ? `Kész — ${e.errors.length} hiba, ` : '✓ '}${e.count} dokumentum
        ${e.outName ? `a <b>${escHtml(e.outName)}</b> mappában` : 'letöltve'}.
      </div>
      ${e.errors.length ? `<ul class="bk-errlist">${e.errors.map(x => `<li>${escHtml(x)}</li>`).join('')}</ul>` : ''}
      ${e.pdf && e.docxCount && e.outName ? `<div class="bk-hint"><b>A PDF-hez:</b> ${e.szkript
          ? `a mappában kattints duplán a <code>${escHtml(DocgenPdfChain.SCRIPT_OUT)}</code> fájlra.`
          : `a konvertáló szkript nincs beállítva, ezért nem került a mappába — a Dokumentumok fül
             „PDF összefűzés” kártyáján állítható be (egyszer kell).`}</div>` : ''}
      ${e.missing ? `<div class="bk-hint">${e.missing} dokumentumban maradt üres mező.
          <button type="button" class="btn btn-ghost btn-sm" id="bk-missing">Hiányzó adatok naplója</button></div>` : ''}`;
  }

  // ── Események ──────────────────────────────────────────────────────────────

  function kot(t) {
    q('#bk-back').addEventListener('click', bezar);
    q('#bk-type')?.addEventListener('change', e => {
      st.tipus = e.target.value; st.ertekek = {}; rajzol();
    });
    q('#bk-pick')?.addEventListener('click', dolgozoValaszto);

    // A beírt érték azonnal az állapotba kerül: egy közbejött újrarajzolás
    // (pl. dolgozóválasztás után) így nem viszi el. Mikrotaszkban olvasunk: a
    // dátummaszk (utils.js) a dokumentum szintjén, a mi figyelőnk UTÁN alakítja
    // a „20261020”-at „2026-10-20”-ra.
    gyoker.querySelectorAll('.bk-grid [data-key]').forEach(el => {
      const ment = () => queueMicrotask(() => { st.ertekek[el.dataset.key] = el.value; });
      el.addEventListener('input', ment);
      el.addEventListener('change', ment);
    });
    const tr = q('#bk-trigger');
    if (tr) ['input', 'change'].forEach(ev =>
      tr.addEventListener(ev, () => queueMicrotask(() => { st.triggerDate = tr.value; })));

    q('#bk-review')?.addEventListener('click', () => osszesito(t));

    q('#bk-tpl-dir')?.addEventListener('click', async () => {
      try { await DocgenModule.requestTemplatesDir(); } catch (e) { toast(e.message, 'error'); }
      rajzol();
    });
    q('#bk-tpl-map')?.addEventListener('click', e => {
      e.preventDefault();
      openTemplates({ typeKey: t.caseType, onSaved: () => { st.sablonok = null; rajzol(); } });
    });
    gyoker.querySelectorAll('[data-tpl]').forEach(cb => cb.addEventListener('change', () => {
      if (cb.checked) st.sablonok.add(cb.dataset.tpl); else st.sablonok.delete(cb.dataset.tpl);
      rajzol();
    }));
    q('#bk-out')?.addEventListener('click', mappaValaszto);
    q('#bk-perworker')?.addEventListener('click', () => { st.perWorker = !st.perWorker; rajzol(); });
    q('#bk-gen-pdf')?.addEventListener('click', () => general(true));
    q('#bk-gen-docx')?.addEventListener('click', () => general(false));
    q('#bk-missing')?.addEventListener('click', () => DocgenMissingLog.showDialog());
  }

  /** Ugyanaz a választó és ugyanazok az oszlopok, mint a Dokumentumok fülön. */
  function dolgozoValaszto() {
    let emberek = [];
    try { emberek = EmployeeRepo.all(); } catch { emberek = []; }
    if (!emberek.length) { toast('A nyilvántartás üres.', 'warn'); return; }
    const sorok = emberek.map(emp => {
      const v = SchemaStore.resolveValues(emp.fields, 'hu');
      const sap = EmployeeRepo.currentIdentifier(emp, 'sap');
      let ugy = null;
      try { ugy = CaseRepo.docIdentifiers(emp.id); } catch { ugy = null; }
      return Object.assign({}, v, {
        __id: emp.id,
        'Azonosító': sap ? sap.value : '',
        'EH szám':    ugy ? ugy.ehNumber   : '',
        'Iktatószám': ugy ? ugy.fileNumber : '',
      });
    });
    ClientPicker.open({
      title:      'Érintett dolgozók kiválasztása',
      rows:       sorok,
      storageKey: 'docgen-clients',
      selected:   st.ids,
      rowKey:     r => r.__id,
      onSave: (rows, keys) => { st.ids = keys; rajzol(); },
    });
  }

  function osszesito(t) {
    const err = q('#bk-err');
    const vanErtek = mezoi(t).some(f => str(st.ertekek[f.key]));
    if (!vanErtek) { if (err) err.textContent = 'Add meg az új szálláshely adatait.'; return; }
    if (st.triggerDate && !/^\d{4}-\d{2}-\d{2}$/.test(st.triggerDate)) {
      if (err) err.textContent = 'A dátum alakja: ÉÉÉÉ-HH-NN.'; return;
    }
    const sorok = terv(t, st.ids, st.ertekek);
    const hibak = [...new Set(sorok.flatMap(s => s.hibak))];
    if (hibak.length) { if (err) err.innerHTML = hibak.map(escHtml).join('<br>'); return; }
    if (err) err.textContent = '';

    const ujCim = sorok[0] ? sorok[0].ujCim : '';
    const nyitott = sorok.filter(s => s.nyitottUgy).length;
    showDialog({
      title: `Összesítő — ${sorok.length} dolgozó`,
      body: `
        <div class="bk-dlg-head">
          Új szálláshely: <b>${escHtml(ujCim || '—')}</b>
          ${st.triggerDate ? ` · ${escHtml(CaseTypes.triggerLabel(t.caseType))}: <b>${escHtml(st.triggerDate)}</b>` : ''}
        </div>
        ${nyitott ? `<div class="bk-warn">${nyitott} dolgozónak már van nyitott
          „${escHtml(CaseTypes.label(t.caseType))}” ügye — új ügy nyílik mellé.</div>` : ''}
        <div class="data-table-wrap" style="max-height:52vh">
          <table class="data-table bk-dlg-table">
            <thead><tr><th>Dolgozó</th><th>Jelenlegi cím</th><th>Változás</th></tr></thead>
            <tbody>${sorok.map(s => `
              <tr>
                <td><b>${escHtml(s.nev)}</b>${s.nyitottUgy ? ' <span class="bk-tag is-warn">van nyitott ügye</span>' : ''}</td>
                <td>${escHtml(s.regiCim || '—')}</td>
                <td>${s.valtozasok.length ? s.valtozasok.map(v => `
                  <div><span class="bk-muted">${escHtml(v.label)}:</span> ${escHtml(v.from || '—')} →
                    ${v.to ? `<b>${escHtml(v.to)}</b>` : '<b class="bk-del">(törlődik)</b>'}</div>`).join('')
                  : '<span class="bk-muted">nincs változás — a cím már ez</span>'}</td>
              </tr>`).join('')}</tbody>
          </table>
        </div>
        <p class="ef-hint">Jóváhagyás után: a címek a nyilvántartásba íródnak (a változásnaplóban
          „tömeges ügyintézés” forrással), és dolgozónként megnyílik egy ügy közös kötegben.</p>`,
      footer: `
        <button class="btn btn-ghost btn-sm" onclick="closeDialog()">Mégse</button>
        <button class="btn btn-primary btn-sm" id="bk-confirm">Jóváhagyom és rögzítem</button>`,
    });
    const gomb = document.getElementById('bk-confirm');
    gomb.addEventListener('click', async () => {
      gomb.disabled = true;
      gomb.textContent = 'Rögzítés…';
      try {
        st.rogzites = await rogzit(t, sorok, { triggerDate: st.triggerDate || null });
        st.batchId = st.rogzites.batchId;
        closeDialog();
        BevLogger.info('TOMEGES_UGY', `Tömeges ${t.label}: ${sorok.length} dolgozó`,
          `ugyek=${st.rogzites.ugyek.length}, hibak=${st.rogzites.hibak.length}, nemMentett=${st.rogzites.nemMentett.length}`,
          `batch=${st.batchId}`);
        toast(st.rogzites.nemMentett.length || st.rogzites.hibak.length
          ? '⚠ A rögzítés részben sikerült — nézd meg a részleteket'
          : `✓ ${sorok.length} dolgozó rögzítve, ${st.rogzites.ugyek.length} ügy megnyitva`,
          st.rogzites.nemMentett.length || st.rogzites.hibak.length ? 'error' : 'success');
        rajzol();
      } catch (e) {
        gomb.disabled = false;
        gomb.textContent = 'Jóváhagyom és rögzítem';
        BevLogger.error('TOMEGES_UGY', 'A tömeges rögzítés nem sikerült', e.message, '');
        toast('A mentés nem sikerült: ' + e.message, 'error');
      }
    });
  }

  async function mappaValaszto() {
    if (!FsService.hasFsApi) { toast('Ez a böngésző nem tud mappát választani — a fájlok letöltésként érkeznek.', 'warn'); return; }
    try {
      // A saját `id` miatt a rendszerablak a legutóbb választott helyen nyílik.
      st.outDir = await window.showDirectoryPicker({ id: 'tomeges_kimenet', mode: 'readwrite' });
      st.eredmeny = null;
      rajzol();
    } catch (e) {
      if (e.name !== 'AbortError') toast('A mappa nem választható: ' + e.message, 'error');
    }
  }

  async function general(pdf) {
    if (st.fut) return;
    const sablonok = [...st.sablonok];
    st.fut = true;
    st.eredmeny = null;
    rajzol();
    const bar = q('#bk-progress-bar'), allapot = q('#bk-status');
    const status = (msg, pct) => {
      if (allapot) allapot.textContent = msg;
      if (bar && pct != null) bar.style.width = pct + '%';
    };
    try {
      const r = await DocgenModule.generateFor({
        employeeIds: st.ids, templates: sablonok, outputDir: st.outDir,
        perWorker: st.perWorker, docx: true, pdf, ui: { status },
      });
      st.eredmeny = Object.assign(r, { pdf, outName: st.outDir ? st.outDir.name : '' });
    } catch (e) {
      st.eredmeny = { count: 0, docxCount: 0, missing: 0, errors: [e.message], pdf, outName: '' };
    } finally {
      st.fut = false;
      rajzol();
    }
  }

  // ── Ügytípus ↔ sablon hozzárendelés ────────────────────────────────────────

  /**
   * A sablonmappa sablonjai jelölőnégyzettel, ügytípusonként. A hozzárendelés a
   * közös configba kerül (`CaseTypes` → docgen-config.json), és a tömeges
   * generálás ebből választ elő. Ami hozzá van rendelve, de most nincs a
   * mappában, megmarad — egy átmeneti mappahiba ne törölje.
   */
  function openTemplates({ typeKey = null, onSaved = null } = {}) {
    const tipusok = CaseTypes.all();
    if (!tipusok.length) return;
    let aktiv = typeKey && CaseTypes.byKey(typeKey) ? typeKey : tipusok[0].key;
    const munka = new Map(tipusok.map(x => [x.key, new Set(x.templates || [])]));
    let szuro = '';

    showDialog({
      title: 'Ügytípus-sablonok',
      body: `
        <p class="ef-hint">Mely sablonok kellenek egy ügytípushoz? A tömeges ügyintézés
          generálásnál ezek lesznek előre kijelölve.</p>
        <div class="bk-map-bar">
          <select class="field-select" id="ct-type">
            ${tipusok.map(x => `<option value="${escHtml(x.key)}" ${x.key === aktiv ? 'selected' : ''}>${escHtml(x.label.hu)}</option>`).join('')}
          </select>
          <input type="search" class="field-input" id="ct-q" placeholder="Sablon keresése…">
        </div>
        <div id="ct-body" class="bk-map-list"></div>`,
      footer: `
        <button class="btn btn-ghost btn-sm" onclick="closeDialog()">Mégse</button>
        <button class="btn btn-primary btn-sm" id="ct-save">Mentés</button>`,
    });

    const body = document.getElementById('ct-body');
    const lista = () => {
      if (!DocgenModule.templatesReady()) {
        body.innerHTML = `<div class="bk-hint">A sablonmappához nincs hozzáférés.</div>
          <button type="button" class="btn btn-secondary btn-sm" id="ct-dir">Sablonmappa engedélyezése</button>`;
        document.getElementById('ct-dir').addEventListener('click', async () => {
          try { await DocgenModule.requestTemplatesDir(); } catch (e) { toast(e.message, 'error'); }
          lista();
        });
        return;
      }
      const jelolt = munka.get(aktiv);
      const elerheto = DocgenModule.templateNames().slice().sort((a, b) => a.localeCompare(b, 'hu'));
      const nincs = [...jelolt].filter(n => !elerheto.includes(n));
      const lathato = elerheto.filter(n => !szuro || n.toLowerCase().includes(szuro));
      body.innerHTML = lathato.map(n => `
          <label class="check-row bk-tpl">
            <input type="checkbox" data-ct="${escHtml(n)}" ${jelolt.has(n) ? 'checked' : ''}>
            <span>${escHtml(n)}</span>
          </label>`).join('')
        + nincs.map(n => `
          <label class="check-row bk-tpl is-missing" title="Nincs a sablonmappában">
            <input type="checkbox" data-ct="${escHtml(n)}" checked>
            <span>${escHtml(n)} — nem található</span>
          </label>`).join('')
        || '<div class="bk-hint">Nincs sablon.</div>';
      body.querySelectorAll('[data-ct]').forEach(cb => cb.addEventListener('change', () => {
        if (cb.checked) jelolt.add(cb.dataset.ct); else jelolt.delete(cb.dataset.ct);
      }));
    };
    document.getElementById('ct-type').addEventListener('change', e => { aktiv = e.target.value; lista(); });
    document.getElementById('ct-q').addEventListener('input', e => { szuro = e.target.value.trim().toLowerCase(); lista(); });
    lista();

    document.getElementById('ct-save').addEventListener('click', async () => {
      for (const [k, set] of munka) {
        const t = CaseTypes.byKey(k);
        if (t) t.templates = [...set];
      }
      try {
        const tarolva = await CaseTypes.save();
        closeDialog();
        toast(tarolva ? '✓ Ügytípus-sablonok mentve'
                      : 'Mentve erre a munkamenetre (nincs adatmappa)', tarolva ? 'success' : 'warn');
        if (onSaved) onSaved();
      } catch (e) {
        toast('A mentés nem sikerült: ' + e.message, 'error');
      }
    });
  }

  return {
    TIPUSOK, tipus, mezoi, terv, rogzit, koteg, elovalasztott,
    hasznalhato, open, openTemplates,
  };
})();
