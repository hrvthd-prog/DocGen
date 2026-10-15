'use strict';

/**
 * Vezetői kapcsolatok — közös párbeszédek. Terv: `TERV-fiokok.md` 10.3.
 *
 * A Beállítások „Vezetők és csapatok" kártyája és a megtekintő Ügyállás füle
 * ugyanazokat használja: a helyettesítés felvételét, a helyettesek listáját és
 * a csapat összeállítását. Az adatréteg az `Auth` (felettes, helyettes) és a
 * `Leaders` (a dolgozók „Közvetlen vezető" mezője).
 */
const LeadersUI = (() => {

  function huNap(iso) { return iso ? String(iso).replace(/-/g, '.') + '.' : ''; }

  /** „2026.07.01. – 2026.07.14." / „2026.07.01.-tól visszavonásig" */
  function idoszak(d) {
    return d.to ? `${huNap(d.from)} – ${huNap(d.to)}` : `${huNap(d.from)}-tól visszavonásig`;
  }

  function allapot(d, nap = Auth.today()) {
    if (Auth.isActiveDeputy(d, nap)) return 'most érvényes';
    return d.from > nap ? 'később kezdődik' : 'lejárt';
  }

  /**
   * Egy vezető helyetteseinek listája, törlőgombbal. A lejártak is látszanak
   * (a napló mellett itt is kiderüljön, ki helyettesített), de halványan.
   */
  function deputyListHtml(acc, { torolheto = true } = {}) {
    const lista = (acc.deputies || []).slice().sort((a, b) => String(b.from).localeCompare(a.from));
    if (!lista.length) return '<span class="muted">—</span>';
    return lista.map(d => {
      const dep = Auth.get(d.deputyId);
      const all = allapot(d);
      return `<div class="ld-dep${all === 'lejárt' ? ' is-past' : ''}">
        <b>${escHtml(dep ? dep.name : '(törölt fiók)')}</b>
        <span class="muted">${escHtml(idoszak(d))} · ${escHtml(all)}</span>
        ${torolheto ? `<button class="btn btn-ghost btn-sm ld-dep-del" type="button"
            data-acc="${escHtml(acc.id)}" data-dep="${escHtml(d.id)}"
            title="Helyettesítés törlése">✕</button>` : ''}
      </div>`;
    }).join('');
  }

  /** A deputyListHtml törlőgombjainak bekötése egy konténeren belül. */
  function bindDeputyDelete(root, onDone) {
    root.querySelectorAll('.ld-dep-del').forEach(b => b.addEventListener('click', async () => {
      try {
        await Auth.removeDeputy(b.dataset.acc, b.dataset.dep);
        toast('✓ Helyettesítés törölve', 'success');
        if (onDone) onDone();
      } catch (e) { toast(e.message, 'error'); }
    }));
  }

  /** Új helyettesítés: ki, mettől, meddig (üres = visszavonásig). */
  function openDeputyDialog(accId, onDone) {
    const acc = Auth.get(accId);
    if (!acc) { toast('A fiók nem található.', 'error'); return; }
    const jeloltek = Auth.accounts().filter(a => Auth.isLeader(a) && a.id !== acc.id)
      .sort((a, b) => a.name.localeCompare(b.name, 'hu'));
    if (!jeloltek.length) {
      toast('Nincs másik vezetői fiók, aki helyettesíthetne.', 'warn');
      return;
    }
    showDialog({
      title: `Helyettesítés — ${acc.name}`,
      body: `
        <p style="font-size:13px;margin-bottom:10px">
          A helyettes ebben az időszakban <b>${escHtml(acc.name)}</b> dolgozóinak
          ügyállását is látja (és azokét, akik ${escHtml(acc.name)} alá tartoznak).
        </p>
        <label class="ef-field" style="max-width:320px">
          <span class="ef-label">Helyettes</span>
          <select class="field-select" id="ld-dep-who">
            ${jeloltek.map(a => `<option value="${escHtml(a.id)}">${escHtml(a.name)}</option>`).join('')}
          </select>
        </label>
        <div style="display:flex;gap:12px;flex-wrap:wrap">
          <label class="ef-field" style="max-width:200px">
            <span class="ef-label">Kezdete</span>
            ${dateFieldHtml({ id: 'ld-dep-from', value: Auth.today() })}
          </label>
          <label class="ef-field" style="max-width:200px">
            <span class="ef-label">Vége (üres = visszavonásig)</span>
            ${dateFieldHtml({ id: 'ld-dep-to' })}
          </label>
        </div>
        <span class="ef-field-error" id="ld-dep-err"></span>`,
      footer: `
        <button class="btn btn-ghost btn-sm" onclick="closeDialog()">Mégse</button>
        <button class="btn btn-primary btn-sm" id="ld-dep-save">Mentés</button>`,
    });
    document.getElementById('ld-dep-save').addEventListener('click', async () => {
      try {
        await Auth.addDeputy(acc.id, {
          deputyId: document.getElementById('ld-dep-who').value,
          from: document.getElementById('ld-dep-from').value.trim() || null,
          to:   document.getElementById('ld-dep-to').value.trim() || null,
        });
        closeDialog();
        toast('✓ Helyettesítés rögzítve', 'success');
        if (onDone) onDone();
      } catch (e) {
        // A fiókfájl írása NTFS-szinten tiltva lehet a megtekintőnek (10.4).
        document.getElementById('ld-dep-err').textContent = e.message;
      }
    });
  }

  function nevOf(emp) {
    try {
      const v = SchemaStore.resolveValues(emp.fields, 'hu');
      return [v.surname, v.forename].filter(Boolean).join(' ') || '(névtelen)';
    } catch { return '(névtelen)'; }
  }

  /**
   * A csapat összeállítása a vezető felől: minden aktív dolgozó egy kereshető,
   * szűrhető táblában, a mostani csapat előre kijelölve. Mentéskor az újonnan
   * jelöltek ide kerülnek, a kivett jelölésűek vezetője törlődik.
   */
  function openTeamPicker(accId, onDone) {
    const acc = Auth.get(accId);
    if (!acc) return;
    const emps = EmployeeRepo.all();
    const f = Auth.fold(acc.name);
    const rows = emps.map(e => ({
      _id: e.id,
      'Név': nevOf(e),
      'Közvetlen vezető': Leaders.leaderOf(e),
      'Szervezeti egység': String((e.fields || {}).hr_department_cost_center || ''),
    }));
    const elotte = new Set(emps.filter(e => Auth.fold(Leaders.leaderOf(e)) === f).map(e => e.id));

    ClientPicker.open({
      rows,
      columns: ['Név', 'Közvetlen vezető', 'Szervezeti egység'],
      visibleColumns: ['Név', 'Közvetlen vezető', 'Szervezeti egység'],
      rowKey: r => r._id,
      selected: [...elotte],
      storageKey: 'docgen-csapat',
      title: `${acc.name} dolgozói`,
      onSave: (_rows, keys) => {
        const most = new Set(keys);
        const uj    = [...most].filter(id => !elotte.has(id));
        const kivett = [...elotte].filter(id => !most.has(id));
        const atvett = uj.filter(id => Leaders.leaderOf(EmployeeRepo.get(id)));
        const mehet = () => {
          const a = Leaders.assign(uj, acc.name);
          const b = Leaders.assign(kivett, '');
          const hibak = a.hibak.concat(b.hibak);
          toast(hibak.length
            ? `Mentve, de ${hibak.length} rekord hibás: ${hibak[0].uzenet}`
            : `✓ ${acc.name}: +${a.valtozott} / −${b.valtozott} dolgozó`,
            hibak.length ? 'warn' : 'success');
          if (onDone) onDone();
        };
        if (!atvett.length) { mehet(); return; }
        // Akinek már van vezetője, azt nem csendben visszük át.
        setTimeout(() => {
          showDialog({
            title: 'Átvétel másik vezetőtől',
            body: `<p style="font-size:13px"><b>${atvett.length} dolgozónak</b> már van másik
                   közvetlen vezetője. Átkerülnek <b>${escHtml(acc.name)}</b> alá?</p>`,
            footer: `<button class="btn btn-ghost btn-sm" onclick="closeDialog()">Mégse</button>
                     <button class="btn btn-primary btn-sm" id="ld-team-ok">Átvétel</button>`,
          });
          document.getElementById('ld-team-ok').addEventListener('click', () => {
            closeDialog();
            mehet();
          });
        }, 0);
      },
    });
  }

  return { deputyListHtml, bindDeputyDelete, openDeputyDialog, openTeamPicker, idoszak };
})();
