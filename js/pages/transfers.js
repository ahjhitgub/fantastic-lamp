window.App = window.App || {};
App.Pages = App.Pages || {};

/** Transfer WCs, with where each one stands on being claimed. */
App.Pages.transfers = (function () {
  const filters = { status: '', q: '' };

  return {
    async render(container) {
      const { h, esc, fmt, options, header } = App.UI;
      const L = App.Logic;
      const data = await App.Store.loadAll();
      const transferType = data.wcTypes.find((t) => t.kind === 'transfer');
      const periodById = new Map(data.periods.map((p) => [p.id, p]));
      const compName = (id) => (data.companies.find((c) => c.id === id) || {}).name || '—';

      container.append(header('Transfers', 'Inbound transfers (CalRecycle 197s). A transfer is logged once, then allocated — whole or split across two back-to-back months — to the claim period(s) it is cancelled in.'));

      const form = h(`
        <form class="panel">
          <h2>New transfer</h2>
          <div class="field-row">
            <div class="field"><label>WC # (= lot # on the cancellation log)</label><input name="wcNumber" required></div>
            <div class="field"><label>Date received</label><input type="date" name="date" value="${App.UI.today()}"></div>
            <div class="field"><label>&nbsp;</label><button type="submit" class="primary">Create and open</button></div>
          </div>
          <div data-role="err"></div>
        </form>`);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        try {
          const id = await App.Store.createWC({ wcNumber: fd.get('wcNumber'), typeId: transferType.id, date: fd.get('date') });
          App.Pages.wc.reset();
          App.UI.go(`#/wc/${id}`);
        } catch (err) { form.querySelector('[data-role="err"]').replaceChildren(App.UI.notice(App.UI.errText(err), 'error')); }
      });
      container.append(form);

      const rows = data.wcs.filter((w) => w.kind === 'transfer').map((w) => {
        const m = L.transferMath(w.transfer);
        const allocs = data.allocations.filter((a) => a.wcId === w.id);
        const buckets = ['NonCRT', 'CBEP'].filter((b) => m.claimable[b].units > 0 || allocs.some((a) => (periodById.get(a.claimPeriodId) || {}).cewType === b));
        const statuses = buckets.map((b) => L.allocationStatus(m.claimable[b], allocs.filter((a) => (periodById.get(a.claimPeriodId) || {}).cewType === b)));
        const status = !buckets.length ? 'Nothing claimable yet' : (new Set(statuses).size === 1 ? statuses[0] : 'Partially allocated');
        const tl = (w.transfer && w.transfer.timeline) || {};
        return { w, m, allocs, status, done: App.Models.TRANSFER_TIMELINE.filter(([k]) => tl[k]).length };
      });

      const filterEl = h(`
        <div class="panel filters"><div class="field-row">
          <div class="field"><label>Allocation</label><select data-f="status">${options(['Not allocated', 'Partially allocated', 'Fully allocated', 'Over-allocated', 'Nothing claimable yet'].map((s) => ({ value: s, label: s })), filters.status, 'All')}</select></div>
          <div class="field" style="flex:2"><label>Search WC #, collector or handler</label><input data-f="q" value="${esc(filters.q)}"></div>
        </div></div>`);
      filterEl.querySelectorAll('[data-f]').forEach((i) => i.addEventListener(i.tagName === 'INPUT' ? 'change' : 'input', () => { filters[i.dataset.f] = i.value; App.rerender(); }));
      container.append(filterEl);

      const q = L.norm(filters.q);
      const list = rows.filter((r) => (!filters.status || r.status === filters.status)
        && (!q || [r.w.wcNumber, compName(r.w.transfer.collectorId), compName(r.w.transfer.handlerId)].some((s) => L.norm(s).includes(q))))
        .sort((a, b) => String(b.w.date || '').localeCompare(String(a.w.date || '')) || String(b.w.wcNumber).localeCompare(String(a.w.wcNumber), 'en', { numeric: true }));

      if (!list.length) { container.append(App.UI.empty(rows.length ? 'No transfers match these filters' : 'No transfers yet', rows.length ? '' : 'Create one above.')); return; }

      const badge = { 'Fully allocated': 'ok', 'Partially allocated': 'warn', 'Not allocated': 'flag', 'Over-allocated': 'flag', 'Nothing claimable yet': '' };
      container.append(h(`
        <div class="panel"><div class="table-scroll"><table>
          <thead><tr><th>WC #</th><th>Received</th><th>Collector</th><th>Handler</th><th class="num">IRR</th><th class="num">Claimable CEW</th><th>Claimed in</th><th>Allocation</th><th>Timeline</th></tr></thead>
          <tbody>${list.map((r) => {
            const claim = r.m.claimable.NonCRT.units ? r.m.claimable.NonCRT : r.m.claimable.CBEP;
            const claimedIn = r.allocs.map((a) => { const p = periodById.get(a.claimPeriodId); return p ? `${L.monthLabel(p.year, p.month)} (${fmt(a.units)})` : ''; }).filter(Boolean).join(', ');
            return `<tr>
              <td><a href="#/wc/${r.w.id}"><strong>${esc(r.w.wcNumber)}</strong></a></td>
              <td>${esc(r.w.date)}</td>
              <td>${esc(compName(r.w.transfer.collectorId))}</td>
              <td>${esc(compName(r.w.transfer.handlerId))}</td>
              <td class="num">${fmt(r.m.irr.units)} / ${fmt(r.m.irr.weight)} lbs</td>
              <td class="num">${fmt(claim.units)} / ${fmt(claim.weight)} lbs</td>
              <td>${esc(claimedIn) || '<span class="muted">—</span>'}</td>
              <td><span class="badge ${badge[r.status]}">${r.status}</span>${r.m.problems.length ? ' <span class="badge flag" title="' + esc(r.m.problems.join('\n')) + '">check lines</span>' : ''}</td>
              <td>${r.done}/${App.Models.TRANSFER_TIMELINE.length}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div></div>`));
    },
  };
})();
