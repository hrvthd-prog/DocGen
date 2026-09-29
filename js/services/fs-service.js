'use strict';

const FsService = (() => {
  const DB_NAME  = 'docgen_fs';
  const DB_STORE = 'handles';
  const DB_VER   = 1;

  let _db = null;

  async function openDb() {
    if (_db) return _db;
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = e => e.target.result.createObjectStore(DB_STORE);
      req.onsuccess = e => { _db = e.target.result; res(_db); };
      req.onerror   = e => rej(e.target.error);
    });
  }

  async function saveHandle(key, handle) {
    const db = await openDb();
    return new Promise((res, rej) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(handle, key);
      tx.oncomplete = () => res();
      tx.onerror = e => rej(e.target.error);
    });
  }

  async function loadHandle(key) {
    const db = await openDb();
    return new Promise((res, rej) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(key);
      req.onsuccess = e => res(e.target.result || null);
      req.onerror   = e => rej(e.target.error);
    });
  }

  async function verifyPermission(handle, write = false) {
    const mode = write ? 'readwrite' : 'read';
    if ((await handle.queryPermission({ mode })) === 'granted') return true;
    return (await handle.requestPermission({ mode })) === 'granted';
  }

  // Csak lekérdez, nem kér — biztonságos user-gesture nélkül is (pl. page load)
  async function queryPermissionOnly(handle, write = false) {
    const mode = write ? 'readwrite' : 'read';
    try { return (await handle.queryPermission({ mode })) === 'granted'; }
    catch { return false; }
  }

  const hasFsApi = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

  // Felhasználó-prefixelt kulcs az IndexedDB-ben — így minden user saját mappáit tárolja
  function userKey(key) {
    const u = (typeof Settings !== 'undefined' && Settings.currentUser())
      ? Settings.currentUser().replace(/[^a-zA-Z0-9]/g, '_')
      : '';
    return u ? u + '_' + key : key;
  }

  // force = true: a tárolt handle-t átugorja, ezért mindig feljön a rendszer
  // mappaválasztója. Mappa-váltáshoz kell — enélkül a még érvényes engedélyű
  // régi handle-lel tér vissza, és a váltás látszólag nem csinál semmit.
  async function getOrRequestDir(key, description, { force = false } = {}) {
    const storeKey = userKey(key);
    let handle = null;
    if (!force) {
      try { handle = await loadHandle(storeKey); } catch {}

      if (handle) {
        try {
          // readwrite kell: a handle-t írásra használjuk. Enélkül csak az olvasási
          // engedélyt igazoltuk, és a createWritable() később, a generálás
          // közepén dobott NotAllowedError-t.
          const ok = await verifyPermission(handle, true);
          if (ok) return handle;
        } catch {}
      }
    }

    if (!hasFsApi) return null;

    try {
      handle = await window.showDirectoryPicker({ id: key, mode: 'readwrite', startIn: 'documents' });
      await saveHandle(storeKey, handle);
      return handle;
    } catch (e) {
      if (e.name !== 'AbortError') console.error('FsService.getOrRequestDir:', e);
      return null;
    }
  }

  // force = true: átugorja a tárolt handle-t, ezért mindig feljön a fájlválasztó.
  // Ugyanaz a hiba volt itt, mint a mappánál 2026-08-19 előtt: enélkül a még
  // érvényes engedélyű RÉGI fájllal tér vissza, és a váltás nem csinál semmit.
  async function getOrRequestFile(key, description, accept, { force = false } = {}) {
    const storeKey = userKey(key);
    let handle = null;
    if (!force) {
      try { handle = await loadHandle(storeKey); } catch {}

      if (handle) {
        try {
          const ok = await verifyPermission(handle);
          if (ok) return handle;
        } catch {}
      }
    }

    if (!hasFsApi) return null;

    try {
      const [picked] = await window.showOpenFilePicker({
        id: key,
        startIn: 'documents',
        types: accept ? [{ description, accept }] : undefined,
      });
      await saveHandle(storeKey, picked);
      return picked;
    } catch (e) {
      if (e.name !== 'AbortError') console.error('FsService.getOrRequestFile:', e);
      return null;
    }
  }

  // ── dolgozói mappa + a PDF Műhely két alkönyvtára ─────────────────────────
  // A Műhely szerkezete: <munkamappa>\<Dolgozó Név>\01_Elokeszitett | 02_Feltoltheto
  // A DocGen az ELŐKÉSZÍTETTBE generál: az irat nyomtatásra/aláírásra vár.
  const DIR_PREP = '01_Elokeszitett';
  const DIR_UP   = '02_Feltoltheto';

  // Ékezet- és kisbetű-független kulcs — a Műhely strip_accents-ének párja.
  const HU_MAP = { á:'a', é:'e', í:'i', ó:'o', ö:'o', ő:'o', ú:'u', ü:'u', ű:'u' };
  function foldName(s) {
    return String(s || '').toLowerCase().replace(/[áéíóöőúüű]/g, c => HU_MAP[c]).trim();
  }

  async function listSubDirs(dirHandle) {
    const out = [];
    for await (const [name, entry] of dirHandle.entries()) {
      if (entry.kind === 'directory' && !name.startsWith('.')) out.push(name);
    }
    return out.sort((a, b) => a.localeCompare(b, 'hu'));
  }

  /** A Műhely resolve_worker-ének párja: pontos egyezés, vagy az EGYETLEN
   *  részegyezés. Bizonytalanságnál null — a hívó kérdez, nem talál ki mappát. */
  function matchWorkerDir(name, dirs) {
    const f = foldName(name);
    if (!f) return { dir: null, hits: dirs.slice() };
    const exact = dirs.filter(d => foldName(d) === f);
    if (exact.length === 1) return { dir: exact[0], hits: exact };
    const part = dirs.filter(d => foldName(d).includes(f) || f.includes(foldName(d)));
    return { dir: part.length === 1 ? part[0] : null, hits: part };
  }

  async function listDocxFiles(dirHandle) {
    const files = [];
    for await (const [name, entry] of dirHandle.entries()) {
      if (entry.kind === 'file' && name.toLowerCase().endsWith('.docx')) {
        files.push(name);
      }
    }
    return files.sort((a, b) => a.localeCompare(b, 'hu'));
  }

  // Rekurzív szkennelés — visszaadja: [{name, subdir}]
  // subdir: teljes relatív útvonal (pl. "Telephely/Alcsoport/nyomtatványok"), null ha a gyökérben van
  //
  // Mélységi korlát és pont-szűrés: ha a sablonmappa egybeesik (vagy átfed) a PDF
  // Műhely munkamappájával, korlát nélkül bejárná az összes dolgozói mappát és a
  // .eredeti\ mentéseket is. A Műhely walk_files-a mindenhol kihagyja a ponttal
  // kezdődő mappát — itt is így kell.
  const SCAN_MAX_DEPTH = 4;
  const SKIP_DIRS = new Set(['01_Elokeszitett', '02_Feltoltheto']);

  async function listDocxFilesDeep(dirHandle) {
    const files = [];
    await _scanRecursive(dirHandle, null, files, 0);
    return files.sort((a, b) => a.name.localeCompare(b.name, 'hu'));
  }

  async function _scanRecursive(dirHandle, basePath, files, depth) {
    for await (const [name, entry] of dirHandle.entries()) {
      if (entry.kind === 'file' && name.toLowerCase().endsWith('.docx')) {
        files.push({ name, subdir: basePath });
      } else if (entry.kind === 'directory') {
        if (depth + 1 > SCAN_MAX_DEPTH) continue;
        if (name.startsWith('.') || SKIP_DIRS.has(name)) continue;
        const subPath = basePath ? `${basePath}/${name}` : name;
        try { await _scanRecursive(entry, subPath, files, depth + 1); } catch {}
      }
    }
  }

  async function readFileHandle(fileHandle) {
    const file = await fileHandle.getFile();
    return file.arrayBuffer();
  }

  async function readFromDir(dirHandle, filename) {
    const fh = await dirHandle.getFileHandle(filename);
    const file = await fh.getFile();
    return file.arrayBuffer();
  }

  // A writable Chromiumban swap-fájlon dolgozik, és a close() cseréli be. Ha a
  // write és a close között hiba van, a stream nyitva marad, és .crswap maradék
  // keletkezik – ezért a finally-ben abort(). Írás után visszaolvassuk a méretet:
  // a csendes csonkolás (hálózati meghajtó, tele lemez) így nem marad észrevétlen.
  async function writeToDir(dirHandle, filename, buffer) {
    const fh = await dirHandle.getFileHandle(filename, { create: true });
    const writable = await fh.createWritable();
    let closed = false;
    try {
      await writable.write(buffer);
      await writable.close();
      closed = true;
    } finally {
      if (!closed) { try { await writable.abort(); } catch {} }
    }
    const want = buffer.byteLength ?? buffer.size;
    if (typeof want === 'number') {
      const got = (await fh.getFile()).size;
      if (got !== want) {
        throw new Error(`A kiírt fájl mérete eltér (${got} ≠ ${want}): ${filename}`);
      }
    }
  }

  // A „nincs ilyen mappa” jogos eset (null), a „nincs engedély” vagy „érvénytelen
  // név” NEM az: azokat dobjuk. Enélkül egy engedélyhiba némán úgy néz ki, mintha
  // a mappa nem létezne, és a hívó máshova (a gyökérbe) írna.
  async function getSubDir(dirHandle, name, create = false) {
    try {
      return await dirHandle.getDirectoryHandle(name, { create });
    } catch (e) {
      if (e && e.name === 'NotFoundError') return null;
      throw e;
    }
  }

  // Ahol a régi, hibát elnyelő viselkedés kell (pl. „van-e egyáltalán ilyen”),
  // ott ez a változat használható – de tudatosan, nem véletlenül.
  async function getSubDirOrNull(dirHandle, name, create = false) {
    try { return await getSubDir(dirHandle, name, create); }
    catch { return null; }
  }

  // Fájlnevek listázása a mappában, opcionális szűrővel
  async function listFiles(dirHandle, filterFn) {
    const names = [];
    for await (const [name, entry] of dirHandle.entries()) {
      if (entry.kind !== 'file') continue;
      if (!filterFn || filterFn(name)) names.push(name);
    }
    return names.sort((a, b) => a.localeCompare(b, 'hu'));
  }

  // „Nincs ilyen fájl” -> false; minden más (engedélyhiba!) dobódik. Enélkül egy
  // engedélyhiba úgy néz ki, mint a fájl hiánya, és a felülírás-kérdés elmarad.
  async function fileExists(dirHandle, filename) {
    try { await dirHandle.getFileHandle(filename); return true; }
    catch (e) {
      if (e && e.name === 'NotFoundError') return false;
      throw e;
    }
  }

  async function deleteFromDir(dirHandle, filename) {
    try { await dirHandle.removeEntry(filename); return true; }
    catch (e) {
      if (e && e.name === 'NotFoundError') return false;   // már nincs ott: rendben
      throw e;
    }
  }

  // Szöveges fájl olvasása/írása – az adatbázis JSON-jaihoz
  async function readTextFromDir(dirHandle, filename) {
    const fh = await dirHandle.getFileHandle(filename);
    const file = await fh.getFile();
    return file.text();
  }

  async function writeTextToDir(dirHandle, filename, text) {
    await writeToDir(dirHandle, filename,
                     new Blob([text], { type: 'application/json' }));
  }

  return {
    hasFsApi,
    getOrRequestDir,
    getOrRequestFile,
    listDocxFiles,
    listDocxFilesDeep,
    readFileHandle,
    readFromDir,
    writeToDir,
    getSubDir,
    getSubDirOrNull,
    DIR_PREP,
    DIR_UP,
    foldName,
    listSubDirs,
    matchWorkerDir,
    listFiles,
    fileExists,
    deleteFromDir,
    readTextFromDir,
    writeTextToDir,
    // Publikus saveHandle/loadHandle automatikusan user-prefixelt kulcsot használ
    saveHandle: (key, handle) => saveHandle(userKey(key), handle),
    loadHandle: (key) => loadHandle(userKey(key)),
    verifyPermission,
    queryPermissionOnly,
  };
})();
