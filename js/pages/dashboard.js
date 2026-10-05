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
    const today = App.UI.today();
    // ---- backups
    {
      const last = await App.Backup.lastBackup(); const perm = await App.Backup.folderPermission();
      const old = !last || Date.now() - Date.parse(last.at) > 7 * 86400000;
      if (old || perm === 'prompt') {
        const n = App.UI.h(`<div class="notice warning row"><span>${old ? `<strong>${last ? `Last backup ${new Date(last.at).toLocaleDateString()}` : 'No backup yet'}</strong> — everything lives only in this browser.` : 'Automatic backups need your OK again this visit.'}</span><span class="spacer"></span>
          ${old ? '<button type="button" class="primary" data-a="backup">Back up now</button>' : ''}${perm === 'prompt' ? '<button type="button" data-a="allow">Allow automatic backups</button>' : ''}</div>`);
        const b = n.querySelector('[data-a="backup"]'); if (b) b.addEventListener('click', async () => { await App.Backup.downloadBackup(); App.rerender(); });
        const a = n.querySelector('[data-a="allow"]'); if (a) a.addEventListener('click', async () => { if (await App.Backup.allowFolder()) { await App.Backup.autoBackup(); } App.rerender(); });
        container.append(n);
      }
    }
    // ---- 3 days from all paperwork to close and pay
    const dues = data.wcs.filter((w) => w.kind === 'transfer').map((w) => ({ w, d: L.paymentDue(w, today) })).filter((x) => x.d && x.d.status !== 'paid');
    const urgent = dues.filter((x) => ['overdue', 'due-today', 'due-tomorrow'].includes(x.d.status)).sort((a, b) => a.d.due.localeCompare(b.d.due));
    if (urgent.length) {
      container.append(App.UI.noticeHtml(`<strong>Close and pay:</strong> ${urgent.map((x) => `<a href="#/wc/${x.w.id}">WC #${esc(x.w.wcNumber)}</a> ${x.d.status === 'overdue' ? `<span class="badge flag">overdue — was due ${esc(L.shortDate(x.d.due))}</span>` : x.d.status === 'due-today' ? '<span class="badge flag">due today</span>' : '<span class="badge warn">due tomorrow</span>'}`).join(' · ')}`, urgent.some((x) => x.d.status !== 'due-tomorrow') ? 'error' : 'warning'));
    }
    // ---- coming up (two weeks)
    {
      const until = L.addDays(today, 14); const items = [];
      dues.filter((x) => x.d.due <= until).forEach((x) => items.push([x.d.due, `Pay for <a href="#/wc/${x.w.id}">WC #${esc(x.w.wcNumber)}</a>`]));
      data.periods.filter((p) => p.dueDate && !p.submittedDate && p.dueDate <= until).forEach((p) => items.push([p.dueDate, `Submit the ${esc(App.Models.formatPeriodLabel(p))} claim`]));
      data.periods.filter((p) => p.submittedDate && !p.closedDate && !['complete'].includes(p.reviewStatus)).forEach((p) => { const r = L.addDays(p.submittedDate, 30); if (r <= until) items.push([r, `CalRecycle's 30-day review of the ${esc(App.Models.formatPeriodLabel(p))} claim`]); });
      data.wcs.filter((w) => w.kind === 'transfer' && w.transfer.adjustmentRequested && !(w.transfer.logs && w.transfer.logs.a)).forEach((w) => items.push([w.transfer.adjustmentRequested, `Waiting on the 198 A for <a href="#/wc/${w.id}">WC #${esc(w.wcNumber)}</a> (asked ${esc(L.shortDate(w.transfer.adjustmentRequested))})`]));
      if (items.length) container.append(h(`<div class="panel"><h2>Coming up</h2><ul class="todo coming">${items.sort((a, b) => a[0].localeCompare(b[0])).slice(0, 20).map(([d, t]) => `<li><span class="badge ${d < today ? 'flag' : d === today ? 'warn' : ''}">${esc(L.shortDate(d))}</span> ${t}</li>`).join('')}</ul></div>`));
    }
    // ---- end-of-day sheet
    {
      const eod = h('<div class="row"><span class="spacer"></span><button type="button" data-a="eod">End-of-day sheet</button></div>');
      eod.querySelector('[data-a="eod"]').addEventListener('click', () => {
        const name = (w) => { const P = App.Store.transferParties(w, data); return P.selfCollected ? 'Dual Entity' : P.customer ? P.customer.name : '—'; };
        const inToday = data.wcs.filter((w) => w.kind === 'transfer' && w.date === today);
        const outToday = data.wcs.filter((w) => w.kind === 'shipment' && w.date === today);
        const missing = data.wcs.filter((w) => w.kind === 'transfer' && !w.transfer.selfCollected && !L.paperworkDate(w));
        const tbl = (head, rows) => (rows.length ? `<table class="doc-table"><thead><tr>${head.map((x) => `<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(String(c))}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<p>None.</p>');
        const sheet = h(`<div class="doc-sheet print-area" style="position:fixed;inset:0;overflow:auto;z-index:50">
          <h2>${esc(data.profile.recyclerName || '')} — End of day, ${esc(L.shortDate(today))}</h2>
          <h3>Received today</h3>${tbl(['WC #', 'From', 'Units', 'Lbs'], inToday.map((w) => { const m = L.transferMath(w.transfer); return [w.wcNumber, name(w), m.irr.units, m.irr.weight]; }))}
          <h3>Shipped today</h3>${tbl(['WC #', 'Net lbs'], outToday.map((w) => [w.wcNumber, L.r2((w.shipment.lines || []).reduce((a, l) => a + L.lineNet(l), 0))]))}
          <h3>Payments due (3-day rule)</h3>${tbl(['WC #', 'Customer', 'Due', ''], urgent.map((x) => [x.w.wcNumber, name(x.w), L.shortDate(x.d.due), x.d.status.replace('-', ' ')]))}
          <h3>Still waiting on paperwork</h3>${tbl(['WC #', 'Customer', 'Received'], missing.slice(0, 60).map((w) => [w.wcNumber, name(w), L.shortDate(w.date)]))}</div>`);
        document.getElementById('main-content').append(sheet);
        const done = () => { sheet.remove(); window.removeEventListener('afterprint', done); };
        window.addEventListener('afterprint', done); window.print(); setTimeout(done, 60000);
      });
      container.append(eod);
    }

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
      const wcGaps = L.wcNumberGaps(data.allWcs, sk.wc || []); const irrGaps = L.irrNumberGaps(data.allWcs, sk.irr || []);
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
    const wcGaps = L.wcNumberGaps(data.allWcs, data.skipped.wc).missing;
    const irrGaps = L.irrNumberGaps(data.allWcs, data.skipped.irr).missing;
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
