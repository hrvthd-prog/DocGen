'use strict';

/**
 * PDF összefűzés.
 *
 * A legenerált PDF-eket egyetlen fájlba fűzi – személyenként vagy sablononként.
 * Ez az egyetlen PDF-művelet, amihez nem kell külső eszköz: a pdf-lib
 * böngészőben is megbízhatóan összefűz már meglévő PDF-eket.
 *
 * Csak akkor tud dolgozni, ha a konverziós lépés adott PDF-eket – ezért a
 * kártya is elrejtőzik, amíg nincs beállított PDF-előállítás (9. fázis).
 */
const DocgenMerge = (() => {

  const currentUser = Settings.currentUser();
  const MERGE_NAMING_KEY = 'docgen_merge_naming_global';
  const MERGE_KEY = () => 'docgen_merge_u_' + (currentUser || '').replace(/[^a-zA-Z0-9]/g, '_');

  let ctx = null;
  function init(context) { ctx = context; }

  // ── PDF összefűzés helpers ────────────────────────────────────────────────

  function _saveMergeSettings() {
    Settings.set(MERGE_KEY(), {
      enabled:        ctx.state.mergeEnabled,
      mode:           ctx.state.mergeMode,
      mergeTemplates: ctx.state.mergeTemplates === null ? null : [...ctx.state.mergeTemplates],
    });
  }

  function _getMergeNaming() {
    return Settings.get(MERGE_NAMING_KEY, {
      perClient:   '[Vezetéknév] [Keresztnév] dokumentumcsomag',
      perTemplate: '[dokumentumtípus neve] [adatlap neve]',
    });
  }

  function _applyMergeName(pattern, tokens) {
    return pattern
      .replace(/\[([^\]]+)\]/g, (_, k) => (tokens[k] != null ? String(tokens[k]).trim() : ''))
      .replace(/\s+/g, ' ')
      .trim();
  }

  function _isMergeTemplateIncluded(tpl) {
    return ctx.state.mergeTemplates === null || ctx.state.mergeTemplates.has(tpl);
  }

  function _renderMergeCardBody() {
    if (!ctx.state.mergeEnabled) {
      return `<div style="padding:8px 12px 10px;font-size:12px;color:var(--c-muted);font-style:italic">
        Az összefűzés ki van kapcsolva.</div>`;
    }

    const mode   = ctx.state.mergeMode;
    const chosen = [...ctx.state.chosenTemplates];

    const tplItems = chosen.length
      ? chosen.map(t => `
          <label class="template-radio-item" style="font-size:12px;min-height:26px">
            <input type="checkbox" name="dg-merge-tpl" value="${escHtml(t)}"
              ${_isMergeTemplateIncluded(t) ? 'checked' : ''}>
            <span>${escHtml(t)}</span>
          </label>`).join('')
      : `<div style="font-size:11px;color:var(--c-muted);padding:4px 0">Nincs kiválasztott sablon.</div>`;

    return `
      <div style="padding:8px 12px 6px">
        <div style="font-size:10px;color:var(--c-muted);font-weight:600;text-transform:uppercase;
            letter-spacing:.05em;margin-bottom:6px">Összefűzés módja</div>
        <label class="template-radio-item" style="font-size:12px;min-height:26px">
          <input type="radio" name="dg-merge-mode" value="per_client"
            ${mode === 'per_client' ? 'checked' : ''}>
          <span>Ügyfelenként — 1 csomag / ügyfél</span>
        </label>
        <label class="template-radio-item" style="font-size:12px;min-height:26px">
          <input type="radio" name="dg-merge-mode" value="per_template"
            ${mode === 'per_template' ? 'checked' : ''}>
          <span>Dokumentumtípusonként (ügyfelek ABC sorrendben)</span>
        </label>
      </div>
      <div style="padding:6px 12px 8px;border-top:1px solid var(--c-border)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
          <span style="font-size:10px;color:var(--c-muted);font-weight:600;text-transform:uppercase;
              letter-spacing:.05em">Beleértett sablonok</span>
          <div style="display:flex;gap:10px">
            <span class="checklist-action-link" id="dg-merge-tpl-all"
              style="font-size:11px;cursor:pointer">Mind</span>
            <span class="checklist-action-link" id="dg-merge-tpl-none"
              style="font-size:11px;cursor:pointer">Egyik sem</span>
          </div>
        </div>
        <div id="dg-merge-tpl-list">${tplItems}</div>
      </div>
      <div style="padding:6px 12px 8px;border-top:1px solid var(--c-border)">
        <div style="font-size:10px;color:var(--c-muted);font-weight:600;text-transform:uppercase;
            letter-spacing:.05em;margin-bottom:6px">Elkészülő összefűzött fájlok</div>
        <div id="dg-merge-preview">${_buildMergePreviewHTML()}</div>
      </div>

      <div style="padding:8px 12px;border-top:1px solid var(--c-border)">
        <button class="btn btn-primary btn-sm" id="dg-merge-run-btn"
          style="font-size:11px;width:100%">
          Összefűzés a kimeneti mappából
        </button>
        <div style="font-size:10px;color:var(--c-muted);margin-top:5px;line-height:1.4">
          Előbb generálj, majd futtasd a <code>docx-pdf.vbs</code> fájlt a kimeneti
          mappában — utána kattints ide.
        </div>
      </div>
      ${Settings.isAdmin() ? `
      <div style="padding:4px 12px 8px;border-top:1px solid var(--c-border)">
        <button class="btn btn-ghost btn-sm" id="dg-merge-naming-btn"
          style="font-size:11px;width:100%;text-align:left">
          ⚙ Elnevezési minta szerkesztése (admin)
        </button>
      </div>` : ''}
    `;
  }

  function _buildMergePreviewHTML() {
    if (!ctx.state.mergeEnabled || !ctx.state.selectedClients.length || !ctx.state.chosenTemplates.size) {
      return `<div style="font-size:11px;color:var(--c-muted);font-style:italic">
        Válassz ügyfeleket és sablonokat.</div>`;
    }

    const includedTpls = [...ctx.state.chosenTemplates].filter(_isMergeTemplateIncluded);
    if (!includedTpls.length) {
      return `<div style="font-size:11px;color:var(--c-amber)">
        Nincs kijelölt sablon az összefűzéshez.</div>`;
    }

    const naming    = _getMergeNaming();
    const excelBase = '';
    let items, subNote;

    if (ctx.state.mergeMode === 'per_client') {
      const rows = ctx.state.clientRows.filter(r => ctx.state.selectedClients.includes(r.id));
      items = rows.map(row => _applyMergeName(naming.perClient, {
        'Vezetéknév': row['Vezetéknév'] || '',
        'Keresztnév': row['Keresztnév'] || '',
      }) + '.pdf');
      subNote = `${includedTpls.length} sablon / csomag`;
    } else {
      items = includedTpls.map(tpl => _applyMergeName(naming.perTemplate, {
        'dokumentumtípus neve': tpl,
        'adatlap neve': excelBase,
      }) + '.pdf');
      subNote = `${ctx.state.selectedClients.length} ügyfél / fájl, ABC sorrendben`;
    }

    const pdfIcon = `<svg width="10" height="11" viewBox="0 0 14 16" fill="none"
      style="flex-shrink:0;color:var(--c-red)">
      <rect x="1" y="1" width="9" height="13" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
      <path d="M4 5h5M4 7.5h5M4 10h3" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
      <path d="M10 1v3.5h4" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>
      <path d="M10 1l4 3.5" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>
    </svg>`;

    const listHtml = items.map(name => `
      <div style="display:flex;align-items:center;gap:5px;padding:2px 0;font-size:11px">
        ${pdfIcon}
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
          title="${escHtml(name)}">${escHtml(name)}</span>
      </div>`).join('');

    return `
      <div style="font-size:10px;color:var(--c-muted);margin-bottom:4px">${escHtml(subNote)}</div>
      <div style="max-height:140px;overflow-y:auto">${listHtml}</div>`;
  }

  function updateMergeCard() {
    const body = ctx.q('#dg-merge-body');
    if (!body) return;
    body.innerHTML = _renderMergeCardBody();
    _bindMergeCardBody();
    // Szinkronizálja a toggle-t is
    const track = ctx.q('#dg-merge-toggle-track');
    if (track) {
      track.style.background = ctx.state.mergeEnabled ? 'var(--c-green)' : 'var(--c-border)';
      const knob = track.firstElementChild;
      if (knob) knob.style.left = ctx.state.mergeEnabled ? '17px' : '2px';
    }
    const lbl = ctx.q('#dg-merge-toggle-label');
    if (lbl) lbl.textContent = ctx.state.mergeEnabled ? 'Aktív' : '';
  }

  function updateMergePreview() {
    const el = ctx.q('#dg-merge-preview');
    if (el) el.innerHTML = _buildMergePreviewHTML();
  }

  function _bindMergeCardBody() {
    const tplList = ctx.q('#dg-merge-tpl-list');
    if (tplList) {
      tplList.addEventListener('change', e => {
        if (e.target.name !== 'dg-merge-tpl') return;
        const tpl = e.target.value;
        if (e.target.checked) {
          if (ctx.state.mergeTemplates !== null) {
            ctx.state.mergeTemplates.add(tpl);
            const allChosen = [...ctx.state.chosenTemplates];
            if (allChosen.every(t => ctx.state.mergeTemplates.has(t))) ctx.state.mergeTemplates = null;
          }
        } else {
          if (ctx.state.mergeTemplates === null) {
            ctx.state.mergeTemplates = new Set([...ctx.state.chosenTemplates].filter(t => t !== tpl));
          } else {
            ctx.state.mergeTemplates.delete(tpl);
          }
        }
        _saveMergeSettings();
        updateMergePreview();
      });
    }
    const tplAll = ctx.q('#dg-merge-tpl-all');
    if (tplAll) tplAll.addEventListener('click', () => {
      ctx.state.mergeTemplates = null;
      _saveMergeSettings();
      updateMergeCard();
    });
    const tplNone = ctx.q('#dg-merge-tpl-none');
    if (tplNone) tplNone.addEventListener('click', () => {
      ctx.state.mergeTemplates = new Set();
      _saveMergeSettings();
      updateMergeCard();
    });
    const mergeCard = ctx.q('#dg-card-merge');
    if (mergeCard) {
      mergeCard.querySelectorAll('input[name="dg-merge-mode"]').forEach(radio => {
        radio.addEventListener('change', e => {
          if (!e.target.checked) return;
          ctx.state.mergeMode = e.target.value;
          _saveMergeSettings();
          updateMergePreview();
        });
      });
    }
    const namingBtn = ctx.q('#dg-merge-naming-btn');
    if (namingBtn) namingBtn.addEventListener('click', openMergeNamingDialog);

    const runBtn = ctx.q('#dg-merge-run-btn');
    if (runBtn) runBtn.addEventListener('click', async () => {
      runBtn.disabled = true;
      const eredetiSzoveg = runBtn.textContent;
      runBtn.textContent = 'Összefűzés…';
      try {
        await runFromOutputDir();
      } catch (e) {
        BevLogger.error('PDF_MERGE', 'PDF összefűzés sikertelen', `error=${e.message}`, `user=${currentUser}`);
        toast(`PDF összefűzés: ${e.message}`, 'error');
      } finally {
        runBtn.disabled = false;
        runBtn.textContent = eredetiSzoveg;
      }
    });
  }

  function openMergeNamingDialog() {
    const cur = _getMergeNaming();
    showDialog({
      title: 'PDF összefűzés — elnevezési minta',
      body: `
        <div style="font-size:12px;color:var(--c-muted);margin-bottom:14px;line-height:1.6">
          Elérhető tokenek:<br>
          <b>Ügyfelenként:</b> <code>[Vezetéknév]</code>, <code>[Keresztnév]</code><br>
          <b>Sablononként:</b> <code>[dokumentumtípus neve]</code>, <code>[adatlap neve]</code>
          <span style="font-size:11px">(= Excel fájl neve kiterjesztés nélkül)</span>
        </div>
        <div style="margin-bottom:10px">
          <label style="font-size:12px;font-weight:500;display:block;margin-bottom:4px">
            Ügyfelenként — fájlnév minta:
          </label>
          <input type="text" id="dlg-merge-pc"
            value="${escHtml(cur.perClient)}"
            placeholder="[Vezetéknév] [Keresztnév] dokumentumcsomag"
            style="width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid var(--c-border);
              border-radius:6px;background:var(--c-bg);color:var(--c-text);font-size:13px">
        </div>
        <div>
          <label style="font-size:12px;font-weight:500;display:block;margin-bottom:4px">
            Dokumentumtípusonként — fájlnév minta:
          </label>
          <input type="text" id="dlg-merge-pt"
            value="${escHtml(cur.perTemplate)}"
            placeholder="[dokumentumtípus neve] [adatlap neve]"
            style="width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid var(--c-border);
              border-radius:6px;background:var(--c-bg);color:var(--c-text);font-size:13px">
        </div>
      `,
      footer: `
        <button class="btn btn-primary btn-sm" id="dlg-merge-save">Mentés</button>
        <button class="btn btn-ghost btn-sm" id="dlg-merge-reset">Visszaállítás alapértelmezettre</button>
        <button class="btn btn-ghost btn-sm" onclick="closeDialog()">Mégse</button>
      `,
    });
    document.getElementById('dlg-merge-save').addEventListener('click', () => {
      const pc = document.getElementById('dlg-merge-pc').value.trim();
      const pt = document.getElementById('dlg-merge-pt').value.trim();
      Settings.set(MERGE_NAMING_KEY, {
        perClient:   pc || '[Vezetéknév] [Keresztnév] dokumentumcsomag',
        perTemplate: pt || '[dokumentumtípus neve] [adatlap neve]',
      });
      closeDialog();
      updateMergePreview();
      toast('✓ Elnevezési minta mentve', 'success');
      BevLogger.info('MERGE_NAMING_SAVE', 'Összefűzés elnevezési minta mentve', `pc=${pc}, pt=${pt}`, `user=${currentUser}`);
    });
    document.getElementById('dlg-merge-reset').addEventListener('click', () => {
      Settings.remove(MERGE_NAMING_KEY);
      closeDialog();
      updateMergePreview();
      toast('Elnevezési minta visszaállítva alapértelmezettre', '');
    });
  }

  async function _savePdfBuffer(buf, filename) {
    if (ctx.state.outputDir) {
      try { await FsService.writeToDir(ctx.state.outputDir, filename, buf); return; } catch {}
    }
    saveAs(new Blob([buf], { type: 'application/pdf' }), filename);
  }

  /**
   * Összefűzés a kimeneti mappában TALÁLHATÓ PDF-ekből.
   *
   * Az app csak DOCX-et készít; a PDF-fé alakítás külön lépés
   * (tools/docx-pdf.vbs). Ezért az összefűzés nem a generálás része, hanem
   * utólagos művelet: beolvassa a legutóbbi generálás fájljaihoz tartozó
   * PDF-eket a lemezről, és azokat fűzi össze.
   */
  async function runFromOutputDir() {
    const gen = ctx.state.lastGenerated;
    if (!gen || !gen.length) {
      toast('Előbb generálj dokumentumokat', 'warn');
      return;
    }
    if (!ctx.state.outputDir) {
      toast('Nincs kimeneti mappa kiválasztva', 'warn');
      return;
    }

    // A DOCX mellé a .vbs azonos alapnéven teszi le a PDF-et.
    const map = new Map();
    const hianyzo = [];
    for (const g of gen) {
      const pdfNev = g.name.replace(/\.docx$/i, '.pdf');
      try {
        const buf = await FsService.readFromDir(ctx.state.outputDir, pdfNev);
        if (buf) map.set(pdfNev, buf); else hianyzo.push(pdfNev);
      } catch { hianyzo.push(pdfNev); }
    }

    if (!map.size) {
      toast('Nincs egyetlen PDF sem a kimeneti mappában — futtasd előbb a docx-pdf.vbs fájlt', 'warn');
      BevLogger.warn('PDF_MERGE_NOPDF', 'Összefűzés PDF nélkül',
        `vart=${gen.length}, hianyzo=${hianyzo.length}`, `user=${currentUser}`);
      return;
    }

    const clients   = ctx.state.clientRows.filter(r => ctx.state.selectedClients.includes(r.id));
    const templates = [...ctx.state.chosenTemplates];

    await _runPdfMerge(map, gen, clients, templates);

    if (hianyzo.length) {
      toast(`✓ Összefűzve — ${hianyzo.length} PDF hiányzott`, 'warn');
      BevLogger.warn('PDF_MERGE_PARTIAL', `Összefűzés hiányos: ${hianyzo.length} PDF nem volt meg`,
        hianyzo.slice(0, 10).join('\n'), `user=${currentUser}`);
    } else {
      toast('✓ PDF-ek összefűzve', 'success');
    }
  }

  async function _runPdfMerge(pdfBufferMap, generated, clients, templates) {
    if (!window.PDFLib) throw new Error('pdf-lib könyvtár nem elérhető');
    const { PDFDocument } = PDFLib;

    const includedTpls = templates.filter(_isMergeTemplateIncluded);
    if (!includedTpls.length) return;

    const naming    = _getMergeNaming();
    const excelBase = '';

    async function mergePdfs(buffers) {
      const doc = await PDFDocument.create();
      for (const buf of buffers) {
        if (!buf) continue;
        const src   = await PDFDocument.load(buf);
        const pages = await doc.copyPages(src, src.getPageIndices());
        pages.forEach(p => doc.addPage(p));
      }
      return new Uint8Array(await doc.save());
    }

    const savedNames = new Set([...pdfBufferMap.keys()]);

    if (ctx.state.mergeMode === 'per_client') {
      for (const client of clients) {
        const clientName = ctx.employeeName(client);
        const bufs = includedTpls.map(tpl => {
          const entry = generated.find(g => g.clientName === clientName && g.templateName === tpl);
          if (!entry) return null;
          return pdfBufferMap.get(entry.name.replace(/\.docx$/i, '.pdf')) || null;
        }).filter(Boolean);
        if (!bufs.length) continue;

        const baseName = _applyMergeName(naming.perClient, {
          'Vezetéknév': client['Vezetéknév'] || '',
          'Keresztnév': client['Keresztnév'] || '',
        }) + '.pdf';
        const outName = DocxService.uniqueFilename(baseName, savedNames);
        savedNames.add(outName);

        const merged = await mergePdfs(bufs);
        await _savePdfBuffer(merged, outName);
        BevLogger.info('PDF_MERGE_DONE', `Összefűzött PDF mentve (ügyfelenként): ${outName}`,
          `templates=${includedTpls.join('|')}, pages=${bufs.length}`, `user=${currentUser}`);
      }
    } else {
      const sortedClients = [...clients].sort((a, b) =>
        ctx.employeeName(a).localeCompare(ctx.employeeName(b), 'hu'));

      for (const tpl of includedTpls) {
        const bufs = sortedClients.map(client => {
          const clientName = ctx.employeeName(client);
          const entry = generated.find(g => g.clientName === clientName && g.templateName === tpl);
          if (!entry) return null;
          return pdfBufferMap.get(entry.name.replace(/\.docx$/i, '.pdf')) || null;
        }).filter(Boolean);
        if (!bufs.length) continue;

        const baseName = _applyMergeName(naming.perTemplate, {
          'dokumentumtípus neve': tpl,
          'adatlap neve': excelBase,
        }) + '.pdf';
        const outName = DocxService.uniqueFilename(baseName, savedNames);
        savedNames.add(outName);

        const merged = await mergePdfs(bufs);
        await _savePdfBuffer(merged, outName);
        BevLogger.info('PDF_MERGE_DONE', `Összefűzött PDF mentve (sablononként): ${outName}`,
          `clients=${sortedClients.map(ctx.employeeName).join('|')}, tpl=${tpl}`, `user=${currentUser}`);
      }
    }
  }

  return {
    init,
    saveSettings:     _saveMergeSettings,
    renderCardBody:   _renderMergeCardBody,
    bindCardBody:     _bindMergeCardBody,
    updateCard:       updateMergeCard,
    run:              _runPdfMerge,
    runFromOutputDir,
    isTemplateIncluded: _isMergeTemplateIncluded,
    MERGE_KEY,
  };
})();
