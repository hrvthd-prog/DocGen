'use strict';

/**
 * Fájlnév-minta kezelés.
 *
 * Sablononként megadható, milyen néven készüljön a kimeneti fájl
 * (pl. „Nyilatkozat [Vezetéknév] [Keresztnév]"). A minta menthető a saját
 * fiókra vagy globálisan; a feloldási sorrend: fiók > globális > alapértelmezés.
 *
 * A docgen magtól csak az élő előnézethez kér adatot (`ctx.buildRenderRow`),
 * ezért önállóan is használható.
 */
const DocgenNaming = (() => {

  const currentUser = Settings.currentUser();
  let ctx = null;

  function init(context) { ctx = context; }

  // ── P5: Generált név-minta tárolás ─────────────────────────────────────────
  // Hierarchia: fiók > globális > default
  const NAME_TPL_USER_KEY   = () => 'docgen_nameTemplates_u_' + (currentUser || '').replace(/[^a-zA-Z0-9]/g, '_');
  const NAME_TPL_GLOBAL_KEY = 'docgen_nameTemplates_global';

  function getNamePattern(templateName) {
    const userMap = Settings.get(NAME_TPL_USER_KEY(), {});
    if (userMap[templateName]) return { pattern: userMap[templateName], scope: 'user' };
    const globalMap = Settings.get(NAME_TPL_GLOBAL_KEY, {});
    if (globalMap[templateName]) return { pattern: globalMap[templateName], scope: 'global' };
    return { pattern: '', scope: 'default' };
  }

  function saveNamePattern(templateName, pattern, scope) {
    const key = scope === 'global' ? NAME_TPL_GLOBAL_KEY : NAME_TPL_USER_KEY();
    const map = Settings.get(key, {});
    if (pattern && pattern.trim()) {
      map[templateName] = pattern.trim();
    } else {
      delete map[templateName]; // visszaállítás default-ra
    }
    Settings.set(key, map);
    BevLogger.info('NAME_TPL_SAVE',
      `Név-minta mentve [${scope}]: ${templateName}`,
      `pattern=${pattern || '(default)'}`,
      `user=${currentUser}`);
  }

  // ── P5: Név-minta szerkesztő dialóg ───────────────────────────────────────
  function openNamePatternDialog(templateName) {
    const isAdmin = Settings.isAdmin();
    const current = getNamePattern(templateName);
    const defaultPreview = `${templateName} (default: VEZNEV KERNEV ${templateName}.docx)`;

    // Példa-row a preview-hoz (első kiválasztott vagy első bármely sor)
    // Az előnézet a séma szerint renderelt értékeket használja, hogy a
    // fájlnév-minta pontosan azt mutassa, ami a generáláskor is keletkezik.
    const elsoSzemely = ctx ? ctx.firstEmployee() : null;
    const exampleRow = elsoSzemely
      ? ctx.buildRenderRow(elsoSzemely)
      : { 'Vezetéknév': 'MINTA', 'Keresztnév': 'József', surname: 'MINTA', forename: 'József' };

    showDialog({
      title: `Generált dokumentum elnevezése — ${templateName}`,
      body: `
        <div style="display:flex;flex-direction:column;gap:12px">
          <div style="font-size:12px;color:var(--c-muted)">
            Adj meg egy mintát a generált fájlnévhez. A vonszolható chip-eket beillesztheted
            kattintással vagy húzással. Ha üresen hagyod, a default név lesz használva.
          </div>

          <div>
            <label style="font-size:12px;color:var(--c-muted);margin-bottom:3px;display:block">
              Vonszolható tokenek (dupla-kattintásra is beilleszthetők):
            </label>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <span class="npt-token" draggable="true" data-token="[Vezetéknév]"
                style="background:var(--c-teal);color:#fff;padding:3px 10px;border-radius:12px;
                       font-size:12px;cursor:grab;user-select:none">[Vezetéknév]</span>
              <span class="npt-token" draggable="true" data-token="[Keresztnév]"
                style="background:var(--c-teal);color:#fff;padding:3px 10px;border-radius:12px;
                       font-size:12px;cursor:grab;user-select:none">[Keresztnév]</span>
            </div>
          </div>

          <div>
            <label style="font-size:12px;color:var(--c-muted);margin-bottom:3px;display:block">
              Fájlnév-minta (a <code>.docx</code> automatikusan kerül a végére):
            </label>
            <input type="text" id="npt-input" class="field-input" style="width:100%;font-size:13px"
              value="${escHtml(current.pattern)}"
              placeholder="pl. Nyilatkozat kilépésről [Vezetéknév] [Keresztnév]">
          </div>

          <div style="background:var(--c-bg);border:1px solid var(--c-border);border-radius:6px;padding:8px 12px">
            <div style="font-size:11px;color:var(--c-muted);margin-bottom:4px">Példa kimenet:</div>
            <div id="npt-preview" style="font-family:Consolas,monospace;font-size:12px;color:var(--c-text)">—</div>
          </div>

          <div style="font-size:11px;color:var(--c-muted)">
            Aktuális hatókör: <strong>${current.scope === 'user' ? 'fiók-szintű' : current.scope === 'global' ? 'globális' : 'default (alapértelmezett)'}</strong>
            ${isAdmin ? '<br>Adminként a globális mentés minden fiókra hat (kivéve akinek saját van).' : ''}
          </div>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost btn-sm" id="npt-reset">Visszaállítás defaultra</button>
        ${isAdmin ? `<button class="btn btn-teal btn-sm" id="npt-save-global">Mentés: globálisan</button>` : ''}
        <button class="btn btn-primary btn-sm" id="npt-save-user">Mentés: fiókszintűen</button>
        <button class="btn btn-ghost btn-sm" onclick="closeDialog()">Mégse</button>
      `,
    });

    const inputEl = document.getElementById('npt-input');
    const previewEl = document.getElementById('npt-preview');

    function refreshPreview() {
      const pattern = inputEl.value.trim();
      const sample = DocxService.outputFilename(templateName, exampleRow, pattern);
      previewEl.textContent = sample || defaultPreview;
    }
    refreshPreview();
    inputEl.addEventListener('input', refreshPreview);

    // Token-chip: dupla-kattintásra a cursor-pozíciónál beilleszt
    document.querySelectorAll('.npt-token').forEach(chip => {
      chip.addEventListener('dblclick', () => insertToken(chip.dataset.token));
      chip.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', chip.dataset.token);
        e.dataTransfer.effectAllowed = 'copy';
      });
    });
    // Az input fogadja a drop-eseményt
    inputEl.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    inputEl.addEventListener('drop', e => {
      e.preventDefault();
      const token = e.dataTransfer.getData('text/plain');
      if (token) insertToken(token);
    });

    function insertToken(token) {
      const start = inputEl.selectionStart ?? inputEl.value.length;
      const end   = inputEl.selectionEnd ?? inputEl.value.length;
      // Spaces körötte (ha nincs)
      const left = inputEl.value.slice(0, start);
      const right = inputEl.value.slice(end);
      const lspace = left && !left.endsWith(' ') ? ' ' : '';
      const rspace = right && !right.startsWith(' ') ? ' ' : '';
      inputEl.value = left + lspace + token + rspace + right;
      const newPos = (left + lspace + token + rspace).length;
      inputEl.focus();
      inputEl.setSelectionRange(newPos, newPos);
      refreshPreview();
    }

    document.getElementById('npt-reset').addEventListener('click', () => {
      inputEl.value = '';
      refreshPreview();
    });

    function doSave(scope) {
      const pattern = inputEl.value.trim();
      // Z4: validáció — vagy üres (= default), vagy legalább 1 nem-token karakter VAGY 1 token
      if (pattern) {
        const hasToken = pattern.includes('[Vezetéknév]') || pattern.includes('[Keresztnév]');
        const stripped = pattern.replace(/\[Vezetéknév\]|\[Keresztnév\]/g, '').trim();
        if (!hasToken && !stripped) {
          toast('A minta nem lehet üres — adj meg legalább 1 tokent vagy szöveget', 'warn');
          return;
        }
      }
      saveNamePattern(templateName, pattern, scope);
      closeDialog();
      toast(`✓ Név-minta mentve [${scope === 'global' ? 'globális' : 'fiók'}]`, 'success');
    }

    document.getElementById('npt-save-user').addEventListener('click', () => doSave('user'));
    if (isAdmin) {
      document.getElementById('npt-save-global').addEventListener('click', () => doSave('global'));
    }
  }

  return { init, getNamePattern, saveNamePattern, openDialog: openNamePatternDialog };
})();
