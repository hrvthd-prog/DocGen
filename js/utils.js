'use strict';

// ── Fájl-picker helper (nincs FS API esetén) ──────────────────────────────
function pickFile(accept) {
  return new Promise(res => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept;
    inp.onchange = () => res(inp.files[0] || null);
    inp.click();
  });
}

// ── Megjelenítési név sorból ──────────────────────────────────────────────
function rowDisplayName(row) {
  const f = String(row['Vezetéknév'] || row['Last name']  || '').trim();
  const k = String(row['Keresztnév'] || row['First name'] || '').trim();
  return [f, k].filter(Boolean).join(' ') || 'Ismeretlen';
}

// ── Fájlnév-tisztítás ────────────────────────────────────────────────────
function sanitizeFilename(s) {
  return s.replace(/[^A-Za-z0-9_\-áéíóöőúüűÁÉÍÓÖŐÚÜŰ]/g, '_');
}

// ── Üres állapot ─────────────────────────────────────────────────────────
function bevEmptyState(message) {
  return '<div class="empty-state"><span class="empty-state-msg">' + message + '</span></div>';
}

// ── Dátummező ─────────────────────────────────────────────────────────────
/**
 * Miért nem sima `<input type="date">`?
 *
 * A Chrome év-szegmense HAT számjegyet fogad el (a naptár 275760-ig ér), és
 * négy után nem lép tovább a hónapra. Mérve: a mezőbe „20260315"-öt gépelve
 * `202603-12-15` lett az érték – hatjegyű évvel, rossz hónappal, némán. A
 * séma ÉÉÉÉ-HH-NN alakot vár, tehát ez nem kényelmetlenség volt, hanem
 * hibás adat.
 *
 * Megoldás: a beírás maszkolt szövegmezőn megy (négy számjegy után magától
 * jön a kötőjel), a natív naptár pedig mellette marad választógombként.
 * A `data-key` a szövegmezőn ül, ezért a meglévő gyűjtő- és validáló kód
 * változatlanul működik.
 */
function dateFieldHtml({ id = '', key = '', value = '', attrs = '' } = {}) {
  const v = escHtml(value || '');
  return `<span class="date-field">
    <input type="text" class="field-input" data-datefield inputmode="numeric"
           maxlength="10" autocomplete="off" placeholder="ÉÉÉÉ-HH-NN"
           ${id ? `id="${escHtml(id)}"` : ''} ${key ? `data-key="${escHtml(key)}"` : ''}
           value="${v}" ${attrs}>
    <input type="date" class="date-field__cal" tabindex="-1" aria-label="Naptár" value="${v}">
  </span>`;
}

document.addEventListener('input', e => {
  const el = e.target;
  if (!el.matches || !el.matches('input[data-datefield]')) return;
  const d = el.value.replace(/\D/g, '').slice(0, 8);
  el.value = d.length > 6 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`
           : d.length > 4 ? `${d.slice(0, 4)}-${d.slice(4)}`
           : d;
  const cal = el.parentElement && el.parentElement.querySelector('.date-field__cal');
  if (cal) cal.value = /^\d{4}-\d{2}-\d{2}$/.test(el.value) ? el.value : '';
});

// A naptárból választott nap a szövegmezőbe kerül – és úgy, hogy a mezőre
// kötött `input`/`change` figyelők (számított mezők, határidő-számítás) lássák.
document.addEventListener('change', e => {
  const cal = e.target;
  if (!cal.matches || !cal.matches('.date-field__cal') || !cal.value) return;
  const txt = cal.parentElement.querySelector('input[data-datefield]');
  if (!txt) return;
  txt.value = cal.value;
  txt.dispatchEvent(new Event('input',  { bubbles: true }));
  txt.dispatchEvent(new Event('change', { bubbles: true }));
});

// ── Uint8Array → base64 ───────────────────────────────────────────────────
function uint8ToBase64(u8) {
  let b = '';
  for (let i = 0; i < u8.length; i++) b += String.fromCharCode(u8[i]);
  return btoa(b);
}
