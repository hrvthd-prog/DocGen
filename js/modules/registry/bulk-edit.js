'use strict';

/**
 * Tömeges szerkesztés — ugyanaz az érték több dolgozónál, egy lépésben
 * (TERV-tomeges-ugyintezes.md 12.).
 *
 * A Nyilvántartás kijelölésére hat: mezők és új értékek → összesítő (régi →
 * új, a törlődők jelölve) → jóváhagyás → írás az `EmployeeRepo.update` útján
 * (napló, validáció, mentés, mint az importnál), majd visszaolvasás a
 * tárolóból. Ügy nem keletkezik.
 *
 * A `terv` / `alkalmaz` a tömeges ügy (BulkCase) közös magja is: az a
 * szálláshely-csoportra hívja, és utána ügyet is nyit.
 */
const BulkEdit = (() => {

  const SOURCE = 'tomeges_szerk';
  const str = x => String(x == null ? '' : x).trim();

  function nevOf(emp) {
    if (!emp) return '(törölt személy)';
    const v = SchemaStore.resolveValues(emp.fields, 'hu');
    return [v.surname, v.forename].filter(Boolean).join(' ') || '(névtelen)';
  }

  // ── Logika ─────────────────────────────────────────────────────────────────

  /**
   * A tömegesen szerkeszthető mezők. Ami kimarad, és miért:
   *   – számított mező: nincs mit beírni;
   *   – azonosítóból tükrözött mező (SAP, útlevélszám…): egyedi, és az
   *     azonosító-blokk a forrása;
   *   – név és születési dátum: a dolgozó azonossága, sosem közös;
   *   – közvetlen vezető: saját tömeges eszköze van (fiók-választóval);
   *   – amit a mostani szint nem írhat (`Auth.canWriteGroup`).
   */
  function szerkesztheto() {
    const tilt = new Set([...Object.values(EmployeeRepo.IDENTIFIER_FIELD_MAP),
                          ...EmployeeRepo.NATURAL_KEY_FIELDS]);
    if (typeof Leaders !== 'undefined') tilt.add(Leaders.FIELD);
    return SchemaStore.fields({ includeComputed: false }).filter(f =>
      !tilt.has(f.key) && (typeof Auth === 'undefined' || Auth.canWriteGroup(f.group)));
  }

  /**
   * Mi fog változni a megadott mezőkön? Semmit nem módosít.
   * A felvett mező üres értéke TÖRÖL — ezt az összesítő külön jelzi. A
   * validáció csak ezekre a mezőkre szól: egy máshol hiányzó kötelező mező nem
   * akaszthatja meg a módosítást.
   *
   * → [{ emp, nev, uj, utana, valtozasok: [{key, label, from, to}], hibak }]
   */
  function terv(kulcsok, employeeIds, ujErtekek = {}) {
    return employeeIds.map(id => EmployeeRepo.get(id)).filter(Boolean).map(emp => {
      const uj = {};
      for (const k of kulcsok) uj[k] = str(ujErtekek[k]);
      const utana = Object.assign({}, emp.fields, uj);
      const valtozasok = kulcsok
        .filter(k => str(emp.fields[k]) !== uj[k])
        .map(k => ({ key: k, label: SchemaStore.field(k).label.hu, from: str(emp.fields[k]), to: uj[k] }));
      const hibak = SchemaStore.validateValues(utana)
        .filter(p => kulcsok.includes(p.key)).map(p => p.message);
      return { emp, nev: nevOf(emp), uj, utana, valtozasok, hibak };
    });
  }

  /**
   * A jóváhagyott terv írása, majd VISSZAOLVASÁS a tárolóból.
   * → { hibak: [{id, nev, uzenet}], nemMentett: [nev] }
   */
  async function alkalmaz(sorok, source = SOURCE) {
    const hibak = [];
    for (const s of sorok) {
      if (!s.valtozasok.length) continue;
      try { EmployeeRepo.update(s.emp.id, { fields: s.uj, source }); }
      catch (e) { hibak.push({ id: s.emp.id, nev: s.nev, uzenet: e.message }); }
    }
    const elteres = await EmployeeRepo.verifyStored(sorok.map(s => s.emp.id));
    return { hibak, nemMentett: elteres.map(id => nevOf(EmployeeRepo.get(id))) };
  }

  /** Egy mező beviteli eleme (szöveg / legördülő / dátum), mint az űrlapon. */
  function mezoHtml(f, ertek, elotag) {
    const id = elotag + f.key;
    const val = str(ertek);
    let input;
    if (f.type === 'enum') {
      const opts = ValueCodec.options(f, 'hu');
      input = `<select class="field-select" id="${id}" data-key="${escHtml(f.key)}">
          <option value="">—</option>
          ${opts.map(o => `<option value="${escHtml(o.id)}"${o.id === val ? ' selected' : ''}>${escHtml(o.label)}</option>`).join('')}
        </select>`;
    } else if (f.type === 'date') {
      input = dateFieldHtml({ id, key: f.key, value: val });
    } else {
      input = `<input type="text" class="field-input" id="${id}" data-key="${escHtml(f.key)}" value="${escHtml(val)}">`;
    }
    return `
      <label class="ef-field" for="${id}">
        <span class="ef-label">${escHtml(f.label.hu)}${f.required ? '<span class="ef-req">*</span>' : ''}</span>
        ${input}
      </label>`;
  }

  // ── Felület ────────────────────────────────────────────────────────────────

  let st = null;     // { ids, kulcsok: [], ertekek: {} } — a párbeszédek között él

  /** A Nyilvántartás kijelöltjeire. */
  function open(ids) {
    st = { ids: ids.slice(), kulcsok: [], ertekek: {} };
    szerkeszto();
  }

  function szerkeszto() {
    const mezok = szerkesztheto();
    const valaszthato = SchemaStore.groups()
      .map(g => ({ g, f: mezok.filter(f => f.group === g.key && !st.kulcsok.includes(f.key)) }))
      .filter(x => x.f.length);
    const nevek = st.ids.map(id => nevOf(EmployeeRepo.get(id)));

    showDialog({
      title: `Tömeges szerkesztés — ${st.ids.length} dolgozó`,
      body: `
        <div class="bk-chips">${nevek.slice(0, 30).map(n => `<span class="bk-chip">${escHtml(n)}</span>`).join('')}${
          nevek.length > 30 ? `<span class="bk-chip is-more">+${nevek.length - 30}</span>` : ''}</div>
        <div class="be-add">
          <select class="field-select" id="be-add">
            <option value="">+ Mező hozzáadása…</option>
            ${valaszthato.map(x => `
              <optgroup label="${escHtml(x.g.label)}">
                ${x.f.length > 1 ? `<option value="g:${escHtml(x.g.key)}">Az egész csoport (${x.f.length} mező)</option>` : ''}
                ${x.f.map(f => `<option value="f:${escHtml(f.key)}">${escHtml(f.label.hu)}</option>`).join('')}
              </optgroup>`).join('')}
          </select>
        </div>
        ${st.kulcsok.length
          ? `<div class="ef-grid be-grid">${st.kulcsok.map(k => `
              <div class="be-field">
                ${mezoHtml(SchemaStore.field(k), st.ertekek[k], 'be-f-')}
                <button type="button" class="be-del" data-be-del="${escHtml(k)}" title="A mező kivétele">×</button>
              </div>`).join('')}</div>`
          : ''}
        <p class="bk-hint">Csak a felvett mezők változnak, mindenkinél ugyanarra az értékre. A felvett,
          de <b>üresen hagyott</b> mező törlődik. Nem szerkeszthető itt: név, születési dátum, az
          azonosítók (az Azonosítók blokkból jönnek) és a közvetlen vezető (arra a
          „Közvetlen vezető…” gomb való).</p>
        <div class="bk-err" id="be-err"></div>`,
      footer: `
        <button class="btn btn-ghost btn-sm" onclick="closeDialog()">Mégse</button>
        <button class="btn btn-primary btn-sm" id="be-review" ${st.kulcsok.length ? '' : 'disabled'}>Mi fog változni? — összesítő…</button>`,
    });

    const d = s => document.querySelector('#dialog-overlay ' + s);
    d('#be-add').addEventListener('change', e => {
      const v = e.target.value;
      if (!v) return;
      const uj = v.startsWith('g:')
        ? mezok.filter(f => f.group === v.slice(2)).map(f => f.key)
        : [v.slice(2)];
      for (const k of uj) if (!st.kulcsok.includes(k)) st.kulcsok.push(k);
      szerkeszto();
    });
    document.querySelectorAll('#dialog-overlay [data-be-del]').forEach(b => b.addEventListener('click', e => {
      e.preventDefault();
      st.kulcsok = st.kulcsok.filter(k => k !== b.dataset.beDel);
      delete st.ertekek[b.dataset.beDel];
      szerkeszto();
    }));
    // Mikrotaszkban: a dátummaszk (utils.js) a mi figyelőnk UTÁN alakít
    document.querySelectorAll('#dialog-overlay .be-grid [data-key]').forEach(el => {
      const ment = () => queueMicrotask(() => { st.ertekek[el.dataset.key] = el.value; });
      el.addEventListener('input', ment);
      el.addEventListener('change', ment);
    });
    d('#be-review').addEventListener('click', osszesito);
  }

  function osszesito() {
    // A mezők aktuális értéke (a maszkolt dátum is) — nem csak a figyelőkre bízzuk
    document.querySelectorAll('#dialog-overlay .be-grid [data-key]').forEach(el => {
      st.ertekek[el.dataset.key] = el.value;
    });
    const sorok = terv(st.kulcsok, st.ids, st.ertekek);
    const hibak = [...new Set(sorok.flatMap(s => s.hibak))];
    if (hibak.length) {
      document.getElementById('be-err').innerHTML = hibak.map(escHtml).join('<br>');
      return;
    }
    const valtozik = sorok.filter(s => s.valtozasok.length);

    showDialog({
      title: `Összesítő — ${sorok.length} dolgozó`,
      body: `
        <div class="bk-dlg-head">${valtozik.length} dolgozónál változik adat${
          sorok.length - valtozik.length ? `, ${sorok.length - valtozik.length} dolgozónál már ez az érték áll` : ''}.</div>
        <div class="data-table-wrap" style="max-height:56vh">
          <table class="data-table bk-dlg-table">
            <thead><tr><th>Dolgozó</th><th>Változás</th></tr></thead>
            <tbody>${sorok.map(s => `
              <tr>
                <td><b>${escHtml(s.nev)}</b></td>
                <td>${s.valtozasok.length ? s.valtozasok.map(v => {
                    const f = SchemaStore.field(v.key);
                    // Enum és dátum olvasható alakban; a szöveg úgy, ahogy tárolva lesz
                    const r = x => x ? escHtml(f.type === 'text' ? x : (SchemaStore.renderValue(f, x, 'hu') || x)) : '—';
                    return `<div><span class="bk-muted">${escHtml(v.label)}:</span> ${r(v.from)} →
                      ${v.to ? `<b>${r(v.to)}</b>` : '<b class="bk-del">(törlődik)</b>'}</div>`;
                  }).join('')
                  : '<span class="bk-muted">nincs változás</span>'}</td>
              </tr>`).join('')}</tbody>
          </table>
        </div>
        <p class="ef-hint">Jóváhagyás után a nyilvántartásba íródik (a változásnaplóban „tömeges
          szerkesztés” forrással), majd a program visszaolvassa a tárolóból.</p>`,
      footer: `
        <button class="btn btn-ghost btn-sm" id="be-back">‹ Vissza</button>
        <button class="btn btn-primary btn-sm" id="be-confirm" ${valtozik.length ? '' : 'disabled'}>Jóváhagyom és rögzítem</button>`,
    });
    document.getElementById('be-back').addEventListener('click', szerkeszto);
    const gomb = document.getElementById('be-confirm');
    gomb.addEventListener('click', async () => {
      gomb.disabled = true;
      gomb.textContent = 'Rögzítés…';
      try {
        const r = await alkalmaz(sorok);
        BevLogger.info('TOMEGES_SZERK', `Tömeges szerkesztés: ${valtozik.length} dolgozó`,
          `mezok=${st.kulcsok.join('|')}, hibak=${r.hibak.length}, nemMentett=${r.nemMentett.length}`, '');
        if (!r.hibak.length && !r.nemMentett.length) {
          closeDialog();
          toast(`✓ ${valtozik.length} dolgozó adata mentve, és visszaolvasva`, 'success');
          return;
        }
        showDialog({
          title: 'A tömeges szerkesztés részben sikerült',
          body: `
            ${r.hibak.length ? `<p>Nem módosult:</p><ul class="bk-errlist">${r.hibak.map(h =>
              `<li><b>${escHtml(h.nev)}</b>: ${escHtml(h.uzenet)}</li>`).join('')}</ul>` : ''}
            ${r.nemMentett.length ? `<div class="bk-warn">⚠ Visszaolvasáskor eltérés — ezek NEM kerültek
              a tárolóba: ${r.nemMentett.map(escHtml).join(', ')}. Ellenőrizd az adatmappát, és töltsd újra.</div>` : ''}`,
          footer: '<button class="btn btn-primary btn-sm" onclick="closeDialog()">Rendben</button>',
        });
      } catch (e) {
        gomb.disabled = false;
        gomb.textContent = 'Jóváhagyom és rögzítem';
        toast('A mentés nem sikerült: ' + e.message, 'error');
      }
    });
  }

  return { SOURCE, szerkesztheto, terv, alkalmaz, mezoHtml, open };
})();
