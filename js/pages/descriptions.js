window.App = window.App || {};
App.Pages = App.Pages || {};

/**
 * Vendor descriptions: the names vendors use for what we ship them. Each says whether it's
 * CEW material and which residual it counts as. New descriptions typed on a shipment are added here.
 */
App.Pages.descriptions = (function () {
  let msg = null;
  let vendorFilter = '';

  function uses(d, wcs) {
    const k = App.Logic.norm(d.name);
    const out = [];
    wcs.filter((w) => w.kind === 'shipment' && (!d.vendorId || w.companyId === d.vendorId)).forEach((w) => {
      (w.shipment.lines || []).forEach((l) => { if (App.Logic.norm(l.description) === k) out.push({ wc: w, line: l }); });
    });
    return out;
  }

  return {
    async render(container) {
      const { h, esc, options } = App.UI;
      const L = App.Logic;
      const data = await App.Store.loadAll();
      const vendors = data.companies.filter((c) => (c.roles || []).some((r) => r === 'destination' || r === 'recycler') || data.shipDescriptions.some((d) => d.vendorId === c.id));
      const vendorName = (id) => (id ? (data.companies.find((c) => c.id === id) || {}).name || '?' : 'Any vendor');
      const vendorOpts = (sel) => options([{ value: '', label: 'Any vendor' }].concat(vendors.map((c) => ({ value: c.id, label: c.name }))), sel ?? '');
      const matOpts = (sel) => options(data.materials.map((m) => ({ value: m.id, label: m.name })), sel ?? '', '— none —');

      container.append(App.UI.header('Vendor Descriptions', 'How each vendor describes the material you ship them — whether it\u2019s CEW material, and which residual it counts as. Descriptions typed on a shipment are added here automatically.'));
      if (msg) { container.append(App.UI.notice(msg.text, msg.kind)); msg = null; }

      const row = (d) => `
        <td><input data-f="name" value="${esc(d.name)}" style="min-width:200px"></td>
        <td><select data-f="vendorId">${vendorOpts(d.vendorId)}</select></td>
        <td><label class="row"><input type="checkbox" data-f="cew" ${d.cew !== false ? 'checked' : ''}> CEW</label></td>
        <td><select data-f="materialId">${matOpts(d.materialId)}</select></td>`;
      const read = (tr) => ({
        name: tr.querySelector('[data-f="name"]').value.replace(/\s+/g, ' ').trim(),
        vendorId: tr.querySelector('[data-f="vendorId"]').value ? Number(tr.querySelector('[data-f="vendorId"]').value) : null,
        cew: tr.querySelector('[data-f="cew"]').checked,
        materialId: tr.querySelector('[data-f="materialId"]').value ? Number(tr.querySelector('[data-f="materialId"]').value) : null,
      });
      const clash = (rec, selfId) => data.shipDescriptions.find((d) => d.id !== selfId && L.norm(d.name) === L.norm(rec.name) && (d.vendorId || null) === rec.vendorId);

      const filter = h(`<div class="panel filters"><div class="field-row"><div class="field"><label>Vendor</label>
        <select data-f="vendor">${options([{ value: '', label: 'All' }, { value: 'any', label: 'Any vendor (general)' }].concat(vendors.map((c) => ({ value: c.id, label: c.name }))), vendorFilter)}</select></div></div></div>`);
      filter.querySelector('select').addEventListener('change', (e) => { vendorFilter = e.target.value; App.rerender(); });
      container.append(filter);

      const list = data.shipDescriptions.filter((d) => !vendorFilter || (vendorFilter === 'any' ? !d.vendorId : d.vendorId === Number(vendorFilter)));
      const table = h(`
        <div class="panel">
          <div class="table-scroll"><table class="lines" data-list="descriptions">
            <thead><tr><th>Description</th><th>Vendor</th><th>CEW?</th><th>Counts as residual</th><th class="num">Used on</th><th></th></tr></thead>
            <tbody>
              ${list.map((d) => `<tr data-id="${d.id}">${row(d)}<td class="num">${uses(d, data.wcs).length} line(s)</td>
                <td class="row"><button type="button" data-a="save">Save</button><button type="button" class="danger" data-a="delete">Delete</button></td></tr>`).join('')}
              <tr class="new-row" data-role="new">${row({ cew: true, vendorId: vendorFilter && vendorFilter !== 'any' ? Number(vendorFilter) : null })}<td></td><td><button type="button" class="primary" data-a="add">Add</button></td></tr>
            </tbody>
          </table></div>
          ${list.length ? '' : '<p class="muted">No descriptions yet — add one above, or just type them on a shipment.</p>'}
        </div>`);
      table.querySelectorAll('tr[data-id]').forEach((tr) => {
        const d = data.shipDescriptions.find((x) => x.id === Number(tr.dataset.id));
        tr.querySelector('[data-a="save"]').addEventListener('click', async () => {
          const rec = read(tr);
          if (!rec.name) return;
          if (clash(rec, d.id)) { msg = { kind: 'error', text: `"${rec.name}" is already on the list for ${vendorName(rec.vendorId)}.` }; App.rerender(); return; }
          await App.DB.put('shipDescriptions', { ...d, ...rec });
          const used = uses(d, data.wcs);
          const changed = used.filter((u) => u.line.cew !== rec.cew || (u.line.materialId ?? null) !== rec.materialId || u.line.description !== rec.name);
          let n = 0;
          if (changed.length && confirm(`Update the ${changed.length} shipment line(s) that use "${d.name}" to match?`)) {
            const touched = new Map();
            changed.forEach((u) => { Object.assign(u.line, { description: rec.name, cew: rec.cew, materialId: rec.materialId }); touched.set(u.wc.id, u.wc); });
            await App.DB.bulkPut('wcs', [...touched.values()]);
            App.Pages.wc.reset();
            n = changed.length;
          }
          msg = { kind: 'ok', text: `Saved "${rec.name}".${n ? ` Updated ${n} shipment line(s).` : ''}` };
          App.rerender();
        });
        tr.querySelector('[data-a="delete"]').addEventListener('click', async () => {
          if (!confirm(`Remove "${d.name}" from the list? Shipment lines that use it keep their description.`)) return;
          await App.DB.delete('shipDescriptions', d.id);
          App.rerender();
        });
      });
      const nr = table.querySelector('tr[data-role="new"]');
      nr.querySelector('[data-a="add"]').addEventListener('click', async () => {
        const rec = read(nr);
        if (!rec.name) return;
        if (clash(rec, null)) { msg = { kind: 'error', text: `"${rec.name}" is already on the list for ${vendorName(rec.vendorId)}.` }; App.rerender(); return; }
        await App.DB.add('shipDescriptions', rec);
        msg = { kind: 'ok', text: `Added "${rec.name}".` };
        App.rerender();
      });
      container.append(table);
    },
  };
})();
