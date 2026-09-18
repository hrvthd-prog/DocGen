'use strict';

/**
 * A PDF-lánc — a generálás és az összefűzés közötti hiányzó láncszem.
 *
 *   DOCX generálás  →  [Word konverzió]  →  PDF-ek  →  összefűzés
 *        (app)            (docx-pdf.vbs)     (lemez)      (app)
 *
 * A középső lépést böngészőből nem lehet elindítani: Wordöt csak a gépen futó
 * program vezérelhet. Ez nem hiányosság, hanem határ – hivatalos nyomtatvány
 * tördelését egyedül a Word ismeri, és minden böngészős közelítés (mammoth,
 * HTML-nyomtatás) a formát rontja el, pont amiért az irat készül.
 *
 * Ez a modul azt a három dolgot adja, ami eddig hiányzott, és ami miatt a lánc
 * a gyakorlatban megszakadt:
 *
 *   1. A KONVERTÁLÓ SZKRIPT a DOCX-ek mellé kerül. Eddig a repó tools/
 *      mappájában volt, a kimenet meg máshol – kézzel kellett megtalálni és
 *      ráhúzni a mappát. Bájtmásolatként megy, így az UTF-16 LE kódolás (a
 *      WSH ékezetkezelésének feltétele) sértetlen marad.
 *
 *   2. KÍSÉRŐFÁJL a generálásról, hogy az összefűzés az újratöltést is túlélje.
 *      Eddig `state.lastGenerated` volt, kizárólag a memóriában – aki közben
 *      újratöltötte a lapot vagy másnap tért vissza, „Előbb generálj
 *      dokumentumokat" üzenetet kapott a kész fájlok tetején.
 *
 *      A kísérőfájl a KIMENETI MAPPÁBA kerül, NEM a böngésző tárolójába. Ez
 *      szándékos: a benne álló nevek ugyanabban a mappában amúgy is ott vannak
 *      fájlnévként, tehát nem kerül személyes adat új helyre (vö. a
 *      `state.lastGenerated` melletti döntéssel a docgen.js-ben).
 *
 *   3. ÁLLAPOT: hány DOCX, hány PDF, mi hiányzik. Eddig semmi nem jelezte, ha
 *      12 DOCX mellett 0 PDF volt – az összefűzés csak annyit mondott, hogy
 *      nincs mit összefűzni, az okot nem.
 */
