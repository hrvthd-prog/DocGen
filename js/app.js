'use strict';

// A fiók a bejelentkezésből jön, ami a boot() közepén dől el — ezért itt még
// nincs név, és a naplót utólag inicializáljuk újra (TERV-fiokok.md 3.2).
BevLogger.init('');
BevLogger.initGlobalHandlers();

// ── Fülek ─────────────────────────────────────────────────────────────────
const TABS = ['docgen', 'registry', 'cases', 'settings', 'allapot', 'hosszabbitas'];

// Melyik fülhöz milyen jog kell. Ami nincs itt, azt mindenki látja.
const TAB_NEEDS = {
  docgen:   'docgen.generate',
  registry: 'registry.read',
  cases:    'cases.read',
  settings: null,            // a fülön belül kártyánként megy a kapu
  allapot:  'cases.read.own',
};

/** A látható fülek a mostani szinttel. A Beállítások csak akkor, ha van benne
 *  valami: séma (admin), EH elérhetőség (ügyintéző) vagy vezetői kapcsolatok
 *  (HRBP). */
function visibleTabs() {
  return TABS.filter(id => {
    if (id === 'settings') {
      return Auth.can('settings.schema') || Auth.can('settings.ehcontact')
          || Auth.can('leaders.manage');
    }
    // K2-döntések: mindenkire vagy a saját dolgozókra (TERV-hosszabbitasi-dontesek.md 3.10)
    if (id === 'hosszabbitas') return Auth.can('renewals.read') || Auth.can('renewals.read.own');
    const need = TAB_NEEDS[id];
    return !need || Auth.can(need);
  });
}

const tabBtns     = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

function switchTab(id) {
  // Ismeretlen fülnév (pl. korábbi verzióból megmaradt beállítás) üres
  // képernyőt okozna – ezért mindig a listához igazítjuk.
  // Ismeretlen vagy a szinttel nem elérhető fül üres képernyőt adna — ezért
  // mindig a látható listához igazítjuk.
  const vis = visibleTabs();
  if (!vis.includes(id)) id = vis[0] || TABS[0];
  tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  tabContents.forEach(c => c.classList.toggle('active', c.id === 'tab-' + id));
  Settings.setUser('last_tab', id);
  window.dispatchEvent(new CustomEvent('docgenTabActivated', { detail: id }));
}

tabBtns.forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

