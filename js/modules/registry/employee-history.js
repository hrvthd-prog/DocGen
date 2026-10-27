'use strict';

/**
 * Változásnapló megjelenítése egy munkavállalóhoz.
 *
 * A napló a rekordon belül él (`emp.history`, lásd EmployeeRepo) – ez a modul
 * csak megjeleníti: legfrissebb elöl, mezőnkénti előtte/utána párral. A
 * tárolt érték nyers (kanonikus enum-azonosító, ISO-dátum), a fordítás
 * (magyar címke, dátumformátum) itt, megjelenítéskor történik.
 */
const EmployeeHistory = (() => {

  const ACTION_LABEL = {
    letrehozas:       'Létrehozva',
    modositas:        'Módosítva',
    azonosito_uj:     'Új azonosító',
    azonosito_torles: 'Azonosító törölve',
    kilepes:          'Kilépettnek jelölve',
    visszavetel:      'Visszavéve',
    nem_hosszabbit:   'Nem hosszabbítjuk',
    hosszabbit:       'Hosszabbítás visszaállítva',
  };

  const SOURCE_LABEL = {
    urlap:  'űrlap',
    import: 'import',
    ugy:    'ügy',
    tomeges: 'tömeges művelet',
    fiok:   'fiók átnevezése',
    'eh-panel':  'EH-panel',
    tomeges_ugy: 'tömeges ügyintézés',
    hianynaplo:  'hiányzó-adat napló',
  };

  function huDatum(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso || '');
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}. ${p(d.getMonth() + 1)}. ${p(d.getDate())}.  ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /** Azonosító-mező kulcsa ('azonosito_sap' stb.) vagy séma-mező → olvasható címke. */
  function fieldLabel(key) {
    if (key.startsWith('azonosito_')) {
      return EmployeeRepo.idTypeLabel(key.slice('azonosito_'.length));
    }
    const f = SchemaStore.field(key);
    return f ? f.label.hu : key;
  }

  /** A nyers tárolt érték a felület nyelvére fordítva – ha van hozzá séma-mező. */
  function renderVal(key, raw) {
    if (raw === '' || raw == null) return '(üres)';
    if (key.startsWith('azonosito_')) return String(raw);
    const f = SchemaStore.field(key);
    return f ? (SchemaStore.renderValue(f, raw, 'hu') || '(üres)') : String(raw);
  }

  function nevOf(emp) {
    const v = SchemaStore.resolveValues(emp.fields, 'hu');
    return [v.surname, v.forename].filter(Boolean).join(' ') || '(névtelen)';
  }

  function renderEntry(h) {
    const changes = Array.isArray(h.changes) ? h.changes : [];
    return `
      <li class="eh-item">
        <div class="eh-head">
          <span class="eh-action">${escHtml(ACTION_LABEL[h.action] || h.action)}</span>
          <span class="eh-date">${escHtml(huDatum(h.at))}</span>
          <span class="eh-user">${escHtml(h.user || '')}</span>
          <span class="eh-source" title="Honnan történt a változás">${escHtml(SOURCE_LABEL[h.source] || h.source || '')}</span>
        </div>
        ${changes.length ? `
          <table class="eh-diff">
            ${changes.map(c => `
              <tr>
                <td class="eh-diff-key">${escHtml(fieldLabel(c.key))}</td>
                <td class="eh-diff-from">${escHtml(renderVal(c.key, c.from))}</td>
                <td class="eh-diff-arrow">→</td>
                <td class="eh-diff-to">${escHtml(renderVal(c.key, c.to))}</td>
              </tr>`).join('')}
          </table>` : ''}
      </li>`;
  }

  function renderBody(emp) {
    const list = (emp.history || []).slice().reverse();
    if (!list.length) {
      return `<p class="eh-empty">Ehhez a személyhez még nincs rögzített változás.</p>`;
    }
    return `<ul class="eh-list">${list.map(renderEntry).join('')}</ul>`;
  }

  function open(emp) {
    if (!emp) return;
    showDialog({
      title: `Előzmények — ${nevOf(emp)}`,
      body: renderBody(emp),
      footer: `<button class="btn btn-primary btn-sm" onclick="closeDialog()">Bezárás</button>`,
    });
  }

  // ── Legutóbbi változások — minden dolgozó egy listában ─────────────────────

  const RECENT_MAX = 500;

  /** Minden dolgozó minden bejegyzése, legfrissebb elöl (a felvitel is az). */
  function osszesBejegyzes() {
    const out = [];
    for (const emp of EmployeeRepo.all({ includeExited: true })) {
      for (const h of emp.history || []) out.push({ emp, h });
    }
    return out.sort((a, b) => String(b.h.at || '').localeCompare(String(a.h.at || '')));
  }

  function valtozasCella(changes) {
    const l = Array.isArray(changes) ? changes : [];
    const elso = l.slice(0, 3).map(c =>
      `<div><span class="eh-diff-key">${escHtml(fieldLabel(c.key))}:</span>
         ${escHtml(renderVal(c.key, c.from))} → <b>${escHtml(renderVal(c.key, c.to))}</b></div>`).join('');
    return elso + (l.length > 3 ? `<div class="eh-more">+${l.length - 3} további mező</div>` : '');
  }

  /**
   * Legutóbbi változások: az összes dolgozó naplója időrendben, legfrissebb
   * elöl. Egy rossz import vagy elgépelés több száz dolgozó között is így
   * kereshető vissza — „kik voltak az utolsók”. Sorra kattintva `onOpen(id)`.
   */
  function openRecent({ onOpen = null } = {}) {
    const mind = osszesBejegyzes();
    const forrasok = [...new Set(mind.map(x => x.h.source).filter(Boolean))];
    showDialog({
      title: 'Legutóbbi változások',
      body: `
        <div class="eh-recent-bar">
          <input type="search" id="eh-r-q" class="field-input" placeholder="Szűrés névre">
          <select id="eh-r-src" class="field-select" title="Honnan történt a változás">
            <option value="">Minden forrás</option>
            ${forrasok.map(f => `<option value="${escHtml(f)}">${escHtml(SOURCE_LABEL[f] || f)}</option>`).join('')}
          </select>
          <span id="eh-r-db" class="eh-recent-db"></span>
        </div>
        <div class="data-table-wrap eh-recent-wrap">
          <table class="data-table eh-recent">
            <thead><tr><th>Időpont</th><th>Dolgozó</th><th>Művelet</th><th>Forrás</th>
                       <th>Ki</th><th>Változás</th></tr></thead>
            <tbody id="eh-r-body"></tbody>
          </table>
        </div>`,
      footer: `<button class="btn btn-primary btn-sm" onclick="closeDialog()">Bezárás</button>`,
    });

    const rajzol = () => {
      const q   = document.getElementById('eh-r-q').value.trim().toLowerCase();
      const src = document.getElementById('eh-r-src').value;
      const lista = mind.filter(x => (!src || x.h.source === src) &&
                                     (!q || nevOf(x.emp).toLowerCase().includes(q)));
      const lathato = lista.slice(0, RECENT_MAX);
      document.getElementById('eh-r-db').textContent = lista.length > RECENT_MAX
        ? `a legutóbbi ${RECENT_MAX} / ${lista.length} bejegyzés` : `${lista.length} bejegyzés`;
      const body = document.getElementById('eh-r-body');
      body.innerHTML = lathato.map((x, i) => `
        <tr class="eh-recent-row" data-r="${i}" tabindex="0" title="A dolgozó megnyitása">
          <td style="white-space:nowrap">${escHtml(huDatum(x.h.at))}</td>
          <td><b>${escHtml(nevOf(x.emp))}</b>${x.emp.exited ? ' <span class="eh-more">(kilépett)</span>' : ''}</td>
          <td>${escHtml(ACTION_LABEL[x.h.action] || x.h.action || '')}</td>
          <td>${escHtml(SOURCE_LABEL[x.h.source] || x.h.source || '')}</td>
          <td>${escHtml(x.h.user || '')}</td>
          <td>${valtozasCella(x.h.changes)}</td>
        </tr>`).join('')
        || '<tr><td colspan="6" class="eh-empty">Nincs a szűrésnek megfelelő bejegyzés.</td></tr>';
      body.querySelectorAll('[data-r]').forEach(tr => {
        const nyit = () => { if (onOpen) onOpen(lathato[Number(tr.dataset.r)].emp.id); };
        tr.addEventListener('click', nyit);
        tr.addEventListener('keydown', e => { if (e.key === 'Enter') nyit(); });
      });
    };
    document.getElementById('eh-r-q').addEventListener('input', rajzol);
    document.getElementById('eh-r-src').addEventListener('change', rajzol);
    rajzol();
  }

  return { open, openRecent, _osszesBejegyzes: osszesBejegyzes, SOURCE_LABEL };
})();
