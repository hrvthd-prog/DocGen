'use strict';

/**
 * Sablon-csoportok és láthatóság kezelése.
 *
 * A csoportok a sablonmappa alkönyvtár-szerkezetét tükrözik, és szűrésre
 * szolgálnak a sablonlistában. A láthatóság-kezelő több felhasználós üzemre
 * készült: fiókonként korlátozható, ki melyik sablont látja.
 */
const DocgenGroups = (() => {

  const currentUser = Settings.currentUser();
  let ctx = null;
  function init(context) { ctx = context; }

  // ── Csoport-kezelő dialog ─────────────────────────────────────────────────
  const _groupCollapsed = {};

  function openGroupsDialog() { renderGroupsDialog(); }

  function renderGroupsDialog() {
    const groups    = ctx.state.templateGroups;
    const templates = [...new Set(ctx.state.allTemplates.map(t => t.name))];

    showDialog({
      title: `Sablon-csoportok — ${currentUser}`,
      body: `
        <div style="display:flex;flex-direction:column;gap:6px;max-height:520px;overflow-y:auto;padding-right:4px">
          ${groups.map((g, gi) => {
            const collapsed = !!_groupCollapsed[gi];
            return `
            <div class="card" style="padding:0;overflow:hidden;border:1px solid var(--c-border);border-radius:8px">
              <div style="display:flex;gap:6px;align-items:center;padding:8px 10px;
                background:var(--c-bg);border-bottom:${collapsed ? 'none' : '1px solid var(--c-border)'}">
                <button class="btn btn-ghost btn-sm grp-toggle" data-gi="${gi}"
                  style="width:22px;padding:0;font-size:12px;flex-shrink:0" title="${collapsed ? 'Kibontás' : 'Összecsukás'}">
                  ${collapsed ? '▶' : '▼'}
                </button>
                <input class="field-input" style="flex:1;font-size:12px" value="${escHtml(g.name)}"
                  id="gname-${gi}" placeholder="Csoport neve">
                <span style="font-size:10px;color:var(--c-muted);flex-shrink:0">${g.templates.length} sablon</span>
                <button class="btn btn-danger btn-sm" data-del="${gi}" style="flex-shrink:0">Törlés</button>
              </div>
              <div class="grp-body" data-gi="${gi}" style="display:${collapsed ? 'none' : 'flex'};flex-wrap:wrap;gap:4px;padding:8px 10px">
                ${templates.map(t => `
                  <label class="grp-tpl-item" draggable="true" data-tpl="${escHtml(t)}" data-gi="${gi}"
                    style="display:flex;align-items:center;gap:3px;font-size:11px;padding:2px 8px;
                    background:${g.templates.includes(t) ? 'var(--c-green)' : 'var(--c-bg)'};
                    color:${g.templates.includes(t) ? '#fff' : 'var(--c-text)'};
                    border:1px solid var(--c-border);border-radius:4px;cursor:grab;user-select:none">
                    <input type="checkbox" data-gi="${gi}" data-tpl="${escHtml(t)}"
                      ${g.templates.includes(t) ? 'checked' : ''}
                      style="accent-color:var(--c-green);cursor:pointer">
                    ${escHtml(t)}
                  </label>
                `).join('')}
                ${!templates.length ? '<span style="font-size:11px;color:var(--c-muted)">Töltsd be a sablonmappát először.</span>' : ''}
                <div class="grp-drop-zone" data-gi="${gi}"
                  style="width:100%;min-height:22px;border:2px dashed transparent;border-radius:6px;
                  display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--c-muted);
                  margin-top:2px;transition:border-color .15s">
                  Húzz ide sablont másik csoportból
                </div>
              </div>
            </div>`;
          }).join('')}
          ${!groups.length ? bevEmptyState('Még nincs csoport.', 'groups-empty') : ''}
          <button class="btn btn-teal btn-sm" id="dlg-add-group" style="margin-top:4px">+ Új csoport</button>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" onclick="closeDialog()">Mégse</button>
        <button class="btn btn-primary" id="dlg-save-groups">Mentés</button>
      `,
    });

    // Collapse/expand toggle
    document.querySelectorAll('.grp-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const gi = Number(btn.dataset.gi);
        _groupCollapsed[gi] = !_groupCollapsed[gi];
        renderGroupsDialog();
      });
    });

    // Checkbox live color update
    document.querySelectorAll('input[data-gi][data-tpl]').forEach(cb => {
      cb.addEventListener('change', () => {
        const lbl = cb.closest('label');
        if (!lbl) return;
        lbl.style.background = cb.checked ? 'var(--c-green)' : 'var(--c-bg)';
        lbl.style.color = cb.checked ? '#fff' : 'var(--c-text)';
      });
    });

    // Drag & drop sablonok csoportok között
    let _dragTpl = null, _dragSrcGi = null;
    document.querySelectorAll('.grp-tpl-item').forEach(lbl => {
      lbl.addEventListener('dragstart', e => {
        _dragTpl   = lbl.dataset.tpl;
        _dragSrcGi = Number(lbl.dataset.gi);
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => { lbl.style.opacity = '.4'; }, 0);
      });
      lbl.addEventListener('dragend', () => { lbl.style.opacity = ''; });
    });
    document.querySelectorAll('.grp-drop-zone').forEach(zone => {
      zone.addEventListener('dragover', e => {
        e.preventDefault();
        zone.style.borderColor = 'var(--c-green)';
      });
      zone.addEventListener('dragleave', () => { zone.style.borderColor = 'transparent'; });
      zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.style.borderColor = 'transparent';
        const tgtGi = Number(zone.dataset.gi);
        if (_dragTpl === null || tgtGi === _dragSrcGi) return;
        const src = ctx.state.templateGroups[_dragSrcGi];
        if (src) src.templates = src.templates.filter(t => t !== _dragTpl);
        const tgt = ctx.state.templateGroups[tgtGi];
        if (tgt && !tgt.templates.includes(_dragTpl)) tgt.templates.push(_dragTpl);
        _dragTpl = null; _dragSrcGi = null;
        renderGroupsDialog();
      });
    });

    document.getElementById('dlg-add-group').addEventListener('click', () => {
      const newGi = ctx.state.templateGroups.length;
      ctx.state.templateGroups.push({ name: 'Új csoport', templates: [] });
      _groupCollapsed[newGi] = false;
      renderGroupsDialog();
    });

    document.getElementById('dlg-save-groups').addEventListener('click', () => {
      const dlgEl = document.getElementById('dialog-overlay');
      ctx.state.templateGroups.forEach((g, gi) => {
        const nameEl = document.getElementById('gname-' + gi);
        if (nameEl) g.name = nameEl.value.trim() || g.name;
        g.templates = [...dlgEl.querySelectorAll(
          `input[type="checkbox"][data-gi="${gi}"][data-tpl]:checked`
        )].map(cb => cb.dataset.tpl);
      });
      ctx.saveSettings();
      ctx.rebuildGroupFilterBtns();
      closeDialog();
      toast('✓ Csoportok mentve', 'success');
    });

    document.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        const gi = Number(btn.dataset.del);
        ctx.state.templateGroups.splice(gi, 1);
        delete _groupCollapsed[gi];
        renderGroupsDialog();
      });
    });
  }

  // ── Sablon-láthatóság dialog ───────────────────────────────────────────────
  function openVisibilityDialog() {
    const allUsers = Settings.getAllUsers();
    const map      = Settings.getTemplateAccounts();
    const templates = [...new Set(ctx.state.allTemplates.map(t => t.name))];

    if (!templates.length) { toast('Töltsd be a sablonmappát először.', 'warn'); return; }

    showDialog({
      title: 'Sablon-hozzárendelés fiókokhoz',
      body: `
        <div style="font-size:12px;color:var(--c-muted);margin-bottom:12px">
          Ha egy sablon mellett <b>egy sem</b> van bejelölve, minden fiók látja.
          Ha legalább egy be van jelölve, csak a megjelölt fiók(ok) látják.
        </div>
        <div class="data-table-wrap" style="max-height:400px">
          <table class="data-table">
            <thead>
              <tr>
                <th style="min-width:160px">Sablon</th>
                ${allUsers.map(u => `<th style="white-space:normal;min-width:90px;font-size:10px">
                  ${escHtml(u)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${templates.map(t => {
                const accts = map[t] || [];
                return `<tr>
                  <td title="${escHtml(t)}">${escHtml(t)}</td>
                  ${allUsers.map(u => `
                    <td style="text-align:center">
                      <input type="checkbox" data-tpl="${escHtml(t)}" data-user="${escHtml(u)}"
                        ${accts.includes(u) ? 'checked' : ''}>
                    </td>
                  `).join('')}
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" onclick="closeDialog()">Mégse</button>
        <button class="btn btn-primary" id="dlg-save-vis">Mentés</button>
      `,
    });

    document.getElementById('dlg-save-vis').addEventListener('click', () => {
      const newMap = {};
      const dlgEl = document.getElementById('dialog-overlay');
      dlgEl.querySelectorAll('input[type="checkbox"][data-tpl][data-user]').forEach(cb => {
        const t = cb.dataset.tpl, u = cb.dataset.user;
        if (!newMap[t]) newMap[t] = [];
        if (cb.checked) newMap[t].push(u);
      });
      Settings.setTemplateAccounts(newMap);
      toast('✓ Láthatóság mentve', 'success');
      closeDialog();
      ctx.refreshTemplates();
    });
  }

  return { init, openGroupsDialog, openVisibilityDialog };
})();
