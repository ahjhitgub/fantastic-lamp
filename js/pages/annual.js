/* Annual Summary: one calendar year (Jan–Dec) of what came in, what we paid, what went out, claim payments and sales. */
window.App = window.App || {};
App.Pages = App.Pages || {};
App.Pages.annual = (function () {
  const L = () => App.Logic;
  let year = new Date().getFullYear();
  let msg = null;
  const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  async function otherSales() {
    const rec = await App.DB.get('meta', 'otherSales');
    return (rec && rec.items) || [];
  }
  async function saveOtherSales(items) { await App.DB.put('meta', { key: 'otherSales', items }); }

  /** A simple 12-month bar chart. */
  function bars(values, fmtFn) {
    const max = Math.max(...values, 0);
    if (!max) return '<p class="muted">Nothing this year.</p>';
    const W = 620; const H = 150; const bw = W / 12;
    return `<svg class="bars" viewBox="0 0 ${W} ${H + 34}" role="img" aria-label="Month by month">
      ${values.map((v, i) => {
        const bh = Math.round((v / max) * H);
        return `<g><rect x="${i * bw + 6}" y="${H - bh + 14}" width="${bw - 12}" height="${bh}" rx="3"></rect>
          ${v ? `<text x="${i * bw + bw / 2}" y="${H - bh + 10}" text-anchor="middle" class="v">${fmtFn(v)}</text>` : ''}
          <text x="${i * bw + bw / 2}" y="${H + 30}" text-anchor="middle">${SHORT_MONTHS[i]}</text></g>`;
      }).join('')}</svg>`;
  }

  return {
    async render(container) {
      const { h, esc, fmt } = App.UI;
      const money = (n) => (n === null || n === undefined ? '—' : L().money(n));
      const data = await App.Store.loadAll();
      const sales = await otherSales();
      const companyName = (id) => (data.companies.find((c) => c.id === id) || {}).name || '';
      const transfers = data.wcs.filter((w) => w.kind === 'transfer').map((wc) => {
        const P = App.Store.transferParties(wc, data);
        return { wc, customer: P.customer ? P.customer.name : P.selfCollected ? 'Dual Entity' : '—',
          invoice: L().invoiceMath({ transfer: wc.transfer, mode: wc.transfer.mode, priceItems: data.priceItems, company: P.customer }) };
      });
      const shipments = data.wcs.filter((w) => w.kind === 'shipment' || w.kind === 'crtShipment');
      const years = new Set([new Date().getFullYear()]);
      [...data.wcs.map((w) => w.date), ...sales.map((x) => x.date)].forEach((d) => { if (/^\d{4}/.test(d || '')) years.add(Number(d.slice(0, 4))); });
      data.periods.forEach((p) => years.add(Number(p.year)));
      const S = L().annualSummary({ year, transfers, shipments, periods: data.periods, otherSales: sales, materials: data.materials, companyName });

      container.append(App.UI.header('Annual Summary', 'One calendar year, January to December. Each item counts in the year of its own date: transfers when received, invoices by their PO date, shipments when shipped, claims by their claim month.'));
      if (msg) { container.append(App.UI.notice(msg.text, msg.kind)); msg = null; }
      const pick = h(`<div class="panel row" data-period-ok><label class="row"><strong>Year</strong> <select data-a="year">${[...years].sort((a, b) => b - a).map((y) => `<option ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select></label></div>`);
      pick.querySelector('[data-a="year"]').addEventListener('change', (e) => { year = Number(e.target.value); App.rerender(); });
      container.append(pick);

      const R = S.received; const K = R.totals.byKind;
      container.append(h(`<div class="stat-row">
        <div class="stat"><div class="value">${fmt(R.totals.units)}</div><div class="label">Units received (${fmt(R.totals.weight)} lbs)</div></div>
        <div class="stat"><div class="value">${money(S.paid.totals.balance)}</div><div class="label">Paid for material</div></div>
        <div class="stat"><div class="value">${money(S.claims.totals.received)}</div><div class="label">Claim payments received (of ${money(S.claims.totals.requested)} requested)</div></div>
        <div class="stat"><div class="value">${money(S.sales.total)}</div><div class="label">Sales (CRTs, plasmas, other)</div></div>
      </div>`));

      // ---- received
      container.append(h(`<div class="panel"><h2>Received</h2>
        <p class="muted mt-0">LCD/LED ${fmt(K.lcdled.units)} (${fmt(K.lcdled.weight)} lbs) · CRT ${fmt(K.crt.units)} (${fmt(K.crt.weight)} lbs) · Plasma ${fmt(K.plasma.units)} (${fmt(K.plasma.weight)} lbs) · CEW CBEP ${fmt(K.cbep.units)} (${fmt(K.cbep.weight)} lbs) · Other ${fmt(K.other.units)} (${fmt(K.other.weight)} lbs) — with source logs: ${fmt(K.lcdled.cew + K.crt.cew + K.plasma.cew + K.cbep.cew)} units</p>
        <h3>Pounds received by month</h3>${bars(R.monthlyWeight, (v) => fmt(v))}
        ${R.rows.length ? `<div class="table-scroll"><table data-list="annual-received"><thead><tr><th>Received</th><th>WC #</th><th>Customer</th><th>Type</th><th class="num">Units</th><th class="num">Lbs</th><th class="num">LCD/LED</th><th class="num">CRT</th><th class="num">Plasma</th><th class="num">CBEP</th><th class="num">Other</th></tr></thead>
          <tbody>${R.rows.map((r) => `<tr><td>${esc(L().shortDate(r.date))}</td><td><a href="#/wc/${r.id}">${esc(r.wcNumber)}</a></td><td>${esc(r.customer)}</td><td>${esc(L().transferTypeLabel(r.type))}</td><td class="num">${fmt(r.units)}</td><td class="num">${fmt(r.weight)}</td>
            ${['lcdled', 'crt', 'plasma', 'cbep', 'other'].map((k) => `<td class="num">${r.byKind[k].units || r.byKind[k].weight ? `${fmt(r.byKind[k].units)} / ${fmt(r.byKind[k].weight)}` : '—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
          <p class="hint">Kind columns: units / lbs, as on the IRR (with and without source logs).</p>` : '<p class="muted">No transfers received this year.</p>'}</div>`));

      // ---- paid for material
      const P = S.paid;
      container.append(h(`<div class="panel"><h2>Paid for material</h2>
        <p class="muted mt-0">Credits ${money(P.totals.credit)} − deductions ${money(P.totals.deduction)} = <strong>${money(P.totals.balance)}</strong> paid on purchase invoices.${P.rows.some((r) => r.missing) ? ' <span class="flag-text">Some invoices still need rates.</span>' : ''}</p>
        <div class="grid-2">
          <div><h3>By kind of material</h3>${P.byKind.length ? `<table data-list="annual-paid-kind"><thead><tr><th>Material</th><th class="num">Paid</th></tr></thead><tbody>${P.byKind.map((x) => `<tr><td>${esc(x.label)}</td><td class="num">${money(x.amount)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">—</p>'}</div>
          <div><h3>By company</h3>${P.byCompany.length ? `<table data-list="annual-paid-company"><thead><tr><th>Company</th><th class="num">Final balance</th></tr></thead><tbody>${P.byCompany.map((x) => `<tr><td>${esc(x.label)}</td><td class="num">${money(x.amount)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">—</p>'}</div>
        </div>
        <h3>Paid by month</h3>${bars(P.monthly, (v) => `$${fmt(Math.round(v))}`)}
        ${P.rows.length ? `<div class="table-scroll"><table data-list="annual-invoices"><thead><tr><th>PO date</th><th>PO # / WC #</th><th>Customer</th><th class="num">Credit</th><th class="num">Deductions</th><th class="num">Final balance</th></tr></thead>
          <tbody>${P.rows.map((r) => `<tr><td>${esc(L().shortDate(r.date))}</td><td><a href="#/doc/${r.id}/invoice">${esc(r.wcNumber)}</a></td><td>${esc(r.customer)}</td><td class="num">${money(r.credit)}</td><td class="num">${money(r.deduction)}</td><td class="num">${money(r.balance)}${r.missing ? ' <span class="badge warn">rates needed</span>' : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}</div>`));

      // ---- shipped out
      const SH = S.shipped;
      container.append(h(`<div class="panel"><h2>Shipped out</h2>
        <p class="muted mt-0">Residuals ${fmt(SH.totals.residualWeight)} lbs · CRT ${fmt(SH.totals.crtUnits)} units (${fmt(SH.totals.crtWeight)} lbs) · Plasma ${fmt(SH.totals.plasmaUnits)} units (${fmt(SH.totals.plasmaWeight)} lbs)</p>
        <h3>Pounds shipped by month</h3>${bars(SH.monthlyWeight, (v) => fmt(v))}
        ${SH.residual.length ? `<h3>Residual shipments</h3><div class="table-scroll"><table data-list="annual-residual"><thead><tr><th>Shipped</th><th>WC #</th><th>Vendor</th><th class="num">Lbs</th><th>Materials</th><th>Paid / charged</th></tr></thead>
          <tbody>${SH.residual.map((r) => `<tr><td>${esc(L().shortDate(r.date))}</td><td><a href="#/wc/${r.id}">${esc(r.wcNumber)}</a></td><td>${esc(r.vendor)}</td><td class="num">${fmt(r.weight)}</td><td class="wrap">${esc(r.byMaterial.map((m) => `${m.name} ${fmt(m.lbs)}`).join(', '))}</td><td>${esc(L().settlementText(r.settlement))}</td></tr>`).join('')}</tbody></table></div>` : ''}
        ${SH.crt.length ? `<h3>CRT & plasma shipments</h3><div class="table-scroll"><table data-list="annual-crt"><thead><tr><th>Shipped</th><th>Recycler</th><th class="num">CRT units</th><th class="num">CRT lbs</th><th class="num">Plasma units</th><th class="num">Plasma lbs</th><th>Paid / charged</th></tr></thead>
          <tbody>${SH.crt.map((r) => `<tr><td><a href="#/wc/${r.id}">${esc(L().shortDate(r.date))}</a></td><td>${esc(r.recycler)}</td><td class="num">${fmt(r.crt.units)}</td><td class="num">${fmt(r.crt.weight)}</td><td class="num">${fmt(r.plasma.units)}</td><td class="num">${fmt(r.plasma.weight)}</td><td>${esc(L().settlementText(r.settlement))}</td></tr>`).join('')}</tbody></table></div>` : ''}
        ${!SH.residual.length && !SH.crt.length ? '<p class="muted">Nothing shipped this year.</p>' : ''}</div>`));

      // ---- claim payments
      const C = S.claims;
      const typeName = (k) => (App.Models.CEW_TYPE_LABELS && App.Models.CEW_TYPE_LABELS[k]) || k;
      container.append(h(`<div class="panel"><h2>Claim payments</h2>
        <p class="muted mt-0">Requested ${money(C.totals.requested)} · received ${money(C.totals.received)} · difference ${money(L().r2(C.totals.received - C.totals.requested))}. Enter the amounts on each <a href="#/claimPeriods">claim period</a>.</p>
        ${C.rows.length ? `<table data-list="annual-claims"><thead><tr><th>Claim</th><th class="num">Requested</th><th class="num">Received</th><th class="num">Difference</th><th>Received on</th></tr></thead>
          <tbody>${C.rows.map((r) => `<tr><td>${esc(`${typeName(r.cewType)} · ${L().MONTHS[r.month - 1]} ${year}`)}</td><td class="num">${money(r.requested)}</td><td class="num">${money(r.received)}</td>
            <td class="num">${r.diff === null ? '—' : `<span class="${r.diff < 0 ? 'flag-text' : ''}">${money(r.diff)}</span>`}</td><td>${esc(r.paidDate ? L().shortDate(r.paidDate) : '')}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No claim periods this year.</p>'}</div>`));

      // ---- sales (CRTs, plasmas, other)
      const SA = S.sales;
      const salesEl = h(`<div class="panel"><h2>Sales</h2>
        <p class="muted mt-0">Sold ${money(SA.total)} — shipments where we were paid, plus other sales. Charged on shipments: ${money(SA.charged)}.</p>
        ${SA.rows.length ? `<div class="table-scroll"><table data-list="annual-sales"><thead><tr><th>Date</th><th>From</th><th>Buyer</th><th>Description</th><th class="num">Amount</th><th></th></tr></thead>
          <tbody>${SA.rows.map((r) => `<tr><td>${esc(L().shortDate(r.date))}</td><td>${esc(r.source)}</td><td>${esc(r.who)}</td><td>${esc(r.description)}</td><td class="num">${money(r.amount)}</td>
            <td>${r.otherId ? `<button type="button" class="ghost small" data-del="${r.otherId}" title="Remove this sale">✕</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No sales recorded this year.</p>'}
        <h3>Record another sale</h3>
        <div class="field-row">
          <div class="field"><label>Date</label><input type="date" data-o="date" value="${App.UI.today()}"></div>
          <div class="field"><label>Buyer</label><input data-o="buyer"></div>
          <div class="field" style="flex:2"><label>What was sold</label><input data-o="description" placeholder="e.g. misc. metal, CRT glass"></div>
          <div class="field"><label>Amount $</label><input data-o="amount" inputmode="decimal"></div>
          <div class="field"><label>&nbsp;</label><button type="button" class="primary" data-a="add-sale">Add sale</button></div>
        </div></div>`);
      salesEl.querySelector('[data-a="add-sale"]').addEventListener('click', async () => {
        const v = (k) => salesEl.querySelector(`[data-o="${k}"]`).value.trim();
        if (!v('date') || L().parseMoney(v('amount')) === null) { msg = { text: 'A sale needs a date and an amount.', kind: 'error' }; App.rerender(); return; }
        const items = await otherSales();
        items.push({ id: Date.now(), date: v('date'), buyer: v('buyer'), description: v('description'), amount: v('amount') });
        await saveOtherSales(items);
        msg = { text: 'Sale added.', kind: 'ok' }; App.rerender();
      });
      salesEl.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
        if (!window.confirm('Remove this sale?')) return;
        await saveOtherSales((await otherSales()).filter((x) => String(x.id) !== b.dataset.del));
        App.rerender();
      }));
      container.append(salesEl);
    },
  };
}());
