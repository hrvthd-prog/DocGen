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

  /**
   * A belépett fiók neve. Az `Auth` munkamenetéből jön, ha van — az a forrás
   * igazsága (közös fájl + sessionStorage). Fiók nélkül (próba mód, illetve a
   * bejelentkezés előtti pillanat) a helyi név, hogy a per-fiók kulcsok
   * sose szakadjanak el. A `localStorage`-os `current_user` már nem használt,
   * de olvasásra megmarad: régi gépeken az ott tárolt név a tartalék.
   */
  function currentUser() {
    if (typeof Auth !== 'undefined' && Auth.currentUser && Auth.currentUser()) {
      return Auth.currentUser();
    }
    return get('current_user', LOCAL_USER) || LOCAL_USER;
  }

  // ── Per-fiók csoport kezelés ─────────────────────────────────────────────
  function getAccountGroups(account) {
    return get('groups_' + safe(account), []);
  }

  function setAccountGroups(account, groups) {
    set('groups_' + safe(account), groups);
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

  // A jogosultság-ellenőrzés egyetlen belépési pontja az `Auth.can()`. Ez a
  // függvény csak azért maradt, mert több modul hívja (napló, DevModule): a
  // szintekre az `Auth` felel. Ha nincs Auth (régi gép, próba mód), a korábbi
  // „mindent szabad" viselkedés marad.
  function isAdmin() {
    if (typeof Auth !== 'undefined' && Auth.currentRole && Auth.currentRole()) {
      return Auth.can('log.all');
    }
    return true;
  }

  return {
    get, set, remove,
    currentUser,
    getAccountGroups,
    setAccountGroups,
    ehContact,
    setEhContact,
    EH_CONTACT_DEFAULT,
    isAdmin,
  };
})();
