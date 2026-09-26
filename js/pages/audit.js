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
          <div class="stat"><div class="value ${matches ? '' : 'flag-text'}">${matches ? 'Match' : `${L.signed(t.diffUnits)} / ${L.signed(t.diffWeight)}`}</div><div class="label">${matches ? esc(App.Models.formatPeriodLabel(period)) : 'Units / lbs over (+) or short (−), log − allocated'}</div></div>
          <div class="stat"><div class="value ${count('error') ? 'flag-text' : ''}">${count('error')}</div><div class="label">Errors · ${count('warning')} warnings · ${count('info')} notes</div></div>
        </div>`));

      const compName = (id) => (data.companies.find((c) => c.id === id) || {}).name || '—';
      const uu = (n) => `${fmt(n)} unit${Math.abs(n) === 1 ? '' : 's'}`;
      const diffCell = (d, unit) => {
        if (d === null || d === undefined) return '<span class="muted">—</span>';
        if (Math.abs(d) < 0.005) return '<span class="ok-text">0</span>';
        return `<span class="flag-text">${L.signed(d)}${unit ? ` ${unit}` : ''} ${d > 0 ? 'over' : 'short'}</span>`;
      };
      const eq = (a, b, d, unit) => `${fmt(a)} − ${fmt(b)} = <strong class="${Math.abs(d) < 0.005 ? 'ok-text' : 'flag-text'}">${L.signed(d)}${unit}</strong>${Math.abs(d) < 0.005 ? '' : d > 0 ? ' (over)' : ' (short)'}`;
      const mathHtml = (x) => {
        const m = x.math;
        if (!m) return `<p class="muted">No transfer WC to compare against — ${esc(x.status.toLowerCase())}.</p>`;
        const tp = m.thisPeriod; const ap = m.allPeriods;
        const list = (items) => items.map((i) => `${esc(i.label)}${i.here ? ' <em>(this period)</em>' : ''}: ${uu(i.units)} / ${fmt(i.weight)} lbs`).join(' · ') || 'none';
        return `<table class="math"><tbody>
          <tr><th>Claimable on WC #${esc(m.wcNumber)}</th><td>IRR ${uu(m.irr.units)} / ${fmt(m.irr.weight)} lbs − non-CEW ${uu(m.nonCew.units)} / ${fmt(m.nonCew.weight)} lbs = <strong>${uu(m.claim.units)} / ${fmt(m.claim.weight)} lbs</strong></td></tr>
          <tr><th>Allocated to claim periods</th><td>${list(m.allocs)}</td></tr>
          <tr><th>Logged in cancellation logs</th><td>${list(m.logged)}</td></tr>
          <tr><th>This period (log − allocated)</th><td>${tp.allocated
            ? `Units: ${eq(tp.logged.units, tp.allocated.units, tp.diffUnits, '')} · Lbs: ${eq(tp.logged.weight, tp.allocated.weight, tp.diffWeight, ' lbs')}`
            : `<span class="flag-text">Not allocated to this period</span> — ${uu(tp.logged.units)} / ${fmt(tp.logged.weight)} lbs logged here`}</td></tr>
          <tr><th>All periods (logged − claimable)</th><td>Units: ${eq(ap.logged.units, ap.claim.units, ap.overUnits, '')} · Lbs: ${eq(ap.logged.weight, ap.claim.weight, ap.overWeight, ' lbs')}
            ${ap.overUnits < 0 || ap.overWeight < -0.005 ? '<span class="muted">— short across all periods is expected until the rest is logged in its own month</span>' : ''}</td></tr>
        </tbody></table>`;
      };

      if (r.lots.length) {
        const badge = { Matches: 'ok', Mismatch: 'flag', 'Not allocated here': 'flag', 'No matching WC': 'flag', 'No lot #': 'flag', 'Not a transfer': 'flag', 'No units logged': 'flag' };
        const lotsEl = h(`
          <div class="panel"><h2>By lot</h2><div class="table-scroll"><table class="audit-lots">
            <thead><tr><th>Lot #</th><th>WC company</th><th class="num">Log units</th><th class="num">Allocated units</th><th class="num">Units ±</th>
              <th class="num">Log lbs</th><th class="num">Allocated lbs</th><th class="num">Lbs ±</th><th>Status</th><th></th></tr></thead>
            <tbody>${r.lots.map((x, i) => {
              const wc = data.wcs.find((w) => w.id === x.wcId);
              const t2 = wc && wc.transfer;
              const open = x.status !== 'Matches';
              return `<tr>
                <td><button type="button" class="linklike" data-lot="${esc(x.lot)}">${esc(x.lot || '(blank)')}</button>${wc ? ` · <a href="#/wc/${wc.id}">WC</a>` : ''}</td>
                <td>${esc(t2 ? compName(t2.handlerId || t2.collectorId) : '—')}</td>
                <td class="num">${fmt(x.units)}</td><td class="num">${x.allocUnits == null ? '—' : fmt(x.allocUnits)}</td><td class="num">${diffCell(x.diffUnits, '')}</td>
                <td class="num">${fmt(x.weight)}</td><td class="num">${x.allocWeight == null ? '—' : fmt(x.allocWeight)}</td><td class="num">${diffCell(x.diffWeight, 'lbs')}</td>
                <td><span class="badge ${badge[x.status] || ''}">${esc(x.status)}</span></td>
                <td><button type="button" data-math="${i}">${open ? 'Hide math' : 'Show math'}</button></td></tr>
                <tr class="math-row" data-math-row="${i}" ${open ? '' : 'hidden'}><td colspan="10">${mathHtml(x)}</td></tr>`;
            }).join('')}</tbody>
            <tfoot><tr><th colspan="2">Period total</th><th class="num">${fmt(t.units)}</th><th class="num">${fmt(t.allocUnits)}</th><th class="num">${diffCell(t.diffUnits, '')}</th>
              <th class="num">${fmt(t.weight)}</th><th class="num">${fmt(t.allocWeight)}</th><th class="num">${diffCell(t.diffWeight, 'lbs')}</th><th colspan="2"></th></tr></tfoot>
          </table></div><p class="hint">± = cancellation log − allocated. Click a lot # to open those units in the cancellation log, where they can be corrected in bulk.</p></div>`);
        lotsEl.querySelectorAll('[data-lot]').forEach((btn) => btn.addEventListener('click', () => App.Pages.cancellations.showLot(btn.dataset.lot)));
        lotsEl.querySelectorAll('[data-math]').forEach((btn) => btn.addEventListener('click', () => {
          const row = lotsEl.querySelector(`[data-math-row="${btn.dataset.math}"]`);
          row.hidden = !row.hidden;
          btn.textContent = row.hidden ? 'Show math' : 'Hide math';
        }));
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
