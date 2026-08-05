'use strict';

const BevLogger = (() => {
  const SERVER = 'http://127.0.0.1:3456/log';
  let _user = 'ismeretlen';

  // Stack trace gyűjtő — ha nincs explicit tech, automatikusan generál egyet
  function _autoStack() {
    try {
      const e = new Error();
      // Kihagyjuk a logger saját kereteit (3 sor: Error, _autoStack, _send)
      return (e.stack || '').split('\n').slice(3, 8).join('\n');
    } catch { return ''; }
  }

  // Truncate hosszú szövegeknek, hogy ne robbantsuk a logot
  function _trunc(s, max = 800) {
    s = String(s || '');
    return s.length > max ? s.slice(0, max) + '… [+' + (s.length - max) + ' karakter]' : s;
  }

  function _send(level, category, human, tech, context) {
    try {
      // Ha nincs tech, auto stack trace
      const techStr = tech ? _trunc(tech, 1500) : _autoStack();
      const ctxStr  = _trunc(context, 600);
      const payload = {
        user:     _user,
        level,
        category,
        human:    _trunc(human, 500),
        tech:     techStr,
        context:  ctxStr,
      };
      fetch(SERVER, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {});
    } catch (_) {}
  }

  function init(user) {
    if (user) _user = user;
  }

  // Részletes log: state-snapshot is mehet a context-be
  function snapshot(obj) {
    try { return JSON.stringify(obj, (k, v) => {
      if (v instanceof Set) return [...v];
      if (v instanceof Map) return Object.fromEntries(v);
      return v;
    }, 0); } catch { return '[snapshot serialization failed]'; }
  }

  function error(category, human, tech, context) { _send('HIBA',  category, human, tech, context); }
  function warn (category, human, tech, context) { _send('FIGY',  category, human, tech, context); }
  function info (category, human, tech, context) { _send('INFO',  category, human, tech, context); }
  function debug(category, human, tech, context) { _send('DEBUG', category, human, tech, context); }
  function log  (level, category, human, tech, context) { _send(level, category, human, tech, context); }

  function initGlobalHandlers() {
    window.onerror = (msg, src, line, col, err) => {
      const tech = err ? (err.stack || err.message || String(err)) : String(msg);
      const ctx  = src ? `${src}:${line}:${col}` : '';
      error('JS_GLOBAL', 'Váratlan JavaScript hiba az alkalmazásban', tech, ctx);
      return false;
    };
    window.addEventListener('unhandledrejection', e => {
      const r = e.reason;
      const tech = r ? (r.stack || r.message || String(r)) : 'unhandledrejection';
      const ctx  = r ? `name=${r.name || 'unknown'}` : '';
      error('JS_PROMISE', 'Kezeletlen Promise elutasítás', tech, ctx);
    });
  }

  return { init, log, error, warn, info, debug, snapshot, initGlobalHandlers };
})();
