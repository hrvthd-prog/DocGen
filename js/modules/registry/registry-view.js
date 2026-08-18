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
  let state = {
    ready:           false,
    dirHandle:       null,
    backendKind:     null,      // 'file' | 'idb'
    query:           '',
    showExited:      false,
    selectedId:      null,
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
   * Egyszeri séma-felhozatal: a `_hun` végű mezőkulcsok rövidítése, majd a
   * kódba felvett új mezők pótlása. A rekordok adatai a kulccsal együtt
   * mozognak, ezért a nyilvántartás betöltése UTÁN fut.
   *
   * A pótlás nélkül a mentett séma sosem kapná meg az új adatkört (a `load()`
   * a mentett configot használja, ha van), és az adatbekérőből is kimaradna.
   */
  async function migrateLegacyKeys() {
    try {
      const emps = EmployeeRepo.all({ includeExited: true });
      const rovidult = SchemaStore.migrateLegacyKeys(emps);
      const uj = SchemaStore.addMissingSeedFields();
      if (!rovidult && !uj) return;
      await SchemaStore.save();
      await EmployeeRepo.flush();
      if (rovidult) BevLogger.info('SEMA_MIGRACIO', 'A _hun mezőkulcsok rövidültek', '', '');
      if (uj) BevLogger.info('SEMA_MIGRACIO', `${uj} új mező került a sémába`, '', '');
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

    if (!rows.length) {
      box.innerHTML = bevEmptyState(
        state.query ? 'Nincs találat erre a keresésre.'
                    : 'Még nincs felvett munkavállaló. Kezdd az „Új munkavállaló" gombbal, vagy importálj egy adatbekérő táblázatot.');
      return;
    }

    const cols = LIST_COLUMNS.map(k => SchemaStore.field(k)).filter(Boolean);
    box.innerHTML = `
      <div class="data-table-wrap rg-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              ${cols.map(f => `<th>${escHtml(f.label.hu)}</th>`).join('')}
              <th>Azonosító</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(renderRow(cols)).join('')}
          </tbody>
        </table>
      </div>`;

    box.querySelectorAll('[data-history]').forEach(b =>
      b.addEventListener('click', () => EmployeeHistory.open(EmployeeRepo.get(b.dataset.history))));
    box.querySelectorAll('[data-edit]').forEach(b =>
      b.addEventListener('click', () => openForm(b.dataset.edit)));
    box.querySelectorAll('[data-exit]').forEach(b =>
      b.addEventListener('click', () => toggleExit(b.dataset.exit)));
    box.querySelectorAll('[data-destroy]').forEach(b =>
      b.addEventListener('click', () => confirmDestroy(b.dataset.destroy)));
  }

  function renderRow(cols) {
    return emp => {
      const v = SchemaStore.resolveValues(emp.fields, 'hu');
      const sap = EmployeeRepo.currentIdentifier(emp, 'sap');
      const rp  = EmployeeRepo.currentIdentifier(emp, 'residence_permit');
      const idf = sap || rp || (emp.identifiers.find(i => i.current) || null);
      const tobbi = emp.identifiers.length - (idf ? 1 : 0);
      return `
        <tr class="${emp.exited ? 'rg-exited' : ''}">
          ${cols.map(f => `<td title="${escHtml(v[f.key] || '')}">${escHtml(v[f.key] || '')}</td>`).join('')}
          <td title="${escHtml(idf ? EmployeeRepo.idTypeLabel(idf.type) : '')}">
            ${idf ? escHtml(idf.value) : '<i class="rg-dim">—</i>'}
            ${tobbi > 0 ? `<span class="rg-more" title="További ${tobbi} azonosító a történetben">+${tobbi}</span>` : ''}
          </td>
          <td class="rg-actions">
            ${emp.exited ? `<span class="rg-exit-badge">kilépett: ${escHtml(emp.exitDate || '?')}</span>` : ''}
            <button class="btn btn-ghost btn-sm" data-history="${emp.id}">
              Előzmények${emp.history && emp.history.length ? ` (${emp.history.length})` : ''}
            </button>
            <button class="btn btn-ghost btn-sm" data-edit="${emp.id}">Szerkesztés</button>
            <button class="btn btn-ghost btn-sm" data-exit="${emp.id}">
              ${emp.exited ? 'Visszavétel' : 'Kilépettnek jelölés'}
            </button>
            <button class="btn btn-ghost btn-sm rg-del" data-destroy="${emp.id}"
                    title="Végleges törlés – téves felvitel javítására">Törlés</button>
          </td>
        </tr>`;
    };
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
  }

  function openForm(id) {
    if (!state.ready) { toast('A nyilvántartás még nem töltődött be.', 'error'); return; }
    EmployeeForm.open({ id, onSave: renderList });
  }

  function toggleExit(id) {
    const emp = EmployeeRepo.get(id);
    if (!emp) return;
    if (emp.exited) {
      EmployeeRepo.setExited(id, false);
      toast('Visszavéve az aktív állományba', 'success');
      renderList();
      return;
    }
    openExitDialog(emp);
  }

  /**
   * Kilépettnek jelölés.
   *
   * A kilépés napját a program nem tudja kitalálni, viszont ebből fut a
   * bejelentési határidő – ezért kötelező, és ezért kérjük külön párbeszédben
   * ahelyett, hogy egy kattintással megtörténne a jelölés.
   *
   * Kiinduló érték a séma „Kilépés dátuma" mezője (a felvételkor tervezett
   * utolsó munkanap), ha van; különben a mai nap.
   */
  function openExitDialog(emp) {
    const alap = emp.fields[EmployeeRepo.EXIT_DATE_FIELD] || CaseTypes.isoDate(new Date());

    showDialog({
      title: 'Kilépettnek jelölés',
      body: `
        <p style="font-size:13px;margin-bottom:10px">
          <b>${escHtml(nevOf(emp))}</b> munkaviszonya megszűnt.
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
          napot vigye.
        </p>`,
      footer: `
        <button class="btn btn-ghost btn-sm" onclick="closeDialog()">Mégse</button>
        <button class="btn btn-primary btn-sm" id="rg-exit-save">Kilépettnek jelölés</button>`,
    });

    document.getElementById('rg-exit-save').addEventListener('click', () => {
      const nap = document.getElementById('rg-exit-date').value.trim();
      try {
        EmployeeRepo.setExited(emp.id, true, nap);
      } catch (e) {
        document.getElementById('rg-exit-error').textContent = e.message;
        return;
      }
      BevLogger.info('KILEPES', `Kilépettnek jelölve: ${nevOf(emp)}`, '', `nap=${nap}`);
      renderList();
      showExitWarning(emp, nap);
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
  function showExitWarning(emp, nap) {
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

    // Ha már van nyitott kijelentési ügy, ne lehessen másodikat nyitni rá
    let vanUgy = true;
    try { vanUgy = CaseRepo.hasOpenCaseOfType(emp.id, KILEPES_UGYTIPUS); } catch {}

    showDialog({
      title: 'Bejelentési kötelezettség',
      body: `
        <div class="rg-exit-warn${lejart ? ' is-late' : ''}">
          <p>
            <b>${escHtml(nevOf(emp))}</b> munkaviszonya
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
        ${vanUgy ? '' :
          '<button class="btn btn-ghost btn-sm" id="rg-exit-case">Bejelentési ügy megnyitása</button>'}
        <button class="btn btn-primary btn-sm" onclick="closeDialog()">Rendben</button>`,
    });

    // Egy figyelmeztetés, amit nem lehet elintézni, pár nap múlva zaj lesz:
    // innen egy kattintással bekerül az Ügyek fülre, a saját határidejével.
    document.getElementById('rg-exit-case')?.addEventListener('click', () => {
      try {
        CaseRepo.create({ employeeId: emp.id, type: KILEPES_UGYTIPUS, triggerDate: nap });
      } catch (e) {
        toast('Az ügy megnyitása nem sikerült: ' + e.message, 'error');
        return;
      }
      closeDialog();
      toast('Bejelentési ügy megnyitva – az Ügyek fülön követhető', 'success');
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
  function confirmDestroy(id) {
    const emp = EmployeeRepo.get(id);
    if (!emp) return;
    const nev = nevOf(emp);
    let ugyek = 0;
    try { ugyek = CaseRepo.forEmployee(id).length; } catch {}

    showDialog({
      title: 'Végleges törlés',
      body: `
        <p style="font-size:13px;margin-bottom:10px">
          Biztosan véglegesen törlöd: <b>${escHtml(nev)}</b>?
        </p>
        <ul class="sv-warn-list">
          <li><b>${emp.identifiers.length}</b> azonosító a történetével együtt elvész.</li>
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
        try { CaseRepo.destroyForEmployee(id); } catch {}
        EmployeeRepo.destroy(id);
        await EmployeeRepo.flush();
        closeDialog();
        BevLogger.info('SZEMELY_TORLES', `Végleges törlés: ${nev}`, '', `ugyek=${ugyek}`);
        toast('Véglegesen törölve', 'success');
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
