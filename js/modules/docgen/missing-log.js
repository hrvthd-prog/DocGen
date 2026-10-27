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
  // A fiókot a bejelentkezés adja meg, a script betöltése UTÁN — ezért nem
  // fagyasztjuk be: minden hivatkozásnál újraolvassuk (TERV-fiokok.md 3.2).
  const currentUser = () => Settings.currentUser();

  // A napló a localStorage-ban él (~5 MB a teljes app-nak). Korlát nélkül
  // generálásonként nőtt: a megnyitás befagyott, egy tele tároló pedig a
  // generálást is megszakította volna (az `append` a fájlok mentése ELŐTT fut).
  const MAX_TAROLT = 2000;   // a legújabbak maradnak
  const OLDAL = 50;          // ennyi sor egy lapon — a régiek lapozhatók

  function appendMissingLog(entries) {
    if (!entries || !entries.length) return;
    let lista = Settings.get(MISSING_LOG_KEY, []).concat(entries);
    if (lista.length > MAX_TAROLT) lista = lista.slice(-MAX_TAROLT);
    // Tele tároló: a régebbi fele kiesik — a napló miatt a generálás nem bukhat el.
    for (let i = 0; i < 6 && lista.length; i++) {
      try { Settings.set(MISSING_LOG_KEY, lista); return; }
      catch { lista = lista.slice(Math.ceil(lista.length / 2)); }
    }
  }

  // ── Jelölő → mező (a hiánypótló szerkesztőhöz) ─────────────────────────────

  const OVERFLOW = ' (nem fér el)';

  /**
   * Sablon-jelölők → a nyilvántartás szerkeszthető mezői.
   *
   * Számított mezőnél (pl. „Állandó lakcím”) a FORRÁSMEZŐK kellenek, mert azokat
   * lehet kitölteni — közülük az üresek, vagy ha egyik sem üres, mind. Ami nem a
   * nyilvántartásból jön (EH szám, iktatószám, mai nap, ismeretlen jelölő), az
   * `egyeb`: azt a szerkesztő nem tudja pótolni, csak megnevezi.
   */
  function mezokreBont(tags, fields = {}) {
    const mezok = new Set(), egyeb = [];
    const ures = k => fields[k] == null || String(fields[k]).trim() === '';
    const forrasok = (f, melyseg) => {
      if (f.type !== 'computed') return [f.key];
      if (melyseg > 3) return [];
      return (f.computed.from || []).map(k => SchemaStore.field(k)).filter(Boolean)
        .flatMap(src => forrasok(src, melyseg + 1));
    };
    for (const t of tags || []) {
      let hit = null;
      try { hit = SchemaStore.resolveTag(String(t).replace(OVERFLOW, '')); } catch { hit = null; }
      if (!hit) { egyeb.push(t); continue; }
      const kulcsok = forrasok(hit.field, 0);
      const uresek = hit.field.type === 'computed' ? kulcsok.filter(ures) : kulcsok;
      (uresek.length ? uresek : kulcsok).forEach(k => mezok.add(k));
    }
    return { mezok: [...mezok], egyeb };
  }

  /**
   * Pótolva-e azóta a jelölő a dolgozó MOSTANI adataival? A napló így nem
   * statikus lista: javítás után látszik, hogy a hiány megszűnt. A „nem fér el”
   * jelölés nem hiány (volt adat), arra nincs mit pótolni → false.
   */
  function potolva(tag, fields) {
    if (String(tag).endsWith(OVERFLOW)) return false;
    try {
      const v = SchemaStore.renderTag(tag, fields || {});
      return v != null && String(v).trim() !== '';
    } catch { return false; }
  }

  function nevOf(emp) {
    const v = SchemaStore.resolveValues(emp.fields, 'hu');
    return v.full_name || v.surname || v.forename || '(névtelen)';
  }

  /**
   * Bejegyzés → dolgozó: azonosítóval, a régi bejegyzésnél egyértelmű névvel.
   * A névindex egyszer épül (lustán): soronként az összes dolgozó nevét
   * feloldani volt a lassú napló egyik oka.
   */
  function dolgozoKereso() {
    let index = null;
    return e => {
      try {
        if (e.employeeId) return EmployeeRepo.get(e.employeeId);
        if (!index) {
          index = new Map();
          for (const emp of EmployeeRepo.all()) {
            const n = nevOf(emp);
            index.set(n, index.has(n) ? null : emp);   // két azonos név → nem találgatunk
          }
        }
        return index.get(e.client) || null;
      } catch { return null; }
    };
  }
  const dolgozoja = e => dolgozoKereso()(e);

  function irhatNyilvantartast() {
    return typeof Auth === 'undefined' || Auth.can('registry.write') || Auth.can('registry.write.hr');
  }

  /**
   * A hiánypótló szerkesztő — CSAK innen nyitható (a `hianyzo` opciót más hívó
   * nem adja át). Mentés után visszaolvasás a tárolóból, és a napló frissítve
   * nyílik újra; Mégse → vissza a naplóhoz.
   */
  function javit(e, emp) {
    const { mezok, egyeb } = mezokreBont(e.emptyTags, emp.fields);
    EmployeeForm.open({
      id: emp.id,
      source: 'hianynaplo',
      hianyzo: { mezok, egyeb, sablon: e.template || '', forditatlan: e.untranslatedTags || [] },
      onSave: async () => {
        try {
          const elteres = await EmployeeRepo.verifyStored([emp.id]);
          toast(elteres.length
            ? '⚠ A módosítás NEM került a tárolóba — ellenőrizd az adatmappát!'
            : '✓ Mentve, és visszaolvasva a nyilvántartásból', elteres.length ? 'error' : 'success');
        } catch (err) {
          toast('A mentés nem sikerült: ' + err.message, 'error');
        }
        showMissingLogDialog({ marad: true });
      },
      onCancel: () => showMissingLogDialog({ marad: true }),
      cancelLabel: 'Vissza a naplóhoz',
    });
  }

  // A lap és a görgetés a szerkesztőből visszatérve megmarad.
  let oldal = 0, gorgetes = 0;

  /** `opts.marad`: ugyanaz a lap és görgetés (a gombtól Event érkezik — az nem az). */
  function showMissingLogDialog(opts) {
    const marad = !!(opts && opts.marad === true);
    if (!marad) { oldal = 0; gorgetes = 0; }
    const isAdmin  = Settings.isAdmin();
    const allLogs  = Settings.get(MISSING_LOG_KEY, []);
    // Admin látja az összes bejegyzést, többi felhasználó csak a sajátját
    const logs = isAdmin ? allLogs : allLogs.filter(e => e.user === currentUser());

    const colFiok = isAdmin ? `<th style="min-width:100px">Fiók</th>` : '';
    const irhat = irhatNyilvantartast();
    const lapok = Math.max(1, Math.ceil(logs.length / OLDAL));
    oldal = Math.min(oldal, lapok - 1);
    // Legfrissebb elöl; csak a látható lap sorai értékelődnek ki
    const shown = logs.slice().reverse().slice(oldal * OLDAL, (oldal + 1) * OLDAL);
    const keres = dolgozoKereso();
    const lapozo = logs.length > OLDAL ? `
        <div class="ml-pager">
          <button type="button" class="btn btn-ghost btn-sm" data-ml-page="-1" ${oldal === 0 ? 'disabled' : ''}>‹ Újabbak</button>
          <span>${oldal * OLDAL + 1}–${Math.min((oldal + 1) * OLDAL, logs.length)} / ${logs.length} bejegyzés</span>
          <button type="button" class="btn btn-ghost btn-sm" data-ml-page="1" ${oldal >= lapok - 1 ? 'disabled' : ''}>Régebbiek ›</button>
        </div>` : '';
    const rows = logs.length
      ? shown.map((e, i) => {
          const emp = keres(e);
          const fields = emp ? emp.fields : null;
          const pot = t => !!fields && potolva(t, fields);
          const mind = !!fields && (e.emptyTags || []).length > 0 && (e.emptyTags || []).every(pot);
          const d = e.ts ? new Date(e.ts).toLocaleString('hu-HU', { dateStyle:'short', timeStyle:'short' }) : '—';
          const fiokCol = isAdmin ? `<td style="font-size:11px">${escHtml(e.user || '—')}</td>` : '';
          return `<tr>
            <td style="white-space:nowrap;font-size:11px">${escHtml(d)}</td>
            ${fiokCol}
            <td style="font-size:11px">${escHtml(e.client || '—')}</td>
            <td style="font-size:11px">${escHtml(e.template || '—')}</td>
            <td style="font-size:11px">
              <div style="display:flex;flex-wrap:wrap;gap:3px">
                ${(e.emptyTags || []).map(t => pot(t)
                  ? `<span class="ml-tag is-potolva" title="Azóta pótolva">${escHtml(t)}</span>`
                  : `<span class="ml-tag">${escHtml(t)}</span>`
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
            <td style="white-space:nowrap">
              ${mind ? '<span class="ml-ok">✓ pótolva</span>' : ''}
              ${emp && irhat
                ? `<button type="button" class="btn btn-ghost btn-sm" data-ml-fix="${i}"
                     title="A dolgozó adatlapja, a hiányzó mezők kijelölve">Javítás</button>`
                : `<span class="ml-na" title="${escHtml(emp ? 'Nincs írási jogod a nyilvántartáshoz.'
                     : 'A dolgozó nem azonosítható (törölt, vagy több azonos nevű van).')}">—</span>`}
            </td>
          </tr>`;
        }).join('')
      : `<tr><td colspan="${isAdmin ? 7 : 6}" style="text-align:center;padding:20px;color:var(--c-muted);font-size:12px">
           Még nincs naplóbejegyzés${isAdmin ? '' : ' ehhez a fiókhoz'}.
         </td></tr>`;

    showDialog({
      title: isAdmin ? 'Hiányzó adatok naplója — összes fiók' : `Hiányzó adatok naplója — ${currentUser()}`,
      body: `
        <div style="font-size:11px;color:var(--c-muted);margin-bottom:10px">
          <b>Hiányzó mezők:</b> amikre a generáláskor nem volt adat.<br>
          <b>Fordítatlan:</b> volt adat, de angol alakot kérő jelölőhöz nem volt
          szótári pár — a MAGYAR szöveg került az angol rovatba.
          Pótolható: Beállítások → Szótár.
          <br><b>Javítás:</b> megnyitja a dolgozó adatlapját, a hiányzó mezők kijelölve.
          A zölddel áthúzott mező azóta pótolva van.
          ${isAdmin ? '<br>Admin nézetként az összes fiók bejegyzése látható.' : ''}
        </div>
        ${lapozo}
        <div class="data-table-wrap" id="ml-wrap" style="max-height:480px">
          <table class="data-table">
            <thead>
              <tr>
                <th style="min-width:110px">Dátum</th>
                ${colFiok}
                <th style="min-width:120px">Ügyfél</th>
                <th style="min-width:140px">Sablon</th>
                <th>Hiányzó mezők</th>
                <th>Fordítatlan</th>
                <th></th>
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

    const wrap = document.getElementById('ml-wrap');
    if (wrap && marad) wrap.scrollTop = gorgetes;
    document.querySelectorAll('#dialog-overlay [data-ml-fix]').forEach(b => {
      b.addEventListener('click', () => {
        const e = shown[Number(b.dataset.mlFix)];
        const emp = e && keres(e);
        if (wrap) gorgetes = wrap.scrollTop;
        if (emp) javit(e, emp);
      });
    });
    document.querySelectorAll('#dialog-overlay [data-ml-page]').forEach(b => {
      b.addEventListener('click', () => {
        oldal += Number(b.dataset.mlPage);
        gorgetes = 0;
        showMissingLogDialog({ marad: true });
      });
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

  return { append: appendMissingLog, showDialog: showMissingLogDialog, KEY: MISSING_LOG_KEY,
           mezokreBont, potolva, dolgozoja, MAX_TAROLT };
})();
