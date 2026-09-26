window.App = window.App || {};
App.Pages = App.Pages || {};

/**
 * Collectors, handlers and shipping destinations in one list. Misspellings seen in
 * the cancellation logs can be mapped onto a saved company (and optionally corrected).
 */
App.Pages.companies = (function () {
  let editingId = null;
  let msg = null;

  return {
    async render(container) {
      const { h, esc, fmt, options, header } = App.UI;
      const L = App.Logic;
      const data = await App.Store.loadAll();
      const units = await App.DB.getAll('cancelledUnits');
      const roles = App.Models.COMPANY_ROLES;
      const roleLabel = (k) => (roles.find((r) => r.key === k) || {}).label || k;
      const index = L.companyIndex(data.companies);
      const companyOpts = data.companies.map((c) => ({ value: c.id, label: c.name }));

      container.append(header('Companies', 'Collectors, handlers, and shipping destinations. Each company can have misspellings saved against it so log entries still match.'));
      if (msg) { container.append(App.UI.notice(msg.text, msg.kind)); msg = null; }

      // ---- names in the logs that don't match exactly
      const counts = new Map();
      units.forEach((u) => {
        const text = (u.company || '').trim(); if (!text) return;
        const r = L.resolveCompany(text, index);
        if (r.match === 'exact') return;
        const cur = counts.get(text) || { text, n: 0, r };
        cur.n += 1; counts.set(text, cur);
      });
      const names = [...counts.values()].sort((a, b) => (a.r.match === b.r.match ? a.text.localeCompare(b.text) : (a.r.match === 'none' ? -1 : 1)));
      const unmatched = h(`
        <div class="panel">
          <h2>Company names in the logs that need attention</h2>
          ${names.length ? `
            <p class="muted mt-0">Check the spellings that belong to the same company, pick the company, and apply. The misspellings are saved so future logs match automatically.</p>
            <table><thead><tr><th></th><th>As written in the logs</th><th class="num">Units</th><th>Status</th><th></th></tr></thead><tbody>
              ${names.map((x, i) => `<tr data-i="${i}">
                <td><input type="checkbox" data-role="pick"></td>
                <td><strong>${esc(x.text)}</strong></td><td class="num">${fmt(x.n)}</td>
                <td>${x.r.match === 'alias' ? `<span class="badge warn">misspelling of ${esc(x.r.company.name)}</span>` : '<span class="badge flag">no match</span>'}</td>
                <td>${x.r.match === 'none' ? '<button type="button" data-a="new">Add as new company</button>' : ''}</td></tr>`).join('')}
            </tbody></table>
            <div class="field-row">
              <div class="field"><label>Map checked names to</label><select data-f="target">${options(companyOpts, '', companyOpts.length ? '— pick a company —' : '(add a company below first)')}</select></div>
              <div class="field" style="flex:2"><label>&nbsp;</label><label class="row"><input type="checkbox" data-f="rewrite" checked> Also correct the name on those log entries (the original spelling is kept for the audit trail)</label></div>
              <div class="field"><label>&nbsp;</label><button type="button" class="primary" data-a="map">Apply</button></div>
            </div>` : '<p class="muted">Every company name in the cancellation logs matches a saved company exactly.</p>'}
        </div>`);
      if (names.length) {
        unmatched.querySelector('[data-a="map"]').addEventListener('click', async () => {
          const picked = [...unmatched.querySelectorAll('tbody tr')].filter((tr) => tr.querySelector('[data-role="pick"]').checked).map((tr) => names[Number(tr.dataset.i)].text);
          const targetId = Number(unmatched.querySelector('[data-f="target"]').value);
          if (!picked.length || !targetId) { msg = { kind: 'warning', text: 'Check at least one name and pick a company.' }; App.rerender(); return; }
          const target = data.companies.find((c) => c.id === targetId);
          await App.Store.addAliases(targetId, picked);
          let n = 0;
          if (unmatched.querySelector('[data-f="rewrite"]').checked) n = await App.Store.rewriteUnitCompanies(picked, target.name);
          msg = { kind: 'ok', text: `Saved ${picked.length} spelling(s) under ${target.name}${n ? ` and corrected ${n} log entr${n === 1 ? 'y' : 'ies'}` : ''}.` };
          App.rerender();
        });
        unmatched.querySelectorAll('[data-a="new"]').forEach((b) => b.addEventListener('click', async () => {
          const text = names[Number(b.closest('tr').dataset.i)].text;
          const name = prompt('Company name as it should be saved:', text);
          if (!name || !name.trim()) return;
          const id = await App.DB.add('companies', { name: name.replace(/\s+/g, ' ').trim(), cewId: '', roles: ['handler'], aliases: [] });
          if (L.norm(name) !== L.norm(text)) await App.Store.addAliases(id, [text]);
          editingId = id;
          msg = { kind: 'ok', text: `Added ${name.trim()} as a handler — set its roles and CEWID below.` };
          App.rerender();
        }));
      }
      container.append(unmatched);

      // ---- add
      const roleBoxes = (sel) => roles.map((r) => `<label class="row"><input type="checkbox" name="role" value="${r.key}" ${sel.includes(r.key) ? 'checked' : ''}> ${esc(r.label)}</label>`).join('');
      const add = h(`
        <form class="panel">
          <h2>Add a company</h2>
          <div class="field-row">
            <div class="field" style="flex:2"><label>Name</label><input name="name" required></div>
            <div class="field"><label>CEWID # <span class="muted">(collectors)</span></label><input name="cewId"></div>
          </div>
          <div class="row">${roleBoxes([])}</div>
          <button type="submit" class="primary">Add company</button>
          <div data-role="err"></div>
        </form>`);
      add.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(add);
        const name = String(fd.get('name')).replace(/\s+/g, ' ').trim();
        const r = L.resolveCompany(name, index);
        if (r.company) { add.querySelector('[data-role="err"]').replaceChildren(App.UI.notice(`That matches ${r.company.name}, which is already saved.`, 'error')); return; }
        await App.DB.add('companies', { name, cewId: String(fd.get('cewId') || '').trim(), roles: fd.getAll('role'), aliases: [] });
        msg = { kind: 'ok', text: `Added ${name}.` };
        App.rerender();
      });
      container.append(add);

      // ---- list
      if (!data.companies.length) { container.append(App.UI.empty('No companies yet', 'Add your collectors, handlers, and shipping destinations above.')); return; }
      const uses = new Map();
      data.wcs.forEach((w) => [w.companyId, w.transfer && w.transfer.collectorId, w.transfer && w.transfer.handlerId].filter(Boolean)
        .forEach((id) => uses.set(id, (uses.get(id) || 0) + 1)));
      const list = h(`
        <div class="panel"><h2>Saved companies</h2><div class="table-scroll"><table>
          <thead><tr><th>Name</th><th>CEWID #</th><th>Roles</th><th>Saved misspellings</th><th class="num">WCs</th><th></th></tr></thead>
          <tbody>${data.companies.map((c) => (editingId === c.id ? `
            <tr data-id="${c.id}" class="editing">
              <td><input data-f="name" value="${esc(c.name)}"></td>
              <td><input data-f="cewId" value="${esc(c.cewId)}"></td>
              <td>${roleBoxes(c.roles || [])}</td>
              <td>${(c.aliases || []).map((a, i) => `<span class="chip">${esc(a)} <button type="button" class="ghost" data-alias="${i}" title="Remove">✕</button></span>`).join(' ')}
                  <div class="row"><input data-f="alias" placeholder="add a misspelling"><button type="button" data-a="add-alias">Add</button></div></td>
              <td class="num">${uses.get(c.id) || 0}</td>
              <td><div class="row"><button type="button" class="primary" data-a="save">Save</button><button type="button" data-a="cancel">Done</button></div>
                <div class="row"><select data-f="mergeInto">${options(companyOpts.filter((o) => o.value !== c.id), '', 'Merge into…')}</select><button type="button" data-a="merge">Merge</button></div>
                <button type="button" class="danger" data-a="delete">Delete</button></td>
            </tr>` : `
            <tr data-id="${c.id}">
              <td><strong>${esc(c.name)}</strong></td><td>${esc(c.cewId) || '<span class="muted">—</span>'}</td>
              <td>${(c.roles || []).map((r) => `<span class="badge">${esc(roleLabel(r))}</span>`).join(' ')}</td>
              <td>${(c.aliases || []).map((a) => `<span class="chip">${esc(a)}</span>`).join(' ') || '<span class="muted">—</span>'}</td>
              <td class="num">${uses.get(c.id) || 0}</td>
              <td><button type="button" data-a="edit">Edit</button></td>
            </tr>`)).join('')}</tbody>
        </table></div></div>`);
      list.querySelectorAll('tbody tr').forEach((tr) => {
        const c = data.companies.find((x) => x.id === Number(tr.dataset.id));
        const on = (sel, fn) => { const b = tr.querySelector(sel); if (b) b.addEventListener('click', fn); };
        on('[data-a="edit"]', () => { editingId = c.id; App.rerender(); });
        on('[data-a="cancel"]', () => { editingId = null; App.rerender(); });
        on('[data-a="save"]', async () => {
          const name = tr.querySelector('[data-f="name"]').value.replace(/\s+/g, ' ').trim();
          if (!name) return;
          const clash = data.companies.find((x) => x.id !== c.id && L.norm(x.name) === L.norm(name));
          if (clash) { msg = { kind: 'error', text: `${clash.name} already exists — use Merge instead.` }; App.rerender(); return; }
          const updated = { ...c, name, cewId: tr.querySelector('[data-f="cewId"]').value.trim(), roles: [...tr.querySelectorAll('input[name="role"]:checked')].map((b) => b.value) };
          await App.DB.put('companies', updated);
          editingId = null; msg = { kind: 'ok', text: `Saved ${name}.` };
          App.rerender();
        });
        on('[data-a="add-alias"]', async () => {
          const v = tr.querySelector('[data-f="alias"]').value.trim();
          if (!v) return;
          const r = L.resolveCompany(v, index);
          if (r.company && r.company.id !== c.id) { msg = { kind: 'error', text: `"${v}" already belongs to ${r.company.name}.` }; App.rerender(); return; }
          await App.Store.addAliases(c.id, [v]);
          App.rerender();
        });
        tr.querySelectorAll('[data-alias]').forEach((b) => b.addEventListener('click', async () => {
          const aliases = (c.aliases || []).filter((_, i) => i !== Number(b.dataset.alias));
          await App.DB.put('companies', { ...c, aliases });
          App.rerender();
        }));
        on('[data-a="merge"]', async () => {
          const into = data.companies.find((x) => x.id === Number(tr.querySelector('[data-f="mergeInto"]').value));
          if (!into) return;
          if (!confirm(`Merge ${c.name} into ${into.name}? "${c.name}" becomes a saved misspelling of ${into.name}, and every WC pointing at it will point at ${into.name}.`)) return;
          await App.Store.mergeCompanies(c.id, into.id);
          editingId = null; msg = { kind: 'ok', text: `Merged ${c.name} into ${into.name}.` };
          App.rerender();
        });
        on('[data-a="delete"]', async () => {
          if (uses.get(c.id)) { msg = { kind: 'error', text: `${c.name} is used on ${uses.get(c.id)} WC(s) — merge it into another company instead of deleting.` }; App.rerender(); return; }
          if (!confirm(`Delete ${c.name}?`)) return;
          await App.DB.delete('companies', c.id);
          editingId = null;
          App.rerender();
        });
      });
      container.append(list);
    },
  };
})();
