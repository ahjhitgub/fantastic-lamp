window.App = window.App || {};
App.Pages = App.Pages || {};

App.Pages.dashboard = {
  async render(container) {
    const { h, esc, fmt } = App.UI;
    const L = App.Logic;
    const data = await App.Store.loadAll();
    const allUnits = await App.DB.getAll('cancelledUnits');
    const current = data.periods.find((p) => p.id === App.State.currentPeriodId);
    const periodById = new Map(data.periods.map((p) => [p.id, p]));

    container.append(h(`<div class="page-header"><h1>${esc(data.profile.recyclerName || 'CEW / CBEP Tracker')}</h1>
      <p>${data.profile.cewID ? `CEWID ${esc(data.profile.cewID)} · ` : ''}Internal tracking for CalRecycle CEW/CBEP monthly claims.</p></div>`));

    // transfers with claimable units not yet fully allocated
    const openTransfers = data.wcs.filter((w) => w.kind === 'transfer').filter((w) => {
      const m = L.transferMath(w.transfer);
      return ['NonCRT', 'CBEP'].some((b) => m.claimable[b].units > 0
        && L.allocationStatus(m.claimable[b], data.allocations.filter((a) => a.wcId === w.id && (periodById.get(a.claimPeriodId) || {}).cewType === b)) !== 'Fully allocated');
    });
    const index = L.companyIndex(data.companies);
    const unmatchedNames = new Set(allUnits.map((u) => (u.company || '').trim()).filter((t) => t && L.resolveCompany(t, index).match === 'none'));

    let audit = null; let periodUnits = [];
    if (current) {
      periodUnits = allUnits.filter((u) => u.claimPeriodId === current.id);
      audit = L.reconcile({ period: current, units: periodUnits, allUnits, wcs: data.wcs, allocations: data.allocations, periods: data.periods, companies: data.companies });
    }
    const errors = audit ? audit.issues.filter((i) => i.severity === 'error').length : 0;

    container.append(h(`
      <div class="stat-row">
        <div class="stat"><div class="value">${fmt(data.wcs.length)}</div><div class="label"><a href="#/wcs">Weight certificates</a></div></div>
        <div class="stat"><div class="value ${openTransfers.length ? 'flag-text' : ''}">${fmt(openTransfers.length)}</div><div class="label"><a href="#/transfers">Transfers not fully claimed</a></div></div>
        <div class="stat"><div class="value">${current ? fmt(periodUnits.length) : '—'}</div><div class="label"><a href="#/cancellations">Units cancelled this period</a></div></div>
        <div class="stat"><div class="value ${errors ? 'flag-text' : ''}">${current ? fmt(errors) : '—'}</div><div class="label"><a href="#/audit">Audit errors this period</a></div></div>
      </div>`));

    if (current) {
      const start = await App.Periods.computeActivityStart(current.id);
      const t = audit.totals;
      container.append(h(`
        <div class="panel">
          <h2>Active period — ${esc(App.Models.formatPeriodLabel(current))}</h2>
          <p class="muted mt-0">Status: ${esc(current.status)}${App.Models.CLAIM_FORM_BY_TYPE[current.cewType] ? ` · CalRecycle ${App.Models.CLAIM_FORM_BY_TYPE[current.cewType]}` : ''}
            · Activity period ${esc(start || '(starts once a transfer is allocated)')} to ${esc(L.lastDayISO(current.year, current.month))}</p>
          <table><tbody>
            <tr><th>Allocated from WCs</th><td class="num">${fmt(t.allocUnits)} units</td><td class="num">${fmt(t.allocWeight)} lbs</td></tr>
            <tr><th>Cancelled (log)</th><td class="num">${fmt(t.units)} units</td><td class="num">${fmt(t.weight)} lbs</td></tr>
          </tbody></table>
        </div>`));
    } else {
      container.append(App.UI.empty('No claim period selected', '<a href="#/claimPeriods">Create one</a>, or create it right from a transfer when you allocate it.'));
    }

    const todo = [];
    if (!data.profile.recyclerName) todo.push('<a href="#/settings">Set your facility name and CEWID</a> so the 197 preview is filled in.');
    if (!data.companies.length) todo.push('<a href="#/companies">Add your collectors, handlers and shipping destinations.</a>');
    if (!data.wcStatuses.length) todo.push('<a href="#/settings">Add WC statuses</a> (for example Pending IRR, WC made, Done, Paid) if you want to track them.');
    if (unmatchedNames.size) todo.push(`<a href="#/companies">${unmatchedNames.size} company name(s) in the cancellation logs don't match a saved company.</a>`);
    if (openTransfers.length) todo.push(`<a href="#/transfers">${openTransfers.length} transfer(s) have claimable units not yet allocated to a claim period.</a>`);
    if (errors) todo.push(`<a href="#/audit">${errors} audit error(s) in ${esc(App.Models.formatPeriodLabel(current))}.</a>`);
    if (current) {
      const res = L.residualSummary({ year: current.year, month: current.month, materials: data.materials, wcs: data.wcs });
      if (!res.endDocs.length) todo.push(`<a href="#/residuals">No end-of-month inventory recorded for ${esc(L.monthLabel(current.year, current.month))} yet.</a>`);
    }
    container.append(h(`<div class="panel"><h2>Needs attention</h2>${todo.length ? `<ul>${todo.map((t) => `<li>${t}</li>`).join('')}</ul>` : '<p class="muted">Nothing right now.</p>'}</div>`));
  },
};
