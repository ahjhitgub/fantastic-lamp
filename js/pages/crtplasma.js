window.App = window.App || {};
App.Pages = App.Pages || {};

/** CRTs and plasmas are never kept: this follows each one from the transfer it came in on to the shipment it left on. */
App.Pages.crtplasma = (function () {
  let onlyOnHand = false;

  return {
    async render(container) {
      const { h, esc, fmt, header } = App.UI;
      const L = App.Logic;
      const data = await App.Store.loadAll();
      const { rows, orphans } = L.crtPlasmaLedger(data.wcs);
      const compName = (id) => (data.companies.find((c) => c.id === id) || {}).name || '—';
      const catName = (c) => (c === 'crt' ? 'CRT' : 'Plasma');

      container.append(header('CRT & Plasma', 'CRTs aren\u2019t dismantled here and plasmas aren\u2019t kept — every one received goes to another recycler. This shows what came in on each transfer, what went out and on which shipment, and what\u2019s still here.'));

      const tot = (cat, part) => rows.filter((r) => r.category === cat).reduce((a, r) => ({ units: a.units + r[part].units, weight: a.weight + r[part].weight }), { units: 0, weight: 0 });
      container.append(h(`
        <div class="stat-row">
          ${['crt', 'plasma'].map((c) => { const o = tot(c, 'onHand'); const sh = tot(c, 'shipped'); return `
            <div class="stat"><div class="value ${o.units ? 'flag-text' : ''}">${fmt(o.units)}</div><div class="label">${catName(c)} units on hand (${fmt(o.weight)} lbs)</div></div>
            <div class="stat"><div class="value">${fmt(sh.units)}</div><div class="label">${catName(c)} units shipped out (${fmt(sh.weight)} lbs)</div></div>`; }).join('')}
        </div>`));
      orphans.forEach((o) => container.append(App.UI.notice(`Shipment WC #${o.shipment.wcNumber} lists ${catName(o.line.category)} units from a transfer that no longer exists.`, 'error')));

      const shipType = data.wcTypes.find((t) => t.kind === 'shipment');
      const form = h(`
        <form class="panel">
          <h2>Ship CRTs or plasmas to another recycler</h2>
          <div class="field-row">
            <div class="field"><label>WC #</label><input name="wcNumber" required value="${esc(L.nextWcNumber(data.wcs))}"></div>
            <div class="field" style="flex:2"><label>Going to</label><select name="party">${App.Store.partyOptions('shipment', data.companies, '')}</select></div>
            <div class="field"><label>Date shipped</label><input type="date" name="date" value="${App.UI.today()}"></div>
            <div class="field"><label>&nbsp;</label><button type="submit" class="primary">Create and open</button></div>
          </div>
          <p class="hint">On the shipment, use "CRTs and plasmas sent to another recycler" to pick the transfers they came from.</p>
          <div data-role="err"></div>
        </form>`);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        try {
          const id = await App.Store.createWC({ wcNumber: fd.get('wcNumber'), typeId: shipType.id, date: fd.get('date'), party: fd.get('party') });
          App.Pages.wc.reset();
          App.UI.go(`#/wc/${id}`);
        } catch (err) { form.querySelector('[data-role="err"]').replaceChildren(App.UI.notice(App.UI.errText(err), 'error')); }
      });
      container.append(form);

      const filter = h(`<div class="panel filters"><label class="row"><input type="checkbox" ${onlyOnHand ? 'checked' : ''}> Only transfers with units still on hand</label></div>`);
      filter.querySelector('input').addEventListener('change', (e) => { onlyOnHand = e.target.checked; App.rerender(); });
      container.append(filter);

      const list = rows.filter((r) => !onlyOnHand || r.onHand.units > 0)
        .sort((a, b) => String(b.wc.date || '').localeCompare(String(a.wc.date || '')) || String(b.wc.wcNumber).localeCompare(String(a.wc.wcNumber), 'en', { numeric: true }));
      if (!list.length) { container.append(App.UI.empty(rows.length ? 'Nothing on hand' : 'No CRTs or plasmas received yet', rows.length ? 'Every CRT and plasma received has been shipped out.' : 'They show up here once a transfer lists CRT or plasma lines.')); return; }
      container.append(h(`
        <div class="panel"><div class="table-scroll"><table>
          <thead><tr><th>Transfer</th><th>IRR #</th><th>Received</th><th>Customer</th><th>Type</th><th class="num">Received</th><th class="num">CEW</th><th class="num">Shipped out</th><th>Shipments</th><th class="num">On hand</th></tr></thead>
          <tbody>${list.map((r) => { const P = App.Store.transferParties(r.wc, data); return `<tr>
            <td><a href="#/wc/${r.wc.id}"><strong>${esc(r.wc.wcNumber)}</strong></a></td>
            <td>${esc(r.wc.transfer.irrNumber || '')}</td>
            <td>${esc(r.wc.date)}</td>
            <td>${esc(P.customer ? P.customer.name : '—')}</td>
            <td>${catName(r.category)}</td>
            <td class="num">${fmt(r.received.units)} / ${fmt(r.received.weight)} lbs</td>
            <td class="num">${fmt(r.cew.units)}</td>
            <td class="num">${fmt(r.shipped.units)} / ${fmt(r.shipped.weight)} lbs</td>
            <td>${r.shipments.map((x) => `<a href="#/wc/${x.wc.id}">WC #${esc(x.wc.wcNumber)}</a> ${esc(L.shortDate(x.wc.date))} → ${esc(compName(x.wc.companyId))} (${fmt(x.units)})`).join('<br>') || '<span class="muted">—</span>'}</td>
            <td class="num">${r.onHand.units ? `<span class="flag-text">${fmt(r.onHand.units)}</span>` : '0'} / ${fmt(r.onHand.weight)} lbs</td></tr>`; }).join('')}</tbody>
        </table></div>
        <p class="hint">Received = everything on the IRR for that type (CEW and non-CEW). Lbs on hand can differ slightly from zero when the outbound scale reads differently.</p></div>`));
    },
  };
})();
