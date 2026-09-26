window.App = window.App || {};
App.Pages = App.Pages || {};

/** Editor for one weight certificate, whatever its type. Route: #/wc/<id> */
App.Pages.wc = (function () {
  let draft = null;        // unsaved copy of the WC being edited
  let draftId = null;
  let dirty = false;
  let flash = null;        // one-time message shown after a re-render
  let editingAllocId = null;
  let dateHooks = [];       // things to refresh live when the WC date changes (reset every render)
  const LINKED_STEPS = ['wcAssigned', 'materialReceived']; // always the WC date

  const U = () => App.UI;
  const L = () => App.Logic;
  const setFlash = (text, kind) => { flash = { text, kind }; };

  // ---------------------------------------------------------------- save bar
  function buildSaveBar(saved, data) {
    const { h } = U();
    const el = h(`
      <div class="savebar">
        <button type="button" class="primary" data-a="save">Save changes</button>
        <button type="button" data-a="discard">Discard changes</button>
        <span data-role="dirty" class="${dirty ? 'flag-text' : 'muted'}">${dirty ? 'Unsaved changes' : 'All changes saved'}</span>
        <span data-role="err" class="flag-text"></span>
        <span class="spacer"></span>
        <button type="button" class="danger" data-a="delete">Delete WC</button>
      </div>`);
    const dirtyEl = el.querySelector('[data-role="dirty"]');
    const errEl = el.querySelector('[data-role="err"]');
    const markDirty = () => { dirty = true; dirtyEl.textContent = 'Unsaved changes'; dirtyEl.className = 'flag-text'; };

    el.querySelector('[data-a="save"]').addEventListener('click', async () => {
      errEl.textContent = '';
      try {
        const number = String(draft.wcNumber || '').trim();
        if (!number) throw new Error('WC # is required.');
        if (await App.Store.wcNumberTaken(number, saved.id)) throw new Error(`WC #${number} already exists.`);
        draft.wcNumber = number;
        if (draft.kind === 'transfer') {
          draft.companyId = draft.transfer.handlerId || draft.transfer.collectorId || null;
          draft.transfer.timeline = draft.transfer.timeline || {};
          LINKED_STEPS.forEach((k) => { draft.transfer.timeline[k] = draft.date || ''; });
        }
        const oldLot = L().normLot(saved.wcNumber); const newLot = L().normLot(number);
        await App.DB.put('wcs', draft);
        if (draft.kind === 'transfer' && oldLot !== newLot) {
          const units = await App.DB.getAllByIndex('cancelledUnits', 'lotNumber', oldLot);
          if (units.length && confirm(`${units.length} cancelled unit(s) carry lot #${oldLot}. Change them to lot #${newLot} too?`)) {
            units.forEach((u) => { u.lotNumber = newLot; });
            await App.DB.bulkPut('cancelledUnits', units);
          }
        }
        dirty = false;
        setFlash('Saved.', 'ok');
        await App.rerender();
      } catch (err) { errEl.textContent = U().errText(err); }
    });
    el.querySelector('[data-a="discard"]').addEventListener('click', () => { draftId = null; App.rerender(); });
    el.querySelector('[data-a="delete"]').addEventListener('click', async () => {
      const units = await App.DB.getAllByIndex('cancelledUnits', 'lotNumber', L().normLot(saved.wcNumber));
      const allocs = data.allocations.filter((a) => a.wcId === saved.id);
      const extra = [allocs.length ? `${allocs.length} claim-period allocation(s) and its attachments will be removed.` : 'Its attachments will be removed.',
        units.length ? `${units.length} cancelled unit(s) with lot #${saved.wcNumber} will stay, but will show as "no matching WC" in the audit.` : ''].join(' ');
      if (!confirm(`Delete WC #${saved.wcNumber}? ${extra}`)) return;
      await App.Store.deleteWC(saved.id);
      draftId = null;
      U().go('#/wcs');
    });
    return { el, markDirty };
  }

  // ---------------------------------------------------------------- common fields
  function buildCommon(saved, data, bar) {
    const { h, esc, options } = U();
    const isTransfer = draft.kind === 'transfer';
    const companyLabel = draft.kind === 'shipment' ? 'Going to' : 'Company';
    const el = h(`
      <div class="panel">
        <h2>Details</h2>
        <div class="field-row">
          <div class="field"><label>WC #</label><input data-f="wcNumber" value="${esc(draft.wcNumber)}"></div>
          <div class="field"><label>${isTransfer ? 'WC date <span class="muted">(assigned = received)</span>' : draft.kind === 'shipment' ? 'Date shipped' : 'Date'}</label><input type="date" data-f="date" value="${esc(draft.date)}"></div>
          <div class="field"><label>Status</label>
            <select data-f="statusId">${options(data.wcStatuses.map((s) => ({ value: s.id, label: s.name })), draft.statusId, '(no status)')}</select>
            ${data.wcStatuses.length ? '' : '<div class="hint">Add statuses in <a href="#/settings">Settings</a>.</div>'}
          </div>
          ${isTransfer ? '' : `<div class="field"><label>${companyLabel}</label>
            <select data-f="companyId">${App.Store.partyOptions(draft.kind, data.companies, draft.companyId)}</select></div>`}
          ${draft.kind === 'inventory' ? `<div class="field"><label>End-of-month inventory for</label>
            <input type="month" data-f="forMonth" value="${esc(draft.inventory.forMonth)}"></div>` : ''}
        </div>
        <div class="field"><label>Notes</label><textarea data-f="notes" rows="2">${esc(draft.notes)}</textarea></div>
      </div>`);
    el.querySelectorAll('[data-f]').forEach((input) => {
      input.addEventListener('input', () => {
        const f = input.dataset.f; const v = input.value;
        if (f === 'statusId' || f === 'companyId') draft[f] = v ? Number(v) : null;
        else if (f === 'forMonth') draft.inventory.forMonth = v;
        else draft[f] = v;
        if (f === 'date') dateHooks.forEach((fn) => fn());
        bar.markDirty();
      });
    });
    return el;
  }

  // ---------------------------------------------------------------- transfer: customer and parties
  function buildParties(data, bar) {
    const { h, esc, options } = U();
    const t = draft.transfer;
    const P = App.Store.transferParties(draft, data);
    const pick = (role, current) => {
      const list = data.companies.filter((c) => (c.roles || []).includes(role) || c.id === current);
      return options(list.map((c) => ({ value: c.id, label: c.name + (c.cewId ? ` — ${c.cewId}` : '') })), current, '— none —');
    };
    const us = `${esc(P.facility.name)}${P.facility.cewId ? ` — ${esc(P.facility.cewId)}` : ''}`;
    const c = P.customer;
    const modeName = (k) => (L().MATERIAL_MODES.find(([x]) => x === k) || [null, ''])[1];
    const td = c && c.truckingDeduction;
    const info = c ? [
      c.owner && `Owner: ${esc(c.owner)}`, c.admin && `Admin: ${esc(c.admin)}`, c.primaryLanguage && `Language: ${esc(c.primaryLanguage)}`,
      c.sourceLogSystem && `Source logs: ${esc(c.sourceLogSystem)}`, c.materialMode && `Usually: ${esc(modeName(c.materialMode))}`,
      td && td.amount !== '' && td.amount != null && `Trucking deduction: ${esc(td.basis === 'percent' ? `${td.amount}%` : td.basis === 'flat' ? `$${td.amount} flat` : `$${td.amount}/lb`)}`,
      c.cbepEnrolled && 'CBEP enrolled',
    ].filter(Boolean) : [];
    const el = h(`
      <div class="panel">
        <h2>Customer</h2>
        <div class="field-row">
          <div class="field"><label>Handler <span class="muted">(optional)</span></label><select data-f="handlerId">${pick('handler', t.handlerId)}</select></div>
          <div class="field"><label>Approved collector (CEWID)</label>${P.collectorIsFacility
            ? `<div class="readonly">${us}</div><div class="hint">We're the collector whenever a handler is selected.</div>`
            : `<select data-f="collectorId">${pick('collector', t.collectorId)}</select>`}</div>
          <div class="field"><label>Recycler</label><div class="readonly">${us}</div></div>
          <div class="field"><label>Material was</label><select data-f="mode">${options([{ value: 'dropoff', label: 'Dropped off' }, { value: 'pickup', label: 'Picked up' }], t.mode, '— choose —')}</select></div>
        </div>
        ${c ? `<p class="hint"><strong>${esc(c.name)}</strong>${info.length ? ` — ${info.join(' · ')}` : ''} · <a href="#/companies" data-a="edit-customer">edit customer</a></p>` : ''}
        <p class="hint">Only companies with the matching role are listed — <a href="#/companies">manage companies</a>.</p>
        <div class="field"><label>Extra collector-activity notes for the 197 <span class="muted">(the handler and the CRT/plasma line are added automatically)</span></label>
          <textarea data-f="activityNotes" rows="2">${esc(t.activityNotes)}</textarea></div>
      </div>`);
    el.querySelectorAll('select[data-f]').forEach((sel) => sel.addEventListener('change', () => {
      const f = sel.dataset.f;
      if (f === 'mode') t.mode = sel.value;
      else {
        t[f] = sel.value ? Number(sel.value) : null;
        if (f === 'handlerId' && t.handlerId) t.collectorId = null;
        const cust = App.Store.transferParties(draft, data).customer;
        if (!t.mode && cust && (cust.materialMode === 'pickup' || cust.materialMode === 'dropoff')) t.mode = cust.materialMode;
      }
      dirty = true;
      App.rerender();
    }));
    el.querySelector('[data-f="activityNotes"]').addEventListener('input', (e) => { t.activityNotes = e.target.value; bar.markDirty(); });
    const editLink = el.querySelector('[data-a="edit-customer"]');
    if (editLink) editLink.addEventListener('click', (e) => { e.preventDefault(); App.Pages.companies.edit(c.id); });
    return el;
  }

  // ---------------------------------------------------------------- transfer: IRR → WC lines
  function buildLines(bar, onChange) {
    const { h, esc, fmt } = U();
    const t = draft.transfer;
    const catOptions = (sel) => L().CATEGORIES.map((c) => `<option value="${c.key}" ${c.key === sel ? 'selected' : ''}>${esc(c.label)}</option>`).join('');
    const rows = t.lines.map((line, i) => {
      const cew = L().category(line.category).cew;
      return `
        <tr data-i="${i}">
          <td><select data-f="category">${catOptions(line.category)}</select>
              <input data-f="description" class="desc" placeholder="${cew ? 'description (optional)' : 'description — printed on the IRR, WC and invoice'}" value="${esc(line.description)}"></td>
          <td><input data-f="irrUnits" type="number" step="1" min="0" value="${esc(line.irrUnits)}"></td>
          <td><input data-f="irrWeight" type="number" step="0.01" min="0" value="${esc(line.irrWeight)}"></td>
          <td><input data-f="cewUnits" type="number" step="1" min="0" value="${cew ? esc(line.cewUnits) : ''}" ${cew ? '' : 'disabled placeholder="n/a"'}></td>
          <td><input data-f="nonCewWeight" type="number" step="0.01" min="0" value="${cew ? esc(line.nonCewWeight) : ''}" ${cew ? '' : 'disabled placeholder="n/a"'}></td>
          <td class="num" data-d="cewWeight"></td>
          <td class="num" data-d="nonCewUnits"></td>
          <td><button type="button" class="ghost" data-a="remove" title="Remove line">✕</button></td>
        </tr>`;
    }).join('');
    const el = h(`
      <div class="panel">
        <h2>Inbound receiving report → WC</h2>
        <p class="muted mt-0">Enter everything received from the IRR. For CEW items, the source-log count is the CEW units; type the weight of the non-CEW units and the CEW weight is the rest.</p>
        <div class="table-scroll"><table class="lines">
          <thead><tr><th>Item</th><th class="num">IRR units</th><th class="num">IRR lbs</th><th class="num">Source logs<br>(CEW units)</th><th class="num">Non-CEW lbs</th><th class="num">CEW lbs</th><th class="num">Non-CEW units</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><th>Totals</th><th class="num" data-t="irrUnits"></th><th class="num" data-t="irrWeight"></th><th class="num" data-t="cewUnits"></th><th class="num" data-t="nonCewWeight"></th><th class="num" data-t="cewWeight"></th><th class="num" data-t="nonCewUnits"></th><th></th></tr></tfoot>
        </table></div>
        <button type="button" data-a="add">+ Add line</button>
        <div data-role="problems"></div>
        <h3>On the WC</h3>
        <div data-role="preview"></div>
      </div>`);

    const problemsEl = el.querySelector('[data-role="problems"]');
    const previewEl = el.querySelector('[data-role="preview"]');
    function refresh() {
      const math = L().transferMath(t);
      el.querySelectorAll('table.lines > tbody > tr').forEach((tr) => {
        const lm = math.lines[Number(tr.dataset.i)];
        const cew = lm.cat.cew;
        tr.querySelector('[data-d="cewWeight"]').textContent = cew ? fmt(lm.cewWeight) : '—';
        tr.querySelector('[data-d="nonCewUnits"]').textContent = fmt(lm.nonCewUnits);
      });
      const tot = math.lines.reduce((a, l) => ({ irrUnits: a.irrUnits + l.irrUnits, irrWeight: a.irrWeight + l.irrWeight, cewUnits: a.cewUnits + l.cewUnits,
        nonCewWeight: a.nonCewWeight + l.nonCewWeight, cewWeight: a.cewWeight + l.cewWeight, nonCewUnits: a.nonCewUnits + l.nonCewUnits }),
      { irrUnits: 0, irrWeight: 0, cewUnits: 0, nonCewWeight: 0, cewWeight: 0, nonCewUnits: 0 });
      Object.keys(tot).forEach((k) => { el.querySelector(`[data-t="${k}"]`).textContent = fmt(tot[k]); });
      const noDesc = t.lines.map((l, i) => (!L().category(l.category).cew && (L().num(l.irrUnits) || L().num(l.irrWeight)) && !String(l.description || '').trim() ? i + 1 : null)).filter(Boolean);
      problemsEl.replaceChildren(...math.problems.concat(noDesc.map((n) => `Line ${n}: give this Other (non-CEW) item a description — it's printed on the IRR, WC and purchase invoice`)).map((p) => U().notice(p, 'warning')));
      const wcRows = [];
      math.lines.forEach((l, i) => {
        const desc = t.lines[i].description ? ` (${t.lines[i].description})` : '';
        if (l.cat.cew) {
          if (l.cewUnits || l.cewWeight) wcRows.push([`CEW ${l.cat.label}${desc}`, l.cewUnits, l.cewWeight]);
          if (l.nonCewUnits || l.nonCewWeight) wcRows.push([`Non-CEW ${l.cat.label}${desc}`, l.nonCewUnits, l.nonCewWeight]);
        } else if (l.irrUnits || l.irrWeight) {
          wcRows.push([t.lines[i].description || 'Other (non-CEW)', l.irrUnits, l.irrWeight]);
        }
      });
      previewEl.replaceChildren(wcRows.length
        ? U().h(`<table><thead><tr><th>Description</th><th class="num">Units</th><th class="num">Lbs</th></tr></thead><tbody>${
          wcRows.map((r) => `<tr><td>${esc(r[0])}</td><td class="num">${fmt(r[1])}</td><td class="num">${fmt(r[2])}</td></tr>`).join('')}</tbody></table>`)
        : U().h('<p class="muted">Nothing entered yet.</p>'));
      if (math.hasCrtOrPlasma) previewEl.append(U().notice(`CEW CRT/plasma is left off the 197, which gets this note automatically: "${L().CRT_PLASMA_NOTE}"`, 'warning'));
      if (onChange) onChange();
    }

    el.querySelectorAll('table.lines > tbody > tr').forEach((tr) => {
      const line = t.lines[Number(tr.dataset.i)];
      tr.querySelectorAll('[data-f]').forEach((input) => {
        const f = input.dataset.f;
        input.addEventListener(f === 'category' ? 'change' : 'input', () => {
          line[f] = input.value;
          bar.markDirty();
          if (f === 'category') App.rerender(); else refresh();
        });
      });
      tr.querySelector('[data-a="remove"]').addEventListener('click', () => {
        t.lines.splice(Number(tr.dataset.i), 1);
        dirty = true;
        App.rerender();
      });
    });
    el.querySelector('[data-a="add"]').addEventListener('click', () => {
      t.lines.push(App.Store.blankTransferLine());
      dirty = true;
      App.rerender();
    });
    refresh();
    return el;
  }

  // ---------------------------------------------------------------- transfer: timeline
  function buildTimeline(bar) {
    const { h, esc } = U();
    const tl = draft.transfer.timeline = draft.transfer.timeline || {};
    const steps = App.Models.TRANSFER_TIMELINE;
    const el = h(`
      <div class="panel">
        <h2>Timeline <span class="muted" data-role="progress"></span></h2>
        <div class="timeline">
          ${steps.map(([key, label]) => `
            <div class="timeline-step" data-k="${key}">
              <label class="row"><input type="checkbox" data-role="done"> ${esc(label)}${LINKED_STEPS.includes(key) ? ' <span class="muted">— same as the WC date</span>' : ''}</label>
              <input type="date" data-role="date">
              ${key === 'customerAdjustments' ? '<label class="row muted"><input type="checkbox" data-role="na"> not needed</label>' : ''}
            </div>`).join('')}
        </div>
      </div>`);
    const progress = el.querySelector('[data-role="progress"]');
    function sync() {
      let done = 0;
      LINKED_STEPS.forEach((k) => { tl[k] = draft.date || ''; });
      el.querySelectorAll('.timeline-step').forEach((row) => {
        const linked = LINKED_STEPS.includes(row.dataset.k);
        const v = tl[row.dataset.k] || '';
        const na = v === 'N/A';
        row.querySelector('[data-role="done"]').checked = !!v;
        row.querySelector('[data-role="done"]').disabled = na || linked;
        const date = row.querySelector('[data-role="date"]');
        date.value = na ? '' : v; date.disabled = na || linked;
        const naBox = row.querySelector('[data-role="na"]');
        if (naBox) naBox.checked = na;
        if (v) done += 1;
      });
      progress.textContent = `— ${done} of ${steps.length} done`;
    }
    dateHooks.push(sync);
    el.querySelectorAll('.timeline-step').forEach((row) => {
      const k = row.dataset.k;
      row.querySelector('[data-role="done"]').addEventListener('change', (e) => { tl[k] = e.target.checked ? (tl[k] || U().today()) : ''; bar.markDirty(); sync(); });
      row.querySelector('[data-role="date"]').addEventListener('input', (e) => { tl[k] = e.target.value; bar.markDirty(); sync(); });
      const na = row.querySelector('[data-role="na"]');
      if (na) na.addEventListener('change', (e) => { tl[k] = e.target.checked ? 'N/A' : ''; bar.markDirty(); sync(); });
    });
    sync();
    return el;
  }

  // ---------------------------------------------------------------- transfer: allocations
  function buildAllocations(saved, data, allocs) {
    const { h, esc, fmt, options } = U();
    const el = h('<div class="panel"><h2>Claim periods</h2></div>');
    if (dirty) {
      el.append(U().notice('Save your changes first — allocations are checked against the saved WC.', 'warning'));
      return el;
    }
    const math = L().transferMath(saved.transfer);
    const periodById = new Map(data.periods.map((p) => [p.id, p]));
    const rIdx = L().dateMonthIndex(saved.date);
    let anything = false;

    ['NonCRT', 'CBEP'].forEach((bucket) => {
      const claim = math.claimable[bucket];
      const mine = allocs.filter((a) => (periodById.get(a.claimPeriodId) || {}).cewType === bucket)
        .sort((a, b) => { const pa = periodById.get(a.claimPeriodId); const pb = periodById.get(b.claimPeriodId); return L().monthIndex(pa.year, pa.month) - L().monthIndex(pb.year, pb.month); });
      if (!(claim.units > 0) && !mine.length) return;
      anything = true;
      const used = L().sumAllocs(mine);
      const remaining = { units: claim.units - used.units, weight: L().r2(claim.weight - used.weight) };
      const status = L().allocationStatus(claim, mine);
      const badge = { 'Fully allocated': 'ok', 'Partially allocated': 'warn', 'Not allocated': 'flag', 'Over-allocated': 'flag' }[status];
      const label = bucket === 'NonCRT' ? 'CEW LCD/LED' : 'CBEP';

      // period choices: existing periods of this type from the received month on, plus "create" for received month … +2
      const existing = data.periods.filter((p) => p.cewType === bucket && (rIdx === null || L().monthIndex(p.year, p.month) >= rIdx))
        .sort((a, b) => L().monthIndex(a.year, a.month) - L().monthIndex(b.year, b.month));
      const createOpts = [];
      if (rIdx !== null) {
        for (let i = rIdx; i <= rIdx + 2; i += 1) {
          const d = L().fromIndex(i);
          if (!existing.some((p) => p.year === d.year && p.month === d.month)) createOpts.push({ value: `new:${d.year}-${d.month}`, label: `Create ${App.Models.CEW_TYPE_LABELS[bucket]} · ${L().monthLabel(d.year, d.month)}` });
        }
      }
      const periodOpts = existing.map((p) => ({ value: p.id, label: App.Models.formatPeriodLabel(p) })).concat(createOpts);

      let nextBtn = '';
      if (mine.length === 1 && remaining.units > 0) {
        const p = periodById.get(mine[0].claimPeriodId);
        const n = L().fromIndex(L().monthIndex(p.year, p.month) + 1);
        nextBtn = `<button type="button" data-a="next" data-y="${n.year}" data-m="${n.month}">Claim the remaining ${fmt(remaining.units)} units / ${fmt(remaining.weight)} lbs in ${L().monthLabel(n.year, n.month)}</button>`;
      }

      const sec = h(`
        <div class="alloc-section">
          <p><strong>${label}</strong> — claimable ${fmt(claim.units)} units / ${fmt(claim.weight)} lbs
            <span class="badge ${badge}">${status}</span>
            ${remaining.units > 0 || remaining.weight > 0 ? `<span class="muted"> · ${fmt(remaining.units)} units / ${fmt(remaining.weight)} lbs not yet allocated</span>` : ''}</p>
          ${mine.length ? `<table><thead><tr><th>Claim period</th><th class="num">Units</th><th class="num">Lbs</th><th></th></tr></thead><tbody>
            ${mine.map((a) => editingAllocId === a.id ? `
              <tr data-id="${a.id}"><td>${esc(App.Models.formatPeriodLabel(periodById.get(a.claimPeriodId)))}</td>
                <td><input data-f="units" type="number" step="1" value="${esc(a.units)}"></td>
                <td><input data-f="weight" type="number" step="0.01" value="${esc(a.weight)}"></td>
                <td class="row"><button type="button" class="primary" data-a="save-edit">Save</button><button type="button" data-a="cancel-edit">Cancel</button></td></tr>`
              : `<tr data-id="${a.id}"><td>${esc(App.Models.formatPeriodLabel(periodById.get(a.claimPeriodId)))}</td>
                <td class="num">${fmt(a.units)}</td><td class="num">${fmt(a.weight)}</td>
                <td class="row"><button type="button" data-a="edit">Edit</button><button type="button" class="danger" data-a="remove">Remove</button></td></tr>`).join('')}
          </tbody></table>` : ''}
          ${nextBtn}
          ${mine.length < 2 && remaining.units > 0 ? `
            <div class="field-row alloc-form">
              <div class="field" style="flex:2"><label>Claim in</label><select data-f="period">${options(periodOpts, '', periodOpts.length ? null : '(no eligible periods)')}</select></div>
              <div class="field"><label>Units</label><input data-f="units" type="number" step="1" value="${remaining.units}"></div>
              <div class="field"><label>Lbs</label><input data-f="weight" type="number" step="0.01" value="${remaining.weight}"></div>
              <div class="field"><label>&nbsp;</label><button type="button" class="primary" data-a="add">Allocate</button></div>
            </div>` : ''}
          <div data-role="errors"></div>
        </div>`);
      const errorsEl = sec.querySelector('[data-role="errors"]');

      async function commit({ periodValue, units, weight, editing }) {
        errorsEl.replaceChildren();
        let period;
        let createYM = null;
        if (String(periodValue).startsWith('new:')) {
          const [y, m] = String(periodValue).slice(4).split('-').map(Number);
          createYM = [y, m];
          period = data.periods.find((p) => p.cewType === bucket && p.year === y && p.month === m) || { id: -1, cewType: bucket, year: y, month: m };
        } else {
          period = periodById.get(Number(periodValue));
        }
        if (!period) { errorsEl.append(U().notice('Pick a claim period.', 'error')); return; }
        const errors = L().validateAllocation({ wc: saved, math, period, units, weight, allocations: allocs, periods: data.periods.concat(period.id === -1 ? [period] : []), editingId: editing ? editing.id : null });
        if (errors.length) { errorsEl.replaceChildren(...errors.map((e) => U().notice(e, 'error'))); return; }
        try {
          if (period.id === -1 && createYM) period = await App.Store.ensurePeriod(bucket, createYM[0], createYM[1]);
          if (editing) await App.DB.put('transferAllocations', { ...editing, units: L().num(units), weight: L().r2(L().num(weight)) });
          else await App.DB.add('transferAllocations', { wcId: saved.id, claimPeriodId: period.id, units: L().num(units), weight: L().r2(L().num(weight)) });
          editingAllocId = null;
          await App.rerender();
        } catch (err) { errorsEl.replaceChildren(U().notice(U().errText(err), 'error')); }
      }

      const addBtn = sec.querySelector('[data-a="add"]');
      if (addBtn) addBtn.addEventListener('click', () => {
        const form = sec.querySelector('.alloc-form');
        commit({ periodValue: form.querySelector('[data-f="period"]').value, units: form.querySelector('[data-f="units"]').value, weight: form.querySelector('[data-f="weight"]').value });
      });
      const next = sec.querySelector('[data-a="next"]');
      if (next) next.addEventListener('click', () => commit({ periodValue: `new:${next.dataset.y}-${next.dataset.m}`, units: remaining.units, weight: remaining.weight }));
      sec.querySelectorAll('tbody tr').forEach((tr) => {
        const a = mine.find((x) => x.id === Number(tr.dataset.id));
        const on = (sel, fn) => { const b = tr.querySelector(sel); if (b) b.addEventListener('click', fn); };
        on('[data-a="edit"]', () => { editingAllocId = a.id; App.rerender(); });
        on('[data-a="cancel-edit"]', () => { editingAllocId = null; App.rerender(); });
        on('[data-a="save-edit"]', () => commit({ periodValue: a.claimPeriodId, units: tr.querySelector('[data-f="units"]').value, weight: tr.querySelector('[data-f="weight"]').value, editing: a }));
        on('[data-a="remove"]', async () => {
          if (!confirm('Remove this allocation?')) return;
          await App.DB.delete('transferAllocations', a.id);
          App.rerender();
        });
      });
      el.append(sec);
    });

    if (!anything) el.append(U().h('<p class="muted">Nothing claimable yet — enter the source-log count on an LCD/LED (or CBEP) line and save.</p>'));
    if (math.hasCrtOrPlasma) el.append(U().h(`<p class="muted">${U().fmt(math.excluded.units)} CEW CRT/plasma units (${U().fmt(math.excluded.weight)} lbs) are never allocated — they go to another recycler.</p>`));
    el.append(U().h('<p class="hint">Rules: a transfer can be split across at most two back-to-back months, never before the month it was received, and never for more than its claimable total. To turn a whole allocation into a partial one, edit it down, then claim the rest in the next month.</p>'));
    return el;
  }

  // ---------------------------------------------------------------- transfer: pricing
  function buildPricing(data, bar) {
    const { h, esc, fmt, options } = U();
    const el = h('<div class="panel"></div>');
    const otherItems = data.priceItems.filter((p) => p.appliesTo === 'other');
    const field = (r) => (r.part === 'cew' ? 'cewRate' : r.part === 'noncew' ? 'nonCewRate' : 'rate');
    const compute = () => L().invoiceMath({ transfer: draft.transfer, mode: draft.transfer.mode, priceItems: data.priceItems, company: App.Store.transferParties(draft, data).customer });
    const sourceText = (r) => r.source + (r.rate !== null && r.source !== 'Set at inspection' ? ` · ${L().rateText(r.rate)}/${r.basis}` : '');

    function recalc() {
      const inv = compute();
      el.querySelectorAll('table.pricing > tbody > tr').forEach((tr) => {
        const r = inv.rows[Number(tr.dataset.i)]; if (!r) return;
        tr.querySelector('[data-role="amount"]').textContent = L().money(r.amount);
        const src = tr.querySelector('[data-role="source"]');
        src.textContent = sourceText(r); src.className = r.needsRate ? 'flag-text' : 'muted';
      });
      const set = (role, text) => { const x = el.querySelector(`[data-role="${role}"]`); if (x) x.textContent = text; };
      set('subtotal', L().money(inv.subtotal));
      const trk = el.querySelector('[data-role="trucking-row"]');
      if (trk) trk.hidden = !inv.trucking;
      if (inv.trucking) { set('trucking-label', inv.trucking.label); set('trucking', L().money(inv.trucking.amount)); }
      set('total', L().money(inv.total));
      set('missing', inv.missing ? `${inv.missing} rate(s) still needed.` : '');
    }

    function rebuild() {
      const inv = compute();
      const mode = draft.transfer.mode;
      const body = h(`<div>
        <h2>Pricing — purchase invoice</h2>
        <p class="muted mt-0">${mode ? (mode === 'pickup' ? 'Picked up' : 'Dropped off') : '<span class="flag-text">Choose pick up or drop off above.</span>'} ·
          Each rate comes from the customer's own rate, then the <a href="#/prices">price list</a>. Type a rate to set it at inspection.</p>
        ${inv.rows.length ? `<div class="table-scroll"><table class="lines pricing">
          <thead><tr><th>Description</th><th class="num">Units</th><th class="num">Lbs</th><th>Price-list item</th><th>Rate from</th><th class="num">Rate at inspection</th><th class="num">Amount</th></tr></thead>
          <tbody>${inv.rows.map((r, i) => {
            const fallback = L().resolveRate({ row: { ...r, manualRate: '' }, mode, priceItems: data.priceItems, company: App.Store.transferParties(draft, data).customer });
            return `<tr data-i="${i}">
              <td>${esc(r.label)}</td><td class="num">${fmt(r.units)}</td><td class="num">${fmt(r.weight)}</td>
              <td>${r.part === 'other' ? `<select data-role="item">${options(otherItems.map((p) => ({ value: p.id, label: p.name })), r.priceItemId, otherItems.length ? '— pick —' : '(none on the price list)')}</select>` : esc(r.item ? r.item.name : '—')}</td>
              <td data-role="source"></td>
              <td><input data-role="rate" type="number" step="0.0001" min="0" value="${esc(draft.transfer.lines[r.lineIndex][field(r)] ?? '')}" placeholder="${fallback.rate === null ? 'rate' : fallback.rate}"></td>
              <td class="num" data-role="amount"></td></tr>`;
          }).join('')}</tbody>
          <tfoot>
            <tr><th colspan="6">Subtotal</th><th class="num" data-role="subtotal"></th></tr>
            <tr data-role="trucking-row"><th colspan="6" data-role="trucking-label"></th><th class="num" data-role="trucking"></th></tr>
            <tr><th colspan="6">Total <span class="flag-text" data-role="missing"></span></th><th class="num" data-role="total"></th></tr>
          </tfoot></table></div>` : '<p class="muted">Enter the IRR lines first.</p>'}
      </div>`);
      body.querySelectorAll('table.pricing > tbody > tr').forEach((tr) => {
        const r = inv.rows[Number(tr.dataset.i)];
        const line = draft.transfer.lines[r.lineIndex];
        tr.querySelector('[data-role="rate"]').addEventListener('input', (e) => { line[field(r)] = e.target.value; bar.markDirty(); recalc(); });
        const sel = tr.querySelector('[data-role="item"]');
        if (sel) sel.addEventListener('change', () => { line.priceItemId = sel.value ? Number(sel.value) : null; bar.markDirty(); rebuild(); });
      });
      el.replaceChildren(...Array.from(body.childNodes));
      recalc();
    }
    rebuild();
    return { el, rebuild };
  }

  // ---------------------------------------------------------------- transfer: documents
  function buildDocuments(saved, data) {
    const { h } = U();
    const P = App.Store.transferParties(saved, data);
    const inv = L().invoiceMath({ transfer: saved.transfer, mode: saved.transfer.mode, priceItems: data.priceItems, company: P.customer });
    const noDesc = (saved.transfer.lines || []).some((l) => !L().category(l.category).cew && (L().num(l.irrUnits) || L().num(l.irrWeight)) && !String(l.description || '').trim());
    const warn = [
      dirty && 'You have unsaved changes — documents are built from the saved WC.',
      !P.customer && 'No customer (handler or collector) selected.',
      !saved.transfer.mode && 'Pick up or drop off not chosen.',
      inv.missing && `${inv.missing} invoice rate(s) still needed.`,
      noDesc && 'An Other (non-CEW) line has no description.',
      !data.profile.recyclerName && 'Facility name/address not set in Settings.',
    ].filter(Boolean);
    const el = h(`
      <div class="panel">
        <h2>Documents</h2>
        <div class="row">
          <a class="button" href="#/doc/${saved.id}/irr">Inbound Receiving Report</a>
          <a class="button" href="#/doc/${saved.id}/wc">Weight Certificate</a>
          <a class="button" href="#/doc/${saved.id}/invoice">Purchase Invoice</a>
          <a class="button" href="#/doc/${saved.id}/197">CalRecycle 197</a>
        </div>
        <div data-role="warn"></div>
      </div>`);
    el.querySelector('[data-role="warn"]').append(...warn.map((w) => U().notice(w, 'warning')));
    return el;
  }

  // ---------------------------------------------------------------- shipment / inventory lines
  function buildWeighLines(data, bar) {
    const { h, esc, fmt, options } = U();
    const holder = draft.kind === 'shipment' ? draft.shipment : draft.inventory;
    const matOpts = (sel) => options(data.materials.map((m) => ({ value: m.id, label: m.name })), sel, '— material —');
    const el = h(`
      <div class="panel">
        <h2>${draft.kind === 'shipment' ? 'Materials shipped' : 'Materials on hand'}</h2>
        ${draft.kind === 'inventory' ? '<p class="muted mt-0">Leave net blank for anything with nothing in storage.</p>' : ''}
        <div class="table-scroll"><table class="lines">
          <thead><tr><th>Material</th><th class="num">Gross</th><th class="num">Tare</th><th class="num">Net lbs</th><th></th></tr></thead>
          <tbody>${holder.lines.map((l, i) => `
            <tr data-i="${i}">
              <td><select data-f="materialId">${matOpts(l.materialId)}</select></td>
              <td><input data-f="gross" type="number" step="0.01" value="${esc(l.gross)}"></td>
              <td><input data-f="tare" type="number" step="0.01" value="${esc(l.tare)}"></td>
              <td><input data-f="net" type="number" step="0.01" value="${esc(l.net)}"></td>
              <td><button type="button" class="ghost" data-a="remove" title="Remove line">✕</button></td>
            </tr>`).join('')}</tbody>
          <tfoot><tr><th colspan="3">Total net</th><th class="num" data-role="total"></th><th></th></tr></tfoot>
        </table></div>
        <button type="button" data-a="add">+ Add line</button>
        ${data.materials.length ? '' : '<p class="hint">No materials yet — add them in <a href="#/settings">Settings</a>.</p>'}
      </div>`);
    const totalEl = el.querySelector('[data-role="total"]');
    const refresh = () => { totalEl.textContent = fmt(holder.lines.reduce((s, l) => s + L().lineNet(l), 0)); };
    el.querySelectorAll('tbody tr').forEach((tr) => {
      const line = holder.lines[Number(tr.dataset.i)];
      const netInput = tr.querySelector('[data-f="net"]');
      tr.querySelectorAll('[data-f]').forEach((input) => input.addEventListener('input', () => {
        const f = input.dataset.f;
        line[f] = f === 'materialId' ? (input.value ? Number(input.value) : null) : input.value;
        if ((f === 'gross' || f === 'tare') && line.gross !== '' && line.tare !== '') {
          line.net = String(L().r2(L().num(line.gross) - L().num(line.tare)));
          netInput.value = line.net;
        }
        bar.markDirty(); refresh();
      }));
      tr.querySelector('[data-a="remove"]').addEventListener('click', () => { holder.lines.splice(Number(tr.dataset.i), 1); dirty = true; App.rerender(); });
    });
    el.querySelector('[data-a="add"]').addEventListener('click', () => { holder.lines.push(App.Store.blankWeighLine()); dirty = true; App.rerender(); });
    refresh();
    return el;
  }

  // ---------------------------------------------------------------- page
  return {
    async render(container) {
      const id = Number(App.State.routeParams[0]);
      const data = await App.Store.loadAll();
      const saved = data.wcs.find((w) => w.id === id);
      if (!saved) {
        container.append(U().header('Weight certificate'), U().empty('WC not found', '<a href="#/wcs">Back to all weight certificates</a>'));
        return;
      }
      if (draftId !== id) { draft = JSON.parse(JSON.stringify(saved)); draftId = id; dirty = false; editingAllocId = null; }
      dateHooks = [];
      const type = data.wcTypes.find((t) => t.id === saved.typeId);
      const allocs = data.allocations.filter((a) => a.wcId === id);
      const back = { transfer: ' · <a href="#/transfers">Transfers</a>', shipment: ' · <a href="#/residuals">Residuals</a>', inventory: ' · <a href="#/residuals">Residuals</a>' }[saved.kind] || '';

      container.append(U().h(`<p class="crumbs"><a href="#/wcs">← All weight certificates</a>${back}</p>`));
      container.append(U().header(`WC #${saved.wcNumber}`, U().esc(type ? type.name : 'Weight certificate')));
      if (flash) { container.append(U().notice(flash.text, flash.kind)); flash = null; }
      const bar = buildSaveBar(saved, data);
      container.append(bar.el, buildCommon(saved, data, bar));
      if (saved.kind === 'transfer') {
        const pricing = buildPricing(data, bar);
        container.append(buildParties(data, bar), buildLines(bar, pricing.rebuild), pricing.el, buildTimeline(bar), buildAllocations(saved, data, allocs), buildDocuments(saved, data));
      } else if (saved.kind === 'shipment' || saved.kind === 'inventory') {
        container.append(buildWeighLines(data, bar));
      }
      const docs = document.createElement('div');
      container.append(docs);
      await App.Attachments.renderSection(docs, { linkedEntityType: 'wc', linkedEntityId: id });
    },
    /** Called by other pages before navigating to a freshly created WC. */
    reset() { draftId = null; },
  };
})();
