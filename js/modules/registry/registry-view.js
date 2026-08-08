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

  let container = null;
  let state = {
    ready:           false,
    dirHandle:       null,
    backendKind:     null,      // 'file' | 'idb'
    query:           '',
    showArchived:    false,
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
    renderSidebar();
    renderList();
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
                  <input type="checkbox" id="rg-show-archived">
                  <span>Archiváltak is</span>
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
        <div class="rg-stat"><span>Archivált</span><b id="rg-stat-arch">–</b></div>
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
    const r = document.getElementById('rg-stat-arch');
    const s = document.getElementById('rg-stat-schema');
    if (a) a.textContent = EmployeeRepo.count();
    if (r) r.textContent = EmployeeRepo.count({ includeArchived: true }) - EmployeeRepo.count();
    if (s) s.textContent = SchemaStore.version();
  }

  function renderList() {
    const box = document.getElementById('rg-list');
    if (!box || !state.ready) return;

    const rows = EmployeeRepo.search(state.query, { includeArchived: state.showArchived });
    const cnt = document.getElementById('rg-count');
    if (cnt) cnt.textContent = `${rows.length} személy`;
    refreshStats();

    // Az export mindig azt viszi, amit a felhasználó épp lát
    const note = document.getElementById('rg-export-note');
    if (note) {
      note.textContent = (state.query || state.showArchived)
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

    box.querySelectorAll('[data-edit]').forEach(b =>
      b.addEventListener('click', () => openForm(b.dataset.edit)));
    box.querySelectorAll('[data-archive]').forEach(b =>
      b.addEventListener('click', () => toggleArchive(b.dataset.archive)));
  }

  function renderRow(cols) {
    return emp => {
      const v = SchemaStore.resolveValues(emp.fields, 'hu');
      const sap = EmployeeRepo.currentIdentifier(emp, 'sap');
      const rp  = EmployeeRepo.currentIdentifier(emp, 'residence_permit');
      const idf = sap || rp || (emp.identifiers.find(i => i.current) || null);
      const tobbi = emp.identifiers.length - (idf ? 1 : 0);
      return `
        <tr class="${emp.archived ? 'rg-archived' : ''}">
          ${cols.map(f => `<td title="${escHtml(v[f.key] || '')}">${escHtml(v[f.key] || '')}</td>`).join('')}
          <td title="${escHtml(idf ? EmployeeRepo.idTypeLabel(idf.type) : '')}">
            ${idf ? escHtml(idf.value) : '<i class="rg-dim">—</i>'}
            ${tobbi > 0 ? `<span class="rg-more" title="További ${tobbi} azonosító a történetben">+${tobbi}</span>` : ''}
          </td>
          <td class="rg-actions">
            <button class="btn btn-ghost btn-sm" data-edit="${emp.id}">Szerkesztés</button>
            <button class="btn btn-ghost btn-sm" data-archive="${emp.id}">
              ${emp.archived ? 'Visszaállítás' : 'Archiválás'}
            </button>
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
    document.getElementById('rg-show-archived').addEventListener('change', e => {
      state.showArchived = e.target.checked;
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
      const rows = EmployeeRepo.search(state.query, { includeArchived: state.showArchived });
      RegistryXlsxIO.exportData(rows);
    });
    document.getElementById('rg-export-template').addEventListener('click',
      () => RegistryXlsxIO.exportTemplate());
  }

  function openForm(id) {
    if (!state.ready) { toast('A nyilvántartás még nem töltődött be.', 'error'); return; }
    EmployeeForm.open({ id, onSave: renderList });
  }

  function toggleArchive(id) {
    const emp = EmployeeRepo.get(id);
    if (!emp) return;
    EmployeeRepo.setArchived(id, !emp.archived);
    toast(emp.archived ? 'Visszaállítva' : 'Archiválva', 'success');
    renderList();
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
    const meglevo = state.ready ? EmployeeRepo.all({ includeArchived: true }) : [];
    await FsService.saveHandle(DATA_DIR_KEY, dir);
    await useFileBackend(dir);

    if (meglevo.length && EmployeeRepo.count({ includeArchived: true }) === 0) {
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
