window.App = window.App || {};
App.Pages = App.Pages || {};

/** Editor for one weight certificate, whatever its type. Route: #/wc/<id> */
App.Pages.wc = (function () {
  let draft = null;        // unsaved copy of the WC being edited
  let draftId = null;
  let dirty = false;
  let flash = null;        // one-time message shown after a re-render
  let editingAllocId = null;
  let dateHooks = [];
  let poRefreshHook = null;
  let timelineHooks = []; // things that follow the transfer timeline live (reset every render) // refreshes the purchase-invoice deductions when a rate changes (reset every render)       // things to refresh live when the WC date changes (reset every render)
  const LINKED_STEPS = ['wcAssigned', 'materialReceived']; // always the WC date

  const U = () => App.UI;
  const L = () => App.Logic;
  const setFlash = (text, kind) => { flash = { text, kind }; };
  /** Scale person = one of the authorized WC signers from Settings (no default). */
  const signerOptions = (data, current) => {
    const list = [...(data.profile.wcSigners || [])];
    if (current && !list.includes(current)) list.push(current);
    return U().options(list.map((n) => ({ value: n, label: n })), current, list.length ? '— choose a signer —' : '(add authorized signers in Settings)');
  };

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
        <button type="button" class="danger" data-a="delete">${saved.kind === 'crtShipment' ? 'Delete shipment' : saved.noWc ? 'Delete entry' : 'Delete WC'}</button>
      </div>`);
    const dirtyEl = el.querySelector('[data-role="dirty"]');
    const errEl = el.querySelector('[data-role="err"]');
    const markDirty = () => { dirty = true; dirtyEl.textContent = 'Unsaved changes'; dirtyEl.className = 'flag-text'; };

    el.querySelector('[data-a="save"]').addEventListener('click', async () => {
      errEl.textContent = '';
      try {
        const number = String(draft.wcNumber || '').trim();
        const general = (draft.kind === 'inventory' && draft.noWc) || draft.kind === 'crtShipment';
        if (!number && !general) throw new Error('WC # is required.');
        if (draft.kind === 'crtShipment') {
          draft.crtShipment.lines = (draft.crtShipment.lines || []).filter((l) => l.wcId || l.units || l.weight);
          if (!draft.date) throw new Error('Enter the date shipped.');
          const errs = L().crtPlasmaErrors({ shipment: draft, wcs: data.wcs });
          if (errs.length) throw new Error(errs.join(' '));
        }
        if (draft.kind === 'inventory') {
          draft.inventory.lines = draft.inventory.lines.filter((l) => l.materialId != null && (l.gross !== '' || l.tare !== '' || l.net !== ''));
          const errs = L().inventoryRuleErrors({ wc: draft, materials: data.materials });
          if (errs.length) throw new Error(errs.join(' '));
        }
        if (await App.Store.wcNumberTaken(number, saved.id)) throw new Error(`WC #${number} already exists.`);
        if (draft.kind === 'transfer' && draft.transfer.irrNumber && await App.Store.irrNumberTaken(draft.transfer.irrNumber, saved.id)) {
          throw new Error(`IRR #${draft.transfer.irrNumber} is already used on another transfer.`);
        }
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
        const learned = draft.kind === 'shipment' ? await App.Store.learnDescriptions(draft) : 0;
        dirty = false;
        setFlash(learned ? `Saved. Added ${learned} new description(s) to the vendor description list.` : 'Saved.', 'ok');
        await App.rerender();
      } catch (err) { errEl.textContent = U().errText(err); }
    });
    el.querySelector('[data-a="discard"]').addEventListener('click', () => { draftId = null; App.rerender(); });
    el.querySelector('[data-a="delete"]').addEventListener('click', async () => {
      const units = await App.DB.getAllByIndex('cancelledUnits', 'lotNumber', L().normLot(saved.wcNumber));
      const allocs = data.allocations.filter((a) => a.wcId === saved.id);
      const extra = [allocs.length ? `${allocs.length} claim-period allocation(s) and its attachments will be removed.` : 'Its attachments will be removed.',
        units.length ? `${units.length} cancelled unit(s) with lot #${saved.wcNumber} will stay, but will show as "no matching WC" in the audit.` : ''].join(' ');
      if (!confirm(`Delete ${saved.wcNumber ? `WC #${saved.wcNumber}` : 'this entry'}? ${extra}`)) return;
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
    const isInv = draft.kind === 'inventory';
    const general = isInv && draft.noWc;
    const isCrt = draft.kind === 'crtShipment';
    const dateLabel = isTransfer ? 'WC date <span class="muted">(assigned = received)</span>' : draft.kind === 'shipment' || isCrt ? 'Date shipped' : 'Date';
    const el = h(`
      <div class="panel">
        <h2>Details</h2>
        <div class="field-row">
          ${isInv ? `<div class="field"><label>Record as</label><select data-f="recordAs">${options([{ value: 'wc', label: 'Weight certificate' }, { value: 'general', label: 'General entry (no WC)' }], general ? 'general' : 'wc')}</select></div>` : ''}
          ${isCrt ? `<div class="field"><label>Reference # <span class="muted">(BOL / manifest, optional)</span></label><input data-f="reference" value="${esc(draft.crtShipment.reference)}"></div>`
            : general ? '' : `<div class="field"><label>WC #</label><input data-f="wcNumber" value="${esc(draft.wcNumber)}"></div>`}
          <div class="field"><label>${dateLabel}</label><input type="date" data-f="date" value="${esc(draft.date)}"></div>
          <div class="field"><label>Status</label>
            <select data-f="statusId">${options(data.wcStatuses.map((s) => ({ value: s.id, label: s.name })), draft.statusId, '(no status)')}</select>
            ${data.wcStatuses.length ? '' : '<div class="hint">Add statuses in <a href="#/settings">Settings</a>.</div>'}
          </div>
          ${isInv ? `<div class="field"><label>Inventory of</label><div class="readonly">${esc(data.profile.recyclerName || 'Our facility')}</div></div>
            <div class="field"><label>End-of-month inventory for</label><input type="month" data-f="forMonth" value="${esc(draft.inventory.forMonth)}"></div>`
            : isTransfer ? '' : `<div class="field"><label>${isCrt ? 'Going to <span class="muted">(approved CEW recycler)</span>' : draft.kind === 'shipment' ? 'Going to' : 'Company'}</label>
            <select data-f="companyId">${App.Store.partyOptions(draft.kind, data.companies, draft.companyId)}</select></div>`}
        </div>
        <div class="field"><label>Notes</label><textarea data-f="notes" rows="2">${esc(draft.notes)}</textarea></div>
      </div>`);
    el.querySelectorAll('[data-f]').forEach((input) => {
      input.addEventListener('input', () => {
        const f = input.dataset.f; const v = input.value;
        const prevCompanyId = draft.companyId;
        if (f === 'recordAs') {
          draft.noWc = v === 'general';
          draft.wcNumber = draft.noWc ? '' : (draft.wcNumber || L().nextWcNumber(data.wcs.filter((w) => w.id !== draftId)));
          dirty = true; App.rerender(); return;
        }
        if (f === 'statusId' || f === 'companyId') draft[f] = v ? Number(v) : null;
        else if (f === 'forMonth') draft.inventory.forMonth = v;
        else if (f === 'reference') draft.crtShipment.reference = v.trim();
        else draft[f] = v;
        if (f === 'date') dateHooks.forEach((fn) => fn());
        bar.markDirty();
        if (f === 'companyId' && (draft.kind === 'shipment' || isCrt)) {
          const holder = draft.shipment || draft.crtShipment;
          const c = data.companies.find((x) => x.id === draft.companyId);
          if (c && !holder.mode && (c.materialMode === 'pickup' || c.materialMode === 'dropoff')) holder.mode = c.materialMode;
          const prev = data.companies.find((x) => x.id === prevCompanyId) || null;
          if (holder.plateAuto || App.Store.isKnownPlate(holder.licensePlate, prev, data.profile) || App.Store.isKnownPlate(holder.licensePlate, c, data.profile)) { holder.licensePlate = App.Store.plateChoices({ direction: 'out', mode: holder.mode, company: c, profile: data.profile }).plates[0] || ''; holder.plateAuto = true; }
          App.rerender(); // vendor-specific descriptions, plates
        }
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
      const list = data.companies.filter((c) => ((c.roles || []).includes(role) && c.accountStatus !== 'closed') || c.id === current);
      return options(list.map((c) => ({ value: c.id, label: c.name + (c.cewId ? ` — ${c.cewId}` : '') + (c.accountStatus === 'closed' ? ' (closed)' : '') })), current, '— none —');
    };
    const us = `${esc(P.facility.name)}${P.facility.cewId ? ` — ${esc(P.facility.cewId)}` : ''}`;
    const usCollector = P.collectorIsFacility ? `${esc(P.collector.name)}${P.collector.cewId ? ` — ${esc(P.collector.cewId)}` : ''}${P.dualEntity ? ' <span class="badge">Dual entity</span>' : ''}` : '';
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
            ? `<div class="readonly">${usCollector}</div><div class="hint">We're the collector whenever a handler is selected.</div>`
            : `<select data-f="collectorId">${pick('collector', t.collectorId)}</select>`}</div>
          <div class="field"><label>Recycler</label><div class="readonly">${us}</div></div>
          <div class="field"><label>Material was</label><select data-f="mode">${options([{ value: 'dropoff', label: 'Dropped off' }, { value: 'pickup', label: 'Picked up' }], t.mode, '— choose —')}</select></div>
        </div>
        ${P.collectorIsFacility && !P.dualEntity ? `<div class="notice warning">We're listed as the collector because a handler is selected, but our facility isn't marked as a dual entity in <a href="#/settings">Settings</a>.</div>` : ''}
        ${c && c.accountStatus === 'closed' ? `<div class="notice warning">${esc(c.name)}'s account is closed.</div>` : ''}
        ${c ? `<p class="hint"><strong>${esc(c.name)}</strong>${info.length ? ` — ${info.join(' · ')}` : ''} · <a href="#/companies" data-a="edit-customer">edit customer</a></p>` : ''}
        <p class="hint">Only companies with the matching role are listed — <a href="#/companies">manage companies</a>.</p>
        <div class="field"><label>Extra collector-activity notes for the 197 <span class="muted">(the handler and the CRT/plasma line are added automatically)</span></label>
          <textarea data-f="activityNotes" rows="2">${esc(t.activityNotes)}</textarea></div>
      </div>`);
    el.querySelectorAll('select[data-f]').forEach((sel) => sel.addEventListener('change', () => {
      const f = sel.dataset.f;
      const prevCustomerId = (App.Store.transferParties(draft, data).customer || {}).id;
      if (f === 'mode') t.mode = sel.value;
      else {
        t[f] = sel.value ? Number(sel.value) : null;
        if (f === 'handlerId' && t.handlerId) t.collectorId = null;
        const cust = App.Store.transferParties(draft, data).customer;
        if (!t.mode && cust && (cust.materialMode === 'pickup' || cust.materialMode === 'dropoff')) t.mode = cust.materialMode;
      }
      const cust = App.Store.transferParties(draft, data).customer;
      const prevCust = data.companies.find((x) => x.id === prevCustomerId) || null;
      if (t.plateAuto || App.Store.isKnownPlate(t.licensePlate, prevCust, data.profile) || App.Store.isKnownPlate(t.licensePlate, cust, data.profile)) {
        t.licensePlate = App.Store.plateChoices({ direction: 'in', mode: t.mode, company: cust, profile: data.profile }).plates[0] || '';
        t.plateAuto = true;
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
  function buildLines(data, bar, onChange) {
    const { h, esc, fmt } = U();
    const t = draft.transfer;
    // lines saved before gross/tare existed only have a net weight: show it as gross with no tare
    t.lines.forEach((l) => { if (l.irrGross === undefined) { l.irrGross = l.irrWeight ?? ''; l.irrTare = ''; } });
    const otherItems = data.priceItems.filter((p) => p.appliesTo === 'other');
    const byNames = [...new Set(data.wcs.filter((w) => w.kind === 'transfer' && w.transfer && w.transfer.irrBy).map((w) => w.transfer.irrBy))];
    const nextIrr = L().nextIrrNumber(data.wcs.filter((w) => w.id !== draftId));
    const plates = App.Store.plateChoices({ direction: 'in', mode: t.mode, company: App.Store.transferParties(draft, data).customer, profile: data.profile });
    const catOptions = (sel) => L().CATEGORIES.map((c) => `<option value="${c.key}" ${c.key === sel ? 'selected' : ''}>${esc(c.label)}</option>`).join('');
    const rows = t.lines.map((line, i) => {
      const cew = L().category(line.category).cew;
      return `
        <tr data-i="${i}">
          <td><select data-f="category">${catOptions(line.category)}</select>
              <input data-f="description" class="desc" ${cew ? '' : 'list="other-items"'} placeholder="${cew ? 'description (optional)' : 'description — printed on the IRR, WC and invoice'}" value="${esc(line.description)}"></td>
          <td><input data-f="irrUnits" type="text" inputmode="decimal" step="1" min="0" value="${esc(line.irrUnits)}" placeholder="${cew ? '' : 'Wt.Only'}"></td>
          <td><input data-f="irrGross" type="text" inputmode="decimal" step="0.01" min="0" value="${esc(line.irrGross)}"></td>
          <td><input data-f="irrTare" type="text" inputmode="decimal" step="0.01" min="0" value="${esc(line.irrTare)}" placeholder="0"></td>
          <td class="num" data-d="net"></td>
          <td><input data-f="cewUnits" type="text" inputmode="decimal" step="1" min="0" value="${cew ? esc(line.cewUnits) : ''}" ${cew ? '' : 'disabled placeholder="n/a"'}></td>
          <td><input data-f="nonCewWeight" type="text" inputmode="decimal" step="0.01" min="0" value="${cew ? esc(line.nonCewWeight) : ''}" ${cew ? '' : 'disabled placeholder="n/a"'}></td>
          <td class="num" data-d="cewWeight"></td>
          <td class="num" data-d="nonCewUnits"></td>
          <td><button type="button" class="ghost" data-a="remove" title="Remove line">✕</button></td>
        </tr>`;
    }).join('');
    const el = h(`
      <div class="panel">
        <h2>Inbound receiving report → WC</h2>
        <div class="field-row">
          <div class="field"><label>IRR #</label><input data-r="irrNumber" value="${esc(t.irrNumber)}">
            ${!t.irrNumber && nextIrr ? `<button type="button" class="linklike" data-a="next-irr">use next: ${esc(nextIrr)}</button>` : ''}</div>
          <div class="field"><label>Shipping date <span class="muted">(blank = WC date)</span></label><input type="date" data-r="shippingDate" value="${esc(t.shippingDate)}"></div>
          <div class="field"><label>License plate <span class="muted">(${esc(plates.whose)})</span></label><input data-r="licensePlate" list="irr-plates" value="${esc(t.licensePlate)}"></div>
          <div class="field"><label>Inbound report by</label><input data-r="irrBy" list="irr-by-names" value="${esc(t.irrBy)}"></div>
          <div class="field"><label>WC signer <span class="muted">(scale person)</span></label><select data-r="scalePerson">${signerOptions(data, t.scalePerson)}</select></div>
        </div>
        <p class="muted mt-0">Enter everything received, as on the IRR. Leave units blank for weight-only items (prints "Wt.Only"). For CEW items, the source-log count is the CEW units; type the weight of the non-CEW units and the CEW weight is the rest.</p>
        <div class="table-scroll"><table class="lines">
          <thead><tr><th>Item</th><th class="num">Units</th><th class="num">Gross</th><th class="num">Tare</th><th class="num">Net lbs</th>
            <th class="num">Source logs<br>(CEW units)</th><th class="num">Non-CEW lbs</th><th class="num">CEW lbs</th><th class="num">Non-CEW units</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><th>Totals</th><th class="num" data-t="irrUnits"></th><th class="num" data-t="irrGross"></th><th class="num" data-t="irrTare"></th><th class="num" data-t="irrWeight"></th>
            <th class="num" data-t="cewUnits"></th><th class="num" data-t="nonCewWeight"></th><th class="num" data-t="cewWeight"></th><th class="num" data-t="nonCewUnits"></th><th></th></tr></tfoot>
        </table></div>
        <datalist id="other-items">${otherItems.map((p) => `<option value="${esc(p.name)}">`).join('')}</datalist>
        <datalist id="irr-plates">${plates.plates.map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
        <datalist id="irr-by-names">${byNames.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
        <button type="button" data-a="add">+ Add line</button>
        <div data-role="problems"></div>
        <h3>On the WC</h3>
        <div data-role="preview"></div>
      </div>`);

    el.querySelectorAll('[data-r]').forEach((input) => input.addEventListener('input', () => {
      t[input.dataset.r] = input.dataset.r === 'licensePlate' ? input.value.trim().toUpperCase() : input.value.trim();
      if (input.dataset.r === 'licensePlate') t.plateAuto = false;
      bar.markDirty();
    }));
    const nextBtn = el.querySelector('[data-a="next-irr"]');
    if (nextBtn) nextBtn.addEventListener('click', () => { el.querySelector('[data-r="irrNumber"]').value = nextIrr; t.irrNumber = nextIrr; nextBtn.remove(); bar.markDirty(); });

    const problemsEl = el.querySelector('[data-role="problems"]');
    const previewEl = el.querySelector('[data-role="preview"]');
    function refresh() {
      const math = L().transferMath(t);
      el.querySelectorAll('table.lines > tbody > tr').forEach((tr) => {
        const lm = math.lines[Number(tr.dataset.i)];
        tr.querySelector('[data-d="net"]').textContent = fmt(lm.irrWeight);
        tr.querySelector('[data-d="cewWeight"]').textContent = lm.cat.cew ? fmt(lm.cewWeight) : '—';
        tr.querySelector('[data-d="nonCewUnits"]').textContent = fmt(lm.nonCewUnits);
      });
      const tot = math.lines.reduce((a, l, i) => ({ irrUnits: a.irrUnits + l.irrUnits, irrGross: a.irrGross + L().num(t.lines[i].irrGross), irrTare: a.irrTare + L().num(t.lines[i].irrTare),
        irrWeight: a.irrWeight + l.irrWeight, cewUnits: a.cewUnits + l.cewUnits, nonCewWeight: a.nonCewWeight + l.nonCewWeight, cewWeight: a.cewWeight + l.cewWeight, nonCewUnits: a.nonCewUnits + l.nonCewUnits }),
      { irrUnits: 0, irrGross: 0, irrTare: 0, irrWeight: 0, cewUnits: 0, nonCewWeight: 0, cewWeight: 0, nonCewUnits: 0 });
      Object.keys(tot).forEach((k) => { el.querySelector(`[data-t="${k}"]`).textContent = fmt(tot[k]); });
      const extra = [];
      t.lines.forEach((l, i) => {
        if (!L().category(l.category).cew && (L().num(l.irrUnits) || L().num(l.irrWeight)) && !String(l.description || '').trim()) extra.push(`Line ${i + 1}: give this Other (non-CEW) item a description — it's printed on the IRR, WC and purchase invoice`);
        if (L().num(l.irrTare) > L().num(l.irrGross)) extra.push(`Line ${i + 1}: tare is more than gross`);
      });
      problemsEl.replaceChildren(...math.problems.concat(extra).map((p) => U().notice(p, 'warning')));
      const wcRows = L().documentRows(t);
      previewEl.replaceChildren(wcRows.length
        ? U().h(`<table><thead><tr><th>Description</th><th class="num">Units</th><th class="num">Lbs</th></tr></thead><tbody>${
          wcRows.map((r) => `<tr><td>${esc(r.label)}</td><td class="num">${r.part === 'other' && !r.units ? 'Wt.Only' : fmt(r.units)}</td><td class="num">${fmt(r.weight)}</td></tr>`).join('')}</tbody></table>`)
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
          if (f === 'irrGross' || f === 'irrTare') {
            line.irrWeight = line.irrGross === '' && line.irrTare === '' ? '' : String(L().r2(L().num(line.irrGross) - L().num(line.irrTare)));
          }
          if (f === 'description' && line.category === 'other') {
            const hit = otherItems.find((p) => L().norm(p.name) === L().norm(input.value));
            if (hit) line.priceItemId = hit.id;
          }
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
      timelineHooks.forEach((fn) => fn());
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
                <td><input data-f="units" type="text" inputmode="decimal" step="1" value="${esc(a.units)}"></td>
                <td><input data-f="weight" type="text" inputmode="decimal" step="0.01" value="${esc(a.weight)}"></td>
                <td class="row"><button type="button" class="primary" data-a="save-edit">Save</button><button type="button" data-a="cancel-edit">Cancel</button></td></tr>`
              : `<tr data-id="${a.id}"><td>${esc(App.Models.formatPeriodLabel(periodById.get(a.claimPeriodId)))}</td>
                <td class="num">${fmt(a.units)}</td><td class="num">${fmt(a.weight)}</td>
                <td class="row"><button type="button" data-a="edit">Edit</button><button type="button" class="danger" data-a="remove">Remove</button></td></tr>`).join('')}
          </tbody></table>` : ''}
          ${nextBtn}
          ${mine.length < 2 && remaining.units > 0 ? `
            <div class="field-row alloc-form">
              <div class="field" style="flex:2"><label>Claim in</label><select data-f="period">${options(periodOpts, '', periodOpts.length ? null : '(no eligible periods)')}</select></div>
              <div class="field"><label>Units</label><input data-f="units" type="text" inputmode="decimal" step="1" value="${remaining.units}"></div>
              <div class="field"><label>Lbs</label><input data-f="weight" type="text" inputmode="decimal" step="0.01" value="${remaining.weight}"></div>
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
    const out = L().crtPlasmaLedger(data.wcs).rows.filter((r) => r.wc.id === saved.id);
    if (out.length) {
      el.append(U().h(`<p><strong>Sent to other recyclers:</strong> ${out.map((r) => `${r.category === 'crt' ? 'CRT' : 'Plasma'} ${U().fmt(r.shipped.units)} of ${U().fmt(r.received.units)}${r.shipments.length
        ? ` (${r.shipments.map((x) => `<a href="#/wc/${x.wc.id}">${x.wc.wcNumber ? `WC #${U().esc(x.wc.wcNumber)}` : `shipped ${U().esc(L().shortDate(x.wc.date))}`}</a>`).join(', ')})` : ''}${r.rejected ? `, ${U().fmt(r.rejected)} rejected as non-CEW by the recycler` : ''}${r.onHand.units ? ` — <span class="flag-text">${U().fmt(r.onHand.units)} still on hand</span>` : ''}`).join(' · ')}</p>`));
    }
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
      set('credit', L().money(inv.totalCredit));
      set('deduction', L().money(inv.totalDeduction ? -inv.totalDeduction : 0));
      set('total', L().money(inv.finalBalance));
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
              <td><input data-role="rate" type="text" inputmode="decimal" step="0.0001" min="0" value="${esc(draft.transfer.lines[r.lineIndex][field(r)] ?? '')}" placeholder="${fallback.rate === null ? 'rate' : fallback.rate}"></td>
              <td class="num" data-role="amount"></td></tr>`;
          }).join('')}</tbody>
          <tfoot>
            <tr><th colspan="6">Total credit</th><th class="num" data-role="credit"></th></tr>
            <tr><th colspan="6">Total deductions <span class="muted">(non-CEW, handling, trucking and any added below)</span></th><th class="num" data-role="deduction"></th></tr>
            <tr><th colspan="6">Final balance <span class="flag-text" data-role="missing"></span></th><th class="num" data-role="total"></th></tr>
          </tfoot></table></div>` : '<p class="muted">Enter the IRR lines first.</p>'}
      </div>`);
      body.querySelectorAll('table.pricing > tbody > tr').forEach((tr) => {
        const r = inv.rows[Number(tr.dataset.i)];
        const line = draft.transfer.lines[r.lineIndex];
        tr.querySelector('[data-role="rate"]').addEventListener('input', (e) => { line[field(r)] = e.target.value; bar.markDirty(); recalc(); if (poRefreshHook) poRefreshHook(); });
        const sel = tr.querySelector('[data-role="item"]');
        if (sel) sel.addEventListener('change', () => { line.priceItemId = sel.value ? Number(sel.value) : null; bar.markDirty(); rebuild(); if (poRefreshHook) poRefreshHook(); });
      });
      el.replaceChildren(...Array.from(body.childNodes));
      recalc();
    }
    rebuild();
    return { el, rebuild, recalc };
  }

  // ---------------------------------------------------------------- transfer: purchase invoice details
  function buildPurchaseInvoice(data, bar, pricing) {
    const { h, esc, fmt } = U();
    const t = draft.transfer;
    t.deductions = t.deductions || [];
    const byNames = [...new Set(data.wcs.filter((w) => w.kind === 'transfer' && w.transfer && w.transfer.invoiceBy).map((w) => w.transfer.invoiceBy))];
    const el = h(`
      <div class="panel">
        <h2>Purchase invoice</h2>
        <div class="field-row">
          <div class="field"><label>PO #</label><div class="readonly">${esc(draft.wcNumber)} <span class="muted">(same as the WC #)</span></div></div>
          <div class="field"><label>PO date <span class="muted">(blank = the "PO sent" date, else today)</span></label><input type="date" data-p="poDate" value="${esc(t.poDate)}"></div>
          <div class="field" style="flex:2"><label>Circumstance</label><input data-p="circumstance" value="${esc(t.circumstance)}"></div>
          <div class="field"><label>Purchase invoice by</label><input data-p="invoiceBy" list="invoice-by-names" value="${esc(t.invoiceBy)}"></div>
        </div>
        <datalist id="invoice-by-names">${byNames.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
        <h3>Deductions</h3>
        <div data-role="auto"></div>
        <div class="table-scroll"><table class="lines deds">
          <thead><tr><th class="num">Quantity</th><th>Description</th><th>Reason for deduction</th><th class="num">Rate $</th><th class="num">Deduction</th><th></th></tr></thead>
          <tbody></tbody>
        </table></div>
        <button type="button" data-a="add">+ Add a deduction</button>
        <p class="hint">Non-CEW units, * handling and trucking are added automatically from the price list and the customer; add anything else here (for example Diesel — Temporary Deduction).</p>
      </div>`);
    el.querySelectorAll('[data-p]').forEach((input) => input.addEventListener('input', () => { t[input.dataset.p] = input.value.trim(); bar.markDirty(); }));
    const autoEl = el.querySelector('[data-role="auto"]');
    const body = el.querySelector('tbody');
    function refresh(fromPricing) {
      const inv = L().invoiceMath({ transfer: t, mode: t.mode, priceItems: data.priceItems, company: App.Store.transferParties(draft, data).customer });
      const auto = inv.deductions.filter((d) => d.auto);
      autoEl.replaceChildren(h(auto.length
        ? `<ul class="auto-deds">${auto.map((d) => `<li>${esc(d.description)}: ${fmt(d.quantity)} × ${d.rate === null ? '<span class="flag-text">rate needed</span>' : L().rateText(d.rate)} = <strong>${L().money(d.amount)}</strong> <span class="muted">— ${esc(d.reason)}</span></li>`).join('')}</ul>`
        : '<p class="muted">No automatic deductions.</p>'));
      body.querySelectorAll('tr').forEach((tr, i) => {
        const d = t.deductions[i]; const r = L().parseMoney(d.rate);
        tr.querySelector('[data-role="amt"]').textContent = r === null ? '' : L().money(L().r2(L().num(d.quantity) * r));
      });
      if (!fromPricing) pricing.recalc();
    }
    poRefreshHook = () => refresh(true);
    function makeRow(d) {
      const tr = h(`<tr>
        <td><input data-d="quantity" type="text" inputmode="decimal" value="${esc(d.quantity)}" style="width:80px"></td>
        <td><input data-d="description" value="${esc(d.description)}"></td>
        <td><input data-d="reason" value="${esc(d.reason)}" style="min-width:220px"></td>
        <td><input data-d="rate" type="text" inputmode="decimal" value="${esc(d.rate)}" style="width:90px"></td>
        <td class="num" data-role="amt"></td>
        <td><button type="button" class="ghost" data-a="remove" title="Remove">✕</button></td></tr>`);
      tr.querySelectorAll('[data-d]').forEach((input) => input.addEventListener('input', () => { d[input.dataset.d] = input.value.trim(); bar.markDirty(); refresh(); }));
      tr.querySelector('[data-a="remove"]').addEventListener('click', () => { t.deductions.splice(t.deductions.indexOf(d), 1); tr.remove(); bar.markDirty(); refresh(); });
      return tr;
    }
    t.deductions.forEach((d) => body.append(makeRow(d)));
    el.querySelector('[data-a="add"]').addEventListener('click', () => {
      const d = { quantity: '1', description: '', reason: '', rate: '' };
      t.deductions.push(d);
      const tr = makeRow(d); body.append(tr);
      tr.querySelector('[data-d="description"]').focus();
      bar.markDirty(); refresh();
    });
    refresh();
    return { el, refresh };
  }

  // ---------------------------------------------------------------- transfer: what the 197 needs that the app can't work out
  function buildForm197(data, bar) {
    const { h, esc } = U();
    const t = draft.transfer;
    const g = t.form197 = t.form197 || {};
    const math = L().transferMath(t);
    const logsDefault = !!(t.timeline && t.timeline.sourceLogsReceived && t.timeline.sourceLogsReceived !== 'N/A');
    const logs = g.docsLogs !== undefined ? !!g.docsLogs : logsDefault;
    const el = h(`
      <div class="panel">
        <h2>CalRecycle 197</h2>
        <div class="field-row">
          <div class="field"><label>SA units — Non-CRT <span class="muted">(from 198SA, of the ${U().fmt(math.claimable.NonCRT.units)} CEW LCD/LED)</span></label><input data-g="saNonCrt" type="text" inputmode="numeric" value="${esc(g.saNonCrt)}" placeholder="0"></div>
          ${math.claimable.CBEP.units ? `<div class="field"><label>SA units — CBEP</label><input data-g="saCbep" type="text" inputmode="numeric" value="${esc(g.saCbep)}" placeholder="0"></div>` : ''}
          <div class="field"><label>Collector's printed name</label><input data-g="collectorPrinted" list="f197-names" value="${esc(g.collectorPrinted)}"></div>
          <div class="field"><label>Recycler's printed name</label><input data-g="recyclerPrinted" list="f197-names" value="${esc(g.recyclerPrinted)}"></div>
        </div>
        <datalist id="f197-names">${(data.profile.wcSigners || []).map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
        <div class="row">
          <label class="row"><input type="checkbox" data-c="docsLogs" ${logs ? 'checked' : ''}> Copies of collection logs / 198 / 198SA received</label>
          <label class="row"><input type="checkbox" data-c="docs184" ${g.docs184 ? 'checked' : ''}> Copies of proof of designations / 184s received</label>
        </div>
        <p class="hint">Everything else on the 197 comes from the WC: date, collector and recycler, CEW LCD/LED units and weight, collector activity, and the Recycler Tables when the claim is split.</p>
      </div>`);
    el.querySelectorAll('[data-g]').forEach((input) => input.addEventListener('input', () => { g[input.dataset.g] = input.value.trim(); bar.markDirty(); }));
    el.querySelectorAll('[data-c]').forEach((input) => input.addEventListener('change', () => { g[input.dataset.c] = input.checked; bar.markDirty(); }));
    // until it's set by hand, "logs received" follows the timeline's "Source logs received" step
    timelineHooks.push(() => {
      if (g.docsLogs !== undefined) return;
      const v = t.timeline && t.timeline.sourceLogsReceived;
      el.querySelector('[data-c="docsLogs"]').checked = !!(v && v !== 'N/A');
    });
    return el;
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

  // ---------------------------------------------------------------- inventory (grouped by material)
  function buildInventory(data, bar) {
    const { h, esc, fmt, options } = U();
    const inv = draft.inventory;
    const matById = new Map(data.materials.map((m) => [m.id, m]));
    const ids = [...(inv.materialOrder || [])];
    inv.lines.forEach((l) => { if (l.materialId != null && !ids.includes(l.materialId)) ids.push(l.materialId); });
    inv.materialOrder = ids;
    const addable = data.materials.filter((m) => m.category !== 'Not a CEW residual' && !ids.includes(m.id) && (!draft.noWc || !m.ownWc));
    const num = (f) => `<input data-f="${f}" type="text" inputmode="decimal" step="any" min="0">`;
    const el = h(`
      <div class="panel">
        <h2>Materials on hand</h2>
        <p class="muted mt-0">Type each weighing on the blank row under its material and press <strong>Enter</strong> — it's added and the cursor stays there for the next one.
          Type gross and tare, or just the net.${draft.noWc ? ' LCD lamps need their own WC, so they aren\u2019t listed on a general entry.' : ''}</p>
        <div data-role="rules"></div>
        <div data-role="summary"></div>
        <div class="inv-groups">${ids.map((id) => { const m = matById.get(id) || { name: '(deleted material)', category: '' }; return `
          <div class="inv-group" data-mat="${id}">
            <div class="row spread"><div><strong>${esc(m.name)}</strong> <span class="muted">${esc(m.category)}</span></div><div>Net: <strong data-role="subtotal"></strong></div></div>
            <table class="lines inv"><thead><tr><th class="num">Gross</th><th class="num">Tare</th><th class="num">Net</th><th></th></tr></thead>
              <tbody></tbody>
              <tfoot><tr class="quick"><td>${num('gross').replace('data-f', 'data-q')}</td><td>${num('tare').replace('data-f', 'data-q')}</td><td>${num('net').replace('data-f', 'data-q')}</td>
                <td><button type="button" data-a="quick-add">Add</button></td></tr></tfoot>
            </table>
          </div>`; }).join('')}</div>
        ${addable.length ? `<div class="field-row"><div class="field"><label>Add another material</label><select data-role="add-material">${options(addable.map((m) => ({ value: m.id, label: m.name })), '', '— pick —')}</select></div></div>` : ''}
      </div>`);

    const rulesEl = el.querySelector('[data-role="rules"]');
    const summaryEl = el.querySelector('[data-role="summary"]');
    function refresh() {
      const totals = L().netByMaterial(inv.lines);
      el.querySelectorAll('.inv-group').forEach((g) => { g.querySelector('[data-role="subtotal"]').textContent = `${fmt((totals.get(Number(g.dataset.mat)) || { net: 0 }).net)} lbs`; });
      const rows = ids.filter((id) => totals.has(id));
      const grand = rows.reduce((sum, id) => sum + totals.get(id).net, 0);
      summaryEl.replaceChildren(rows.length ? h(`<table class="inv-summary"><thead><tr><th>Material</th><th class="num">Weighings</th><th class="num">Net lbs</th></tr></thead><tbody>
          ${rows.map((id) => `<tr><td>${esc((matById.get(id) || {}).name || '?')}</td><td class="num">${totals.get(id).count}</td><td class="num">${fmt(totals.get(id).net)}</td></tr>`).join('')}
        </tbody><tfoot><tr><th>Total</th><th></th><th class="num">${fmt(grand)}</th></tr></tfoot></table>`) : h('<p class="muted">Nothing weighed yet.</p>'));
      rulesEl.replaceChildren(...L().inventoryRuleErrors({ wc: draft, materials: data.materials }).map((e) => U().notice(e, 'error')));
    }
    function makeRow(line) {
      const tr = h(`<tr><td>${num('gross')}</td><td>${num('tare')}</td><td>${num('net')}</td><td><button type="button" class="ghost" data-a="remove" title="Remove">✕</button></td></tr>`);
      ['gross', 'tare', 'net'].forEach((f) => { tr.querySelector(`[data-f="${f}"]`).value = line[f] ?? ''; });
      tr.querySelectorAll('[data-f]').forEach((input) => input.addEventListener('input', () => {
        line[input.dataset.f] = input.value;
        if ((input.dataset.f === 'gross' || input.dataset.f === 'tare') && line.gross !== '') {
          line.net = String(L().r2(L().num(line.gross) - L().num(line.tare)));
          tr.querySelector('[data-f="net"]').value = line.net;
        }
        bar.markDirty(); refresh();
      }));
      tr.querySelector('[data-a="remove"]').addEventListener('click', () => {
        inv.lines.splice(inv.lines.indexOf(line), 1);
        tr.remove(); bar.markDirty(); refresh();
      });
      return tr;
    }
    el.querySelectorAll('.inv-group').forEach((g) => {
      const matId = Number(g.dataset.mat);
      const body = g.querySelector('tbody');
      inv.lines.filter((l) => l.materialId === matId).forEach((l) => body.append(makeRow(l)));
      const q = (f) => g.querySelector(`[data-q="${f}"]`);
      const add = () => {
        const gross = q('gross').value.trim(); const tare = q('tare').value.trim(); let net = q('net').value.trim();
        if (!gross && !net) { q('gross').focus(); return; }
        if (gross) net = String(L().r2(L().num(gross) - L().num(tare)));
        const line = { materialId: matId, gross, tare, net };
        inv.lines.push(line);
        body.append(makeRow(line));
        ['gross', 'tare', 'net'].forEach((f) => { q(f).value = ''; });
        q('gross').focus();
        bar.markDirty(); refresh();
      };
      g.querySelector('[data-a="quick-add"]').addEventListener('click', add);
      g.querySelectorAll('[data-q]').forEach((input) => input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }));
    });
    const addMat = el.querySelector('[data-role="add-material"]');
    if (addMat) addMat.addEventListener('change', async () => {
      if (!addMat.value) return;
      const id = Number(addMat.value);
      inv.materialOrder.push(id);
      dirty = true;
      await App.rerender();
      const input = document.querySelector(`.inv-group[data-mat="${id}"] [data-q="gross"]`);
      if (input) input.focus();
    });
    refresh();
    return el;
  }

  // ---------------------------------------------------------------- shipment lines
  function buildShipment(data, bar, onChange) {
    const { h, esc, fmt, options } = U();
    const lines = draft.shipment.lines;
    const descs = data.shipDescriptions.filter((d) => !d.vendorId || d.vendorId === draft.companyId);
    const find = (name) => {
      const k = L().norm(name);
      return descs.find((d) => d.vendorId && L().norm(d.name) === k) || descs.find((d) => L().norm(d.name) === k);
    };
    const matOpts = (sel) => options(data.materials.map((m) => ({ value: m.id, label: m.name })), sel, '— none —');
    const el = h(`
      <div class="panel">
        <div class="row spread"><h2>Materials shipped</h2>
          <label class="row">First column on the WC: <select data-role="countLabel">${options([{ value: 'units', label: 'Units' }, { value: 'skids', label: 'Skids' }], draft.shipment.countLabel || 'units')}</select></label></div>
        <p class="muted mt-0">Use the vendor's description. Picking one from the list fills in whether it's CEW and which residual it counts as; a new description is added to the
          <a href="#/descriptions">vendor description list</a> when you save. Only lines marked CEW count toward residuals.</p>
        <div class="table-scroll"><table class="lines ship">
          <thead><tr><th class="num" data-role="countHead">${draft.shipment.countLabel === 'skids' ? 'Skids' : 'Units'}</th><th>Description</th><th>CEW?</th><th>Counts as residual</th><th class="num">Gross</th><th class="num">Tare</th><th class="num">Net</th><th></th></tr></thead>
          <tbody></tbody>
          <tfoot><tr><th colspan="6">Total net <span class="muted" data-role="split"></span></th><th class="num" data-role="total"></th><th></th></tr></tfoot>
        </table></div>
        <datalist id="ship-descs">${descs.map((d) => `<option value="${esc(d.name)}">`).join('')}</datalist>
        <button type="button" data-a="add">+ Add line</button>
      </div>`);
    const body = el.querySelector('tbody');
    el.querySelector('[data-role="countLabel"]').addEventListener('change', (e) => {
      draft.shipment.countLabel = e.target.value;
      el.querySelector('[data-role="countHead"]').textContent = e.target.value === 'skids' ? 'Skids' : 'Units';
      bar.markDirty();
    });
    const totalEl = el.querySelector('[data-role="total"]'); const splitEl = el.querySelector('[data-role="split"]');
    const refresh = () => {
      const cew = lines.filter((l) => l.cew !== false).reduce((s2, l) => s2 + L().lineNet(l), 0);
      const non = lines.filter((l) => l.cew === false).reduce((s2, l) => s2 + L().lineNet(l), 0);
      totalEl.textContent = fmt(cew + non);
      splitEl.textContent = non ? `— CEW ${fmt(cew)} · non-CEW ${fmt(non)} (not counted as residuals)` : '';
      if (onChange) onChange();
    };
    function makeRow(line) {
      if (line.cew === undefined) line.cew = true;
      const tr = h(`<tr>
        <td><input data-f="count" type="text" inputmode="numeric" placeholder="Wt. Only" style="width:80px"></td>
        <td><input data-f="description" list="ship-descs" style="min-width:200px" placeholder="vendor's description"></td>
        <td><label class="row"><input type="checkbox" data-f="cew"> CEW</label></td>
        <td><select data-f="materialId">${matOpts(line.materialId)}</select></td>
        <td><input data-f="gross" type="text" inputmode="decimal" step="any" min="0"></td><td><input data-f="tare" type="text" inputmode="decimal" step="any" min="0"></td><td><input data-f="net" type="text" inputmode="decimal" step="any" min="0"></td>
        <td><button type="button" class="ghost" data-a="remove" title="Remove">✕</button></td></tr>`);
      const $ = (f) => tr.querySelector(`[data-f="${f}"]`);
      $('description').value = line.description || '';
      $('cew').checked = line.cew !== false;
      ['gross', 'tare', 'net', 'count'].forEach((f) => { $(f).value = line[f] ?? ''; });
      $('count').addEventListener('input', () => { line.count = $('count').value.trim(); bar.markDirty(); });
      $('description').addEventListener('input', () => {
        line.description = $('description').value;
        const d = find(line.description);
        if (d) { line.cew = d.cew !== false; line.materialId = d.materialId ?? null; $('cew').checked = line.cew; $('materialId').value = line.materialId ?? ''; }
        bar.markDirty(); refresh();
      });
      $('cew').addEventListener('change', () => { line.cew = $('cew').checked; bar.markDirty(); refresh(); });
      $('materialId').addEventListener('change', () => { line.materialId = $('materialId').value ? Number($('materialId').value) : null; bar.markDirty(); refresh(); });
      ['gross', 'tare', 'net'].forEach((f) => $(f).addEventListener('input', () => {
        line[f] = $(f).value;
        if ((f === 'gross' || f === 'tare') && line.gross !== '') { line.net = String(L().r2(L().num(line.gross) - L().num(line.tare))); $('net').value = line.net; }
        bar.markDirty(); refresh();
      }));
      tr.querySelector('[data-a="remove"]').addEventListener('click', () => { lines.splice(lines.indexOf(line), 1); tr.remove(); bar.markDirty(); refresh(); });
      return tr;
    }
    lines.forEach((l) => body.append(makeRow(l)));
    el.querySelector('[data-a="add"]').addEventListener('click', () => {
      const line = { description: '', cew: true, materialId: null, gross: '', tare: '', net: '' };
      lines.push(line);
      const tr = makeRow(line);
      body.append(tr);
      tr.querySelector('[data-f="description"]').focus();
      bar.markDirty();
    });
    refresh();
    return el;
  }

  // ---------------------------------------------------------------- outgoing: paid / charged
  function buildSettlement(holder, bar) {
    const { h, esc, options } = U();
    const st = holder.settlement = holder.settlement || { type: '', amount: '', reference: '', date: '' };
    const el = h(`
      <div class="panel">
        <h2>Paid or charged</h2>
        <div class="field-row">
          <div class="field"><label>For this shipment</label><select data-s="type">${options(L().SETTLEMENTS.map(([value, label]) => ({ value, label })), st.type)}</select></div>
          <div class="field"><label>Amount $</label><input data-s="amount" type="text" inputmode="decimal" value="${esc(st.amount)}"></div>
          <div class="field"><label>Invoice / check #</label><input data-s="reference" value="${esc(st.reference)}"></div>
          <div class="field"><label>Date paid / billed</label><input data-s="date" type="date" value="${esc(st.date)}"></div>
        </div>
        <p class="hint">Vendors usually pay us for residuals; we're usually charged when CRTs, plasmas or LCD lamps go out.</p>
      </div>`);
    el.querySelectorAll('[data-s]').forEach((input) => input.addEventListener('input', () => { st[input.dataset.s] = input.value.trim(); bar.markDirty(); }));
    return el;
  }

  // ---------------------------------------------------------------- outgoing: dropped off / picked up + vehicle
  function buildTrip(data, bar, holder) {
    const { h, esc, options } = U();
    const company = () => data.companies.find((c) => c.id === draft.companyId) || null;
    const choices = () => App.Store.plateChoices({ direction: 'out', mode: holder.mode, company: company(), profile: data.profile });
    const ch = choices();
    const el = h(`
      <div class="panel">
        <h2>Trip</h2>
        <div class="field-row">
          <div class="field"><label>Material was</label><select data-t="mode">${options([{ value: 'dropoff', label: 'Dropped off — we delivered' }, { value: 'pickup', label: 'Picked up — the vendor collected' }], holder.mode, '— choose —')}</select></div>
          <div class="field"><label>License plate <span class="muted" data-role="whose">(${esc(ch.whose)})</span></label><input data-t="licensePlate" list="trip-plates" value="${esc(holder.licensePlate)}"></div>
          ${draft.kind === 'shipment' ? `<div class="field"><label>WC signer <span class="muted">(scale person)</span></label><select data-t="scalePerson">${signerOptions(data, holder.scalePerson)}</select></div>` : ''}
        </div>
        <datalist id="trip-plates">${ch.plates.map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
      </div>`);
    el.querySelector('[data-t="mode"]').addEventListener('change', (e) => {
      holder.mode = e.target.value;
      if (holder.plateAuto || App.Store.isKnownPlate(holder.licensePlate, company(), data.profile)) { holder.licensePlate = choices().plates[0] || ''; holder.plateAuto = true; }
      dirty = true; App.rerender();
    });
    el.querySelector('[data-t="licensePlate"]').addEventListener('input', (e) => { holder.licensePlate = e.target.value.trim().toUpperCase(); holder.plateAuto = false; bar.markDirty(); });
    const sp = el.querySelector('[data-t="scalePerson"]');
    if (sp) sp.addEventListener('input', (e) => { holder.scalePerson = e.target.value.trim(); bar.markDirty(); });
    return el;
  }

  // ---------------------------------------------------------------- residual shipment: storage note
  function buildStorageNote(data, saved) {
    const { h, esc } = U();
    const el = h(`
      <div class="panel">
        <div class="row spread"><h2>Note for the weight certificate</h2>
          <a class="button" href="#/doc/${saved.id}/wc">Print weight certificate</a></div>
        <div data-role="notes"></div>
        <p class="hint">Oldest storage ships first: each material comes out of the earliest month's end-of-month storage before this month's generation. Only CEW lines count.</p>
      </div>`);
    const body = el.querySelector('[data-role="notes"]');
    function refresh() {
      const wcs = data.wcs.map((w) => (w.id === draftId ? draft : w));
      const list = L().residualFifo({ materials: data.materials, wcs }).notes.get(draftId) || [];
      body.replaceChildren(list.length ? h(`<ul class="storage-notes">${list.map((n) => `<li>${esc(L().storageNoteText(n))}</li>`).join('')}</ul>`)
        : h('<p class="muted">No CEW residual lines with a residual material yet.</p>'));
    }
    dateHooks.push(refresh);
    refresh();
    return { el, refresh };
  }

  // ---------------------------------------------------------------- CRT/plasma shipment (no WC)
  function buildCrtPlasma(data, bar) {
    const { h, esc, fmt, options } = U();
    const holder = draft.crtShipment;
    holder.lines = holder.lines || [];
    const ledger = L().crtPlasmaLedger(data.wcs, { excludeWcId: draftId }).rows;
    const byKey = new Map(ledger.map((r) => [r.key, r]));
    const catName = (c) => (c === 'crt' ? 'CRT' : 'Plasma');
    const label = (r) => `WC #${r.wc.wcNumber}${r.wc.transfer.irrNumber ? ` / IRR ${r.wc.transfer.irrNumber}` : ''} · rec'd ${L().shortDate(r.wc.date)} · ${catName(r.category)} — ${r.onHand.units} of ${r.received.units} left`;
    const eligible = (r) => !draft.date || !r.wc.date || r.wc.date <= draft.date;
    const optsFor = (sel) => options(ledger.filter((r) => (r.onHand.units > 0 && eligible(r)) || r.key === sel).map((r) => ({ value: r.key, label: label(r) })), sel,
      ledger.length ? '— pick the transfer they came from —' : '(no transfers with CRTs or plasmas)');
    const el = h(`
      <div class="panel">
        <h2>CRTs and plasmas on this shipment</h2>
        <p class="muted mt-0">Only transfers received on or before this shipment's date are listed. If the recycler later decides some units aren't CEW, record them under "Rejected as non-CEW" — they still count as shipped from that transfer.</p>
        <div class="table-scroll"><table class="lines crtp">
          <thead><tr><th>From transfer</th><th class="num">Units</th><th class="num">Lbs</th><th class="num">Rejected as non-CEW</th><th>Reason / recycler's note</th><th></th></tr></thead>
          <tbody></tbody>
          <tfoot><tr><th>Total</th><th class="num" data-role="tu"></th><th class="num" data-role="tw"></th><th class="num" data-role="tr"></th><th></th><th></th></tr></tfoot>
        </table></div>
        <button type="button" data-a="add">+ Add CRTs or plasmas from a transfer</button>
        <div data-role="errors"></div>
      </div>`);
    const body = el.querySelector('tbody');
    const errEl = el.querySelector('[data-role="errors"]');
    const started = () => holder.lines.filter((l) => l.wcId || l.units || l.weight);
    function refresh() {
      const sum = (f) => fmt(holder.lines.reduce((a, l) => a + L().num(l[f]), 0));
      el.querySelector('[data-role="tu"]').textContent = sum('units');
      el.querySelector('[data-role="tw"]').textContent = sum('weight');
      el.querySelector('[data-role="tr"]').textContent = sum('rejectedUnits');
      const lines = started();
      const errors = lines.length ? L().crtPlasmaErrors({ shipment: { ...draft, crtShipment: { ...holder, lines } }, wcs: data.wcs }) : [];
      const warns = [];
      const w = new Map();
      lines.forEach((l) => { const k = `${l.wcId}:${l.category}`; w.set(k, (w.get(k) || 0) + L().num(l.weight)); });
      w.forEach((lbs, k) => { const r = byKey.get(k); if (r && lbs > r.onHand.weight + 0.005) warns.push(`WC #${r.wc.wcNumber}: ${fmt(lbs)} lbs going out vs ${fmt(r.onHand.weight)} lbs of ${catName(r.category).toLowerCase()} left from the IRR — a scale difference?`); });
      errEl.replaceChildren(...errors.map((e) => U().notice(e, 'error')), ...warns.map((x) => U().notice(x, 'warning')));
    }
    dateHooks.push(refresh);
    function makeRow(line) {
      const key = line.wcId ? `${line.wcId}:${line.category}` : '';
      const tr = h(`<tr><td><select data-f="src" style="min-width:320px">${optsFor(key)}</select></td>
        <td><input data-f="units" type="text" inputmode="numeric" value="${esc(line.units)}"></td>
        <td><input data-f="weight" type="text" inputmode="decimal" value="${esc(line.weight)}"></td>
        <td><input data-f="rejectedUnits" type="text" inputmode="numeric" value="${esc(line.rejectedUnits)}" placeholder="0"></td>
        <td><input data-f="rejectedNote" value="${esc(line.rejectedNote)}" placeholder="e.g. no source log, not CA-sourced"></td>
        <td><button type="button" class="ghost" data-a="remove" title="Remove">✕</button></td></tr>`);
      const $ = (f) => tr.querySelector(`[data-f="${f}"]`);
      $('src').addEventListener('change', () => {
        const [id, cat] = $('src').value.split(':');
        line.wcId = id ? Number(id) : null; line.category = cat || null;
        const r = byKey.get($('src').value);
        if (r && !line.units && !line.weight) {
          const already = holder.lines.filter((x) => x !== line && `${x.wcId}:${x.category}` === r.key).reduce((a, x) => a + L().num(x.units), 0);
          const left = r.onHand.units - already;
          if (left > 0) { line.units = String(left); line.weight = left === r.onHand.units ? String(r.onHand.weight) : ''; $('units').value = line.units; $('weight').value = line.weight; }
        }
        bar.markDirty(); refresh();
      });
      ['units', 'weight', 'rejectedUnits', 'rejectedNote'].forEach((f) => $(f).addEventListener('input', () => { line[f] = $(f).value.trim(); bar.markDirty(); refresh(); }));
      tr.querySelector('[data-a="remove"]').addEventListener('click', () => { holder.lines.splice(holder.lines.indexOf(line), 1); tr.remove(); bar.markDirty(); refresh(); });
      return tr;
    }
    holder.lines.forEach((l) => body.append(makeRow(l)));
    el.querySelector('[data-a="add"]').addEventListener('click', () => {
      const line = { wcId: null, category: null, units: '', weight: '', rejectedUnits: '', rejectedNote: '' };
      holder.lines.push(line);
      const tr = makeRow(line);
      body.append(tr);
      tr.querySelector('[data-f="src"]').focus();
      bar.markDirty(); refresh();
    });
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
      poRefreshHook = null;
      timelineHooks = [];
      const type = data.wcTypes.find((t) => t.id === saved.typeId);
      const allocs = data.allocations.filter((a) => a.wcId === id);
      const back = { transfer: ' · <a href="#/transfers">Transfers</a>', shipment: ' · <a href="#/residuals">Residuals</a>', inventory: ' · <a href="#/residuals">Residuals</a>' }[saved.kind] || '';

      const general = saved.kind === 'inventory' && saved.noWc;
      const isCrt = saved.kind === 'crtShipment';
      container.append(U().h(`<p class="crumbs">${isCrt ? '<a href="#/crtplasma">← CRT &amp; Plasma</a>' : general ? '<a href="#/residuals">← Residuals</a>' : `<a href="#/wcs">← All weight certificates</a>${back}`}</p>`));
      const forMonth = saved.inventory ? L().inventoryMonthKey(saved).split('-').map(Number) : null;
      const recycler = isCrt ? (data.companies.find((c) => c.id === saved.companyId) || {}).name : '';
      if (isCrt) container.append(U().header('CRT / plasma shipment', U().esc([recycler || 'no recycler chosen', saved.date ? L().shortDate(saved.date) : ''].filter(Boolean).join(' · '))));
      else container.append(general
        ? U().header('Inventory entry (no WC)', `End-of-month inventory · ${U().esc(forMonth && forMonth[0] ? L().monthLabel(forMonth[0], forMonth[1]) : '')}`)
        : U().header(`WC #${saved.wcNumber}`, U().esc(type ? type.name : 'Weight certificate')));
      if (flash) { container.append(U().notice(flash.text, flash.kind)); flash = null; }
      const bar = buildSaveBar(saved, data);
      container.append(bar.el, buildCommon(saved, data, bar));
      if (saved.kind === 'transfer') {
        const pricing = buildPricing(data, bar);
        const po = buildPurchaseInvoice(data, bar, pricing);
        const onLines = () => { pricing.rebuild(); po.refresh(); };
        container.append(buildParties(data, bar), buildLines(data, bar, onLines), pricing.el, po.el, buildTimeline(bar), buildAllocations(saved, data, allocs), buildForm197(data, bar), buildDocuments(saved, data));
      } else if (saved.kind === 'inventory') {
        container.append(buildInventory(data, bar));
      } else if (saved.kind === 'shipment') {
        const note = buildStorageNote(data, saved);
        container.append(buildTrip(data, bar, draft.shipment), buildShipment(data, bar, note.refresh), note.el, buildSettlement(draft.shipment, bar));
      } else if (saved.kind === 'crtShipment') {
        container.append(buildTrip(data, bar, draft.crtShipment), buildCrtPlasma(data, bar), buildSettlement(draft.crtShipment, bar));
      }
      const docs = document.createElement('div');
      container.append(docs);
      await App.Attachments.renderSection(docs, { linkedEntityType: 'wc', linkedEntityId: id });
    },
    /** Called by other pages before navigating to a freshly created WC. */
    reset() { draftId = null; },
  };
})();
