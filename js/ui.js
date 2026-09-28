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
  /**
   * "WC #2300 missing" / "IRR #1799 missing" alert for gaps in the number sequence (L.numberGaps).
   * WC #s can be recorded as void; either can be marked skipped on purpose to clear the alert.
   */
  gapAlert(kind, gaps) {
    const { esc, h } = App.UI;
    const label = kind === 'wc' ? 'WC' : 'IRR';
    if (gaps.tooWide) return h(`<div class="notice warning">${label} #s on file run from ${esc(gaps.min)} to ${esc(gaps.max)} — one of them is probably a typo, so missing numbers aren't listed.</div>`);
    if (!gaps.missing.length) return null;
    const shown = gaps.missing.slice(0, 12);
    const el = h(`
      <div class="notice warning gap-alert">
        <div><strong>${gaps.missing.length === 1 ? `${label} #${esc(gaps.missing[0])} missing` : `${gaps.missing.length} ${label} #s missing`}</strong>
          <span class="muted"> — between ${label} #${esc(gaps.min)} and #${esc(gaps.max)}</span></div>
        <ul>${shown.map((n) => `<li data-n="${esc(n)}"><span>${label} #${esc(n)} missing</span>
          ${kind === 'wc' ? '<button type="button" class="small" data-a="void">Record as void</button>' : ''}
          <button type="button" class="small" data-a="skip">Skipped on purpose</button></li>`).join('')}</ul>
        ${gaps.missing.length > shown.length ? `<div class="muted">…and ${gaps.missing.length - shown.length} more.</div>` : ''}
      </div>`);
    el.querySelectorAll('li[data-n]').forEach((li) => {
      const n = li.dataset.n;
      const on = (a, fn) => { const b = li.querySelector(`[data-a="${a}"]`); if (b) b.addEventListener('click', async () => { b.disabled = true; await fn(); App.rerender(); }); };
      on('void', () => App.Store.recordVoidWc(n));
      on('skip', () => App.Store.markSkipped(kind, n));
    });
    return el;
  },

  // ------------------------------------------------------------------ sortable, filterable lists
  /** Sort/filter state per list (by the table's data-list name), kept while the app is open. */
  listState: {},

  /** Sort value for a cell's text: dates, months and numbers compare as such; blanks sort last. */
  sortValue(text) {
    const t = String(text || '').trim();
    if (!t || t === '—' || t === '?') return null;
    let m = /^(\d{1,2})[./](\d{1,2})[./](\d{2,4})\b/.exec(t);
    if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return y * 10000 + +m[1] * 100 + +m[2]; }
    m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
    if (m) return +m[1] * 10000 + +m[2] * 100 + +m[3];
    m = /^([A-Za-z]{3,})\.?\s+(\d{4})\b/.exec(t);
    if (m) { const i = App.Models.MONTH_NAMES.findIndex((n) => n.toLowerCase().startsWith(m[1].toLowerCase().slice(0, 3))); if (i >= 0) return +m[2] * 10000 + (i + 1) * 100; }
    m = /^[−-]?\$?\s*[\d,]+(\.\d+)?/.exec(t.replace(/^(Due|PO sent)\s+/i, ''));
    if (m && /\d/.test(m[0])) { const n = Number(m[0].replace(/[^\d.−-]/g, '').replace('−', '-')); if (Number.isFinite(n)) return n; }
    return t.toLowerCase();
  },

  /** Adds header-click sorting and a per-column filter row to every table[data-list] inside `root`. */
  enhanceLists(root) { root.querySelectorAll('table[data-list]').forEach((t) => App.UI.enhanceTable(t)); },

  enhanceTable(table) {
    if (table.dataset.enhanced || !table.tHead || !table.tBodies[0]) return;
    table.dataset.enhanced = '1';
    const UI = App.UI;
    const key = table.dataset.list;
    const st = UI.listState[key] = UI.listState[key] || { col: null, dir: 1, filters: {}, open: false };
    const headRow = table.tHead.rows[table.tHead.rows.length - 1];
    const ths = [...headRow.cells];
    const body = table.tBodies[0];
    // a row plus the rows that belong to it (company details, audit math) move together
    const groups = [];
    [...body.rows].forEach((r) => { if (r.matches('.details-row, .math-row, [data-attach]') && groups.length) groups[groups.length - 1].push(r); else groups.push([r]); });
    const fixed = groups.filter((g) => g[0].matches('[data-fixed], .new-row'));
    const rows = groups.filter((g) => !g[0].matches('[data-fixed], .new-row'));
    if (rows.length < 2) { delete table.dataset.enhanced; return; }
    const cellText = (row, i) => {
      const c = row.cells[i]; if (!c) return '';
      if (c.dataset.value !== undefined) return c.dataset.value; // a cell can give a clean value (e.g. a name without its badge)
      const sel = c.querySelector('select'); if (sel) return sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex].text : '';
      const inp = c.querySelector('input:not([type=checkbox]):not([type=hidden]), textarea'); if (inp) return inp.value;
      return c.textContent.replace(/\s+/g, ' ').trim();
    };
    const usable = ths.map((th) => !!th.textContent.trim() && !th.hasAttribute('data-nosort') && !th.querySelector('input'));

    // toolbar above the table: Filter toggle, count, clear
    const bar = UI.h(`<div class="list-bar"><button type="button" class="small" data-a="toggle">Filter</button>
      <span class="muted" data-role="count"></span><button type="button" class="linklike small" data-a="clear" hidden>Clear filters</button></div>`);
    (table.closest('.table-scroll') || table).before(bar);

    // filter row: a dropdown for columns with a few distinct values, otherwise a text box
    const fr = document.createElement('tr'); fr.className = 'filter-row';
    ths.forEach((th, i) => {
      const cell = document.createElement('th');
      if (usable[i]) {
        const values = [...new Set(rows.map((g) => cellText(g[0], i)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
        let ctl;
        if (values.length > 1 && values.length <= 12 && values.every((v) => v.length <= 40)) {
          ctl = document.createElement('select');
          ctl.innerHTML = `<option value="">All</option>${values.map((v) => `<option>${UI.esc(v)}</option>`).join('')}`;
          ctl.dataset.exact = '1';
        } else {
          ctl = document.createElement('input'); ctl.type = 'search'; ctl.placeholder = 'Filter'; ctl.size = 1;
        }
        ctl.setAttribute('aria-label', `Filter ${th.textContent.trim()}`);
        ctl.value = st.filters[i] || '';
        ctl.addEventListener('input', () => { st.filters[i] = ctl.value; apply(); });
        cell.append(ctl);
      }
      fr.append(cell);
    });
    table.tHead.append(fr);

    ths.forEach((th, i) => {
      if (!usable[i]) return;
      th.classList.add('sortable'); th.tabIndex = 0; th.title = 'Sort';
      const go = () => { if (st.col === i) st.dir = -st.dir; else { st.col = i; st.dir = 1; } apply(); };
      th.addEventListener('click', (e) => { if (!e.target.closest('input, select, button, a')) go(); });
      th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
    bar.querySelector('[data-a="toggle"]').addEventListener('click', () => { st.open = !st.open; apply(); });
    bar.querySelector('[data-a="clear"]').addEventListener('click', () => {
      st.filters = {}; fr.querySelectorAll('input, select').forEach((c) => { c.value = ''; }); apply();
    });

    function apply() {
      const active = Object.entries(st.filters).filter(([, v]) => v);
      let shownCount = 0;
      rows.forEach((g) => {
        const ok = active.every(([i, v]) => {
          const t = cellText(g[0], Number(i));
          const f = fr.cells[Number(i)].firstElementChild;
          return f && f.dataset.exact ? t === v : t.toLowerCase().includes(v.toLowerCase());
        });
        g.forEach((r) => r.classList.toggle('is-filtered', !ok));
        if (ok) shownCount += 1;
      });
      if (st.col !== null && usable[st.col]) {
        const val = (g) => UI.sortValue(cellText(g[0], st.col));
        const sorted = [...rows].sort((a, b) => {
          const x = val(a); const y = val(b);
          if (x === null && y === null) return 0; if (x === null) return 1; if (y === null) return -1;
          if (typeof x === 'number' && typeof y === 'number') return (x - y) * st.dir;
          return String(x).localeCompare(String(y), 'en', { numeric: true }) * st.dir;
        });
        [...sorted, ...fixed].forEach((g) => g.forEach((r) => body.append(r)));
      }
      ths.forEach((th, i) => {
        th.classList.toggle('sorted-asc', st.col === i && st.dir === 1);
        th.classList.toggle('sorted-desc', st.col === i && st.dir === -1);
        if (usable[i]) th.setAttribute('aria-sort', st.col === i ? (st.dir === 1 ? 'ascending' : 'descending') : 'none');
      });
      fr.hidden = !(st.open || active.length);
      bar.querySelector('[data-a="toggle"]').classList.toggle('primary', !fr.hidden);
      bar.querySelector('[data-a="clear"]').hidden = !active.length;
      bar.querySelector('[data-role="count"]').textContent = active.length ? `Showing ${shownCount} of ${rows.length}` : `${rows.length} rows · click a column heading to sort`;
    }
    apply();
  },

  go(hash) { if (window.location.hash === hash) App.rerender(); else window.location.hash = hash; },
};
