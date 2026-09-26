/**
 * app.js — hash router + shell. Each js/pages/*.js sets App.Pages[id] = { render(container) }.
 * Routes: #/pageId or #/pageId/param (e.g. #/wc/12).
 */
window.App = window.App || {};
App.Pages = App.Pages || {};
App.State = { currentPeriodId: null, routeParams: [] };

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard' },
  { group: 'Records' },
  { id: 'claimPeriods', label: 'Claim Periods' },
  { id: 'wcs', label: 'Weight Certificates' },
  { id: 'transfers', label: 'Transfers' },
  { id: 'cancellations', label: 'Cancellations' },
  { id: 'audit', label: 'Audit' },
  { id: 'residuals', label: 'Residuals' },
  { id: 'disposition', label: 'Battery / Panel Disposition' },
  { group: 'Output' },
  { id: 'reports', label: 'Claim Forms & Reports', tag: 'next' },
  { group: 'Setup' },
  { id: 'companies', label: 'Companies' },
  { id: 'prices', label: 'Price List' },
  { id: 'settings', label: 'Settings & Backup' },
];
const PERIOD_KEY = 'calrecycleTracker.activePeriod';

function buildSidebar() {
  const nav = document.getElementById('sidebar-nav');
  nav.innerHTML = NAV_ITEMS.map((item) => item.group
    ? `<div class="nav-group-label">${item.group}</div>`
    : `<a class="nav-link" href="#/${item.id}" data-page-id="${item.id}">${item.label}${item.tag ? `<span class="tag">${item.tag}</span>` : ''}</a>`).join('');
}

function setActiveNav(pageId) {
  document.querySelectorAll('.nav-link').forEach((a) => a.classList.toggle('active', a.dataset.pageId === pageId));
}

async function renderPeriodSwitcher() {
  const select = document.getElementById('period-select');
  const periods = await App.DB.getAll('claimPeriods');
  periods.sort((a, b) => (b.year - a.year) || (b.month - a.month) || String(a.cewType).localeCompare(b.cewType));
  if (!periods.length) {
    select.innerHTML = '<option value="">No claim periods yet</option>';
    App.State.currentPeriodId = null;
    return;
  }
  if (!periods.some((p) => p.id === App.State.currentPeriodId)) App.State.currentPeriodId = periods[0].id;
  select.innerHTML = periods.map((p) => `<option value="${p.id}" ${p.id === App.State.currentPeriodId ? 'selected' : ''}>${App.UI.esc(App.Models.formatPeriodLabel(p))}${p.status === 'draft' ? '  (draft)' : ''}</option>`).join('');
}

let routeToken = 0;
async function route() {
  const token = ++routeToken;
  const parts = (window.location.hash.replace(/^#\/?/, '') || 'dashboard').split('/').map(decodeURIComponent);
  const pageId = App.Pages[parts[0]] ? parts[0] : 'dashboard';
  App.State.routeParams = parts.slice(1);
  setActiveNav({ wc: 'wcs', doc: 'transfers' }[pageId] || pageId);

  // Render off-screen, then swap in, so two overlapping renders can never interleave.
  const fresh = document.createElement('div');
  try {
    await App.Pages[pageId].render(fresh);
  } catch (err) {
    console.error(err);
    fresh.replaceChildren(App.UI.notice(`This page hit an error: ${App.UI.errText(err)}`, 'error'));
  }
  if (token !== routeToken) return;
  document.getElementById('main-content').replaceChildren(...Array.from(fresh.childNodes));
}

App.rerender = async function rerender() {
  await renderPeriodSwitcher();
  await route();
};
App.refreshShell = App.rerender;

App.setPeriod = function setPeriod(id) {
  App.State.currentPeriodId = id || null;
  try { localStorage.setItem(PERIOD_KEY, String(id || '')); } catch (e) { /* storage unavailable */ }
};

async function init() {
  buildSidebar();
  try {
    await App.DB.open();
    await App.Store.migrate();
  } catch (err) {
    console.error(err);
    document.getElementById('main-content').replaceChildren(App.UI.notice(`Couldn't open the database: ${App.UI.errText(err)}`, 'error'));
    return;
  }
  try { App.State.currentPeriodId = Number(localStorage.getItem(PERIOD_KEY)) || null; } catch (e) { /* ignore */ }
  document.getElementById('period-select').addEventListener('change', (e) => {
    App.setPeriod(e.target.value ? Number(e.target.value) : null);
    route();
  });
  window.addEventListener('hashchange', route);
  await App.rerender();
}

document.addEventListener('DOMContentLoaded', init);
