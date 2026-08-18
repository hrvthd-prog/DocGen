/* ──────────────────────────────────────────────────────────────
   ClientPicker — Excel-stílusú szűrhető táblázat, multi-select.

   Önálló komponens, nincs függősége. Egyetlen entry-point:

     ClientPicker.open({
       rows:           [{...}, ...],     // ügyfél-objektumok
       columns:        ['Col A', ...],   // opc. — autodetect az 1. sorból
       columnTypes:    { col: 'text|number|date|category' }, // opc. — autodetect
       visibleColumns: [...],            // opc. — alapból első 6
       selected:       [rowKey, ...],    // előre kijelölt rowKey-k
       rowKey:         row => '...',     // opc. — egyedi azonosító (alapból JSON)
       storageKey:     'beva-docgen',    // mentett nézetek + oszlopok ns
       title:          'Ügyfelek kiválasztása',
       onSave:         (selectedRows, selectedKeys) => {...},
       onCancel:       () => {...},
     });

   A komponens DOM-ot épít a <body>-ba, és bezáráskor eltakarítja.
   ────────────────────────────────────────────────────────────── */
'use strict';

(function (global) {

  // ── Public API ────────────────────────────────────────────
  const ClientPicker = {
    open(opts) { return new Picker(opts).mount(); },

    /**
     * Beágyazott tábla — ugyanaz a komponens, csak nem modal.
     *
     *   ClientPicker.inline({
     *     container,                     // ide kerül a tábla (a tartalmát felülírja)
     *     rows, columns, rowKey, storageKey,
     *     search: false,                 // opc. — sajat keresőmező elrejtése
     *     onSelectionChange: (keys, rows) => {},
     *   })  ->  picker  (`.setRows(rows)` újratölt, a kijelölést kulcs szerint megtartva)
     */
    inline(opts) { return new Picker(Object.assign({}, opts, { inline: true })).mount(); },
  };

  // ── Picker instance ───────────────────────────────────────
  function Picker(opts) {
    this.opts = opts || {};
    this.inline = !!this.opts.inline;
    const rows = this.opts.rows || [];

    // Columns: ha nincs megadva, autodetect az első néhány sor kulcsaiból
    let columns = this.opts.columns;
    if (!columns || !columns.length) {
      const colSet = new Set();
      for (const r of rows.slice(0, 50)) Object.keys(r).forEach(k => colSet.add(k));
      columns = [...colSet];
    }
    this.columns = columns;

    // Column types: autodetect, ha nincs megadva
    this.columnTypes = Object.assign(
      autoDetectTypes(rows, columns),
      this.opts.columnTypes || {}
    );

    // RowKey funkció
    this.rowKey = this.opts.rowKey || (row => JSON.stringify(row));
    this.rowKeys = rows.map(this.rowKey);

    // Storage key (project-namespace)
    this.storageKey = this.opts.storageKey || 'client-picker';

    // Persistalt user-beállítások betöltése
    const ui = loadUI(this.storageKey);

    // Visible columns prioritás: paraméter > localStorage > első 6
    const initialVisible =
      (this.opts.visibleColumns && this.opts.visibleColumns.filter(c => columns.includes(c))) ||
      (ui.visibleColumns && ui.visibleColumns.filter(c => columns.includes(c))) ||
      columns.slice(0, 6);

    // Initial selection: rowKey-kbál index-Set
    const initialSelected = new Set();
    if (this.opts.selected && this.opts.selected.length) {
      const wanted = new Set(this.opts.selected);
      this.rowKeys.forEach((k, i) => { if (wanted.has(k)) initialSelected.add(i); });
    }

    this.rows = rows;
    this.state = {
      visibleCols: initialVisible,
      selected:    initialSelected,
      sort:        { col: null, dir: 'asc' },
      filters:     {},
      quickSearch: '',
      showOnlySelected: false,
      cursorIdx:   null,
      savedViews:  loadViews(this.storageKey),
    };

    // El nem mentett "ablakméretek" — oszlopszélességek
    this.colWidths = ui.colWidths || {};

    // Belső refek
    this._lastFiltered = [];
    this._openedPopup = null;
    this._resizing = null;
    this._destroyed = false;

    // Bound listeners
    this._onKey = this._onKey.bind(this);
    this._onDocClickClose = this._onDocClickClose.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
  }

  // ── DOM Mount ─────────────────────────────────────────────
  Picker.prototype.mount = function () {
    const overlay = document.createElement('div');
    overlay.className = this.inline ? 'cp-inline cp-root' : 'cp-overlay cp-root';
    overlay.innerHTML = buildShellHTML(this.opts.title || 'Ügyfelek kiválasztása', this.opts);
    if (this.inline) {
      this.opts.container.innerHTML = '';
      this.opts.container.appendChild(overlay);
    } else {
      document.body.appendChild(overlay);
    }
    this._overlay = overlay;
    this._dialog  = overlay.querySelector('.cp-dialog');

    // DOM refek
    this.el = {
      search:    overlay.querySelector('.cp-search input'),
      thead:     overlay.querySelector('.cp-thead'),
      tbody:     overlay.querySelector('.cp-tbody'),
      filterbar: overlay.querySelector('.cp-filterbar'),
      footer:    overlay.querySelector('.cp-footer-stats'),
      colsBtn:   overlay.querySelector('[data-act="cols"]'),
      viewsBtn:  overlay.querySelector('[data-act="views"]'),
      helpBtn:   overlay.querySelector('[data-act="help"]'),
      clearBtn:  overlay.querySelector('[data-act="clear"]'),
      onlySelBtn:overlay.querySelector('[data-act="onlysel"]'),
      closeBtn:  overlay.querySelector('[data-act="close"]'),
      cancelBtn: overlay.querySelector('[data-act="cancel"]'),
      saveBtn:   overlay.querySelector('[data-act="save"]'),
    };

    this._wireEvents();
    this._render();

    // Fókusz — inline tábla nem rabolja el a fókuszt az oldaltól
    if (!this.inline && this.el.search) setTimeout(() => this.el.search.focus(), 60);
    return this;
  };

  /**
   * Új adathalmaz ugyanabba a táblába (inline használathoz).
   * A kijelölés kulcs szerint marad meg, nem sorindex szerint — szűrés vagy
   * törlés után az indexek elállnak, a kulcs viszont ugyanaz.
   */
  Picker.prototype.setRows = function (rows) {
    const eddig = new Set([...this.state.selected].map(i => this.rowKeys[i]));
    this.rows    = rows;
    this.rowKeys = rows.map(this.rowKey);
    this.state.selected  = new Set();
    this.rowKeys.forEach((k, i) => { if (eddig.has(k)) this.state.selected.add(i); });
    this.state.cursorIdx = null;
    this._render();
    return this;
  };

  /** A kijelölt sorok kulcsai (inline használathoz). */
  Picker.prototype.selectedKeys = function () {
    return [...this.state.selected].map(i => this.rowKeys[i]);
  };

  Picker.prototype.clearSelection = function () {
    this.state.selected = new Set();
    this._render();
  };

  Picker.prototype.destroy = function () {
    if (this._destroyed) return;
    this._destroyed = true;
    this._closePopup();
    document.removeEventListener('keydown', this._onKey);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mouseup', this._onMouseUp);
    if (this._overlay) this._overlay.remove();
  };

  // ── Eseménykötés ──────────────────────────────────────────
  Picker.prototype._wireEvents = function () {
    const e = this.el;

    // Bezárás — inline módban nincs fejléc és nincs Mentés/Mégse
    e.closeBtn?.addEventListener('click',  () => this._cancel());
    e.cancelBtn?.addEventListener('click', () => this._cancel());
    e.saveBtn?.addEventListener('click',   () => this._save());

    // Overlay-kattintásra ne záruljon — csak Esc / X / Mégse.

    // Toolbar
    e.search?.addEventListener('input', () => { this.state.quickSearch = e.search.value; this._render(); });
    e.clearBtn.addEventListener('click', () => {
      this.state.filters = {}; this.state.sort = { col: null, dir: 'asc' };
      this.state.quickSearch = '';
      if (e.search) e.search.value = '';
      this._render();
    });
    e.onlySelBtn.addEventListener('click', () => {
      this.state.showOnlySelected = !this.state.showOnlySelected;
      this._render();
    });
    e.colsBtn.addEventListener('click',  () => this._openColsPopup());
    e.viewsBtn.addEventListener('click', () => this._openViewsPopup());
    e.helpBtn.addEventListener('click',  () => this._openHelpPopup());

    // Tábla
    e.tbody.addEventListener('click', this._onBodyClick.bind(this));
    e.thead.addEventListener('click', this._onHeadClick.bind(this));
    e.thead.addEventListener('mousedown', this._onHeadMouseDown.bind(this));
    e.filterbar.addEventListener('click', this._onFilterbarClick.bind(this));
    e.footer.addEventListener('click', this._onFooterClick.bind(this));

    // Global
    document.addEventListener('keydown', this._onKey);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mouseup', this._onMouseUp);
  };

  // ── Mentés / Mégse ────────────────────────────────────────
  Picker.prototype._save = function () {
    const idx = [...this.state.selected];
    const keys = idx.map(i => this.rowKeys[i]);
    const rows = idx.map(i => this.rows[i]);
    this._persistUI();
    this.destroy();
    if (this.opts.onSave) this.opts.onSave(rows, keys);
  };
  Picker.prototype._cancel = function () {
    this._persistUI(); // oszlopláthatóság és szélesség megmarad
    this.destroy();
    if (this.opts.onCancel) this.opts.onCancel();
  };
  Picker.prototype._persistUI = function () {
    saveUI(this.storageKey, {
      visibleColumns: this.state.visibleCols,
      colWidths: this.colWidths,
    });
  };

  // ── Filter + sort ─────────────────────────────────────────
  Picker.prototype._filteredIndexes = function () {
    const q = this.state.quickSearch.trim().toLowerCase();
    const rows = this.rows;
    const out = [];
    const fcols = Object.keys(this.state.filters);
    for (let i = 0; i < rows.length; i++) {
      if (this.state.showOnlySelected && !this.state.selected.has(i)) continue;
      const row = rows[i];
      if (q) {
        let hit = false;
        for (const col of this.state.visibleCols) {
          if (String(row[col] ?? '').toLowerCase().includes(q)) { hit = true; break; }
        }
        if (!hit) continue;
      }
      let ok = true;
      for (const col of fcols) {
        const f = this.state.filters[col];
        const v = row[col];
        if (f.values && f.values.size && !f.values.has(String(v ?? ''))) { ok = false; break; }
        if (f.op) {
          const isNum = this.columnTypes[col] === 'number';
          if (isNum) {
            const nv = Number(v), nf = Number(f.val);
            if (!opNum(f.op, nv, nf)) { ok = false; break; }
          } else {
            const sv = String(v ?? '').toLowerCase();
            const fv = String(f.val ?? '').toLowerCase();
            if (!opStr(f.op, sv, fv)) { ok = false; break; }
          }
        }
      }
      if (ok) out.push(i);
    }
    if (this.state.sort.col) {
      const col = this.state.sort.col;
      const dir = this.state.sort.dir === 'asc' ? 1 : -1;
      const isNum = this.columnTypes[col] === 'number';
      out.sort((a, b) => {
        const va = rows[a][col], vb = rows[b][col];
        if (isNum) return ((+va || 0) - (+vb || 0)) * dir;
        return String(va ?? '').localeCompare(String(vb ?? ''), 'hu') * dir;
      });
    }
    return out;
  };

  // ── Render ────────────────────────────────────────────────
  Picker.prototype._render = function () {
    this._lastFiltered = this._filteredIndexes();
    this._renderHead();
    this._renderBody(this._lastFiltered);
    this._renderFilterBar();
    this._renderFooter(this._lastFiltered);
    this.el.onlySelBtn.classList.toggle('active', this.state.showOnlySelected);
    if (this.opts.onSelectionChange) {
      const idx = [...this.state.selected];
      this.opts.onSelectionChange(idx.map(i => this.rowKeys[i]), idx.map(i => this.rows[i]));
    }
  };

  Picker.prototype._renderHead = function () {
    const st = this.state;
    const cells = st.visibleCols.map(col => {
      const isSorted = st.sort.col === col;
      const sortIcon = !isSorted ? svgSortIdle()
        : st.sort.dir === 'asc' ? svgSortAsc() : svgSortDesc();
      const hasFilter = !!st.filters[col];
      const w = this.colWidths[col];
      return `
        <th data-col="${esc(col)}" style="position:relative${w ? ';width:'+w+'px' : ''}">
          <div class="cp-th-inner ${hasFilter ? 'cp-has-filter' : ''}" data-col="${esc(col)}">
            <span class="cp-th-label" title="${esc(col)}">${esc(col)}</span>
            <span class="cp-th-sort ${isSorted ? 'cp-active' : ''}">${sortIcon}</span>
            <span class="cp-th-filter ${hasFilter ? 'cp-active' : ''}">${svgFilter()}</span>
          </div>
          <div class="cp-th-resize" data-col="${esc(col)}"></div>
        </th>
      `;
    }).join('');
    const filt = this._lastFiltered;
    const allChecked  = filt.length > 0 && filt.every(i => st.selected.has(i));
    const someChecked = filt.some(i => st.selected.has(i));
    this.el.thead.innerHTML = `
      <tr>
        <th class="cp-col-check"><input type="checkbox" class="cp-head-check" ${allChecked ? 'checked' : ''}></th>
        <th class="cp-col-num">#</th>
        ${cells}
      </tr>
    `;
    const hc = this.el.thead.querySelector('.cp-head-check');
    if (hc) hc.indeterminate = !allChecked && someChecked;
  };

  Picker.prototype._renderBody = function (indexes) {
    if (!indexes.length) {
      this.el.tbody.innerHTML = `
        <tr><td colspan="${this.state.visibleCols.length + 2}">
          <div class="cp-empty">
            <div class="cp-empty-title">Nincs találat</div>
            <div class="cp-empty-sub">Módosíts a szűrőkön vagy a keresőn.</div>
          </div>
        </td></tr>`;
      return;
    }
    const st = this.state, rows = this.rows, cols = st.visibleCols, types = this.columnTypes;
    let html = '';
    for (let r = 0; r < indexes.length; r++) {
      const i = indexes[r];
      const row = rows[i];
      const sel = st.selected.has(i);
      const cur = st.cursorIdx === i;
      let cells = '';
      for (const col of cols) {
        const raw = row[col];
        const fmted = fmtVal(raw, types[col]);
        cells += `<td title="${esc(fmted)}">${esc(fmted)}</td>`;
      }
      html += `<tr data-i="${i}" class="${sel ? 'cp-selected ' : ''}${cur ? 'cp-cursor' : ''}${
          this.opts.rowClass ? ' ' + this.opts.rowClass(row) : ''}">
        <td class="cp-col-check"><input type="checkbox" ${sel ? 'checked' : ''}></td>
        <td class="cp-col-num">${r + 1}</td>
        ${cells}
      </tr>`;
    }
    this.el.tbody.innerHTML = html;
  };

  Picker.prototype._renderFilterBar = function () {
    const st = this.state;
    const chips = [];
    for (const col in st.filters) {
      const f = st.filters[col];
      const parts = [];
      if (f.values && f.values.size) {
        if (f.values.size <= 2) parts.push([...f.values].join(', '));
        else parts.push(`${f.values.size} érték`);
      }
      if (f.op) {
        const opLabel = { contains:'tart.', startsWith:'kezd.', endsWith:'végz.',
          equals:'=', notEquals:'≠', notContains:'nem tart.',
          '=':'=','>':'>','<':'<','>=':'≥','<=':'≤','!=':'≠' }[f.op] || f.op;
        parts.push(`${opLabel} ${f.val}`);
      }
      chips.push(`
        <span class="cp-chip"><b>${esc(col)}</b> · ${esc(parts.join(' · '))}
          <button class="cp-chip-x" data-rmcol="${esc(col)}" title="Szűrő eltávolítása">×</button>
        </span>`);
    }
    if (st.sort.col) {
      chips.push(`
        <span class="cp-chip" style="border-color:var(--cp-amber)">
          <b style="color:var(--cp-amber)">Rendezve</b> · ${esc(st.sort.col)} ${st.sort.dir === 'asc' ? '↑' : '↓'}
          <button class="cp-chip-x" data-rmsort="1" title="Rendezés törlése">×</button>
        </span>`);
    }
    if (!chips.length) {
      this.el.filterbar.classList.add('cp-hidden');
      this.el.filterbar.innerHTML = '';
      return;
    }
    this.el.filterbar.classList.remove('cp-hidden');
    this.el.filterbar.innerHTML =
      `<span class="cp-filterbar-label">Aktív szűrők</span>` +
      chips.join('') +
      `<button class="cp-chip-clear" data-act="filter-clear">Mind törlése</button>`;
  };

  Picker.prototype._renderFooter = function (indexes) {
    const st = this.state;
    this.el.footer.innerHTML = `
      <span class="cp-footer-stat cp-clickable ${st.showOnlySelected ? 'cp-active' : ''}" data-act="stat-sel">
        <b>${st.selected.size}</b> kijelölve
      </span>
      <span class="cp-footer-stat">·</span>
      <span class="cp-footer-stat"><b>${indexes.length}</b> látszik</span>
      <span class="cp-footer-stat">·</span>
      <span class="cp-footer-stat"><b>${this.rows.length}</b> összes</span>
    `;
  };

  // ── Tábla események ───────────────────────────────────────
  Picker.prototype._onBodyClick = function (e) {
    const tr = e.target.closest('tr[data-i]');
    if (!tr) return;
    const i = Number(tr.dataset.i);
    if (e.shiftKey && this.state.cursorIdx != null) {
      this._rangeSelect(this.state.cursorIdx, i, true);
    } else {
      this._toggle(i);
    }
    this.state.cursorIdx = i;
    this._render();
  };

  Picker.prototype._onHeadClick = function (e) {
    if (e.target.closest('.cp-th-resize')) return;
    const headCheck = e.target.closest('.cp-head-check');
    if (headCheck) {
      const want = headCheck.checked;
      for (const i of this._lastFiltered) {
        if (want) this.state.selected.add(i); else this.state.selected.delete(i);
      }
      this._render(); return;
    }
    const filterIcon = e.target.closest('.cp-th-filter');
    const sortIcon = e.target.closest('.cp-th-sort');
    const inner = e.target.closest('.cp-th-inner');
    if (!inner) return;
    const col = inner.dataset.col;
    if (filterIcon || (!sortIcon && !filterIcon)) {
      this._openFilterPopup(col, inner);
    } else if (sortIcon) {
      this._cycleSort(col);
      this._render();
    }
  };

  Picker.prototype._onHeadMouseDown = function (e) {
    const h = e.target.closest('.cp-th-resize');
    if (!h) return;
    e.preventDefault();
    const th = h.parentElement;
    this._resizing = { th, col: h.dataset.col, startX: e.clientX, startW: th.offsetWidth, handle: h };
    h.classList.add('cp-dragging');
  };

  Picker.prototype._onMouseMove = function (e) {
    if (!this._resizing) return;
    const w = Math.max(50, this._resizing.startW + (e.clientX - this._resizing.startX));
    this._resizing.th.style.width = w + 'px';
    this.colWidths[this._resizing.col] = w;
  };

  Picker.prototype._onMouseUp = function () {
    if (this._resizing) {
      this._resizing.handle.classList.remove('cp-dragging');
      this._resizing = null;
    }
  };

  Picker.prototype._onFilterbarClick = function (e) {
    const rm = e.target.closest('[data-rmcol]');
    if (rm) { delete this.state.filters[rm.dataset.rmcol]; this._render(); return; }
    if (e.target.closest('[data-rmsort]')) { this.state.sort = { col: null, dir: 'asc' }; this._render(); return; }
    if (e.target.matches('[data-act="filter-clear"]')) {
      this.state.filters = {}; this.state.sort = { col: null, dir: 'asc' }; this._render();
    }
  };

  Picker.prototype._onFooterClick = function (e) {
    if (e.target.closest('[data-act="stat-sel"]')) {
      this.state.showOnlySelected = !this.state.showOnlySelected;
      this._render();
    }
  };

  Picker.prototype._cycleSort = function (col) {
    const s = this.state.sort;
    if (s.col !== col) this.state.sort = { col, dir: 'asc' };
    else if (s.dir === 'asc') this.state.sort = { col, dir: 'desc' };
    else this.state.sort = { col: null, dir: 'asc' };
  };
  Picker.prototype._toggle = function (i) {
    if (this.state.selected.has(i)) this.state.selected.delete(i);
    else this.state.selected.add(i);
  };
  Picker.prototype._rangeSelect = function (fromIdx, toIdx, want) {
    const fr = this._lastFiltered.indexOf(fromIdx);
    const tr = this._lastFiltered.indexOf(toIdx);
    if (fr < 0 || tr < 0) { this._toggle(toIdx); return; }
    const [a, b] = fr < tr ? [fr, tr] : [tr, fr];
    for (let k = a; k <= b; k++) {
      const idx = this._lastFiltered[k];
      if (want) this.state.selected.add(idx); else this.state.selected.delete(idx);
    }
  };

  // ── Popups ────────────────────────────────────────────────
  Picker.prototype._closePopup = function () {
    if (this._openedPopup) { this._openedPopup.remove(); this._openedPopup = null; }
    document.removeEventListener('click', this._onDocClickClose, true);
  };
  Picker.prototype._onDocClickClose = function (e) {
    if (!this._openedPopup) return;
    if (this._openedPopup.contains(e.target)) return;
    if (e.target.closest('.cp-th-inner')) return;
    if (e.target.closest('[data-act]')) return;
    this._closePopup();
  };
  Picker.prototype._positionPopup = function (popup, anchor) {
    document.body.appendChild(popup);
    const a = anchor.getBoundingClientRect();
    const w = popup.offsetWidth, h = popup.offsetHeight;
    let left = a.left;
    let top = a.bottom + 4;
    if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
    if (top + h > window.innerHeight - 8) top = a.top - h - 4;
    popup.style.left = Math.max(8, left) + 'px';
    popup.style.top  = Math.max(8, top)  + 'px';
  };

  Picker.prototype._openFilterPopup = function (col, anchor) {
    this._closePopup();
    const type = this.columnTypes[col] || 'text';
    const cur = this.state.filters[col] || {};
    const counts = new Map();
    for (const r of this.rows) {
      const v = String(r[col] ?? '');
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    const uniqVals = [...counts.keys()].sort((a, b) => a.localeCompare(b, 'hu'));
    const selected = cur.values ? new Set(cur.values) : new Set(uniqVals);
    const isNum = type === 'number';
    const opOptions = isNum
      ? [['=','='], ['!=','≠'], ['>','>'], ['>=','≥'], ['<','<'], ['<=','≤']]
      : [['contains','tartalmazza'], ['notContains','nem tartalmazza'],
         ['equals','egyenlő'], ['notEquals','nem egyenlő'],
         ['startsWith','-vel kezdődik'], ['endsWith','-re végződik']];

    const popup = document.createElement('div');
    popup.className = 'cp-popup cp-root';
    popup.innerHTML = `
      <div class="cp-popup-sec">
        <div class="cp-popup-sec-title">Rendezés</div>
        <div class="cp-popup-item" data-sort="asc">
          ${svgSortAsc()} <span>${isNum ? '0 → 9' : 'A → Z'}</span>
        </div>
        <div class="cp-popup-item" data-sort="desc">
          ${svgSortDesc()} <span>${isNum ? '9 → 0' : 'Z → A'}</span>
        </div>
      </div>
      <div class="cp-popup-sec">
        <div class="cp-popup-sec-title">Feltétel</div>
        <div class="cp-popup-filter-row">
          <select class="cp-popup-op">
            <option value="">— válassz —</option>
            ${opOptions.map(([v,l]) =>
              `<option value="${v}" ${cur.op === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
          <input class="cp-popup-val" type="${isNum ? 'number' : 'text'}"
            value="${cur.val != null ? esc(cur.val) : ''}" placeholder="${isNum ? '0' : 'érték'}">
        </div>
      </div>
      <div class="cp-popup-sec">
        <div class="cp-popup-sec-title">Értékek</div>
        <div class="cp-popup-value-search">
          <input type="text" placeholder="Keresés értékek közt…" class="cp-popup-vsearch">
        </div>
        <div class="cp-popup-values">
          <label class="cp-popup-vrow">
            <input type="checkbox" class="cp-popup-vall" ${selected.size === uniqVals.length ? 'checked' : ''}>
            <span class="cp-label"><b>(Mindenki)</b></span>
            <span class="cp-count">${uniqVals.length}</span>
          </label>
          ${uniqVals.map(v => `
            <label class="cp-popup-vrow" data-val="${esc(v)}">
              <input type="checkbox" ${selected.has(v) ? 'checked' : ''}>
              <span class="cp-label" title="${esc(v)}">${esc(v) || '<i style="color:var(--cp-muted)">(üres)</i>'}</span>
              <span class="cp-count">${counts.get(v)}</span>
            </label>
          `).join('')}
        </div>
      </div>
      <div class="cp-popup-actions">
        <button class="cp-popup-clear">Szűrő törlése</button>
        <button class="cp-popup-apply">Alkalmaz</button>
      </div>
    `;
    this._openedPopup = popup;
    this._positionPopup(popup, anchor);
    setTimeout(() => document.addEventListener('click', this._onDocClickClose, true), 0);

    popup.querySelectorAll('[data-sort]').forEach(el => {
      el.addEventListener('click', () => {
        this.state.sort = { col, dir: el.dataset.sort };
        this._closePopup(); this._render();
      });
    });
    const vSearch = popup.querySelector('.cp-popup-vsearch');
    vSearch.addEventListener('input', () => {
      const q = vSearch.value.toLowerCase();
      popup.querySelectorAll('.cp-popup-vrow[data-val]').forEach(r => {
        r.style.display = r.dataset.val.toLowerCase().includes(q) ? '' : 'none';
      });
    });
    const vAll = popup.querySelector('.cp-popup-vall');
    vAll.addEventListener('change', () => {
      popup.querySelectorAll('.cp-popup-vrow[data-val] input[type="checkbox"]').forEach(cb => {
        const row = cb.closest('.cp-popup-vrow');
        if (row.style.display !== 'none') cb.checked = vAll.checked;
      });
    });
    popup.querySelector('.cp-popup-apply').addEventListener('click', () => {
      const checked = [...popup.querySelectorAll('.cp-popup-vrow[data-val] input:checked')]
        .map(cb => cb.closest('.cp-popup-vrow').dataset.val);
      const op = popup.querySelector('.cp-popup-op').value;
      const val = popup.querySelector('.cp-popup-val').value;
      const f = {};
      if (checked.length && checked.length !== uniqVals.length) f.values = new Set(checked);
      if (op && val !== '') { f.op = op; f.val = val; }
      if (Object.keys(f).length) this.state.filters[col] = f;
      else delete this.state.filters[col];
      this._closePopup(); this._render();
    });
    popup.querySelector('.cp-popup-clear').addEventListener('click', () => {
      delete this.state.filters[col]; this._closePopup(); this._render();
    });
  };

  Picker.prototype._openColsPopup = function () {
    this._closePopup();
    const popup = document.createElement('div');
    popup.className = 'cp-popup cp-cols-popup cp-root';
    popup.innerHTML = `
      <div class="cp-popup-sec">
        <div class="cp-popup-sec-title">Látható oszlopok</div>
        <div class="cp-popup-value-search">
          <input type="text" placeholder="Keresés oszlopok közt…" class="cp-cols-search">
        </div>
        <div class="cp-popup-values">
          ${this.columns.map(c => `
            <label class="cp-popup-vrow" data-col="${esc(c)}">
              <input type="checkbox" ${this.state.visibleCols.includes(c) ? 'checked' : ''}>
              <span class="cp-label">${esc(c)}</span>
            </label>
          `).join('')}
        </div>
      </div>
      <div class="cp-popup-actions">
        <button class="cp-popup-clear" data-act="cols-clear">Mind kikapcsolása</button>
        <button class="cp-popup-apply" data-act="cols-apply">Alkalmaz</button>
      </div>
    `;
    this._openedPopup = popup;
    this._positionPopup(popup, this.el.colsBtn);
    setTimeout(() => document.addEventListener('click', this._onDocClickClose, true), 0);

    popup.querySelector('.cp-cols-search').addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      popup.querySelectorAll('.cp-popup-vrow').forEach(r => {
        r.style.display = r.dataset.col.toLowerCase().includes(q) ? '' : 'none';
      });
    });
    popup.querySelector('[data-act="cols-clear"]').addEventListener('click', () => {
      popup.querySelectorAll('.cp-popup-vrow input').forEach(cb => cb.checked = false);
    });
    popup.querySelector('[data-act="cols-apply"]').addEventListener('click', () => {
      const checked = [...popup.querySelectorAll('.cp-popup-vrow input:checked')]
        .map(cb => cb.closest('.cp-popup-vrow').dataset.col);
      this.state.visibleCols = this.columns.filter(c => checked.includes(c));
      this._persistUI();
      this._closePopup(); this._render();
    });
  };

  Picker.prototype._openViewsPopup = function () {
    this._closePopup();
    const popup = document.createElement('div');
    popup.className = 'cp-popup cp-views-popup cp-root';
    popup.innerHTML = `
      <div class="cp-popup-sec">
        <div class="cp-popup-sec-title">Mentett nézetek</div>
        ${this.state.savedViews.length ? this.state.savedViews.map((v, i) => `
          <div class="cp-popup-item" data-view-idx="${i}">
            <span class="cp-vname">${esc(v.name)}</span>
            <button class="cp-vdel" data-del="${i}" title="Törlés">×</button>
          </div>
        `).join('') : '<div style="padding:8px 12px;color:var(--cp-muted);font-size:11px">Még nincs mentett nézet</div>'}
      </div>
      <div class="cp-views-save">
        <input class="cp-view-name" placeholder="Új nézet neve…" maxlength="40">
        <button class="cp-view-save">Mentés</button>
      </div>
    `;
    this._openedPopup = popup;
    this._positionPopup(popup, this.el.viewsBtn);
    setTimeout(() => document.addEventListener('click', this._onDocClickClose, true), 0);

    popup.querySelectorAll('[data-view-idx]').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('[data-del]')) return;
        this._applyView(this.state.savedViews[Number(el.dataset.viewIdx)]);
        this._closePopup();
      });
    });
    popup.querySelectorAll('[data-del]').forEach(b => {
      b.addEventListener('click', e => {
        e.stopPropagation();
        this.state.savedViews.splice(Number(b.dataset.del), 1);
        saveViews(this.storageKey, this.state.savedViews);
        this._closePopup(); this._openViewsPopup();
      });
    });
    const nameEl = popup.querySelector('.cp-view-name');
    const saveBtn = popup.querySelector('.cp-view-save');
    const doSave = () => {
      const name = nameEl.value.trim();
      if (!name) return;
      this.state.savedViews.push({
        name,
        visibleCols: [...this.state.visibleCols],
        sort: { ...this.state.sort },
        filters: serializeFilters(this.state.filters),
      });
      saveViews(this.storageKey, this.state.savedViews);
      this._closePopup(); this._openViewsPopup();
    };
    saveBtn.addEventListener('click', doSave);
    nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') doSave(); });
    setTimeout(() => nameEl.focus(), 50);
  };

  Picker.prototype._openHelpPopup = function () {
    this._closePopup();
    const items = [
      ['Gyorskereső fókusz',         'Ctrl + F'],
      ['Összes szűrt sor kijelölése','Ctrl + A'],
      ['Kijelölés invertálása',      'Ctrl + I'],
      ['Aktuális sor toggle',        'Space'],
      ['Tartomány-kijelölés',        'Shift + Click'],
      ['Sor fel/le navigáció',       '↑ ↓'],
      ['Mentés',                     'Enter'],
      ['Bezárás / popup elvet',      'Esc'],
    ];
    const popup = document.createElement('div');
    popup.className = 'cp-popup cp-help-popup cp-root';
    popup.innerHTML = `
      <div class="cp-popup-sec">
        <div class="cp-popup-sec-title">Billentyűparancsok</div>
        ${items.map(([d,k]) => `
          <div class="cp-help-row"><span class="cp-desc">${esc(d)}</span><kbd>${esc(k)}</kbd></div>
        `).join('')}
      </div>
    `;
    this._openedPopup = popup;
    this._positionPopup(popup, this.el.helpBtn);
    setTimeout(() => document.addEventListener('click', this._onDocClickClose, true), 0);
  };

  Picker.prototype._applyView = function (v) {
    this.state.visibleCols = [...v.visibleCols];
    this.state.sort = { ...v.sort };
    this.state.filters = deserializeFilters(v.filters);
    this._render();
  };

  // ── Keyboard ──────────────────────────────────────────────
  Picker.prototype._onKey = function (e) {
    if (this._destroyed) return;
    // Inline módban a tábla csak egy elem az oldalon: a billentyűk csak akkor
    // az övéi, ha a fókusz benne van. Különben az Esc/Enter/Space az egész app
    // többi feltületét is eltérítené.
    if (this.inline && !this._overlay.contains(e.target)) return;
    if (e.key === 'Escape') {
      if (this._openedPopup) { this._closePopup(); return; }
      if (!this.inline) this._cancel();
      return;
    }
    const inField = e.target.matches('input, select, textarea');
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && this.el.search) {
      e.preventDefault();
      this.el.search.focus(); this.el.search.select();
      return;
    }
    if (e.key === 'Enter' && !inField) {
      if (this.inline) return;
      e.preventDefault(); this._save(); return;
    }
    if (inField) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      this._lastFiltered.forEach(i => this.state.selected.add(i));
      this._render(); return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      this._lastFiltered.forEach(i => {
        if (this.state.selected.has(i)) this.state.selected.delete(i);
        else this.state.selected.add(i);
      });
      this._render(); return;
    }
    if (e.key === ' ' && this.state.cursorIdx != null) {
      e.preventDefault();
      this._toggle(this.state.cursorIdx); this._render(); return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const cur = this.state.cursorIdx == null ? -1 : this._lastFiltered.indexOf(this.state.cursorIdx);
      const next = e.key === 'ArrowDown' ? cur + 1 : cur - 1;
      if (next >= 0 && next < this._lastFiltered.length) {
        this.state.cursorIdx = this._lastFiltered[next];
        if (e.shiftKey) this.state.selected.add(this.state.cursorIdx);
        this._render();
        const tr = this.el.tbody.querySelector(`tr[data-i="${this.state.cursorIdx}"]`);
        if (tr) tr.scrollIntoView({ block: 'nearest' });
      }
    }
  };

  // ─── Shell HTML ───────────────────────────────────────────
  function buildShellHTML(title, opts) {
    const inline = !!(opts && opts.inline);
    const fejlec = inline ? '' : `
        <div class="cp-header">
          <div class="cp-header-title">${esc(title)}</div>
          <div class="cp-header-spacer"></div>
          <button class="cp-icon-btn" data-act="close" title="Bezárás (Esc)">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
        </div>`;
    // A beágyazó felület gyakran hoz saját keresőt — két keresőmező egymás
    // mellett csak zavar, ezért kikapcsolható.
    const kereso = (opts && opts.search === false) ? '' : `
          <div class="cp-search">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.5"/>
              <path d="M11 11l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            <input type="text" placeholder="Keresés mindenben…">
            <kbd>Ctrl+F</kbd>
          </div>`;
    const mentes = inline ? '' : `
          <div class="cp-dialog-actions">
            <button class="cp-btn cp-btn-ghost" data-act="cancel">Mégse</button>
            <button class="cp-btn cp-btn-primary" data-act="save">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path d="M3 8l3.5 3.5L13 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              Kiválasztás
            </button>
          </div>`;
    return `
      <div class="cp-dialog"${inline ? '' : ' role="dialog" aria-modal="true"'}>
        ${fejlec}
        <div class="cp-toolbar">
          ${kereso}
          <button class="cp-tb-btn" data-act="cols">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="3" width="3" height="10" rx="1" stroke="currentColor" stroke-width="1.4"/>
              <rect x="6.5" y="3" width="3" height="10" rx="1" stroke="currentColor" stroke-width="1.4"/>
              <rect x="11" y="3" width="3" height="10" rx="1" stroke="currentColor" stroke-width="1.4"/>
            </svg>
            Oszlopok
          </button>
          <button class="cp-tb-btn" data-act="views">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M2 4h12M2 8h12M2 12h8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            </svg>
            Nézetek
          </button>
          <div class="cp-tb-sep"></div>
          <button class="cp-tb-btn" data-act="onlysel">Csak kijelölt</button>
          <button class="cp-tb-btn" data-act="clear">Szűrők törlése</button>
          <button class="cp-tb-btn" data-act="help" style="margin-left:auto" title="Billentyűparancsok">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/>
              <path d="M6 6c0-1.1.9-2 2-2s2 .9 2 2c0 1-1 1.3-1.5 1.8-.3.3-.5.6-.5 1.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
              <circle cx="8" cy="12" r=".8" fill="currentColor"/>
            </svg>
          </button>
        </div>
        <div class="cp-filterbar cp-hidden"></div>
        <div class="cp-table-wrap">
          <table class="cp-table">
            <thead class="cp-thead"></thead>
            <tbody class="cp-tbody"></tbody>
          </table>
        </div>
        <div class="cp-footer">
          <div class="cp-footer-stats"></div>
          <div class="cp-footer-spacer"></div>
          ${mentes}
        </div>
      </div>
    `;
  }

  // ─── Helpers ──────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function fmtVal(v, type) {
    if (v == null || v === '') return '';
    if (v instanceof Date) {
      const y = v.getFullYear();
      const m = String(v.getMonth() + 1).padStart(2, '0');
      const d = String(v.getDate()).padStart(2, '0');
      return `${y}.${m}.${d}`;
    }
    if (type === 'number') {
      const n = Number(v);
      return Number.isFinite(n) ? n.toLocaleString('hu-HU') : String(v);
    }
    return String(v);
  }
  function opNum(op, nv, nf) {
    if (Number.isNaN(nv) || Number.isNaN(nf)) return false;
    switch (op) {
      case '=':  return nv === nf;
      case '!=': return nv !== nf;
      case '>':  return nv >  nf;
      case '<':  return nv <  nf;
      case '>=': return nv >= nf;
      case '<=': return nv <= nf;
    }
    return true;
  }
  function opStr(op, sv, fv) {
    switch (op) {
      case 'contains':    return sv.includes(fv);
      case 'notContains': return !sv.includes(fv);
      case 'equals':      return sv === fv;
      case 'notEquals':   return sv !== fv;
      case 'startsWith':  return sv.startsWith(fv);
      case 'endsWith':    return sv.endsWith(fv);
    }
    return true;
  }
  function autoDetectTypes(rows, columns) {
    const out = {};
    const sample = rows.slice(0, 100);
    for (const col of columns) {
      let nNum = 0, nNonEmpty = 0, uniqVals = new Set();
      for (const r of sample) {
        const v = r[col];
        if (v == null || v === '') continue;
        nNonEmpty++;
        if (typeof v === 'number' || (!isNaN(parseFloat(v)) && isFinite(v))) nNum++;
        uniqVals.add(String(v));
      }
      if (nNonEmpty > 0 && nNum / nNonEmpty > 0.85) out[col] = 'number';
      else if (uniqVals.size <= Math.max(8, sample.length / 8)) out[col] = 'category';
      else out[col] = 'text';
    }
    return out;
  }
  function loadViews(ns) {
    try { return JSON.parse(localStorage.getItem('cp_views_' + ns) || '[]'); }
    catch { return []; }
  }
  function saveViews(ns, views) {
    localStorage.setItem('cp_views_' + ns, JSON.stringify(views));
  }
  function loadUI(ns) {
    try { return JSON.parse(localStorage.getItem('cp_ui_' + ns) || '{}'); }
    catch { return {}; }
  }
  function saveUI(ns, ui) {
    localStorage.setItem('cp_ui_' + ns, JSON.stringify(ui));
  }
  function serializeFilters(f) {
    const out = {};
    for (const k in f) { out[k] = { ...f[k] }; if (f[k].values) out[k].values = [...f[k].values]; }
    return out;
  }
  function deserializeFilters(f) {
    const out = {};
    for (const k in f) { out[k] = { ...f[k] }; if (f[k].values) out[k].values = new Set(f[k].values); }
    return out;
  }

  // ─── SVG ──────────────────────────────────────────────────
  function svgSortIdle() {
    return `<svg width="11" height="11" viewBox="0 0 16 16" fill="none">
      <path d="M5 4.5l3-3 3 3M5 11.5l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }
  function svgSortAsc() {
    return `<svg width="11" height="11" viewBox="0 0 16 16" fill="none">
      <path d="M8 14V2M3 7l5-5 5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }
  function svgSortDesc() {
    return `<svg width="11" height="11" viewBox="0 0 16 16" fill="none">
      <path d="M8 2v12M3 9l5 5 5-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }
  function svgFilter() {
    return `<svg width="11" height="11" viewBox="0 0 16 16" fill="none">
      <path d="M2 3h12l-4.5 5.5V14L6.5 12V8.5L2 3z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
    </svg>`;
  }

  global.ClientPicker = ClientPicker;

})(window);
