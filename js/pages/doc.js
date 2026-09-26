window.App = window.App || {};
App.Pages = App.Pages || {};

/**
 * Printable documents for one transfer WC. Route: #/doc/<wcId>/<irr|wc|invoice|197>
 * Layouts are generic for now and will be matched to the real forms.
 */
App.Pages.doc = (function () {
  const TYPES = [['irr', 'Inbound Receiving Report'], ['wc', 'Weight Certificate'], ['invoice', 'Purchase Invoice'], ['197', 'CalRecycle 197']];
  const U = () => App.UI;
  const L = () => App.Logic;
  const usDate = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[2]}/${m[3]}/${m[1]}` : (iso || ''); };
  const modeText = (m) => (m === 'pickup' ? 'Picked up' : m === 'dropoff' ? 'Dropped off' : '—');

  function letterhead(data, title, fields) {
    const { esc } = U(); const p = data.profile;
    return `
      <div class="doc-head">
        <div>
          <div class="doc-company">${esc(p.recyclerName || 'Facility name — set in Settings')}</div>
          ${p.address ? `<div>${esc(p.address).replace(/\n/g, '<br>')}</div>` : ''}
          ${p.phone ? `<div>${esc(p.phone)}</div>` : ''}
          ${p.cewID ? `<div>CEWID ${esc(p.cewID)}</div>` : ''}
        </div>
        <div class="doc-title">
          <div class="t">${esc(title)}</div>
          <table class="kv"><tbody>${fields.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>
        </div>
      </div>`;
  }

  function customerBlock(P, wc) {
    const { esc } = U(); const c = P.customer;
    return `
      <div class="doc-parties">
        <div><div class="lbl">Customer</div>
          ${c ? `<div><strong>${esc(c.name)}</strong></div>${c.owner ? `<div>Attn: ${esc(c.owner)}</div>` : ''}${c.address ? `<div>${esc(c.address).replace(/\n/g, '<br>')}</div>` : ''}${c.phone ? `<div>${esc(c.phone)}</div>` : ''}` : '<div>—</div>'}
        </div>
        <div><div class="lbl">Collector</div>${P.collector ? `<div>${esc(P.collector.name)}</div><div>CEWID ${esc(P.collector.cewId || '—')}</div>` : '<div>—</div>'}</div>
        <div><div class="lbl">Material</div><div>${modeText(wc.transfer.mode)}</div></div>
      </div>`;
  }

  const signatures = (labels) => `<div class="doc-sign">${labels.map((l) => `<div><div class="line"></div>${U().esc(l)}</div>`).join('')}</div>`;

  const unitsText = (r) => (r.part === 'other' && !r.units ? 'Wt.Only' : U().fmt(r.units));
  const IRR_LABELS = { lcdled: 'LCD/LED', crt: 'CRT', plasma: 'PLASMA', cbep: 'CBEP' };
  const addressLines = (text) => String(text || '').split(/\n+/).map((x) => x.trim()).filter(Boolean);

  /** Laid out like Bellflower's own IRR. */
  function irr(wc, data, P) {
    const { esc, fmt } = U();
    const t = wc.transfer; const p = data.profile; const c = P.customer;
    const items = (t.lines || []).map((line) => {
      const m = L().lineMath(line); const desc = String(line.description || '').trim();
      const label = m.cat.cew ? IRR_LABELS[m.cat.key] + (desc ? ` — ${desc}` : '') : (desc || 'Other (non-CEW)');
      const gross = line.irrGross === undefined || line.irrGross === '' ? m.irrWeight : L().num(line.irrGross);
      const tare = L().num(line.irrTare);
      return { units: m.cat.cew || m.irrUnits ? fmt(m.irrUnits) : 'Wt.Only', label, gross, tare, net: m.irrWeight };
    }).filter((x) => x.gross || x.net || x.units !== 'Wt.Only');
    const tot = items.reduce((a, x) => ({ gross: a.gross + x.gross, tare: a.tare + x.tare, net: a.net + x.net }), { gross: 0, tare: 0, net: 0 });
    const addr = (lines) => lines.map((l) => `<div>${esc(l)}</div>`).join('');
    const custAddr = addressLines(c && c.address);
    return `
      <div class="doc-head">
        <div>
          <div class="doc-company">${esc(p.recyclerName || 'Facility name — set in Settings')}</div>
          ${addr(addressLines(p.address))}${p.phone ? `<div>${esc(p.phone)}</div>` : ''}
        </div>
        <div class="doc-title">
          <div class="t">Inbound Receiving Report</div>
          <table class="kv"><tbody>
            <tr><th>IRR #</th><td>${esc(t.irrNumber || '')}</td></tr>
            <tr><th>DATE:</th><td>${esc(L().shortDate(wc.date))}</td></tr>
            <tr><th>SHIPPING DATE:</th><td>${esc(L().shortDate(t.shippingDate || wc.date))}</td></tr>
          </tbody></table>
        </div>
      </div>
      <div class="irr-blocks">
        <div>
          <div class="lbl">Commodity owner:</div>
          <div><strong>${esc(c ? c.name : '')}</strong></div>
          ${custAddr.length ? `<table class="kv-left"><tbody>${custAddr.map((l, i) => `<tr><th>${i === 0 ? 'Address:' : ''}</th><td>${esc(l)}</td></tr>`).join('')}</tbody></table>` : ''}
          ${c && c.phone ? `<table class="kv-left"><tbody><tr><th>Phone:</th><td>${esc(c.phone)}</td></tr></tbody></table>` : ''}
        </div>
        <div>
          <div class="lbl">Ship to:</div>
          <div><strong>${esc(p.recyclerName || '')}</strong></div>
          ${addr(addressLines(p.address))}${p.phone ? `<div>${esc(p.phone)}</div>` : ''}
        </div>
      </div>
      <div class="irr-vehicle"><span class="lbl">Vehicle info:</span> LICENSE PLATE: <strong>${esc(t.licensePlate || '')}</strong></div>
      <table class="doc-table irr-table">
        <thead><tr><th class="num">UNITS</th><th>DESCRIPTION</th><th class="num">GROSS</th><th class="num">TARE</th><th class="num">NET</th></tr></thead>
        <tbody>${items.map((x) => `<tr><td class="num">${x.units}</td><td>${esc(x.label)}</td><td class="num">${fmt(x.gross)}</td><td class="num">${fmt(x.tare)}</td><td class="num">${fmt(x.net)}</td></tr>`).join('') || '<tr><td colspan="5">Nothing entered.</td></tr>'}</tbody>
        <tfoot>
          <tr><th colspan="2"></th><th class="num">TOTAL GROSS</th><th class="num">TOTAL TARE</th><th class="num">TOTAL NET</th></tr>
          <tr><th colspan="2"></th><th class="num">${fmt(tot.gross)}</th><th class="num">${fmt(tot.tare)}</th><th class="num">${fmt(tot.net)}</th></tr>
        </tfoot>
      </table>
      ${wc.notes ? `<p><strong>Notes:</strong> ${esc(wc.notes)}</p>` : ''}
      <div class="irr-by">
        <div>Inbound Report By: <strong>${esc(t.irrBy || '')}</strong></div>
        <div class="doc-sign"><div><div class="line"></div>${esc(t.irrBy || 'Signature')}</div><div></div></div>
      </div>`;
  }

  function weightCert(wc, data, P) {
    const { esc, fmt } = U();
    const rows = L().documentRows(wc.transfer);
    const tot = rows.reduce((a, x) => ({ units: a.units + x.units, weight: a.weight + x.weight }), { units: 0, weight: 0 });
    return `${letterhead(data, 'Weight Certificate', [['WC #', wc.wcNumber], ['Date', usDate(wc.date)]])}
      ${customerBlock(P, wc)}
      <table class="doc-table"><thead><tr><th>Description</th><th class="num">Units</th><th class="num">Net weight (lbs)</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td>${esc(r.label)}</td><td class="num">${unitsText(r)}</td><td class="num">${fmt(r.weight)}</td></tr>`).join('') || '<tr><td colspan="3">Nothing entered.</td></tr>'}</tbody>
        <tfoot><tr><th>Total</th><th class="num">${fmt(tot.units)}</th><th class="num">${fmt(tot.weight)}</th></tr></tfoot></table>
      ${signatures(['Weighmaster', 'Customer / driver'])}`;
  }

  function invoice(wc, data, P) {
    const { esc, fmt } = U();
    const inv = L().invoiceMath({ transfer: wc.transfer, mode: wc.transfer.mode, priceItems: data.priceItems, company: P.customer });
    return `${letterhead(data, 'Purchase Invoice', [['Invoice #', wc.wcNumber], ['Date', usDate(wc.date)], ['WC #', wc.wcNumber]])}
      ${customerBlock(P, wc)}
      <table class="doc-table"><thead><tr><th>Description</th><th class="num">Units</th><th class="num">Weight (lbs)</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
        <tbody>${inv.rows.map((r) => `<tr><td>${esc(r.label)}</td><td class="num">${unitsText(r)}</td><td class="num">${fmt(r.weight)}</td>
          <td class="num">${r.rate === null ? '<span class="flag-text">rate needed</span>' : `${L().rateText(r.rate)}/${r.basis}`}</td><td class="num">${L().money(r.amount)}</td></tr>`).join('') || '<tr><td colspan="5">Nothing entered.</td></tr>'}</tbody>
        <tfoot>
          <tr><th colspan="4">Subtotal</th><th class="num">${L().money(inv.subtotal)}</th></tr>
          ${inv.trucking ? `<tr><th colspan="4">${esc(inv.trucking.label)}</th><th class="num">${L().money(inv.trucking.amount)}</th></tr>` : ''}
          <tr class="grand"><th colspan="4">Total due to customer</th><th class="num">${L().money(inv.total)}</th></tr>
        </tfoot></table>
      ${signatures(['Approved by', 'Customer'])}`;
  }

  function form197(wc, data, P, allocs) {
    const { esc, fmt } = U();
    const t = wc.transfer;
    const math = L().transferMath(t);
    const f = math.form197;
    const total = { units: f.crt.units + f.nonCrt.units + f.cbep.units, weight: L().r2(f.crt.weight + f.nonCrt.weight + f.cbep.weight) };
    const activity = [P.handler ? `${P.handler.name} (Handler)` : null, math.hasCrtOrPlasma ? L().CRT_PLASMA_NOTE : null, t.activityNotes || null].filter(Boolean).join('. ');

    const periodById = new Map(data.periods.map((p) => [p.id, p]));
    const byMonth = new Map();
    allocs.forEach((a) => {
      const p = periodById.get(a.claimPeriodId); if (!p) return;
      const k = L().monthIndex(p.year, p.month);
      if (!byMonth.has(k)) byMonth.set(k, { NonCRT: { units: 0, weight: 0 }, CBEP: { units: 0, weight: 0 } });
      const slot = byMonth.get(k)[p.cewType]; if (!slot) return;
      slot.units += L().num(a.units); slot.weight = L().r2(slot.weight + L().num(a.weight));
    });
    const months = [...byMonth.keys()].sort((a, b) => a - b);
    const claimed = months.reduce((s, k) => s + byMonth.get(k).NonCRT.units + byMonth.get(k).CBEP.units, 0);
    const needTables = months.length > 1 || (months.length === 1 && claimed !== total.units);
    const row = (label, v) => `<tr><td>${label}</td><td class="num">${fmt(v.units)}</td><td class="num">${fmt(v.weight)}</td></tr>`;
    const table = (title, k) => {
      const m = byMonth.get(k);
      return `<p><strong>${title}</strong> — Reporting Month/Year: ${k === undefined ? '' : L().monthLabelFromIndex(k)}</p>
        <table class="doc-table"><thead><tr><th>CEW type</th><th class="num">Units</th><th class="num">Weight (lbs)</th></tr></thead><tbody>
          ${row('CA Sourced CRT CEW', { units: 0, weight: 0 })}${row('CA Sourced Non-CRT CEW', m ? m.NonCRT : { units: 0, weight: 0 })}${row('CA Sourced CBEP CEW', m ? m.CBEP : { units: 0, weight: 0 })}
        </tbody></table>`;
    };
    return `
      <div class="doc-head"><div><div class="doc-company">CalRecycle 197 — Transfer Report</div><div>Covered Electronic Waste transfer from an approved collector to an approved recycler</div></div>
        <div class="doc-title"><table class="kv"><tbody><tr><th>WC #</th><td>${esc(wc.wcNumber)}</td></tr></tbody></table></div></div>
      <h3>I. Transfer Information</h3>
      <table class="doc-table"><tbody>
        <tr><th>Date of transfer</th><td>${esc(usDate(wc.date))}</td><th>Approved collector</th><td>${esc(P.collector ? P.collector.name : '—')}</td><th>Collector CEWID #</th><td>${esc(P.collector ? P.collector.cewId : '')}</td></tr>
        <tr><th>Approved recycler</th><td colspan="3">${esc(P.facility.name)}</td><th>Recycler CEWID #</th><td>${esc(P.facility.cewId)}</td></tr>
      </tbody></table>
      ${P.collectorIsFacility && P.dualEntity ? '<p><strong>Dual entity transfer</strong> — we are both the approved collector and the approved recycler.</p>' : ''}
      <h3>II. Transfer Amounts</h3>
      <table class="doc-table"><thead><tr><th>CEW type</th><th class="num">Units transferred</th><th class="num">Weight (lbs)</th></tr></thead><tbody>
        ${row('CA Sourced CRT CEW', f.crt)}${row('CA Sourced Non-CRT CEW', f.nonCrt)}${row('CA Sourced CBEP CEW', f.cbep)}
        <tr><th>Totals</th><th class="num">${fmt(total.units)}</th><th class="num">${fmt(total.weight)}</th></tr>
      </tbody></table>
      <p><strong>Collector activity:</strong> ${esc(activity) || '—'}</p>
      <h3>V. Transfer Discrepancy Detail</h3>
      ${needTables ? table('Recycler Table 1', months[0]) + (months.length > 1 ? table('Recycler Table 2', months[1]) : '<p>Recycler Table 2: left blank until the rest is claimed.</p>')
        : '<p>Tables left blank — everything listed above is claimed in one month.</p>'}
      ${signatures(['Collector signature / date', 'Recycler signature / date'])}`;
  }

  return {
    async render(container) {
      const { h, esc } = U();
      const [idStr, typeParam] = App.State.routeParams;
      const type = TYPES.some(([k]) => k === typeParam) ? typeParam : 'irr';
      const data = await App.Store.loadAll();
      const wc = data.wcs.find((w) => w.id === Number(idStr));
      if (!wc || wc.kind !== 'transfer') {
        container.append(U().header('Documents'), U().empty('Transfer not found', '<a href="#/transfers">Back to transfers</a>'));
        return;
      }
      const P = App.Store.transferParties(wc, data);
      const allocs = data.allocations.filter((a) => a.wcId === wc.id);

      const bar = h(`
        <div class="doc-toolbar">
          <a href="#/wc/${wc.id}">← WC #${esc(wc.wcNumber)}</a>
          <span class="spacer"></span>
          ${TYPES.map(([k, label]) => `<a class="button ${k === type ? 'primary' : ''}" href="#/doc/${wc.id}/${k}">${esc(label)}</a>`).join('')}
          <button type="button" class="primary" data-a="print">Print</button>
        </div>`);
      bar.querySelector('[data-a="print"]').addEventListener('click', () => window.print());
      container.append(bar);

      const inv = L().invoiceMath({ transfer: wc.transfer, mode: wc.transfer.mode, priceItems: data.priceItems, company: P.customer });
      if (type === 'invoice' && inv.missing) container.append(U().notice(`${inv.missing} rate(s) still needed — enter them in the Pricing section of the WC.`, 'warning'));
      if (type === 'invoice' && !wc.transfer.mode) container.append(U().notice('Pick up or drop off isn\u2019t chosen on the WC, so price-list rates can\u2019t be picked.', 'warning'));

      const body = { irr, wc: weightCert, invoice, 197: form197 }[type](wc, data, P, allocs);
      container.append(h(`<div class="doc-sheet print-area">${body}</div>`));
    },
  };
})();
