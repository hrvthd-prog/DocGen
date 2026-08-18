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
  };

  const SOURCE_LABEL = {
    urlap:  'űrlap',
    import: 'import',
    ugy:    'ügy',
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

  return { open };
})();
