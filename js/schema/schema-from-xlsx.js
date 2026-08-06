'use strict';

/**
 * Séma-javaslat egy adatbekérő xlsx-ből.
 *
 * Ha a Horizontes új sablonverziót küld, ez olvassa be és veti össze az élő
 * sémával: mi az új mező, mi tűnt el, változott-e valamelyik legördülő. A
 * felhasználó dönti el, mit fogad el – az app magától semmit nem ír át.
 *
 * A legördülőket (adatérvényesítés) a SheetJS ingyenes kiadása nem adja vissza,
 * ezért azt a nyers munkalap-XML-ből olvassuk ki PizZip-pel. A cellaértékekhez
 * viszont a SheetJS-t használjuk, mert az megbízhatóan kezeli a megosztott
 * szövegtáblát és a kódolásokat.
 */
const SchemaFromXlsx = (() => {

  const HEADER_ROW = 1;   // gépi kulcsok
  const LABEL_ROW  = 2;   // angol címkék

  // ── Beolvasás ──────────────────────────────────────────────────────────────

  function analyze(arrayBuffer, sheetName) {
    const wb = XLSX.read(arrayBuffer, { type: 'array' });
    const name = (sheetName && wb.Sheets[sheetName]) ? sheetName
               : (wb.Sheets['Data'] ? 'Data' : wb.SheetNames[0]);
    const ws = wb.Sheets[name];
    if (!ws || !ws['!ref']) throw new Error('A munkalap üres vagy nem olvasható.');

    const range = XLSX.utils.decode_range(ws['!ref']);
    const columns = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const key   = cellText(ws, HEADER_ROW - 1, c);
      const label = cellText(ws, LABEL_ROW - 1, c);
      if (!key) continue;
      columns.push({ key, labelEn: label, colIndex: c });
    }

    const dropdowns = readDropdowns(arrayBuffer, name, columns);
    return { sheetName: name, columns, dropdowns };
  }

  function cellText(ws, r, c) {
    const cell = ws[XLSX.utils.encode_cell({ r, c })];
    if (!cell) return '';
    return String(cell.w != null ? cell.w : (cell.v != null ? cell.v : '')).trim();
  }

  /**
   * Adatérvényesítés (legördülők) kiolvasása a munkalap XML-jéből.
   * Alak: <dataValidation type="list" sqref="F3:F32"><formula1>"male,female"</formula1>
   */
  function readDropdowns(arrayBuffer, sheetName, columns) {
    const out = {};
    try {
      const zip = new PizZip(arrayBuffer);
      const sheetPath = findSheetPath(zip, sheetName);
      if (!sheetPath) return out;

      const xml = zip.files[sheetPath].asText();
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      const nodes = doc.getElementsByTagNameNS('*', 'dataValidation');

      for (const node of Array.from(nodes)) {
        if ((node.getAttribute('type') || '') !== 'list') continue;
        const sqref = node.getAttribute('sqref') || '';
        const f1 = node.getElementsByTagNameNS('*', 'formula1')[0];
        if (!f1) continue;

        const raw = String(f1.textContent || '').trim();
        // Csak a helyben felsorolt értékeket tudjuk értelmezni ("a,b,c"),
        // a más munkalapra hivatkozó tartományt nem.
        if (!raw.startsWith('"')) continue;
        const values = raw.replace(/^"|"$/g, '').split(',').map(s => s.trim()).filter(Boolean);

        for (const ref of sqref.split(/\s+/)) {
          const m = /^([A-Z]+)\d+/.exec(ref.split(':')[0]);
          if (!m) continue;
          const idx = colToIndex(m[1]);
          const col = columns.find(c => c.colIndex === idx);
          if (col) out[col.key] = values;
        }
      }
    } catch { /* legördülők nélkül is használható a javaslat */ }
    return out;
  }

  function findSheetPath(zip, sheetName) {
    try {
      const wbXml = zip.files['xl/workbook.xml'].asText();
      const relXml = zip.files['xl/_rels/workbook.xml.rels'].asText();
      const wbDoc  = new DOMParser().parseFromString(wbXml, 'application/xml');
      const relDoc = new DOMParser().parseFromString(relXml, 'application/xml');

      const sheets = Array.from(wbDoc.getElementsByTagNameNS('*', 'sheet'));
      const sheet = sheets.find(s => s.getAttribute('name') === sheetName) || sheets[0];
      if (!sheet) return null;

      const rid = sheet.getAttribute('r:id') || sheet.getAttributeNS(
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      const rel = Array.from(relDoc.getElementsByTagNameNS('*', 'Relationship'))
        .find(r => r.getAttribute('Id') === rid);
      if (!rel) return null;

      let target = rel.getAttribute('Target') || '';
      target = target.replace(/^\/?xl\//, '').replace(/^\//, '');
      const path = 'xl/' + target;
      return zip.files[path] ? path : null;
    } catch { return null; }
  }

  function colToIndex(letters) {
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  // ── Összevetés az élő sémával ──────────────────────────────────────────────

  /**
   * Mi változott? Csak javaslatot ad – az alkalmazás a felhasználó döntése.
   *   added        – a fájlban van, a sémában nincs
   *   removed      – a sémában van, a fájlból kikerült
   *   enumChanged  – a legördülő értékkészlete eltér
   *   labelChanged – az angol címke megváltozott
   *   orderChanged – az oszlopsorrend eltér (csak jelzés)
   */
  function diff(analysis, schema) {
    const stored = schema.fields.filter(f => f.type !== 'computed');
    const byKey = new Map(stored.map(f => [f.key, f]));
    const fileKeys = analysis.columns.map(c => c.key);

    const added = analysis.columns
      .filter(c => !byKey.has(c.key))
      .map(c => ({
        key: c.key,
        labelEn: c.labelEn,
        dropdown: analysis.dropdowns[c.key] || null,
      }));

    const removed = stored
      .filter(f => !fileKeys.includes(f.key))
      .map(f => ({ key: f.key, label: f.label.hu }));

    const enumChanged = [];
    const labelChanged = [];
    for (const c of analysis.columns) {
      const f = byKey.get(c.key);
      if (!f) continue;

      const fileVals = analysis.dropdowns[c.key];
      if (fileVals) {
        const schemaVals = (f.values || []).map(v => v.id);
        if (!sameSet(fileVals, schemaVals)) {
          enumChanged.push({
            key: c.key, label: f.label.hu,
            from: schemaVals, to: fileVals,
            newValues: fileVals.filter(v => !schemaVals.includes(v)),
            goneValues: schemaVals.filter(v => !fileVals.includes(v)),
          });
        }
      }
      if (c.labelEn && f.label.en && c.labelEn !== f.label.en) {
        labelChanged.push({ key: c.key, label: f.label.hu, from: f.label.en, to: c.labelEn });
      }
    }

    const schemaOrder = stored.map(f => f.key).filter(k => fileKeys.includes(k));
    const fileOrder   = fileKeys.filter(k => byKey.has(k));
    const orderChanged = schemaOrder.join('|') !== fileOrder.join('|');

    return {
      added, removed, enumChanged, labelChanged, orderChanged,
      fileOrder: fileKeys,
      hasChanges: !!(added.length || removed.length || enumChanged.length || labelChanged.length || orderChanged),
    };
  }

  function sameSet(a, b) {
    return a.length === b.length && a.slice().sort().join('|') === b.slice().sort().join('|');
  }

  /**
   * Az elfogadott javaslatok alkalmazása. Csak azt módosítja, amit a
   * `choices` engedélyez – a törlést szándékosan nem hajtja végre automatikusan,
   * azt a mezőszerkesztőben kell megerősíteni.
   */
  function apply(schema, d, choices = {}) {
    const s = JSON.parse(JSON.stringify(schema));
    const changes = [];

    for (const a of d.added) {
      if (!choices.added?.includes(a.key)) continue;
      const field = {
        key: a.key,
        group: 'egyeb',
        type: a.dropdown ? 'enum' : 'text',
        required: false,
        label: { hu: a.labelEn || a.key, en: a.labelEn || '' },
        tags: [],
      };
      if (a.dropdown) {
        field.values = a.dropdown.map(v => ({ id: v, hu: v, en: v, accepts: [] }));
      }
      s.fields.push(field);
      changes.push(`Új mező: ${a.key}`);
    }

    for (const e of d.enumChanged) {
      if (!choices.enumChanged?.includes(e.key)) continue;
      const f = s.fields.find(x => x.key === e.key);
      if (!f) continue;
      const meglevo = new Map((f.values || []).map(v => [v.id, v]));
      // A meglévő fordítások és írásmódok megmaradnak, csak a készlet igazodik
      f.values = e.to.map(id => meglevo.get(id) || { id, hu: id, en: id, accepts: [] });
      f.type = 'enum';
      changes.push(`Legördülő frissítve: ${e.key}`);
    }

    for (const l of d.labelChanged) {
      if (!choices.labelChanged?.includes(l.key)) continue;
      const f = s.fields.find(x => x.key === l.key);
      if (f) { f.label.en = l.to; changes.push(`Angol címke: ${l.key}`); }
    }

    if (choices.order && d.fileOrder) {
      const rank = new Map(d.fileOrder.map((k, i) => [k, i]));
      s.fields.sort((a, b) => {
        const ra = rank.has(a.key) ? rank.get(a.key) : 9999;
        const rb = rank.has(b.key) ? rank.get(b.key) : 9999;
        return ra - rb;
      });
      changes.push('Oszlopsorrend igazítva a fájlhoz');
    }

    if (changes.length) s.version = (s.version || 1) + 1;
    return { schema: s, changes };
  }

  return { analyze, diff, apply, _colToIndex: colToIndex };
})();
