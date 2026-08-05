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

// ── Uint8Array → base64 ───────────────────────────────────────────────────
function uint8ToBase64(u8) {
  let b = '';
  for (let i = 0; i < u8.length; i++) b += String.fromCharCode(u8[i]);
  return btoa(b);
}