const DocgenPdfChain = (() => {

  const MANIFEST   = 'docgen-generalas.json';
  const SCRIPT_OUT = 'PDF-keszites.vbs';
  const SCRIPT_KEY = 'pdf_script';

  // ── Tiszta függvények (tesztelhetők böngésző nélkül) ───────────────────────

  /** A generálás eredményéből kísérőfájl-tartalom. */
  function buildManifest(generated, { at = new Date().toISOString() } = {}) {
    return {
      version: 1,
      at,
      files: (generated || []).map(g => ({
        docx:     g.name,
        pdf:      pdfName(g.name),
        client:   g.clientName,
        template: g.templateName,
        // A fájlnév-minta két tokenje. Azért kell ide, mert az összefűzött
        // csomag neve ebből áll össze – e nélkül újratöltés után a névminta
        // üresen maradna, és minden csomag ugyanazt a nevet kapná.
        lastName:  g.vezeteknev || '',
        firstName: g.keresztnev || '',
      })),
    };
  }

  /** „Nagy Béla Nyilatkozat.docx" → „Nagy Béla Nyilatkozat.pdf" */
  function pdfName(docxName) {
    return String(docxName || '').replace(/\.docx$/i, '.pdf');
  }

  /**
   * A kísérőfájl és a lemez tényleges tartalmának összevetése.
   *
   * `meglevoPdfek` a mappában TALÁLT PDF-nevek listája. A válasz azt mondja
   * meg, hol tart a konverzió – ebből lesz a felületen a zöld vagy piros sor.
   */
  function compare(manifest, meglevoPdfek) {
    const van = new Set(meglevoPdfek || []);
    const vart = (manifest && Array.isArray(manifest.files)) ? manifest.files : [];
    const hianyzo = vart.filter(f => !van.has(f.pdf)).map(f => f.pdf);
    return {
      vart:     vart.length,
      kesz:     vart.length - hianyzo.length,
      hianyzo,
      // A mappában lehet korábbi futásból maradt PDF is – ezt külön jelezzük,
      // mert az összefűzésbe nem kerül bele, és ez meglepetés tud lenni.
      idegen:   [...van].filter(n => !vart.some(f => f.pdf === n)).length,
      teljes:   vart.length > 0 && hianyzo.length === 0,
    };
  }

  /** Emberi mondat az állapotról – a panel és a naplóbejegyzés is ezt használja. */
  function summaryText(osszevetes) {
    if (!osszevetes.vart) return 'Nincs nyilvántartott generálás ebben a mappában.';
    if (osszevetes.teljes) return `Mind a ${osszevetes.vart} PDF elkészült.`;
    if (!osszevetes.kesz)  return `${osszevetes.vart} DOCX vár konverzióra – PDF még egy sincs.`;
    return `${osszevetes.kesz} / ${osszevetes.vart} PDF kész, ${osszevetes.hianyzo.length} hiányzik.`;
  }

  // ── Fájlműveletek ──────────────────────────────────────────────────────────

  async function writeManifest(outputDir, generated) {
    if (!outputDir) return false;
    try {
      await FsService.writeTextToDir(outputDir, MANIFEST,
        JSON.stringify(buildManifest(generated), null, 2));
      return true;
    } catch (e) {
      // A kísérőfájl kényelmi eszköz: ha nem írható, a generálás akkor is kész.
      BevLogger.warn('PDF_CHAIN', 'A generálás kísérőfájlja nem íródott ki', e.message, outputDir.name || '');
      return false;
    }
  }

  async function readManifest(outputDir) {
    if (!outputDir) return null;
    try {
      const txt = await FsService.readTextFromDir(outputDir, MANIFEST);
      const m = JSON.parse(txt);
      return (m && Array.isArray(m.files)) ? m : null;
    } catch { return null; }
  }

  /**
   * A konvertáló szkript másolása a kimeneti mappába.
   *
   * `kerdezhet: false` esetén csak akkor másol, ha a szkript már ki van
   * választva – generálás közben nem szakítjuk félbe a munkát egy
   * fájlválasztóval (amihez amúgy is külön felhasználói gesztus kellene).
   */
  async function copyScript(outputDir, { kerdezhet = false } = {}) {
    if (!outputDir) return false;
    try {
      let fh = null;
      if (kerdezhet) {
        fh = await FsService.getOrRequestFile(SCRIPT_KEY, 'PDF-készítő szkript',
          { 'text/plain': ['.vbs'] });
      } else {
        fh = await FsService.loadHandle(SCRIPT_KEY);
        if (fh && !(await FsService.queryPermissionOnly(fh))) fh = null;
      }
      if (!fh) return false;

      // Bájtmásolat: a .vbs UTF-16 LE + BOM kódolású, és bármilyen
      // szövegként való átírás tönkretenné az ékezeteket (lásd
      // tools/pdf-proba/EREDMENY.md).
      const buf = await FsService.readFileHandle(fh);
      await FsService.writeToDir(outputDir, SCRIPT_OUT, buf);
      return true;
    } catch (e) {
      BevLogger.warn('PDF_CHAIN', 'A konvertáló szkript másolása nem sikerült', e.message, outputDir.name || '');
      return false;
    }
  }

  async function scriptReady() {
    try {
      const fh = await FsService.loadHandle(SCRIPT_KEY);
      return !!fh && await FsService.queryPermissionOnly(fh);
    } catch { return false; }
  }

  /** A mappában lévő PDF-ek neve, és a legfrissebb módosítási ideje. */
  async function scanPdfs(outputDir) {
    const nevek = [];
    let legfrissebb = null;
    if (!outputDir) return { nevek, legfrissebb };
    try {
      for await (const [name, entry] of outputDir.entries()) {
        if (entry.kind !== 'file' || !name.toLowerCase().endsWith('.pdf')) continue;
        nevek.push(name);
        try {
          const f = await entry.getFile();
          if (!legfrissebb || f.lastModified > legfrissebb) legfrissebb = f.lastModified;
        } catch { /* egy olvashatatlan fájl ne akassza meg a szkennelést */ }
      }
    } catch (e) {
      BevLogger.warn('PDF_CHAIN', 'A kimeneti mappa nem olvasható', e.message, outputDir.name || '');
    }
    return { nevek, legfrissebb };
  }

  /** Teljes állapotkép: kísérőfájl + lemez + szkript megléte. */
  async function status(outputDir) {
    const manifest = await readManifest(outputDir);
    const { nevek, legfrissebb } = await scanPdfs(outputDir);
    let docxDb = 0;
    try {
      docxDb = (await FsService.listFiles(outputDir,
        n => n.toLowerCase().endsWith('.docx') && !n.startsWith('~$'))).length;
    } catch { /* marad 0 */ }

    return {
      manifest,
      docxDb,
      pdfNevek: nevek,
      legfrissebbPdf: legfrissebb,
      szkriptKesz: await scriptReady(),
      ossze: compare(manifest, nevek),
    };
  }

  function idoSzoveg(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}. ${p(d.getMonth() + 1)}. ${p(d.getDate())}. ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  return {
    MANIFEST, SCRIPT_OUT, SCRIPT_KEY,
    buildManifest, pdfName, compare, summaryText, idoSzoveg,
    writeManifest, readManifest, copyScript, scriptReady, scanPdfs, status,
  };
})();
