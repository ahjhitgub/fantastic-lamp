/* Transfers on this claim: what's allocated to it, and the transfers not fully claimed yet — add them (whole or part) after confirming. */
window.App = window.App || {};
App.Pages = App.Pages || {};
App.Pages.claimTransfers = (function () {
  const L = () => App.Logic;
  let msg = null;
  return {
    async render(container) {
      const { h, esc, fmt, header } = App.UI;
      const data = await App.Store.loadAll();
      const period = App.Store.currentPeriod(data);
      container.append(header('Transfers on this claim', 'Add transfers to this claim — the whole transfer, or part of what\'s left on one that\'s partly claimed — and see what\'s already on it.'));
      if (!period) { container.append(App.UI.empty('Pick a claim', 'Pick a claim period at the top to add transfers to it.')); return; }
      if (msg) { container.append(App.UI.notice(msg.text, msg.kind)); msg = null; }
      const prog = period.cewType; const label = App.Models.formatPeriodLabel(period);
      const sameProg = new Set(data.periods.filter((p) => p.cewType === prog).map((p) => p.id));
      const rows = data.wcs.filter((w) => w.kind === 'transfer' && L().programOfType((w.transfer && w.transfer.transferType) || 'cew', prog) && String(w.date || '') <= L().periodEnd(period))
        .map((w) => {
          const c = (L().transferMath(w.transfer).claimable || {})[prog] || { units: 0, weight: 0 };
          const mine = data.allocations.filter((a) => a.wcId === w.id);
          const onThis = L().sumAllocs(mine.filter((a) => a.claimPeriodId === period.id));
          const used = L().sumAllocs(mine.filter((a) => sameProg.has(a.claimPeriodId)));
          const P = App.Store.transferParties(w, data);
          return { w, c, onThis, used, left: { units: c.units - used.units, weight: L().r2(c.weight - used.weight) },
            who: P.selfCollected ? 'Dual Entity' : (P.customer ? P.customer.name : '—') };
        })
        .sort((a, b) => String(a.w.date).localeCompare(String(b.w.date)) || String(a.w.wcNumber).localeCompare(String(b.w.wcNumber), undefined, { numeric: true }));
      const on = rows.filter((r) => r.onThis.units || r.onThis.weight);
      const open = rows.filter((r) => r.left.units > 0 || r.left.weight > 0.01);
      const totals = L().sumAllocs(data.allocations.filter((a) => a.claimPeriodId === period.id));

      container.append(h(`<div class="panel"><h2>On this claim</h2>
        ${on.length ? `<table data-list="claim-on"><thead><tr><th>WC #</th><th>Received</th><th>From</th><th class="num">Units</th><th class="num">Lbs</th><th>Note</th></tr></thead>
          <tbody>${on.map((r) => `<tr><td><a href="#/wc/${r.w.id}">${esc(r.w.wcNumber)}</a></td><td>${esc(L().shortDate(r.w.date))}</td><td>${esc(r.who)}</td>
            <td class="num">${fmt(r.onThis.units)}</td><td class="num">${fmt(r.onThis.weight)}</td><td>${r.used.units > r.onThis.units || r.used.weight > r.onThis.weight + 0.01 ? 'partly on another claim' : ''}</td></tr>`).join('')}</tbody>
          <tfoot><tr><th colspan="3">Total</th><th class="num">${fmt(totals.units)}</th><th class="num">${fmt(totals.weight)}</th><th></th></tr></tfoot></table>`
          : '<p class="muted">Nothing on this claim yet.</p>'}
        <p class="hint">To change or remove an allocation, open the transfer (its Claim periods section).</p></div>`));

      const add = h(`<div class="panel"><h2>Not fully claimed yet</h2>
        <p class="hint mt-0">${esc(prog === 'CBEP' ? 'CBEP' : 'CEW')} transfers received by ${esc(L().shortDate(L().periodEnd(period)))} with claimable units left. Tick the ones to add; lower the units for a partial claim (pounds follow).</p>
        ${open.length ? `<div class="table-scroll"><table class="lines" data-role="open"><thead><tr><th></th><th>WC #</th><th>Received</th><th>From</th><th class="num">Claimable</th><th class="num">Already claimed</th><th class="num">Left</th><th class="num">Units to add</th><th class="num">Lbs to add</th></tr></thead>
          <tbody>${open.map((r, i) => `<tr data-i="${i}"><td><input type="checkbox" data-a="pick"></td><td><a href="#/wc/${r.w.id}">${esc(r.w.wcNumber)}</a></td><td>${esc(L().shortDate(r.w.date))}</td><td>${esc(r.who)}</td>
            <td class="num">${fmt(r.c.units)} / ${fmt(r.c.weight)}</td><td class="num">${r.used.units || r.used.weight ? `${fmt(r.used.units)} / ${fmt(r.used.weight)}` : '—'}</td><td class="num"><strong>${fmt(r.left.units)} / ${fmt(r.left.weight)}</strong></td>
            <td><input data-f="units" inputmode="numeric" style="width:80px" value="${r.left.units}"></td><td><input data-f="weight" inputmode="decimal" style="width:100px" value="${r.left.weight}"></td></tr>`).join('')}</tbody></table></div>
          <div class="row"><span class="spacer"></span><button type="button" class="primary" data-a="add" disabled>Add to ${esc(label)}</button></div>`
          : '<p class="muted">Every transfer of this program received by the period\'s end is fully claimed.</p>'}</div>`);
      const btn = add.querySelector('[data-a="add"]');
      if (btn) {
        const trs = [...add.querySelectorAll('tbody tr')];
        const picked = () => trs.filter((tr) => tr.querySelector('[data-a="pick"]').checked);
        const refresh = () => { const n = picked().length; btn.disabled = !n; btn.textContent = n ? `Add ${n} to ${label}` : `Add to ${label}`; };
        trs.forEach((tr) => {
          const r = open[Number(tr.dataset.i)];
          tr.querySelector('[data-a="pick"]').addEventListener('change', refresh);
          const u = tr.querySelector('[data-f="units"]'); const wt = tr.querySelector('[data-f="weight"]');
          u.addEventListener('input', () => {   // pounds follow the units, in proportion to what's left
            const n = Math.max(0, Math.min(L().num(u.value), r.left.units));
            if (r.left.units > 0) wt.value = L().r2((r.left.weight * n) / r.left.units);
            tr.querySelector('[data-a="pick"]').checked = n > 0; refresh();
          });
        });
        btn.addEventListener('click', async () => {
          const sel = picked().map((tr) => {
            const r = open[Number(tr.dataset.i)];
            const units = Math.max(0, Math.min(L().num(tr.querySelector('[data-f="units"]').value), r.left.units));
            const weight = Math.max(0, Math.min(L().r2(L().num(tr.querySelector('[data-f="weight"]').value)), r.left.weight));
            return { r, units, weight };
          }).filter((x) => x.units > 0 || x.weight > 0);
          if (!sel.length) return;
          const add2 = sel.reduce((a, x) => ({ units: a.units + x.units, weight: L().r2(a.weight + x.weight) }), { units: 0, weight: 0 });
          const ok = await App.UI.confirmDialog({
            title: `Add ${sel.length} transfer${sel.length === 1 ? '' : 's'} to ${label}?`,
            html: `<table class="compact"><thead><tr><th>WC #</th><th>From</th><th class="num">Units</th><th class="num">Lbs</th><th></th></tr></thead><tbody>${sel.map((x) => `<tr><td>${esc(x.r.w.wcNumber)}</td><td>${esc(x.r.who)}</td><td class="num">${fmt(x.units)}</td><td class="num">${fmt(x.weight)}</td>
              <td>${x.units < x.r.left.units ? `<span class="badge warn">partial — ${fmt(x.r.left.units - x.units)} left</span>` : ''}</td></tr>`).join('')}</tbody></table>
              <p>This claim goes from <strong>${fmt(totals.units)} units / ${fmt(totals.weight)} lbs</strong> to <strong>${fmt(totals.units + add2.units)} units / ${fmt(L().r2(totals.weight + add2.weight))} lbs</strong>.</p>`,
            confirmLabel: 'Confirm',
          });
          if (!ok) return;
          for (const x of sel) {
            const existing = data.allocations.find((a) => a.wcId === x.r.w.id && a.claimPeriodId === period.id);
            if (existing) await App.DB.put('transferAllocations', { ...existing, units: L().num(existing.units) + x.units, weight: L().r2(L().num(existing.weight) + x.weight) });
            else await App.DB.add('transferAllocations', { wcId: x.r.w.id, claimPeriodId: period.id, units: x.units, weight: x.weight });
          }
          msg = { kind: 'ok', text: `Added ${sel.length} transfer${sel.length === 1 ? '' : 's'} to ${label}: ${fmt(add2.units)} units / ${fmt(add2.weight)} lbs.` };
          App.rerender();
        });
      }
      container.append(add);
    },
  };
}());
