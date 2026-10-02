// DocGen — az ügyek átvitele a böngészőtárból (próba mód) az adatmappába.
//
// Miért kell: a v10.70 előtt az adatmappa kiválasztása csak a DOLGOZÓKAT
// költöztette át, az ügyek a böngészőtárban maradtak. Ez a szkript az így járt
// telepítéseken hozza át őket (az új verzió már mindent visz, lásd README,
// „Próba mód"). Az akkor átvitt dolgozók új belső azonosítót kaptak, ezért az
// ügy employeeId-ját is át kell írni: a régi dolgozót azonosító, ennek híján
// név + születési dátum alapján párosítjuk a mostanival (ugyanaz a
// matchIncoming, amit az import használ).
//
// Használat — azon a gépen és böngészőben, ahol a próba-módos munka folyt:
//   1. Nyisd meg a DocGen-t, lépj be; az adatmappa legyen beállítva.
//   2. F12 → Console. Másold be az egészet, Enter. (Chrome első beillesztésnél
//      azt kéri, gépeld be: allow pasting.)
//      Ez csak PRÓBA: táblázatban kiírja, mit tenne, és letölti a böngészőtár
//      nyers másolatát (docgen-bongeszotar-mentes.json) — azt tedd el.
//   3. Ha a lista rendben van: írd át lent MEHET = true-ra, és futtasd újra.
//      Az oldal a végén újratölt.
//
// Ismételten futtatható: a már átvitt ügyet (azonos id) kihagyja. Írás előtt az
// app szokásos biztonsági mentése készül (backup/). A böngészőtárból nem töröl.
(async () => {
  const MEHET  = false;
  // A böngészőtár kulcsai a felhasználó nevével kezdődnek; próba módban ez
  // „helyi". Belépés után a FsService.loadHandle már a fiók nevét tenné elé,
  // ezért itt közvetlenül olvasunk.
  const ELOTAG = 'helyi_';

  const idb = await new Promise((res, rej) => {
    const r = indexedDB.open('docgen_fs');
    r.onsuccess = () => res(r.result);
    r.onerror   = () => rej(r.error);
  });
  const olvas = key => new Promise((res, rej) => {
    const q = idb.transaction('handles').objectStore('handles').get(ELOTAG + key);
    q.onsuccess = () => res(q.result || null);
    q.onerror   = () => rej(q.error);
  });

  const tar = await olvas('db_cases');
  const regiDolgozok = ((await olvas('db_employees')) || {}).employees || [];
  if (!tar || !Array.isArray(tar.cases)) {
    console.error(`Nincs ${ELOTAG}db_cases a böngészőtárban — nem ebben a böngészőben/profilban folyt a munka?`);
    return;
  }

  // Nyers másolat, mielőtt bármihez nyúlnánk
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(
    [JSON.stringify({ db_cases: tar, db_employees: { employees: regiDolgozok } }, null, 2)],
    { type: 'application/json' }));
  a.download = 'docgen-bongeszotar-mentes.json';
  a.click();

  const dir = await olvas('data_dir');
  if (!dir || !(await FsService.queryPermissionOnly(dir, true))) {
    console.error('Nincs elérhető adatmappa. Állítsd be (vagy adj engedélyt) a Nyilvántartás fülön, és futtasd újra.');
    return;
  }
  console.log(`Adatmappa: ${dir.name}`);

  const regiById = new Map(regiDolgozok.map(e => [e.id, e]));
  const nev = e => e ? [e.fields.surname, e.fields.forename].filter(Boolean).join(' ') : '?';
  const dolgozoja = c => {
    const r = regiById.get(c.employeeId);
    return EmployeeRepo.get(c.employeeId)
      || (r && EmployeeRepo.matchIncoming({ identifiers: r.identifiers, fields: r.fields }).employee)
      || null;
  };

  await CaseRepo.flush();   // az oldal függő mentése előbb kerüljön ki
  const backend = CaseRepo.createFileBackend(dir);
  const fajl = (await backend.load()) || { version: 1, savedAt: null, cases: [] };
  const vanMar = new Set(fajl.cases.map(c => c.id));

  const sorok = [], atvinni = [];
  for (const c of tar.cases) {
    const emp = dolgozoja(c);
    const sor = {
      dolgozo: nev(emp || regiById.get(c.employeeId)),
      tipus:   CaseTypes.label(c.type),
      nyitva:  c.openedAt,
      statusz: c.status,
    };
    if (vanMar.has(c.id)) {
      sor.mi = 'már az adatmappában';
    } else if (!emp) {
      sor.mi = 'KIMARAD: nincs ilyen dolgozó az adatmappában';
    } else {
      // Ha közben kézzel újra felvitték, kettő lesz — a felület „Ügy törlése" rendezi
      sor.mi = !c.closedAt && CaseRepo.hasOpenCaseOfType(emp.id, c.type)
        ? 'átvisz — FIGYELEM: már van nyitott ilyen ügye' : 'átvisz';
      atvinni.push(Object.assign({}, c, { employeeId: emp.id }));
    }
    sorok.push(sor);
  }
  console.table(sorok);
  console.log(`${tar.cases.length} ügy a böngészőtárban, ebből ${atvinni.length} menne át.`);

  if (!MEHET) { console.log('Ez próba volt. Ha rendben, írd át: MEHET = true, és futtasd újra.'); return; }
  if (!atvinni.length) return;

  fajl.cases.push(...atvinni);
  await backend.save(fajl);
  console.log(`✓ ${atvinni.length} ügy átvíve. Újratöltés…`);
  location.reload();
})();
