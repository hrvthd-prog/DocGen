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
      // A fejléc három sor (kulcsok / szakaszcímek / angol címkék), az adat csak
      // az után kezdődik — a sorszámokat a profil mondja meg, nem a beépített
      // alapértelmezés. Ennélkül a címkesor is személyként jött be.
      const p = profile();
      try {
        olvasas = XlsxRead.readRows(buf, {
          schema: SchemaStore.get(),
          keyRow: p.keyRow, firstDataRow: p.firstDataRow,
        });
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
    // Közvetlen vezető, ami nem vezetői fiók: bekerül, de jelezzük (TERV-fiokok.md 10.2)
    const nemFiok = t => {
      const v = String(t.row.fields[Leaders.FIELD] || '').trim();
      return v && !Leaders.isAccountName(v) ? v : '';
    };
    const nemFiokNevek = [...new Set(terv.map(nemFiok).filter(Boolean))];

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
        .concat(t.row.problems)
        .concat(nemFiok(t) ? [`a közvetlen vezető („${nemFiok(t)}”) nem fiók`] : []);

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
            ${nemFiokNevek.length ? `<span class="xio-warn" title="${escHtml(nemFiokNevek.join(', '))}">
              <b>${nemFiokNevek.length}</b> vezetőnév nem fiók</span>` : ''}
          </div>
          ${nemFiokNevek.length ? `<p class="ef-hint">
            Ezek a vezetőnevek nem egyeznek egyetlen vezetői fiókkal sem:
            <b>${escHtml(nemFiokNevek.join(', '))}</b>. Az érték bekerül, de amíg nincs
            ilyen nevű fiók, a vezető nem látja a dolgozóit (Beállítások → Fiókok, vagy
            utólag: Nyilvántartás → Közvetlen vezető…).</p>` : ''}
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

  // ── Adatfrissítés törzsszám alapján ────────────────────────────────────────

  /**
   * Meglévő dolgozók mezőinek frissítése egy táblázatból (pl. SAP-exportból).
   * Csak a felismert nevű oszlopok számítanak; tételenként jóváhagyandó.
   */
  function updateFile(file, onDone) {
    file.arrayBuffer().then(buf => {
      let olvasas, terv;
      try {
        // Átlagos táblázat: fejléc az 1. sorban, adat a 2.-tól — nem az adatbekérő profilja
        olvasas = XlsxRead.readRows(buf, { schema: SchemaStore.get(), keyRow: 1, firstDataRow: 2 });
        if (!olvasas.rows.length) throw new Error('nincs benne adatsor.');
        const mezok = BulkEdit.szerkesztheto().map(f => f.key);
        // A közvetlen vezető a tömeges szerkesztésből kimarad (saját, fiókválasztós eszköze
        // van), táblázatból viszont tölthető — ugyanazzal a jogosultsággal
        let vezeto = null;
        try { vezeto = SchemaStore.field(Leaders.FIELD); } catch { vezeto = null; }
        if (vezeto && Auth.canWriteGroup(vezeto.group)) mezok.push(Leaders.FIELD);
        terv = XlsxRead.planUpdate(olvasas.rows, { mezok });
      } catch (e) {
        toast('A fájl nem olvasható: ' + e.message, 'error');
        return;
      }
      showUpdateDialog(olvasas, terv, onDone);
    });
  }

  function showUpdateDialog(olvasas, terv, onDone) {
    const t = terv.tetelek;
    const dolgozok = new Set(t.map(x => x.emp.id)).size;
    const hibas = t.filter(x => x.hiba).length;
    const felulir = t.filter(x => x.from && !x.hiba).length;
    const cimke = k => SchemaStore.field(k).label.hu;
    // Enum és dátum olvasható alakban, mint a tömeges szerkesztés összesítőjében
    const ertek = (k, x) => {
      const f = SchemaStore.field(k);
      return x ? escHtml(f.type === 'text' ? x : (SchemaStore.renderValue(f, x, 'hu') || x)) : '—';
    };
    const lista = (cim, elemek) => elemek.length
      ? `<br>${cim}: <b>${escHtml(elemek.join(', '))}</b>` : '';

    const sorok = t.map((x, i) => `
      <tr class="${x.hiba ? 'xio-invalid' : ''}">
        <td><input type="checkbox" data-xu="${i}" ${x.hiba ? 'disabled' : (x.from ? '' : 'checked')}></td>
        <td>${x.excelRow}</td>
        <td>${escHtml(x.nev)}${x.figyelem ? `<br><span class="xio-dup">⚠ ${escHtml(x.figyelem)}</span>` : ''}</td>
        <td>${escHtml(cimke(x.key))}</td>
        <td>${x.from ? `<span class="xio-upd">felülírás:</span> ${ertek(x.key, x.from)}` : '—'}</td>
        <td><b>${ertek(x.key, x.to)}</b>${x.hiba ? `<br>${escHtml(x.hiba)}` : ''}${
          x.megj ? `<br><span class="xio-dup">⚠ ${escHtml(x.megj)}</span>` : ''}</td>
      </tr>`).join('');

    showDialog({
      title: 'Frissítés törzsszám alapján — előnézet',
      body: `
        <div class="xio-wrap">
          <p class="ef-hint">
            Munkalap: <b>${escHtml(olvasas.sheetName)}</b> · ${olvasas.rows.length} sor beolvasva.
            ${lista('Nem található törzsszám (kimarad)',
              terv.nemTalalt.map(n => `${n.ertek || '(üres)'} — ${n.excelRow}. sor`))}
            ${lista('Ugyanaz a dolgozó többször (csak az első sora számít)',
              terv.ismetlodo.map(n => `${n.excelRow}. sor (= ${n.elso}. sor)`))}
            ${lista('Itt nem frissíthető oszlop (kimarad)', terv.kimarado.map(k =>
              cimke(k) + (k === 'surname' || k === 'forename' ? ' — csak névellenőrzés' : '')))}
            ${lista('Ismeretlen oszlop (kimarad)', olvasas.unknownColumns)}
          </p>
          <div class="xio-summary">
            <span><b>${dolgozok}</b> dolgozó</span>
            <span><b>${t.length - felulir - hibas}</b> üres mező kitöltése</span>
            <span class="xio-warn"><b>${felulir}</b> felülírás</span>
            ${hibas ? `<span class="xio-warn"><b>${hibas}</b> hibás érték (nem írható be)</span>` : ''}
            ${terv.nemTalalt.length ? `<span class="xio-warn"><b>${terv.nemTalalt.length}</b> nem található</span>` : ''}
          </div>
          ${t.length ? `
          <div class="data-table-wrap xio-table">
            <table class="data-table">
              <thead><tr><th><input type="checkbox" id="xu-mind" title="Mind / egyik sem"></th>
                <th>Sor</th><th>Dolgozó</th><th>Mező</th><th>Jelenlegi</th><th>Új</th></tr></thead>
              <tbody>${sorok}</tbody>
            </table>
          </div>
          <p class="ef-hint">A felülírások alapból nincsenek kijelölve — pipáld be, amelyiket kéred.
            Az üres cella semmit nem töröl; új dolgozó nem jön létre.</p>`
          : '<p>Nincs mit frissíteni: minden kitöltött cella egyezik a nyilvántartással.</p>'}
        </div>`,
      footer: `
        <button class="btn btn-ghost btn-sm" onclick="closeDialog()">Mégse</button>
        <button class="btn btn-primary btn-sm" id="xu-apply" ${t.length ? '' : 'disabled'}>Kijelöltek rögzítése</button>`,
    });

    const pipak = [...document.querySelectorAll('#dialog-overlay [data-xu]')].filter(c => !c.disabled);
    const mind = document.getElementById('xu-mind');
    if (mind) mind.addEventListener('change', () => pipak.forEach(c => { c.checked = mind.checked; }));

    const gomb = document.getElementById('xu-apply');
    gomb.addEventListener('click', async () => {
      // Dolgozónként egy írás — a BulkEdit.alkalmaz sor-alakjában
      const perDolgozo = new Map();
      for (const c of pipak.filter(c => c.checked)) {
        const x = t[c.dataset.xu];
        if (!perDolgozo.has(x.emp.id)) perDolgozo.set(x.emp.id, { emp: x.emp, nev: x.nev, uj: {}, valtozasok: [] });
        const s = perDolgozo.get(x.emp.id);
        s.uj[x.key] = x.to;
        s.valtozasok.push(x);
      }
      if (!perDolgozo.size) { toast('Nincs kijelölt tétel.', 'error'); return; }

      gomb.disabled = true;
      gomb.textContent = 'Rögzítés…';
      let r;
      try {
        r = await BulkEdit.alkalmaz([...perDolgozo.values()], 'import_frissites');
      } catch (e) {
        gomb.disabled = false;
        gomb.textContent = 'Kijelöltek rögzítése';
        toast('A mentés nem sikerült: ' + e.message, 'error');
        return;
      }
      BevLogger.info('IMPORT_FRISSITES', `Frissítés törzsszám alapján: ${perDolgozo.size} dolgozó`,
        `hibak=${r.hibak.length}, nemMentett=${r.nemMentett.length}`, '');
      if (onDone) onDone();
      if (!r.hibak.length && !r.nemMentett.length) {
        closeDialog();
        toast(`✓ ${perDolgozo.size} dolgozó adata frissítve, és visszaolvasva`, 'success');
        return;
      }
      showDialog({
        title: 'A frissítés részben sikerült',
        body: `
          ${r.hibak.length ? `<p>Nem módosult:</p><ul>${r.hibak.map(h =>
            `<li><b>${escHtml(h.nev)}</b>: ${escHtml(h.uzenet)}</li>`).join('')}</ul>` : ''}
          ${r.nemMentett.length ? `<p>⚠ Visszaolvasáskor eltérés — ezek NEM kerültek a tárolóba:
            ${r.nemMentett.map(escHtml).join(', ')}. Ellenőrizd az adatmappát, és töltsd újra.</p>` : ''}`,
        footer: '<button class="btn btn-primary btn-sm" onclick="closeDialog()">Rendben</button>',
      });
    });
  }

  return { exportTemplate, exportData, importFile, updateFile };
})();
