window.App = window.App || {};
App.Pages = App.Pages || {};

/** Every weight certificate, of every type. */
App.Pages.wcs = (function () {
  const filters = { typeId: '', statusId: '', q: '' };

  function summary(wc, data) {
    const L = App.Logic; const { fmt } = App.UI;
    if (wc.kind === 'transfer') {
      const m = L.transferMath(wc.transfer);
      const parts = [];
      if (m.claimable.NonCRT.units) parts.push(`CEW LCD/LED ${fmt(m.claimable.NonCRT.units)} / ${fmt(m.claimable.NonCRT.weight)} lbs`);
      if (m.claimable.CBEP.units) parts.push(`CBEP ${fmt(m.claimable.CBEP.units)} / ${fmt(m.claimable.CBEP.weight)} lbs`);
      if (!parts.length) parts.push(`IRR ${fmt(m.irr.units)} units / ${fmt(m.irr.weight)} lbs`);
      return parts.join(' · ');
    }
    const lines = (wc.shipment || wc.inventory || {}).lines || [];
    const used = lines.filter((l) => L.lineNet(l));
    const total = used.reduce((s, l) => s + L.lineNet(l), 0);
    if (wc.kind === 'inventory') {
      const [y, mo] = L.inventoryMonthKey(wc).split('-').map(Number);
      return `End of ${y ? L.monthLabel(y, mo) : '?'} · ${fmt(total)} lbs on hand`;
    }
    if (wc.kind === 'shipment') {
      const names = used.map((l) => (data.materials.find((m) => m.id === l.materialId) || {}).name).filter(Boolean);
      return `${fmt(total)} lbs${names.length ? ` — ${names.join(', ')}` : ''}`;
    }
    return wc.notes ? wc.notes.slice(0, 80) : '';
  }

  return {
    async render(container) {
      const { h, esc, options, header } = App.UI;
      const data = await App.Store.loadAll();
      const docs = await App.DB.getAll('attachments');
      const docCount = new Map();
      docs.filter((d) => d.linkedEntityType === 'wc').forEach((d) => docCount.set(d.linkedEntityId, (docCount.get(d.linkedEntityId) || 0) + 1));
      const typeName = (id) => (data.wcTypes.find((t) => t.id === id) || {}).name || '—';
      const compName = (id) => (data.companies.find((c) => c.id === id) || {}).name || '—';

      container.append(header('Weight Certificates', 'Every WC — transfers, residual shipments, inventory checks, and any other type you add in Settings.'));

      const form = h(`
        <form class="panel">
          <h2>New WC</h2>
          <div class="field-row">
            <div class="field"><label>WC #</label><input name="wcNumber" required value="${esc(App.Logic.nextWcNumber(data.wcs))}"></div>
            <div class="field"><label>Type</label><select name="typeId">${options(data.wcTypes.map((t) => ({ value: t.id, label: t.name })), '')}</select></div>
            <div class="field" style="flex:2"><label data-role="party-label"></label><select name="party"></select></div>
            <div class="field"><label>Date</label><input type="date" name="date" value="${App.UI.today()}"></div>
            <div class="field"><label>&nbsp;</label><button type="submit" class="primary">Create and open</button></div>
          </div>
          <div data-role="err"></div>
        </form>`);
      const typeSel = form.querySelector('[name="typeId"]');
      const syncParty = () => {
        const kind = (data.wcTypes.find((t) => t.id === Number(typeSel.value)) || {}).kind || 'generic';
        form.querySelector('[data-role="party-label"]').textContent = App.Store.partyLabel(kind);
        form.querySelector('[name="party"]').innerHTML = App.Store.partyOptions(kind, data.companies, '');
      };
      typeSel.addEventListener('change', syncParty);
      syncParty();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        try {
          const id = await App.Store.createWC({ wcNumber: fd.get('wcNumber'), typeId: Number(fd.get('typeId')), date: fd.get('date'), party: fd.get('party') });
          App.Pages.wc.reset();
          App.UI.go(`#/wc/${id}`);
        } catch (err) { form.querySelector('[data-role="err"]').replaceChildren(App.UI.notice(App.UI.errText(err), 'error')); }
      });
      container.append(form);

      const filterEl = h(`
        <div class="panel filters">
          <div class="field-row">
            <div class="field"><label>Type</label><select data-f="typeId">${options(data.wcTypes.map((t) => ({ value: t.id, label: t.name })), filters.typeId, 'All types')}</select></div>
            <div class="field"><label>Status</label><select data-f="statusId">${options([{ value: 'none', label: '(no status)' }].concat(data.wcStatuses.map((s) => ({ value: s.id, label: s.name }))), filters.statusId, 'All statuses')}</select></div>
            <div class="field" style="flex:2"><label>Search WC # or company</label><input data-f="q" value="${esc(filters.q)}"></div>
          </div>
        </div>`);
      filterEl.querySelectorAll('[data-f]').forEach((i) => i.addEventListener(i.tagName === 'INPUT' ? 'change' : 'input', () => { filters[i.dataset.f] = i.value; App.rerender(); }));
      container.append(filterEl);

      const q = App.Logic.norm(filters.q);
      const list = data.wcs.filter((w) => (!filters.typeId || w.typeId === Number(filters.typeId))
        && (!filters.statusId || (filters.statusId === 'none' ? !w.statusId : w.statusId === Number(filters.statusId)))
        && (!q || App.Logic.norm(w.wcNumber).includes(q) || App.Logic.norm(compName(w.companyId)).includes(q)))
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.wcNumber).localeCompare(String(a.wcNumber), 'en', { numeric: true }));

      if (!list.length) { container.append(App.UI.empty(data.wcs.length ? 'No WCs match these filters' : 'No weight certificates yet', data.wcs.length ? '' : 'Create one above.')); return; }

      const statusOpts = (sel) => options(data.wcStatuses.map((s) => ({ value: s.id, label: s.name })), sel, '(no status)');
      const table = h(`
        <div class="panel"><div class="table-scroll"><table>
          <thead><tr><th>WC #</th><th>Type</th><th>Date</th><th>Company</th><th>Status</th><th>Summary</th><th class="num">Docs</th></tr></thead>
          <tbody>${list.map((w) => `
            <tr data-id="${w.id}">
              <td><a href="#/wc/${w.id}"><strong>${esc(w.wcNumber)}</strong></a></td>
              <td>${esc(typeName(w.typeId))}</td>
              <td>${esc(w.date)}</td>
              <td>${esc(compName(w.companyId))}</td>
              <td>${data.wcStatuses.length ? `<select data-role="status">${statusOpts(w.statusId)}</select>` : '<span class="muted">—</span>'}</td>
              <td>${esc(summary(w, data))}</td>
              <td class="num">${docCount.get(w.id) || 0}</td>
            </tr>`).join('')}</tbody>
        </table></div></div>`);
      table.querySelectorAll('[data-role="status"]').forEach((sel) => sel.addEventListener('change', async () => {
        const id = Number(sel.closest('tr').dataset.id);
        const wc = await App.DB.get('wcs', id);
        wc.statusId = sel.value ? Number(sel.value) : null;
        await App.DB.put('wcs', wc);
        App.Pages.wc.reset();
      }));
      container.append(table);
    },
  };
})();
