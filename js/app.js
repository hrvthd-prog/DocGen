'use strict';

const currentUser = Settings.currentUser();

BevLogger.init(currentUser);
BevLogger.initGlobalHandlers();

// ── Fülek ─────────────────────────────────────────────────────────────────
const TABS = ['docgen', 'registry', 'settings'];

const tabBtns     = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

function switchTab(id) {
  // Ismeretlen fülnév (pl. korábbi verzióból megmaradt beállítás) üres
  // képernyőt okozna – ezért mindig a listához igazítjuk.
  if (!TABS.includes(id)) id = TABS[0];
  tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  tabContents.forEach(c => c.classList.toggle('active', c.id === 'tab-' + id));
  Settings.set('last_tab', id);
  window.dispatchEvent(new CustomEvent('docgenTabActivated', { detail: id }));
}

tabBtns.forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

document.addEventListener('keydown', e => {
  if (!e.altKey) return;
  const idx = ['1', '2', '3'].indexOf(e.key);
  if (idx !== -1) { e.preventDefault(); switchTab(TABS[idx]); }
});

// ── Toast ─────────────────────────────────────────────────────────────────
window.toast = function(msg, type = '') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' ' + type : '');
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), type === 'error' ? 4000 : 2800);
};

// ── Dialógus mozgatás ─────────────────────────────────────────────────────
function makeDraggable(box) {
  const handle = box.querySelector('.dialog-title');
  if (!handle) return;
  let dx = 0, dy = 0;

  handle.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const startDx = dx, startDy = dy;
    handle.style.cursor = 'grabbing';

    function onMove(e) {
      dx = startDx + (e.clientX - startX);
      dy = startDy + (e.clientY - startY);
      box.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    }
    function onUp() {
      handle.style.cursor = 'grab';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}

// ── Dialógus ──────────────────────────────────────────────────────────────
window.showDialog = function({ title, body, footer }) {
  const overlay = document.getElementById('dialog-overlay');
  overlay.innerHTML = `
    <div class="dialog-box">
      <div class="dialog-title">${escHtml(title)}</div>
      <div class="dialog-body" style="flex:1;overflow-y:auto;">${body}</div>
      <div class="dialog-footer">${footer || ''}</div>
    </div>
  `;
  overlay.classList.remove('hidden');
  makeDraggable(overlay.querySelector('.dialog-box'));
};

window.closeDialog = function() {
  document.getElementById('dialog-overlay').classList.add('hidden');
};

// Csak akkor zárul be, ha a mousedown is az overlay-en volt (szöveg drag nem zárja be)
let _overlayMousedownOnBg = false;
document.getElementById('dialog-overlay').addEventListener('mousedown', (e) => {
  _overlayMousedownOnBg = (e.target === e.currentTarget);
});
document.getElementById('dialog-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget && _overlayMousedownOnBg) closeDialog();
});

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
window.escHtml = escHtml;

// ── Fejléc morzsamenü ─────────────────────────────────────────────────────
window.updateHeaderBreadcrumb = function({ sourceName, clientCount, onSourceClick, onClientClick } = {}) {
  const bc = document.getElementById('header-breadcrumb');
  if (!bc) return;
  let html = '';
  if (sourceName) {
    html += `<button class="header-bc-item" id="hbc-source-btn" title="${escHtml(sourceName)}">${escHtml(sourceName)}</button>`;
    if (clientCount != null) {
      html += `<span class="header-bc-sep">›</span>`;
      html += `<button class="header-bc-item" id="hbc-clients-btn">${clientCount} személy kijelölve</button>`;
    }
  } else {
    html += `<span class="header-bc-item muted">Nincs adat betöltve</span>`;
  }
  bc.innerHTML = html;
  const srcBtn = document.getElementById('hbc-source-btn');
  if (srcBtn && onSourceClick) srcBtn.addEventListener('click', onSourceClick);
  const clientBtn = document.getElementById('hbc-clients-btn');
  if (clientBtn && onClientClick) clientBtn.addEventListener('click', onClientClick);
};

// ── Indítás ───────────────────────────────────────────────────────────────
switchTab(Settings.get('last_tab', 'docgen'));

DocgenModule.init(document.getElementById('tab-docgen'));

// A Nyilvántartás és a Beállítások modul a következő fázisokban készül el.
for (const [id, label] of [['registry', 'Nyilvántartás'], ['settings', 'Beállítások']]) {
  const el = document.getElementById('tab-' + id);
  if (el && !el.childElementCount) {
    el.innerHTML = `<div class="empty-state"><p>A(z) „${label}” modul még nem készült el.</p></div>`;
  }
}
