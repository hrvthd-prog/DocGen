'use strict';

const DocgenModule = (() => {

  const currentUser = Settings.currentUser();

  // ── Hiányzó-adat napló ────────────────────────────────────────────────────

  // ── Állapot ──────────────────────────────────────────────────────────────
  let state = {
    clientRows:       [],
    selectedClients:  [],
    clientFilterCols: [],
    templatesDir:     null,
    // [{name, subdir}] — fiókra szűrve
    allTemplates:     [],
    chosenTemplates:  new Set(),
    templateGroups:   [],
    activeGroups:     new Set(),
    outputDir:        null,
    maiNap:           '',
    // A legutóbbi generálás fájljai [{name, clientName, templateName}].
    // Ebből találja meg az összefűzés a lemezre került PDF-eket.
    // Szándékosan csak memóriában él: a fájlnevek személyneveket tartalmaznak,
    // ezért nem tesszük a böngésző tárolójába.
    lastGenerated:    [],
    // ── PDF összefűzés ──────────────────────────────────────────────────────
    mergeEnabled:    false,
    mergeMode:       'per_client',   // 'per_client' | 'per_template'
    mergeTemplates:  null,           // null = mind; Set = csak ezek kerülnek bele
  };

  // ── Dátum helpers ─────────────────────────────────────────────────────────
  function _todayDot() {
    const d = new Date();
    return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
  }
  function _dotToInput(dot) { return dot ? dot.replace(/\./g, '-') : ''; }
  function _inputToDot(inp) { return inp ? inp.replace(/-/g, '.') : ''; }

  let container;

  // ── Init ──────────────────────────────────────────────────────────────────
  function init(el) {
    container = el;
    loadSettings();

    // Az alegységek a magtól csak azt kapják meg, amire tényleg szükségük van.
    DocgenNaming.init({
      buildRenderRow,
      firstEmployee: () => state.clientRows[0] || null,
    });
    DocgenMerge.init({ state, q, employeeName });
    DocgenGroups.init({ state, refreshTemplates, rebuildGroupFilterBtns, saveSettings });

    // A nyilvántartás betöltése az első render ELŐTT: az összesítő a belső
    // azonosítókból nevet old fel, ahhoz kell a clientRows.
    loadFromRegistry({ silent: true });
    render();
    restoreHandles();

    // A nyilvántartás bármely változása (felvitel, import, kilépés) azonnal
    // látszódjon itt is – így nem lehet elavult listából generálni.
    EmployeeRepo.onChange(() => { loadFromRegistry({ silent: true }); renderAll(); });

    window.addEventListener('docgenTabActivated', e => {
      if (e.detail !== 'docgen') return;
      loadFromRegistry({ silent: true });
      renderAll();
      // P4: tab-aktiváción re-scan a sablonmappa esetén — frissíti, ha közben módosult
      if (state.templatesDir) {
        refreshTemplates({ silent: true }).catch(err =>
          BevLogger.warn('TEMPLATE_RESCAN', 'Tab-aktiváción re-scan sikertelen', err.message, ''));
      }
    });
  }

  /** Oldalsáv és munkaterület újrarajzolása a jelenlegi állapotból. */
  function renderAll() {
    const sb = q('#dg-sidebar');
    if (sb) { sb.innerHTML = renderSidebar(); bindSidebar(); }
    const ws = q('#dg-workspace');
    if (ws) { ws.innerHTML = renderWorkspace(); bindWorkspace(); refreshTemplateList(); }
    updateClientCount();
    updateGenButtons();
    updateGenSummary();
  }

  // Per-user settings kulcs — minden fióknak saját mentése van
  function _docgenKey() {
    const u = (currentUser || '').replace(/[^a-zA-Z0-9]/g, '_');
    return u ? 'docgen_u_' + u : 'docgen';
  }

  function loadSettings() {
    const s = Settings.get(_docgenKey(), {});
    state.selectedClients  = s.selectedClients  || [];
    state.clientFilterCols = s.clientFilterCols || [];
    // backward compat: migrate old single chosenTemplate string
    const savedTpls = s.chosenTemplates || (s.chosenTemplate ? [s.chosenTemplate] : []);
    state.chosenTemplates  = new Set(savedTpls);
    state.templateGroups   = Settings.getAccountGroups(currentUser);
    state.activeGroups     = new Set();
    // Mai nap: globális, minden fiókra érvényes; alapértelmezett = mai dátum
    state.maiNap = Settings.get('global_mai_nap', '') || _todayDot();
    // PDF összefűzés — per-user beállítások
    const ms = Settings.get(DocgenMerge.MERGE_KEY(), {});
    state.mergeEnabled   = ms.enabled  ?? false;
    state.mergeMode      = ms.mode     ?? 'per_client';
    const rawTpls        = ms.mergeTemplates;
    state.mergeTemplates = Array.isArray(rawTpls) ? new Set(rawTpls) : null;
  }

  function saveSettings() {
    Settings.set(_docgenKey(), {
      selectedClients:  state.selectedClients,
      chosenTemplates:  [...state.chosenTemplates],
      clientFilterCols: state.clientFilterCols,
    });
    Settings.setAccountGroups(currentUser, state.templateGroups);
  }

  // ── PDF kimenet ───────────────────────────────────────────────────────────
  // A PDF-előállítás tudatosan le van választva a generálásról: az app dolga ott
  // ér véget, hogy helyes nevű DOCX-ek vannak a kimeneti mappában.
  //
  // A konverziót a tools/docx-pdf.vbs végzi (Word COM) – a környezet-próba
  // szerint ez az út járható, és teljes Word-hűséget ad. Böngészőből nem lehet
  // Wordöt vezérelni, ezért itt nincs és nem is lehet beépített konverzió;
  // tartaléknak marad a böngészős nyomtatás (openPrintSelectDialog).

  // Mappát Intézőben megnyitni böngészőből NEM lehet: a File System Access API
  // handle-t ad, nem elérési utat, és nincs API a fájlkezelő indítására. Ezt
  // korábban egy helyi kiszolgáló végezte – az kikerült a pipeline-ból, ezért a
  // „megnyitás" gombok is. Ami maradt: a mappa NEVE látszik a sidebarban.

  // Progresszív onboarding frissítés:
  //  - Ha a workspace az onboard nézetet mutatja, frissíti a lépések állapotát
  //    (done / aktív / disabled) az aktuális state alapján.
  //  - Ha mind a két kötelező lépés (excel + sablonmappa) kész → kilép az onboardból.
  // Hívd meg minden handle-változás után (restore + interaktív kiválasztás egyaránt).
  function _refreshOnboardSteps() {
    const ws = q('#dg-workspace');
    if (!ws || !ws.querySelector('.dg-onboarding')) return; // nem onboard nézetben vagyunk

    const hasExcel = state.clientRows.length > 0;
    const hasDir   = !!state.templatesDir;

    // Mind a kettő kész → teljes workspace re-render, onboard elhagyása
    if (hasExcel && hasDir) {
      ws.innerHTML = renderWorkspace();
      bindWorkspace();
      refreshTemplateList();
      updateGenButtons();
      updateGenSummary();
      return;
    }

    // Progresszív lépés-frissítés a meglévő DOM-on
    const step1 = q('#dg-ob-registry');
    const step2 = q('#dg-ob-dir');
    const step3 = q('#dg-ob-clients');

    if (step1 && hasExcel) step1.classList.add('done');
    if (step2 && hasDir) {
      step2.classList.remove('disabled'); // mindig távolítsd el, mielőtt 'done'-t adsz
      step2.classList.add('done');
    } else if (step2 && hasExcel) {
      step2.classList.remove('disabled'); // excel kész → step 2 megnyílik
    }
    if (step3 && hasExcel) step3.classList.remove('disabled');
  }

  async function restoreHandles() {
    let needsBanner = false;
    try {
      const h = await FsService.loadHandle('templates_dir');
      if (h && await FsService.queryPermissionOnly(h)) {
        state.templatesDir = h;
        // render() fut a restoreHandles() előtt → teljes sidebar UI szinkronizálás
        _rerenderTemplatesDirUI();
      } else if (h) {
        // Handle ismert, de engedély nélkül — mutatjuk a nevet, banner kéri vissza a hozzáférést
        needsBanner = h;
        const dirInfo = q('#dg-dir-info');
        if (dirInfo) { dirInfo.title = h.name; dirInfo.innerHTML = _folderSVG + escHtml(h.name); }
        const setBtn = q('#dg-set-dir');
        if (setBtn) setBtn.innerHTML = '🔒 Sablonmappa (hozzáférés szükséges)';
      }
    } catch {}

    if (state.templatesDir) {
      await refreshTemplates();
      _refreshOnboardSteps(); // sablonmappa visszaállítva → kilépés onboardingból
    } else if (needsBanner) {
      showDirRestoreBanner(needsBanner);  // needsBanner = a handle
    }

    // ── Output mappa restore — engedély nélkül is tárolva, banner-rel ─────────
    try {
      const h = await FsService.loadHandle('output_dir');
      if (h) {
        if (await FsService.queryPermissionOnly(h, true)) {
          state.outputDir = h;
          rerenderSidebarSettings();
        } else {
          // Handle ismert, de engedély nélkül — megőrizzük state-ben, banner kéri vissza az engedélyt
          state.outputDir = h;
          rerenderSidebarSettings();
          showOutputDirRestoreBanner();
        }
      }
    } catch (e) {
      BevLogger.warn('OUTPUT_DIR_RESTORE', 'Output mappa restore sikertelen', e.message, '');
    }
  }

  function showDirRestoreBanner(knownHandle) {
    const sec = q('.sidebar-section');
    if (!sec) return;
    const banner = document.createElement('div');
    banner.id = 'dg-restore-banner';
    banner.style.cssText = 'background:var(--c-amber);color:#fff;font-size:12px;' +
      'padding:8px 10px;border-radius:6px;margin:6px 0;cursor:pointer;text-align:center';
    const dirName = knownHandle?.name;
    banner.textContent = dirName
      ? `Kattints ide a sablonmappa-hozzáférés visszaállításához (${dirName})`
      : 'Kattints ide a sablonmappa-hozzáférés visszaállításához';
    banner.addEventListener('click', async () => {
      banner.remove();
      if (knownHandle) {
        // Van tárolt handle → közvetlenül engedélyt kérünk (nem új picker)
        try {
          const granted = await FsService.verifyPermission(knownHandle);
          if (granted) {
            state.templatesDir = knownHandle;
            _rerenderTemplatesDirUI();
            toast(`✓ Sablonmappa: ${knownHandle.name}`, 'success');
            await refreshTemplates();
            _refreshOnboardSteps();
          } else {
            toast('Hozzáférés megtagadva', 'error');
          }
        } catch (e) {
          BevLogger.error('TEMPLATE_DIR_RESTORE', 'Sablonmappa engedély visszakérés sikertelen', e.message, '');
          toast('Visszaállítás sikertelen: ' + e.message, 'error');
        }
      } else {
        await onSetTemplatesDir();
      }
    });
    sec.parentElement.insertBefore(banner, sec);
  }

  // P2: Output mappa restore banner (zavarmentes, NEM automatikus permission prompt)
  function showOutputDirRestoreBanner() {
    // Idempotens: ne dupla-banner
    if (q('#dg-output-restore-banner')) return;
    const sec = q('.sidebar-section');
    if (!sec) return;
    const banner = document.createElement('div');
    banner.id = 'dg-output-restore-banner';
    banner.style.cssText = 'background:var(--c-amber);color:#fff;font-size:12px;' +
      'padding:8px 10px;border-radius:6px;margin:6px 0;cursor:pointer;text-align:center';
    const dirName = state.outputDir?.name || 'kimenet';
    banner.textContent = `Kattints ide a kimenet mappa (${dirName}) hozzáférés visszaállításához`;
    banner.addEventListener('click', async () => {
      try {
        if (state.outputDir && await FsService.verifyPermission(state.outputDir, true)) {
          banner.remove();
          rerenderSidebarSettings();
          toast(`✓ Kimenet mappa-hozzáférés visszaállítva: ${state.outputDir.name}`, 'success');
          BevLogger.info('OUTPUT_DIR_RESTORE', 'Output mappa-engedély visszaállítva', '', state.outputDir.name);
        } else {
          toast('Hozzáférés megtagadva', 'error');
        }
      } catch (e) {
        BevLogger.error('OUTPUT_DIR_RESTORE', 'Permission visszakérés sikertelen', e.message, state.outputDir?.name || '');
        toast('Visszaállítás sikertelen: ' + e.message, 'error');
      }
    });
    sec.parentElement.insertBefore(banner, sec);
  }

  // user-prefixed localStorage helper (getter: 1 arg, setter: 2 args)
  function _userPref(key, value) {
    const u = (currentUser || '').replace(/[^a-zA-Z0-9]/g, '_');
    const k = u ? key + '_' + u : key;
    if (arguments.length === 1) return Settings.get(k, '');
    Settings.set(k, value);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function render() {
    container.innerHTML = `
      <div class="sidebar" id="dg-sidebar">${renderSidebar()}</div>
      <div class="workspace" id="dg-workspace">${renderWorkspace()}</div>
    `;
    bindSidebar();
    bindWorkspace();
    refreshTemplateList();
    const srch = q('#dg-tpl-search');
    if (srch) srch.value = '';
    updateGenButtons();
    updateGenSummary();
    requestAnimationFrame(() => {
      try {
        const saved = parseFloat(localStorage.getItem('docgen-ws-split'));
        if (saved > 0.1 && saved < 0.9) {
          const ws = container.querySelector('.workspace');
          const cl = q('#dg-col-templates');
          if (ws && cl && ws.offsetWidth > 0) {
            cl.style.flex = 'none';
            cl.style.width = Math.round(ws.offsetWidth * saved) + 'px';
          }
        }
      } catch {}
    });
  }

  function renderSidebar() {
    const cnt      = state.selectedClients.length;
    const dirName  = state.templatesDir ? state.templatesDir.name : 'Nincs beállítva';
    const osszes   = state.clientRows.length;
    const isAdmin  = Settings.isAdmin();
    const step1done = cnt > 0;
    const step2done = !!state.templatesDir;
    const step3done = !!state.outputDir;
    const pendingStep = !step1done ? 1 : !step2done ? 2 : !step3done ? 3 : 0;
    return `
      <div class="sidebar-section ${pendingStep === 1 ? 'sidebar-section--pending' : ''}">
        <div class="sidebar-section-title"><span class="sidebar-step-badge ${step1done ? 'done' : ''}" id="dg-step-1">1</span>Személyek</div>
        <div class="info-row" id="dg-source-info" title="Az adatok a Nyilvántartás fülön kezelhetők">
          ${_folderSVG}${osszes ? `Nyilvántartás – ${osszes} személy` : 'A nyilvántartás üres'}
        </div>
        <button class="sidebar-btn" id="dg-choose-clients">
          Személyek kiválasztása
          <span class="badge ${cnt ? 'badge-green' : 'badge-muted'}" style="margin-left:auto">${cnt}</span>
        </button>
      </div>

      <div class="sidebar-section ${pendingStep === 2 ? 'sidebar-section--pending' : ''}">
        <div class="sidebar-section-title"><span class="sidebar-step-badge ${step2done ? 'done' : ''}" id="dg-step-2">2</span>Sablonok</div>
        <button class="sidebar-btn" id="dg-set-dir">
          ${state.templatesDir ? '🔄 Másik sablonmappa választása' : 'Sablonmappa beállítása'}
        </button>
        <div class="info-row" id="dg-dir-info" title="${escHtml(dirName)}">${_folderSVG}${escHtml(dirName)}</div>
        <button class="sidebar-btn" id="dg-manage-groups">Csoportok kezelése</button>
        ${isAdmin ? `<button class="sidebar-btn" id="dg-manage-visibility">Sablon-hozzárendelés</button>` : ''}
      </div>

      <div class="sidebar-section ${pendingStep === 3 ? 'sidebar-section--pending' : ''}">
        <div class="sidebar-section-title"><span class="sidebar-step-badge ${step3done ? 'done' : ''}" id="dg-step-3">3</span>Kimenet</div>
        <button class="sidebar-btn" id="dg-set-output">
          ${state.outputDir ? '🔄 Másik kimenet mappa választása' : 'Kimenet mappa beállítása'}
        </button>
        <div class="info-row" id="dg-output-info">
          ${_folderSVG}${escHtml(state.outputDir ? state.outputDir.name : 'Nincs beállítva')}
        </div>
      </div>

      <div class="sidebar-section" style="padding-top:4px;padding-bottom:4px">
        <button class="sidebar-btn" id="dg-show-missing-log">📋 Hiányzó adatok naplója</button>
      </div>
      <div class="sidebar-resize-handle" id="dg-sidebar-resize" title="Húzd a sidebar méretezéséhez — dupla kattintás: visszaállítás"></div>
    `;
  }

  // P6: csoport-szint védekező mélység-számítás
  // Edge case-ek: leading/trailing slash, dupla slash, üres path-szegmens
  function _groupDepth(g) {
    if (!g || typeof g !== 'string') return 0;
    // Trim slashes és normalizáljuk a többszörös slash-eket
    const normalized = g.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
    if (!normalized) return 0;
    return normalized.split('/').length;
  }

  function _groupLeafName(g) {
    if (!g) return 'Összes';
    const normalized = g.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
    if (!normalized) return 'Összes';
    return normalized.split('/').pop();
  }

  function buildGroupFilterHTML(allGroups, activeGroups) {
    const byDepth = {};
    const treeForLog = [];
    allGroups.forEach(g => {
      const depth = _groupDepth(g);
      (byDepth[depth] = byDepth[depth] || []).push(g);
      treeForLog.push({ name: g, depth, leaf: _groupLeafName(g) });
    });

    // P6 diagnosztikai log a fa-állapotról
    BevLogger.debug('GROUP_TREE',
      `Csoport-fa render (${allGroups.length} elem)`,
      BevLogger.snapshot(treeForLog),
      `user=${currentUser}, activeGroups=${[...(activeGroups || [])].join('|')}`);

    return Object.keys(byDepth).sort((a, b) => Number(a) - Number(b)).map(depth => {
      const d = Number(depth);
      const chips = byDepth[d].map(g => {
        const isActive = g === '' ? activeGroups.size === 0 : activeGroups.has(g);
        return `<button class="group-filter-btn ${isActive ? 'active' : ''}" data-group="${escHtml(g)}"
          title="${escHtml(g || 'Összes')}">${escHtml(_groupLeafName(g))}</button>`;
      }).join('');
      if (d === 0) return `<div class="group-filter-row"><div class="group-filter-chips">${chips}</div></div>`;
      return `
        <div class="group-filter-row group-filter-row--collapsible" data-depth="${d}">
          <button class="group-filter-row-toggle" data-depth-toggle="${d}">
            <span class="toggle-arrow">▼</span>${d}. szint
          </button>
          <div class="group-filter-chips">${chips}</div>
        </div>`;
    }).join('');
  }

  function renderWorkspace() {
    // Onboard mindaddig látható, amíg mind a két kötelező lépés nem teljesül.
    // (&&-ról ||-ra változott: ha csak az egyik van meg, még onboardon maradunk
    // és a progresszív lépésfrissítő aktiválja a következő gombot.)
    // Onboard mindaddig látható, amíg a nyilvántartás üres vagy nincs sablonmappa.
    const vanSzemely = state.clientRows.length > 0;
    const hasDir     = !!state.templatesDir;
    const onboardMode = !vanSzemely || !hasDir;
    if (onboardMode) {
      const step1Cls = vanSzemely ? 'done' : '';
      const step2Cls = hasDir ? 'done' : vanSzemely ? '' : 'disabled';
      const step3Cls = vanSzemely ? '' : 'disabled';
      const step2Sub = vanSzemely ? 'A .docx sablonokat tartalmazó mappa'
                                  : 'A nyilvántartás feltöltése után érhető el';
      const step3Sub = vanSzemely ? 'Válaszd ki, kinek generáljunk dokumentumot'
                                  : 'A nyilvántartás feltöltése után érhető el';
      return `
        <div class="dg-onboarding">
          <div style="font-size:13px;color:var(--c-muted)">Az első generáláshoz kövesd a lépéseket:</div>
          <div class="dg-onboard-steps">
            <div class="dg-onboard-step ${step1Cls}" id="dg-ob-registry">
              <div class="dg-onboard-num">1</div>
              <div>
                <div class="dg-onboard-label">Személyek felvitele</div>
                <div class="dg-onboard-sub">${vanSzemely
                  ? state.clientRows.length + ' személy a nyilvántartásban'
                  : 'Ugrás a Nyilvántartás fülre'}</div>
              </div>
              <span class="dg-onboard-arrow">›</span>
            </div>
            <div class="dg-onboard-step ${step2Cls}" id="dg-ob-dir">
              <div class="dg-onboard-num">2</div>
              <div>
                <div class="dg-onboard-label">Sablonmappa beállítása</div>
                <div class="dg-onboard-sub">${step2Sub}</div>
              </div>
              <span class="dg-onboard-arrow">›</span>
            </div>
            <div class="dg-onboard-step ${step3Cls}" id="dg-ob-clients">
              <div class="dg-onboard-num">3</div>
              <div>
                <div class="dg-onboard-label">Személyek kiválasztása</div>
                <div class="dg-onboard-sub">${step3Sub}</div>
              </div>
              <span class="dg-onboard-arrow">›</span>
            </div>
          </div>
        </div>
      `;
    }

    const groups   = state.templateGroups;
    const filtered = filteredTemplates();

    const groupBtns = buildGroupFilterHTML(['', ...groups.map(g => g.name)], state.activeGroups);

    const tplCnt = state.chosenTemplates.size;
    const checkItems = filtered.length
      ? filtered.map(t => `
            <label class="template-radio-item">
              <input type="checkbox" name="dg-template" value="${escHtml(t.name)}"
                ${state.chosenTemplates.has(t.name) ? 'checked' : ''}>
              <span>${escHtml(t.name)}</span>
              ${t.subdir ? `<span style="font-size:10px;color:var(--c-blue);margin-left:auto" title="${escHtml(t.subdir)}">${escHtml(t.subdir.split('/').pop())}</span>` : ''}
            </label>
          `).join('')
      : bevEmptyState('Nincs sablon. Állítsd be a sablonmappát.', 'shield-mark');

    return `
      <div class="workspace-col" id="dg-col-templates">
        <div class="ws-card" id="dg-card-templates" draggable="true">
          <div class="ws-card-header">
            <span class="ws-card-drag-handle" title="Húzd át a pozíció megváltoztatásához">⠿</span>
            <div class="ws-card-title">Sablonok</div>
            <span class="ws-card-warning" id="dg-tpl-warn">
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                <path d="M8 2L1.5 14h13L8 2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
                <path d="M8 6v3.5M8 11.5v.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
              </svg>
              Nincs kiválasztva
            </span>
            <div style="display:flex;align-items:center;gap:10px">
              <span class="checklist-action-link" id="dg-tpl-all" style="font-size:11px;cursor:pointer">Mind</span>
              <span class="checklist-action-link" id="dg-tpl-none" style="font-size:11px;cursor:pointer">Egyik sem</span>
              <span style="font-size:11px;color:var(--c-muted)" id="dg-template-state">
                ${tplCnt ? tplCnt + ' kiválasztva' : '— nincs —'}
              </span>
            </div>
          </div>
          <div class="ws-card-body">
            <div class="dg-tpl-search-wrap">
              <svg viewBox="0 0 16 16" fill="none">
                <circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.4"/>
                <path d="M10.5 10.5l2.5 2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
              </svg>
              <input type="text" class="dg-tpl-search" id="dg-tpl-search"
                     placeholder="Sablon keresése…" autocomplete="off">
            </div>
            <div class="group-filters" id="dg-group-filters">${groupBtns}</div>
            <div class="template-radio-list" id="dg-template-list">${checkItems}</div>
          </div>
        </div>

      </div>

      <div class="ws-resize-divider" id="dg-col-divider" title="Húzd az oszlopok átméretezéséhez"></div>

      <div class="workspace-col" id="dg-col-gen">
        <div class="ws-card" id="dg-card-mai-nap" draggable="true">
          <div class="ws-card-header">
            <span class="ws-card-drag-handle" title="Húzd át a pozíció megváltoztatásához">⠿</span>
            <div class="ws-card-title">Mai nap</div>
            <button id="dg-mai-nap-today" style="font-size:11px;padding:2px 8px;background:none;border:1px solid var(--c-border);border-radius:4px;cursor:pointer;color:var(--c-muted)" title="Visszaállítás mai dátumra">Ma</button>
          </div>
          <div class="ws-card-body" style="padding:10px 12px">
            ${dateFieldHtml({ id: 'dg-mai-nap-input', value: _dotToInput(state.maiNap) })}
            <div style="font-size:11px;color:var(--c-muted);margin-top:6px">Sablonban: <code style="font-family:monospace">{{mai nap}}</code></div>
          </div>
        </div>

        <div class="ws-card" id="dg-card-summary" draggable="true">
          <div class="ws-card-header">
            <span class="ws-card-drag-handle" title="Húzd át a pozíció megváltoztatásához">⠿</span>
            <div class="ws-card-title">Összesítő</div>
            <span id="dg-sum-count" style="font-size:11px;color:var(--c-muted)"></span>
          </div>
          <div class="ws-card-body" id="dg-sum-body"
              style="padding:6px 12px 10px;max-height:320px;overflow-y:auto">
            <div style="color:var(--c-muted);font-size:12px;font-style:italic">
              Válassz ügyfeleket és sablonokat a generáláshoz.</div>
          </div>
        </div>

        <div class="ws-card" id="dg-card-merge" draggable="true">
          <div class="ws-card-header">
            <span class="ws-card-drag-handle" title="Húzd át a pozíció megváltoztatásához">⠿</span>
            <div class="ws-card-title">PDF összefűzés</div>
            <label style="display:flex;align-items:center;gap:5px;margin-left:auto;cursor:pointer;user-select:none" title="PDF összefűzés be/ki">
              <input type="checkbox" id="dg-merge-enabled" ${state.mergeEnabled ? 'checked' : ''}
                style="display:none">
              <div id="dg-merge-toggle-track" style="width:32px;height:17px;border-radius:9px;
                background:${state.mergeEnabled ? 'var(--c-green)' : 'var(--c-border)'};
                position:relative;transition:background .15s;flex-shrink:0">
                <div style="width:13px;height:13px;border-radius:50%;background:#fff;
                  position:absolute;top:2px;
                  left:${state.mergeEnabled ? '17px' : '2px'};
                  transition:left .15s;box-shadow:0 1px 3px rgba(0,0,0,.25)"></div>
              </div>
              <span id="dg-merge-toggle-label" style="font-size:11px;color:var(--c-muted)">
                ${state.mergeEnabled ? 'Aktív' : ''}
              </span>
            </label>
          </div>
          <div class="ws-card-body" id="dg-merge-body" style="padding:0">
            ${DocgenMerge.renderCardBody()}
          </div>
        </div>

        <div class="ws-card" id="dg-card-gen" draggable="true">
          <div class="ws-card-header">
            <span class="ws-card-drag-handle" title="Húzd át a pozíció megváltoztatásához">⠿</span>
            <div class="ws-card-title">Generálás</div>
          </div>
          <div class="ws-card-body">
            <div id="dg-gen-summary" class="dg-summary">
              <span class="dg-summary-empty">Nincs kijelölve ügyfél vagy sablon</span>
            </div>
            <div class="gen-btn-group">
              <button id="dg-gen-both" class="btn btn-primary btn-full btn-lg dg-primary-btn">
                <span class="dg-btn-fill" id="dg-btn-fill"></span>
                <span class="dg-btn-label" id="dg-btn-label">DOCX + PDF</span>
              </button>
              <div class="dg-alt-panel dg-alt-panel--open" id="dg-alt-panel">
                <button id="dg-gen-docx" class="btn btn-secondary btn-full">Csak DOCX</button>
                <button id="dg-gen-pdf"  class="btn btn-purple btn-full">Csak PDF</button>
              </div>
            </div>
            <div class="dg-result-card" id="dg-result-card">
              <div class="dg-result-title" id="dg-result-title"></div>
              <div class="dg-result-actions" id="dg-result-actions"></div>
              <div id="dg-missing-panel"></div>
            </div>
            <div class="status-section" style="margin-top:16px">
              <div class="progress-wrap"><div class="progress-bar" id="dg-progress"></div></div>
              <div style="display:flex;justify-content:space-between">
                <div class="status-text" id="dg-status">Készen áll</div>
                <div class="progress-pct" id="dg-pct"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ── Eseménykötések ────────────────────────────────────────────────────────
  function bindSidebar() {
    const missingLogBtn = q('#dg-show-missing-log');
    if (missingLogBtn) missingLogBtn.addEventListener('click', DocgenMissingLog.showDialog);
    // Az 1. lépés gombja: enélkül a „Személyek kiválasztása" néma volt
    q('#dg-choose-clients').addEventListener('click', openClientDialog);
    q('#dg-set-dir').addEventListener('click', onTemplatesDirBtn);
    q('#dg-manage-groups').addEventListener('click', DocgenGroups.openGroupsDialog);
    const visBtn = q('#dg-manage-visibility');
    if (visBtn) visBtn.addEventListener('click', DocgenGroups.openVisibilityDialog);
    q('#dg-set-output').addEventListener('click', onSetOutput);

    // ── Sidebar magasság-resize ───────────────────────────────────────────────
    const sidebar       = q('#dg-sidebar');
    const resizeHandle  = q('#dg-sidebar-resize');
    if (sidebar && resizeHandle) {
      const savedH = Settings.get('docgen_sidebar_h', null);
      if (savedH) sidebar.style.maxHeight = savedH + 'px';

      resizeHandle.addEventListener('mousedown', e => {
        e.preventDefault();
        const startY = e.clientY;
        const startH = sidebar.offsetHeight;
        const onMove = ev => {
          const newH = Math.max(200, startH + (ev.clientY - startY));
          sidebar.style.maxHeight = newH + 'px';
        };
        const onUp = () => {
          Settings.set('docgen_sidebar_h', parseInt(sidebar.style.maxHeight) || sidebar.offsetHeight);
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });

      resizeHandle.addEventListener('dblclick', () => {
        sidebar.style.maxHeight = '';
        Settings.remove('docgen_sidebar_h');
      });
    }
  }

  function bindWorkspace() {
    // Onboarding gombok — pointer-events:none CSS védi a 'disabled' lépéseket,
    // így a handlert mindig hozzácsatoljuk; a klick csak aktív lépésen sül el.
    const obRegistry = q('#dg-ob-registry');
    if (obRegistry) obRegistry.addEventListener('click', () => {
      document.querySelector('.tab-btn[data-tab="registry"]')?.click();
    });
    const obDir = q('#dg-ob-dir');
    if (obDir) obDir.addEventListener('click', onSetTemplatesDir);
    const obClients = q('#dg-ob-clients');
    if (obClients) obClients.addEventListener('click', openClientDialog);

    const srchInput = q('#dg-tpl-search');
    if (srchInput) {
      srchInput.addEventListener('input', e => {
        const q2 = e.target.value.trim().toLowerCase();
        q('#dg-template-list').querySelectorAll('.template-radio-item').forEach(item => {
          const name = (item.querySelector('span') || item).textContent.toLowerCase();
          item.style.display = name.includes(q2) ? '' : 'none';
        });
      });
    }

    const groupFilters = q('#dg-group-filters');
    if (groupFilters) groupFilters.addEventListener('click', e => {
      const depthToggle = e.target.closest('[data-depth-toggle]');
      if (depthToggle) {
        const row = depthToggle.closest('.group-filter-row--collapsible');
        if (row) row.classList.toggle('group-filter-row--collapsed');
        return;
      }
      const btn = e.target.closest('.group-filter-btn');
      if (!btn) return;
      const g = btn.dataset.group;
      if (g === '') {
        state.activeGroups.clear();
      } else if (state.activeGroups.has(g)) {
        state.activeGroups.delete(g);
      } else {
        state.activeGroups.add(g);
      }
      updateGroupFilterBtns();
    });
    const tplList = q('#dg-template-list');
    if (tplList) tplList.addEventListener('change', e => {
      if (e.target.name !== 'dg-template') return;
      const name = e.target.value;
      if (e.target.checked) state.chosenTemplates.add(name);
      else state.chosenTemplates.delete(name);
      updateTemplateState();
      saveSettings();
      updateGenButtons();
      updateGenSummary();
    });
    const applyTplSelect = () => { refreshTemplateList(); updateTemplateState(); saveSettings(); updateGenButtons(); updateGenSummary(); };
    const tplAll = q('#dg-tpl-all');
    if (tplAll) tplAll.addEventListener('click', () => {
      filteredTemplates().forEach(t => state.chosenTemplates.add(t.name));
      applyTplSelect();
    });
    const tplNone = q('#dg-tpl-none');
    if (tplNone) tplNone.addEventListener('click', () => {
      filteredTemplates().forEach(t => state.chosenTemplates.delete(t.name));
      applyTplSelect();
    });
    const genBoth = q('#dg-gen-both');
    if (genBoth) genBoth.addEventListener('click', () => runGenerate({ docx: true,  pdf: true  }));
    const genDocx = q('#dg-gen-docx');
    if (genDocx) genDocx.addEventListener('click', () => runGenerate({ docx: true,  pdf: false }));
    const genPdf = q('#dg-gen-pdf');
    if (genPdf) genPdf.addEventListener('click',  () => runGenerate({ docx: false, pdf: true  }));
    // ── Mai nap kártya ────────────────────────────────────────────────────────
    const maiNapInput = q('#dg-mai-nap-input');
    if (maiNapInput) {
      // Félbehagyott gépelés („2026-03") ne kerüljön a sablonokba dátumként
      maiNapInput.addEventListener('change', e => {
        const v = e.target.value.trim();
        state.maiNap = /^\d{4}-\d{2}-\d{2}$/.test(v) ? _inputToDot(v) : _todayDot();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) e.target.value = _dotToInput(state.maiNap);
        Settings.set('global_mai_nap', state.maiNap);
      });
    }
    const maiNapToday = q('#dg-mai-nap-today');
    if (maiNapToday) {
      maiNapToday.addEventListener('click', () => {
        state.maiNap = _todayDot();
        Settings.set('global_mai_nap', state.maiNap);
        if (maiNapInput) {
          maiNapInput.value = _dotToInput(state.maiNap);
          maiNapInput.dispatchEvent(new Event('input', { bubbles: true }));  // a naptár is kövesse
        }
      });
    }

    // ── PDF összefűzés kártya ─────────────────────────────────────────────────
    const mergeToggle = q('#dg-merge-enabled');
    if (mergeToggle) {
      mergeToggle.addEventListener('change', () => {
        state.mergeEnabled = mergeToggle.checked;
        DocgenMerge.saveSettings();
        DocgenMerge.updateCard();
      });
    }
    DocgenMerge.bindCardBody();

    // ── Oszlop-szélességű resize divider ─────────────────────────────────────
    const divider   = q('#dg-col-divider');
    const colLeft   = q('#dg-col-templates');
    const colRight  = q('#dg-col-gen');
    const workspace = container.querySelector('.workspace');
    if (divider && colLeft && colRight && workspace) {
      divider.addEventListener('mousedown', e => {
        e.preventDefault();
        divider.classList.add('resizing');
        const startX   = e.clientX;
        const startW   = colLeft.offsetWidth;
        const totalW   = workspace.offsetWidth - divider.offsetWidth;
        function onMove(ev) {
          const delta = ev.clientX - startX;
          const newW  = Math.max(180, Math.min(startW + delta, totalW - 180));
          colLeft.style.flex  = 'none';
          colLeft.style.width = newW + 'px';
          colRight.style.flex = '1';
        }
        function onUp() {
          divider.classList.remove('resizing');
          try {
            const ratio = colLeft.offsetWidth / workspace.offsetWidth;
            localStorage.setItem('docgen-ws-split', ratio.toFixed(4));
          } catch {}
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
        }
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });
    }

    // ── Workspace kártyák drag & drop cseréje ─────────────────────────────────
    const cards = [q('#dg-card-templates'), q('#dg-card-merge'), q('#dg-card-gen')];
    let _wsDragCard = null;
    cards.forEach(card => {
      if (!card) return;
      const handle = card.querySelector('.ws-card-drag-handle');
      if (handle) {
        handle.addEventListener('mousedown', () => { card.draggable = true; });
        handle.addEventListener('mouseup',   () => { card.draggable = false; });
      }
      card.addEventListener('dragstart', e => {
        _wsDragCard = card;
        setTimeout(() => card.classList.add('ws-dragging'), 0);
        e.dataTransfer.effectAllowed = 'move';
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('ws-dragging');
        cards.forEach(c => c && c.classList.remove('ws-drag-over'));
        _wsDragCard = null;
        card.draggable = false;
      });
      card.addEventListener('dragover', e => {
        if (_wsDragCard && _wsDragCard !== card) {
          e.preventDefault();
          card.classList.add('ws-drag-over');
        }
      });
      card.addEventListener('dragleave', () => card.classList.remove('ws-drag-over'));
      card.addEventListener('drop', e => {
        e.preventDefault();
        card.classList.remove('ws-drag-over');
        if (!_wsDragCard || _wsDragCard === card) return;
        // Felcserél két kártyát az oszlopaikban
        const srcCol = _wsDragCard.parentElement;
        const tgtCol = card.parentElement;
        if (srcCol && tgtCol && srcCol !== tgtCol) {
          srcCol.insertBefore(card, null);
          tgtCol.insertBefore(_wsDragCard, null);
        }
      });
    });
  }

  function q(sel) { return container.querySelector(sel); }

  // Mappa ikon — info-row-okban használt inline SVG
  const _folderSVG = '<svg class="info-row__icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
    '<path d="M2 4.5A1.5 1.5 0 013.5 3h3l1.5 2H13A1.5 1.5 0 0114.5 6.5v6A1.5 1.5 0 0113 14H3' +
    'a1.5 1.5 0 01-1.5-1.5v-8z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';

  // ── Kontextus-menü sablonokhoz ────────────────────────────────────────────
  let _ctxMenu = null;
  function _showCtxMenu(x, y, items) {
    _hideCtxMenu();
    _ctxMenu = document.createElement('div');
    _ctxMenu.className = 'bev-ctx-menu';
    _ctxMenu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:9999;
      background:var(--c-card);border:1px solid var(--c-border);border-radius:8px;
      box-shadow:0 4px 16px rgba(0,0,0,.14);padding:4px 0;min-width:200px;`;
    items.forEach(item => {
      if (!item) {
        const sep = document.createElement('div');
        sep.style.cssText = 'height:1px;background:var(--c-border);margin:3px 0';
        _ctxMenu.appendChild(sep);
        return;
      }
      const btn = document.createElement('button');
      btn.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;padding:7px 14px;' +
        'background:none;border:none;font-size:13px;color:var(--c-text);cursor:pointer;text-align:left;' +
        'transition:background .1s';
      btn.onmouseenter = () => { btn.style.background = 'var(--c-bg)'; };
      btn.onmouseleave = () => { btn.style.background = 'none'; };
      btn.innerHTML = `<span style="font-size:15px">${item.icon || ''}</span>${escHtml(item.label)}`;
      btn.addEventListener('click', () => { _hideCtxMenu(); item.action(); });
      _ctxMenu.appendChild(btn);
    });
    document.body.appendChild(_ctxMenu);
    document.addEventListener('click', _hideCtxMenu, { once: true });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') _hideCtxMenu(); }, { once: true });
  }
  function _hideCtxMenu() {
    if (_ctxMenu) { _ctxMenu.remove(); _ctxMenu = null; }
  }

  // ── Import-táblázat betöltés ───────────────────────────────────────────────
  /**
   * Az adatforrás a nyilvántartás. A sorok mindig frissen állnak elő, hogy a
   * Nyilvántartás fülön végzett módosítás azonnal látszódjon itt is.
   *
   * A kiválasztás kulcsa a rekord állandó belső azonosítója – korábban a
   * megjelenített név volt, amitől két azonos nevű ember egybeolvadt.
   */
  function loadFromRegistry({ silent = false } = {}) {
    if (!EmployeeRepo.hasBackend()) return;
    try {
      state.clientRows = EmployeeRepo.all();
    } catch {
      state.clientRows = [];   // a nyilvántartás még nincs betöltve
      return;
    }

    // Időközben törölt/kilépett személyek kiesnek a kijelölésből
    const letezo = new Set(state.clientRows.map(e => e.id));
    const elotte = state.selectedClients.length;
    state.selectedClients = state.selectedClients.filter(id => letezo.has(id));
    if (!silent && elotte !== state.selectedClients.length) {
      toast(`${elotte - state.selectedClients.length} kijelölt személy már nem elérhető`, 'warn');
    }

    updateClientCount();
    saveSettings();
  }

  /** Egy rekord megjelenítendő neve a listákban és a fájlnevekben. */
  function employeeName(emp) {
    const v = SchemaStore.resolveValues(emp.fields, 'hu');
    return v.full_name || v.surname || v.forename || '(névtelen)';
  }

  /** Belső azonosítóból megjelenítendő név — a UUID sosem kerül a felületre. */
  function clientLabel(id) {
    const emp = state.clientRows.find(e => e.id === id);
    return emp ? employeeName(emp) : '(ismeretlen személy)';
  }

  /**
   * A sablonokba kerülő értékkészlet: a séma szerint magyarra renderelve,
   * a számított mezőkkel együtt, plusz a nem sémabeli extra jelölők.
   */
  function buildRenderRow(emp) {
    const v = SchemaStore.resolveValues(emp.fields, 'hu');

    // A gépi kulcsok mellé a magyar címkék is bekerülnek kulcsként. Így a
    // fájlnév-minták ([Vezetéknév]) és a magyar nevű sablon-jelölők a
    // séma-feloldó nélkül, egyszerű kulcskereséssel is működnek.
    for (const f of SchemaStore.fields()) {
      const cimke = f.label.hu;
      if (cimke && v[cimke] === undefined) v[cimke] = v[f.key];
    }

    v['mai nap'] = state.maiNap;
    const sap = EmployeeRepo.currentIdentifier(emp, 'sap');
    if (sap) v['Azonosító'] = sap.value;
    return v;
  }

  /**
   * Séma-alapú jelölő-feloldó egy rekordhoz.
   *
   * Ez teszi lehetővé a kétnyelvű sablonokat: `{{Neme}}` → „Férfi",
   * `{{Neme_EN}}` → „Male" – ugyanabból a mezőből, a séma fordításai alapján.
   * A magyar címke, a gépi kulcs és a jelölő-aliasok mind működnek, ahogy a
   * dátum-részek (`{{date_of_birth_year}}`) és a szótár is.
   *
   * Egy sablon ugyanazt a jelölőt többször is tartalmazza, ezért gyorsítótár.
   */
  function makeSchemaResolver(emp) {
    const gyorsito = new Map();
    return (name) => {
      if (!gyorsito.has(name)) gyorsito.set(name, SchemaStore.renderTag(name, emp.fields));
      return gyorsito.get(name);
    };
  }

  /**
   * Séma-alapú összehasonlító a `{{CHECK:Neme=male}}` alakú jelölőkhöz.
   * Enum mezőnél a kanonikus id-t veti össze, tehát a sablon írhat magyar,
   * angol vagy gépi alakot is.
   */
  function makeSchemaMatcher(emp) {
    return (name, vart) => SchemaStore.tagEquals(name, vart, emp.fields);
  }

  function updateClientCount() {
    const el = q('#dg-client-count');
    if (el) el.textContent = state.selectedClients.length;
    const badge = q('#dg-choose-clients .badge');
    if (badge) {
      badge.textContent = state.selectedClients.length;
      badge.className = 'badge ' + (state.selectedClients.length ? 'badge-green' : 'badge-muted');
    }
    // A gomb szándékosan NEM tiltódik le üres nyilvántartásnál: a letiltott
    // állapot elavulhat (és el is avult), a párbeszéd viszont frissen olvassa
    // a nyilvántartást, és üres listánál megmondja, hova kell menni.
    updateGenSummary();
    window.updateHeaderBreadcrumb?.({
      sourceName: state.clientRows.length ? `Nyilvántartás (${state.clientRows.length} személy)` : null,
      clientCount: state.selectedClients.length,
      onClientClick: openClientDialog,
    });
  }

  // ── Sablonmappa ───────────────────────────────────────────────────────────
  /** A sidebar gombja: ha még nincs mappa, kér egyet; ha van, váltásra kérdez. */
  function onTemplatesDirBtn() {
    return state.templatesDir ? onSwitchTemplatesDir() : onSetTemplatesDir();
  }

  async function onSetTemplatesDir({ force = false } = {}) {
    const h = await FsService.getOrRequestDir('templates_dir', 'Sablonmappa', { force });
    if (!h) return;
    state.templatesDir = h;
    _rerenderTemplatesDirUI();
    toast(`✓ Sablonmappa: ${h.name}`, 'success');
    await refreshTemplates();
    _refreshOnboardSteps(); // ha onboardon vagyunk: aktiválja step 2 done állapotát / kilép onboardból
  }

  // ── Másik sablonmappa választása (megerősítéssel) ─────────────────────────
  async function onSwitchTemplatesDir() {
    const chosenCount = state.chosenTemplates.size;
    const oldName = state.templatesDir?.name || '?';
    showDialog({
      title: 'Másik sablonmappa választása',
      body: `
        <p style="margin:0 0 12px;font-size:13px">
          Jelenlegi sablonmappa: <strong>${escHtml(oldName)}</strong>
        </p>
        <p style="margin:0 0 12px;font-size:13px">
          Új sablonmappára váltva a jelenleg kiválasztott
          <strong>${chosenCount}</strong> sablon kiválasztása elveszik.
        </p>
        <p style="margin:0;font-size:12px;color:var(--c-muted)">
          A meglévő mappához rögzített fájl-engedélyek továbbra is megmaradnak,
          csak a kiválasztás kerül törlésre. Folytatod?
        </p>`,
      footer: `
        <button class="btn btn-primary btn-sm" id="dg-switch-confirm">Igen, váltok</button>
        <button class="btn btn-ghost btn-sm" onclick="closeDialog()">Mégse</button>`,
    });
    document.getElementById('dg-switch-confirm').addEventListener('click', async () => {
      closeDialog();
      // State reset
      state.templatesDir = null;
      state.allTemplates = [];
      state.chosenTemplates.clear();
      state.activeGroups.clear();
      saveSettings();
      BevLogger.info('TEMPLATE_DIR_SWITCH', `Sablonmappa-váltás indítva: ${oldName}`, '', '');
      // Új mappa kérése — force: a tárolt handle-t átugorva jöjjön fel a picker
      await onSetTemplatesDir({ force: true });
      // Sidebar újrarajzolása, hogy a switch gomb is frissüljön
      const sidebar = q('#dg-sidebar');
      if (sidebar) {
        sidebar.innerHTML = renderSidebar();
        bindSidebar();
      }
      updateGenButtons();
      updateGenSummary();
    });
  }

  // ── Template-szkennelés ───────────────────────────────────────────────────
  // opts.silent: ne mutasson toast-ot, csak változás esetén
  async function refreshTemplates(opts = {}) {
    const silent     = !!opts.silent;
    const prevNames  = state.allTemplates.map(t => t.name);
    const prevChosen = [...state.chosenTemplates];

    state.allTemplates = [];
    const scanResult = await scanDir(state.templatesDir);
    autoEnsureSubdirGroups();

    // P4 / M1: reconcile csak akkor, ha a szkennelés SIKERES volt
    // (legalább 1 sablon jött vissza, VAGY a mappa biztosan üres és a scan nem hibára futott)
    if (scanResult.ok) {
      const currentNames = new Set(state.allTemplates.map(t => t.name));
      const removed = prevChosen.filter(name => !currentNames.has(name));
      const added   = state.allTemplates
        .map(t => t.name)
        .filter(name => !prevNames.includes(name));

      if (removed.length > 0) {
        // Csak akkor töröljük chosenTemplates-ből, ha sikeres a scan
        removed.forEach(name => state.chosenTemplates.delete(name));
        saveSettings();
        BevLogger.warn('TEMPLATE_RECONCILE',
          `${removed.length} kiválasztott sablon eltűnt vagy átnevezésre került`,
          `removed=${removed.join('|')}\nremaining_chosen=${[...state.chosenTemplates].join('|')}\ntotal_templates=${state.allTemplates.length}`,
          `user=${currentUser}`);
        if (!silent) {
          toast(`${removed.length} sablon eltűnt vagy átnevezésre került — kiválasztás frissítve`, 'warn');
        }
      }

      // Z3: csak akkor jelezzünk vizuálisan, ha tényleges változás történt
      if ((removed.length > 0 || added.length > 0) && !silent) {
        BevLogger.info('TEMPLATE_RESCAN_CHANGE',
          `Sablon-változás észlelve`,
          `removed=${removed.length} (${removed.slice(0,5).join('|')})\nadded=${added.length} (${added.slice(0,5).join('|')})`,
          `user=${currentUser}`);
      } else if (silent) {
        BevLogger.debug('TEMPLATE_RESCAN', 'Silent re-scan: nincs változás',
          `templates=${state.allTemplates.length}`, `user=${currentUser}`);
      }
    } else {
      // Scan hibára futott vagy nem olvasható a mappa → MEGŐRIZZÜK a chosenTemplates-et!
      BevLogger.warn('TEMPLATE_SCAN_FAIL',
        'Sablonmappa olvasási hiba — kiválasztás megőrizve',
        `scanError=${scanResult.error || 'ismeretlen'}`,
        `user=${currentUser}, templatesDir=${state.templatesDir?.name || 'null'}`);
      if (!silent) toast('Sablonmappa nem olvasható — kiválasztás megőrizve', 'warn');
      // Az allTemplates-et újratöltjük a régiből, hogy a UI ne ürítse ki
      state.allTemplates = prevNames.map(name => ({ name, subdir: '' }));
    }

    refreshTemplateList();
    rebuildGroupFilterBtns();
  }

  // scanDir most struktúrált eredményt ad: { ok, error } — M1 mitigációhoz
  async function scanDir(dirHandle) {
    if (!dirHandle) return { ok: false, error: 'no dirHandle' };
    try {
      const accountDir = await FsService.getSubDir(dirHandle, currentUser);
      const baseDir    = accountDir || dirHandle;
      const files = await FsService.listDocxFilesDeep(baseDir);
      files.forEach(({ name, subdir }) => addTemplate(name, subdir));
      return { ok: true, count: files.length };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  }

  function addTemplate(filename, subdir) {
    const tplName = filename.replace(/\.docx$/i, '');
    if (!Settings.isTemplateVisible(tplName, currentUser)) return;
    if (!state.allTemplates.find(t => t.name === tplName))
      state.allTemplates.push({ name: tplName, subdir });
  }

  // Almappa-útvonalakból csoportot hoz létre minden szinthez
  // pl. "Telephely/Alcsoport/nyomtatványok" → 3 csoport: minden közbülső szintnek
  function autoEnsureSubdirGroups() {
    // P6: subdir normalizálás — leading/trailing slash + dupla slash kiszedése
    function normalizeSubdir(s) {
      if (!s) return '';
      return String(s).replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
    }

    // Minden létező teljes útvonal
    const allLeafPaths = [...new Set(
      state.allTemplates
        .filter(t => t.subdir)
        .map(t => normalizeSubdir(t.subdir))
        .filter(Boolean)
    )];

    // Minden szinthez útvonalat gyűjtünk (pl. "A/B/C" → "A", "A/B", "A/B/C")
    const allGroupPaths = new Set();
    allLeafPaths.forEach(p => {
      const parts = p.split('/').filter(Boolean); // üres szegmensek kihagyása
      for (let i = 1; i <= parts.length; i++) {
        allGroupPaths.add(parts.slice(0, i).join('/'));
      }
    });

    let changed = false;
    const created = [], updated = [];
    allGroupPaths.forEach(groupPath => {
      // Egy csoport azokat a sablonokat tartalmazza, amelyek ebben a mappában vagy almappájában vannak
      const matching = state.allTemplates
        .filter(t => {
          const sub = normalizeSubdir(t.subdir);
          return sub && (sub === groupPath || sub.startsWith(groupPath + '/'));
        })
        .map(t => t.name);

      const existing = state.templateGroups.find(g => g.name === groupPath);
      if (!existing) {
        state.templateGroups.push({ name: groupPath, templates: matching });
        created.push(groupPath);
        changed = true;
      } else {
        matching.forEach(tName => {
          if (!existing.templates.includes(tName)) {
            existing.templates.push(tName);
            if (!updated.includes(groupPath)) updated.push(groupPath);
            changed = true;
          }
        });
      }
    });

    // P6 diagnosztikai log
    if (created.length || updated.length) {
      BevLogger.debug('GROUP_AUTOSYNC',
        `Csoportok szinkronizálva (${created.length} új, ${updated.length} frissített)`,
        `created=${created.join('|')}\nupdated=${updated.join('|')}\nleafPaths=${allLeafPaths.join('|')}`,
        `user=${currentUser}, totalGroups=${state.templateGroups.length}`);
    }

    if (changed) saveSettings();
  }

  function filteredTemplates() {
    if (!state.activeGroups.size) return state.allTemplates;
    const allowed = new Set();
    state.activeGroups.forEach(name => {
      const group = state.templateGroups.find(g => g.name === name);
      if (group) group.templates.forEach(t => allowed.add(t));
    });
    return state.allTemplates.filter(t => allowed.has(t.name));
  }

  function refreshTemplateList() {
    const el = q('#dg-template-list');
    if (!el) return;
    const filtered = filteredTemplates();
    if (!filtered.length) {
      el.innerHTML = bevEmptyState('Nincs sablon. Állítsd be a sablonmappát.', 'shield-mark');
      return;
    }
    el.innerHTML = filtered.map(t => `
        <label class="template-radio-item" data-tpl-name="${escHtml(t.name)}" data-tpl-subdir="${escHtml(t.subdir || '')}">
          <input type="checkbox" name="dg-template" value="${escHtml(t.name)}"
            ${state.chosenTemplates.has(t.name) ? 'checked' : ''}>
          <span>${escHtml(t.name)}</span>
          ${t.subdir ? `<span style="font-size:10px;color:var(--c-blue);margin-left:auto" title="${escHtml(t.subdir)}">${escHtml(t.subdir.split('/').pop())}</span>` : ''}
        </label>
      `).join('');

    el.addEventListener('contextmenu', e => {
      const lbl = e.target.closest('[data-tpl-name]');
      if (!lbl) return;
      e.preventDefault();
      _showCtxMenu(e.clientX, e.clientY, [
        {
          icon: '🏷️',
          label: 'Generált dokumentum elnevezése',
          action: () => DocgenNaming.openDialog(lbl.dataset.tplName),
        }
      ]);
    }, { passive: false });
  }

  function updateTemplateState() {
    const cnt = state.chosenTemplates.size;
    const st = q('#dg-template-state');
    const dp = q('#dg-template-display');
    if (st) st.textContent = cnt ? cnt + ' kiválasztva' : '— nincs —';
    if (dp) dp.textContent = cnt ? cnt + ' db' : '—';
    updateGenSummary();
  }

  function updateGroupFilterBtns() {
    q('#dg-group-filters').querySelectorAll('.group-filter-btn').forEach(b => {
      const g = b.dataset.group;
      const isActive = g === '' ? state.activeGroups.size === 0 : state.activeGroups.has(g);
      b.classList.toggle('active', isActive);
    });
    refreshTemplateList();
  }

  function rebuildGroupFilterBtns() {
    const el = q('#dg-group-filters');
    if (!el) return;
    el.innerHTML = buildGroupFilterHTML(
      ['', ...state.templateGroups.map(g => g.name)],
      state.activeGroups
    );
  }

  // ── Kimenet mappa ─────────────────────────────────────────────────────────
  /** A sidebar gombja: ha még nincs mappa, kér egyet; ha van, váltásra kérdez. */
  async function onSetOutput() {
    if (!state.outputDir) return _pickAndSaveOutputDir();
    // Engedély nélküli handle esetén nincs mit megerősíteni: kell egy mappa
    const hasPerm = await FsService.queryPermissionOnly(state.outputDir, true);
    return hasPerm ? onSwitchOutputDir() : _pickAndSaveOutputDir();
  }

  // Közvetlen mappa-picker: nem használja az IndexedDB-ben tárolt handle-t,
  // ezért mindig megjelenik a rendszer mappakiválasztó párbeszéd.
  async function _pickAndSaveOutputDir() {
    if (!FsService.hasFsApi) return;
    try {
      const h = await window.showDirectoryPicker({ id: 'output_dir', mode: 'readwrite', startIn: 'documents' });
      await FsService.saveHandle('output_dir', h);
      state.outputDir = h;
      toast('✓ Kimeneti mappa: ' + h.name, 'success');
      BevLogger.info('OUTPUT_DIR_SET', 'Kimenet mappa beállítva', h.name, currentUser);
      // Sidebar teljes újrarajzolás (váltó gomb megjelenítéséhez)
      const sidebar = q('#dg-sidebar');
      if (sidebar) { sidebar.innerHTML = renderSidebar(); bindSidebar(); }
    } catch (e) {
      if (e.name !== 'AbortError') {
        BevLogger.error('OUTPUT_DIR_SET', 'Kimenet mappa beállítás sikertelen', e.message, currentUser);
        toast('Hiba a mappa kiválasztásakor: ' + e.message, 'error');
      }
    }
  }

  // Másik kimenet mappa választása (megerősítéssel, közvetlen picker)
  async function onSwitchOutputDir() {
    const oldName = state.outputDir?.name || '?';
    showDialog({
      title: 'Másik kimenet mappa választása',
      body: `
        <p style="margin:0 0 12px;font-size:13px">
          Jelenlegi kimenet mappa: <strong>${escHtml(oldName)}</strong>
        </p>
        <p style="margin:0;font-size:12px;color:var(--c-muted)">
          Új mappát választva a generált dokumentumok a továbbiakban oda kerülnek. Folytatod?
        </p>`,
      footer: `
        <button class="btn btn-primary btn-sm" id="dg-output-switch-confirm">Igen, váltok</button>
        <button class="btn btn-ghost btn-sm" onclick="closeDialog()">Mégse</button>`,
    });
    document.getElementById('dg-output-switch-confirm').addEventListener('click', async () => {
      closeDialog();
      state.outputDir = null;
      BevLogger.info('OUTPUT_DIR_SWITCH', `Kimenet mappa-váltás indítva: ${oldName}`, '', currentUser);
      await _pickAndSaveOutputDir();
    });
  }

  // ── Sablonmappa sidebar UI szinkronizálása ────────────────────────────────
  // Hívd meg minden alkalommal, amikor state.templatesDir változik.
  // Kezeli: info-sor, gomb-felirat, step-badge, 🔄 váltó-gomb megjelenése/eltűnése.
  function _rerenderTemplatesDirUI() {
    const dirInfo = q('#dg-dir-info');
    const setBtn  = q('#dg-set-dir');
    const badge   = q('#dg-step-2');

    if (state.templatesDir) {
      if (dirInfo) { dirInfo.title = state.templatesDir.name; dirInfo.innerHTML = _folderSVG + escHtml(state.templatesDir.name); }
      if (setBtn)  setBtn.textContent = '🔄 Másik sablonmappa választása';
      if (badge)   badge.classList.add('done');
    } else {
      if (dirInfo) { dirInfo.title = ''; dirInfo.innerHTML = _folderSVG + 'Nincs beállítva'; }
      if (setBtn)  setBtn.textContent = 'Sablonmappa beállítása';
      if (badge)   badge.classList.remove('done');
    }
  }

  function rerenderSidebarSettings() {
    const el = q('#dg-output-info');
    if (el) el.innerHTML = _folderSVG + escHtml(state.outputDir ? state.outputDir.name : 'Nincs beállítva');

    const setBtn = q('#dg-set-output');
    const badge  = q('#dg-step-3');
    if (state.outputDir) {
      if (badge)  badge.classList.add('done');
      if (setBtn) setBtn.textContent = '🔄 Másik kimenet mappa választása';
    } else {
      if (badge)  badge.classList.remove('done');
      if (setBtn) setBtn.textContent = 'Kimenet mappa beállítása';
    }
  }

  // ── Személy-választó ───────────────────────────────────────────────────────
  async function openClientDialog() {
    loadFromRegistry({ silent: true });
    if (!state.clientRows.length) {
      toast('A nyilvántartás üres — vidd fel a személyeket a Nyilvántartás fülön.', 'warn');
      return;
    }

    // A választóban a séma szerinti, magyarra fordított értékek jelennek meg,
    // de a kiválasztás kulcsa az állandó belső azonosító marad.
    const megjelenites = state.clientRows.map(emp => {
      const v = SchemaStore.resolveValues(emp.fields, 'hu');
      const sap = EmployeeRepo.currentIdentifier(emp, 'sap');
      return Object.assign({}, v, {
        __id: emp.id,
        'Azonosító': sap ? sap.value : '',
      });
    });

    ClientPicker.open({
      title:      'Személyek kiválasztása',
      rows:       megjelenites,
      storageKey: 'docgen-clients',
      selected:   state.selectedClients,
      rowKey:     r => r.__id,
      onSave: (rows, keys) => {
        state.selectedClients = keys;
        updateClientCount();
        saveSettings();
        updateGenButtons();
      },
    });
  }

  // ── Generálás ─────────────────────────────────────────────────────────────

  // Összesítő kártya — statikus nézet (ügyfél × sablon, ügyfelenként csoportosítva)
  function _updateSummaryCard() {
    const body  = q('#dg-sum-body');
    const count = q('#dg-sum-count');
    if (!body) return;

    const clientNames = state.selectedClients.map(clientLabel);
    const tpls        = [...state.chosenTemplates];

    if (!clientNames.length || !tpls.length) {
      body.innerHTML = `<div style="color:var(--c-muted);font-size:12px;font-style:italic;padding:4px 0">
        Válassz ügyfeleket és sablonokat a generáláshoz.</div>`;
      if (count) count.textContent = '';
      return;
    }

    const total = clientNames.length * tpls.length;
    if (count) count.textContent = `${clientNames.length} × ${tpls.length} = ${total} dokumentum`;

    body.innerHTML = clientNames.map(name => `
      <div style="display:flex;align-items:flex-start;gap:8px;padding:5px 0;
          border-bottom:1px solid var(--c-border)">
        <span style="font-size:12px;font-weight:500;min-width:110px;flex-shrink:0;
            padding-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
            title="${escHtml(name)}">${escHtml(name)}</span>
        <div style="display:flex;flex-wrap:wrap;gap:3px">
          ${tpls.map(t =>
            `<span style="font-size:10px;padding:2px 7px;border-radius:4px;
                background:var(--c-bg);border:1px solid var(--c-border);white-space:nowrap"
                title="${escHtml(t)}">${escHtml(t)}</span>`
          ).join('')}
        </div>
      </div>`).join('');
  }

  function updateGenSummary() {
    // Kompakt chip-sor a Generálás kártyában
    const el = q('#dg-gen-summary');
    if (el) {
      const clients = state.selectedClients.map(clientLabel);
      const tpls    = [...state.chosenTemplates];
      if (!clients.length && !tpls.length) {
        el.innerHTML = '<span class="dg-summary-empty">Nincs kijelölve ügyfél vagy sablon</span>';
      } else {
        const MAX_C = 3, MAX_T = 2;
        const cChips = clients.slice(0, MAX_C).map(n =>
          `<span class="dg-summary-chip" title="${escHtml(n)}">${escHtml(n)}</span>`).join('');
        const cMore  = clients.length > MAX_C
          ? `<span class="dg-summary-chip dg-summary-chip--more">+${clients.length - MAX_C}</span>` : '';
        const sep = clients.length && tpls.length
          ? '<span style="color:var(--c-muted);font-size:13px;padding:0 2px">×</span>' : '';
        const tChips = tpls.slice(0, MAX_T).map(t =>
          `<span class="dg-summary-chip dg-summary-chip--tpl" title="${escHtml(t)}">${escHtml(t)}</span>`).join('');
        const tMore  = tpls.length > MAX_T
          ? `<span class="dg-summary-chip dg-summary-chip--more">+${tpls.length - MAX_T}</span>` : '';
        el.innerHTML = cChips + cMore + sep + tChips + tMore;
      }
    }
    // Teljes összesítő kártya
    _updateSummaryCard();
    // Merge kártya előnézet szinkronizálása
    DocgenMerge.updateCard();
  }

  function updateGenButtons() {
    const ready = state.selectedClients.length > 0 && state.chosenTemplates.size > 0 && !!state.templatesDir;
    ['#dg-gen-both','#dg-gen-docx','#dg-gen-pdf'].forEach(sel => {
      const el = q(sel); if (el) el.disabled = !ready;
    });
    // Primer gomb visszaállítása alapállapotra
    const fill  = q('#dg-btn-fill');
    const label = q('#dg-btn-label');
    if (fill)  fill.style.width = '0%';
    if (label && label.textContent !== 'DOCX + PDF') label.textContent = 'DOCX + PDF';
    const tplWarn = q('#dg-tpl-warn');
    if (tplWarn) tplWarn.classList.toggle('visible', state.chosenTemplates.size === 0);
    const clientWarn = q('#dg-client-warn');
    if (clientWarn) clientWarn.classList.toggle('visible', state.selectedClients.length === 0);
  }

  // Visszaadja a vezérlést a böngészőnek (event loop), hogy a setStatus()
  // által végrehajtott DOM-frissítések ténylegesen megjelenhessenek a képernyőn,
  // mielőtt a következő (szinkron) generálási iteráció elkezdődik.
  // Nélkülözhetetlen, mert a DocxService.generateDocx() bár async-nak van deklarálva,
  // belül teljesen szinkron fut (PizZip + Docxtemplater + zip.generate) → a fő JS
  // szál le van blokkolva, a böngésző nem tud repaintolni await nélkül.
  function _yieldFrame() {
    return new Promise(r => setTimeout(r, 0));
  }

  function setStatus(msg, pct) {
    const st = q('#dg-status'), pr = q('#dg-progress'), pc = q('#dg-pct');
    if (st) st.textContent = msg;
    if (pr) pr.style.width = (pct ?? 0) + '%';
    if (pc) pc.textContent = pct != null ? pct + '%' : '';
    // Primer gomb progress fill + felirat frissítése
    const fill  = q('#dg-btn-fill');
    const label = q('#dg-btn-label');
    if (fill) fill.style.width = (pct ?? 0) + '%';
    if (label) {
      if (pct != null && pct >= 0 && pct < 100) {
        label.textContent = pct > 0 ? 'Generálás… ' + pct + '%' : 'Generálás…';
      } else if (pct === 100) {
        label.textContent = '✓ Kész';
      }
    }
  }

  function setGenButtons(enabled) {
    ['#dg-gen-both','#dg-gen-docx','#dg-gen-pdf'].forEach(s => {
      const e = q(s); if (e) e.disabled = !enabled;
    });
  }

  // ── Generálás előnézet dialog ─────────────────────────────────────────────
  // Megmutatja, ki kap milyen sablont, majd resolve(true/false)-val tér vissza.
  // A dialog NEM záródik be "Generálás indítása"-ra — in-place átváltódik
  // a progress-nézetre (_openProgressDialog hívja).
  function showGenConfirmDialog(clients, templates, docx, pdf) {
    return new Promise(resolve => {
      const typeLabel = docx && pdf ? 'DOCX + PDF' : docx ? 'Csak DOCX' : 'Csak PDF';
      const typeBg    = docx && pdf ? 'var(--c-green)' : docx ? 'var(--c-slate)' : 'var(--c-purple)';
      const total     = clients.length * templates.length;
      const outLabel  = state.outputDir
        ? `📁 ${escHtml(state.outputDir.name)}`
        : '⬇ Letöltés (böngésző)';

      const rows = clients.map(client => {
        const name = employeeName(client);
        return `
          <div style="display:flex;align-items:flex-start;gap:8px;padding:5px 8px;
              border-radius:6px;background:var(--c-bg);margin-bottom:3px">
            <span style="font-size:12px;font-weight:500;min-width:130px;flex-shrink:0;
                overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-top:2px"
                title="${escHtml(name)}">${escHtml(name)}</span>
            <div style="display:flex;flex-wrap:wrap;gap:3px">
              ${templates.map(t =>
                `<span style="font-size:10px;padding:2px 7px;border-radius:4px;
                    background:var(--c-card);border:1px solid var(--c-border);white-space:nowrap"
                    title="${escHtml(t)}">${escHtml(t)}</span>`
              ).join('')}
            </div>
          </div>`;
      }).join('');

      showDialog({
        title: 'Generálás előnézete',
        body: `
          <div>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;
                padding:9px 12px;background:var(--c-bg);border-radius:8px;margin-bottom:12px">
              <span style="background:${typeBg};color:#fff;font-size:11px;font-weight:600;
                  padding:2px 9px;border-radius:4px;flex-shrink:0">${typeLabel}</span>
              <span style="font-size:13px">
                <strong>${clients.length}</strong> ügyfél
                <span style="color:var(--c-muted);margin:0 4px">×</span>
                <strong>${templates.length}</strong> sablon
                <span style="color:var(--c-muted);margin:0 6px">=</span>
                <strong style="color:var(--c-green)">${total} dokumentum</strong>
              </span>
              <span style="font-size:11px;color:var(--c-muted);margin-left:auto;
                  white-space:nowrap">${outLabel}</span>
            </div>
            <div style="font-size:10px;font-weight:700;color:var(--c-muted);
                text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">
              Ügyfelek és sablonok</div>
            <div style="max-height:300px;overflow-y:auto;padding-right:2px">${rows}</div>
          </div>`,
        footer: `
          <button class="btn btn-ghost btn-sm" id="dg-confirm-cancel">Mégse</button>
          <button class="btn btn-primary btn-sm" id="dg-confirm-start">
            ▶&nbsp;Generálás indítása&nbsp;&nbsp;(${total} fájl)
          </button>`,
      });

      const box = document.querySelector('#dialog-overlay .dialog-box');
      if (box) box.style.maxWidth = '580px';

      document.getElementById('dg-confirm-cancel')?.addEventListener('click', () => {
        closeDialog(); resolve(false);
      });
      document.getElementById('dg-confirm-start')?.addEventListener('click', () => {
        // A dialog NEM záródik be — átváltódik progress-nézetre
        resolve(true);
      });
    });
  }

  // ── Generálás folyamat — összesítő kártyán belüli live tracker ──────────
  // Az összesítő kártya tartalmát cseréli le kétosztatú haladásjelzőre.
  // Visszaad egy vezérlő objektumot (setActive / setDone / setError / …).
  // A "két vízszintes vonal" az aktív elem körüli border-top és border-bottom.
  function _openProgressDialog(clients, templates) {
    const body  = q('#dg-sum-body');
    const count = q('#dg-sum-count');
    if (!body) return _nullProgress();

    // items generálási sorrendben: ti * clients.length + ci
    const items = [];
    for (let ti = 0; ti < templates.length; ti++)
      for (let ci = 0; ci < clients.length; ci++)
        items.push({ clientName: employeeName(clients[ci]), templateName: templates[ti], status: 'waiting' });

    const total = items.length;
    let doneCount = 0;

    if (count) count.textContent = `0 / ${total}`;

    // Flat item lista — minden sor = 1 dokumentum
    body.innerHTML = items.map((it, i) => `
      <div id="dg-pi-${i}"
        style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:4px;
               font-size:12px;transition:background .12s,border-top-color .12s,border-bottom-color .12s;
               border-top:2px solid transparent;border-bottom:2px solid transparent">
        <span id="dg-pi-ic-${i}"
          style="width:14px;text-align:center;flex-shrink:0;color:var(--c-border);
                 font-size:11px;line-height:1">○</span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
            title="${escHtml(it.clientName)} — ${escHtml(it.templateName)}">
          <span style="font-weight:500">${escHtml(it.clientName)}</span>
          <span style="color:var(--c-border);margin:0 5px">·</span>
          <span style="color:var(--c-muted)">${escHtml(it.templateName)}</span>
        </span>
        <span id="dg-pi-tag-${i}"
          style="font-size:10px;flex-shrink:0;min-width:52px;text-align:right;
                 color:var(--c-muted)"></span>
      </div>`).join('');

    const _ST = {
      waiting: { ic:'○', icC:'var(--c-border)', bg:'transparent',          bdr:'transparent', tag:''          },
      active:  { ic:'▶', icC:'var(--c-blue)',   bg:'rgba(90,111,214,.09)', bdr:'var(--c-border)', tag:'generálás…' },
      done:    { ic:'✓', icC:'var(--c-green)',  bg:'transparent',          bdr:'transparent', tag:'kész'       },
      error:   { ic:'✕', icC:'var(--c-red)',    bg:'rgba(217,85,85,.06)', bdr:'transparent', tag:'hiba'       },
      saving:  { ic:'↑', icC:'var(--c-amber)',  bg:'rgba(194,120,34,.07)',bdr:'var(--c-border)', tag:'mentés…'    },
      pdf:     { ic:'⟳', icC:'var(--c-purple)', bg:'rgba(138,98,204,.07)',bdr:'var(--c-border)', tag:'PDF…'       },
    };

    function _apply(i, key) {
      const s = _ST[key] || _ST.waiting;
      const row = document.getElementById(`dg-pi-${i}`);
      const ic  = document.getElementById(`dg-pi-ic-${i}`);
      const tag = document.getElementById(`dg-pi-tag-${i}`);
      if (row) {
        row.style.background      = s.bg;
        row.style.borderTopColor  = s.bdr;
        row.style.borderBottomColor = s.bdr;
      }
      if (ic)  { ic.textContent = s.ic; ic.style.color = s.icC; }
      if (tag) { tag.textContent = s.tag; tag.style.color = s.icC; }
      items[i].status = key;
    }

    function _tick() {
      if (count) count.textContent = `${doneCount} / ${total}`;
    }

    return {
      setActive(i) {
        _apply(i, 'active');
        document.getElementById(`dg-pi-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      },
      setDone(i)   { _apply(i, 'done');  doneCount++; _tick(); },
      setError(i)  { _apply(i, 'error'); doneCount++; _tick(); },
      setSaving(i) { _apply(i, 'saving'); },
      setPdf(i)    { _apply(i, 'pdf'); },
      setPhase(msg){ /* fázisváltás csak a státuszsávon jelenik meg */ },
      finish(errCount) {
        if (count) count.textContent = errCount
          ? `⚠ ${errCount} hiba · ${doneCount} kész`
          : `✓ ${doneCount} dokumentum kész`;
        // Statikus nézet visszaállítása 5 mp után
        setTimeout(() => _updateSummaryCard(), 5000);
      },
    };
  }

  function _nullProgress() {
    return { setActive(){}, setDone(){}, setError(){},
             setSaving(){}, setPdf(){}, setPhase(){}, finish(){} };
  }

  async function runGenerate({ docx, pdf }) {
    if (!state.selectedClients.length)   { toast('Nincs kiválasztott ügyfél', 'warn'); return; }
    if (!state.chosenTemplates.size)     { toast('Nincs kiválasztott sablon', 'warn'); return; }
    if (!state.templatesDir)             { toast('Nincs sablonmappa beállítva', 'warn'); return; }

    const clients   = state.clientRows.filter(r => state.selectedClients.includes(r.id));
    const templates = [...state.chosenTemplates];
    const total     = clients.length * templates.length;
    let done = 0;
    const errors = [], generated = [];
    const allEmptyTags      = new Set();   // összegyűjtött hiányzó mezők az összes dokumentumból
    const missingLogEntries = [];          // naplóba kerülő bejegyzések

    // ── Live progress az összesítő kártyán ───────────────────────────────────
    const progress = _openProgressDialog(clients, templates);

    // P3: részletes start-log
    BevLogger.info('DOCGEN_START', `Generálás indítva (${docx?'DOCX':''}${docx&&pdf?'+':''}${pdf?'PDF':''})`,
      BevLogger.snapshot({ clients: clients.length, templates: templates.length, total,
        outputDir: state.outputDir?.name || null,
        templatesDir: state.templatesDir?.name || null }),
      `user=${currentUser}, clients=[${clients.slice(0,5).map(employeeName).join('|')}${clients.length>5?'…':''}], templates=[${templates.slice(0,5).join('|')}${templates.length>5?'…':''}]`);

    setStatus('Generálás…', 0);
    setGenButtons(false);

    // P5: filename uniqueness tracker az egész batch-re
    const generatedNames = new Set();
    const suffixedCount = { v: 0 };

    try {
      for (let ti = 0; ti < templates.length; ti++) {
        const templateName = templates[ti];
        // P5: per-sablon név-minta lookup
        const np = DocgenNaming.getNamePattern(templateName);
        const pattern = np.pattern;
        const tmplBuf = await findTemplate(state.templatesDir, templateName + '.docx');
        if (!tmplBuf) {
          BevLogger.warn('TEMPLATE_MISSING', `Sablon nem található: ${templateName}`,
            `templateName=${templateName}, templatesDir=${state.templatesDir?.name}, allTemplates(${state.allTemplates.length})=[${state.allTemplates.slice(0,8).map(t=>t.name).join('|')}${state.allTemplates.length>8?'…':''}]`,
            state.templatesDir?.name || '');
          for (let ci = 0; ci < clients.length; ci++) {
            const itemIdx = ti * clients.length + ci;
            progress.setError(itemIdx);
            errors.push(`${employeeName(clients[ci])} / ${templateName}: sablon nem található`);
            done++;
          }
          setStatus(`Sablon hiányzik: ${templateName}`, Math.round(done / total * 100));
          await _yieldFrame();
          continue;
        }
        for (let ci = 0; ci < clients.length; ci++) {
          const row = clients[ci];
          const itemIdx = ti * clients.length + ci;
          const clientName = employeeName(row);
          const pct = Math.round(done / total * 100);
          progress.setActive(itemIdx);
          setStatus(`${clientName} / ${templateName}  (${done + 1}/${total})`, pct);
          await _yieldFrame();   // ← böngésző repaint engedélyezése ELŐTTE, hogy a státusz látszódjon
          try {
            const enrichedRow = buildRenderRow(row);
            const { buffer: outBuf, emptyTags } = await DocxService.generateDocx(
              tmplBuf, enrichedRow,
              { resolve: makeSchemaResolver(row), equals: makeSchemaMatcher(row) });
            emptyTags.forEach(t => allEmptyTags.add(t));
            if (emptyTags.length > 0) {
              missingLogEntries.push({
                ts:        new Date().toISOString(),
                user:      currentUser || '',
                client:    clientName,
                template:  templateName,
                emptyTags: emptyTags,
              });
            }
            const baseName = DocxService.outputFilename(templateName, enrichedRow, pattern);
            const name = DocxService.uniqueFilename(baseName, generatedNames);
            if (name !== baseName) {
              suffixedCount.v++;
              BevLogger.info('FILENAME_SUFFIX',
                `Filename ütközés — suffix hozzáadva: ${baseName} → ${name}`,
                `template=${templateName}, pattern=${pattern || '(default)'}`,
                `client=${clientName}, user=${currentUser}`);
            }
            progress.setDone(itemIdx);
            generated.push({ buf: outBuf, name, itemIdx, templateName, clientName });
            done++;
          } catch (e) {
            BevLogger.error('DOCGEN', `Generálási hiba: ${clientName} / ${templateName}`,
              `error=${e.message}\nstack=${e.stack || '(no stack)'}\nrowKeys=${Object.keys(row).slice(0,10).join(',')}`,
              `client=${clientName}, template=${templateName}, user=${currentUser}`);
            progress.setError(itemIdx);
            errors.push(`${clientName} / ${templateName}: ${e.message}`);
            done++;
          }
        }
      }

      DocgenMissingLog.append(missingLogEntries);

      // ── DOCX mentési fázis ────────────────────────────────────────────────────
      // writeToDir valódi async (File System API) → a setStatus itt ténylegesen
      // megjelenik a képernyőn, nincs szükség extra yieldre.
      progress.setPhase('DOCX fájlok mentése…');
      { let wi = 0;
        for (const { buf, name, itemIdx } of generated) {
          if (docx) {
            progress.setSaving(itemIdx);
            if (state.outputDir) {
              setStatus(`Mentés: ${name}`, Math.round(wi / generated.length * 100));
              try { await FsService.writeToDir(state.outputDir, name, buf); wi++; continue; } catch {}
            }
            saveAs(new Blob([buf], {
              type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            }), name);
          }
          wi++;
        }
      }

      // A PDF-fé alakítás szándékosan NEM része a generálásnak: böngészőből nem
      // lehet Wordöt vezérelni, szervert pedig nem telepíthetünk. Az app itt
      // befejezi a dolgát – helyes nevű DOCX-ek vannak a kimeneti mappában –,
      // a konverziót a tools/docx-pdf.vbs végzi (Word COM, teljes hűséggel).
      //
      // Ezt jegyezzük meg, hogy az összefűzés utólag megtalálja a PDF-eket:
      state.lastGenerated = generated.map(g => ({
        name: g.name, clientName: g.clientName, templateName: g.templateName,
      }));

      if (pdf && generated.length) {
        // Tartalék út, ha valakinél nem működik a .vbs: böngészős nyomtatás.
        openPrintSelectDialog(generated);
      }

      progress.finish(errors.length);

      setStatus(errors.length ? `Kész (${errors.length} hiba)` : '✓ Kész', 100);
      const rc = q('#dg-result-card');
      const rt = q('#dg-result-title');
      const ra = q('#dg-result-actions');
      if (rc && rt && ra) {
        rc.className = 'dg-result-card visible ' + (errors.length ? 'error' : 'success');
        rt.textContent = errors.length
          ? `Kész — ${errors.length} hiba, ${generated.length} dokumentum generálva`
          : `✓ ${generated.length} dokumentum sikeresen generálva`;
        if (errors.length) rc.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        ra.innerHTML = '';
        if (errors.length) {
          const errBtn = document.createElement('button');
          errBtn.className = 'btn btn-ghost btn-sm';
          errBtn.textContent = 'Hibák megtekintése';
          errBtn.addEventListener('click', () => {
            showDialog({
              title: 'Generálási hibák',
              body: `<ul style="margin:0;padding-left:18px">${errors.map(e => `<li>${escHtml(e)}</li>`).join('')}</ul>`,
              footer: `<button class="btn btn-ghost" onclick="closeDialog()">Bezárás</button>`,
            });
          });
          ra.appendChild(errBtn);
        }

        // ── Hiányzó adatok info panel (minden generálásnál frissül) ──────────
        const missingPanel = q('#dg-missing-panel');
        if (missingPanel) {
          if (allEmptyTags.size === 0) {
            missingPanel.innerHTML = `
              <div style="display:flex;align-items:center;gap:6px;margin-top:10px;
                  border-top:1px solid var(--c-border);padding-top:10px">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style="flex-shrink:0;color:var(--c-green)">
                  <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/>
                  <path d="M5 8l2 2 4-4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <span style="font-size:11px;color:var(--c-green);font-weight:600">
                  Minden mező átemelésre került
                </span>
              </div>`;
          } else {
            const sorted = [...allEmptyTags].sort();
            missingPanel.innerHTML = `
              <div style="margin-top:10px;border-top:1px solid var(--c-border);padding-top:10px">
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;cursor:pointer"
                     id="dg-missing-toggle">
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style="flex-shrink:0;color:var(--c-amber)">
                    <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/>
                    <path d="M8 5v3.5M8 10.5v.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                  </svg>
                  <span style="font-size:11px;font-weight:600;color:var(--c-amber)">
                    ${sorted.length} mező nem kerültek átemelésre (nem volt adat)
                  </span>
                  <span id="dg-missing-arrow" style="font-size:10px;color:var(--c-muted);margin-left:auto">▼</span>
                </div>
                <div id="dg-missing-list" style="font-size:11px;color:var(--c-muted);
                    display:flex;flex-wrap:wrap;gap:4px;padding-left:2px">
                  ${sorted.map(t =>
                    `<span style="background:var(--c-bg);border:1px solid var(--c-border);
                        border-radius:4px;padding:1px 6px">${escHtml(t)}</span>`
                  ).join('')}
                </div>
              </div>`;
            // Összecsukható panel
            const toggle = missingPanel.querySelector('#dg-missing-toggle');
            if (toggle) toggle.addEventListener('click', () => {
              const list  = missingPanel.querySelector('#dg-missing-list');
              const arrow = missingPanel.querySelector('#dg-missing-arrow');
              const open  = list.style.display !== 'none';
              list.style.display = open ? 'none' : 'flex';
              arrow.textContent  = open ? '▶' : '▼';
            });
          }
        }
      } else if (!errors.length) {
        toast(`✓ ${generated.length} dokumentum generálva`, 'success');
      }

      // P3: részletes end-log
      BevLogger.info('DOCGEN_END',
        errors.length ? `Generálás kész (${errors.length} hiba, ${generated.length} dokumentum)`
                      : `Generálás sikeresen kész (${generated.length} dokumentum)`,
        `errors=${errors.length}, generated=${generated.length}, missingFields=${allEmptyTags.size}, missingLogEntries=${missingLogEntries.length}, suffixedFiles=${suffixedCount.v}`,
        `user=${currentUser}`);
      if (suffixedCount.v > 0) {
        toast(`${suffixedCount.v} fájl kapott (n) suffix-et név-ütközés miatt`, 'warn');
      }
    } finally {
      updateGenButtons();
    }
  }

  // Sablon keresése: fiókalmappa → rekurzív keresés
  async function findTemplate(dirHandle, filename) {
    const accountDir = await FsService.getSubDir(dirHandle, currentUser);
    return _findFileRecursive(accountDir || dirHandle, filename);
  }

  // PDF nyomtatás-választó dialóg.
  // A DOCX-ek ilyenkor már elkészültek a kimeneti mappában – ez csak a PDF-be
  // mentés kényelmi útja böngészőből. A pontos tördelést igénylő iratoknál a
  // Wordből mentett PDF a megbízható út (lásd a 9. fázis konverziós sávjait).
  function openPrintSelectDialog(generated) {
    showDialog({
      title: 'PDF mentése nyomtatással',
      body: `
        <p style="font-size:12.5px;margin-bottom:10px">
          A DOCX-fájlok elkészültek. PDF-hez válaszd ki a dokumentumot, majd a
          megnyíló lapon a nyomtatási párbeszédben válaszd a <b>„Mentés PDF-ként”</b>
          célt.
        </p>
        <p style="font-size:12px;color:var(--c-muted);margin-bottom:10px">
          Pontos tördelést igénylő iratnál inkább nyisd meg a DOCX-et Wordben, és
          onnan mentsd PDF-be – a böngészős nyomtatás a fejlécet, láblécet és a
          képek elhelyezését nem adja vissza pontosan.
        </p>
        <div class="checklist-scroll" style="max-height:200px">
          ${generated.map((g, i) => `
            <button class="btn btn-ghost" style="width:100%;text-align:left;margin-bottom:4px;font-size:12px"
              data-print-idx="${i}">${escHtml(g.name.replace('.docx',''))}</button>
          `).join('')}
        </div>
      `,
      footer: `<button class="btn btn-ghost btn-sm" onclick="closeDialog()">Bezárás</button>`,
    });
    document.querySelectorAll('[data-print-idx]').forEach(btn => {
      btn.addEventListener('click', () => {
        _openPrint(generated[Number(btn.dataset.printIdx)]);
        closeDialog();
      });
    });
  }

  function _openPrint({ buf, name }) {
    const b64 = uint8ToBase64(buf);
    sessionStorage.setItem('docgen_print_data',
      JSON.stringify({ b64, filename: name.replace('.docx', '.pdf') }));
    window.open('print.html', '_blank');
  }

  async function _findFileRecursive(dirHandle, filename) {
    for await (const [name, entry] of dirHandle.entries()) {
      if (entry.kind === 'file' && name === filename) {
        try { return await FsService.readFromDir(dirHandle, filename); } catch {}
      } else if (entry.kind === 'directory') {
        try {
          const result = await _findFileRecursive(entry, filename);
          if (result) return result;
        } catch {}
      }
    }
    return null;
  }

  return {
    init,
    // A sablonokba kerülő értékkészlet és a jelölő-feloldó: előnézethez és
    // ellenőrzéshez kívülről is használható.
    buildRenderRow,
    makeSchemaResolver,
  };
})();