document.addEventListener('keydown', e => {
  if (!e.altKey) return;
  const idx = ['1', '2', '3', '4'].indexOf(e.key);
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

// ── Verzió a fejlécben ────────────────────────────────────────────────────
// Szöveg, nem link: az app a használat helyén hálózat nélküli gépen fut, ott
// egy GitHub-hivatkozás csak egy üres fület nyitna. A visszakereséshez a
// fejlesztői oldalon a `v<szám>` git tag van.
(function showVersion() {
  const el = document.getElementById('header-verzio');
  const v  = window.APP_VERZIO;
  if (!el || !v) return;
  el.textContent = 'v' + v.verzio;
  el.title = `Verzió ${v.verzio} — kiadva ${v.datum}`;
})();

// ── Mentés-állapot a fejlécben (plans/TERV-felulet-es-kimenet.md 3.2) ──────
// Eddig csak a hiba adott hírt a mentésről; most a rendben lévő állapot is látszik.
(function mentesAllapot() {
  const el = document.getElementById('header-mentes');
  if (!el) return;
  const fuggo = new Set();
  const hibak = new Map();          // tároló neve → üzenet
  const ora = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  function rajzol() {
    el.hidden = Auth.isProba();
    el.classList.toggle('header-mentes--hiba', hibak.size > 0);
    if (hibak.size) {
      el.textContent = '⚠ A mentés nem sikerült';
      el.title = [...hibak].map(([nev, msg]) => `${nev}: ${msg}`).join('\n')
        + '\nA következő módosítás újra megpróbálja; ütközésnél töltsd újra az oldalt.';
    } else if (fuggo.size) {
      el.textContent = 'Mentés…';
      el.title = '';
    } else {
      el.textContent = `Mentve ✓ ${ora(new Date())}`;
      el.title = 'Minden módosítás a közös fájlban van.';
    }
  }
  [['nyilvántartás', EmployeeRepo], ['ügyek', CaseRepo], ['átutalások', TransferRepo]]
    .forEach(([nev, repo]) => {
      repo.onSaveState?.(s => {
        if (s === 'pending') fuggo.add(nev);
        else { fuggo.delete(nev); hibak.delete(nev); }
        rajzol();
      });
      repo.onSaveError?.(err => { fuggo.delete(nev); hibak.set(nev, err.message); rajzol(); });
    });
})();

// ── A szint érvényesítése a felületen ─────────────────────────────────────
function applyRole() {
  const vis = visibleTabs();
  tabBtns.forEach(b => { b.hidden = !vis.includes(b.dataset.tab); });

  const nev  = Auth.isProba() ? 'próba mód' : Settings.currentUser();
  // A fejléc a SAJÁT szintet mutatja; a nézetet a lila sáv.
  const szint = Auth.isProba() ? '' : (Auth.realRole() ? Auth.roleLabel(Auth.realRole()) : '');
  const un = document.getElementById('header-username');
  if (un) {
    un.textContent = szint ? `${nev} · ${szint}` : nev;
    un.title = szint ? `Belépve: ${nev} (${szint})` : '';
  }

  const bar = document.getElementById('proba-bar');
  if (bar) {
    bar.hidden = !Auth.isProba();
    bar.innerHTML = '<b>Próba mód</b> — nincs beállított adatmappa: a munka nem a '
      + 'közös adatra megy, és nincs jogosultsági szint. A generált iratok '
      + '„proba" jelzést kapnak.';
  }

  // Egyszerű vagy szakértő felület: a szakértői vezérlők `expert-only` osztályt kapnak
  document.body.classList.toggle('ui-simple', !Auth.can('ui.expert'));

  const vb = document.getElementById('viewas-btn');
  if (vb) { vb.hidden = !Auth.canViewAs(); vb.onclick = openViewAs; }
  const va = Auth.viewingAs();
  const vbar = document.getElementById('viewas-bar');
  if (vbar) {
    vbar.hidden = !va;
    vbar.innerHTML = va
      ? `<b>Nézet: ${escHtml(Auth.roleLabel(va.role))}${va.name ? ' — ' + escHtml(va.name) : ''}.</b>
         Amit itt módosítasz, a te neveden mentődik; döntést nem rögzíthetsz.
         <button type="button" class="btn btn-ghost btn-sm" id="viewas-off">Vissza a saját nézetemhez</button>`
      : '';
    const off = document.getElementById('viewas-off');
    if (off) off.onclick = () => valtNezet(null);
  }

  // Kilépés gomb: csak belépett fióknál van értelme
  const lo = document.getElementById('logout-btn');
  if (lo) {
    lo.hidden = !Auth.currentRole();
    lo.onclick = () => LoginModule.logout();
  }
}

// ── „Megnézem úgy, mint…” (plans/TERV-felulet-es-kimenet.md 1.2) ───────────
// Élőben vált, újratöltés nélkül: az újratöltés a mappa-engedélyt és a PIN-t is
// újra kérné. A fülek az aktiváláskor rajzolnak, ezért elég az aktívat újranyitni.
function valtNezet(v) {
  try { Auth.setViewAs(v); }
  catch (e) { toast(e.message, 'error'); return; }
  BevLogger.info('AUTH', v ? 'Nézet: ' + Auth.roleLabel(v.role) + (v.name ? ' — ' + v.name : '')
                           : 'Vissza a saját nézetbe', '', Settings.currentUser());
  closeDialog();
  applyRole();
  const aktiv = document.querySelector('.tab-btn.active');
  switchTab(aktiv ? aktiv.dataset.tab : 'docgen');
}

function openViewAs() {
  const szintek = Roles.all();
  let fiokok = [];
  try { fiokok = Auth.accounts(); } catch {}
  const most = Auth.viewingAs() || { role: Auth.realRole(), name: '' };
  // Személy csak a „saját dolgozók” szinteknél számít: ott a látókör a névhez kötött.
  const nevhezKotott = key => ((Roles.get(key) || {}).can || []).some(a => a.endsWith('.own'));

  showDialog({
    title: 'Megnézem úgy, mint…',
    body: `
      <label class="cf-field"><span>Szint</span>
        <select id="va-role" class="field-input">${szintek.map(r =>
          `<option value="${escHtml(r.key)}"${r.key === most.role ? ' selected' : ''}>${escHtml(r.label)}</option>`).join('')}
        </select></label>
      <label class="cf-field" id="va-name-wrap"><span>Kinek a dolgozóit</span>
        <select id="va-name" class="field-input"></select></label>
      <p class="ef-hint">Pontosan azt látod, amit ez a szint. Újratöltés vagy kilépés után a
        saját nézeted jön vissza.</p>`,
    footer: `<button class="btn btn-primary" id="va-ok">Megnézem</button>
             <button class="btn" id="va-off">Saját nézetem</button>`,
  });
  const role = document.getElementById('va-role');
  const nev  = document.getElementById('va-name');
  const frissit = () => {
    const kell = nevhezKotott(role.value);
    document.getElementById('va-name-wrap').hidden = !kell;
    const lista = fiokok.filter(a => a.role === role.value);
    nev.innerHTML = lista.length
      ? lista.map(a => `<option${a.name === most.name ? ' selected' : ''}>${escHtml(a.name)}</option>`).join('')
      : '<option value="">(ezen a szinten nincs fiók)</option>';
  };
  role.addEventListener('change', frissit);
  frissit();
  document.getElementById('va-ok').addEventListener('click', () =>
    valtNezet({ role: role.value, name: nevhezKotott(role.value) ? nev.value : '' }));
  document.getElementById('va-off').addEventListener('click', () => valtNezet(null));
}

// ── Indítás ───────────────────────────────────────────────────────────────
// A sorrend kötött: a belépőképernyő AZONNAL felmegy (ne villanjon az adat), a
// Nyilvántartás állítja be az adatmappát és tölti be a fiókokat, és a többi
// modul csak a belépés UTÁN indul — így mindegyik a helyes fiókot látja.
(async function boot() {
  LoginModule.show('Adatmappa és fiókok betöltése…');
  try {
    await RegistryModule.init(document.getElementById('tab-registry'));
  } catch (e) {
    BevLogger.error('BOOT', 'A Nyilvántartás indítása megszakadt', e.message, '');
  }

  await LoginModule.gate();

  BevLogger.init(Settings.currentUser());
  DocgenModule.init(document.getElementById('tab-docgen'));
  CasesModule.init(document.getElementById('tab-cases'));
  SettingsModule.init(document.getElementById('tab-settings'));
  AllapotModule.init(document.getElementById('tab-allapot'));
  HosszabbitasModule.init(document.getElementById('tab-hosszabbitas'));

  applyRole();
  switchTab(Settings.getUser('last_tab', 'docgen'));
  // Offline értesítés: belépéskor, ha van új tétel, megnyílik az Összesítő (3.9)
  HosszabbitasModule.indulaskor();
})();
