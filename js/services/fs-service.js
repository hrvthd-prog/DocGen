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
          const ok = await verifyPermission(handle);
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

  async function getOrRequestFile(key, description, accept) {
    const storeKey = userKey(key);
    let handle = null;
    try { handle = await loadHandle(storeKey); } catch {}

    if (handle) {
      try {
        const ok = await verifyPermission(handle);
        if (ok) return handle;
      } catch {}
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

  async function listDocxFiles(dirHandle) {
    const files = [];
    for await (const [name, entry] of dirHandle.entries()) {
      if (entry.kind === 'file' && name.toLowerCase().endsWith('.docx')) {
        files.push(name);
      }
    }
    return files.sort((a, b) => a.localeCompare(b, 'hu'));
  }

  // Teljesen rekurzív szkennelés — visszaadja: [{name, subdir}]
  // subdir: teljes relatív útvonal (pl. "Telephely/Alcsoport/nyomtatványok"), null ha a gyökérben van
  async function listDocxFilesDeep(dirHandle) {
    const files = [];
    await _scanRecursive(dirHandle, null, files);
    return files.sort((a, b) => a.name.localeCompare(b.name, 'hu'));
  }

  async function _scanRecursive(dirHandle, basePath, files) {
    for await (const [name, entry] of dirHandle.entries()) {
      if (entry.kind === 'file' && name.toLowerCase().endsWith('.docx')) {
        files.push({ name, subdir: basePath });
      } else if (entry.kind === 'directory') {
        const subPath = basePath ? `${basePath}/${name}` : name;
        try { await _scanRecursive(entry, subPath, files); } catch {}
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

  async function writeToDir(dirHandle, filename, buffer) {
    const fh = await dirHandle.getFileHandle(filename, { create: true });
    const writable = await fh.createWritable();
    await writable.write(buffer);
    await writable.close();
  }

  async function getSubDir(dirHandle, name, create = false) {
    try {
      return await dirHandle.getDirectoryHandle(name, { create });
    } catch { return null; }
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

  async function fileExists(dirHandle, filename) {
    try { await dirHandle.getFileHandle(filename); return true; }
    catch { return false; }
  }

  async function deleteFromDir(dirHandle, filename) {
    try { await dirHandle.removeEntry(filename); return true; }
    catch { return false; }
  }

  // Szöveges fájl olvasása/írása – az adatbázis JSON-jaihoz
  async function readTextFromDir(dirHandle, filename) {
    const fh = await dirHandle.getFileHandle(filename);
    const file = await fh.getFile();
    return file.text();
  }

  async function writeTextToDir(dirHandle, filename, text) {
    const fh = await dirHandle.getFileHandle(filename, { create: true });
    const writable = await fh.createWritable();
    await writable.write(new Blob([text], { type: 'application/json' }));
    await writable.close();
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
