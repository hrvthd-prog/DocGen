'use strict';

/**
 * Belépőképernyő — a négy jogosultsági szint kapuja. Terv: `TERV-fiokok.md`.
 *
 * Overlay, nem külön lap: az appnak EGY belépési pontja van (`index.html`), amire
 * a `frissit.vbs`, a README és a `kiadas.js` `?v=` léptetése is épül.
 *
 * FONTOS, amit a BEVapp-ból NEM veszünk át: ott a belépőképernyőn bárki
 * hozzáadhat, átnevezhet és törölhet fiókot. Egy megtekintő egy kattintással
 * admin fiókot csinál magának — ezzel bármelyik szint üres marad. Itt a
 * fiókkezelés csak belépett adminnál, a Beállításokban érhető el; kivétel az
 * ELSŐ admin, mert azt valahonnan létre kell hozni (3.).
 */
const LoginModule = (() => {

  let el = null;
  let resolveGate = null;
  let selected = null;          // a kiválasztott fiók neve

  function q(sel) { return el ? el.querySelector(sel) : null; }

  function initials(name) {
    return String(name || '').trim().split(/\s+/)
      .map(w => w[0] || '').join('').toUpperCase().slice(0, 2);
  }

  function ensureEl() {
    if (el) return el;
    el = document.getElementById('login-overlay');
    return el;
  }

  /** Azonnal, a boot elején: ne villanjon fel az adat a bejelentkezés előtt. */
  function show(statusText) {
    if (!ensureEl()) return;
    el.classList.remove('hidden');
    el.innerHTML = shell(`<div class="login-status">${escHtml(statusText || 'Betöltés…')}</div>`);
  }

  function hide() {
    if (ensureEl()) el.classList.add('hidden');
  }

  function shell(inner) {
    return `
      <div class="login-wrap">
        <div class="login-brand">
          <div class="login-brand-mark">
            <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
              <rect x="4" y="3" width="19" height="26" rx="2.5" fill="none"
                    stroke="currentColor" stroke-width="1.8"/>
              <path d="M9 10h9M9 15h9M9 20h6" fill="none" stroke="currentColor"
                    stroke-width="1.8" stroke-linecap="round"/>
            </svg>
          </div>
          <div>
            <div class="login-title">DocGen</div>
            <div class="login-sub">Munkavállalói nyilvántartás és iratgenerálás</div>
          </div>
        </div>
        <div class="login-card">${inner}</div>
      </div>`;
  }

  /**
   * A kapu. Akkor oldódik fel, ha van munkamenet (belépés vagy próba mód).
   * A hívó (app.js) addig NEM indítja el a modulokat.
   */
  function gate() {
    // Próba mód: nincs adatmappa, tehát nincs fiókfájl — nincs mit kérdezni.
    if (Auth.isProba()) { hide(); return Promise.resolve('proba'); }

    // Az engedélykérés MEGELŐZI a munkamenetet: a mentett session a
    // sessionStorage-ból él, az adatmappa viszont ilyenkor nincs betöltve —
    // átengedve az app adat nélkül, néma próba módként indulna.
    if (!pendingDir() && Auth.restoreSession()) {
      // Lapújratöltés ugyanabban a munkamenetben: nem kérdezünk újra.
      hide();
      return Promise.resolve('session');
    }

    return new Promise(resolve => {
      resolveGate = resolve;
      renderGate();
    });
  }

  /** Melyik kártya jön. Az engedélykérés után újra lefut: akkor már a
   *  fiókválasztásnál tartunk. */
  function renderGate() {
    const varakozo = pendingDir();
    if (varakozo) { renderGrant(varakozo); return; }
    if (!Auth.loaded()) { renderNoFolder(); return; }
    if (Auth.isEmpty()) { renderFirstRun(); return; }
    renderAccounts();
  }

  function pendingDir() {
    try { return RegistryModule.pendingDir(); } catch { return null; }
  }

  // ── Mentett adatmappa, ami engedélyre vár ─────────────────────────────────
  /**
   * A Chromium a mappa-handle-t megtartja, a HOZZÁFÉRÉST viszont nem: minden
   * indulásnál újra kell kérni, és kérni csak felhasználói kattintásra lehet.
   * A Nyilvántartás oldalsávján volt ilyen gomb, csak épp ez az overlay takarja
   * — így az app minden indulásnál próba módba esett, pedig a mappa meg volt
   * adva. A gomb tehát ide kell, a kapuba.
   */
  function renderGrant(dir) {
    el.innerHTML = shell(`
      <div class="login-card-heading">Az adatmappa hozzáférésre vár</div>
      <p class="login-note">
        Beállított adatmappa: <b>${escHtml(dir.name)}</b>. A böngésző a
        hozzáférést minden indulásnál újra kéri — egy kattintás, és a közös
        adattal dolgozol tovább.
      </p>
      <div class="login-pin-row">
        <button class="btn btn-primary" id="lg-grant" style="flex:1">
          Hozzáférés megadása
        </button>
      </div>
      <div class="login-error" id="lg-err"></div>
      <p class="login-note">
        Próba módban is folytathatod, de akkor a munka <b>nem a közös adatra</b>
        megy, és nincs jogosultsági szint.
      </p>
      <div class="login-pin-row">
        <button class="btn btn-ghost" id="lg-proba" style="flex:1">
          Folytatás próba módban
        </button>
      </div>`);

    q('#lg-grant').addEventListener('click', async () => {
      const gomb = q('#lg-grant');
      gomb.disabled = true;
      let ok = false;
      try { ok = await RegistryModule.grantAccess(); }
      catch (e) { BevLogger.error('AUTH', 'Az engedélykérés megszakadt', e.message, ''); }
      gomb.disabled = false;
      if (!ok) {
        q('#lg-err').textContent = 'A hozzáférés nem lett megadva.';
        return;
      }
      renderGate();
    });
    q('#lg-proba').addEventListener('click', async () => {
      await RegistryModule.probaMode();
      BevLogger.warn('AUTH', 'Próba mód: az adatmappa engedélye nélkül', dir.name, '');
      done('proba');
    });
  }

  function done(kind) {
    hide();
    const r = resolveGate;
    resolveGate = null;
    if (r) r(kind);
  }

  // ── Nincs adatmappa ───────────────────────────────────────────────────────
  function renderNoFolder() {
    el.innerHTML = shell(`
      <div class="login-card-heading">Nincs beállított adatmappa</div>
      <p class="login-note">
        A fiókok és a szintek a <b>közös adatmappában</b> élnek. Amíg nincs
        kiválasztva, nincs mihez kötni a jogosultságot.
      </p>
      <p class="login-note">
        Válaszd ki a mappát a <b>Nyilvántartás</b> fülön, majd töltsd újra az
        oldalt. Kipróbálni adatmappa nélkül is lehet, de akkor a munka
        <b>nem a közös adatra</b> megy, és nincs szint sem.
      </p>
      <div class="login-pin-row">
        <button class="btn btn-ghost" id="lg-proba" style="flex:1">
          Folytatás próba módban
        </button>
      </div>`);
    q('#lg-proba').addEventListener('click', async () => {
      await RegistryModule.probaMode();
      BevLogger.warn('AUTH', 'Próba mód: adatmappa nélküli indulás', '', '');
      done('proba');
    });
  }

  // ── Első indulás: nincs egyetlen fiók sem ─────────────────────────────────
  // Valahonnan létre kell hozni az első admint, különben a rendszer kizárja
  // magát: fiókot csak admin kezel. A mappához hozzáférés kell, tehát aki ide
  // eljut, az amúgy is írhatja az adatot — ez nem újabb kaput nyit.
  function renderFirstRun() {
    el.innerHTML = shell(`
      <div class="login-card-heading">Első indulás — az első admin létrehozása</div>
      <p class="login-note">
        Ebben az adatmappában még nincs fiók. Hozz létre egy <b>admin</b> fiókot:
        innentől a további fiókokat és szinteket ő kezeli a Beállításokban.
      </p>
      <div class="login-pin-row">
        <input id="lg-new-name" class="field-input" type="text" maxlength="40"
               placeholder="A te neved…" autocomplete="off" style="flex:2">
      </div>
      <div class="login-pin-row">
        <input id="lg-new-pin" class="field-input" type="password"
               inputmode="numeric" maxlength="${Auth.PIN_MAX}"
               placeholder="PIN (${Auth.PIN_MIN}-${Auth.PIN_MAX} jegy)">
        <input id="lg-new-pin2" class="field-input" type="password"
               inputmode="numeric" maxlength="${Auth.PIN_MAX}" placeholder="PIN újra">
      </div>
      <div class="login-pin-row">
        <button class="btn btn-primary" id="lg-create" style="flex:1">
          Admin fiók létrehozása és belépés
        </button>
      </div>
      <div class="login-error" id="lg-err"></div>
      <p class="login-note">
        A PIN nem titkosít semmit: azt akadályozza meg, hogy más fiókjával
        dolgozzanak, így a naplóbejegyzések ahhoz tartoznak, aki tényleg dolgozott.
        A fájlok védelme a megosztott meghajtó jogosultságain áll.
      </p>`);

    const err = (m) => { q('#lg-err').textContent = m || ''; };
    q('#lg-create').addEventListener('click', async () => {
      const name = q('#lg-new-name').value.trim();
      const pin  = q('#lg-new-pin').value;
      const pin2 = q('#lg-new-pin2').value;
      if (!name) return err('Adj meg egy nevet.');
      if (pin !== pin2) return err('A két PIN nem egyezik.');
      const bad = Auth.validatePin(pin);
      if (bad) return err(bad);
      try {
        await Auth.create({ name, role: 'admin', pin });
        await Auth.login(name, pin);
        BevLogger.info('AUTH', 'Első admin fiók létrehozva', name, name);
        done('first');
      } catch (e) {
        err(e.message);
      }
    });
    q('#lg-new-name').focus();
  }

  // ── Fiókválasztás + PIN ───────────────────────────────────────────────────
  function renderAccounts() {
    const list = Auth.accounts()
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'hu'));

    el.innerHTML = shell(`
      <div class="login-card-heading">Válassz fiókot a belépéshez</div>
      <div class="user-list" id="lg-list">
        ${list.map(a => `
          <button type="button" class="user-card" data-name="${escHtml(a.name)}">
            <span class="user-avatar">${escHtml(initials(a.name))}</span>
            <span class="user-meta">
              <span class="user-name">${escHtml(a.name)}</span>
              <span class="user-role">${escHtml(Auth.roleLabel(a.role))}</span>
            </span>
          </button>`).join('')}
      </div>
      <div class="login-pin-row">
        <input id="lg-pin" class="field-input" type="password" inputmode="numeric"
               maxlength="${Auth.PIN_MAX}" placeholder="PIN" disabled>
        <button class="btn btn-primary" id="lg-in" disabled>Belépés</button>
      </div>
      <div class="login-error" id="lg-err"></div>`);

    const err = (m) => { q('#lg-err').textContent = m || ''; };

    el.querySelectorAll('.user-card').forEach(btn => {
      btn.addEventListener('click', () => {
        selected = btn.dataset.name;
        el.querySelectorAll('.user-card').forEach(b =>
          b.classList.toggle('is-active', b === btn));
        q('#lg-pin').disabled = false;
        q('#lg-in').disabled  = false;
        q('#lg-pin').value = '';
        q('#lg-pin').focus();
        err('');
      });
    });

    const belep = async () => {
      if (!selected) return err('Válassz fiókot.');
      const pin = q('#lg-pin').value;
      q('#lg-in').disabled = true;
      // Szándékosan nem árulja el, a név vagy a PIN volt hibás.
      const ok = await Auth.login(selected, pin);
      q('#lg-in').disabled = false;
      if (!ok) {
        q('#lg-pin').value = '';
        q('#lg-pin').focus();
        BevLogger.warn('AUTH', 'Sikertelen belépés', selected, selected);
        return err('Hibás PIN.');
      }
      BevLogger.info('AUTH', 'Belépés', `${ok.name} (${ok.role})`, ok.name);
      done('login');
    };

    q('#lg-in').addEventListener('click', belep);
    q('#lg-pin').addEventListener('keydown', e => { if (e.key === 'Enter') belep(); });
  }

  /** Kilépés: a munkamenet törlődik, és újratöltjük a lapot — így egyetlen
   *  modul sem marad a régi fiók állapotával a memóriában. */
  function logout() {
    BevLogger.info('AUTH', 'Kilépés', Auth.currentUser(), Auth.currentUser());
    Auth.logout();
    location.reload();
  }

  return { show, hide, gate, logout };
})();
