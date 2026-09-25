/**
 * app.js
 * Minimal hash router + shell chrome. No build step, no framework —
 * every js/pages/*.js file attaches a render(container) function to
 * App.Pages[id]; this file just decides which one is on screen and
 * keeps the "active claim period" in sync across all of them.
 */
window.App = window.App || {};

App.Pages = App.Pages || {};

App.State = {
  currentPeriodId: null,
};

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', group: null },
  { id: 'claimPeriods', label: 'Claim Periods', group: 'Records' },
  { id: 'transfers', label: 'Transfers', group: 'Records', tag: 'next' },
  { id: 'cancellations', label: 'Cancellations', group: 'Records', tag: 'next' },
  { id: 'residuals', label: 'Residuals & Inventory', group: 'Records', tag: 'next' },
  { id: 'disposition', label: 'Battery / Panel Disposition', group: 'Records', tag: 'next' },
  { id: 'reports', label: 'Claim Forms & Reports', group: 'Output', tag: 'next' },
  { id: 'settings', label: 'Settings & Backup', group: null },
];

function buildSidebar() {
  const nav = document.getElementById('sidebar-nav');
  nav.innerHTML = '';
  let lastGroup = undefined;
  NAV_ITEMS.forEach((item) => {
    if (item.group !== lastGroup) {
      if (item.group) {
        const label = document.createElement('div');
        label.className = 'nav-group-label';
        label.textContent = item.group;
        nav.appendChild(label);
      }
      lastGroup = item.group;
    }
    const a = document.createElement('a');
    a.className = 'nav-link';
    a.href = `#/${item.id}`;
    a.dataset.pageId = item.id;
    a.textContent = item.label;
    if (item.tag) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = item.tag;
      a.appendChild(tag);
    }
    nav.appendChild(a);
  });
}

function setActiveNav(pageId) {
  document.querySelectorAll('.nav-link').forEach((a) => {
    a.classList.toggle('active', a.dataset.pageId === pageId);
  });
}

async function renderPeriodSwitcher() {
  const select = document.getElementById('period-select');
  const periods = await App.DB.getAll('claimPeriods');
  periods.sort((a, b) => (b.year - a.year) || (b.month - a.month) || (a.cewType > b.cewType ? 1 : -1));

  select.innerHTML = '';

  if (periods.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No claim periods yet';
    select.appendChild(opt);
    App.State.currentPeriodId = null;
    return;
  }

  periods.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = String(p.id);
    opt.textContent = App.Models.formatPeriodLabel(p) + (p.status === 'draft' ? '  (draft)' : '');
    select.appendChild(opt);
  });

  if (!App.State.currentPeriodId || !periods.some((p) => p.id === App.State.currentPeriodId)) {
    App.State.currentPeriodId = periods[0].id;
  }
  select.value = String(App.State.currentPeriodId);
}

async function route() {
  const hash = window.location.hash.replace(/^#\//, '') || 'dashboard';
  const pageId = App.Pages[hash] ? hash : 'dashboard';
  setActiveNav(pageId);

  const container = document.getElementById('main-content');
  container.innerHTML = '';

  const page = App.Pages[pageId];
  if (page && typeof page.render === 'function') {
    await page.render(container);
  } else {
    container.innerHTML = '<div class="empty-state"><h3>Page not found</h3></div>';
  }
}

async function init() {
  buildSidebar();
  await renderPeriodSwitcher(); // first call also opens/creates the IndexedDB database

  document.getElementById('period-select').addEventListener('change', async (e) => {
    App.State.currentPeriodId = e.target.value ? Number(e.target.value) : null;
    await route(); // re-render current page against the newly selected period
  });

  window.addEventListener('hashchange', route);
  await route();
}

document.addEventListener('DOMContentLoaded', init);

/** Call this after any write that could change which periods exist (e.g. creating one). */
App.refreshShell = async function refreshShell() {
  await renderPeriodSwitcher();
  await route();
};
