/**
 * app.js — hash router + shell. Each js/pages/*.js sets App.Pages[id] = { render(container) }.
 * Routes: #/pageId or #/pageId/param (e.g. #/wc/12).
 */
window.App = window.App || {};
App.Pages = App.Pages || {};
App.State = { currentPeriodId: null, routeParams: [] };

// Top navigation: the pages used every day sit in the bar; the rest live in two menus.
const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'transfers', label: 'Transfers' },
  { id: 'wcs', label: 'WCs' },
  { id: 'cancellations', label: 'Cancellations' },
  { id: 'audit', label: 'Audit' },
  { id: 'residuals', label: 'Residuals' },
  { menu: 'More', items: [
    { id: 'claimPeriods', label: 'Claim periods' },
    { id: 'crtplasma', label: 'CRT & plasma' },
    { id: 'disposition', label: 'Battery & panel disposition' },
    { id: 'reports', label: 'Claim forms & reports', tag: 'next' },
  ] },
  { menu: 'Setup', items: [
    { id: 'companies', label: 'Companies' },
    { id: 'prices', label: 'Price list' },
    { id: 'descriptions', label: 'Vendor descriptions' },
    { id: 'settings', label: 'Settings & backup' },
  ] },
];
const PERIOD_KEY = 'calrecycleTracker.activePeriod';

function closeMenus() {
  document.querySelectorAll('#top-nav details.menu[open]').forEach((d) => { d.open = false; });
  const bar = document.getElementById('appbar');
  bar.classList.remove('nav-open');
  bar.querySelector('.nav-toggle').setAttribute('aria-expanded', 'false');
}

function buildNav() {
  const nav = document.getElementById('top-nav');
  const link = (it) => `<a class="nav-link" href="#/${it.id}" data-page-id="${it.id}">${it.label}${it.tag ? `<span class="tag">${it.tag}</span>` : ''}</a>`;
  nav.innerHTML = NAV_ITEMS.map((it) => (it.menu
    ? `<details class="menu"><summary>${it.menu}</summary><div class="menu-pop">${it.items.map(link).join('')}</div></details>`
    : link(it))).join('');
  // one menu open at a time; clicking elsewhere or pressing Esc closes it
  nav.querySelectorAll('details.menu').forEach((d) => d.addEventListener('toggle', () => {
    if (d.open) nav.querySelectorAll('details.menu').forEach((o) => { if (o !== d) o.open = false; });
  }));
  document.addEventListener('click', (e) => { if (!e.target.closest('#appbar')) closeMenus(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });
  const bar = document.getElementById('appbar');
  const toggle = bar.querySelector('.nav-toggle');
  toggle.addEventListener('click', () => {
    const open = !bar.classList.contains('nav-open');
    bar.classList.toggle('nav-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  });
}

function setActiveNav(pageId) {
  document.querySelectorAll('#top-nav .nav-link').forEach((a) => {
    const on = a.dataset.pageId === pageId;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.querySelectorAll('#top-nav details.menu').forEach((d) => d.classList.toggle('active', !!d.querySelector(`.nav-link[data-page-id="${pageId}"]`)));
  closeMenus();
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
  const short = { NonCRT: 'Non-CRT', CRT: 'CRT', CBEP: 'CBEP' };
  select.innerHTML = periods.map((p) => `<option value="${p.id}" ${p.id === App.State.currentPeriodId ? 'selected' : ''}>${App.UI.esc(`${short[p.cewType] || p.cewType} · ${App.Models.MONTH_NAMES[p.month - 1]} ${p.year}`)}${p.status === 'draft' ? ' (draft)' : ''}</option>`).join('');
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
    App.UI.enhanceLists(fresh); // sorting and filtering on every table[data-list]
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
  buildNav();
  const v = document.getElementById('app-version');
  if (v) { v.textContent = `v${App.Models.VERSION}`; v.title = App.Models.VERSION_NAME; }
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
