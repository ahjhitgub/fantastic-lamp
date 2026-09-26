window.App = window.App || {};
App.Pages = App.Pages || {};

/**
 * Customers and other companies: collectors, handlers, shipping destinations.
 * Holds customer details, their own rates (overriding the price list), and
 * saved misspellings so cancellation-log entries still match.
 */
App.Pages.companies = (function () {
  let editingId = null;
  let msg = null;
  const RATE_COLUMNS = [['lcdled', 'LCD/LED'], ['crt', 'CRT'], ['plasma', 'PLASMA']];

  function edit(id) { editingId = id; App.UI.go('#/companies'); window.scrollTo(0, 0); }

  function rateCell(c, item) {
    if (!item) return '<span class="muted">—</span>';
    const r = (c.rates || {})[item.id];
    if (!r) return '<span class="muted">list</span>';
    if (r.variable) return '<span class="badge warn">variable</span>';
    return App.Logic.rateText(App.Logic.parseMoney(r.rate));
  }

  function truckingText(td) {
    if (!td || td.amount === '' || td.amount == null) return '';
    return td.basis === 'percent' ? `${td.amount}%` : td.basis === 'flat' ? `$${td.amount} flat` : `$${td.amount}/lb`;
  }

  // ---------------------------------------------------------------- add / edit form
  function buildForm(data, index) {
    const { h, esc, options } = App.UI;
    const L = App.Logic;
    const c = data.companies.find((x) => x.id === editingId) || null;
    const v = c || { roles: [], rates: {}, truckingDeduction: { amount: '', basis: 'perLb' } };
    const td = v.truckingDeduction || { amount: '', basis: 'perLb' };
    const input = (name, label, extra = '') => `<div class="field"><label>${label}</label><input name="${name}" value="${esc(v[name])}" ${extra}></div>`;
    const el = h(`
      <form class="panel">
        <div class="row spread"><h2>${c ? `Edit ${esc(c.name)}` : 'Add a company'}</h2>${c ? '<button type="button" data-a="cancel">Cancel</button>' : ''}</div>
        <div class="field-row">
          ${input('name', 'Company', 'required style="min-width:220px"')}
          ${input('cewId', 'CEWID #')}
          ${input('owner', 'Owner')}
          ${input('admin', 'Admin')}
        </div>
        <div class="row">${App.Models.COMPANY_ROLES.map((r) => `<label class="row"><input type="checkbox" name="role" value="${r.key}" ${(v.roles || []).includes(r.key) ? 'checked' : ''}> ${esc(r.label)}</label>`).join('')}</div>
        <div class="field-row">
          ${input('sourceLogSystem', 'Source log system')}
          ${input('primaryLanguage', 'Primary language')}
          <div class="field"><label>Pick up or drop off material</label><select name="materialMode">${options(L.MATERIAL_MODES.map(([value, label]) => ({ value, label })), v.materialMode, '—')}</select></div>
          <div class="field"><label>Trucking deduction <span class="muted">(pick-ups)</span></label>
            <div class="row"><input name="truckAmount" type="number" step="0.0001" min="0" value="${esc(td.amount)}" style="width:100px">
            <select name="truckBasis">${options(L.TRUCKING_BASES.map(([value, label]) => ({ value, label })), td.basis || 'perLb')}</select></div></div>
          <div class="field"><label>CBEP</label><label class="row"><input type="checkbox" name="cbepEnrolled" ${v.cbepEnrolled ? 'checked' : ''}> Enrolled</label></div>
        </div>
        <div class="field-row">
          ${input('phone', 'Phone')}
          ${input('email', 'Email')}
          <div class="field" style="flex:2"><label>Address</label><textarea name="address" rows="2">${esc(v.address)}</textarea></div>
        </div>
        <h3>Customer rates <span class="muted">— leave blank to use the price list</span></h3>
        ${data.priceItems.length ? `<div class="table-scroll"><table class="lines"><thead><tr><th>Item</th><th class="num">List drop-off</th><th class="num">List pick-up</th><th class="num">This customer's rate</th><th>Variable</th></tr></thead><tbody>
          ${data.priceItems.map((p) => { const r = (v.rates || {})[p.id] || {}; return `<tr data-item="${p.id}">
            <td>${esc(p.name)} <span class="muted">/${p.basis === 'unit' ? 'unit' : 'lb'}</span></td>
            <td class="num">${p.variable ? 'variable' : L.rateText(L.parseMoney(p.dropOff))}</td><td class="num">${p.variable ? 'variable' : L.rateText(L.parseMoney(p.pickUp))}</td>
            <td><input data-f="rate" type="number" step="0.0001" min="0" value="${esc(r.rate)}"></td>
            <td><label class="row"><input type="checkbox" data-f="variable" ${r.variable ? 'checked' : ''}> set at inspection</label></td></tr>`; }).join('')}
        </tbody></table></div>` : '<p class="muted">Add items on the <a href="#/prices">price list</a> first.</p>'}
        <div class="field"><label>Notes</label><textarea name="notes" rows="2">${esc(v.notes)}</textarea></div>
        <button type="submit" class="primary">${c ? 'Save changes' : 'Add company'}</button>
        <div data-role="err"></div>
      </form>`);

    const cancel = el.querySelector('[data-a="cancel"]');
    if (cancel) cancel.addEventListener('click', () => { editingId = null; App.rerender(); });
    el.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(el);
      const name = String(fd.get('name')).replace(/\s+/g, ' ').trim();
      const r = L.resolveCompany(name, index);
      if (r.company && (!c || r.company.id !== c.id)) {
        el.querySelector('[data-role="err"]').replaceChildren(App.UI.notice(`That matches ${r.company.name}, which is already saved${c ? ' — use Merge instead' : ''}.`, 'error'));
        return;
      }
      const rates = {};
      el.querySelectorAll('tr[data-item]').forEach((tr) => {
        const rate = tr.querySelector('[data-f="rate"]').value.trim();
        const variable = tr.querySelector('[data-f="variable"]').checked;
        if (rate !== '' || variable) rates[tr.dataset.item] = { rate, variable };
      });
      const rec = {
        ...(c || { aliases: [] }),
        name,
        cewId: String(fd.get('cewId') || '').trim(),
        roles: fd.getAll('role'),
        owner: String(fd.get('owner') || '').trim(),
        admin: String(fd.get('admin') || '').trim(),
        sourceLogSystem: String(fd.get('sourceLogSystem') || '').trim(),
        primaryLanguage: String(fd.get('primaryLanguage') || '').trim(),
        materialMode: String(fd.get('materialMode') || ''),
        truckingDeduction: { amount: String(fd.get('truckAmount') || '').trim(), basis: String(fd.get('truckBasis') || 'perLb') },
        cbepEnrolled: fd.get('cbepEnrolled') === 'on',
        phone: String(fd.get('phone') || '').trim(),
        email: String(fd.get('email') || '').trim(),
        address: String(fd.get('address') || '').trim(),
        notes: String(fd.get('notes') || '').trim(),
        rates,
      };
      if (c) await App.DB.put('companies', rec); else await App.DB.add('companies', rec);
      App.Pages.wc.reset();
      msg = { kind: 'ok', text: `${c ? 'Saved' : 'Added'} ${name}.` };
      editingId = null;
      App.rerender();
    });
    return el;
  }

  // ---------------------------------------------------------------- misspellings / merge / delete (edit mode)
  function buildManage(data, index, uses) {
    const { h, esc, options } = App.UI;
    const c = data.companies.find((x) => x.id === editingId);
    const el = h(`
      <div class="panel">
        <h2>Misspellings, merge, delete — ${esc(c.name)}</h2>
        <p>${(c.aliases || []).map((a, i) => `<span class="chip">${esc(a)} <button type="button" class="ghost" data-alias="${i}" title="Remove">✕</button></span>`).join(' ') || '<span class="muted">No saved misspellings.</span>'}</p>
        <div class="field-row">
          <div class="field"><label>Add a misspelling</label><input data-f="alias"></div>
          <div class="field"><label>&nbsp;</label><button type="button" data-a="add-alias">Add</button></div>
          <div class="field"><label>Merge this company into</label><select data-f="mergeInto">${options(data.companies.filter((x) => x.id !== c.id).map((x) => ({ value: x.id, label: x.name })), '', '— pick —')}</select></div>
          <div class="field"><label>&nbsp;</label><button type="button" data-a="merge">Merge</button></div>
          <div class="field"><label>&nbsp;</label><button type="button" class="danger" data-a="delete">Delete company</button></div>
        </div>
      </div>`);
    el.querySelectorAll('[data-alias]').forEach((b) => b.addEventListener('click', async () => {
      await App.DB.put('companies', { ...c, aliases: (c.aliases || []).filter((_, i) => i !== Number(b.dataset.alias)) });
      App.rerender();
    }));
    el.querySelector('[data-a="add-alias"]').addEventListener('click', async () => {
      const v = el.querySelector('[data-f="alias"]').value.trim();
      if (!v) return;
      const r = App.Logic.resolveCompany(v, index);
      if (r.company && r.company.id !== c.id) { msg = { kind: 'error', text: `"${v}" already belongs to ${r.company.name}.` }; App.rerender(); return; }
      await App.Store.addAliases(c.id, [v]);
      App.rerender();
    });
    el.querySelector('[data-a="merge"]').addEventListener('click', async () => {
      const into = data.companies.find((x) => x.id === Number(el.querySelector('[data-f="mergeInto"]').value));
      if (!into) return;
      if (!confirm(`Merge ${c.name} into ${into.name}? "${c.name}" becomes a saved misspelling of ${into.name}, and every WC pointing at it will point at ${into.name}. ${into.name}'s own details and rates are kept.`)) return;
      await App.Store.mergeCompanies(c.id, into.id);
      App.Pages.wc.reset();
      editingId = null; msg = { kind: 'ok', text: `Merged ${c.name} into ${into.name}.` };
      App.rerender();
    });
    el.querySelector('[data-a="delete"]').addEventListener('click', async () => {
      if (uses.get(c.id)) { msg = { kind: 'error', text: `${c.name} is used on ${uses.get(c.id)} WC(s) — merge it into another company instead of deleting.` }; App.rerender(); return; }
      if (!confirm(`Delete ${c.name}?`)) return;
      await App.DB.delete('companies', c.id);
      editingId = null;
      App.rerender();
    });
    return el;
  }

  // ---------------------------------------------------------------- names in the logs that don't match
  function buildUnmatched(data, units, index) {
    const { h, esc, fmt, options } = App.UI;
    const L = App.Logic;
    const counts = new Map();
    units.forEach((u) => {
      const text = (u.company || '').trim(); if (!text) return;
      const r = L.resolveCompany(text, index);
      if (r.match === 'exact') return;
      const cur = counts.get(text) || { text, n: 0, r };
      cur.n += 1; counts.set(text, cur);
    });
    const names = [...counts.values()].sort((a, b) => (a.r.match === b.r.match ? a.text.localeCompare(b.text) : (a.r.match === 'none' ? -1 : 1)));
    if (!names.length) return null;
    const companyOpts = data.companies.map((c) => ({ value: c.id, label: c.name }));
    const el = h(`
      <div class="panel">
        <h2>Company names in the logs that need attention</h2>
        <p class="muted mt-0">Check the spellings that belong to the same company, pick the company, and apply. The misspellings are saved so future logs match automatically.</p>
        <table><thead><tr><th></th><th>As written in the logs</th><th class="num">Units</th><th>Status</th><th></th></tr></thead><tbody>
          ${names.map((x, i) => `<tr data-i="${i}">
            <td><input type="checkbox" data-role="pick"></td>
            <td><strong>${esc(x.text)}</strong></td><td class="num">${fmt(x.n)}</td>
            <td>${x.r.match === 'alias' ? `<span class="badge warn">misspelling of ${esc(x.r.company.name)}</span>` : '<span class="badge flag">no match</span>'}</td>
            <td>${x.r.match === 'none' ? '<button type="button" data-a="new">Add as new company</button>' : ''}</td></tr>`).join('')}
        </tbody></table>
        <div class="field-row">
          <div class="field"><label>Map checked names to</label><select data-f="target">${options(companyOpts, '', companyOpts.length ? '— pick a company —' : '(add a company first)')}</select></div>
          <div class="field" style="flex:2"><label>&nbsp;</label><label class="row"><input type="checkbox" data-f="rewrite" checked> Also correct the name on those log entries (the original spelling is kept for the audit trail)</label></div>
          <div class="field"><label>&nbsp;</label><button type="button" class="primary" data-a="map">Apply</button></div>
        </div>
      </div>`);
    el.querySelector('[data-a="map"]').addEventListener('click', async () => {
      const picked = [...el.querySelectorAll('tbody tr')].filter((tr) => tr.querySelector('[data-role="pick"]').checked).map((tr) => names[Number(tr.dataset.i)].text);
      const targetId = Number(el.querySelector('[data-f="target"]').value);
      if (!picked.length || !targetId) { msg = { kind: 'warning', text: 'Check at least one name and pick a company.' }; App.rerender(); return; }
      const target = data.companies.find((c) => c.id === targetId);
      await App.Store.addAliases(targetId, picked);
      const n = el.querySelector('[data-f="rewrite"]').checked ? await App.Store.rewriteUnitCompanies(picked, target.name) : 0;
      msg = { kind: 'ok', text: `Saved ${picked.length} spelling(s) under ${target.name}${n ? ` and corrected ${n} log entr${n === 1 ? 'y' : 'ies'}` : ''}.` };
      App.rerender();
    });
    el.querySelectorAll('[data-a="new"]').forEach((b) => b.addEventListener('click', async () => {
      const text = names[Number(b.closest('tr').dataset.i)].text;
      const name = prompt('Company name as it should be saved:', text);
      if (!name || !name.trim()) return;
      const id = await App.DB.add('companies', { name: name.replace(/\s+/g, ' ').trim(), cewId: '', roles: ['handler'], aliases: [], rates: {} });
      if (L.norm(name) !== L.norm(text)) await App.Store.addAliases(id, [text]);
      editingId = id;
      msg = { kind: 'ok', text: `Added ${name.trim()} as a handler — fill in the rest of its details below.` };
      App.rerender();
      window.scrollTo(0, 0);
    }));
    return el;
  }

  // ---------------------------------------------------------------- customer sheet import
  function buildImport(data, index) {
    const { h } = App.UI;
    const L = App.Logic;
    const el = h(`
      <details class="panel">
        <summary><strong>Import customers from a spreadsheet</strong></summary>
        <p class="muted">Copy the rows from your customer sheet, including the header row, and paste them here. Recognized columns:
          Company, LCD/LED, CRT, PLASMA, owner, CEWID #, ADMIN, Source Log System, Primary Language, Pick up or drop off material, Trucking Deduction, CBEP Enrolled?, CBEP Price/Lb.
          Existing companies (matched by name or a saved misspelling) are updated; blank cells don't erase anything. A price cell with words in it (like "market") is saved as a variable rate.</p>
        <div class="field"><textarea data-role="text" rows="6"></textarea></div>
        <button type="button" class="primary" data-a="import">Import customers</button>
      </details>`);
    el.querySelector('[data-a="import"]').addEventListener('click', async () => {
      const { rows, skipped, columns } = L.parseCustomerSheet(el.querySelector('[data-role="text"]').value);
      if (!rows.length) { msg = { kind: 'error', text: 'Nothing to import — include the header row and at least one customer.' }; App.rerender(); return; }
      const items = await App.DB.getAll('priceItems');
      const ensureItem = async (appliesTo) => {
        let it = items.find((p) => p.appliesTo === appliesTo);
        if (!it) {
          const label = (L.PRICE_KEYS.find(([k]) => k === appliesTo) || [null, appliesTo])[1];
          it = { name: label, appliesTo, basis: 'lb', dropOff: '', pickUp: '', variable: false, notes: '' };
          it.id = await App.DB.add('priceItems', it);
          items.push(it);
        }
        return it;
      };
      let added = 0; let updated = 0; const notes = [];
      const fresh = await App.DB.getAll('companies');
      const idx = L.companyIndex(fresh);
      for (const row of rows) {
        const existing = L.resolveCompany(row.name, idx).company;
        const rec = existing ? { ...existing, rates: { ...(existing.rates || {}) } } : { name: row.name, roles: [], aliases: [], rates: {} };
        ['cewId', 'owner', 'admin', 'sourceLogSystem', 'primaryLanguage', 'materialMode'].forEach((k) => { if (columns.has(k) && row[k]) rec[k] = row[k]; });
        if (columns.has('trucking') && row.truckingDeduction.raw) {
          rec.truckingDeduction = { amount: row.truckingDeduction.amount, basis: row.truckingDeduction.basis };
          notes.push(`${row.name}: trucking "${row.truckingDeduction.raw}" read as ${truckingText(rec.truckingDeduction) || 'nothing'}`);
        }
        if (columns.has('cbepEnrolled')) rec.cbepEnrolled = row.cbepEnrolled;
        for (const [key, col] of [['lcdled', 'lcdled'], ['crt', 'crt'], ['plasma', 'plasma'], ['cbep', 'cbepRate']]) {
          const cell = row.rates[key];
          if (!columns.has(col) || !cell) continue;
          const it = await ensureItem(`cew:${key}`);
          rec.rates[it.id] = { rate: cell.rate, variable: cell.variable };
          if (cell.variable) notes.push(`${row.name}: ${it.name} "${cell.note}" saved as variable (set at inspection)`);
        }
        if (rec.cewId && !rec.roles.includes('collector')) rec.roles.push('collector');
        if (!rec.roles.length) rec.roles.push('handler');
        if (existing) { await App.DB.put('companies', rec); updated += 1; } else { rec.id = await App.DB.add('companies', rec); added += 1; idx.exact.set(L.norm(rec.name), rec); }
      }
      App.Pages.wc.reset();
      const skipText = skipped.length ? ` Skipped ${skipped.length} row(s) with no company name.` : '';
      msg = { kind: 'ok', text: `Imported ${rows.length} customer(s): ${added} added, ${updated} updated.${skipText}${notes.length ? ` Please check — ${notes.join('; ')}.` : ''}` };
      App.rerender();
    });
    return el;
  }

  // ---------------------------------------------------------------- customer table
  function buildTable(data, uses) {
    const { h, esc } = App.UI;
    const roleLabel = (k) => (App.Models.COMPANY_ROLES.find((r) => r.key === k) || {}).label || k;
    const itemFor = (key) => data.priceItems.find((p) => p.appliesTo === key);
    const modeName = (k) => (App.Logic.MATERIAL_MODES.find(([x]) => x === k) || [null, ''])[1];
    const el = h(`
      <div class="panel"><h2>Saved companies</h2>
        <p class="hint">Rate columns: <span class="muted">list</span> = uses the price list for pick-up or drop-off.</p>
        <div class="table-scroll"><table class="compact">
          <thead><tr><th>Company</th>${RATE_COLUMNS.map(([, l]) => `<th class="num">${l}</th>`).join('')}<th>Owner</th><th>CEWID #</th><th>Admin</th><th>Source log system</th><th>Primary language</th>
            <th>Pick up / drop off</th><th>Trucking deduction</th><th>CBEP enrolled?</th><th class="num">CBEP price/lb</th><th>Roles</th><th>Misspellings</th><th class="num">WCs</th><th></th></tr></thead>
          <tbody>${data.companies.map((c) => `<tr data-id="${c.id}">
            <td><strong>${esc(c.name)}</strong></td>
            ${RATE_COLUMNS.map(([k]) => `<td class="num">${rateCell(c, itemFor(`cew:${k}`))}</td>`).join('')}
            <td>${esc(c.owner)}</td><td>${esc(c.cewId)}</td><td>${esc(c.admin)}</td><td>${esc(c.sourceLogSystem)}</td><td>${esc(c.primaryLanguage)}</td>
            <td>${esc(modeName(c.materialMode))}</td><td>${esc(truckingText(c.truckingDeduction))}</td><td>${c.cbepEnrolled ? 'Yes' : ''}</td>
            <td class="num">${rateCell(c, itemFor('cew:cbep'))}</td>
            <td>${(c.roles || []).map((r) => `<span class="badge">${esc(roleLabel(r))}</span>`).join(' ')}</td>
            <td>${(c.aliases || []).map((a) => `<span class="chip">${esc(a)}</span>`).join(' ')}</td>
            <td class="num">${uses.get(c.id) || 0}</td>
            <td><button type="button" data-a="edit">Edit</button></td></tr>`).join('')}</tbody>
        </table></div></div>`);
    el.querySelectorAll('[data-a="edit"]').forEach((b) => b.addEventListener('click', () => edit(Number(b.closest('tr').dataset.id))));
    return el;
  }

  return {
    edit,
    async render(container) {
      const data = await App.Store.loadAll();
      const units = await App.DB.getAll('cancelledUnits');
      const index = App.Logic.companyIndex(data.companies);
      const uses = new Map();
      data.wcs.forEach((w) => new Set([w.companyId, w.transfer && w.transfer.collectorId, w.transfer && w.transfer.handlerId].filter(Boolean))
        .forEach((id) => uses.set(id, (uses.get(id) || 0) + 1)));
      if (editingId && !data.companies.some((c) => c.id === editingId)) editingId = null;

      container.append(App.UI.header('Companies', 'Customers (handlers and collectors) and shipping destinations — details, their own rates, and saved misspellings.'));
      if (msg) { container.append(App.UI.notice(msg.text, msg.kind)); msg = null; }
      container.append(buildForm(data, index));
      if (editingId) container.append(buildManage(data, index, uses));
      const unmatched = buildUnmatched(data, units, index);
      if (unmatched) container.append(unmatched);
      container.append(buildImport(data, index));
      if (data.companies.length) container.append(buildTable(data, uses));
      else container.append(App.UI.empty('No companies yet', 'Add one above, or import your customer sheet.'));
    },
  };
})();
