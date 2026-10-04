window.App = window.App || {};
App.Pages = App.Pages || {};

App.Pages.dashboard = {
  async render(container) {
    const { h, esc, fmt } = App.UI;
    const L = App.Logic;
    const data = await App.Store.loadAll();
    // CBEP: generation certificates are due from the last day of a month with CBEP activity until issued
    const allUnits = await App.DB.getAll('cancelledUnits');
    const current = data.periods.find((p) => p.id === App.State.currentPeriodId);
    const periodById = new Map(data.periods.map((p) => [p.id, p]));

    container.append(h(`<div class="page-header"><h1>${esc(data.profile.recyclerName || 'CEW / CBEP Tracker')}</h1>
      <p>${data.profile.cewID ? `CEWID ${esc(data.profile.cewID)} · ` : ''}Internal tracking for CalRecycle CEW/CBEP monthly claims.</p></div>`));
    App.Pages.cbep.dueMonths(data).forEach((m) => container.append(App.UI.noticeHtml(`Issue the CBEP generation certificates for <strong>${App.UI.esc(App.Logic.monthLabel(Number(m.slice(0, 4)), Number(m.slice(5, 7))))}</strong> — one per residual type. <a href="#/cbep/${m}">Issue them →</a>`, 'warning')));

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
    // "All": what to act on.  A claim period: that claim's progress.
    if (!current) {
      const sk = data.skipped || {};
      const wcGaps = L.wcNumberGaps(data.wcs, sk.wc || []); const irrGaps = L.irrNumberGaps(data.wcs, sk.irr || []);
      const waiting = data.wcs.filter((w) => w.kind === 'transfer' && L.transferLogUnits(w.transfer).noncrt + L.transferLogUnits(w.transfer).crt + L.transferLogUnits(w.transfer).cbep > 0 && L.logBasis(w.transfer).missing);
      const todo = [
        wcGaps.length ? `<li><a href="#/wcs">${fmt(wcGaps.length)} missing WC number(s)</a> — ${esc(wcGaps.slice(0, 6).join(', '))}${wcGaps.length > 6 ? '…' : ''}</li>` : '',
        irrGaps.length ? `<li><a href="#/transfers">${fmt(irrGaps.length)} missing IRR number(s)</a> — ${esc(irrGaps.slice(0, 6).join(', '))}${irrGaps.length > 6 ? '…' : ''}</li>` : '',
        waiting.length ? `<li><a href="#/transfers">${fmt(waiting.length)} transfer(s) waiting on their 198 ${waiting.some((w) => L.adjustmentsRequired(w.transfer)) ? 'O or A' : 'O'}</a> — ${waiting.slice(0, 6).map((w) => `<a href="#/wc/${w.id}">WC #${esc(w.wcNumber)}</a>`).join(', ')}</li>` : '',
        openTransfers.length ? `<li><a href="#/transfers">${fmt(openTransfers.length)} transfer(s) with claimable units not yet on a claim</a></li>` : '',
        unmatchedNames.size ? `<li><a href="#/companies">${fmt(unmatchedNames.size)} company name(s) in cancellation logs that don't match a company</a></li>` : '',
        '<li><a href="#/wcs">WCs flagged to check</a> (WC list → "Only WCs to check")</li>',
      ].filter(Boolean);
      container.append(h(`<div class="panel"><h2>To do</h2><ul class="todo">${todo.join('')}</ul>
        <p class="hint">Pick a claim period at the top right to see that claim's progress.</p></div>`));
    } else {
      const month = L.periodMonthKey(current);
      const mine = data.allocations.filter((a) => a.claimPeriodId === current.id);
      const docsMissing = [...new Set(mine.map((a) => a.wcId))].map((id) => data.wcs.find((w) => w.id === id)).filter(Boolean)
        .filter((w) => { const T = App.Store.transfer198(w); return !T.basis.log || (T.plan && !T.plan.complete); });
      const gens = data.wcs.filter((w) => w.kind === 'generation' && w.generation && w.generation.forMonth === month).length;
      const progress = [
        `<li>${docsMissing.length ? `<span class="flag-text">${fmt(docsMissing.length)} transfer(s) still need their 198 logs or strikes</span> — ${docsMissing.slice(0, 6).map((w) => `<a href="#/wc/${w.id}">WC #${esc(w.wcNumber)}</a>`).join(', ')}` : 'Every transfer on this claim has its 198 logs and strikes.'}</li>`,
        current.cewType === 'CBEP' ? `<li>${gens ? `${fmt(gens)} generation certificate(s) issued` : '<span class="flag-text">No generation certificates yet</span>'} — <a href="#/residuals">Residuals</a></li>` : `<li>Residuals and month-end inventory — <a href="#/residuals">Residuals</a></li>`,
        `<li>Claim: ${current.submittedDate ? `submitted ${esc(L.shortDate(current.submittedDate))}` : 'not submitted yet'}${current.reviewStatus ? ` · review ${esc(current.reviewStatus)}` : ''}${current.closedDate ? ` · closed ${esc(L.shortDate(current.closedDate))}` : ''} — <a href="#/reports">Claim forms</a></li>`,
      ];
      container.append(h(`<div class="panel"><h2>This claim</h2><ul class="todo">${progress.join('')}</ul></div>`));
    }

    container.append(h(`
      <div class="stat-row">
        <div class="stat"><div class="value">${fmt(data.wcs.filter((w) => !w.noWc).length)}</div><div class="label"><a href="#/wcs">Weight certificates</a></div></div>
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
    }

    const todo = [];
    if (!data.profile.recyclerName) todo.push('<a href="#/settings">Set your facility name and CEWID</a> so the 197 preview is filled in.');
    if (!data.companies.length) todo.push('<a href="#/companies">Add your collectors, handlers and shipping destinations.</a>');
    if (!data.wcStatuses.length) todo.push('<a href="#/settings">Add WC statuses</a> (for example Pending IRR, WC made, Done, Paid) if you want to track them.');
    if (unmatchedNames.size) todo.push(`<a href="#/companies">${unmatchedNames.size} company name(s) in the cancellation logs don't match a saved company.</a>`);
    if (openTransfers.length) todo.push(`<a href="#/transfers">${openTransfers.length} transfer(s) have claimable units not yet allocated to a claim period.</a>`);
    const wcGaps = L.wcNumberGaps(data.wcs, data.skipped.wc).missing;
    const irrGaps = L.irrNumberGaps(data.wcs, data.skipped.irr).missing;
    const few = (label, list) => (list.length <= 3 ? list.map((n) => `${label} #${esc(n)}`).join(', ') : `${list.length} ${label} #s`);
    if (wcGaps.length) todo.push(`<a href="#/wcs">${few('WC', wcGaps)} missing from the sequence.</a>`);
    if (irrGaps.length) todo.push(`<a href="#/transfers">${few('IRR', irrGaps)} missing from the sequence.</a>`);
    if (errors) todo.push(`<a href="#/audit">${errors} audit error(s) in ${esc(App.Models.formatPeriodLabel(current))}.</a>`);
    if (current) {
      const res = L.residualSummary({ year: current.year, month: current.month, materials: data.materials, wcs: data.wcs });
      if (!res.endDocs.length) todo.push(`<a href="#/residuals">No end-of-month inventory recorded for ${esc(L.monthLabel(current.year, current.month))} yet.</a>`);
    }
    container.append(h(`<div class="panel"><h2>Needs attention</h2>${todo.length ? `<ul>${todo.map((t) => `<li>${t}</li>`).join('')}</ul>` : '<p class="muted">Nothing right now.</p>'}</div>`));
  },
};
