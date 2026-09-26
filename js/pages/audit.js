window.App = window.App || {};
App.Pages = App.Pages || {};

/** Reconciles the active period's cancellation log against the WCs allocated to it. */
App.Pages.audit = (function () {
  let severity = '';

  return {
    async render(container) {
      const { h, esc, fmt, header } = App.UI;
      const L = App.Logic;
      const periodId = App.State.currentPeriodId;
      container.append(header('Audit', 'Every discrepancy between the cancellation log and the WCs claimed this period — units, weight, lot #, company names. Time, make, model and box # are not checked.'));
      if (!periodId) { container.append(App.UI.empty('No claim period selected', '<a href="#/claimPeriods">Create or select one</a> first.')); return; }

      const data = await App.Store.loadAll();
      const period = data.periods.find((p) => p.id === periodId);
      const allUnits = await App.DB.getAll('cancelledUnits');
      const units = allUnits.filter((u) => u.claimPeriodId === periodId);
      const r = L.reconcile({ period, units, allUnits, wcs: data.wcs, allocations: data.allocations, periods: data.periods, companies: data.companies });
      const count = (s) => r.issues.filter((i) => i.severity === s).length;
      const t = r.totals;
      const matches = t.units === t.allocUnits && L.sameWeight(t.weight, t.allocWeight);

      container.append(h(`
        <div class="stat-row">
          <div class="stat"><div class="value">${fmt(t.units)} / ${fmt(t.weight)}</div><div class="label">Units / lbs in the cancellation log</div></div>
          <div class="stat"><div class="value">${fmt(t.allocUnits)} / ${fmt(t.allocWeight)}</div><div class="label">Units / lbs allocated from WCs</div></div>
          <div class="stat"><div class="value ${matches ? '' : 'flag-text'}">${matches ? 'Match' : 'Don\u2019t match'}</div><div class="label">${esc(App.Models.formatPeriodLabel(period))}</div></div>
          <div class="stat"><div class="value ${count('error') ? 'flag-text' : ''}">${count('error')}</div><div class="label">Errors · ${count('warning')} warnings · ${count('info')} notes</div></div>
        </div>`));

      const compName = (id) => (data.companies.find((c) => c.id === id) || {}).name || '—';
      if (r.lots.length) {
        const badge = { Matches: 'ok', Mismatch: 'flag', 'Not allocated here': 'flag', 'No matching WC': 'flag', 'No lot #': 'flag', 'Not a transfer': 'flag', 'No units logged': 'flag' };
        const lotsEl = h(`
          <div class="panel"><h2>By lot</h2><div class="table-scroll"><table>
            <thead><tr><th>Lot #</th><th>WC company</th><th class="num">Log units</th><th class="num">Log lbs</th><th class="num">Allocated units</th><th class="num">Allocated lbs</th><th>Status</th></tr></thead>
            <tbody>${r.lots.map((x) => {
              const wc = data.wcs.find((w) => w.id === x.wcId);
              const t2 = wc && wc.transfer;
              return `<tr>
                <td><button type="button" class="linklike" data-lot="${esc(x.lot)}">${esc(x.lot || '(blank)')}</button>${wc ? ` · <a href="#/wc/${wc.id}">WC</a>` : ''}</td>
                <td>${esc(t2 ? compName(t2.handlerId || t2.collectorId) : '—')}</td>
                <td class="num">${fmt(x.units)}</td><td class="num">${fmt(x.weight)}</td>
                <td class="num">${x.allocUnits == null ? '—' : fmt(x.allocUnits)}</td><td class="num">${x.allocWeight == null ? '—' : fmt(x.allocWeight)}</td>
                <td><span class="badge ${badge[x.status] || ''}">${esc(x.status)}</span></td></tr>`;
            }).join('')}</tbody>
          </table></div><p class="hint">Click a lot # to open those units in the cancellation log, where they can be corrected in bulk.</p></div>`);
        lotsEl.querySelectorAll('[data-lot]').forEach((b) => b.addEventListener('click', () => App.Pages.cancellations.showLot(b.dataset.lot)));
        container.append(lotsEl);
      }

      const shown = r.issues.filter((i) => !severity || i.severity === severity);
      const issuesEl = h(`
        <div class="panel">
          <div class="row spread">
            <h2>Discrepancies</h2>
            <div class="row">
              ${[['', `All (${r.issues.length})`], ['error', `Errors (${count('error')})`], ['warning', `Warnings (${count('warning')})`], ['info', `Notes (${count('info')})`]]
                .map(([k, label]) => `<button type="button" data-sev="${k}" class="${severity === k ? 'primary' : ''}">${label}</button>`).join('')}
              <button type="button" data-a="print">Print</button>
            </div>
          </div>
          ${shown.length ? `<ul class="issues">${shown.map((i) => `<li class="${i.severity}"><span class="sev">${i.severity}</span> ${esc(i.message)}</li>`).join('')}</ul>`
            : `<p class="muted">${r.issues.length ? 'Nothing at this level.' : (units.length ? 'No discrepancies found.' : 'No units logged for this period yet.')}</p>`}
        </div>`);
      issuesEl.querySelectorAll('[data-sev]').forEach((b) => b.addEventListener('click', () => { severity = b.dataset.sev; App.rerender(); }));
      issuesEl.querySelector('[data-a="print"]').addEventListener('click', () => {
        issuesEl.classList.add('print-area');
        window.addEventListener('afterprint', () => issuesEl.classList.remove('print-area'), { once: true });
        window.print();
      });
      container.append(issuesEl);
    },
  };
})();
