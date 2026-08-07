'use strict';

/**
 * Érték-kódoló: a felsorolt (enum) mezők értékeinek oda-vissza fordítása.
 *
 * Miért kell?
 *   Ugyanaz a tartalom sokféle írásmóddal érkezhet: az adatbekérő
 *   legördülője „male"/„female"-t ír, a cellakomment viszont „ffi"/„noeoe"-t
 *   említ, egy kézzel kitöltött táblázatban pedig „Férfi" szerepel. A tároló
 *   egyetlen kanonikus értéket ismer (`male`), a megjelenítés pedig nyelvenként
 *   külön szöveget ad – a kétnyelvű (HU-ENG) sablonok miatt.
 *
 *   nyers bemenet ──decode──> kanonikus id ──render──> „Férfi" / „Male"
 *                                          └─encode──> „male" (exporthoz)
 */
const ValueCodec = (() => {

  function normalize(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')   // ékezetek levétele
      .toLowerCase()
      .replace(/[\s._/-]+/g, ' ')
      .trim();
  }

  function isEnum(field) {
    return !!(field && field.type === 'enum' && Array.isArray(field.values) && field.values.length);
  }

  /** Egy enum-érték összes elfogadott írásmódja (id, hu, en és az accepts lista). */
  function acceptedForms(v) {
    const forms = [v.id, v.hu, v.en].concat(v.accepts || []);
    return forms.filter(Boolean).map(normalize);
  }

  /**
   * Nyers érték → kanonikus id.
   * Nem enum mezőnél az értéket változatlanul adja vissza (csak trimmel).
   * Fel nem ismert enum-értéknél `null`-t ad – a hívó dönti el, mi történjen
   * (a nyilvántartás pl. hibát jelez, az import pedig figyelmeztet).
   */
  function decode(field, raw) {
    if (!isEnum(field)) return raw == null ? '' : String(raw).trim();
    const needle = normalize(raw);
    if (!needle) return '';
    for (const v of field.values) {
      if (acceptedForms(v).includes(needle)) return v.id;
    }
    return null;
  }

  /** Igaz, ha a nyers érték értelmezhető ezen a mezőn. */
  function canDecode(field, raw) {
    if (!isEnum(field)) return true;
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return true;                 // üres érték megengedett
    return decode(field, raw) !== null;
  }

  /**
   * Kanonikus érték → megjelenítendő szöveg a kért nyelven.
   * Ez megy a dokumentumokba: `{{Neme}}` → „Férfi", `{{Neme_EN}}` → „Male".
   */
  function render(field, value, lang = 'hu') {
    if (!isEnum(field)) return value == null ? '' : String(value);
    const v = field.values.find(x => x.id === value);
    if (!v) {
      // Ismeretlen érték: inkább az eredetit adjuk vissza, mint semmit
      return value == null ? '' : String(value);
    }
    return (lang === 'en' ? v.en : v.hu) || v.id;
  }

  /**
   * Kanonikus érték → export-alak.
   *   'id' → 'male'   (az import ezt várja)
   *   'hu' → 'Férfi'
   *   'en' → 'Male'
   */
  function encode(field, value, encoding = 'id') {
    if (!isEnum(field)) return value == null ? '' : String(value);
    if (encoding === 'hu' || encoding === 'en') return render(field, value, encoding);
    const v = field.values.find(x => x.id === value);
    return v ? v.id : (value == null ? '' : String(value));
  }

  /** Az űrlap legördülőjéhez: [{ id, label }] a kért nyelven. */
  function options(field, lang = 'hu') {
    if (!isEnum(field)) return [];
    return field.values.map(v => ({ id: v.id, label: (lang === 'en' ? v.en : v.hu) || v.id }));
  }

  /**
   * Ütköző írásmódok keresése egy mezőn belül: ha ugyanaz a szöveg két
   * különböző értékhez is el van fogadva, a felismerés kiszámíthatatlan lenne.
   * A séma-szerkesztő ezzel figyelmezteti a felhasználót.
   */
  function findAmbiguities(field) {
    if (!isEnum(field)) return [];
    const seen = new Map();
    const clashes = [];
    for (const v of field.values) {
      for (const form of acceptedForms(v)) {
        if (seen.has(form) && seen.get(form) !== v.id) {
          clashes.push({ form, between: [seen.get(form), v.id] });
        } else {
          seen.set(form, v.id);
        }
      }
    }
    return clashes;
  }

  return { normalize, isEnum, decode, canDecode, render, encode, options, findAmbiguities, acceptedForms };
})();
