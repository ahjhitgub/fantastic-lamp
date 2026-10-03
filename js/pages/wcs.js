window.App = window.App || {};
App.Pages = App.Pages || {};

/** Every weight certificate, of every type. */
App.Pages.wcs = (function () {
  const filters = { typeId: '', statusId: '', q: '', check: false };
  let logText = '';      // what was pasted into "Paste your WC log"
  let preview = null;    // parsed rows waiting for Import
  let logMsg = null;

  /** Paste-in for the office WC log: preview first, then import. */
  function buildLogImport(data) {
    const { h, esc } = App.UI;
    const L = App.Logic;
    const el = h(`
      <details class="panel" ${preview || logMsg ? 'open' : ''}>
        <summary><strong>Paste your WC log</strong></summary>
        <p class="muted">Copy the rows from the WC log spreadsheet — header row included — and paste them here. Columns: WC, Type, Company, Date, IRR, Status, Paid,
          Payment Due Date, Packet Month, Lot Canceled, Notes. You'll see a preview before anything is saved.</p>
        <div class="field"><textarea data-role="text" rows="6" placeholder="WC&#9;TYPE&#9;COMPANY&#9;DATE&#9;IRR&#9;STATUS&#9;…">${esc(logText)}</textarea></div>
        <div class="row"><button type="button" data-a="preview">Preview</button>${preview ? '<button type="button" data-a="clear">Clear</button>' : ''}</div>
        <div data-role="out"></div>
      </details>`);
    const out = el.querySelector('[data-role="out"]');
    if (logMsg) { out.append(App.UI.notice(logMsg.text, logMsg.kind)); logMsg = null; }
    el.querySelector('[data-a="preview"]').addEventListener('click', () => {
      logText = el.querySelector('[data-role="text"]').value;
      const parsed = L.parseWcLog(logText);
      preview = parsed.rows.length ? parsed : null;
      if (!preview) logMsg = { kind: 'error', text: 'Nothing to import — include the header row and at least one WC.' };
      App.rerender();
    });
    const clear = el.querySelector('[data-a="clear"]');
    if (clear) clear.addEventListener('click', () => { preview = null; logText = ''; App.rerender(); });
    if (!preview) return el;

    const rows = preview.rows;
    const existing = new Set(data.wcs.map((w) => L.normLot(w.wcNumber)));
    const groups = L.groupCompanyNames(rows.map((r) => ({ name: r.companyName, note: r.companyNote })), data.companies);
    const newCompanies = [...new Map([...groups.values()].filter((g) => !g.companyId).map((g) => [g.group, g])).values()];
    const kindLabel = { transfer: 'Transfer', shipment: 'Residual shipment', void: 'Void', unknown: 'Needs a type' };
    const count = (k) => rows.filter((r) => r.kind === k).length;
    const already = rows.filter((r) => existing.has(L.normLot(r.wcNumber))).length;
    const flags = (r) => [
      existing.has(L.normLot(r.wcNumber)) && '<span class="badge">already in the app</span>',
      r.unsure && '<span class="badge warn">check type</span>',
      r.maybeTransfer && '<span class="badge warn">transfer?</span>',
      r.dateFixed && `<span class="badge warn">date "${esc(r.dateText)}"</span>`,
      r.selfCollected && '<span class="badge">our own collection</span>',
    ].filter(Boolean).join(' ');
    const coCell = (r) => {
      if (r.selfCollected) return '<span class="muted">— dual entity —</span>';
      const g = groups.get(r.companyName);
      if (!g) return '<span class="muted">—</span>';
      return `${esc(g.display)}${g.companyId ? '' : ' <span class="badge ok">new</span>'}${r.companyNote ? ` <span class="muted">(${esc(r.companyNote)})</span>` : ''}`;
    };
    const box = h(`
      <div>
        <p><strong>${rows.length} WCs:</strong> ${count('transfer')} transfers, ${count('shipment')} residual shipments${count('void') ? `, ${count('void')} void` : ''}${count('unknown') ? `, ${count('unknown')} need a type` : ''}.
          ${already ? `${already} are already in the app.` : ''} ${newCompanies.length ? `${newCompanies.length} new companies will be added.` : ''}</p>
        ${preview.skipped.length ? `<p class="muted">Skipped ${preview.skipped.length} row(s) without a WC #.</p>` : ''}
        <div class="table-scroll preview-table"><table data-list="wc-import-preview">
          <thead><tr><th>WC #</th><th>Log type</th><th>Will be</th><th>Company</th><th>Date</th><th>IRR #</th><th>Status</th><th>Payment</th><th>Packet</th><th>Flags</th></tr></thead>
          <tbody>${rows.map((r) => `<tr>
            <td><strong>${esc(r.wcNumber)}</strong></td><td class="muted">${esc(r.typeText)}</td><td>${kindLabel[r.kind]}${r.cbepOnly ? ' (CBEP only)' : r.cbep ? ' + CBEP' : ''}${r.nonCew ? ' (non-CEW)' : ''}</td>
            <td>${coCell(r)}</td><td>${r.date ? esc(L.shortDate(r.date)) : '<span class="flag-text">?</span>'}</td><td>${esc(r.irrNumber)}</td><td>${esc(r.status)}</td>
            <td>${r.paid ? 'Paid' : r.poSent ? `PO sent ${esc(L.shortDate(r.poSent))}` : r.dueDate ? `Due ${esc(L.shortDate(r.dueDate))}` : ''}${r.dueNote ? ` <span class="muted">${esc(r.dueNote)}</span>` : ''}</td>
            <td>${r.packetMonth ? esc(L.monthLabel(+r.packetMonth.slice(0, 4), +r.packetMonth.slice(5))) : ''}</td><td>${flags(r)}</td></tr>`).join('')}</tbody>
        </table></div>
        ${newCompanies.length ? `<p class="hint">New companies: ${newCompanies.map((g) => `<strong>${esc(g.display)}</strong>${g.spellings.length > 1 ? ` <span class="muted">(also written ${g.spellings.filter((x) => x !== g.display).map(esc).join(', ')})</span>` : ''}`).join(' · ')}.
          Transfers make a company a handler, shipments make it a vendor — check them on the <a href="#/companies">Companies</a> page.</p>` : ''}
        <div class="row">
          ${already ? '<label class="row"><input type="checkbox" data-f="update"> Also update the WCs already in the app (status, payment, packet month, lot cancelled; their lines and weights are left alone)</label>' : ''}
          <span class="spacer"></span>
          <button type="button" class="primary" data-a="import">Import ${rows.length - (already ? already : 0) || rows.length} WCs</button>
        </div>
      </div>`);
    const upd = box.querySelector('[data-f="update"]');
    const btn = box.querySelector('[data-a="import"]');
    if (upd) upd.addEventListener('change', () => { btn.textContent = `Import ${upd.checked ? rows.length : rows.length - already} WCs`; });
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const res = await App.Store.importWcLog(rows, { updateExisting: !!(upd && upd.checked) });
        const parts = [`Imported ${res.created} WC(s)`, res.updated ? `updated ${res.updated}` : '', res.skipped.length ? `skipped ${res.skipped.length} already in the app` : '',
          res.companiesCreated.length ? `added ${res.companiesCreated.length} companies` : '', res.statusesCreated.length ? `added statuses ${res.statusesCreated.join(', ')}` : '',
          res.irrConflicts.length ? `left out IRR #s already used (${res.irrConflicts.join('; ')})` : ''].filter(Boolean);
        logMsg = { kind: 'ok', text: `${parts.join(', ')}.` };
        preview = null; logText = '';
        App.Pages.wc.reset();
      } catch (err) { logMsg = { kind: 'error', text: `Import stopped: ${App.UI.errText(err)}` }; }
      App.rerender();
    });
    out.append(box);
    return el;
  }

  function summary(wc, data) {
    const L = App.Logic; const { fmt } = App.UI;
    if (wc.kind === 'transfer') {
      const m = L.transferMath(wc.transfer);
      const parts = [];
      if (m.claimable.NonCRT.units) parts.push(`CEW LCD/LED ${fmt(m.claimable.NonCRT.units)} / ${fmt(m.claimable.NonCRT.weight)} lbs`);
      if (m.claimable.CBEP.units) parts.push(`CBEP ${fmt(m.claimable.CBEP.units)} / ${fmt(m.claimable.CBEP.weight)} lbs`);
      if (!parts.length && (m.irr.units || m.irr.weight)) parts.push(`IRR ${fmt(m.irr.units)} units / ${fmt(m.irr.weight)} lbs`);
      return parts.join(' · ');
    }
    const lines = (wc.shipment || wc.inventory || {}).lines || [];
    const used = lines.filter((l) => L.lineNet(l));
    const total = used.reduce((s, l) => s + L.lineNet(l), 0);
    if (wc.kind === 'inventory') {
      const [y, mo] = L.inventoryMonthKey(wc).split('-').map(Number);
      return `End of ${y ? L.monthLabel(y, mo) : '?'} · ${fmt(total)} lbs on hand`;
    }
    if (wc.kind === 'shipment') {
      const names = used.map((l) => l.description || (data.materials.find((m) => m.id === l.materialId) || {}).name).filter(Boolean);
      const cp = (wc.shipment.crtPlasma || []).reduce((a, l) => a + L.num(l.units), 0);
      if (!total && !cp) return '';
      return `${fmt(total)} lbs${names.length ? ` — ${names.join(', ')}` : ''}${cp ? ` · ${fmt(cp)} CRT/plasma units` : ''}`;
    }
    return '';
  }

  const logChecks = (wc) => App.Logic.wcLogChecks(wc);

  /** Paid / payment due / PO sent for transfers; paid or charged for shipments. */
  function paymentCell(wc, today) {
    const L = App.Logic; const { esc } = App.UI;
    if (wc.kind === 'transfer') {
      const t = wc.transfer || {}; const pay = t.payment || {};
      const po = t.timeline && t.timeline.poSent;
      if (pay.paid) return '<span class="badge ok">Paid</span>';
      if (pay.dueDate) return `<span class="${pay.dueDate < today ? 'flag-text' : ''}" title="${pay.dueDate < today ? 'Past due' : ''}">Due ${esc(L.shortDate(pay.dueDate))}</span>`;
      if (po && po !== 'N/A') return `PO sent ${esc(L.shortDate(po))}`;
      return '<span class="muted">—</span>';
    }
    const st = L.settlementText((wc.shipment || wc.crtShipment || {}).settlement);
    return st ? esc(st) : '<span class="muted">—</span>';
  }

  return {
    async render(container) {
      const L = App.Logic;
      const { h, esc, options, header } = App.UI;
      const data = await App.Store.loadAll();
      const docs = await App.DB.getAll('attachments');
      const docCount = new Map();
      docs.filter((d) => d.linkedEntityType === 'wc').forEach((d) => docCount.set(d.linkedEntityId, (docCount.get(d.linkedEntityId) || 0) + 1));
      const typeName = (id) => (data.wcTypes.find((t) => t.id === id) || {}).name || '—';
      const compName = (id) => (data.companies.find((c) => c.id === id) || {}).name || '—';
      const today = App.UI.today();
      const shortType = (w) => (w.kind === 'transfer' ? `Transfer · ${App.Logic.transferTypeDisplay(w.transfer)}` : w.kind === 'shipment' ? `Shipment · ${App.Logic.shipmentTypeDisplay((w.shipment && w.shipment.shipmentType) || 'cew')}` : { inventory: 'Inventory', generation: 'CBEP generated' }[w.kind] || typeName(w.typeId));

      container.append(header('Weight Certificates', 'Every WC — transfers, residual shipments, inventory checks, and any other type you add in Settings.'));
      const gap = App.UI.gapAlert('wc', App.Logic.wcNumberGaps(data.wcs, data.skipped.wc));
      if (gap) container.append(gap);

      const form = h(`
        <form class="panel">
          <h2>New WC</h2>
          <div class="field-row">
            <div class="field"><label>WC #</label><input name="wcNumber" required value="${esc(App.Logic.nextWcNumber(data.wcs))}"></div>
            <div class="field"><label>Type</label><select name="typeId">${options(data.wcTypes.map((t) => ({ value: t.id, label: t.name })), '')}</select></div>
            <div class="field" style="flex:2"><label data-role="party-label"></label><select name="party"></select></div>
            <div class="field"><label>Date</label><input type="date" name="date" value="${App.UI.today()}"></div>
            <div class="field"><label>&nbsp;</label><button type="submit" class="primary">Create and open</button></div>
          </div>
          <div data-role="err"></div>
        </form>`);
      const typeSel = form.querySelector('[name="typeId"]');
      const syncParty = () => {
        const kind = (data.wcTypes.find((t) => t.id === Number(typeSel.value)) || {}).kind || 'generic';
        form.querySelector('[data-role="party-label"]').textContent = App.Store.partyLabel(kind);
        form.querySelector('[name="party"]').innerHTML = App.Store.partyOptions(kind, data.companies, '');
        form.querySelector('[name="party"]').closest('.field').hidden = kind === 'inventory'; // inventory is always ours
      };
      typeSel.addEventListener('change', syncParty);
      syncParty();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        try {
          const id = await App.Store.createWC({ wcNumber: fd.get('wcNumber'), typeId: Number(fd.get('typeId')), date: fd.get('date'), party: fd.get('party') });
          App.Pages.wc.reset();
          App.UI.go(`#/wc/${id}`);
        } catch (err) { form.querySelector('[data-role="err"]').replaceChildren(App.UI.notice(App.UI.errText(err), 'error')); }
      });
      container.append(form, buildLogImport(data));

      const filterEl = h(`
        <div class="panel filters">
          <div class="field-row">
            <div class="field"><label>Type</label><select data-f="typeId">${options(data.wcTypes.map((t) => ({ value: t.id, label: t.name })), filters.typeId, 'All types')}</select></div>
            <div class="field"><label>Status</label><select data-f="statusId">${options([{ value: 'none', label: '(no status)' }].concat(data.wcStatuses.map((s) => ({ value: s.id, label: s.name }))), filters.statusId, 'All statuses')}</select></div>
            <div class="field" style="flex:2"><label>Search WC #, company or notes</label><input data-f="q" value="${esc(filters.q)}"></div>
            <div class="field"><label>&nbsp;</label><label class="row"><input type="checkbox" data-f="check" ${filters.check ? 'checked' : ''}> Only WCs to check</label></div>
          </div>
        </div>`);
      filterEl.querySelectorAll('[data-f]').forEach((i) => i.addEventListener(i.tagName === 'INPUT' ? 'change' : 'input', () => { filters[i.dataset.f] = i.type === 'checkbox' ? i.checked : i.value; App.rerender(); }));
      container.append(filterEl);

      const q = App.Logic.norm(filters.q);
      const period = App.Store.currentPeriod(data);
      if (period) container.append(App.UI.notice(`Showing WCs that belong to <strong>${App.UI.esc(App.Models.formatPeriodLabel(period))}</strong>: its transfers (not already fully claimed), its program's residual shipments that month, and that month's storage and CBEP generation WCs — nothing dated after ${App.UI.esc(L.shortDate(L.periodEnd(period)))} except those. Pick <strong>All — no claim period</strong> to see every WC.`, 'info'));
      const list = data.wcs.filter((w) => !w.noWc && App.Store.inScope(w, data) && (!filters.typeId || w.typeId === Number(filters.typeId))
        && (!filters.statusId || (filters.statusId === 'none' ? !w.statusId : w.statusId === Number(filters.statusId)))
        && (!filters.check || logChecks(w).length)
        && (!q || App.Logic.norm(w.wcNumber).includes(q) || App.Logic.norm(compName(w.companyId)).includes(q) || App.Logic.norm(w.notes).includes(q)))
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.wcNumber).localeCompare(String(a.wcNumber), 'en', { numeric: true }));

      if (!list.length) { container.append(App.UI.empty(data.wcs.some((w) => !w.noWc) ? 'No WCs match these filters' : 'No weight certificates yet', data.wcs.length ? '' : 'Create one above.')); return; }

      const statusOpts = (sel) => options(data.wcStatuses.map((s) => ({ value: s.id, label: s.name })), sel, '(no status)');
      const table = h(`
        <div class="panel"><div class="table-scroll"><table class="dense" data-list="wcs">
          <thead><tr><th>WC #</th><th>Type</th><th>Date</th><th>Company</th><th>Status</th><th>Paid / due</th><th>Packet</th><th>Lot</th><th>Notes / weights</th><th class="num">Docs</th></tr></thead>
          <tbody>${list.map((w) => `
            <tr data-id="${w.id}">
              <td><a href="#/wc/${w.id}"><strong>${esc(w.wcNumber)}</strong></a></td>
              <td data-value="${esc(shortType(w))}">${esc(shortType(w))}${logChecks(w).map((c) => `<span class="stack-badge"><span class="badge warn">${esc(c)}</span></span>`).join('')}</td>
              <td>${esc(App.Logic.shortDate(w.date))}</td>
              <td class="wrap-sm">${w.kind === 'inventory' ? 'Ours' : w.transfer && w.transfer.selfCollected ? 'Us <span class="muted">(own collection)</span>' : esc(compName(w.companyId))}</td>
              <td>${data.wcStatuses.length ? `<select data-role="status">${statusOpts(w.statusId)}</select>` : '<span class="muted">—</span>'}</td>
              <td>${paymentCell(w, today)}</td>
              <td>${w.transfer && w.transfer.packetMonth ? esc(`${App.Logic.MONTHS[+w.transfer.packetMonth.slice(5) - 1].slice(0, 3)} ${w.transfer.packetMonth.slice(0, 4)}`) : '<span class="muted">—</span>'}</td>
              <td>${w.transfer && w.transfer.lotCancelled ? 'Cancelled' : '<span class="muted">—</span>'}</td>
              <td class="wrap">${summary(w, data) ? esc(summary(w, data)) : w.notes ? `<span class="muted" title="${esc(w.notes)}">${esc(w.notes.length > 90 ? `${w.notes.slice(0, 90)}…` : w.notes)}</span>` : '<span class="muted">—</span>'}</td>
              <td class="num">${docCount.get(w.id) || 0}</td>
            </tr>`).join('')}</tbody>
        </table></div></div>`);
      table.querySelectorAll('[data-role="status"]').forEach((sel) => sel.addEventListener('change', async () => {
        const id = Number(sel.closest('tr').dataset.id);
        const wc = await App.DB.get('wcs', id);
        wc.statusId = sel.value ? Number(sel.value) : null;
        await App.DB.put('wcs', wc);
        App.Pages.wc.reset();
      }));
      container.append(table);
    },
  };
})();
