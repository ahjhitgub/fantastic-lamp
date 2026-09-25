window.App = window.App || {};
App.Pages = App.Pages || {};

App.Pages.dashboard = {
  async render(container) {
    const periods = await App.DB.getAll('claimPeriods');
    const collectors = await App.DB.getAll('collectors');
    const profile = await App.DB.get('facilityProfile', 'profile');

    const current = App.State.currentPeriodId
      ? periods.find((p) => p.id === App.State.currentPeriodId)
      : null;

    let transferredLbs = 0;
    let cancelledLbs = 0;
    let activityStart = null;
    let activityEnd = null;
    if (current) {
      const totals = await App.Periods.computeAllocatedTotals(current.id);
      transferredLbs = totals.weight;
      const units = await App.DB.getAllByIndex('cancelledUnits', 'claimPeriodId', current.id);
      cancelledLbs = units.reduce((sum, u) => sum + (Number(u.pounds) || 0), 0);
      activityStart = await App.Periods.computeActivityStart(current.id);
      activityEnd = App.Periods.lastDayOfMonthISO(current.year, current.month);
    }

    container.innerHTML = `
      <div class="page-header">
        <h1>${profile?.recyclerName || 'CEW / CBEP Tracker'}</h1>
        <p>${profile?.cewID ? 'CEWID ' + profile.cewID + ' · ' : ''}Internal tracking for CalRecycle CEW/CBEP monthly claims.</p>
      </div>

      <div class="stat-row">
        <div class="stat">
          <div class="value">${periods.length}</div>
          <div class="label">Claim periods on record</div>
        </div>
        <div class="stat">
          <div class="value">${collectors.length}</div>
          <div class="label">Collectors on file</div>
        </div>
        <div class="stat">
          <div class="value">${current ? transferredLbs.toLocaleString() : '—'}</div>
          <div class="label">Lbs allocated in, this period</div>
        </div>
        <div class="stat">
          <div class="value">${current ? cancelledLbs.toLocaleString() : '—'}</div>
          <div class="label">Lbs cancelled this period</div>
        </div>
      </div>

      ${current ? `
        <div class="panel">
          <h2>Active period</h2>
          <p class="muted mt-0">${App.Models.formatPeriodLabel(current)} — status: ${current.status}${
            App.Models.CLAIM_FORM_BY_TYPE[current.cewType]
              ? ` — maps to CalRecycle ${App.Models.CLAIM_FORM_BY_TYPE[current.cewType]}`
              : ''
          }</p>
          <p class="muted mt-0">Claim activity period: ${activityStart || '— once a transfer is allocated —'} to ${activityEnd}</p>
        </div>
      ` : `
        <div class="empty-state">
          <h3>No claim period selected</h3>
          <p>Create your first claim period to start tracking a month's transfers and cancellations.</p>
          <p><a href="#/claimPeriods">Go to Claim Periods →</a></p>
        </div>
      `}

      <div class="panel">
        <h2>Where this app is headed</h2>
        <p class="muted mt-0">Claim Periods, Transfers, Cancellations, Residuals &amp; Inventory,
        and Disposition are all working now. Claim Forms &amp; Reports — auto-filling 196B/196C
        and the 197S rollup from everything entered elsewhere — is what's left.</p>
      </div>
    `;
  },
};
