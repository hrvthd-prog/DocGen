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

  /**
   * A PDF-lánc állapotsáv — a kártya teteje, az összefűzés kapcsolójától
   * függetlenül mindig látszik.
   *
   * Azért van, mert eddig semmi nem mondta meg, hogy a Word-konverzió lefutott-e.
   * 12 DOCX mellett 0 PDF esetén az összefűzés csak annyit közölt, hogy nincs
   * mit összefűznie – az okot nem, és a felhasználó a saját munkájában kereste
   * a hibát ahelyett, hogy egyszerűen lefuttatta volna a konvertálót.
   */
  function _renderChainPanel() {
    return `
      <div style="padding:8px 12px;border-bottom:1px solid var(--c-border)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
          <span style="font-size:10px;color:var(--c-muted);font-weight:600;text-transform:uppercase;
              letter-spacing:.05em">PDF-előállítás állapota</span>
          <span class="checklist-action-link" id="dg-chain-refresh"
            style="font-size:11px;cursor:pointer">Ellenőrzés</span>
        </div>
        <div id="dg-chain-status" style="font-size:11.5px;line-height:1.5;color:var(--c-muted)">
          Az „Ellenőrzés" megmutatja, hány DOCX-hez készült már PDF.
        </div>
      </div>`;
  }

  /** Az állapotsáv feltöltése – a lemez tényleges tartalmából. */
  async function refreshChainPanel() {
    const el = ctx.q('#dg-chain-status');
    if (!el) return;
    if (!ctx.state.outputDir) {
      el.innerHTML = `<span style="color:var(--c-amber)">Nincs kimeneti mappa beállítva.</span>`;
      return;
    }
    el.textContent = 'Ellenőrzés…';

    const st = await DocgenPdfChain.status(ctx.state.outputDir);
    const o  = st.ossze;
    const szin = o.teljes ? 'var(--c-green)' : (o.kesz ? 'var(--c-amber)' : 'var(--c-red)');

    const sorok = [];
    sorok.push(`<div><b>${st.docxDb}</b> DOCX · <b>${st.pdfNevek.length}</b> PDF a mappában` +
      (st.legfrissebbPdf ? ` · legutóbbi PDF: ${escHtml(DocgenPdfChain.idoSzoveg(st.legfrissebbPdf))}` : '') +
      `</div>`);
    sorok.push(`<div style="color:${szin};font-weight:600">${escHtml(DocgenPdfChain.summaryText(o))}</div>`);

    if (o.hianyzo.length) {
      sorok.push(`
        <div style="margin-top:4px">
          Futtasd a <code>${escHtml(DocgenPdfChain.SCRIPT_OUT)}</code> fájlt a kimeneti mappában
          (duplakattintás), majd nyomd meg újra az Ellenőrzést.
        </div>
        <button class="btn btn-ghost btn-sm" id="dg-chain-run"
          style="font-size:11px;margin-top:5px;width:100%"
          title="Csak akkor működik, ha egyszer lefuttattad a tools/telepit-protokoll.vbs fájlt, és a kimeneti mappában már jártál a PDF-keszites.vbs-sel.">
          PDF-készítés indítása innen
        </button>
        <details style="margin-top:3px">
          <summary style="cursor:pointer;font-size:11px">Hiányzó PDF-ek (${o.hianyzo.length})</summary>
          <div style="max-height:110px;overflow-y:auto;font-size:10.5px;margin-top:3px">
            ${o.hianyzo.slice(0, 50).map(n => escHtml(n)).join('<br>')}
            ${o.hianyzo.length > 50 ? `<br>… és még ${o.hianyzo.length - 50}` : ''}
          </div>
        </details>`);
    }

    if (!st.szkriptKesz) {
      sorok.push(`
        <div style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--c-border)">
          A konvertáló szkript nincs beállítva, ezért nem kerül a DOCX-ek mellé.
          <button class="btn btn-ghost btn-sm" id="dg-chain-script"
            style="font-size:11px;margin-top:4px;width:100%">
            tools/docx-pdf.vbs kiválasztása (egyszer)
          </button>
        </div>`);
    }

    el.innerHTML = sorok.join('');
    const szkriptBtn = ctx.q('#dg-chain-script');
    if (szkriptBtn) szkriptBtn.addEventListener('click', onPickScript);
    const futtatBtn = ctx.q('#dg-chain-run');
    if (futtatBtn) futtatBtn.addEventListener('click', indit);
  }

  /**
   * A konverzió indítása a böngészőből — egyéni protokollkezelőn keresztül.
   *
   * A böngésző nem tud programot indítani; amit tud, az egy regisztrált
   * protokoll megnyitása (a Windows köti a wscript.exe-hez). A mappát nem
   * tudjuk átadni, mert a File System Access API fogantyút ad, nem útvonalat –
   * ezért a szkript maga jegyzi meg, hol dolgozott utoljára.
   *
   * Ha nincs telepítve a kezelő, a böngésző egyszerűen nem nyit meg semmit.
   * Ezért mondja meg a szöveg, mi a teendő – hibát nem tudunk elkapni, a
   * külső protokoll megnyitása nem ad visszajelzést a lapnak.
   */
  function indit() {
    BevLogger.info('PDF_CHAIN', 'Konverzió indítása protokollon keresztül', '', `user=${currentUser}`);
    window.location.href = 'docgenpdf://futtat';
    toast('Ha nem történik semmi, futtasd egyszer a tools/telepit-protokoll.vbs fájlt', '');
    // A konverzió a Wordön keresztül megy, ezért eltart pár másodpercig.
    setTimeout(refreshChainPanel, 6000);
  }

  async function onPickScript() {
    const ok = await DocgenPdfChain.copyScript(ctx.state.outputDir, { kerdezhet: true });
    if (ok) {
      toast(`✓ ${DocgenPdfChain.SCRIPT_OUT} a kimeneti mappában`, 'success');
      BevLogger.info('PDF_CHAIN', 'Konvertáló szkript kimásolva', '', `user=${currentUser}`);
    } else {
      toast('A szkript kiválasztása elmaradt', 'warn');
    }
    refreshChainPanel();
  }

  function _renderMergeCardBody() {
    if (!ctx.state.mergeEnabled) {
      return _renderChainPanel() +
        `<div style="padding:8px 12px 10px;font-size:12px;color:var(--c-muted);font-style:italic">
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

    return _renderChainPanel() + `
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
      // A név-tokeneket a séma oldja fel: a `clientRows` elemei `fields`-alapú
      // rekordok, nem magyar címkés sorok. Közvetlen `row['Vezetéknév']`
      // mindig üresen jött vissza – így minden csomag ugyanazt a nevet kapta.
      items = rows.map(row => _applyMergeName(naming.perClient, ctx.nameTokens(row)) + '.pdf');
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
    const chainRefresh = ctx.q('#dg-chain-refresh');
    if (chainRefresh) chainRefresh.addEventListener('click', refreshChainPanel);
    const chainScript = ctx.q('#dg-chain-script');
    if (chainScript) chainScript.addEventListener('click', onPickScript);

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
    if (!ctx.state.outputDir) {
      toast('Nincs kimeneti mappa kiválasztva', 'warn');
      return;
    }

    // Elsődlegesen a mostani munkamenet generálása, de ha az nincs (újratöltés,
    // másnap folytatás), a kimeneti mappa kísérőfájlja mondja meg, mi készült.
    // Eddig itt „Előbb generálj dokumentumokat" jött – a kész fájlok tetején.
    let gen = ctx.state.lastGenerated;
    let forras = 'munkamenet';
    if (!gen || !gen.length) {
      const m = await DocgenPdfChain.readManifest(ctx.state.outputDir);
      gen = m ? m.files.map(f => ({
        name: f.docx, clientName: f.client, templateName: f.template,
        vezeteknev: f.lastName || '', keresztnev: f.firstName || '',
      })) : [];
      forras = 'kísérőfájl';
    }
    if (!gen.length) {
      toast('Ebben a mappában nincs nyilvántartott generálás — generálj előbb dokumentumokat', 'warn');
      return;
    }

    // A DOCX mellé a .vbs azonos alapnéven teszi le a PDF-et.
    const map = new Map();
    const hianyzo = [];
    for (const g of gen) {
      const pdfNev = DocgenPdfChain.pdfName(g.name);
      try {
        const buf = await FsService.readFromDir(ctx.state.outputDir, pdfNev);
        if (buf) map.set(pdfNev, buf); else hianyzo.push(pdfNev);
      } catch { hianyzo.push(pdfNev); }
    }

    if (!map.size) {
      toast(`Nincs egyetlen PDF sem a kimeneti mappában — futtasd a ${DocgenPdfChain.SCRIPT_OUT} fájlt`, 'error');
      BevLogger.warn('PDF_MERGE_NOPDF', 'Összefűzés PDF nélkül',
        `vart=${gen.length}, hianyzo=${hianyzo.length}, forras=${forras}`, `user=${currentUser}`);
      refreshChainPanel();
      return;
    }

    const eredmeny = await _runPdfMerge(map, gen);

    // Néma siker megszüntetése: eddig üres eredményre is „✓ összefűzve" jött,
    // mert a párosítatlan csoportokat egy csendes `continue` ejtette ki.
    if (!eredmeny.irt) {
      const ok = eredmeny.okNincsSablon
        ? 'egyetlen kijelölt sablon sem szerepel a generálásban'
        : 'a meglévő PDF-ek egyik csomaghoz sem voltak párosíthatók';
      toast(`Nem készült összefűzött PDF: ${ok}`, 'error');
      BevLogger.error('PDF_MERGE_EMPTY', 'Az összefűzés nem írt fájlt',
        `ok=${ok}, gen=${gen.length}, pdf=${map.size}, forras=${forras}`, `user=${currentUser}`);
      return;
    }

    if (hianyzo.length) {
      toast(`✓ ${eredmeny.irt} csomag összefűzve — ${hianyzo.length} PDF hiányzott`, 'warn');
      BevLogger.warn('PDF_MERGE_PARTIAL', `Összefűzés hiányos: ${hianyzo.length} PDF nem volt meg`,
        hianyzo.slice(0, 10).join('\n'), `user=${currentUser}`);
    } else {
      toast(`✓ ${eredmeny.irt} PDF-csomag összefűzve`, 'success');
    }
    refreshChainPanel();
  }

  /**
   * A tényleges összefűzés — a GENERÁLÁS LISTÁJÁBÓL csoportosít.
   *
   * Korábban a párosítás az aktuális kijelölésből indult (`clientRows` +
   * `chosenTemplates`), és névegyezéssel kereste hozzá a generált fájlt. Két
   * baja volt: újratöltés után a kijelölés üres, tehát nem talált semmit; és
   * a nyers dolgozó-rekordból olvasott név-token mindig üres volt.
   *
   * Így viszont abból dolgozunk, ami tényleg elkészült – a csoportosítás nem
   * függ attól, mi van épp kipipálva a felületen.
   */
  async function _runPdfMerge(pdfBufferMap, generated) {
    if (!window.PDFLib) throw new Error('pdf-lib könyvtár nem elérhető');
    const { PDFDocument } = PDFLib;

    const tetelek = generated.filter(g => _isMergeTemplateIncluded(g.templateName));
    if (!tetelek.length) return { irt: 0, okNincsSablon: true };

    const naming = _getMergeNaming();

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

    // Csoportosítás: ügyfelenként az ügyfél a kulcs, sablononként a sablon.
    const csoportok = new Map();
    for (const t of tetelek) {
      const kulcs = ctx.state.mergeMode === 'per_client' ? t.clientName : t.templateName;
      if (!csoportok.has(kulcs)) csoportok.set(kulcs, []);
      csoportok.get(kulcs).push(t);
    }

    const savedNames = new Set([...pdfBufferMap.keys()]);
    let irt = 0;

    for (const [kulcs, csoport] of csoportok) {
      // Sablononkénti módban az ügyfelek ABC-sorrendben követik egymást.
      if (ctx.state.mergeMode === 'per_template') {
        csoport.sort((a, b) => String(a.clientName).localeCompare(String(b.clientName), 'hu'));
      }

      const bufs = csoport
        .map(t => pdfBufferMap.get(DocgenPdfChain.pdfName(t.name)) || null)
        .filter(Boolean);
      if (!bufs.length) continue;

      const baseName = (ctx.state.mergeMode === 'per_client'
        ? _applyMergeName(naming.perClient, {
            'Vezetéknév': csoport[0].vezeteknev || '',
            'Keresztnév': csoport[0].keresztnev || '',
          }) || kulcs
        : _applyMergeName(naming.perTemplate, {
            'dokumentumtípus neve': kulcs,
            'adatlap neve': '',
          }) || kulcs) + '.pdf';

      const outName = DocxService.uniqueFilename(baseName, savedNames);
      savedNames.add(outName);

      await _savePdfBuffer(await mergePdfs(bufs), outName);
      irt++;
      BevLogger.info('PDF_MERGE_DONE', `Összefűzött PDF mentve: ${outName}`,
        `mod=${ctx.state.mergeMode}, csoport=${kulcs}, oldalforras=${bufs.length}`, `user=${currentUser}`);
    }

    return { irt, okNincsSablon: false };
  }

  return {
    init,
    saveSettings:     _saveMergeSettings,
    renderCardBody:   _renderMergeCardBody,
    bindCardBody:     _bindMergeCardBody,
    updateCard:       updateMergeCard,
    run:              _runPdfMerge,
    runFromOutputDir,
    refreshChainPanel,
    isTemplateIncluded: _isMergeTemplateIncluded,
    MERGE_KEY,
  };
})();
