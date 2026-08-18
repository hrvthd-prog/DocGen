'use strict';

/**
 * xlsx beolvasás a nyilvántartásba.
 *
 * A beolvasás SheetJS-szel történik (megbízhatóan kezeli a megosztott
 * szövegtáblát, a dátumokat és a régebbi formátumokat). Az értékeket a séma
 * értelmezi: a választható mezőknél bármelyik ismert írásmód elfogadott, így
 * a magyarul és az angolul kitöltött táblázat is beolvasható.
 *
 * A párosítás az azonosító-történetre épül: egy régi SAP-számmal érkező sor is
 * ráismer a már meglévő személyre, ezért ismételt import sem hoz duplikátumot.
 */
const XlsxRead = (() => {

  /**
   * Sorok kiolvasása a séma kulcsai szerint.
   * @returns {{ rows: Array, unknownColumns: string[], sheetName: string }}
   */
  function readRows(arrayBuffer, { schema, sheetName, keyRow = 1, firstDataRow = 3 } = {}) {
    const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: false });
    const name = (sheetName && wb.Sheets[sheetName]) ? sheetName
               : (wb.Sheets['Data'] ? 'Data' : wb.SheetNames[0]);
    const ws = wb.Sheets[name];
    if (!ws || !ws['!ref']) throw new Error('A munkalap üres vagy nem olvasható.');

    const range = XLSX.utils.decode_range(ws['!ref']);
    const known = new Map(schema.fields.filter(f => f.type !== 'computed').map(f => [f.key, f]));

    // Oszlopfejlécek → mezők
    const oszlopok = [];
    const ismeretlen = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const key = text(ws, keyRow - 1, c);
      if (!key) continue;
      const f = known.get(key) || matchByLabel(key, schema);
      if (f) oszlopok.push({ field: f, c });
      else ismeretlen.push(key);
    }

    const rows = [];
    for (let r = firstDataRow - 1; r <= range.e.r; r++) {
      const fields = {};
      const gondok = [];
      let vanAdat = false;

      for (const { field, c } of oszlopok) {
        const nyers = text(ws, r, c);
        if (nyers === '') { fields[field.key] = ''; continue; }
        vanAdat = true;

        if (field.type === 'enum') {
          const id = ValueCodec.decode(field, nyers);
          if (id === null) {
            // Nem dobjuk el: bekerül nyersen, de jelezzük
            fields[field.key] = nyers;
            gondok.push(`„${field.label.hu}": ismeretlen érték – ${nyers}`);
          } else {
            fields[field.key] = id;
          }
        } else if (field.type === 'date') {
          const iso = serialToIso(ws, r, c) || toIsoDate(nyers);
          fields[field.key] = iso || nyers;
          if (!iso) gondok.push(`„${field.label.hu}": nem értelmezhető dátum – ${nyers}`);
        } else {
          fields[field.key] = nyers;
        }
      }

      if (!vanAdat) continue;   // teljesen üres sor
      rows.push({ excelRow: r + 1, fields, problems: gondok });
    }

    return { rows, unknownColumns: ismeretlen, sheetName: name };
  }

  function text(ws, r, c) {
    const cell = ws[XLSX.utils.encode_cell({ r, c })];
    if (!cell) return '';
    const v = cell.w != null ? cell.w : cell.v;
    return v == null ? '' : String(v).trim();
  }

  /**
   * Valódi Excel-dátumcella → ISO.
   *
   * Ez a dátumbeolvasás lényege. A cella *megjelenített* szövege a kitöltő
   * gépének területi beállításától függ: ugyanaz a nap lehet „1990-03-15",
   * „1990. 03. 15." vagy „3/15/90". Az utóbbiból nem is lehet megmondani, hogy
   * hónap/nap vagy nap/hónap a sorrend.
   *
   * A tárolt érték viszont mindig ugyanaz a sorszám (1900-as rendszer), és az
   * egyértelmű. Ezért dátummezőnél NEM a szöveget olvassuk, hanem a sorszámot –
   * emiatt esett ki korábban a születési idő, az útlevél-dátumok és a
   * belépés/kilépés a legtöbb kitöltött táblázatból.
   */
  function serialToIso(ws, r, c) {
    const cell = ws[XLSX.utils.encode_cell({ r, c })];
    if (!cell || cell.t !== 'n' || typeof cell.v !== 'number') return null;
    // 60 = az 1900-as rendszer nem létező szökőnapja; alatta nincs értelmes dátum
    if (!(cell.v > 60) || cell.v > 2958465) return null;   // 2958465 = 9999-12-31
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(cell.v) * 86400000);
    return isNaN(d) ? null : d.toISOString().slice(0, 10);
  }

  /** Ha a fejléc nem a gépi kulcs, próbáljuk a magyar/angol címkét és a jelölőket. */
  function matchByLabel(header, schema) {
    const norm = s => String(s).toLowerCase().replace(/[\s._-]+/g, ' ').trim();
    const n = norm(header);
    return schema.fields.find(f =>
      f.type !== 'computed' &&
      [f.label.hu, f.label.en].concat(f.tags || []).filter(Boolean).some(x => norm(x) === n)
    ) || null;
  }

  /**
   * Elterjedt dátumalakok ISO-ra. Ami nem egyértelmű, azt nem találgatjuk:
   * a „05/11/2027" május 11. és november 5. is lehet, és hatósági ügyben
   * találgatni nem lehet – az ilyen sor inkább hibát kap.
   *
   * Az évvel kezdődő alak viszont egyértelmű, akárhogy is tagolják:
   * „1990-03-15", „1990.03.15.", „1990. 03. 15." mind ugyanaz a nap.
   */
  function toIsoDate(s) {
    const t = String(s).trim();
    let m;
    if ((m = /^(\d{4})\s*[-.\/]\s*(\d{1,2})\s*[-.\/]\s*(\d{1,2})\s*\.?$/.exec(t))) {
      return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    }
    // Excel sorszám (1900-as rendszer)
    if (/^\d{5}$/.test(t)) {
      const d = new Date(Date.UTC(1899, 11, 30) + Number(t) * 86400000);
      if (!isNaN(d)) return d.toISOString().slice(0, 10);
    }
    return null;
  }

  function pad(x) { return String(x).padStart(2, '0'); }

  /**
   * Beolvasott sorok besorolása: új / meglévő / duplikátum a fájlon belül.
   * Nem módosít semmit – az eredményt a felhasználó hagyja jóvá.
   */
  function plan(rows, { schema }) {
    const terv = [];
    const fajlonBelul = new Map();   // természetes kulcs → első sor

    for (const row of rows) {
      const identifiers = identifiersFrom(row.fields);
      const m = EmployeeRepo.matchIncoming({ identifiers, fields: row.fields });

      const nk = EmployeeRepo.naturalKeyOf(row.fields);
      const dupSor = nk.replace(/␟/g, '') ? fajlonBelul.get(nk) : null;
      if (!dupSor && nk.replace(/␟/g, '')) fajlonBelul.set(nk, row.excelRow);

      terv.push({
        row,
        identifiers,
        action: dupSor ? 'duplicate' : (m.employee ? 'update' : 'create'),
        matchedBy: m.matchedBy,
        employee: m.employee,
        duplicateOf: dupSor || null,
        validation: SchemaStore.validateValues(row.fields),
      });
    }
    return terv;
  }

  /** Az azonosító-mezőkből azonosító-bejegyzések (a történet miatt). */
  function identifiersFrom(fields) {
    const out = [];
    for (const [type, key] of Object.entries(EmployeeRepo.IDENTIFIER_FIELD_MAP)) {
      const v = fields[key];
      if (v && String(v).trim()) out.push({ type, value: String(v).trim() });
    }
    return out;
  }

  /**
   * A jóváhagyott terv végrehajtása.
   * Meglévő személynél az új azonosító a történetbe kerül – a régi lezárul.
   */
  function apply(terv, { onlyValid = true } = {}) {
    let letrehozva = 0, frissitve = 0, kihagyva = 0, ujAzonosito = 0;

    for (const t of terv) {
      if (t.action === 'duplicate') { kihagyva++; continue; }
      if (onlyValid && t.validation.length) { kihagyva++; continue; }

      if (t.action === 'create') {
        EmployeeRepo.create({
          fields: t.row.fields,
          identifiers: t.identifiers.map(i => Object.assign({}, i, { current: true })),
          schemaVersion: SchemaStore.version(),
          source: 'import',
        });
        letrehozva++;
      } else {
        EmployeeRepo.update(t.employee.id, {
          fields: t.row.fields,
          schemaVersion: SchemaStore.version(),
          source: 'import',
        });
        // Új azonosító → a korábbi azonos típusú lezárul
        for (const idf of t.identifiers) {
          const meglevo = t.employee.identifiers.find(
            x => x.type === idf.type && ValueCodecEq(x.value, idf.value));
          if (!meglevo) {
            try { EmployeeRepo.addIdentifier(t.employee.id, idf, { source: 'import' }); ujAzonosito++; }
            catch { /* más személyhez tartozik – a validáció már jelezte */ }
          }
        }
        frissitve++;
      }
    }
    return { letrehozva, frissitve, kihagyva, ujAzonosito };
  }

  function ValueCodecEq(a, b) {
    return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  }

  return { readRows, plan, apply, _toIsoDate: toIsoDate, _identifiersFrom: identifiersFrom };
})();
