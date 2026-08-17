'use strict';

/**
 * Beállítások fül – jelenleg a séma-szerkesztő.
 *
 * Itt válik kézzelfoghatóvá, hogy a séma adat és nem kód: mező felvehető,
 * átnevezhető, törölhető, enum-érték bővíthető – mindez kódmódosítás nélkül.
 * A veszélyes műveleteket védőkorlátok kísérik, mert enélkül a szabad
 * szerkeszthetőség adatvesztéssé válna.
 */
const SettingsModule = (() => {

  let container = null;

  function init(el) {
    container = el;
    render();
    SchemaStore.onChange(() => { renderFieldList(); renderDictionary(); });
  }

  // ── Váz ────────────────────────────────────────────────────────────────────

  function render() {
    container.innerHTML = `
      <div class="workspace">
        <div class="workspace-col">
          <div class="ws-card">
            <div class="ws-card-header">
              <span class="ws-card-title">Adatmezők</span>
              <span id="sv-schema-info" class="rg-count"></span>
            </div>
            <div class="ws-card-body">
              <p class="sv-intro">
                Az adatkör itt bővíthető és módosítható. A mezők sorrendje egyben
                az xlsx-export oszlopsorrendje is.
              </p>
              <div class="sv-toolbar">
                <button class="btn btn-primary btn-sm" id="sv-add">Új mező</button>
                <label class="btn btn-ghost btn-sm sv-file-btn">
                  Séma összevetése adatbekérővel…
                  <input type="file" id="sv-xlsx" accept=".xlsx,.xlsm" hidden>
                </label>
                <span id="sv-problems" class="sv-problems"></span>
              </div>
              <div id="sv-fields"></div>
            </div>
          </div>

          <div class="ws-card">
            <div class="ws-card-header">
              <span class="ws-card-title">Szótár</span>
              <span id="sv-dict-info" class="rg-count"></span>
            </div>
            <div class="ws-card-body">
              <p class="sv-intro">
                Angol↔magyar megfeleltetés a szabad szöveges mezőkhöz: ország,
                munkakör, állampolgárság, szakképesítés. A kitöltő angolul írja
                be, a magyar iratba a magyar alak kerül – ezért nem kell két
                oszlop ugyanarra az adatra.
              </p>
              <p class="ef-hint">
                Soronként egy pár: <code>angol = magyar</code>.
                Tabulátor és pontosvessző is elválasztó, így két Excel-oszlop
                közvetlenül beilleszthető. A jelölők:
                <code>{{previous_country}}</code> és
                <code>{{previous_country_hun}}</code> magyarul,
                <code>{{previous_country_eng}}</code> az eredeti beírás szerint.
              </p>
              <textarea id="sv-dict" class="field-input sv-dict" rows="12" spellcheck="false"
                        placeholder="Serbia = Szerbia&#10;Ukraine = Ukrajna&#10;welder = hegesztő"></textarea>
              <div class="sv-toolbar">
                <button class="btn btn-primary btn-sm" id="sv-dict-save">Szótár mentése</button>
                <span id="sv-dict-state" class="sv-problems"></span>
              </div>
            </div>
          </div>

          ${verzioKartya()}
        </div>
      </div>`;

    document.getElementById('sv-add').addEventListener('click', () => openFieldDialog(null));
    document.getElementById('sv-xlsx').addEventListener('change', onXlsxPicked);
    document.getElementById('sv-dict-save').addEventListener('click', saveDictionary);
    renderFieldList();
    renderDictionary();
  }

  /**
   * Verzió-kártya. Ha valaki azt mondja, hogy „nálam másképp működik", itt
   * derül ki egy pillanat alatt, hogy melyik kódot futtatja.
   *
   * Az app a használat helyén egy izolált gépen, hálózat nélkül fut – ezért
   * itt nincs link és nincs git-fogalom: a szám és a dátum önmagában elég
   * ahhoz, hogy a fejlesztői oldalon egyértelmű legyen, melyik kiadásról van
   * szó. A visszakeresést a repóban a `v<szám>` tag adja.
   */
  function verzioKartya() {
    const v = window.APP_VERZIO;
    if (!v) return '';
    return `
      <div class="ws-card">
        <div class="ws-card-header">
          <span class="ws-card-title">Verzió</span>
          <span class="rg-count">${escHtml(v.datum)}</span>
        </div>
        <div class="ws-card-body">
          <p class="sv-intro">
            Ez a gép a <b>${escHtml(v.verzio)}</b> verziót futtatja,
            kiadva ${escHtml(v.datum)}.
          </p>
          <p class="ef-hint">
            Hibajelentésnél add meg ezt a számot – ebből derül ki, hogy a
            hiba a jelenlegi kiadásban van-e, vagy egy régebbi másolatban.
          </p>
        </div>
      </div>`;
  }

  // ── Szótár ─────────────────────────────────────────────────────────────────

  function renderDictionary() {
    const ta = document.getElementById('sv-dict');
    if (!ta || !schemaReady()) return;
    const parok = SchemaStore.dictionary();
    ta.value = parok.map(e => `${e.en} = ${e.hu}`).join('\n');
    const info = document.getElementById('sv-dict-info');
    if (info) info.textContent = `${parok.length} pár`;
  }

  /** „Serbia = Szerbia", „Serbia<TAB>Szerbia" és „Serbia;Szerbia" is jó. */
  function parseDictionary(text) {
    const parok = [];
    const hibas = [];
    text.split(/\r?\n/).forEach((sor, i) => {
      if (!sor.trim()) return;
      const m = /^([^=\t;]+)[=\t;](.*)$/.exec(sor);
      const en = m ? m[1].trim() : '';
      const hu = m ? m[2].trim() : '';
      if (!en || !hu) { hibas.push(i + 1); return; }
      parok.push({ en, hu });
    });
    return { parok, hibas };
  }

  function saveDictionary() {
    if (!schemaReady()) { toast('A séma még nem töltődött be.', 'error'); return; }
    const { parok, hibas } = parseDictionary(document.getElementById('sv-dict').value);
    const allapot = document.getElementById('sv-dict-state');

    if (hibas.length) {
      allapot.textContent = `${hibas.length} értelmezhetetlen sor (${hibas.slice(0, 5).join(', ')}${hibas.length > 5 ? '…' : ''}) – nem mentettem`;
      return;
    }

    const mentett = SchemaStore.setDictionary(parok);
    SchemaStore.save();
    const eldobott = parok.length - mentett.length;
    allapot.textContent = eldobott ? `${eldobott} ismétlődő angol alak kimaradt` : '';
    renderDictionary();
    toast(`Szótár mentve – ${mentett.length} pár`, 'success');
  }

  function schemaReady() {
    try { SchemaStore.get(); return true; } catch { return false; }
  }

  function renderFieldList() {
    const box = document.getElementById('sv-fields');
    if (!box) return;
    if (!schemaReady()) {
      box.innerHTML = bevEmptyState('A séma még nem töltődött be. Nyisd meg egyszer a Nyilvántartás fület.');
      return;
    }

    const info = document.getElementById('sv-schema-info');
    if (info) info.textContent = `${SchemaStore.storedFields().length} mező · séma v${SchemaStore.version()}`;

    const problems = SchemaStore.validateSchema();
    const pEl = document.getElementById('sv-problems');
    if (pEl) {
      pEl.textContent = problems.length ? `${problems.length} ellentmondás` : '';
      pEl.title = problems.join('\n');
    }

    const groups = SchemaStore.byGroup({ includeComputed: true });
    box.innerHTML = groups.map(g => `
      <section class="sv-group">
        <h4 class="sv-group-title">${escHtml(g.group.label)}</h4>
        <div class="sv-list">
          ${g.fields.map(renderFieldRow).join('')}
        </div>
      </section>`).join('');

    box.querySelectorAll('[data-edit]').forEach(b =>
      b.addEventListener('click', () => openFieldDialog(b.dataset.edit)));
    box.querySelectorAll('[data-up]').forEach(b =>
      b.addEventListener('click', () => moveField(b.dataset.up, -1)));
    box.querySelectorAll('[data-down]').forEach(b =>
      b.addEventListener('click', () => moveField(b.dataset.down, 1)));
  }

  function renderFieldRow(f) {
    const tipus = {
      text: 'szöveg', date: 'dátum', number: 'szám',
      enum: 'választható', computed: 'számított',
    }[f.type] || f.type;

    const reszlet = f.type === 'enum'
      ? f.values.map(v => escHtml(v.hu)).join(' · ')
      : f.type === 'computed'
        ? f.computed.from.join(' + ')
        : '';

    return `
      <div class="sv-row">
        <span class="sv-row-label">
          ${escHtml(f.label.hu)}${f.required ? '<span class="ef-req">*</span>' : ''}
          <span class="sv-key">${escHtml(f.key)}</span>
        </span>
        <span class="sv-type">${escHtml(tipus)}</span>
        <span class="sv-detail" title="${escHtml(reszlet)}">${escHtml(reszlet)}</span>
        <span class="sv-row-actions">
          <button class="sv-move" data-up="${escHtml(f.key)}" title="Előrébb">↑</button>
          <button class="sv-move" data-down="${escHtml(f.key)}" title="Hátrébb">↓</button>
          <button class="btn btn-ghost btn-sm" data-edit="${escHtml(f.key)}">Szerkesztés</button>
        </span>
      </div>`;
  }

  function moveField(key, dir) {
    const s = SchemaStore.get();
    const i = s.fields.findIndex(f => f.key === key);
    const j = i + dir;
    if (i === -1 || j < 0 || j >= s.fields.length) return;
    [s.fields[i], s.fields[j]] = [s.fields[j], s.fields[i]];
    SchemaStore.save();
    renderFieldList();
  }

  // ── Mezőszerkesztő ─────────────────────────────────────────────────────────

  function openFieldDialog(key) {
    const f = key ? SchemaStore.field(key) : null;
    const groups = SchemaStore.groups();
    const uj = !f;

    showDialog({
      title: uj ? 'Új mező' : `Mező szerkesztése – ${f.label.hu}`,
      body: `
        <div class="sv-form">
          <label class="ef-field">
            <span class="ef-label">Megnevezés (magyar)</span>
            <input type="text" class="field-input" id="fd-hu" value="${escHtml(f ? f.label.hu : '')}">
          </label>
          <label class="ef-field">
            <span class="ef-label">Megnevezés (angol)</span>
            <input type="text" class="field-input" id="fd-en" value="${escHtml(f ? f.label.en : '')}">
          </label>
          <label class="ef-field">
            <span class="ef-label">Kulcs${uj ? '' : ' (átnevezés a rekordokat is átmozgatja)'}</span>
            <input type="text" class="field-input" id="fd-key" value="${escHtml(f ? f.key : '')}">
          </label>
          <label class="ef-field">
            <span class="ef-label">Csoport</span>
            <select class="field-select" id="fd-group">
              ${groups.map(g => `<option value="${escHtml(g.key)}"${f && f.group === g.key ? ' selected' : ''}>${escHtml(g.label)}</option>`).join('')}
            </select>
          </label>
          <label class="ef-field">
            <span class="ef-label">Típus</span>
            <select class="field-select" id="fd-type">
              ${['text', 'date', 'number', 'enum'].map(t =>
                `<option value="${t}"${f && f.type === t ? ' selected' : ''}>${
                  { text: 'szöveg', date: 'dátum', number: 'szám', enum: 'választható' }[t]}</option>`).join('')}
            </select>
          </label>
          <label class="check-row sv-req-row">
            <input type="checkbox" id="fd-req"${f && f.required ? ' checked' : ''}>
            <span>Kötelező mező</span>
          </label>
          <label class="ef-field sv-wide">
            <span class="ef-label">Dokumentum-jelölők (vesszővel elválasztva)</span>
            <input type="text" class="field-input" id="fd-tags" value="${escHtml(f ? (f.tags || []).join(', ') : '')}">
          </label>
          <div class="sv-wide" id="fd-enum-wrap" style="display:${f && f.type === 'enum' ? '' : 'none'}">
            <span class="ef-label">Választható értékek</span>
            <p class="ef-hint">
              Az „elfogadott írásmódok" azt sorolja, ahogyan az érték egy importált
              táblázatban szerepelhet – így a magyar és az angol változat is felismerhető.
            </p>
            <div id="fd-enum-list"></div>
            <button type="button" class="btn btn-ghost btn-sm" id="fd-enum-add">Érték hozzáadása</button>
          </div>
          ${f && f.type === 'computed' ? `
            <p class="ef-hint sv-wide">Ez egy számított mező (${escHtml(f.computed.from.join(' + '))}),
               a típusa nem módosítható itt.</p>` : ''}
        </div>`,
      footer: `
        <span id="fd-error" class="ef-error"></span>
        ${uj ? '' : '<button class="btn btn-danger btn-sm" id="fd-delete">Törlés</button>'}
        <button class="btn btn-ghost btn-sm" onclick="closeDialog()">Mégse</button>
        <button class="btn btn-primary btn-sm" id="fd-save">Mentés</button>`,
    });

    let enumValues = f && f.type === 'enum'
      ? JSON.parse(JSON.stringify(f.values))
      : [];

    renderEnumList();

    document.getElementById('fd-type').addEventListener('change', e => {
      const wrap = document.getElementById('fd-enum-wrap');
      wrap.style.display = e.target.value === 'enum' ? '' : 'none';
    });
    document.getElementById('fd-enum-add').addEventListener('click', () => {
      enumValues.push({ id: '', hu: '', en: '', accepts: [] });
      renderEnumList();
    });
    document.getElementById('fd-save').addEventListener('click', () => saveField(f));
    document.getElementById('fd-delete')?.addEventListener('click', () => deleteField(f));

    function renderEnumList() {
      const box = document.getElementById('fd-enum-list');
      if (!box) return;
      box.innerHTML = enumValues.map((v, i) => `
        <div class="sv-enum-row">
          <input type="text" class="field-input" data-ev="id"      data-i="${i}" value="${escHtml(v.id)}"  placeholder="tárolt érték">
          <input type="text" class="field-input" data-ev="hu"      data-i="${i}" value="${escHtml(v.hu)}"  placeholder="magyar">
          <input type="text" class="field-input" data-ev="en"      data-i="${i}" value="${escHtml(v.en)}"  placeholder="angol">
          <input type="text" class="field-input" data-ev="accepts" data-i="${i}" value="${escHtml((v.accepts || []).join(', '))}" placeholder="elfogadott írásmódok">
          <button type="button" class="ef-id-del" data-ev-del="${i}" title="Sor törlése">&times;</button>
        </div>`).join('');

      box.querySelectorAll('[data-ev]').forEach(inp => {
        inp.addEventListener('input', () => {
          const i = Number(inp.dataset.i), k = inp.dataset.ev;
          if (k === 'accepts') {
            enumValues[i].accepts = inp.value.split(',').map(s => s.trim()).filter(Boolean);
          } else {
            enumValues[i][k] = inp.value;
          }
        });
      });
      box.querySelectorAll('[data-ev-del]').forEach(b => {
        b.addEventListener('click', () => {
          enumValues.splice(Number(b.dataset.evDel), 1);
          renderEnumList();
        });
      });
    }

    function saveField(orig) {
      const hu   = document.getElementById('fd-hu').value.trim();
      const en   = document.getElementById('fd-en').value.trim();
      const key  = document.getElementById('fd-key').value.trim();
      const grp  = document.getElementById('fd-group').value;
      const type = document.getElementById('fd-type').value;
      const req  = document.getElementById('fd-req').checked;
      const tags = document.getElementById('fd-tags').value.split(',').map(s => s.trim()).filter(Boolean);

      if (!hu)  return setErr('A magyar megnevezés kötelező.');
      if (!key) return setErr('A kulcs kötelező.');
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) {
        return setErr('A kulcs betűvel kezdődjön, és csak betűt, számot vagy aláhúzást tartalmazzon.');
      }

      const s = SchemaStore.get();
      const utkozo = s.fields.find(x => x.key === key && x !== orig);
      if (utkozo) return setErr(`Már létezik mező ezzel a kulccsal: ${key}`);

      if (type === 'enum') {
        if (!enumValues.length) return setErr('Választható típushoz legalább egy érték kell.');
        for (const v of enumValues) {
          if (!v.id.trim()) return setErr('Minden értékhez kell tárolt érték.');
          if (!v.hu.trim()) v.hu = v.id;
          if (!v.en.trim()) v.en = v.id;
        }
      }

      if (orig) {
        if (orig.key !== key) {
          // Az adatok együtt mozognak a kulccsal
          try {
            const emps = EmployeeRepo.hasBackend() ? EmployeeRepo.all({ includeExited: true }) : [];
            const moved = SchemaStore.renameFieldKey(orig.key, key, emps);
            if (moved) EmployeeRepo.scheduleSave();
          } catch (e) { return setErr(e.message); }
        }
        const f2 = SchemaStore.field(key);
        f2.label = { hu, en };
        f2.group = grp;
        f2.required = req;
        f2.tags = tags;
        if (f2.type !== 'computed') {
          f2.type = type;
          if (type === 'enum') f2.values = enumValues;
          else delete f2.values;
        }
      } else {
        const nf = { key, group: grp, type, required: req, label: { hu, en }, tags };
        if (type === 'enum') nf.values = enumValues;
        s.fields.push(nf);
      }

      s.version = (s.version || 1) + 1;
      const gondok = SchemaStore.validateSchema();
      if (gondok.length) return setErr(gondok[0]);

      SchemaStore.save();
      closeDialog();
      toast(orig ? 'Mező módosítva' : 'Mező felvéve', 'success');
      renderFieldList();
    }

    function setErr(msg) {
      document.getElementById('fd-error').textContent = msg;
      return false;
    }
  }

  /** Törlés csak azután, hogy látszik, mi veszne el. */
  function deleteField(f) {
    const emps = EmployeeRepo.hasBackend() ? EmployeeRepo.all({ includeExited: true }) : [];
    const u = SchemaStore.usageOf(f.key, emps);

    const figyelmeztetes = [];
    if (u.withData) figyelmeztetes.push(`<li><b>${u.withData}</b> rekordban van kitöltve ez a mező.</li>`);
    if (u.computedBy.length) {
      figyelmeztetes.push(`<li>Számított mező hivatkozik rá: <b>${u.computedBy.map(escHtml).join(', ')}</b>.</li>`);
    }

    showDialog({
      title: 'Mező törlése',
      body: `
        <p style="font-size:13px;margin-bottom:10px">
          Biztosan törlöd a(z) <b>${escHtml(f.label.hu)}</b> mezőt?
        </p>
        ${figyelmeztetes.length ? `<ul class="sv-warn-list">${figyelmeztetes.join('')}</ul>` : ''}
        <p class="ef-hint">
          A rekordokban lévő érték nem törlődik azonnal: megmarad, és ha a mezőt
          ugyanezzel a kulccsal visszaveszed, az adat is visszatér.
        </p>`,
      footer: `
        <button class="btn btn-ghost btn-sm" onclick="closeDialog()">Mégse</button>
        <button class="btn btn-danger btn-sm" id="fd-del-confirm">Törlés</button>`,
    });

    document.getElementById('fd-del-confirm').addEventListener('click', () => {
      const s = SchemaStore.get();
      s.fields = s.fields.filter(x => x.key !== f.key);
      s.version = (s.version || 1) + 1;
      SchemaStore.save();
      closeDialog();
      toast('Mező törölve', 'success');
      renderFieldList();
    });
  }

  // ── Séma összevetése adatbekérővel ─────────────────────────────────────────

  function onXlsxPicked(ev) {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    if (!schemaReady()) { toast('A séma még nem töltődött be.', 'error'); return; }

    file.arrayBuffer().then(buf => {
      let analysis;
      try { analysis = SchemaFromXlsx.analyze(buf); }
      catch (e) { toast('A fájl nem olvasható: ' + e.message, 'error'); return; }

      const d = SchemaFromXlsx.diff(analysis, SchemaStore.get());
      showDiffDialog(analysis, d);
    });
  }

  function showDiffDialog(analysis, d) {
    if (!d.hasChanges) {
      showDialog({
        title: 'Séma összevetése',
        body: `<p style="font-size:13px">A(z) <b>${escHtml(analysis.sheetName)}</b> munkalap
               szerkezete megegyezik az aktuális sémával. Nincs teendő.</p>`,
        footer: '<button class="btn btn-primary btn-sm" onclick="closeDialog()">Bezárás</button>',
      });
      return;
    }

    const szakasz = (cim, elemek, tipus, leiras) => elemek.length ? `
      <section class="sv-diff-sec">
        <h4 class="sv-group-title">${cim} (${elemek.length})</h4>
        ${leiras ? `<p class="ef-hint">${leiras}</p>` : ''}
        ${elemek.map(e => `
          <label class="check-row">
            <input type="checkbox" data-diff="${tipus}" value="${escHtml(e.key)}"
                   ${tipus === 'removed' ? 'disabled' : 'checked'}>
            <span>${e.html}</span>
          </label>`).join('')}
      </section>` : '';

    const body = `
      <div class="sv-diff">
        <p class="ef-hint">
          Az alábbi eltérések a(z) <b>${escHtml(analysis.sheetName)}</b> munkalap és az
          aktuális séma között. Válaszd ki, mit fogadsz el – az app magától semmit nem ír át.
        </p>
        ${szakasz('Új mező a fájlban', d.added.map(a => ({
          key: a.key,
          html: `<b>${escHtml(a.key)}</b>${a.labelEn ? ' – ' + escHtml(a.labelEn) : ''}${
            a.dropdown ? ` <i>(választható: ${escHtml(a.dropdown.join(', '))})</i>`
                       : a.isDate ? ' <i>(dátum)</i>' : ''}`,
        })), 'added')}
        ${szakasz('Dátumként ismert mező', (d.typeChanged || []).map(t => ({
          key: t.key,
          html: `<b>${escHtml(t.label)}</b> (${escHtml(t.key)}): ${escHtml(t.from)} → dátum`,
        })), 'typeChanged', 'A fájlban dátum, a séma szövegként tárolja – enélkül a dokumentumban nyersen (akár m/d/yy) jelenne meg.')}
        ${szakasz('Megváltozott választható értékek', d.enumChanged.map(e => ({
          key: e.key,
          html: `<b>${escHtml(e.label)}</b>: ${
            e.newValues.length ? 'új – ' + escHtml(e.newValues.join(', ')) + ' ' : ''}${
            e.goneValues.length ? 'megszűnt – ' + escHtml(e.goneValues.join(', ')) : ''}`,
        })), 'enumChanged', 'A meglévő magyar/angol fordítások és írásmódok megmaradnak.')}
        ${szakasz('Megváltozott angol címke', d.labelChanged.map(l => ({
          key: l.key,
          html: `<b>${escHtml(l.label)}</b>: „${escHtml(l.from)}" → „${escHtml(l.to)}"`,
        })), 'labelChanged')}
        ${szakasz('A fájlból hiányzó mező', d.removed.map(r => ({
          key: r.key,
          html: `<b>${escHtml(r.label)}</b> (${escHtml(r.key)})`,
        })), 'removed', 'Ezeket az app nem törli – ha tényleg feleslegesek, a mezőszerkesztőben töröld őket egyenként.')}
        ${d.orderChanged ? `
          <section class="sv-diff-sec">
            <h4 class="sv-group-title">Oszlopsorrend</h4>
            <label class="check-row">
              <input type="checkbox" id="sv-diff-order" checked>
              <span>A mezők sorrendjének igazítása a fájlhoz (ez az xlsx-export sorrendje)</span>
            </label>
          </section>` : ''}
      </div>`;

    showDialog({
      title: 'Séma összevetése adatbekérővel',
      body,
      footer: `
        <button class="btn btn-ghost btn-sm" onclick="closeDialog()">Mégse</button>
        <button class="btn btn-primary btn-sm" id="sv-diff-apply">Kijelöltek alkalmazása</button>`,
    });

    document.getElementById('sv-diff-apply').addEventListener('click', () => {
      const gyujt = tipus => [...document.querySelectorAll(`[data-diff="${tipus}"]:checked`)]
        .map(c => c.value);
      const choices = {
        added: gyujt('added'),
        enumChanged: gyujt('enumChanged'),
        labelChanged: gyujt('labelChanged'),
        typeChanged: gyujt('typeChanged'),
        order: !!document.getElementById('sv-diff-order')?.checked,
      };
      const { schema, changes } = SchemaFromXlsx.apply(SchemaStore.get(), d, choices);
      if (!changes.length) { closeDialog(); toast('Nem volt kijelölt változás.'); return; }

      SchemaStore.loadFrom(schema);
      SchemaStore.save();
      closeDialog();
      toast(`${changes.length} változás alkalmazva`, 'success');
      renderFieldList();
    });
  }

  return { init };
})();
