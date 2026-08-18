'use strict';

/**
 * Nyilvántartás fül.
 *
 * Bal oldalon az adatmappa és az állapot, jobb oldalon a munkavállalók listája
 * kereséssel. A lista oszlopai is a sémából jönnek – nincs bedrótozott mezőnév.
 */
const RegistryModule = (() => {

  const DATA_DIR_KEY = 'data_dir';
  const LIST_COLUMNS = ['surname', 'forename', 'date_of_birth', 'citizenship', 'position'];

  // A kilépéskor esedékes bejelentés ügytípusa – a határidejét (ma 5 nap) ez
  // adja, nem itteni konstans, mert a Beállításokban átírható.
  const KILEPES_UGYTIPUS = 'munkaviszony_kijelentes';

  let container = null;
  let picker    = null;   // a beágyazott ClientPicker-tábla példánya
  let byId      = new Map();
  let state = {
    ready:           false,
    dirHandle:       null,
    backendKind:     null,      // 'file' | 'idb'
    query:           '',
    showExited:      false,
    selectedId:      null,
    selectedIds:     [],        // tömeges műveletekhez kijelölt rekordok
    // Sérült adatfájl esetén ide kerül a hiba – ilyenkor NEM indulunk üresen
    corruptError:    null,
  };

  // ── Indítás ────────────────────────────────────────────────────────────────

  async function init(el) {
    container = el;
    render();
    bind();
    await restore();
    window.addEventListener('docgenTabActivated', e => {
      if (e.detail === 'registry' && state.ready) renderList();
    });
    EmployeeRepo.onChange(() => { if (state.ready) renderList(); });
  }

  /**
   * Visszatérés a korábbi adatmappához. Ha nincs (vagy nincs fájlrendszer-API),
   * a böngésző tárolójával indulunk, hogy az app azonnal használható legyen.
   */
  async function restore() {
    let handle = null;
    try { handle = await FsService.loadHandle(DATA_DIR_KEY); } catch {}

    if (handle && await FsService.queryPermissionOnly(handle, true)) {
      await useFileBackend(handle);
      return;
    }
    if (handle) {
      // Van mentett mappa, de engedélyre vár – egy kattintással feloldható
      state.dirHandle = handle;
      renderSidebar();
      return;
    }
    await useIdbBackend();
  }

  async function useFileBackend(dirHandle) {
    state.dirHandle   = dirHandle;
    state.backendKind = 'file';
    SchemaStore.useBackend(makeConfigBackend(dirHandle, 'schema'));
    ExportProfiles.useBackend(makeConfigBackend(dirHandle, 'profiles'));
    CaseTypes.useBackend(makeConfigBackend(dirHandle, 'caseTypes'));
    EmployeeRepo.useBackend(EmployeeRepo.createFileBackend(dirHandle));
    CaseRepo.useBackend(CaseRepo.createFileBackend(dirHandle));
    await SchemaStore.load();
    await ExportProfiles.load();
    await CaseTypes.load();

    /**
     * Sérült adatfájlnál NEM indulunk el üresen.
     *
     * Ha üres nyilvántartással indulnánk, a felhasználó azt látná, hogy „nincs
     * adat" – és az első módosítás felülírná a még menthető tartalmat. Ehelyett
     * megállunk, kimondjuk, mi történt, és felajánljuk a visszaállítást.
     */
    try {
      await EmployeeRepo.load();
      await CaseRepo.load();
    } catch (e) {
      if (EmployeeRepo.isCorruptError(e)) {
        state.ready = false;
        state.corruptError = e;
        BevLogger.error('ADATFAJL_SERULT', 'Sérült adatfájl', e.message, `fajl=${e.filename}`);
        renderSidebar();
        renderList();
        return;
      }
      throw e;
    }

    state.corruptError = null;
    state.ready = true;
    await migrateLegacyKeys();
    renderSidebar();
    renderList();
  }

  async function useIdbBackend() {
    state.backendKind = 'idb';
    SchemaStore.useBackend(makeIdbConfigBackend('schema'));
    ExportProfiles.useBackend(makeIdbConfigBackend('profiles'));
    CaseTypes.useBackend(makeIdbConfigBackend('caseTypes'));
    EmployeeRepo.useBackend(EmployeeRepo.createIdbBackend());
    CaseRepo.useBackend(CaseRepo.createIdbBackend());
    await SchemaStore.load();
    await ExportProfiles.load();
    await CaseTypes.load();
    await EmployeeRepo.load();
    await CaseRepo.load();
    state.ready = true;
    await migrateLegacyKeys();
    renderSidebar();
    renderList();
  }

  /**
   * Egyszeri séma-felhozatal: a `_hun` végű mezőkulcsok rövidítése, a kódba
   * felvett új mezők pótlása, és a szándékosan visszavontak kiejtése. A
   * rekordok adatai a kulccsal együtt mozognak, ezért a nyilvántartás
   * betöltése UTÁN fut.
   *
   * A pótlás nélkül a mentett séma sosem kapná meg az új adatkört (a `load()`
   * a mentett configot használja, ha van), és az adatbekérőből is kimaradna.
   */
  async function migrateLegacyKeys() {
    try {
      const emps = EmployeeRepo.all({ includeExited: true });
      const rovidult = SchemaStore.migrateLegacyKeys(emps);
      const uj = SchemaStore.addMissingSeedFields();
      const kiesett = SchemaStore.removeRetiredFields();
      if (!rovidult && !uj && !kiesett) return;
      await SchemaStore.save();
      await EmployeeRepo.flush();
      if (rovidult) BevLogger.info('SEMA_MIGRACIO', 'A _hun mezőkulcsok rövidültek', '', '');
      if (uj) BevLogger.info('SEMA_MIGRACIO', `${uj} új mező került a sémába`, '', '');
      if (kiesett) BevLogger.info('SEMA_MIGRACIO',
        `${kiesett} visszavont mező kikerült a sémából`, '', '');
    } catch (e) {
      BevLogger.warn('SEMA_MIGRACIO', 'A séma-felhozatal nem futott le', e.message, '');
    }
  }

  /**
   * A séma és az export profilok egy közös config fájlban – személyes adat
   * nélkül, így gépek között szabadon vihető.
   */
  function makeConfigBackend(dirHandle, key) {
    const FILE = 'docgen-config.json';
    return {
      describe: () => `${dirHandle.name}/${FILE}`,
      async load() {
        try {
          const cfg = JSON.parse(await FsService.readTextFromDir(dirHandle, FILE));
          return cfg[key] || null;
        } catch { return null; }
      },
      async save(data) {
        let cfg = {};
        try { cfg = JSON.parse(await FsService.readTextFromDir(dirHandle, FILE)); } catch {}
        cfg[key] = data;
        cfg.savedAt = new Date().toISOString();
        await FsService.writeTextToDir(dirHandle, FILE, JSON.stringify(cfg, null, 2));
      },
    };
  }

  function makeIdbConfigBackend(key) {
    const k = 'config_' + key;
    return {
      describe: () => 'böngésző tároló',
      async load() { try { return (await FsService.loadHandle(k)) || null; } catch { return null; } },
      async save(data) { await FsService.saveHandle(k, JSON.parse(JSON.stringify(data))); },
    };
  }

  // ── Megjelenítés ───────────────────────────────────────────────────────────

  function render() {
    container.innerHTML = `
      <div class="sidebar" id="rg-sidebar"></div>
      <div class="workspace">
        <div class="workspace-col">
          <div class="ws-card">
            <div class="ws-card-header">
              <span class="ws-card-title">Munkavállalók</span>
              <span id="rg-count" class="rg-count"></span>
            </div>
            <div class="ws-card-body">
              <div class="rg-toolbar">
                <input type="text" class="field-input rg-search" id="rg-search"
                       placeholder="Keresés név, cím vagy azonosító szerint…">
                <label class="check-row rg-arch-toggle">
                  <input type="checkbox" id="rg-show-exited">
                  <span>Kilépettek is</span>
                </label>
                <button class="btn btn-primary btn-sm" id="rg-new">Új munkavállaló</button>
              </div>
              <div class="rg-toolbar rg-toolbar--io">
                <label class="btn btn-ghost btn-sm sv-file-btn">
                  Import adatbekérőből…
                  <input type="file" id="rg-import" accept=".xlsx,.xlsm" hidden>
                </label>
                <button class="btn btn-ghost btn-sm" id="rg-export-data">Export xlsx-be</button>
                <button class="btn btn-ghost btn-sm" id="rg-export-template">Üres sablon letöltése</button>
                <span class="rg-io-note" id="rg-export-note"></span>
              </div>
              <div id="rg-list"></div>
              <div class="rg-bulk" id="rg-bulk"></div>
            </div>
          </div>
        </div>
      </div>`;
    renderSidebar();
  }

  function renderSidebar() {
    const sb = document.getElementById('rg-sidebar');
    if (!sb) return;

    let tarolo;
    if (state.corruptError) {
      tarolo = `
        <div class="info-row rg-error">Az adatfájl sérült</div>
        <div class="rg-corrupt">
          ${escHtml(state.corruptError.message)}
        </div>
        <button class="sidebar-btn sidebar-btn--primary" id="rg-restore">Visszaállítás mentésből</button>
        <button class="sidebar-btn" id="rg-pick-dir">Másik adatmappa</button>`;
    } else if (!state.ready && state.dirHandle) {
      tarolo = `
        <div class="info-row rg-warn">Az adatmappa engedélyre vár: ${escHtml(state.dirHandle.name)}</div>
        <button class="sidebar-btn" id="rg-grant">Hozzáférés megadása</button>`;
    } else if (state.backendKind === 'file') {
      tarolo = `<div class="info-row" title="${escHtml(state.dirHandle.name)}">${escHtml(state.dirHandle.name)}</div>
                <button class="sidebar-btn" id="rg-pick-dir">Másik adatmappa</button>`;
    } else {
      tarolo = `
        <div class="info-row rg-warn">Böngésző tároló</div>
        <p class="rg-note">
          Az adatok jelenleg a böngészőben vannak. Válassz adatmappát, hogy
          fájlban is meglegyenek – így menthetők és nem tűnnek el a böngésző
          adatainak törlésével.
        </p>
        <button class="sidebar-btn" id="rg-pick-dir">Adatmappa kiválasztása</button>`;
    }

    sb.innerHTML = `
      <div class="sidebar-section">
        <div class="sidebar-section-title">Adatok helye</div>
        ${tarolo}
      </div>
      <div class="sidebar-section">
        <div class="sidebar-section-title">Állapot</div>
        <div class="rg-stat"><span>Aktív</span><b id="rg-stat-active">–</b></div>
        <div class="rg-stat"><span>Kilépett</span><b id="rg-stat-exited">–</b></div>
        <div class="rg-stat"><span>Séma verzió</span><b id="rg-stat-schema">–</b></div>
      </div>`;

    document.getElementById('rg-pick-dir')?.addEventListener('click', pickDataDir);
    document.getElementById('rg-grant')?.addEventListener('click', grantAccess);
    document.getElementById('rg-restore')?.addEventListener('click', openRestoreDialog);
    refreshStats();
  }

  function refreshStats() {
    if (!state.ready) return;
    const a = document.getElementById('rg-stat-active');
    const r = document.getElementById('rg-stat-exited');
    const s = document.getElementById('rg-stat-schema');
    if (a) a.textContent = EmployeeRepo.count();
    if (r) r.textContent = EmployeeRepo.count({ includeExited: true }) - EmployeeRepo.count();
    if (s) s.textContent = SchemaStore.version();
  }

  /**
   * A tábla oszlopnevei: a séma magyar címkéi. Ütköző címkét a gépi kulcs
   * választ szét — az oszlopnév a ClientPickerben egyben az objektumkulcs is,
   * tehát egyedinek kell lennie.
   */
  function columnLabels() {
    const map = new Map();      // fieldKey -> oszlopnév
    const foglalt = new Set();
    for (const f of SchemaStore.fields()) {
      let nev = f.label.hu || f.key;
      if (foglalt.has(nev)) nev = `${nev} (${f.key})`;
      foglalt.add(nev);
      map.set(f.key, nev);
    }
    return map;
  }

  /** Egy rekord a táblának: címke szerinti értékek + azonosító + állapot. */
  function tableRow(emp, labels) {
    const v = SchemaStore.resolveValues(emp.fields, 'hu');
    const sap = EmployeeRepo.currentIdentifier(emp, 'sap');
    const rp  = EmployeeRepo.currentIdentifier(emp, 'residence_permit');
    const idf = sap || rp || (emp.identifiers.find(i => i.current) || null);
    const row = { __id: emp.id };
    for (const [key, nev] of labels) row[nev] = v[key] || '';
    row['Azonosító'] = idf ? idf.value : '';
    row['Állapot']   = emp.exited ? 'kilépett' : 'aktív';
    return row;
  }

  function renderList() {
    const box = document.getElementById('rg-list');
    if (!box || !state.ready) return;

    const rows = EmployeeRepo.search(state.query, { includeExited: state.showExited });
    const cnt = document.getElementById('rg-count');
    if (cnt) cnt.textContent = `${rows.length} személy`;
    refreshStats();

    // Az export mindig azt viszi, amit a felhasználó épp lát
    const note = document.getElementById('rg-export-note');
    if (note) {
      note.textContent = (state.query || state.showExited)
        ? `az export a ${rows.length} látható rekordot viszi`
        : '';
    }

    // Teljesen üres nyilvántartás: ide táblázat helyett útba igazítás kell
    if (!rows.length && !state.query && !EmployeeRepo.count({ includeExited: true })) {
      picker = null;
      state.selectedIds = [];
      renderBulkBar();
      box.innerHTML = bevEmptyState(
        'Még nincs felvett munkavállaló. Kezdd az „Új munkavállaló" gombbal, vagy importálj egy adatbekérő táblázatot.');
      return;
    }

    const labels   = columnLabels();
    const oszlopok = [...labels.values()].concat(['Azonosító', 'Állapot']);
    byId = new Map(rows.map(e => [e.id, e]));
    const tRows = rows.map(e => tableRow(e, labels));

    // A tábla életben marad két rajzolás között: a rendezés, a szűrők, az
    // oszlopbeállítás és a kijelölés csak így éli túl egy mentést vagy importot.
    if (picker && picker._oszlopok === oszlopok.join('|')) {
      picker.setRows(tRows);
      return;
    }

    picker = ClientPicker.inline({
      container:  box,
      rows:       tRows,
      columns:    oszlopok,
      visibleColumns: LIST_COLUMNS.map(k => labels.get(k)).filter(Boolean).concat(['Azonosító']),
      rowKey:     r => r.__id,
      storageKey: 'docgen-registry',
      search:     false,          // a fenti rg-search a tárolóban keres, ez csak zavarna
      rowClass:   r => (byId.get(r.__id) && byId.get(r.__id).exited ? 'rg-exited' : ''),
      onSelectionChange: keys => { state.selectedIds = keys; renderBulkBar(); },
    });
    picker._oszlopok = oszlopok.join('|');
  }

  /**
   * Műveleti sáv a táblázat alatt.
   *
   * A gombok nem soronként ismétlődnek, hanem a kijelölésre vonatkoznak: egy
   * soronkénti gombsor négy oszlopnyi helyet vitt el minden sorban, és tömeges
   * munkára használhatatlan volt. Ami egyszerre csak egy rekordra értelmes
   * (előzmények, szerkesztés), az egy kijelöltnél él, a többi bármennyinél.
   */
  function renderBulkBar() {
    const bar = document.getElementById('rg-bulk');
    if (!bar) return;
    const emps = selectedEmployees();
    const n    = emps.length;
    const egy  = n === 1;
    const mind = n > 0 && emps.every(e => e.exited);

    bar.innerHTML = `
      <span class="rg-bulk-count">${
        n ? `<b>${n}</b> kijelölve` : 'Jelölj ki sorokat a művelethez'}</span>
      <button class="btn btn-ghost btn-sm" data-bulk="history" ${egy ? '' : 'disabled'}
              title="Egy kijelölt rekord előzményei">Előzmények</button>
      <button class="btn btn-ghost btn-sm" data-bulk="edit" ${egy ? '' : 'disabled'}
              title="Egy kijelölt rekord szerkesztése">Szerkesztés</button>
      <button class="btn btn-ghost btn-sm" data-bulk="exit" ${n ? '' : 'disabled'}>${
        mind ? 'Visszavétel' : 'Kilépettnek jelölés'}</button>
      <button class="btn btn-ghost btn-sm" data-bulk="export" ${n ? '' : 'disabled'}>Export xlsx-be</button>
      <button class="btn btn-ghost btn-sm rg-del" data-bulk="destroy" ${n ? '' : 'disabled'}
              title="Végleges törlés – téves felvitel javítására">Törlés</button>
      <button class="btn btn-ghost btn-sm" data-bulk="clear" ${n ? '' : 'disabled'}>Kijelölés törlése</button>`;
  }

  /** A kijelölt (és még létező) rekordok. */
  function selectedEmployees() {
    return state.selectedIds.map(id => EmployeeRepo.get(id)).filter(Boolean);
  }

  // ── Műveletek ──────────────────────────────────────────────────────────────

  function bind() {
    const search = document.getElementById('rg-search');
    let t = null;
    search.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => { state.query = search.value; renderList(); }, 150);
    });
    document.getElementById('rg-show-exited').addEventListener('change', e => {
      state.showExited = e.target.checked;
      renderList();
    });
    document.getElementById('rg-new').addEventListener('click', () => openForm(null));

    document.getElementById('rg-import').addEventListener('change', ev => {
      const file = ev.target.files[0];
      ev.target.value = '';
      if (!file) return;
      if (!state.ready) { toast('A nyilvántartás még nem töltődött be.', 'error'); return; }
      RegistryXlsxIO.importFile(file, renderList);
    });
    document.getElementById('rg-export-data').addEventListener('click', () => {
      // A szűrt (látható) halmazt exportáljuk – amit a felhasználó épp lát
      const rows = EmployeeRepo.search(state.query, { includeExited: state.showExited });
      RegistryXlsxIO.exportData(rows);
    });
    document.getElementById('rg-export-template').addEventListener('click',
      () => RegistryXlsxIO.exportTemplate());

    // Minden rekord-művelet a kijelölésre vonatkozik, egy helyről
    document.getElementById('rg-bulk').addEventListener('click', ev => {
      const b = ev.target.closest('[data-bulk]:not([disabled])');
      if (!b) return;
      if (b.dataset.bulk === 'clear') { if (picker) picker.clearSelection(); return; }
      const emps = selectedEmployees();
      if (!emps.length) { toast('Nincs kijelölt rekord.', 'warn'); return; }
      switch (b.dataset.bulk) {
        case 'history': EmployeeHistory.open(emps[0]); break;
        case 'edit':    openForm(emps[0].id); break;
        case 'export':  RegistryXlsxIO.exportData(emps); break;
        case 'destroy': confirmDestroy(emps.map(e => e.id)); break;
        case 'exit':
          // Csupa kilépett kijelölés → visszavétel; különben a még aktívak jelölése
          if (emps.every(e => e.exited)) {
            emps.forEach(e => EmployeeRepo.setExited(e.id, false));
            toast(`${emps.length} rekord visszavéve az aktív állományba`, 'success');
            renderList();
          } else {
            openExitDialog(emps.filter(e => !e.exited));
          }
          break;
      }
    });
  }

  function openForm(id) {
    if (!state.ready) { toast('A nyilvántartás még nem töltődött be.', 'error'); return; }
    EmployeeForm.open({ id, onSave: renderList });
  }

  /**
   * Kilépettnek jelölés — egy vagy több rekordra.
   *
   * A kilépés napját a program nem tudja kitalálni, viszont ebből fut a
   * bejelentési határidő – ezért kötelező, és ezért kérjük külön párbeszédben
   * ahelyett, hogy egy kattintással megtörténne a jelölés.
   *
   * Kiinduló érték a séma „Kilépés dátuma" mezője (a felvételkor tervezett
   * utolsó munkanap), ha van; különben a mai nap. Több rekordnál egy közös nap
   * megy mindenkire – aki más napon lépett ki, azt egyesével kell jelölni.
   */
  function openExitDialog(emps) {
    const lista = [].concat(emps).filter(Boolean);
    if (!lista.length) { toast('Minden kijelölt rekord már kilépett.', 'warn'); return; }
    const tobb = lista.length > 1;
    const alap = (!tobb && lista[0].fields[EmployeeRepo.EXIT_DATE_FIELD])
      || CaseTypes.isoDate(new Date());

    showDialog({
      title: 'Kilépettnek jelölés',
      body: `
        <p style="font-size:13px;margin-bottom:10px">
          ${tobb
            ? `<b>${lista.length} munkavállaló</b> munkaviszonya megszűnt.`
            : `<b>${escHtml(nevOf(lista[0]))}</b> munkaviszonya megszűnt.`}
        </p>
        <div class="ef-field" style="max-width:200px">
          <span class="ef-label">Kilépés dátuma<span class="ef-req">*</span></span>
          ${dateFieldHtml({ id: 'rg-exit-date', value: alap })}
          <span class="ef-field-error" id="rg-exit-error"></span>
        </div>
        <p class="ef-hint" style="margin-top:10px">
          A rekord megmarad és bármikor visszavehető – csak kikerül az aktív
          listákból és a dokumentum-generálásból. A megadott nap a
          <b>Kilépés dátuma</b> mezőbe is bekerül, hogy az export a tényleges
          napot vigye.${tobb ? ' A megadott nap <b>mindegyik</b> kijelölt rekordra érvényes.' : ''}
        </p>`,
      footer: `
        <button class="btn btn-ghost btn-sm" onclick="closeDialog()">Mégse</button>
        <button class="btn btn-primary btn-sm" id="rg-exit-save">Kilépettnek jelölés</button>`,
    });

    document.getElementById('rg-exit-save').addEventListener('click', () => {
      const nap = document.getElementById('rg-exit-date').value.trim();
      const kesz = [];
      for (const emp of lista) {
        try {
          EmployeeRepo.setExited(emp.id, true, nap);
          kesz.push(emp);
        } catch (e) {
          // Az első hibás dátum megállít: a többi rekordon sem lenne értelmesebb
          document.getElementById('rg-exit-error').textContent = e.message;
          if (!kesz.length) return;
          break;
        }
      }
      BevLogger.info('KILEPES', `Kilépettnek jelölve: ${kesz.map(nevOf).join(', ')}`, '', `nap=${nap}`);
      renderList();
      showExitWarning(kesz, nap);
    });
  }

  /**
   * A bejelentési kötelezettség – ez a lépés marad ki a leggyakrabban.
   *
   * A határidőt nem itt drótozzuk be: az ügytípusból jön (Beállítások →
   * Ügytípusok), a hátralévő napokat pedig a CaseRepo számolja – az az egy
   * hely, ahol a naptári napok számítása le van tesztelve. A `daysLeft` csak
   * a határidőt és a lezárást nézi, ezért adható át neki nyers dátum.
   */
  function showExitWarning(emps, nap) {
    const lista = [].concat(emps).filter(Boolean);
    if (!lista.length) return;
    const tobb     = lista.length > 1;
    const tipus    = CaseTypes.byKey(KILEPES_UGYTIPUS);
    const napszam  = tipus ? tipus.defaultDurationDays : 5;
    const hatarido = CaseTypes.suggestDueDate(KILEPES_UGYTIPUS, nap);
    const hatra    = hatarido ? CaseRepo.daysLeft({ dueAt: hatarido, closedAt: null }) : null;
    const lejart   = hatra !== null && hatra < 0;

    const allapot = hatra === null
      ? ''
      : lejart
        ? `<b>Ezt már be kellett volna jelenteni.</b> A határidő
           (<b>${escHtml(hatarido)}</b>) ${-hatra} napja lejárt.`
        : hatra === 0
          ? `A határidő <b>ma (${escHtml(hatarido)})</b> jár le.`
          : `Határidő: <b>${escHtml(hatarido)}</b> – ${hatra} nap van hátra.`;

    // Akinek már van nyitott kijelentési ügye, arra ne nyíljon másodszor
    const ugyNelkul = lista.filter(e => {
      try { return !CaseRepo.hasOpenCaseOfType(e.id, KILEPES_UGYTIPUS); } catch { return false; }
    });

    showDialog({
      title: 'Bejelentési kötelezettség',
      body: `
        <div class="rg-exit-warn${lejart ? ' is-late' : ''}">
          <p>
            ${tobb
              ? `<b>${lista.length} munkavállaló</b> munkaviszonya`
              : `<b>${escHtml(nevOf(lista[0]))}</b> munkaviszonya`}
            <b>${escHtml(nap)}</b> napján szűnt meg. A megszűnést
            <b>be kell jelenteni az OIF-nak a megszűnéstől számított
            ${napszam} napon belül.</b>
          </p>
          ${allapot ? `<p class="rg-exit-deadline">${allapot}</p>` : ''}
        </div>
        <p class="ef-hint">
          A határidő a megadott naptól számol – ha a dátum téves, javítsd a
          kilépés dátumát.
        </p>`,
      footer: `
        ${ugyNelkul.length
          ? `<button class="btn btn-ghost btn-sm" id="rg-exit-case">Bejelentési ügy megnyitása${
               ugyNelkul.length > 1 ? ` (${ugyNelkul.length})` : ''}</button>`
          : ''}
        <button class="btn btn-primary btn-sm" onclick="closeDialog()">Rendben</button>`,
    });

    // Egy figyelmeztetés, amit nem lehet elintézni, pár nap múlva zaj lesz:
    // innen egy kattintással bekerül az Ügyek fülre, a saját határidejével.
    document.getElementById('rg-exit-case')?.addEventListener('click', () => {
      let db = 0;
      for (const emp of ugyNelkul) {
        try {
          CaseRepo.create({ employeeId: emp.id, type: KILEPES_UGYTIPUS, triggerDate: nap });
          db++;
        } catch (e) {
          toast('Az ügy megnyitása nem sikerült: ' + e.message, 'error');
        }
      }
      closeDialog();
      if (db) toast(`${db} bejelentési ügy megnyitva – az Ügyek fülön követhető`, 'success');
    });
  }

  /**
   * Végleges törlés – téves felvitel javítására.
   *
   * A kilépettnek jelölés a normál út: az adat megmarad, csak kikerül a listákból. Ez
   * viszont valóban töröl, ezért előbb kiírjuk, mi tűnik el: a személy neve, az
   * azonosító-története és az ügyei. A visszaút a `data/backup/` mappa – a
   * mentés a törlés ELŐTTI állapotról készül, tehát visszaállítható.
   */
  function confirmDestroy(ids) {
    const lista = [].concat(ids).map(id => EmployeeRepo.get(id)).filter(Boolean);
    if (!lista.length) return;
    const tobb  = lista.length > 1;
    const nevek = lista.map(nevOf);
    const azon  = lista.reduce((n, e) => n + e.identifiers.length, 0);
    let ugyek = 0;
    for (const e of lista) {
      try { ugyek += CaseRepo.forEmployee(e.id).length; } catch {}
    }

    showDialog({
      title: 'Végleges törlés',
      body: `
        <p style="font-size:13px;margin-bottom:10px">
          Biztosan véglegesen törlöd:
          <b>${escHtml(tobb ? `${lista.length} munkavállaló` : nevek[0])}</b>?
        </p>
        ${tobb ? `<p class="ef-hint" style="margin-bottom:10px">${escHtml(
          nevek.slice(0, 8).join(', ') + (nevek.length > 8 ? ` … (+${nevek.length - 8})` : ''))}</p>` : ''}
        <ul class="sv-warn-list">
          <li><b>${azon}</b> azonosító a történetével együtt elvész.</li>
          ${ugyek ? `<li><b>${ugyek}</b> ügy is törlődik, az idővonalukkal együtt.</li>` : ''}
        </ul>
        <p class="ef-hint">
          Ha csak ki akarod venni a listákból, jelöld inkább <b>kilépettnek</b> –
          az visszafordítható. A törlés a <code>data/backup/</code> mappából
          állítható vissza, ha adatmappát használsz.
        </p>`,
      footer: `
        <button class="btn btn-ghost btn-sm" onclick="closeDialog()">Mégse</button>
        <button class="btn btn-danger btn-sm" id="rg-destroy-confirm">Végleges törlés</button>`,
    });

    document.getElementById('rg-destroy-confirm').addEventListener('click', async () => {
      try {
        for (const emp of lista) {
          try { CaseRepo.destroyForEmployee(emp.id); } catch {}
          EmployeeRepo.destroy(emp.id);
        }
        await EmployeeRepo.flush();
        closeDialog();
        BevLogger.info('SZEMELY_TORLES', `Végleges törlés: ${nevek.join(', ')}`, '', `ugyek=${ugyek}`);
        toast(tobb ? `${lista.length} rekord véglegesen törölve` : 'Véglegesen törölve', 'success');
        if (picker) picker.clearSelection();
        renderList();
      } catch (e) {
        toast('A törlés nem sikerült: ' + e.message, 'error');
      }
    });
  }

  function nevOf(emp) {
    const v = SchemaStore.resolveValues(emp.fields, 'hu');
    return [v.surname, v.forename].filter(Boolean).join(' ') || '(névtelen)';
  }

  async function pickDataDir() {
    if (!FsService.hasFsApi) {
      toast('Ez a böngésző nem támogatja a mappaválasztást.', 'error');
      return;
    }
    let dir;
    try {
      dir = await window.showDirectoryPicker({ id: 'docgen-data', mode: 'readwrite' });
    } catch { return; }   // megszakítva

    // Ha volt már adat a böngésző tárolójában, ne vesszen el
    const meglevo = state.ready ? EmployeeRepo.all({ includeExited: true }) : [];
    await FsService.saveHandle(DATA_DIR_KEY, dir);
    await useFileBackend(dir);

    if (meglevo.length && EmployeeRepo.count({ includeExited: true }) === 0) {
      await migrateInto(meglevo);
    }
    toast('Adatmappa beállítva', 'success');
  }

  /** A böngésző tárolójából a fájlba költöztetés – azonosító alapján, duplikátum nélkül. */
  async function migrateInto(records) {
    let atvive = 0;
    for (const r of records) {
      const m = EmployeeRepo.matchIncoming({ identifiers: r.identifiers, fields: r.fields });
      if (m.employee) continue;
      EmployeeRepo.create({
        fields: r.fields, identifiers: r.identifiers, schemaVersion: r.schemaVersion,
      });
      atvive++;
    }
    await EmployeeRepo.flush();
    if (atvive) toast(`${atvive} korábbi rekord átvéve az adatmappába`, 'success');
    renderList();
  }

  /**
   * Visszaállítás biztonsági másolatból.
   *
   * Húsz mentés készül automatikusan, de eddig egyiket sem lehetett
   * visszatölteni – egy mentés, amit nem tudsz visszatenni, nem mentés.
   *
   * A listában a rekordszám a fontos, nem a fájlnév: abból lehet eldönteni,
   * melyik állapotra érdemes visszaállni.
   */
  async function openRestoreDialog() {
    if (!state.dirHandle) { toast('Nincs kiválasztott adatmappa', 'warn'); return; }

    const backend = EmployeeRepo.createFileBackend(state.dirHandle);
    let mentesek = [];
    try { mentesek = await backend.listBackups(); }
    catch (e) { toast(`A mentések nem olvashatók: ${e.message}`, 'error'); return; }

    if (!mentesek.length) {
      showDialog({
        title: 'Visszaállítás mentésből',
        body: `<p style="font-size:12px;color:var(--c-muted)">
                 Nincs biztonsági mentés ebben az adatmappában.<br><br>
                 Mentés minden módosításkor készül, a <code>backup</code> almappába.
                 Ha most először használod az appot ezzel a mappával, még nincs mit visszaállítani.
               </p>`,
        footer: '<button class="btn btn-ghost btn-sm" onclick="closeDialog()">Bezárás</button>',
      });
      return;
    }

    const sorok = mentesek.map((m, i) => `
      <label class="rg-backup ${m.serult ? 'is-broken' : ''}">
        <input type="radio" name="rg-bk" value="${escHtml(m.name)}" ${i === 0 && !m.serult ? 'checked' : ''}
               ${m.serult ? 'disabled' : ''}>
        <span class="rg-backup__when">${escHtml(m.when)}</span>
        <span class="rg-backup__count">${
          m.serult ? '<em>olvashatatlan</em>' : `${m.count} személy`
        }</span>
      </label>`).join('');

    showDialog({
      title: 'Visszaállítás mentésből',
      body: `
        <p style="font-size:12px;color:var(--c-text);margin-bottom:10px">
          Válaszd ki, melyik állapotra állunk vissza. A <strong>jelenlegi</strong>
          tartalomról előbb mentés készül, tehát a lépés visszafordítható.
        </p>
        <div class="rg-backups">${sorok}</div>
        <p style="font-size:11px;color:var(--c-muted);margin-top:10px">
          A visszaállítás után az azóta rögzített változások eltűnnek.
        </p>`,
      footer: `
        <button class="btn btn-ghost btn-sm" onclick="closeDialog()">Mégse</button>
        <button class="btn btn-primary btn-sm" id="rg-do-restore">Visszaállítás</button>`,
    });

    document.getElementById('rg-do-restore').addEventListener('click', async () => {
      const valasztott = document.querySelector('input[name="rg-bk"]:checked');
      if (!valasztott) { toast('Válassz egy mentést', 'warn'); return; }
      try {
        await backend.restoreBackup(valasztott.value);
        closeDialog();
        toast('✓ Visszaállítva – újratöltés…', 'success');
        BevLogger.info('REPO_RESTORE', `Visszaállítás mentésből: ${valasztott.value}`, '', '');
        state.corruptError = null;
        await useFileBackend(state.dirHandle);
      } catch (e) {
        toast(`A visszaállítás nem sikerült: ${e.message}`, 'error');
      }
    });
  }

  async function grantAccess() {
    if (!state.dirHandle) return;
    const ok = await FsService.verifyPermission(state.dirHandle, true);
    if (ok) await useFileBackend(state.dirHandle);
    else toast('A hozzáférés nem lett megadva.', 'error');
  }

  return { init };
})();
