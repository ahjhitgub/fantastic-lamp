window.App = window.App || {};
App.Pages = App.Pages || {};

/** The per-unit cancellation log for the active claim period. */
App.Pages.cancellations = (function () {
  const SIZE_KEY = 'calrecycle.cancelPageSize';
  const pageSize = () => { let v = 100; try { v = localStorage.getItem(SIZE_KEY) || '100'; } catch (e) { /* default */ } return v === 'all' ? Infinity : Number(v) || 100; };
  let bulkId = null; // the line whose bulk breakdown is being edited
  const fresh = (periodId) => ({ periodId, lot: '', company: '', q: '', problemsOnly: false, page: 0, selected: new Set(), editingId: null, msg: null, sortKey: null, sortDir: 1 });
  // sortable columns of the log (the whole log is sorted, not just the page showing)
  const SORT_COLS = [['date', 'Date'], ['time', 'Time'], ['device', 'Device'], ['make', 'Make'], ['model', 'Model'], ['weight', 'Lbs', 'num'], ['lotNumber', 'Lot #'], ['company', 'Company'], ['boxNumber', 'Box #']];
  const timeValue = (t) => { const m = /(\d{1,2}):(\d{2})\s*([AP]M)?/i.exec(t || ''); if (!m) return null; let h = +m[1] % 12; if (m[3] && m[3].toUpperCase() === 'PM') h += 12; return h * 60 + +m[2]; };
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
    if (ctx.likelyBulk && ctx.likelyBulk.has(u.id)) out.push(['likely bulk — mark it', 'warn']);
    if (u.bulk) out.push([`bulk: ${L.unitCount(u)} units`, '']);
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
      const lb = L.likelyBulk(units); ctx.likelyBulk = new Set(units.filter((u, i) => lb[i]).map((u) => u.id));
      const flags = new Map(units.map((u) => [u.id, flagsFor(u, ctx)]));
      const hereLabel = L.monthLabel(period.year, period.month);

      if (st.msg) { container.append(App.UI.notice(st.msg.text, st.msg.kind)); st.msg = null; }

      // ---- totals
      const totalW = units.reduce((s, u) => s + L.num(u.weight), 0);
      const totalU = units.reduce((s, u) => s + L.unitCount(u), 0);
      const alloc = L.sumAllocs(data.allocations.filter((a) => a.claimPeriodId === periodId));
      const problemUnits = units.filter((u) => flags.get(u.id).some((f) => f[1])).length;
      container.append(h(`
        <div class="stat-row">
          <div class="stat"><div class="value">${fmt(totalU)}</div><div class="label">Units cancelled${totalU !== units.length ? ` (${fmt(units.length)} log lines)` : ''}</div></div>
          <div class="stat"><div class="value">${fmt(totalW)}</div><div class="label">Lbs cancelled</div></div>
          <div class="stat"><div class="value">${fmt(alloc.units)} / ${fmt(alloc.weight)}</div><div class="label">Units / lbs allocated from WCs</div></div>
          <div class="stat"><div class="value ${problemUnits ? 'flag-text' : ''}">${fmt(problemUnits)}</div><div class="label">Units with flags · <a href="#/audit">full audit →</a></div></div>
        </div>`));

      // ---- import
      const imp = h(`
        <details class="panel" ${units.length ? '' : 'open'}>
          <summary><strong>Import log rows</strong></summary>
          <p class="muted">Copy rows from the log spreadsheet and paste them here. Expected columns: <strong>Date, Time, Make, Model, Weight (lb), Lot #, Company, Box #</strong>. Include the header row if you have it — then column order doesn't matter.</p>
          <div class="row"><label class="row"><strong>Upload the log:</strong> <input type="file" data-role="file" accept=".xlsx,.csv,.txt,text/csv"></label>
            <span class="muted">Excel (.xlsx) or CSV — its rows appear below to check before importing. For CBEP logs: Date, Device, Weight (lb), Lot #, Company.</span></div>
          <div class="field"><textarea data-role="text" rows="6" placeholder="Date&#9;Time&#9;Make&#9;Model&#9;Weight (lb)&#9;Lot #&#9;Company&#9;Box #"></textarea></div>
          <button type="button" class="primary" data-a="import">Import into ${esc(App.Models.formatPeriodLabel(period))}</button>
        </details>`);
      imp.querySelector('[data-role="file"]').addEventListener('change', async (e) => {
        const f = e.target.files[0]; if (!f) return;
        try {
          const text = await App.LogRead.readLogTable(f);
          imp.querySelector('[data-role="text"]').value = text;
          imp.querySelector('[data-role="text"]').rows = 12;
        } catch (err) { st.msg = { kind: 'error', text: `Couldn't read ${f.name}: ${App.UI.errText(err)}` }; App.rerender(); }
      });
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
      // ---- CBEP: daily summaries (from the log, plus days typed in by hand)
      if (period.cewType === 'CBEP') {
        const manual = await App.Store.cbepDaily(periodId);
        const ds = L.dailySummary(units, manual);
        const diff = L.r2(ds.total.weight - alloc.weight);
        const daily = h(`<div class="panel"><div class="row spread"><h2>CBEP daily cancellation summary</h2><button type="button" data-a="print-daily">Print</button></div>
          <p class="hint mt-0">For CBEP claims a daily summary is enough: the date and pounds cancelled each day. It's added up from the log below, plus any days you type in here.</p>
          ${ds.days.length ? `<div class="table-scroll"><table class="compact" data-role="daily"><thead><tr><th>Date</th><th class="num">Units</th><th class="num">Lbs cancelled</th><th></th></tr></thead>
            <tbody>${ds.days.map((d) => `<tr><td>${esc(L.shortDate(d.date))}</td><td class="num">${fmt(d.units)}</td><td class="num">${fmt(d.weight)}</td><td>${d.manual ? '<span class="badge">typed in</span>' : ''}</td></tr>`).join('')}</tbody>
            <tfoot><tr><th>Total</th><th class="num">${fmt(ds.total.units)}</th><th class="num">${fmt(ds.total.weight)}</th><th></th></tr></tfoot></table></div>` : '<p class="muted">No days yet.</p>'}
          ${ds.days.length ? App.UI.notice(Math.abs(diff) < 0.01 ? `Total cancelled matches the pounds claimed (${fmt(alloc.weight)} lbs).` : `Total cancelled is ${fmt(ds.total.weight)} lbs but the claim is ${fmt(alloc.weight)} lbs (${diff > 0 ? '+' : ''}${fmt(diff)}) — they must match.`, Math.abs(diff) < 0.01 ? 'ok' : 'warning').outerHTML : ''}
          <h3>Type in a day</h3>
          <div class="field-row"><div class="field"><label>Date</label><input type="date" data-d="date"></div><div class="field"><label>Lbs cancelled</label><input data-d="weight" inputmode="decimal"></div>
            <div class="field"><label>Units <span class="muted">(optional)</span></label><input data-d="units" inputmode="numeric"></div><div class="field"><label>&nbsp;</label><button type="button" data-a="add-day">Add day</button></div></div>
          ${manual.length ? `<p class="muted">Typed in: ${manual.map((m, i) => `${esc(L.shortDate(m.date))} ${fmt(m.weight)} lbs <button type="button" class="ghost small" data-del-day="${i}" title="Remove">✕</button>`).join(' · ')}</p>` : ''}
        </div>`);
        daily.querySelector('[data-a="add-day"]').addEventListener('click', async () => {
          const v = (k) => daily.querySelector(`[data-d="${k}"]`).value.trim();
          if (!v('date') || !(L.num(v('weight')) > 0)) { st.msg = { kind: 'error', text: 'A day needs a date and its pounds.' }; App.rerender(); return; }
          await App.Store.saveCbepDaily(periodId, manual.concat([{ date: v('date'), weight: L.r2(L.num(v('weight'))), units: L.num(v('units')) }]));
          App.rerender();
        });
        daily.querySelectorAll('[data-del-day]').forEach((b) => b.addEventListener('click', async () => { manual.splice(Number(b.dataset.delDay), 1); await App.Store.saveCbepDaily(periodId, manual); App.rerender(); }));
        daily.querySelector('[data-a="print-daily"]').addEventListener('click', () => {
          const sheet = h(`<div class="doc-sheet print-area" style="position:fixed;inset:0;overflow:auto;z-index:50">
            <h3>${esc(data.profile.recyclerName || '')} — CBEP daily cancellation summary, ${esc(hereLabel)}</h3>
            <table class="doc-table"><thead><tr><th>Date</th><th class="num">Units</th><th class="num">Lbs cancelled</th></tr></thead>
            <tbody>${ds.days.map((d) => `<tr><td>${esc(L.shortDate(d.date))}</td><td class="num">${fmt(d.units)}</td><td class="num">${fmt(d.weight)}</td></tr>`).join('')}</tbody>
            <tfoot><tr><th>Total</th><th class="num">${fmt(ds.total.units)}</th><th class="num">${fmt(ds.total.weight)}</th></tr></tfoot></table></div>`);
          document.getElementById('main-content').append(sheet);
          const done = () => { sheet.remove(); window.removeEventListener('afterprint', done); };
          window.addEventListener('afterprint', done); window.print(); setTimeout(done, 60000);
        });
        container.append(daily);
      }

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
          <div class="field"><label>Search device / make / model</label><input data-f="q" value="${esc(st.q)}"></div>
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
        if (q && !L.norm(`${u.device || ''} ${u.make} ${u.model}`).includes(q)) return false;
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
      const PAGE_SIZE = pageSize();
      const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
      st.page = Math.min(st.page, pages - 1);
      if (st.sortKey) {
        const k = st.sortKey;
        const val = (u) => (k === 'weight' ? L.num(u.weight) : k === 'time' ? timeValue(u.time) : k === 'date' ? String(u.date || '') : String(u[k] ?? '').toLowerCase());
        filtered.sort((a, b) => {
          const x = val(a); const y = val(b);
          if ((x === null || x === '') && (y === null || y === '')) return 0; if (x === null || x === '') return 1; if (y === null || y === '') return -1;
          return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'en', { numeric: true })) * st.sortDir;
        });
      }
      const pageRows = PAGE_SIZE === Infinity ? filtered : filtered.slice(st.page * PAGE_SIZE, st.page * PAGE_SIZE + PAGE_SIZE);
      const cell = (u, f, type) => `<td><input data-f="${f}" ${type ? `type="${type}"` : ''} value="${esc(u[f])}" ${f === 'company' ? 'list="company-names"' : ''}></td>`;
      const table = h(`
        <div class="panel">
          <div class="row spread">
            <h2>${fmt(filtered.length)} unit(s)${filtered.length !== units.length ? ` of ${fmt(units.length)}` : ''}</h2>
            <div class="row">
              <button type="button" data-a="prev" ${st.page === 0 ? 'disabled' : ''}>← Prev</button>
              <span class="muted">Page ${st.page + 1} of ${pages}</span>
              <label class="row muted">Show <select data-a="size">${['25', '50', '100', 'all'].map((v) => `<option value="${v}" ${(PAGE_SIZE === Infinity ? 'all' : String(PAGE_SIZE)) === v ? 'selected' : ''}>${v === 'all' ? 'All' : v}</option>`).join('')}</select></label>
              <button type="button" data-a="next" ${st.page >= pages - 1 ? 'disabled' : ''}>Next →</button>
            </div>
          </div>
          <div class="table-scroll"><table class="units">
            <thead><tr><th><input type="checkbox" data-a="page-all" title="Select this page"></th>${SORT_COLS.map(([k, label, cls]) => `<th class="sortable${cls ? ` ${cls}` : ''}${st.sortKey === k ? (st.sortDir === 1 ? ' sorted-asc' : ' sorted-desc') : ''}" data-sort="${k}" tabindex="0" title="Sort" aria-sort="${st.sortKey === k ? (st.sortDir === 1 ? 'ascending' : 'descending') : 'none'}">${label}</th>`).join('')}<th>Flags</th><th></th></tr></thead>
            <tbody>${pageRows.map((u) => (st.editingId === u.id ? `
              <tr data-id="${u.id}" class="editing">
                <td></td>${cell(u, 'date', 'date')}${cell(u, 'time')}${cell(u, 'device')}${cell(u, 'make')}${cell(u, 'model')}${cell(u, 'weight', 'text')}${cell(u, 'lotNumber')}${cell(u, 'company')}${cell(u, 'boxNumber')}
                <td></td><td class="row"><button type="button" class="primary" data-a="save">Save</button><button type="button" data-a="cancel">Cancel</button></td>
              </tr>` : `
              <tr data-id="${u.id}">
                <td><input type="checkbox" data-role="sel" ${st.selected.has(u.id) ? 'checked' : ''}></td>
                <td>${esc(u.date)}</td><td>${esc(u.time)}</td><td>${esc(u.device || '')}</td><td>${esc(u.make)}</td><td>${esc(u.model)}</td>
                <td class="num">${fmt(u.weight)}</td><td>${esc(u.lotNumber)}</td><td>${esc(u.company)}</td><td>${esc(u.boxNumber)}</td>
                <td>${flags.get(u.id).map(([t, c]) => `<span class="badge ${c}">${t}</span>`).join(' ')}</td>
                <td class="nowrap"><button type="button" data-a="edit">Edit</button> <button type="button" class="${u.bulk ? 'primary' : ''}" data-a="bulk" title="A weighed stack logged as one line">Bulk${u.bulk ? ` · ${L.unitCount(u)}` : ''}</button></td>
              </tr>`)).join('')}</tbody>
          </table></div>
        </div>`);
      table.querySelectorAll('th[data-sort]').forEach((th) => {
        const go = () => { const k = th.dataset.sort; if (st.sortKey === k) st.sortDir = -st.sortDir; else { st.sortKey = k; st.sortDir = 1; } st.page = 0; App.rerender(); };
        th.addEventListener('click', go);
        th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      });
      table.querySelector('[data-a="size"]').addEventListener('change', (e) => { try { localStorage.setItem(SIZE_KEY, e.target.value); } catch (err) { /* ignore */ } st.page = 0; App.rerender(); });
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
        on('[data-a="bulk"]', () => { bulkId = bulkId === u.id ? null : u.id; App.rerender(); });
        on('[data-a="cancel"]', () => { st.editingId = null; App.rerender(); });
        on('[data-a="save"]', async () => {
          const val = (f) => tr.querySelector(`[data-f="${f}"]`).value;
          await App.DB.put('cancelledUnits', {
            ...withOriginal(u), date: val('date'), time: val('time').trim(), make: val('make').trim(), model: val('model').trim(),
            device: val('device').trim(), weight: L.r2(L.num(val('weight'))), lotNumber: L.normLot(val('lotNumber')), company: val('company').replace(/\s+/g, ' ').trim(), boxNumber: val('boxNumber').trim(),
          });
          st.editingId = null;
          App.rerender();
        });
      });
      // ---- bulk breakdown for one line
      const bu = bulkId ? units.find((u) => u.id === bulkId) : null;
      if (bu) {
        const items = ((bu.bulkItems && bu.bulkItems.length) ? bu.bulkItems : [{ device: bu.device || '', units: '' }]).map((x) => ({ ...x }));
        const devices = [...new Set(units.map((u) => u.device).filter(Boolean).concat(['Computer Tower', 'Printer']))];
        const box = h(`<div class="panel bulk-box"><h2>Bulk entry — ${esc(L.shortDate(bu.date))} · lot ${esc(bu.lotNumber)} · ${fmt(bu.weight)} lbs</h2>
          <p class="hint mt-0">A stack weighed and logged as one line. Say what's in it — it counts as that many units in the totals, the audit and the daily summary; its weight counts once.</p>
          <label class="row"><input type="checkbox" data-b="bulk" ${bu.bulk || !bu.bulkItems ? 'checked' : ''}> This line is a bulk entry</label>
          <table class="lines"><thead><tr><th>Device type</th><th class="num">Units</th><th></th></tr></thead><tbody data-role="items"></tbody></table>
          <datalist id="bulk-devices">${devices.map((d) => `<option value="${esc(d)}">`).join('')}</datalist>
          <button type="button" data-a="add-item">+ Add a device type</button>
          <div class="field-row"><div class="field"><label>Weight (lbs) <span class="muted">— as logged; change it only if it's wrong</span></label><input data-b="weight" inputmode="decimal" value="${esc(bu.weight)}"></div></div>
          <div class="row"><button type="button" class="primary" data-a="save-bulk">Save</button><button type="button" data-a="close-bulk">Close</button><span class="muted" data-role="sum"></span></div></div>`);
        const tb = box.querySelector('[data-role="items"]');
        const sum = () => { box.querySelector('[data-role="sum"]').textContent = `= ${fmt(items.reduce((a, x) => a + L.num(x.units), 0))} units`; };
        const draw = () => {
          tb.replaceChildren(...items.map((x, i) => {
            const tr = h(`<tr><td><input list="bulk-devices" value="${esc(x.device || '')}" data-i="d"></td><td><input inputmode="numeric" style="width:80px" value="${esc(x.units ?? '')}" data-i="u"></td>
              <td><button type="button" class="ghost" title="Remove">✕</button></td></tr>`);
            tr.querySelector('[data-i="d"]').addEventListener('input', (e) => { x.device = e.target.value; });
            tr.querySelector('[data-i="u"]').addEventListener('input', (e) => { x.units = e.target.value; sum(); });
            tr.querySelector('button').addEventListener('click', () => { items.splice(i, 1); draw(); sum(); });
            return tr;
          }));
        };
        draw(); sum();
        box.querySelector('[data-a="add-item"]').addEventListener('click', () => { items.push({ device: '', units: '' }); draw(); });
        box.querySelector('[data-a="close-bulk"]').addEventListener('click', () => { bulkId = null; App.rerender(); });
        box.querySelector('[data-a="save-bulk"]').addEventListener('click', async () => {
          const isBulk = box.querySelector('[data-b="bulk"]').checked;
          const list = items.map((x) => ({ device: String(x.device || '').trim(), units: L.num(x.units) })).filter((x) => x.device || x.units);
          if (isBulk && !list.some((x) => x.units > 0)) { st.msg = { kind: 'error', text: 'Say how many units are in the stack.' }; App.rerender(); return; }
          await App.DB.put('cancelledUnits', { ...bu, bulk: isBulk, bulkItems: isBulk ? list : [], weight: L.r2(L.num(box.querySelector('[data-b="weight"]').value)) });
          bulkId = null; st.msg = { kind: 'ok', text: isBulk ? `Saved: this line counts as ${list.reduce((a, x) => a + x.units, 0)} units.` : 'Saved: this line counts as one unit.' };
          App.rerender();
        });
        container.append(box);
      }
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
