window.App = window.App || {};
App.Pages = App.Pages || {};

/**
 * CRTs and plasmas are never kept: every one goes to an approved CEW recycler. Those shipments
 * don't need a WC — this tracks which transfer each unit came from, what's left from each
 * transfer, what's on hand in total, and any units the recycler rejected as non-CEW.
 */
App.Pages.crtplasma = (function () {
  let onlyOnHand = false;

  return {
    async render(container) {
      // 198 UC per transfer: what's been sent with shipments (locked) and what's still on hand
      let ucData = null;
      const ucCell = (r) => {
        const d = ucData && ucData.get(r.wc.id);
        if (!d) return '';
        if (!d.basis.log) return `<span class="muted">no 198 ${d.basis.which} yet</span>`;
        const key = r.category === 'crt' ? 'crt' : 'noncrt';
        const all = d.uc.reduce((a, l) => a + L.num(l[key]), 0); const left = d.remaining.reduce((a, l) => a + L.num(l[key]), 0);
        return `${all ? `${App.UI.fmt(all - left)} of ${App.UI.fmt(all)} sent` : '<span class="muted">none struck</span>'} · <a href="#/doc/${r.wc.id}/198uc">UC</a>${left && left < all ? ` · <a href="#/doc/${r.wc.id}/198ucr">remaining (${App.UI.fmt(left)})</a>` : ''}`;
      };
      const { h, esc, fmt, header } = App.UI;
      const L = App.Logic;
      const data = await App.Store.loadAll();
      ucData = new Map(data.wcs.filter((w) => w.kind === 'transfer').map((w) => [w.id, App.Store.ucRemaining(w, data)]));
      const { rows, orphans } = L.crtPlasmaLedger(data.wcs);
      const compName = (id) => (data.companies.find((c) => c.id === id) || {}).name || '—';
      const catName = (c) => (c === 'crt' ? 'CRT' : 'Plasma');
      const shipLabel = (w) => (w.wcNumber ? `WC #${w.wcNumber}` : `${L.shortDate(w.date)}${w.crtShipment && w.crtShipment.reference ? ` (${w.crtShipment.reference})` : ''}`);

      container.append(header('CRT & Plasma', 'CRTs aren\u2019t dismantled here and plasmas aren\u2019t kept — every one goes to an approved CEW recycler. No WC is needed for these shipments; this tracks which transfer each unit came from and what\u2019s left.'));

      const tot = (cat, part) => rows.filter((r) => r.category === cat).reduce((a, r) => ({ units: a.units + r[part].units, weight: a.weight + r[part].weight }), { units: 0, weight: 0 });
      const rejected = (cat) => rows.filter((r) => r.category === cat).reduce((a, r) => a + r.rejected, 0);
      container.append(h(`
        <div class="stat-row">
          ${['crt', 'plasma'].map((c) => { const o = tot(c, 'onHand'); const sh = tot(c, 'shipped'); return `
            <div class="stat"><div class="value ${o.units ? 'flag-text' : ''}">${fmt(o.units)}</div><div class="label">${catName(c)} units on hand (${fmt(o.weight)} lbs)</div></div>
            <div class="stat"><div class="value">${fmt(sh.units)}</div><div class="label">${catName(c)} units shipped out${rejected(c) ? ` · ${fmt(rejected(c))} rejected as non-CEW` : ''}</div></div>`; }).join('')}
        </div>`));
      orphans.forEach((o) => container.append(App.UI.notice(`A shipment on ${L.shortDate(o.shipment.date)} lists ${catName(o.line.category)} units from a transfer that no longer exists.`, 'error')));

      const recyclers = data.companies.filter((c) => (c.roles || []).includes('recycler'));
      const form = h(`
        <form class="panel">
          <h2>Ship CRTs or plasmas to an approved recycler</h2>
          <div class="field-row">
            <div class="field" style="flex:2"><label>Going to</label><select name="party" required>${App.Store.partyOptions('crtShipment', data.companies, '')}</select></div>
            <div class="field"><label>Date shipped</label><input type="date" name="date" value="${App.UI.today()}" required></div>
            <div class="field"><label>Reference # <span class="muted">(optional)</span></label><input name="reference" placeholder="BOL / manifest"></div>
            <div class="field"><label>&nbsp;</label><button type="submit" class="primary">Create and open</button></div>
          </div>
          ${recyclers.length ? '' : '<p class="hint">No approved recyclers yet — on the <a href="#/companies">Companies</a> page, mark a vendor as an approved CEW recycler.</p>'}
          <div data-role="err"></div>
        </form>`);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        try {
          if (!fd.get('party')) throw new Error('Pick the approved recycler.');
          const id = await App.Store.createWC({ kind: 'crtShipment', party: fd.get('party'), date: fd.get('date'), reference: fd.get('reference') });
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
      if (!list.length) {
        container.append(App.UI.empty(rows.length ? 'Nothing on hand' : 'No CRTs or plasmas received yet', rows.length ? 'Every CRT and plasma received has been shipped out.' : 'They show up here once a transfer lists CRT or plasma lines.'));
      } else {
        container.append(h(`
          <div class="panel"><h2>By transfer</h2><div class="table-scroll"><table data-list="crt-transfers">
            <thead><tr><th>Transfer</th><th>IRR #</th><th>Received</th><th>Customer</th><th>Type</th><th class="num">Received</th><th class="num">CEW</th><th class="num">Shipped out</th><th>Shipments</th><th class="num">Left</th><th>198 UC</th></tr></thead>
            <tbody>${list.map((r) => { const P = App.Store.transferParties(r.wc, data); return `<tr>
              <td><a href="#/wc/${r.wc.id}"><strong>${esc(r.wc.wcNumber)}</strong></a></td>
              <td>${esc(r.wc.transfer.irrNumber || '')}</td>
              <td>${esc(L.shortDate(r.wc.date))}</td>
              <td>${esc(P.customer ? P.customer.name : '—')}</td>
              <td>${catName(r.category)}</td>
              <td class="num">${fmt(r.received.units)} / ${fmt(r.received.weight)} lbs</td>
              <td class="num">${fmt(r.cew.units)}</td>
              <td class="num">${fmt(r.shipped.units)} / ${fmt(r.shipped.weight)} lbs</td>
              <td>${r.shipments.map((x) => `<a href="#/wc/${x.wc.id}">${esc(shipLabel(x.wc))}</a> → ${esc(compName(x.wc.companyId))} (${fmt(x.units)})${x.rejectedUnits ? ` <span class="badge warn" title="${esc(x.rejectedNote)}">${fmt(x.rejectedUnits)} rejected as non-CEW</span>` : ''}`).join('<br>') || '<span class="muted">—</span>'}</td>
              <td class="num">${r.onHand.units ? `<span class="flag-text">${fmt(r.onHand.units)}</span>` : '0'}</td>
              <td>${ucCell(r)}</td></tr>`; }).join('')}</tbody>
          </table></div>
          <p class="hint">Received = everything on the IRR for that type (CEW and non-CEW). Units rejected by the recycler as non-CEW still count as shipped from that transfer.</p></div>`));
      }

      const shipments = data.wcs.filter((w) => w.kind === 'crtShipment' || (w.kind === 'shipment' && L.crtLines(w).length))
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      if (shipments.length) {
        container.append(h(`
          <div class="panel"><h2>Shipments to recyclers</h2><div class="table-scroll"><table data-list="crt-shipments">
            <thead><tr><th>Shipped</th><th>Reference</th><th>Recycler</th><th class="num">CRT</th><th class="num">Plasma</th><th class="num">Rejected as non-CEW</th><th>Paid / charged</th><th>198 UC</th></tr></thead>
            <tbody>${shipments.map((w) => { const ls = L.crtLines(w); const n = (cat) => ls.filter((l) => l.category === cat).reduce((a, l) => a + L.num(l.units), 0);
              const rej = ls.reduce((a, l) => a + L.num(l.rejectedUnits), 0);
              return `<tr><td><a href="#/wc/${w.id}">${esc(L.shortDate(w.date))}</a></td><td>${esc((w.crtShipment && w.crtShipment.reference) || (w.wcNumber ? `WC #${w.wcNumber}` : ''))}</td>
                <td>${esc(compName(w.companyId))}</td><td class="num">${fmt(n('crt'))}</td><td class="num">${fmt(n('plasma'))}</td>
                <td class="num">${rej ? `<span class="flag-text">${fmt(rej)}</span>` : '0'}</td><td>${esc(L.settlementText((w.crtShipment || w.shipment || {}).settlement))}</td>
                <td><a href="#/doc/${w.id}/198uc">${ls.some((l) => l.ucSent) ? 'Shipped UC (locked)' : 'Make shipped UC'}</a></td></tr>`; }).join('')}</tbody>
          </table></div></div>`));
      }
    },
  };
})();
