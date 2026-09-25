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

    let transferCount = 0;
    let cancelledLbs = 0;
    if (current) {
      const transfers = await App.DB.getAllByIndex('transfers', 'claimPeriodId', current.id);
      transferCount = transfers.length;
      const units = await App.DB.getAllByIndex('cancelledUnits', 'claimPeriodId', current.id);
      cancelledLbs = units.reduce((sum, u) => sum + (Number(u.pounds) || 0), 0);
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
          <div class="value">${current ? transferCount : '—'}</div>
          <div class="label">Transfers this period</div>
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
