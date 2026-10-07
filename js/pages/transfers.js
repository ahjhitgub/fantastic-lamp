window.App = window.App || {};
App.Pages = App.Pages || {};

/** Transfer WCs, with where each one stands on being claimed. */
App.Pages.transfers = (function () {
  const filters = { status: '', q: '', view: 'list', pay: '', archived: false };

  return {
    async render(container) {
      const { h, esc, fmt, options, header } = App.UI;
      const L = App.Logic;
      const data = await App.Store.loadAll();
      const transferType = data.wcTypes.find((t) => t.kind === 'transfer');
      const periodById = new Map(data.periods.map((p) => [p.id, p]));

      container.append(header('Transfers', 'Inbound transfers (CalRecycle 197s). A transfer is logged once, then allocated — whole or split across two back-to-back months — to the claim period(s) it is cancelled in.'));
      const gap = App.UI.gapAlert('irr', L.irrNumberGaps(data.allWcs, data.skipped.irr));
      if (gap) container.append(gap);

      const form = h(`
        <form class="panel">
          <h2>New transfer</h2>
          <div class="field-row">
            <div class="field"><label>WC # <span class="muted">(= lot #)</span></label><input name="wcNumber" required value="${esc(L.nextWcNumber(data.allWcs))}"></div>
            <div class="field"><label>IRR #</label><input name="irrNumber" value="${esc(L.nextIrrNumber(data.allWcs))}"></div>
            <div class="field" style="flex:2"><label>From (customer)</label><select name="party">${App.Store.partyOptions('transfer', data.companies, '')}</select></div>
            <div class="field"><label>&nbsp;</label><label class="row"><input type="checkbox" name="dualEntity"> <strong>Dual Entity</strong></label></div>
            <div class="field"><label>&nbsp;</label><label class="row" title="Their usual transfer type, drop off / pick up and line kinds"><input type="checkbox" name="likeLast" checked> Start like their last transfer</label></div>
            <div class="field"><label>WC date <span class="muted">(= received)</span></label><input type="date" name="date" value="${App.UI.today()}"></div>
            <div class="field"><label>Transfer type</label><select name="transferType">${L.TRANSFER_TYPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
            <div class="field"><label>&nbsp;</label><button type="submit" class="primary">Create and open</button></div>
          </div>
          <div data-role="err"></div>
        </form>`);
      // Dual Entity: our own CEW/CBEP received at our facility — no customer to pick
      const dualBox = form.querySelector('[name="dualEntity"]'); const partySel = form.querySelector('[name="party"]');
      dualBox.addEventListener('change', () => { partySel.disabled = dualBox.checked; if (dualBox.checked) partySel.value = ''; });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        try {
          const dual = fd.get('dualEntity') === 'on';
          const id = await App.Store.createWC({ wcNumber: fd.get('wcNumber'), typeId: transferType.id, date: fd.get('date'), party: dual ? '' : fd.get('party'), irrNumber: fd.get('irrNumber'), transferType: fd.get('transferType') });
          if (!dual && fd.get('likeLast') === 'on' && fd.get('party')) {
            const [, pid] = String(fd.get('party')).split(':'); const cid = Number(pid);
            const last = data.wcs.filter((x) => x.kind === 'transfer' && x.transfer && (x.transfer.handlerId === cid || x.transfer.collectorId === cid))
              .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
            if (last) {
              const w = await App.DB.get('wcs', id);
              if (fd.get('transferType') === 'cew') w.transfer.transferType = last.transfer.transferType || w.transfer.transferType;   // a type picked on purpose stays w.transfer.mode = last.transfer.mode || w.transfer.mode;
              const kinds = [...new Set((last.transfer.lines || []).map((l) => l.category))];
              if (kinds.length) w.transfer.lines = kinds.map((k, i) => ({ ...w.transfer.lines[0], id: `l${Date.now()}${i}`, category: k, irrUnits: '', irrGross: '', irrTare: '', irrWeight: '', cewUnits: '', cewWeight: '', nonCewWeight: '' }));
              await App.DB.put('wcs', w);
            }
          }
          if (dual) { const w = await App.DB.get('wcs', id); w.transfer.selfCollected = true; w.transfer.handlerId = null; w.transfer.collectorId = null; w.companyId = null; w.transfer.irrNumber = ''; w.transfer.mode = 'dropoff'; await App.DB.put('wcs', w); }
          App.Pages.wc.reset();
          App.UI.go(`#/wc/${id}`);
        } catch (err) { form.querySelector('[data-role="err"]').replaceChildren(App.UI.notice(App.UI.errText(err), 'error')); }
      });
      container.append(form);

      // inside a claim period: only transfers that are on it or could go on it
      const period = App.Store.currentPeriod(data);
      if (period) container.append(App.UI.noticeHtml(`Showing transfers that are on <strong>${App.UI.esc(App.Models.formatPeriodLabel(period))}</strong> or could go on it — its program, dated by ${App.UI.esc(L.shortDate(L.periodEnd(period)))}, and not already fully claimed. Pick <strong>All — no claim period</strong> to see every transfer.`, 'info'));
      const rows = data.allWcs.filter((w) => w.kind === 'transfer' && (!w.voided || !App.Store.currentPeriod(data)) && App.Store.inScope(w, data)).map((w) => {
        const m = L.transferMath(w.transfer);
        const allocs = data.allocations.filter((a) => a.wcId === w.id);
        const buckets = ['NonCRT', 'CBEP'].filter((b) => m.claimable[b].units > 0 || allocs.some((a) => (periodById.get(a.claimPeriodId) || {}).cewType === b));
        const statuses = buckets.map((b) => L.allocationStatus(m.claimable[b], allocs.filter((a) => (periodById.get(a.claimPeriodId) || {}).cewType === b)));
        const status = !buckets.length ? 'Nothing claimable yet' : (new Set(statuses).size === 1 ? statuses[0] : 'Partially allocated');
        const tl = (w.transfer && w.transfer.timeline) || {};
        const P = App.Store.transferParties(w, data);
        const inv = w.transfer.selfCollected ? null : L.invoiceMath({ date: w.date, transfer: w.transfer, mode: w.transfer.mode, priceItems: data.priceItems, company: P.customer });
        const today = App.UI.today();
        const due = L.paymentDue(w, today);
        const archived = L.isArchived(w, data.allocations, data.periods, today, data.profile.archiveDays || 90);
        return { w, m, P, inv, allocs, status, due, archived, done: App.Models.TRANSFER_TIMELINE.filter(([k]) => (k === 'wcAssigned' || k === 'materialReceived' ? w.date : tl[k])).length };
      });

      const filterEl = h(`
        <div class="panel filters"><div class="field-row">
          <div class="field"><label>Allocation</label><select data-f="status">${options(['Not allocated', 'Partially allocated', 'Fully allocated', 'Over-allocated', 'Nothing claimable yet'].map((s) => ({ value: s, label: s })), filters.status, 'All')}</select></div>
          <div class="field" style="flex:2"><label>Search WC #, IRR # or customer</label><input data-f="q" value="${esc(filters.q)}"></div>
          <div class="field"><label>Payment</label><select data-f="pay">${options([{ value: 'overdue', label: 'Overdue' }, { value: 'soon', label: 'Due today or tomorrow' }, { value: 'unpaid', label: 'Not paid yet' }], filters.pay, 'All')}</select></div>
          <div class="field"><label>Show as</label><select data-f="view">${options([{ value: 'list', label: 'List' }, { value: 'board', label: 'Board' }], filters.view)}</select></div>
          ${rows.some((r) => r.archived) ? `<div class="field"><label>&nbsp;</label><label class="row"><input type="checkbox" data-a="archived" ${filters.archived ? 'checked' : ''}> Show archived (${rows.filter((r) => r.archived).length})</label></div>` : ''}
        </div></div>`);
      const arch = filterEl.querySelector('[data-a="archived"]'); if (arch) arch.addEventListener('change', () => { filters.archived = arch.checked; App.rerender(); });
      filterEl.querySelectorAll('[data-f]').forEach((i) => i.addEventListener(i.tagName === 'INPUT' ? 'change' : 'input', () => { filters[i.dataset.f] = i.value; App.rerender(); }));
      container.append(filterEl);

      const q = L.norm(filters.q);
      const payOk = (r) => !filters.pay || (filters.pay === 'overdue' ? r.due && r.due.status === 'overdue' : filters.pay === 'soon' ? r.due && ['due-today', 'due-tomorrow'].includes(r.due.status) : r.due && r.due.status !== 'paid');
      const list = rows.filter((r) => (filters.archived || !r.archived) && payOk(r) && (!filters.status || r.status === filters.status)
        && (!q || [r.w.wcNumber, r.w.transfer.irrNumber || '', r.P.collector ? r.P.collector.name : '', r.P.handler ? r.P.handler.name : '', r.P.selfCollected ? 'dual entity' : ''].some((s) => L.norm(s).includes(q))))
        .sort((a, b) => String(b.w.date || '').localeCompare(String(a.w.date || '')) || String(b.w.wcNumber).localeCompare(String(a.w.wcNumber), 'en', { numeric: true }));

      if (!list.length) { container.append(App.UI.empty(rows.length ? 'No transfers match these filters' : 'No transfers yet', rows.length ? '' : 'Create one above.')); return; }

      // the board: each transfer in the furthest stage it has reached
      if (filters.view === 'board') {
        const stage = (r) => {
          const t = r.w.transfer;
          if (r.status === 'Fully allocated') return 'Claimed';
          if ((r.due && r.due.status === 'paid') || (t.selfCollected && !L.logBasis(t).missing)) return 'Paid';
          if (r.due) return 'Paperwork complete';
          if (L.adjustmentsRequired(t) && !(t.logs && t.logs.a)) return 'Adjustments';
          if (!L.logBasis(t).missing) return 'Logs in';
          return 'Received';
        };
        const cols = ['Received', 'Logs in', 'Adjustments', 'Paperwork complete', 'Paid', 'Claimed'];
        const dueBadge = (d) => (!d ? '' : d.status === 'overdue' ? `<span class="badge flag">pay overdue ${esc(L.shortDate(d.due))}</span>` : d.status === 'due-today' ? '<span class="badge flag">pay today</span>' : d.status === 'due-tomorrow' ? '<span class="badge warn">pay tomorrow</span>' : d.status === 'open' ? `<span class="badge">pay by ${esc(L.shortDate(d.due))}</span>` : '');
        container.append(h(`<div class="board">${cols.map((c) => { const cs = list.filter((r) => stage(r) === c); return `<div class="board-col"><h3>${esc(c)} <span class="muted">${cs.length}</span></h3>
          ${cs.map((r) => `<a class="board-card" href="#/wc/${r.w.id}"><strong>WC #${esc(r.w.wcNumber)}</strong>${r.w.voided ? ' <span class="badge flag">VOID</span>' : ''}<span class="muted">${esc(L.shortDate(r.w.date))} · ${esc(r.P.selfCollected ? 'Dual Entity' : r.P.customer ? r.P.customer.name : '—')}</span>${dueBadge(r.due)}</a>`).join('')}</div>`; }).join('')}</div>`));
        return;
      }
      const badge = { 'Fully allocated': 'ok', 'Partially allocated': 'warn', 'Not allocated': 'flag', 'Over-allocated': 'flag', 'Nothing claimable yet': '' };
      const SHORT_STATUS = { 'Fully allocated': 'Full', 'Partially allocated': 'Partial', 'Nothing claimable yet': 'Nothing to claim' };
      container.append(h(`
        <div class="panel"><div class="table-scroll"><table data-list="transfers">
          <thead><tr><th>WC #</th><th>IRR #</th><th>Received</th><th>Type</th><th>Customer</th><th>Material</th><th class="num">IRR</th><th class="num">Claimable CEW</th><th>Claimed in</th><th>Allocation</th><th class="num">Invoice</th><th>Pay by</th><th>Timeline</th></tr></thead>
          <tbody>${list.map((r) => {
            const claim = r.m.claimable.NonCRT.units ? r.m.claimable.NonCRT : r.m.claimable.CBEP;
            const claimedIn = r.allocs.map((a) => { const p = periodById.get(a.claimPeriodId); return p ? `${L.MONTHS[p.month - 1].slice(0, 3)} ${p.year} (${fmt(a.units)})` : ''; }).filter(Boolean).join(', ');
            return `<tr>
              <td><a href="#/wc/${r.w.id}"><strong>${esc(r.w.wcNumber)}</strong></a>${r.w.voided ? ' <span class="badge flag">VOID</span>' : ''}</td>
              <td>${esc(r.w.transfer.irrNumber || '') || '<span class="muted">—</span>'}</td>
              <td>${esc(L.shortDate(r.w.date))}</td>
              <td>${esc(L.transferTypeDisplay(r.w.transfer))}</td>
              <td>${r.P.selfCollected ? '<span class="badge">Dual Entity</span>' : r.P.handler ? esc(r.P.handler.name) : r.P.collector ? `${esc(r.P.collector.name)} <span class="muted">(collector)</span>` : '<span class="muted">—</span>'}</td>
              <td>${r.w.transfer.mode === 'pickup' ? 'Pick-up' : r.w.transfer.mode === 'dropoff' ? 'Drop-off' : '<span class="muted">—</span>'}</td>
              <td class="num">${fmt(r.m.irr.units)} / ${fmt(r.m.irr.weight)} lbs</td>
              <td class="num">${fmt(claim.units)} / ${fmt(claim.weight)} lbs</td>
              <td>${esc(claimedIn) || '<span class="muted">—</span>'}</td>
              <td><span class="badge ${badge[r.status]}" title="${r.status}">${SHORT_STATUS[r.status] || r.status}</span>${r.m.problems.length ? ' <span class="badge flag" title="' + esc(r.m.problems.join('\n')) + '">check lines</span>' : ''}</td>
              <td class="num">${!r.inv ? '<span class="muted">—</span>' : r.inv.rows.length ? L.money(r.inv.total) : '—'}${r.inv && r.inv.missing ? `<span class="stack-badge"><span class="badge warn">${r.inv.missing} ${r.inv.missing === 1 ? 'rate' : 'rates'} needed</span></span>` : ''}</td>
              <td>${!r.due ? '<span class="muted">—</span>' : r.due.status === 'paid' ? `<span class="badge ok">paid ${esc(L.shortDate(r.due.paid))}</span>` : `<span class="badge ${r.due.status === 'overdue' || r.due.status === 'due-today' ? 'flag' : r.due.status === 'due-tomorrow' ? 'warn' : ''}">${esc(L.shortDate(r.due.due))}${r.due.status === 'overdue' ? ' — overdue' : r.due.status === 'due-today' ? ' — today' : r.due.status === 'due-tomorrow' ? ' — tomorrow' : ''}</span>`}</td>
              <td>${r.done}/${App.Models.TRANSFER_TIMELINE.length}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div></div>`));

      // purchase invoices sent and not paid yet, oldest first
      const unpaid = rows.filter((r) => r.inv && r.inv.finalBalance > 0 && (r.w.transfer.timeline || {}).poSent && !(r.due && r.due.status === 'paid') && !(r.w.transfer.timeline || {}).paid && !r.w.voided)
        .sort((a, b) => String(a.w.transfer.timeline.poSent).localeCompare(String(b.w.transfer.timeline.poSent)));
      if (unpaid.length) {
        const days = (d) => Math.round((Date.parse(App.UI.today()) - Date.parse(d)) / 86400000);
        container.append(h(`<div class="panel"><h2>Unpaid purchase invoices</h2>
          <table class="compact" data-list="unpaid-po"><thead><tr><th>WC #</th><th>Customer</th><th>PO sent</th><th class="num">Days</th><th class="num">Amount</th><th>Pay by</th></tr></thead>
          <tbody>${unpaid.map((r) => `<tr><td><a href="#/wc/${r.w.id}">${esc(r.w.wcNumber)}</a></td><td>${esc(r.P.customer ? r.P.customer.name : '—')}</td><td>${esc(L.shortDate(r.w.transfer.timeline.poSent))}</td>
            <td class="num">${days(r.w.transfer.timeline.poSent)}</td><td class="num">${L.money(r.inv.finalBalance)}</td><td>${r.due ? esc(L.shortDate(r.due.due)) : '—'}</td></tr>`).join('')}</tbody>
          <tfoot><tr><th colspan="4">Total</th><th class="num">${L.money(unpaid.reduce((a, r) => a + r.inv.finalBalance, 0))}</th><th></th></tr></tfoot></table></div>`));
      }
    },
  };
})();
