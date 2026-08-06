'use strict';

/**
 * Munkavállalói űrlap – teljes egészében a sémából épül.
 *
 * Nincs benne egyetlen bedrótozott mezőnév sem: a csoportok, a mezők, a
 * beviteli típusok és a legördülők értékei mind a `SchemaStore`-ból jönnek.
 * Új adatkör felvétele a sémában automatikusan megjelenik itt is.
 */
const EmployeeForm = (() => {

  let editingId = null;      // null → új felvitel
  let draftIdentifiers = []; // az azonosítók a mentésig itt élnek
  let onSaved = null;

  // ── Megnyitás ──────────────────────────────────────────────────────────────

  function open({ id = null, onSave } = {}) {
    editingId = id;
    onSaved   = onSave;
    const emp = id ? EmployeeRepo.get(id) : null;
    draftIdentifiers = emp ? JSON.parse(JSON.stringify(emp.identifiers)) : [];

    const values = emp ? emp.fields : {};
    showDialog({
      title: emp ? 'Munkavállaló szerkesztése' : 'Új munkavállaló',
      body: renderBody(values),
      footer: `
        <span id="ef-error" class="ef-error"></span>
        <button class="btn btn-ghost btn-sm" onclick="closeDialog()">Mégse</button>
        <button class="btn btn-primary btn-sm" id="ef-save">Mentés</button>
      `,
    });
    bind();
  }

  // ── Megjelenítés ───────────────────────────────────────────────────────────

  function renderBody(values) {
    const groups = SchemaStore.byGroup({ includeComputed: false });
    return `
      <div class="ef-wrap">
        ${renderIdentifiers()}
        ${groups.map(g => renderGroup(g, values)).join('')}
        ${renderComputedPreview(values)}
      </div>
    `;
  }

  function renderGroup(g, values) {
    return `
      <section class="ef-group">
        <h4 class="ef-group-title">${escHtml(g.group.label)}</h4>
        <div class="ef-grid">
          ${g.fields.map(f => renderField(f, values[f.key])).join('')}
        </div>
      </section>
    `;
  }

  /** Azonosítóból töltött mezők: a fenti azonosító-blokk a forrásuk. */
  function mirroredType(key) {
    return Object.entries(EmployeeRepo.IDENTIFIER_FIELD_MAP)
      .find(([, k]) => k === key)?.[0] || null;
  }

  function renderField(f, value) {
    const id  = 'ef-f-' + f.key;
    const req = f.required ? '<span class="ef-req" title="Kötelező mező">*</span>' : '';
    const val = value == null ? '' : String(value);

    // A duplán bekérhető azonosító-mezők nem szerkeszthetők közvetlenül
    const mType = mirroredType(f.key);
    if (mType) {
      const cur = draftIdentifiers.find(i => i.type === mType && i.current);
      return `
        <label class="ef-field ef-field--mirrored" for="${id}">
          <span class="ef-label">${escHtml(f.label.hu)}</span>
          <input type="text" class="field-input" id="${id}" data-mirror="${escHtml(mType)}"
                 value="${escHtml(cur ? cur.value : '')}" readonly
                 title="Az Azonosítók blokkból töltődik">
          <span class="ef-mirror-note">az Azonosítók blokkból</span>
        </label>`;
    }

    let input;

    if (f.type === 'enum') {
      const opts = ValueCodec.options(f, 'hu');
      // Ismeretlen (a sémában nem szereplő) érték ne vesszen el némán
      const unknown = val && !opts.find(o => o.id === val);
      input = `
        <select class="field-select" id="${id}" data-key="${escHtml(f.key)}">
          <option value=""${val ? '' : ' selected'}>—</option>
          ${opts.map(o => `<option value="${escHtml(o.id)}"${o.id === val ? ' selected' : ''}>${escHtml(o.label)}</option>`).join('')}
          ${unknown ? `<option value="${escHtml(val)}" selected>${escHtml(val)} (ismeretlen)</option>` : ''}
        </select>`;
    } else if (f.type === 'date') {
      input = `<input type="date" class="field-input" id="${id}" data-key="${escHtml(f.key)}" value="${escHtml(val)}">`;
    } else if (f.type === 'number') {
      input = `<input type="text" inputmode="decimal" class="field-input" id="${id}" data-key="${escHtml(f.key)}" value="${escHtml(val)}">`;
    } else {
      input = `<input type="text" class="field-input" id="${id}" data-key="${escHtml(f.key)}" value="${escHtml(val)}">`;
    }

    return `
      <label class="ef-field" for="${id}">
        <span class="ef-label">${escHtml(f.label.hu)}${req}</span>
        ${input}
        <span class="ef-field-error" data-error-for="${escHtml(f.key)}"></span>
      </label>`;
  }

  /** Az azonosítók külön kezelendők: nem sémamezők, hanem saját történettel bírnak. */
  function renderIdentifiers() {
    const types = EmployeeRepo.ID_TYPES;
    const sorted = draftIdentifiers.slice().sort((a, b) =>
      (b.current === true) - (a.current === true) || String(a.type).localeCompare(String(b.type)));

    return `
      <section class="ef-group">
        <h4 class="ef-group-title">Azonosítók és történetük</h4>
        <p class="ef-hint">
          A SAP-törzsszám minden új tartózkodási engedéllyel változik. Új szám
          rögzítésekor a korábbi automatikusan lezárul, de megmarad – így a régi
          számra hivatkozó iratok is visszakereshetők.
        </p>
        <div id="ef-id-list" class="ef-id-list">
          ${sorted.length ? sorted.map(renderIdentifierRow).join('')
                          : '<p class="ef-empty">Még nincs rögzített azonosító.</p>'}
        </div>
        <div class="ef-id-add">
          <select class="field-select" id="ef-id-type">
            ${Object.entries(types).map(([k, v]) => `<option value="${k}">${escHtml(v)}</option>`).join('')}
          </select>
          <input type="text" class="field-input" id="ef-id-value" placeholder="Azonosító értéke">
          <input type="date" class="field-input" id="ef-id-from" title="Érvényesség kezdete">
          <button type="button" class="btn btn-ghost btn-sm" id="ef-id-add">Hozzáadás</button>
        </div>
      </section>`;
  }

  function renderIdentifierRow(i) {
    const label = EmployeeRepo.idTypeLabel(i.type);
    const idoszak = [i.validFrom || '?', i.validTo || ''].filter(Boolean).join(' – ');
    return `
      <div class="ef-id-row${i.current ? ' is-current' : ''}">
        <span class="ef-id-type">${escHtml(label)}</span>
        <span class="ef-id-value">${escHtml(i.value)}</span>
        <span class="ef-id-period">${escHtml(idoszak)}</span>
        <span class="ef-id-badge">${i.current ? 'aktuális' : 'lejárt'}</span>
        <button type="button" class="ef-id-del" data-del-value="${escHtml(i.value)}"
                data-del-type="${escHtml(i.type)}" title="Azonosító törlése">&times;</button>
      </div>`;
  }

  function renderComputedPreview(values) {
    const computed = SchemaStore.fields().filter(f => f.type === 'computed');
    if (!computed.length) return '';
    return `
      <section class="ef-group">
        <h4 class="ef-group-title">Számított mezők</h4>
        <p class="ef-hint">Ezek a fenti adatokból állnak elő, és a dokumentum-sablonokban is használhatók.</p>
        <div class="ef-computed" id="ef-computed">${computedRows(values)}</div>
      </section>`;
  }

  function computedRows(values) {
    return SchemaStore.fields().filter(f => f.type === 'computed').map(f => {
      const v = SchemaStore.computeField(f, values, 'hu');
      return `<div class="ef-computed-row">
                <span class="ef-computed-label">${escHtml(f.label.hu)}</span>
                <span class="ef-computed-value">${v ? escHtml(v) : '<i>—</i>'}</span>
              </div>`;
    }).join('');
  }

  // ── Eseménykezelés ─────────────────────────────────────────────────────────

  function bind() {
    document.getElementById('ef-save').addEventListener('click', save);
    document.getElementById('ef-id-add').addEventListener('click', addIdentifier);
    bindIdentifierDeletes();

    // A számított mezők előnézete élőben követi a beírást
    document.querySelectorAll('.ef-wrap [data-key]').forEach(el => {
      el.addEventListener('input', refreshComputed);
      el.addEventListener('change', refreshComputed);
    });
  }

  function bindIdentifierDeletes() {
    document.querySelectorAll('[data-del-value]').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = btn.dataset.delValue, t = btn.dataset.delType;
        draftIdentifiers = draftIdentifiers.filter(
          i => !(i.value === v && i.type === t));
        rerenderIdentifiers();
      });
    });
  }

  function rerenderIdentifiers() {
    const list = document.getElementById('ef-id-list');
    const sorted = draftIdentifiers.slice().sort((a, b) =>
      (b.current === true) - (a.current === true) || String(a.type).localeCompare(String(b.type)));
    list.innerHTML = sorted.length ? sorted.map(renderIdentifierRow).join('')
                                   : '<p class="ef-empty">Még nincs rögzített azonosító.</p>';
    bindIdentifierDeletes();
    syncMirroredFields();
    refreshComputed();
  }

  /** A tükrözött (csak olvasható) mezők követik az aktuális azonosítót. */
  function syncMirroredFields() {
    document.querySelectorAll('[data-mirror]').forEach(el => {
      const cur = draftIdentifiers.find(i => i.type === el.dataset.mirror && i.current);
      el.value = cur ? cur.value : '';
    });
  }

  function addIdentifier() {
    const type  = document.getElementById('ef-id-type').value;
    const value = document.getElementById('ef-id-value').value.trim();
    const from  = document.getElementById('ef-id-from').value;
    if (!value) { setError('Az azonosító értéke nem lehet üres.'); return; }

    // Nem tartozhat már máshoz
    const owner = EmployeeRepo.findByIdentifier(value, type);
    if (owner && owner.id !== editingId) {
      setError(`Ez az azonosító már egy másik személyhez tartozik: ${nameOf(owner)}.`);
      return;
    }
    if (draftIdentifiers.some(i => i.type === type && i.value === value)) {
      setError('Ez az azonosító már szerepel a listában.');
      return;
    }

    // Az azonos típusú korábbi lezárul – ez az „új engedély" egylépéses útja
    const kezdet = from || new Date().toISOString().slice(0, 10);
    for (const i of draftIdentifiers) {
      if (i.type === type && i.current) { i.current = false; if (!i.validTo) i.validTo = kezdet; }
    }
    draftIdentifiers.push({ type, value, validFrom: kezdet, validTo: null, current: true });

    document.getElementById('ef-id-value').value = '';
    document.getElementById('ef-id-from').value  = '';
    setError('');
    rerenderIdentifiers();
  }

  function collectValues() {
    const values = {};
    document.querySelectorAll('.ef-wrap [data-key]').forEach(el => {
      values[el.dataset.key] = el.value.trim();
    });
    // Az azonosító-történetből töltött mezők mindig az aktuális azonosítót kapják
    return EmployeeRepo.applyIdentifiersToFields(draftIdentifiers, values);
  }

  function refreshComputed() {
    const box = document.getElementById('ef-computed');
    if (box) box.innerHTML = computedRows(collectValues());
  }

  function save() {
    const values = collectValues();

    // Mezőszintű hibák törlése
    document.querySelectorAll('.ef-field-error').forEach(e => { e.textContent = ''; });
    document.querySelectorAll('.ef-field').forEach(e => e.classList.remove('has-error'));

    const problems = SchemaStore.validateValues(values);
    if (problems.length) {
      for (const p of problems) {
        const el = document.querySelector(`[data-error-for="${CSS.escape(p.key)}"]`);
        if (el) {
          el.textContent = p.message;
          el.closest('.ef-field')?.classList.add('has-error');
        }
      }
      setError(`${problems.length} mező javításra vár.`);
      const first = document.querySelector('.ef-field.has-error input, .ef-field.has-error select');
      if (first) first.focus();
      return;
    }

    try {
      if (editingId) {
        EmployeeRepo.update(editingId, {
          fields: values, identifiers: draftIdentifiers, schemaVersion: SchemaStore.version(),
        });
      } else {
        EmployeeRepo.create({
          fields: values, identifiers: draftIdentifiers, schemaVersion: SchemaStore.version(),
        });
      }
    } catch (e) {
      setError(e.message);
      return;
    }

    closeDialog();
    toast(editingId ? 'Módosítás mentve' : 'Munkavállaló felvéve', 'success');
    if (onSaved) onSaved();
  }

  function setError(msg) {
    const el = document.getElementById('ef-error');
    if (el) el.textContent = msg || '';
  }

  function nameOf(emp) {
    const v = SchemaStore.resolveValues(emp.fields, 'hu');
    return v.full_name || v.surname || '(névtelen)';
  }

  return { open };
})();
