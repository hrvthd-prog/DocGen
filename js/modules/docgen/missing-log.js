'use strict';

/**
 * Hiányzó-adat napló.
 *
 * Generáláskor feljegyzi, mely sablon-jelölőkhöz nem volt adat, kinél és melyik
 * sablonnál. Így utólag is kideríthető, miért maradt üres egy mező a kész
 * dokumentumban – ez korábban csak a generálás pillanatában látszott.
 *
 * Önálló egység: nem függ a docgen állapotától, csak a beállítás-tárolótól.
 */
const DocgenMissingLog = (() => {

  const MISSING_LOG_KEY = 'docgen_missing_log';
  const currentUser = Settings.currentUser();

  function appendMissingLog(entries) {
    if (!entries || !entries.length) return;
    const existing = Settings.get(MISSING_LOG_KEY, []);
    Settings.set(MISSING_LOG_KEY, existing.concat(entries));
  }

  function showMissingLogDialog() {
    const isAdmin  = Settings.isAdmin();
    const allLogs  = Settings.get(MISSING_LOG_KEY, []);
    // Admin látja az összes bejegyzést, többi felhasználó csak a sajátját
    const logs = isAdmin ? allLogs : allLogs.filter(e => e.user === currentUser);

    const colFiok = isAdmin ? `<th style="min-width:100px">Fiók</th>` : '';
    const rows = logs.length
      ? [...logs].reverse().map(e => {
          const d = e.ts ? new Date(e.ts).toLocaleString('hu-HU', { dateStyle:'short', timeStyle:'short' }) : '—';
          const fiokCol = isAdmin ? `<td style="font-size:11px">${escHtml(e.user || '—')}</td>` : '';
          return `<tr>
            <td style="white-space:nowrap;font-size:11px">${escHtml(d)}</td>
            ${fiokCol}
            <td style="font-size:11px">${escHtml(e.client || '—')}</td>
            <td style="font-size:11px">${escHtml(e.template || '—')}</td>
            <td style="font-size:11px">
              <div style="display:flex;flex-wrap:wrap;gap:3px">
                ${(e.emptyTags || []).map(t =>
                  `<span style="background:var(--c-bg);border:1px solid var(--c-border);border-radius:3px;padding:1px 5px">${escHtml(t)}</span>`
                ).join('')}
              </div>
            </td>
            <td style="font-size:11px">
              <div style="display:flex;flex-wrap:wrap;gap:3px">
                ${(e.untranslatedTags || []).map(t =>
                  `<span style="background:var(--c-bg);border:1px solid var(--c-warn,#c90);border-radius:3px;padding:1px 5px">${escHtml(t)}</span>`
                ).join('')}
              </div>
            </td>
          </tr>`;
        }).join('')
      : `<tr><td colspan="${isAdmin ? 6 : 5}" style="text-align:center;padding:20px;color:var(--c-muted);font-size:12px">
           Még nincs naplóbejegyzés${isAdmin ? '' : ' ehhez a fiókhoz'}.
         </td></tr>`;

    showDialog({
      title: isAdmin ? 'Hiányzó adatok naplója — összes fiók' : `Hiányzó adatok naplója — ${currentUser}`,
      body: `
        <div style="font-size:11px;color:var(--c-muted);margin-bottom:10px">
          <b>Hiányzó mezők:</b> amikre a generáláskor nem volt adat.<br>
          <b>Fordítatlan:</b> volt adat, de angol alakot kérő jelölőhöz nem volt
          szótári pár — a MAGYAR szöveg került az angol rovatba.
          Pótolható: Beállítások → Szótár.
          ${isAdmin ? '<br>Admin nézetként az összes fiók bejegyzése látható.' : ''}
        </div>
        <div class="data-table-wrap" style="max-height:480px">
          <table class="data-table">
            <thead>
              <tr>
                <th style="min-width:110px">Dátum</th>
                ${colFiok}
                <th style="min-width:120px">Ügyfél</th>
                <th style="min-width:140px">Sablon</th>
                <th>Hiányzó mezők</th>
                <th>Fordítatlan</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `,
      footer: `
        ${isAdmin ? `<button class="btn btn-danger btn-sm" id="dlg-clear-log">Napló törlése</button>` : ''}
        <button class="btn btn-ghost btn-sm" onclick="closeDialog()">Bezárás</button>
      `,
    });

    if (isAdmin) {
      const clearBtn = document.getElementById('dlg-clear-log');
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          Settings.set(MISSING_LOG_KEY, []);
          closeDialog();
          toast('✓ Napló törölve', 'success');
        });
      }
    }
  }

  return { append: appendMissingLog, showDialog: showMissingLogDialog, KEY: MISSING_LOG_KEY };
})();
