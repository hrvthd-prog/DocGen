'use strict';

/**
 * A díjátutalási lap PDF-je.
 *
 * Ez az app első SAJÁT rajzolású dokumentuma: nem sablonból jön, nem megy át a
 * Word-láncon, nincs benne kézi lépés. A `PdfService` adja az alapot (beágyazott
 * betűkészlet az ékezetekhez), itt csak az elrendezés van.
 *
 * Az elrendezés szándékosan a kiváltott `Procedural-Fee-Transfer-Log.xlsm`
 * nyomtatási képét követi: az oszlopszélességek a munkalap arányaiból jönnek, a
 * keretszín a makró `RGB(185, 196, 211)` értéke. Aki eddig ezt a lapot vitte a
 * bankba, ugyanazt kapja – csak nem kell hozzá Excel és makró.
 *
 * A lap NYELVE angol, mint az eredetié: a kedvezményezett és a banki közlemény
 * rovatai így egyeznek azzal, amit az OIF és a bank lát. A felület magyar.
 */
const TransferPdf = (() => {

  // ── Állandók ───────────────────────────────────────────────────────────────
  // ponytail: kódba égetve, mert ez hatósági számlaszám – évek óta ugyanaz, és
  // egy beállítóképernyő csak felület lenne valamihez, amit senki nem állít.
  // Ha egyszer változik: innen egy sor, vagy egy Beállítások-blokk.
  const OIF = {
    beneficiary: 'Országos Idegenrendészeti Főigazgatóság (OIF)',
    iban:        'HU77 10023002-00283511-02000006',
    account:     '10023002-00283511-02000006',
    accountNote: 'OIF accepts transfers to this account number only.',
    refNote:     'Client name + date of birth + EH identifier or file number (közlemény) '
               + '— built automatically in the Payment Reference column.',
  };

  const MARGO       = 25;
  const SORMAGAS    = 18;
  const FEJLEC_MAG  = 20;

  // Színek – a munkafüzet képéből
  const SZIN = {
    fo:      [0.12, 0.22, 0.39],   // sötétkék fejléc
    cimke:   [0.86, 0.90, 0.95],   // világoskék címkeháttér
    keret:   [0.725, 0.769, 0.827], // RGB(185,196,211) – a makró keretszíne
    halvany: [0.45, 0.50, 0.55],
    piros:   [0.70, 0.20, 0.20],
  };

  /**
   * Oszlopok – az arányok a munkalap oszlopszélességeiből.
   * A személyi szám szándékosan NEM szerepel: a nyomtatott lapon az eredetiben
   * is rejtett oszlop volt, a banknak nincs rá szüksége.
   */
  const OSZLOPOK = [
    { kulcs: 'no',        cim: 'No.',                                arany: 5.44,  igazit: 'center' },
    { kulcs: 'name',      cim: 'Employee Name',                      arany: 26 },
    { kulcs: 'dob',       cim: 'Date of Birth',                      arany: 12.44, igazit: 'center' },
    { kulcs: 'national',  cim: 'Nationality',                        arany: 15 },
    { kulcs: 'ident',     cim: 'Application ID / File Number',       arany: 22 },
    { kulcs: 'amount',    cim: 'Amount (HUF)',                       arany: 14,    igazit: 'right' },
    { kulcs: 'reference', cim: 'Payment Reference (transfer note)',  arany: 53 },
    { kulcs: 'handler',   cim: 'Handled By',                         arany: 16 },
  ];

  function rgb(t) { return PDFLib.rgb(t[0], t[1], t[2]); }

  function huf(n) {
    return Number(n || 0).toLocaleString('hu-HU').replace(/ /g, ' ') + ' HUF';
  }

  function most() {
    const d = new Date();
    const p = x => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /** Fájlnév a makró mintájára: Fee-transfers_2026-08-26_1103.pdf */
  function filename() {
    const d = new Date();
    const p = x => String(x).padStart(2, '0');
    return `Fee-transfers_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
         + `_${p(d.getHours())}${p(d.getMinutes())}.pdf`;
  }

  /** Oszlopok kiszámolt x-pozíciója és szélessége a lap szélességéhez igazítva. */
  function oszlopRacs(lapSzel) {
    const hasznos = lapSzel - 2 * MARGO;
    const ossz = OSZLOPOK.reduce((s, o) => s + o.arany, 0);
    let x = MARGO;
    return OSZLOPOK.map(o => {
      const w = hasznos * (o.arany / ossz);
      const be = { ...o, x, w };
      x += w;
      return be;
    });
  }

  // ── Rajzolás ───────────────────────────────────────────────────────────────

  function keret(page, x, y, w, h, kitoltes = null) {
    page.drawRectangle({
      x, y, width: w, height: h,
      color: kitoltes ? rgb(kitoltes) : undefined,
      borderColor: rgb(SZIN.keret),
      borderWidth: 0.7,
    });
  }

  /** A lap tetején álló kedvezményezett-blokk – csak az első oldalon. */
  function fejBlokk(page, betuk, batch, sorokSzama, osszeg, y) {
    const { font, bold } = betuk;
    const W = page.getWidth();
    const hasznos = W - 2 * MARGO;
    const cimkeW  = hasznos * 0.13;
    const ertekW  = hasznos * 0.49;
    const jCimkeW = hasznos * 0.13;
    const jErtekW = hasznos * 0.25;

    PdfService.drawText(page, 'PROCEDURAL FEE TRANSFER LOG',
      { x: MARGO, y: y + 30, size: 15, font: bold, color: rgb(SZIN.fo) });
    PdfService.drawText(page,
      `${OIF.beneficiary} — record and proof of procedural fee payments`,
      { x: MARGO, y: y + 14, size: 8.5, font, color: rgb(SZIN.halvany), maxWidth: hasznos });

    const sorok = [
      ['Beneficiary',    OIF.beneficiary,  'Transfers',   String(sorokSzama)],
      ['IBAN',           OIF.iban,         'Total (HUF)', huf(osszeg)],
      ['Account number', OIF.account,      null,          OIF.accountNote],
      ['Reference',      OIF.refNote,      null,          null],
    ];

    let sy = y;
    sorok.forEach(([cimke, ertek, jCimke, jErtek], i) => {
      sy -= FEJLEC_MAG;
      const sz = sy + 5;

      keret(page, MARGO, sy, cimkeW, FEJLEC_MAG, SZIN.cimke);
      PdfService.drawText(page, cimke, { x: MARGO + 4, y: sz, size: 8, font: bold, color: rgb(SZIN.fo), maxWidth: cimkeW - 8 });

      // A negyedik sor (Reference) a teljes szélességet kapja: hosszú magyarázat.
      const ertekSzel = (i === 3) ? (hasznos - cimkeW) : ertekW;
      keret(page, MARGO + cimkeW, sy, ertekSzel, FEJLEC_MAG);
      PdfService.drawText(page, ertek,
        { x: MARGO + cimkeW + 4, y: sz, size: i === 3 ? 7.5 : 8.5,
          font: (i === 1 || i === 2) ? bold : font,
          color: i === 3 ? rgb(SZIN.halvany) : undefined,
          maxWidth: ertekSzel - 8 });

      if (i === 3) return;

      const jx = MARGO + cimkeW + ertekW;

      // A számlaszám-megjegyzésnek nincs címkéje: a teljes jobb oldalt kapja,
      // balra igazítva. Címkényi helyre szorítva elvágódna („OIF accep…"), és
      // pont az a mondat veszne el, ami a téves utalást megelőzi.
      if (!jCimke) {
        const teljesJobb = jCimkeW + jErtekW;
        keret(page, jx, sy, teljesJobb, FEJLEC_MAG);
        PdfService.drawText(page, jErtek,
          { x: jx + 4, y: sz, size: 7.5, font, color: rgb(SZIN.piros), maxWidth: teljesJobb - 8 });
        return;
      }

      keret(page, jx, sy, jCimkeW, FEJLEC_MAG, SZIN.cimke);
      PdfService.drawText(page, jCimke,
        { x: jx + 4, y: sz, size: 8, font: bold, color: rgb(SZIN.fo), maxWidth: jCimkeW - 8 });
      keret(page, jx + jCimkeW, sy, jErtekW, FEJLEC_MAG);
      PdfService.drawText(page, jErtek,
        { x: jx + jCimkeW + jErtekW - 4, y: sz, size: 9, font: bold, align: 'right', maxWidth: jErtekW - 8 });
    });

    // Köteg-azonosító: az eredeti lapon nem volt, mert ott egy munkafüzet = egy
    // köteg. Itt több köteg él egymás mellett, ezért ki kell írni, melyik ez.
    sy -= 14;
    const allapot = batch.status === TransferRepo.STATUS.KIFIZETVE
      ? `paid on ${batch.paidOn}`
      : 'not yet transferred';
    PdfService.drawText(page, `Batch ${batch.label} · ${allapot}`,
      { x: MARGO, y: sy, size: 8, font, color: rgb(SZIN.halvany) });

    return sy - 8;
  }

  function tablaFejlec(page, betuk, y) {
    const racs = oszlopRacs(page.getWidth());
    for (const o of racs) {
      page.drawRectangle({ x: o.x, y: y - SORMAGAS, width: o.w, height: SORMAGAS, color: rgb(SZIN.fo) });
      PdfService.drawText(page, o.cim, {
        x: o.igazit === 'right' ? o.x + o.w - 4 : (o.igazit === 'center' ? o.x + o.w / 2 : o.x + 4),
        y: y - SORMAGAS + 6, size: 7.5, font: betuk.bold,
        color: PDFLib.rgb(1, 1, 1), align: o.igazit || 'left', maxWidth: o.w - 8,
      });
    }
    return y - SORMAGAS;
  }

  function tablaSor(page, betuk, y, ertekek) {
    const racs = oszlopRacs(page.getWidth());
    for (const o of racs) {
      keret(page, o.x, y - SORMAGAS, o.w, SORMAGAS);
      PdfService.drawText(page, ertekek[o.kulcs], {
        x: o.igazit === 'right' ? o.x + o.w - 4 : (o.igazit === 'center' ? o.x + o.w / 2 : o.x + 4),
        y: y - SORMAGAS + 6, size: 8.5, font: betuk.font,
        align: o.igazit || 'left', maxWidth: o.w - 8,
      });
    }
    return y - SORMAGAS;
  }

  function lablec(page, betuk, darab, osszeg) {
    const W = page.getWidth();
    PdfService.drawText(page, `Generated ${most()}`,
      { x: MARGO, y: 18, size: 7.5, font: betuk.font, color: rgb(SZIN.halvany) });
    PdfService.drawText(page, `Transfers: ${darab}   |   Total: ${huf(osszeg)}`,
      { x: W - MARGO, y: 18, size: 7.5, font: betuk.font, color: rgb(SZIN.halvany), align: 'right' });
  }

  // ── Belépési pont ──────────────────────────────────────────────────────────

  /**
   * A köteg PDF-je bájtokban.
   *
   * Több oldalra tördel, és minden oldalon megismétli a táblázat fejlécsorát –
   * ezt csinálta a makró `PrintTitleRows` beállítása is.
   */
  async function build(batch) {
    if (!batch) throw new Error('Nincs köteg.');
    const sorok = batch.rows || [];
    if (!sorok.length) throw new Error('Üres kötegből nincs mit nyomtatni.');

    const betuk = await PdfService.newDocument();
    const { doc } = betuk;
    const osszeg = sorok.reduce((s, r) => s + (Number(r.amount) || 0), 0);

    let page = PdfService.addPage(doc);
    let y = fejBlokk(page, betuk, batch, sorok.length, osszeg, page.getHeight() - 70);
    y = tablaFejlec(page, betuk, y);

    const also = 34;                 // a lábléc fölötti határ
    sorok.forEach((r, i) => {
      if (y - SORMAGAS < also) {
        lablec(page, betuk, sorok.length, osszeg);
        page = PdfService.addPage(doc);
        y = tablaFejlec(page, betuk, page.getHeight() - MARGO - 10);
      }
      y = tablaSor(page, betuk, y, {
        no:        String(i + 1),
        name:      r.name,
        dob:       r.dob,
        national:  r.nationality,
        ident:     r.identifier,
        amount:    huf(r.amount),
        reference: TransferRepo.reference(r),
        handler:   r.handler,
      });
    });

    lablec(page, betuk, sorok.length, osszeg);
    return await doc.save();
  }

  /**
   * Mentés: a kimeneti mappába, ha van; egyébként letöltésként.
   * Ugyanaz a sorrend, mint a generált dokumentumoknál.
   */
  async function save(batch, outputDir) {
    const bytes = await build(batch);
    const nev = filename();
    if (outputDir) {
      try {
        await FsService.writeToDir(outputDir, nev, bytes);
        return { nev, hova: outputDir.name };
      } catch (e) {
        BevLogger.warn('TRANSFER_PDF', 'A kimeneti mappába írás nem sikerült', e.message, nev);
      }
    }
    saveAs(new Blob([bytes], { type: 'application/pdf' }), nev);
    return { nev, hova: null };
  }

  return { build, save, filename, OIF, OSZLOPOK };
})();
