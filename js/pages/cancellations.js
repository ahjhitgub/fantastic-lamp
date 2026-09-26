window.App = window.App || {};
App.Pages = App.Pages || {};

/** The per-unit cancellation log for the active claim period. */
App.Pages.cancellations = (function () {
  const PAGE_SIZE = 100;
  const fresh = (periodId) => ({ periodId, lot: '', company: '', q: '', problemsOnly: false, page: 0, selected: new Set(), editingId: null, msg: null });
  let st = fresh(null);

  /** Flags shown on each row. Time/make/model/box are deliberately not checked. */
  function flagsFor(u, ctx) {
    const L = App.Logic; const out = [];
    const lot = L.normLot(u.lotNumber);
    const wc = lot ? ctx.wcByLot.get(lot) : null;
    if (!lot) out.push(['no lot #', 'flag']);
    else if (!wc) out.push(['no WC', 'flag']);
    else if (wc.kind !== 'transfer') out.push(['WC not a transfer', 'flag']);
    const r = L.resolveCompany(u.company, ctx.index);
    if (r.match === 'blank') out.push(['no company', 'warn']);
    else if (r.match === 'none') out.push(['unknown company', 'warn']);
    else {
      if (r.match === 'alias') out.push(['misspelling', 'warn']);
      const t = wc && wc.transfer;
      const ok = t ? [t.handlerId, t.collectorId].filter(Boolean) : [];
      if (ok.length && !ok.includes(r.company.id)) out.push(['wrong company for lot', 'flag']);
    }
    if (!(L.num(u.weight) > 0)) out.push(['no weight', 'flag']);
    if (L.dateMonthIndex(u.date) !== ctx.pIdx) out.push(['outside month', 'warn']);
    if (L.unitWasEdited(u)) out.push(['edited', '']);
    return out;
  }

  const dupKey = (u) => [u.date, u.time, u.make, u.model, u.weight, App.Logic.normLot(u.lotNumber)].map((x) => String(x ?? '').toLowerCase().trim()).join('|');

  function withOriginal(u) {
    return u.original ? u : { ...u, original: { lotNumber: u.lotNumber || '', company: u.company || '', boxNumber: u.boxNumber || '' } };
  }

  return {
    /** Used by the Audit page: open this page filtered to one lot. */
    showLot(lot) { st = { ...fresh(App.State.currentPeriodId), lot: lot === '' ? '__blank' : lot }; App.UI.go('#/cancellations'); },

    async render(container) {
      const { h, esc, fmt, options, header } = App.UI;
      const L = App.Logic;
      const periodId = App.State.currentPeriodId;
      container.append(header('Cancellations', 'The per-unit dismantling log for the active claim period. The lot # on each unit is the WC # of the transfer it came from.'));
      if (!periodId) { container.append(App.UI.empty('No claim period selected', '<a href="#/claimPeriods">Create or select one</a> first.')); return; }
      if (st.periodId !== periodId) st = fresh(periodId);

      const data = await App.Store.loadAll();
      const period = data.periods.find((p) => p.id === periodId);
      const units = (await App.DB.getAllByIndex('cancelledUnits', 'claimPeriodId', periodId))
        .sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.id - b.id);
      const ctx = {
        wcByLot: new Map(data.wcs.map((w) => [L.normLot(w.wcNumber), w])),
        index: L.companyIndex(data.companies),
        pIdx: L.monthIndex(period.year, period.month),
      };
      const flags = new Map(units.map((u) => [u.id, flagsFor(u, ctx)]));
      const hereLabel = L.monthLabel(period.year, period.month);

      if (st.msg) { container.append(App.UI.notice(st.msg.text, st.msg.kind)); st.msg = null; }

      // ---- totals
      const totalW = units.reduce((s, u) => s + L.num(u.weight), 0);
      const alloc = L.sumAllocs(data.allocations.filter((a) => a.claimPeriodId === periodId));
      const problemUnits = units.filter((u) => flags.get(u.id).some((f) => f[1])).length;
      container.append(h(`
        <div class="stat-row">
          <div class="stat"><div class="value">${fmt(units.length)}</div><div class="label">Units cancelled</div></div>
          <div class="stat"><div class="value">${fmt(totalW)}</div><div class="label">Lbs cancelled</div></div>
          <div class="stat"><div class="value">${fmt(alloc.units)} / ${fmt(alloc.weight)}</div><div class="label">Units / lbs allocated from WCs</div></div>
          <div class="stat"><div class="value ${problemUnits ? 'flag-text' : ''}">${fmt(problemUnits)}</div><div class="label">Units with flags · <a href="#/audit">full audit →</a></div></div>
        </div>`));

      // ---- import
      const imp = h(`
        <details class="panel" ${units.length ? '' : 'open'}>
          <summary><strong>Import log rows</strong></summary>
          <p class="muted">Copy rows from the log spreadsheet and paste them here. Expected columns: <strong>Date, Time, Make, Model, Weight (lb), Lot #, Company, Box #</strong>. Include the header row if you have it — then column order doesn't matter.</p>
          <div class="field"><textarea data-role="text" rows="6" placeholder="Date&#9;Time&#9;Make&#9;Model&#9;Weight (lb)&#9;Lot #&#9;Company&#9;Box #"></textarea></div>
          <button type="button" class="primary" data-a="import">Import into ${esc(App.Models.formatPeriodLabel(period))}</button>
        </details>`);
      imp.querySelector('[data-a="import"]').addEventListener('click', async () => {
        const { rows, skipped } = L.parseCancellationLog(imp.querySelector('[data-role="text"]').value);
        if (!rows.length) { st.msg = { kind: 'error', text: skipped.length ? `Nothing imported — ${skipped.length} row(s) had unreadable dates.` : 'Nothing to import.' }; App.rerender(); return; }
        const outside = rows.filter((r) => L.dateMonthIndex(r.date) !== ctx.pIdx).length;
        if (outside && !confirm(`${outside} of ${rows.length} rows are dated outside ${hereLabel}. Import them anyway? They'll be flagged.`)) return;
        const existing = new Set(units.map(dupKey));
        const dups = rows.filter((r) => existing.has(dupKey(r))).length;
        if (dups && !confirm(`${dups} of these rows look identical to units already logged in this period (same date, time, make, model, weight and lot). Pasting the same log twice would double-count them. Import anyway?`)) return;
        try {
          await App.DB.bulkAdd('cancelledUnits', rows.map((r) => ({ ...r, claimPeriodId: periodId })));
          const skipText = skipped.length ? ` Skipped ${skipped.length}: ${skipped.slice(0, 5).map((s) => `line ${s.line} (${s.reason})`).join('; ')}${skipped.length > 5 ? '…' : ''}` : '';
          st.msg = { kind: skipped.length ? 'warning' : 'ok', text: `Imported ${rows.length} unit(s).${skipText}` };
        } catch (err) { st.msg = { kind: 'error', text: `Import failed: ${App.UI.errText(err)}` }; }
        App.rerender();
      });
      container.append(imp);

      if (!units.length) { container.append(App.UI.empty('No units logged for this period yet', 'Paste the log above.')); return; }

      // ---- filters
      const lotCounts = new Map(); const compCounts = new Map();
      units.forEach((u) => {
        const k = L.normLot(u.lotNumber); lotCounts.set(k, (lotCounts.get(k) || 0) + 1);
        const c = (u.company || '').trim(); compCounts.set(c, (compCounts.get(c) || 0) + 1);
      });
      const lotOpts = [...lotCounts].sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true })).map(([k, n]) => ({ value: k || '__blank', label: `${k || '(blank)'} — ${n}` }));
      const compOpts = [...compCounts].sort((a, b) => a[0].localeCompare(b[0])).map(([k, n]) => ({ value: k || '__blank', label: `${k || '(blank)'} — ${n}` }));
      const filterEl = h(`
        <div class="panel filters"><div class="field-row">
          <div class="field"><label>Lot #</label><select data-f="lot">${options(lotOpts, st.lot, 'All lots')}</select></div>
          <div class="field"><label>Company (as written)</label><select data-f="company">${options(compOpts, st.company, 'All companies')}</select></div>
          <div class="field"><label>Search make / model</label><input data-f="q" value="${esc(st.q)}"></div>
          <div class="field"><label>&nbsp;</label><label class="row"><input type="checkbox" data-f="problemsOnly" ${st.problemsOnly ? 'checked' : ''}> Flagged units only</label></div>
        </div></div>`);
      filterEl.querySelectorAll('[data-f]').forEach((i) => i.addEventListener(i.type === 'text' ? 'change' : 'input', () => {
        st[i.dataset.f] = i.type === 'checkbox' ? i.checked : i.value;
        st.page = 0;
        App.rerender();
      }));
      container.append(filterEl);

      const q = L.norm(st.q);
      const filtered = units.filter((u) => {
        if (st.lot !== '' && L.normLot(u.lotNumber) !== (st.lot === '__blank' ? '' : st.lot)) return false;
        if (st.company !== '' && (u.company || '').trim() !== (st.company === '__blank' ? '' : st.company)) return false;
        if (q && !L.norm(`${u.make} ${u.model}`).includes(q)) return false;
        if (st.problemsOnly && !flags.get(u.id).some((f) => f[1])) return false;
        return true;
      });

      // ---- bulk edit
      const ids = new Set(units.map((u) => u.id));
      [...st.selected].forEach((id) => { if (!ids.has(id)) st.selected.delete(id); });
      const bulk = h(`
        <div class="panel bulkbar">
          <div class="row spread">
            <strong data-role="count"></strong>
            <span class="row">
              <button type="button" data-a="select-all">Select all ${fmt(filtered.length)} matching</button>
              <button type="button" data-a="clear">Clear selection</button>
            </span>
          </div>
          <div class="field-row">
            <div class="field"><label>Set lot # to</label><input data-f="lot" placeholder="blank = unchanged"></div>
            <div class="field"><label>Set company to</label><input data-f="company" list="company-names" placeholder="blank = unchanged"></div>
            <div class="field"><label>Set box # to</label><input data-f="box" placeholder="blank = unchanged"></div>
            <div class="field"><label>&nbsp;</label><button type="button" class="primary" data-a="apply">Apply to selected</button></div>
            <div class="field"><label>&nbsp;</label><button type="button" class="danger" data-a="delete">Delete selected</button></div>
          </div>
          <datalist id="company-names">${data.companies.map((c) => `<option value="${esc(c.name)}">`).join('')}</datalist>
        </div>`);
      const countEl = bulk.querySelector('[data-role="count"]');
      const updateCount = () => { countEl.textContent = `${fmt(st.selected.size)} selected`; };
      bulk.querySelector('[data-a="select-all"]').addEventListener('click', () => { filtered.forEach((u) => st.selected.add(u.id)); App.rerender(); });
      bulk.querySelector('[data-a="clear"]').addEventListener('click', () => { st.selected.clear(); App.rerender(); });
      bulk.querySelector('[data-a="apply"]').addEventListener('click', async () => {
        const lot = bulk.querySelector('[data-f="lot"]').value.trim();
        const company = bulk.querySelector('[data-f="company"]').value.replace(/\s+/g, ' ').trim();
        const box = bulk.querySelector('[data-f="box"]').value.trim();
        if (!st.selected.size) { st.msg = { kind: 'warning', text: 'Select some units first.' }; App.rerender(); return; }
        if (!lot && !company && !box) { st.msg = { kind: 'warning', text: 'Enter a lot #, company, or box # to change.' }; App.rerender(); return; }
        const byId = new Map(units.map((u) => [u.id, u]));
        const changed = [...st.selected].map((id) => byId.get(id)).filter(Boolean).map((u) => ({
          ...withOriginal(u), ...(lot ? { lotNumber: L.normLot(lot) } : {}), ...(company ? { company } : {}), ...(box ? { boxNumber: box } : {}),
        }));
        await App.DB.bulkPut('cancelledUnits', changed);
        st.msg = { kind: 'ok', text: `Updated ${changed.length} unit(s). The original values are kept for the audit trail.` };
        st.selected.clear();
        App.rerender();
      });
      bulk.querySelector('[data-a="delete"]').addEventListener('click', async () => {
        if (!st.selected.size) return;
        const n = st.selected.size;
        if (!confirm(`Delete ${n} unit(s) from this period's log?`)) return;
        await App.DB.bulkDelete('cancelledUnits', [...st.selected]);
        st.msg = { kind: 'ok', text: `Deleted ${n} unit(s).` };
        st.selected.clear();
        App.rerender();
      });
      updateCount();
      container.append(bulk);

      // ---- table
      const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
      st.page = Math.min(st.page, pages - 1);
      const pageRows = filtered.slice(st.page * PAGE_SIZE, st.page * PAGE_SIZE + PAGE_SIZE);
      const cell = (u, f, type) => `<td><input data-f="${f}" ${type ? `type="${type}"` : ''} value="${esc(u[f])}" ${f === 'company' ? 'list="company-names"' : ''}></td>`;
      const table = h(`
        <div class="panel">
          <div class="row spread">
            <h2>${fmt(filtered.length)} unit(s)${filtered.length !== units.length ? ` of ${fmt(units.length)}` : ''}</h2>
            <div class="row">
              <button type="button" data-a="prev" ${st.page === 0 ? 'disabled' : ''}>← Prev</button>
              <span class="muted">Page ${st.page + 1} of ${pages}</span>
              <button type="button" data-a="next" ${st.page >= pages - 1 ? 'disabled' : ''}>Next →</button>
            </div>
          </div>
          <div class="table-scroll"><table class="units">
            <thead><tr><th><input type="checkbox" data-a="page-all" title="Select this page"></th><th>Date</th><th>Time</th><th>Make</th><th>Model</th><th class="num">Lbs</th><th>Lot #</th><th>Company</th><th>Box #</th><th>Flags</th><th></th></tr></thead>
            <tbody>${pageRows.map((u) => (st.editingId === u.id ? `
              <tr data-id="${u.id}" class="editing">
                <td></td>${cell(u, 'date', 'date')}${cell(u, 'time')}${cell(u, 'make')}${cell(u, 'model')}${cell(u, 'weight', 'number')}${cell(u, 'lotNumber')}${cell(u, 'company')}${cell(u, 'boxNumber')}
                <td></td><td class="row"><button type="button" class="primary" data-a="save">Save</button><button type="button" data-a="cancel">Cancel</button></td>
              </tr>` : `
              <tr data-id="${u.id}">
                <td><input type="checkbox" data-role="sel" ${st.selected.has(u.id) ? 'checked' : ''}></td>
                <td>${esc(u.date)}</td><td>${esc(u.time)}</td><td>${esc(u.make)}</td><td>${esc(u.model)}</td>
                <td class="num">${fmt(u.weight)}</td><td>${esc(u.lotNumber)}</td><td>${esc(u.company)}</td><td>${esc(u.boxNumber)}</td>
                <td>${flags.get(u.id).map(([t, c]) => `<span class="badge ${c}">${t}</span>`).join(' ')}</td>
                <td><button type="button" data-a="edit">Edit</button></td>
              </tr>`)).join('')}</tbody>
          </table></div>
        </div>`);
      table.querySelector('[data-a="prev"]').addEventListener('click', () => { st.page -= 1; App.rerender(); });
      table.querySelector('[data-a="next"]').addEventListener('click', () => { st.page += 1; App.rerender(); });
      const pageBoxes = [...table.querySelectorAll('[data-role="sel"]')];
      const pageAll = table.querySelector('[data-a="page-all"]');
      pageAll.checked = pageBoxes.length > 0 && pageBoxes.every((b) => b.checked);
      pageAll.addEventListener('change', () => {
        pageBoxes.forEach((b) => {
          b.checked = pageAll.checked;
          const id = Number(b.closest('tr').dataset.id);
          if (pageAll.checked) st.selected.add(id); else st.selected.delete(id);
        });
        updateCount();
      });
      pageBoxes.forEach((b) => b.addEventListener('change', () => {
        const id = Number(b.closest('tr').dataset.id);
        if (b.checked) st.selected.add(id); else st.selected.delete(id);
        updateCount();
      }));
      table.querySelectorAll('tbody tr').forEach((tr) => {
        const u = units.find((x) => x.id === Number(tr.dataset.id));
        const on = (sel, fn) => { const b = tr.querySelector(sel); if (b) b.addEventListener('click', fn); };
        on('[data-a="edit"]', () => { st.editingId = u.id; App.rerender(); });
        on('[data-a="cancel"]', () => { st.editingId = null; App.rerender(); });
        on('[data-a="save"]', async () => {
          const val = (f) => tr.querySelector(`[data-f="${f}"]`).value;
          await App.DB.put('cancelledUnits', {
            ...withOriginal(u), date: val('date'), time: val('time').trim(), make: val('make').trim(), model: val('model').trim(),
            weight: L.r2(L.num(val('weight'))), lotNumber: L.normLot(val('lotNumber')), company: val('company').replace(/\s+/g, ' ').trim(), boxNumber: val('boxNumber').trim(),
          });
          st.editingId = null;
          App.rerender();
        });
      });
      container.append(table);

      // ---- start over
      const danger = h(`<details class="panel"><summary>More</summary>
        <p class="muted">Remove every unit logged in ${esc(App.Models.formatPeriodLabel(period))} — for starting an import over.</p>
        <button type="button" class="danger" data-a="wipe">Delete all ${fmt(units.length)} units in this period</button></details>`);
      danger.querySelector('[data-a="wipe"]').addEventListener('click', async () => {
        if (!confirm(`Delete all ${units.length} units logged in this period? This can't be undone.`)) return;
        await App.DB.bulkDelete('cancelledUnits', units.map((u) => u.id));
        st = fresh(periodId);
        App.rerender();
      });
      container.append(danger);
    },
  };
})();
