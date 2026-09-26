window.App = window.App || {};
App.Pages = App.Pages || {};

/** Master price list: drop-off and pick-up rates, or "variable" (set at inspection). */
App.Pages.prices = (function () {
  let msg = null;

  function rowHtml(p) {
    const { esc, options } = App.UI;
    const L = App.Logic;
    return `
      <td><input data-f="name" value="${esc(p.name)}" style="min-width:160px"></td>
      <td><select data-f="appliesTo">${options(L.PRICE_KEYS.map(([value, label]) => ({ value, label })), p.appliesTo || 'other')}</select></td>
      <td><select data-f="basis">${options([{ value: 'lb', label: 'per lb' }, { value: 'unit', label: 'per unit' }], p.basis || 'lb')}</select></td>
      <td><input data-f="dropOff" type="number" step="0.0001" min="0" value="${esc(p.dropOff)}"></td>
      <td><input data-f="pickUp" type="number" step="0.0001" min="0" value="${esc(p.pickUp)}"></td>
      <td><label class="row"><input type="checkbox" data-f="variable" ${p.variable ? 'checked' : ''}> set at inspection</label></td>
      <td><input data-f="notes" value="${esc(p.notes)}" placeholder="e.g. follows copper market"></td>`;
  }

  function read(tr) {
    const val = (f) => tr.querySelector(`[data-f="${f}"]`);
    return {
      name: val('name').value.trim(), appliesTo: val('appliesTo').value, basis: val('basis').value,
      dropOff: val('dropOff').value.trim(), pickUp: val('pickUp').value.trim(), variable: val('variable').checked, notes: val('notes').value.trim(),
    };
  }

  function validate(rec, items, selfId) {
    if (!rec.name) return 'Give the item a name.';
    if (rec.appliesTo !== 'other' && items.some((p) => p.id !== selfId && p.appliesTo === rec.appliesTo)) {
      return `There's already a price-list item for ${(App.Logic.PRICE_KEYS.find(([k]) => k === rec.appliesTo) || [])[1]} — each CEW/non-CEW type can have only one.`;
    }
    return null;
  }

  return {
    async render(container) {
      const { h, esc } = App.UI;
      const L = App.Logic;
      const data = await App.Store.loadAll();
      container.append(App.UI.header('Price List', 'What we pay customers, by drop-off or pick-up. A customer\u2019s own rate (Companies page) overrides this; a rate typed on a transfer at inspection overrides both.'));
      if (msg) { container.append(App.UI.notice(msg.text, msg.kind)); msg = null; }

      const table = h(`
        <div class="panel">
          <h2>Master price list</h2>
          <p class="muted mt-0">"Applies to" links a row to the matching line on a transfer. Use <strong>Other (non-CEW) item</strong> for things like printers or mixed e-waste — you can have as many of those as you like and pick one on each transfer line.</p>
          <div class="table-scroll"><table class="lines">
            <thead><tr><th>Item</th><th>Applies to</th><th>Priced</th><th class="num">Drop-off $</th><th class="num">Pick-up $</th><th>Variable</th><th>Notes</th><th></th></tr></thead>
            <tbody>
              ${data.priceItems.map((p) => `<tr data-id="${p.id}">${rowHtml(p)}<td class="row"><button type="button" data-a="save">Save</button><button type="button" class="danger" data-a="delete">Delete</button></td></tr>`).join('')}
              <tr data-role="new" class="new-row">${rowHtml({ appliesTo: 'other', basis: 'lb' })}<td><button type="button" class="primary" data-a="add">Add</button></td></tr>
            </tbody>
          </table></div>
        </div>`);
      table.querySelectorAll('tr[data-id]').forEach((tr) => {
        const p = data.priceItems.find((x) => x.id === Number(tr.dataset.id));
        tr.querySelector('[data-a="save"]').addEventListener('click', async () => {
          const rec = read(tr);
          const err = validate(rec, data.priceItems, p.id);
          if (err) { msg = { kind: 'error', text: err }; App.rerender(); return; }
          await App.DB.put('priceItems', { ...p, ...rec });
          App.Pages.wc.reset();
          msg = { kind: 'ok', text: `Saved ${rec.name}.` };
          App.rerender();
        });
        tr.querySelector('[data-a="delete"]').addEventListener('click', async () => {
          const withRate = data.companies.filter((c) => c.rates && c.rates[p.id]);
          if (!confirm(`Delete ${p.name}?${withRate.length ? ` ${withRate.length} customer rate(s) for it will be removed too.` : ''}`)) return;
          await App.DB.bulkPut('companies', withRate.map((c) => { const rates = { ...c.rates }; delete rates[p.id]; return { ...c, rates }; }));
          await App.DB.delete('priceItems', p.id);
          App.Pages.wc.reset();
          msg = { kind: 'ok', text: `Deleted ${p.name}.` };
          App.rerender();
        });
      });
      const newRow = table.querySelector('tr[data-role="new"]');
      newRow.querySelector('[data-a="add"]').addEventListener('click', async () => {
        const rec = read(newRow);
        const err = validate(rec, data.priceItems, null);
        if (err) { msg = { kind: 'error', text: err }; App.rerender(); return; }
        await App.DB.add('priceItems', rec);
        msg = { kind: 'ok', text: `Added ${rec.name}.` };
        App.rerender();
      });
      container.append(table);

      // customers with their own rates
      const special = data.companies.filter((c) => c.rates && Object.keys(c.rates).length);
      const used = data.priceItems.filter((p) => special.some((c) => c.rates[p.id]));
      const matrix = h(`
        <div class="panel">
          <h2>Customers with their own rates</h2>
          ${special.length ? `<div class="table-scroll"><table class="compact">
            <thead><tr><th>Customer</th>${used.map((p) => `<th class="num">${esc(p.name)}</th>`).join('')}<th></th></tr></thead>
            <tbody>${special.map((c) => `<tr data-id="${c.id}"><td><strong>${esc(c.name)}</strong></td>
              ${used.map((p) => { const r = c.rates[p.id]; return `<td class="num">${!r ? '<span class="muted">list</span>' : r.variable ? '<span class="badge warn">variable</span>' : L.rateText(L.parseMoney(r.rate))}</td>`; }).join('')}
              <td><button type="button" data-a="edit">Edit rates</button></td></tr>`).join('')}</tbody>
          </table></div>` : '<p class="muted">None yet — every customer gets the list price. Set a customer\u2019s own rates on the <a href="#/companies">Companies</a> page.</p>'}
        </div>`);
      matrix.querySelectorAll('[data-a="edit"]').forEach((b) => b.addEventListener('click', () => App.Pages.companies.edit(Number(b.closest('tr').dataset.id))));
      container.append(matrix);
    },
  };
})();
