window.App = window.App || {};
App.Pages = App.Pages || {};

App.Pages.settings = (function () {
  let msg = null;

  /** A simple editable list: rows of inputs with Save / Delete, plus an add row. */
  function listPanel({ title, intro, items, fields, onSave, onDelete, onAdd, onMove, canDelete }) {
    const { h, esc } = App.UI;
    const input = (f, v) => (f.options
      ? `<select data-f="${f.key}">${App.UI.options(f.options.map((o) => ({ value: o, label: o })), v)}</select>`
      : `<input data-f="${f.key}" value="${esc(v)}" placeholder="${esc(f.label)}">`);
    const el = h(`
      <div class="panel">
        <h2>${esc(title)}</h2>
        ${intro ? `<p class="muted mt-0">${intro}</p>` : ''}
        ${items.length ? `<table><thead><tr>${fields.map((f) => `<th>${esc(f.label)}</th>`).join('')}<th></th></tr></thead><tbody>
          ${items.map((it, i) => `<tr data-i="${i}">${fields.map((f) => `<td>${f.readOnly && f.readOnly(it) ? esc(it[f.key]) : input(f, it[f.key])}</td>`).join('')}
            <td class="row">
              ${onMove ? `<button type="button" data-a="up" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" data-a="down" ${i === items.length - 1 ? 'disabled' : ''}>↓</button>` : ''}
              <button type="button" data-a="save">Save</button>
              ${!canDelete || canDelete(it) === true ? '<button type="button" class="danger" data-a="delete">Delete</button>' : `<span class="muted">${esc(canDelete(it))}</span>`}
            </td></tr>`).join('')}
        </tbody></table>` : '<p class="muted">None yet.</p>'}
        <div class="field-row" data-role="add">${fields.map((f) => `<div class="field"><label>${esc(f.label)}</label>${input(f, f.options ? f.options[0] : '')}</div>`).join('')}
          <div class="field"><label>&nbsp;</label><button type="button" class="primary" data-a="add">Add</button></div></div>
      </div>`);
    const read = (scope) => Object.fromEntries(fields.map((f) => { const x = scope.querySelector(`[data-f="${f.key}"]`); return [f.key, x ? x.value.trim() : undefined]; }).filter(([, v]) => v !== undefined));
    el.querySelectorAll('tbody tr').forEach((tr) => {
      const it = items[Number(tr.dataset.i)];
      const on = (sel, fn) => { const b = tr.querySelector(sel); if (b) b.addEventListener('click', fn); };
      on('[data-a="save"]', () => onSave(it, read(tr)));
      on('[data-a="delete"]', () => onDelete(it));
      on('[data-a="up"]', () => onMove(it, -1));
      on('[data-a="down"]', () => onMove(it, 1));
    });
    const addRow = el.querySelector('[data-role="add"]');
    el.querySelector('[data-a="add"]').addEventListener('click', () => onAdd(read(addRow)));
    return el;
  }

  const done = (text, kind = 'ok') => { msg = { text, kind }; App.rerender(); };

  return {
    async render(container) {
      const { h, esc, header } = App.UI;
      const data = await App.Store.loadAll();
      container.append(header('Settings & Backup'));
      if (msg) { container.append(App.UI.notice(msg.text, msg.kind)); msg = null; }

      // ---- facility
      const prof = h(`
        <form class="panel">
          <h2>Facility profile</h2>
          <div class="field-row">
            <div class="field" style="flex:2"><label>Recycler name</label><input name="recyclerName" value="${esc(data.profile.recyclerName)}"></div>
            <div class="field"><label>Recycler CEWID #</label><input name="cewID" value="${esc(data.profile.cewID)}"></div>
          </div>
          <button type="submit" class="primary">Save profile</button>
        </form>`);
      prof.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(prof);
        await App.DB.put('facilityProfile', { ...data.profile, id: 'profile', recyclerName: String(fd.get('recyclerName')).trim(), cewID: String(fd.get('cewID')).trim() });
        done('Profile saved.');
      });
      container.append(prof);

      // ---- WC types
      const typeUse = (id) => data.wcs.filter((w) => w.typeId === id).length;
      container.append(listPanel({
        title: 'WC types',
        intro: 'Transfer, Residual Shipment and Inventory Check are built in. Types you add here are simple WCs with a number, date, company, status, notes and attachments.',
        items: data.wcTypes,
        fields: [{ key: 'name', label: 'Name' }],
        canDelete: (t) => (t.builtin ? 'built in' : (typeUse(t.id) ? `used by ${typeUse(t.id)} WC(s)` : true)),
        onSave: async (t, v) => { if (!v.name) return; await App.DB.put('wcTypes', { ...t, name: v.name }); done('WC type saved.'); },
        onDelete: async (t) => { if (!confirm(`Delete the "${t.name}" type?`)) return; await App.DB.delete('wcTypes', t.id); done('WC type deleted.'); },
        onAdd: async (v) => {
          if (!v.name) return;
          if (data.wcTypes.some((t) => App.Logic.norm(t.name) === App.Logic.norm(v.name))) { done(`"${v.name}" already exists.`, 'error'); return; }
          await App.DB.add('wcTypes', { name: v.name, kind: 'generic', builtin: false });
          done(`Added the "${v.name}" WC type.`);
        },
      }));

      // ---- statuses
      const statusUse = (id) => data.wcs.filter((w) => w.statusId === id).length;
      container.append(listPanel({
        title: 'WC statuses',
        intro: 'Your own list — for example Pending IRR, WC made, Done, Paid. Shown in this order everywhere.',
        items: data.wcStatuses,
        fields: [{ key: 'name', label: 'Name' }],
        onSave: async (s, v) => { if (!v.name) return; await App.DB.put('wcStatuses', { ...s, name: v.name }); done('Status saved.'); },
        onDelete: async (s) => {
          const n = statusUse(s.id);
          if (!confirm(`Delete the "${s.name}" status?${n ? ` ${n} WC(s) using it will go back to no status.` : ''}`)) return;
          const affected = data.wcs.filter((w) => w.statusId === s.id).map((w) => ({ ...w, statusId: null }));
          await App.DB.bulkPut('wcs', affected);
          await App.DB.delete('wcStatuses', s.id);
          App.Pages.wc.reset();
          done('Status deleted.');
        },
        onMove: async (s, dir) => {
          const list = data.wcStatuses.slice();
          const i = list.findIndex((x) => x.id === s.id); const j = i + dir;
          if (j < 0 || j >= list.length) return;
          [list[i], list[j]] = [list[j], list[i]];
          await App.DB.bulkPut('wcStatuses', list.map((x, k) => ({ ...x, order: k })));
          App.rerender();
        },
        onAdd: async (v) => {
          if (!v.name) return;
          await App.DB.add('wcStatuses', { name: v.name, order: data.wcStatuses.length });
          done(`Added the "${v.name}" status.`);
        },
      }));

      // ---- materials
      const matUse = (id) => data.wcs.filter((w) => ((w.shipment || w.inventory || {}).lines || []).some((l) => l.materialId === id)).length;
      container.append(listPanel({
        title: 'Materials',
        intro: 'Used on residual-shipment and inventory WCs. The column decides where the weight lands on the 196B; pick "Not a CEW residual" for things like printers or PC towers that ship on the same WC.',
        items: data.materials,
        fields: [{ key: 'name', label: 'Material' }, { key: 'category', label: '196B column', options: App.Logic.RESIDUAL_CATEGORIES }],
        canDelete: (m) => (matUse(m.id) ? `on ${matUse(m.id)} WC(s)` : true),
        onSave: async (m, v) => { if (!v.name) return; await App.DB.put('materials', { ...m, name: v.name, category: v.category }); done('Material saved.'); },
        onDelete: async (m) => { if (!confirm(`Delete ${m.name}?`)) return; await App.DB.delete('materials', m.id); done('Material deleted.'); },
        onAdd: async (v) => {
          if (!v.name) return;
          if (data.materials.some((m) => App.Logic.norm(m.name) === App.Logic.norm(v.name))) { done(`${v.name} already exists.`, 'error'); return; }
          await App.DB.add('materials', { name: v.name, category: v.category });
          done(`Added ${v.name}.`);
        },
      }));

      // ---- backup
      const backup = h(`
        <div class="panel">
          <h2>Backup</h2>
          <p class="muted mt-0">Everything lives only in this browser. Download a backup regularly — it includes attached files.</p>
          <div class="row"><button type="button" class="primary" data-a="download">Download backup</button></div>
          <div class="field-row">
            <div class="field" style="flex:2"><label>Restore from a backup file (replaces everything)</label><input type="file" accept=".json,application/json" data-f="file"></div>
            <div class="field"><label>&nbsp;</label><button type="button" data-a="restore">Restore</button></div>
          </div>
        </div>`);
      backup.querySelector('[data-a="download"]').addEventListener('click', () => App.Backup.downloadBackup());
      backup.querySelector('[data-a="restore"]').addEventListener('click', async () => {
        const file = backup.querySelector('[data-f="file"]').files[0];
        if (!file) return;
        if (!confirm('Replace ALL current data with this backup?')) return;
        try {
          await App.Backup.importFromFile(file);
          await App.Store.migrate();
          App.Pages.wc.reset();
          done('Backup restored.');
        } catch (err) { done(`Restore failed: ${App.UI.errText(err)}`, 'error'); }
      });
      container.append(backup);

      const erase = h(`
        <details class="panel"><summary>Erase everything</summary>
          <p class="muted">Deletes every record in this browser. Download a backup first.</p>
          <button type="button" class="danger" data-a="erase">Erase all data</button>
        </details>`);
      erase.querySelector('[data-a="erase"]').addEventListener('click', async () => {
        if (!confirm('Erase ALL data in this browser? This cannot be undone.')) return;
        if (prompt('Type ERASE to confirm') !== 'ERASE') return;
        await App.DB.clearAll();
        await App.Store.migrate();
        App.setPeriod(null);
        App.Pages.wc.reset();
        done('All data erased.');
      });
      container.append(erase);
    },
  };
})();
