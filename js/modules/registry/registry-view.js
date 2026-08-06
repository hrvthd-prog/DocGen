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
    SchemaStore.useBackend(makeConfigBackend(dirHandle));
    EmployeeRepo.useBackend(EmployeeRepo.createFileBackend(dirHandle));
    await SchemaStore.load();
    await EmployeeRepo.load();
    state.ready = true;
    renderSidebar();
    renderList();
  }

  async function useIdbBackend() {
    state.backendKind = 'idb';
    SchemaStore.useBackend(makeIdbConfigBackend());
    EmployeeRepo.useBackend(EmployeeRepo.createIdbBackend());
    await SchemaStore.load();
    await EmployeeRepo.load();
    state.ready = true;
    renderSidebar();
    renderList();
  }

  /** A séma és az export profilok külön fájlban – személyes adat nélkül. */
  function makeConfigBackend(dirHandle) {
    const FILE = 'docgen-config.json';
    return {
      describe: () => `${dirHandle.name}/${FILE}`,
      async load() {
        try {
          const cfg = JSON.parse(await FsService.readTextFromDir(dirHandle, FILE));
          return cfg.schema || null;
        } catch { return null; }
      },
      async save(schema) {
        let cfg = {};
        try { cfg = JSON.parse(await FsService.readTextFromDir(dirHandle, FILE)); } catch {}
        cfg.schema = schema;
        cfg.savedAt = new Date().toISOString();
        await FsService.writeTextToDir(dirHandle, FILE, JSON.stringify(cfg, null, 2));
      },
    };
  }

  function makeIdbConfigBackend() {
    return {
      describe: () => 'böngésző tároló',
      async load() { try { return (await FsService.loadHandle('config_schema')) || null; } catch { return null; } },
      async save(schema) { await FsService.saveHandle('config_schema', JSON.parse(JSON.stringify(schema))); },
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
    if (!state.ready && state.dirHandle) {
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

  async function grantAccess() {
    if (!state.dirHandle) return;
    const ok = await FsService.verifyPermission(state.dirHandle, true);
    if (ok) await useFileBackend(state.dirHandle);
    else toast('A hozzáférés nem lett megadva.', 'error');
  }

  return { init };
})();
