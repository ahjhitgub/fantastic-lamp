/* CBEP month: end-of-month generation certificates, month-end stored amounts, and the 196C §IV / §V figures. */
window.App = window.App || {};
App.Pages = App.Pages || {};
App.Pages.cbep = (function () {
  const L = () => App.Logic;
  let msg = null;
  const monthLabel = (m) => L().monthLabel(Number(m.slice(0, 4)), Number(m.slice(5, 7)));
  const lastDay = (m) => L().periodEnd({ year: Number(m.slice(0, 4)), month: Number(m.slice(5, 7)) });
  const prevMonth = (m) => { const y = Number(m.slice(0, 4)); const mo = Number(m.slice(5, 7)); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`; };

  /** Months with CBEP activity whose generation certificates are due (from their last day) and not issued yet. */
  function dueMonths(data) {
    const today = App.UI.today();
    const months = new Set(data.periods.filter((p) => p.cewType === 'CBEP').map((p) => L().periodMonthKey(p)));
    data.wcs.forEach((w) => { if (w.kind === 'shipment' && (w.shipment && w.shipment.shipmentType || 'cew') !== 'cew') months.add(String(w.date || '').slice(0, 7)); });
    const issued = new Set(data.wcs.filter((w) => w.kind === 'generation' && w.generation).map((w) => w.generation.forMonth));
    return [...months].filter((m) => /^\d{4}-\d{2}$/.test(m) && today >= lastDay(m) && !issued.has(m)).sort();
  }

  return {
    dueMonths,
    async render(container, opts = {}) {
      const { h, esc, fmt, options, header } = App.UI;
      const data = await App.Store.loadAll();
      const period = App.Store.currentPeriod(data);
      if (!opts.embedded) container.append(header('CBEP generation certificates', 'End-of-month generation certificates (one per residual type, each battery chemistry separately), month-end stored amounts, and the 196C figures. Inside a CBEP claim period this is on its Residuals page.'));
      if (period && period.cewType !== 'CBEP') { container.append(App.UI.empty('This is a CBEP page', `Pick a CBEP claim period, or <strong>All — no claim period</strong>, at the top right.`)); return; }
      const months = new Set(data.periods.filter((p) => p.cewType === 'CBEP').map((p) => L().periodMonthKey(p)));
      months.add(App.UI.today().slice(0, 7));
      const param = App.State.routeParams[0];
      const month = period ? L().periodMonthKey(period) : (/^\d{4}-\d{2}$/.test(param || '') ? param : [...months].sort().reverse()[0]);
      months.add(month);
      if (msg) { container.append(App.UI.notice(msg.text, msg.kind)); msg = null; }
      if (!period) {
        const pick = h(`<div class="panel row"><label class="row"><strong>Month</strong> <select data-a="month">${[...months].sort().reverse().map((m) => `<option value="${m}" ${m === month ? 'selected' : ''}>${esc(monthLabel(m))}</option>`).join('')}</select></label></div>`);
        pick.querySelector('[data-a="month"]').addEventListener('change', (e) => App.UI.go(`#/cbep/${e.target.value}`));
        container.append(pick);
      }
      const shipments = data.wcs.filter((w) => w.kind === 'shipment' && ((w.shipment && w.shipment.shipmentType) || 'cew') !== 'cew');
      const generations = data.wcs.filter((w) => w.kind === 'generation');
      const stored = await App.Store.cbepStored(month);
      const prevStored = await App.Store.cbepStored(prevMonth(month));
      const M = L().cbepMonth({ month, shipments, generations, stored, prevStored, materials: data.materials });
      const issuedFor = generations.filter((w) => w.generation && w.generation.forMonth === month);
      const due = App.UI.today() >= lastDay(month);

      // ---- generation certificates
      const residuals = [...L().RESIDUALS_196C, ...L().BATTERY_CHEMISTRIES];
      const open = residuals.filter((r) => !issuedFor.some((w) => w.generation.residual === r));
      const gen = h(`<div class="panel"><h2>Generation certificates — ${esc(monthLabel(month))}</h2>
        <p class="hint mt-0">One weight certificate per residual type showing what was generated during the whole month, numbered from your WC sequence. ${due ? '' : `They're due from ${esc(L().shortDate(lastDay(month)))}.`}</p>
        ${issuedFor.length ? `<table class="compact" data-list="cbep-gen"><thead><tr><th>WC #</th><th>Residual</th><th class="num">Generated (lbs)</th><th>Date</th><th></th></tr></thead><tbody>${issuedFor.map((w) => `<tr><td><a href="#/wc/${w.id}">${esc(w.wcNumber)}</a></td><td>${esc(w.generation.residual)}</td><td class="num">${fmt(L().lineNet(w.generation.lines[0] || {}))}</td><td>${esc(L().shortDate(w.date))}</td><td><a href="#/doc/${w.id}/wc">Print</a></td></tr>`).join('')}</tbody></table>` : ''}
        ${open.length ? `<h3>Issue ${issuedFor.length ? 'more' : 'them'}</h3>
          <p class="muted">Enter each residual's generated weight from your weighing; leave the ones you didn't generate blank. "Shipped" is what this month's CBEP shipment WCs show, for reference.</p>
          <table class="lines"><thead><tr><th>Residual</th><th class="num">Shipped this month</th><th class="num">Generated (lbs)</th></tr></thead>
          <tbody>${open.map((r) => { const row = M.rows.find((x) => x.residual === r); return `<tr><td>${esc(r)}</td><td class="num">${row.shipped ? fmt(row.shipped) : '—'}</td><td><input data-gen="${esc(r)}" inputmode="decimal" style="width:110px"></td></tr>`; }).join('')}</tbody></table>
          <div class="field-row"><div class="field"><label>Date on the certificates</label><input type="date" data-a="date" value="${esc(due && App.UI.today() > lastDay(month) ? App.UI.today() : lastDay(month))}"></div>
            <div class="field"><label>Scale person</label><select data-a="scale">${options((data.profile.wcSigners || []).map((n) => ({ value: n, label: n })), '', '-- choose --')}</select></div>
            <div class="field"><label>&nbsp;</label><button type="button" class="primary" data-a="issue">Issue certificates</button></div></div>
          <p class="hint">Numbers are assigned when you click Issue — the next free WC numbers, one per residual. A certificate dated after the month still counts for ${esc(monthLabel(month))}.</p>` : '<p class="muted">Every residual type has its certificate for this month.</p>'}
      </div>`);
      const issueBtn = gen.querySelector('[data-a="issue"]');
      if (issueBtn) issueBtn.addEventListener('click', async () => {
        const entries = [...gen.querySelectorAll('[data-gen]')].map((i) => ({ residual: i.dataset.gen, net: i.value.trim() })).filter((e) => L().num(e.net) > 0);
        if (!entries.length) { msg = { kind: 'error', text: 'Enter at least one residual\'s generated weight.' }; App.rerender(); return; }
        if (!window.confirm(`Issue ${entries.length} generation certificate(s) for ${monthLabel(month)}? They take the next ${entries.length} WC number(s).`)) return;
        try {
          const ids = await App.Store.issueGeneration({ month, entries, date: gen.querySelector('[data-a="date"]').value || lastDay(month), scalePerson: gen.querySelector('[data-a="scale"]').value });
          const made = (await App.DB.getAll('wcs')).filter((w) => ids.includes(w.id)).map((w) => `#${w.wcNumber}`);
          msg = { kind: 'ok', text: `Issued ${ids.length} generation certificate(s): WC ${made.join(', ')}.` };
        } catch (err) { msg = { kind: 'error', text: App.UI.errText(err) }; }
        App.rerender();
      });
      container.append(gen);

      // ---- month-end stored amounts (tracked outside WCs)
      const st = h(`<div class="panel"><h2>Stored at the end of ${esc(monthLabel(month))}</h2>
        <p class="hint mt-0">What you had on hand at month-end, as you track it. The app checks: generated = shipped + stored now − stored at the end of last month.</p>
        <table class="lines"><thead><tr><th>Residual</th><th class="num">End of last month</th><th class="num">End of this month (lbs)</th><th>Batteries: accumulation start</th><th>Check</th></tr></thead>
        <tbody>${residuals.map((r) => { const row = M.rows.find((x) => x.residual === r); return `<tr><td>${esc(r)}</td><td class="num">${prevStored[r] !== undefined && prevStored[r] !== '' ? fmt(L().num(prevStored[r])) : '—'}</td>
          <td><input data-st="${esc(r)}" inputmode="decimal" style="width:110px" value="${esc(stored[r] ?? '')}"></td>
          <td>${L().isBattery(r) ? `<input type="date" data-acc="${esc(r)}" value="${esc(stored[`${r}|acc`] || '')}">` : ''}</td>
          <td>${row.storedEnd === null ? '' : row.storageOk ? '<span class="badge ok">adds up</span>' : `<span class="badge flag">expected ${fmt(row.expectedGenerated)} generated</span>`}</td></tr>`; }).join('')}</tbody></table>
        <button type="button" data-a="save-stored">Save stored amounts</button></div>`);
      st.querySelector('[data-a="save-stored"]').addEventListener('click', async () => {
        const values = {}; st.querySelectorAll('[data-st]').forEach((i) => { if (i.value.trim() !== '') values[i.dataset.st] = L().r2(L().num(i.value)); });
        st.querySelectorAll('[data-acc]').forEach((i) => { if (i.value) values[`${i.dataset.acc}|acc`] = i.value; });
        await App.Store.saveCbepStored(month, values);
        msg = { kind: 'ok', text: 'Stored amounts saved.' }; App.rerender();
      });
      container.append(st);

      // ---- 196C figures
      const n = (x) => fmt(x);
      container.append(h(`<div class="panel"><h2>196C figures — ${esc(monthLabel(month))}</h2>
        ${M.issues.length ? `<ul class="issues">${M.issues.map((t) => `<li class="warning">${esc(t)}</li>`).join('')}</ul>` : ''}
        <h3>IV. Post-cancellation disposition for batteries</h3>
        <table class="compact"><thead><tr><th>Battery type</th><th class="num">Generated from cancellation</th><th class="num">Shipped</th><th class="num">Stored</th></tr></thead>
        <tbody>${M.sec4.map((r) => `<tr><td>${esc(r.residual.replace(/ Batteries$/, ''))}</td><td class="num">${n(r.generated)}</td><td class="num">${n(r.shipped)}</td><td class="num">${n(r.stored)}</td></tr>`).join('')}</tbody></table>
        <h3>V. Weight of treatment residuals generated from cancelled CBEP CEW</h3>
        <div class="table-scroll"><table class="compact"><thead><tr><th></th>${L().RESIDUALS_196C.map((r) => `<th class="num">${esc(r)}</th>`).join('')}<th class="num">All battery chemistries</th><th class="num">Total</th></tr></thead>
        <tbody><tr><th>Shipped</th>${M.sec5.map((r) => `<td class="num">${n(r.shipped)}</td>`).join('')}<td class="num">NA</td><td class="num">${n(M.totals.shipped)}</td></tr>
          <tr><th>Stored</th>${M.sec5.map((r) => `<td class="num">${n(r.stored)}</td>`).join('')}<td class="num">NA</td><td class="num">${n(M.totals.stored)}</td></tr>
          <tr><th>Total</th>${M.sec5.map((r) => `<td class="num">${n(r.generated)}</td>`).join('')}<td class="num">${n(M.allBatteries)}</td><td class="num">${n(M.totals.total)}</td></tr></tbody></table></div>
        <p class="hint">Generated = the month's generation certificates; shipped = the month's CBEP shipment WCs (CBEP lines only, by their 196C residual); stored = generated − shipped.</p></div>`));

      // ---- still owed before the claim can close
      const owed = L().claimOwed(shipments.filter((w) => String(w.date || '').slice(0, 7) === month), data.materials);
      container.append(h(`<div class="panel"><h2>Still owed before the claim closes</h2>
        ${owed.length ? `<ul>${owed.map((o) => `<li><a href="#/wc/${o.wc.id}">${esc(o.text)}</a></li>`).join('')}</ul><p class="hint">These may come after you submit, but the claim isn't paid until they're in.</p>` : '<p class="muted">Nothing owed for this month\'s CBEP shipments.</p>'}</div>`));
    },
  };
}());
