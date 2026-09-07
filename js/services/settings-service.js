'use strict';

const Settings = (() => {
  // Saját névtér: nem ütközik a BEVapp kulcsaival, ha a két app ugyanarról
  // a kiszolgálóról/origin-ről fut.
  const PREFIX = 'docgen_';

  // Egyfelhasználós üzem: nincs bejelentkezés. A per-felhasználó kulcsszerkezet
  // viszont megmarad, hogy a többfelhasználós mód később ráépíthető legyen.
  const LOCAL_USER = 'helyi';

  function safe(name) {
    return String(name || '').replace(/[^a-zA-Z0-9]/g, '_');
  }

  function get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch { return fallback; }
  }

  function set(key, value) {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  }

  function remove(key) {
    localStorage.removeItem(PREFIX + key);
  }

  function currentUser() {
    return get('current_user', LOCAL_USER) || LOCAL_USER;
  }

  // ── Per-fiók csoport kezelés ─────────────────────────────────────────────
  function getAccountGroups(account) {
    return get('groups_' + safe(account), []);
  }

  function setAccountGroups(account, groups) {
    set('groups_' + safe(account), groups);
  }

  // ── Per-fiók sablon láthatóság ───────────────────────────────────────────
  // Struktúra: template_accounts = { "SablonNév": ["Fiók1", "Fiók2"] }
  // Ha egy sablon NEM szerepel (vagy üres lista) → minden fiók látja
  function getTemplateAccounts() {
    return get('template_accounts', {});
  }

  function setTemplateAccounts(map) {
    set('template_accounts', map);
  }

  function isTemplateVisible(templateName, account) {
    const map = getTemplateAccounts();
    const accounts = map[templateName];
    if (!accounts || accounts.length === 0) return true; // hozzárendeletlen = mindenki látja
    return accounts.includes(account);
  }

  function addTemplateToAccount(templateName, account) {
    const map = getTemplateAccounts();
    if (!map[templateName]) {
      map[templateName] = [account];
    } else if (!map[templateName].includes(account)) {
      map[templateName].push(account);
    }
    setTemplateAccounts(map);
  }

  function setTemplateVisibility(templateName, accounts) {
    const map = getTemplateAccounts();
    map[templateName] = accounts;
    setTemplateAccounts(map);
  }

  // ── EH: az okmány átvételéhez megadott elérhetőség ───────────────────────
  // Az EH „Az okmány átvétele" panelján az ÜGYINTÉZŐ elérhetősége megy fel,
  // nem a munkavállalóé — az okmányról szóló értesítést az ügyet vivő kapja.
  // Ezért egy helyen áll, nem munkavállalónként a nyilvántartásban.
  const EH_CONTACT_DEFAULT = {
    email:   'daniel.horvath@aumovio.com',
    telefon: '+36205799979',
  };

  // Üresre törölt mező üres marad (szándékos), csak a nem mentett esik vissza
  // az alapértelmezettre.
  function ehContact() {
    return Object.assign({}, EH_CONTACT_DEFAULT, get('eh_contact', null) || {});
  }

  function setEhContact(c) {
    set('eh_contact', {
      email:   String((c && c.email)   || '').trim(),
      telefon: String((c && c.telefon) || '').trim(),
    });
  }

  function getAllUsers() {
    return get('users', []);
  }

  // Egyfelhasználós üzemben nincs korlátozott fiók: minden funkció elérhető.
  // Többfelhasználós módnál ez lesz a jogosultság-ellenőrzés belépési pontja.
  function isAdmin() {
    return true;
  }

  return {
    get, set, remove,
    currentUser,
    getAccountGroups,
    setAccountGroups,
    isTemplateVisible,
    addTemplateToAccount,
    setTemplateVisibility,
    getTemplateAccounts,
    ehContact,
    setEhContact,
    EH_CONTACT_DEFAULT,
    getAllUsers,
    isAdmin,
  };
})();
