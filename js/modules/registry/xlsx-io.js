'use strict';

/**
 * xlsx be- és kimenet a nyilvántartáshoz – felületi réteg.
 *
 * Az import soha nem ír azonnal: előbb megmutatja, mi történne (új / frissítés /
 * duplikátum / hiányos), és csak jóváhagyás után hajtja végre.
 */
const RegistryXlsxIO = (() => {

  function profile() { return ExportProfiles.get(); }

  function download(buffer, filename) {
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    if (typeof saveAs === 'function') saveAs(blob, filename);
    else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }
  }

  // ── Export ─────────────────────────────────────────────────────────────────

  /** Üres sablon – kitöltésre kiküldhető. */
  async function exportTemplate() {
    const p = profile();
    try {
      const buf = await XlsxWrite.toBuffer({
        schema: SchemaStore.get(), profile: p, employees: [],
      });
      download(buf, XlsxWrite.suggestFilename(p, false));
      toast('Üres adatbekérő sablon elkészült', 'success');
    } catch (e) {
      BevLogger.error('XLSX_TEMPLATE', 'Sablon készítése sikertelen', e.message, '');
      toast('A sablon készítése nem sikerült: ' + e.message, 'error');
    }
  }

  /** Feltöltött export – a megadott rekordokkal. */
  async function exportData(employees) {
    const p = profile();
    if (!employees.length) { toast('Nincs exportálandó rekord.', 'error'); return; }
    try {
      const buf = await XlsxWrite.toBuffer({
        schema: SchemaStore.get(), profile: p, employees,
      });
      download(buf, XlsxWrite.suggestFilename(p, true));
      toast(`${employees.length} rekord exportálva`, 'success');
    } catch (e) {
      BevLogger.error('XLSX_EXPORT', 'Export sikertelen', e.message, '');
      toast('Az export nem sikerült: ' + e.message, 'error');
    }
  }

  // ── Import ─────────────────────────────────────────────────────────────────

  function importFile(file, onDone) {
    file.arrayBuffer().then(buf => {
      let olvasas;
      try {
        olvasas = XlsxRead.readRows(buf, { schema: SchemaStore.get() });
      } catch (e) {
        toast('A fájl nem olvasható: ' + e.message, 'error');
        return;
      }
      if (!olvasas.rows.length) {
        toast('A fájlban nincs adatsor.', 'error');
        return;
      }
      const terv = XlsxRead.plan(olvasas.rows, { schema: SchemaStore.get() });
      showPlanDialog(olvasas, terv, onDone);
    });
  }

  function showPlanDialog(olvasas, terv, onDone) {
    const db = t => terv.filter(x => x.action === t).length;
    const hibas = terv.filter(t => t.validation.length).length;
    const ertekGond = terv.filter(t => t.row.problems.length).length;

    const sorok = terv.map(t => {
      const nev = [t.row.fields.surname, t.row.fields.forename].filter(Boolean).join(' ') || '(névtelen)';
      const allapot = {
        create:    '<span class="xio-new">új</span>',
        update:    `<span class="xio-upd">frissítés</span>${
                     t.matchedBy === 'identifier' ? ' <i>azonosító alapján</i>' : ' <i>név alapján</i>'}`,
        duplicate: `<span class="xio-dup">duplikátum</span> <i>(${t.duplicateOf}. sor)</i>`,
      }[t.action];

      const gondok = []
        .concat(t.validation.map(v => v.message))
        .concat(t.row.problems);

      return `
        <tr class="${t.validation.length ? 'xio-invalid' : ''}">
          <td>${t.row.excelRow}</td>
          <td>${escHtml(nev)}</td>
          <td>${allapot}</td>
          <td title="${escHtml(gondok.join(' | '))}">${gondok.length ? escHtml(gondok[0]) + (gondok.length > 1 ? ` (+${gondok.length - 1})` : '') : ''}</td>
        </tr>`;
    }).join('');

    showDialog({
      title: 'Import előnézete',
      body: `
        <div class="xio-wrap">
          <p class="ef-hint">
            Munkalap: <b>${escHtml(olvasas.sheetName)}</b> · ${terv.length} sor beolvasva.
            ${olvasas.unknownColumns.length
              ? `<br>Ismeretlen oszlop (kimarad): <b>${escHtml(olvasas.unknownColumns.join(', '))}</b>`
              : ''}
          </p>
          <div class="xio-summary">
            <span><b>${db('create')}</b> új</span>
            <span><b>${db('update')}</b> frissítés</span>
            <span><b>${db('duplicate')}</b> duplikátum</span>
            ${hibas ? `<span class="xio-warn"><b>${hibas}</b> hiányos</span>` : ''}
            ${ertekGond ? `<span class="xio-warn"><b>${ertekGond}</b> ismeretlen érték</span>` : ''}
          </div>
          <div class="data-table-wrap xio-table">
            <table class="data-table">
              <thead><tr><th>Sor</th><th>Név</th><th>Művelet</th><th>Megjegyzés</th></tr></thead>
              <tbody>${sorok}</tbody>
            </table>
          </div>
          <label class="check-row">
            <input type="checkbox" id="xio-skip-invalid" checked>
            <span>A hiányos sorok kihagyása (kötelező mező nélkül nem jön létre rekord)</span>
          </label>
        </div>`,
      footer: `
        <button class="btn btn-ghost btn-sm" onclick="closeDialog()">Mégse</button>
        <button class="btn btn-primary btn-sm" id="xio-apply">Import végrehajtása</button>`,
    });

    document.getElementById('xio-apply').addEventListener('click', () => {
      const onlyValid = document.getElementById('xio-skip-invalid').checked;
      let r;
      try {
        r = XlsxRead.apply(terv, { onlyValid });
      } catch (e) {
        toast('Az import nem sikerült: ' + e.message, 'error');
        return;
      }
      EmployeeRepo.flush();
      closeDialog();
      const uzenet = [
        `${r.letrehozva} új`,
        `${r.frissitve} frissítve`,
        r.ujAzonosito ? `${r.ujAzonosito} új azonosító` : null,
        r.kihagyva ? `${r.kihagyva} kihagyva` : null,
      ].filter(Boolean).join(' · ');
      toast(uzenet, 'success');
      if (onDone) onDone();
    });
  }

  return { exportTemplate, exportData, importFile };
})();
