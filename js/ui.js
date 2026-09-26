/**
 * ui.js — small rendering helpers.
 * House rule for every page: load data first, then build elements synchronously,
 * attach listeners, and append. Never write innerHTML on a node after listeners
 * were attached inside it (that silently replaces the elements — the bug behind
 * "Create period" not saving).
 */
window.App = window.App || {};

App.UI = {
  esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  fmt: (n) => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }),
  errText: (err) => (err && err.message ? err.message : String(err)),
  today: () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; },

  /** Build one element from an HTML string. */
  h(html) {
    const t = document.createElement('template');
    t.innerHTML = String(html).trim();
    return t.content.firstElementChild;
  },

  /** <option>s. items: [{value, label}] */
  options(items, selected, blankLabel) {
    const esc = App.UI.esc;
    const blank = blankLabel != null ? `<option value="">${esc(blankLabel)}</option>` : '';
    return blank + items.map((i) => `<option value="${esc(i.value)}" ${String(i.value) === String(selected ?? '') ? 'selected' : ''}>${esc(i.label)}</option>`).join('');
  },

  header(title, sub) {
    return App.UI.h(`<div class="page-header"><h1>${App.UI.esc(title)}</h1>${sub ? `<p>${sub}</p>` : ''}</div>`);
  },
  empty(title, body) {
    return App.UI.h(`<div class="empty-state"><h3>${App.UI.esc(title)}</h3>${body ? `<p>${body}</p>` : ''}</div>`);
  },
  notice(text, kind) {
    return App.UI.h(`<div class="notice ${kind || ''}">${App.UI.esc(text)}</div>`);
  },
  go(hash) { if (window.location.hash === hash) App.rerender(); else window.location.hash = hash; },
};
