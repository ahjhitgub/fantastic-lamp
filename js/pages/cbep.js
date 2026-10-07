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
      const metaNow = await App.Store.cbepStored(month); const metaPrev = await App.Store.cbepStored(prevMonth(month));
      const fromCheck = L().cbepStoredFromChecks(data.wcs, data.materials, month);
      const prevCheck = L().cbepStoredFromChecks(data.wcs, data.materials, prevMonth(month));
      const accOnly = Object.fromEntries(Object.entries(metaNow).filter(([k]) => k.endsWith('|acc')));
      const stored = fromCheck ? { ...fromCheck, ...accOnly } : metaNow;
      const prevStored = prevCheck || metaPrev;
      const editable = !!(period && period.cewType === 'CBEP');   // daily log and month-end check: claim work, inside the CBEP period
      const genDays = await App.Store.cbepGenDays(month);
      const daily = L().cbepDailyResiduals(genDays, data.materials);
      const cbepMats = data.materials.filter((m) => m.program === 'cbep');
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
          <p class="muted">Pre-filled from the daily residual log where you kept one, otherwise worked out as shipped + stored at month-end − stored last month. Check each against your weighing; leave the ones you didn't generate blank.</p>
          <table class="lines"><thead><tr><th>Residual</th><th class="num">Shipped this month</th><th class="num">Generated (lbs)</th></tr></thead>
          <tbody>${open.map((r) => { const row = M.rows.find((x) => x.residual === r); return `<tr><td>${esc(r)}</td><td class="num">${row.shipped ? fmt(row.shipped) : '—'}</td><td><input data-gen="${esc(r)}" inputmode="decimal" style="width:110px" value="${(() => {
            if (daily.totals[r]) return daily.totals[r];
            if (row.storedEnd !== null) { const v = L().r2(row.storedEnd - (L().num(prevStored[r]) || 0) + row.shipped); return v > 0 ? v : ''; }
            return row.shipped || '';
          })()}"></td></tr>`; }).join('')}</tbody></table>
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

      // ---- the daily residual log (what was generated each day from dismantling)
      const units = period ? await App.DB.getAllByIndex('cancelledUnits', 'claimPeriodId', period.id) : [];
      const cancelled = period ? L().dailySummary(units, await App.Store.cbepDaily(period.id)) : { days: [] };
      const cancelledOn = new Map(cancelled.days.map((d) => [d.date, d.weight]));
      const cats = [...L().RESIDUALS_196C, ...L().BATTERY_CHEMISTRIES].filter((r) => daily.totals[r]);
      const matOpts = (sel) => cbepMats.map((m) => `<option value="${m.id}" ${m.id === sel ? 'selected' : ''}>${esc(L().materialLabel(m))}</option>`).join('');
      const dl = h(`<div class="panel"><h2>Daily CBEP residuals — generated from dismantling</h2>
        <p class="hint mt-0">Optional — a help for tracking, never required. Each day, what was generated from dismantling CBEP, by your own CBEP residual names (Settings → Materials, in All), sorted into the 196C categories. When you keep it, its totals fill in the generation certificates.</p>
        ${daily.rows.length ? `<div class="table-scroll"><table class="compact" data-list="cbep-daily-res"><thead><tr><th>Date</th>${cats.map((c) => `<th class="num">${esc(c)}</th>`).join('')}<th class="num">Total</th><th class="num">Lbs cancelled that day</th>${editable ? '<th></th>' : ''}</tr></thead>
          <tbody>${daily.rows.map((r) => `<tr><td>${esc(L().shortDate(r.date))}</td>${cats.map((c) => `<td class="num">${r.byRes[c] ? fmt(r.byRes[c]) : ''}</td>`).join('')}<td class="num"><strong>${fmt(r.total)}</strong></td>
            <td class="num">${cancelledOn.has(r.date) ? fmt(cancelledOn.get(r.date)) : '<span class="flag-text">none logged</span>'}</td>${editable ? `<td><button type="button" class="small" data-edit-day="${r.date}">Edit</button></td>` : ''}</tr>`).join('')}</tbody>
          <tfoot><tr><th>Month</th>${cats.map((c) => `<th class="num">${fmt(daily.totals[c])}</th>`).join('')}<th class="num">${fmt(daily.total)}</th><th class="num">${fmt(cancelled.days.reduce((a, d) => a + d.weight, 0))}</th>${editable ? '<th></th>' : ''}</tr></tfoot></table></div>` : '<p class="muted">No days logged yet.</p>'}
        ${daily.rows.length && cancelled.days.filter((d) => !genDays[d.date]).length ? `<p class="muted">Days with cancellations but nothing logged here: ${esc(cancelled.days.filter((d) => !genDays[d.date]).map((d) => L().shortDate(d.date)).join(', '))}</p>` : ''}
        ${editable ? `<h3>Log a day</h3><div class="field-row"><div class="field"><label>Date</label><input type="date" data-a="day" value="${esc(App.UI.today().slice(0, 7) === month ? App.UI.today() : lastDay(month))}"></div></div>
          <table class="lines"><thead><tr><th>Residual (your name)</th><th class="num">Lbs generated</th><th></th></tr></thead><tbody data-role="day-lines"></tbody></table>
          <div class="row"><button type="button" data-a="add-line">+ Add a residual</button><span class="spacer"></span><button type="button" class="primary" data-a="save-day">Save this day</button></div>` : '<p class="muted">Logged inside the CBEP claim period for this month.</p>'}
      </div>`);
      if (editable) {
        let lines = [];
        const tb = dl.querySelector('[data-role="day-lines"]'); const dayIn = dl.querySelector('[data-a="day"]');
        const draw = () => {
          tb.replaceChildren(...lines.map((l, i) => {
            const tr = h(`<tr><td><select>${matOpts(l.materialId)}</select></td><td><input inputmode="decimal" style="width:110px" value="${esc(l.net ?? '')}"></td><td><button type="button" class="ghost" title="Remove">✕</button></td></tr>`);
            tr.querySelector('select').addEventListener('change', (e) => { l.materialId = Number(e.target.value); });
            tr.querySelector('input').addEventListener('input', (e) => { l.net = e.target.value; });
            tr.querySelector('button').addEventListener('click', () => { lines.splice(i, 1); draw(); });
            return tr;
          }));
        };
        const load = (date) => { lines = (genDays[date] || []).map((l) => ({ ...l })); if (!lines.length) lines = [{ materialId: cbepMats[0] && cbepMats[0].id, net: '' }]; draw(); };
        load(dayIn.value);
        dayIn.addEventListener('change', () => load(dayIn.value));
        dl.querySelector('[data-a="add-line"]').addEventListener('click', () => { lines.push({ materialId: cbepMats[0] && cbepMats[0].id, net: '' }); draw(); });
        dl.querySelectorAll('[data-edit-day]').forEach((b) => b.addEventListener('click', () => { dayIn.value = b.dataset.editDay; load(b.dataset.editDay); dayIn.scrollIntoView({ block: 'center' }); }));
        dl.querySelector('[data-a="save-day"]').addEventListener('click', async () => {
          const date = dayIn.value;
          if (!date || date.slice(0, 7) !== month) { msg = { kind: 'error', text: `Pick a day in ${monthLabel(month)}.` }; App.rerender(); return; }
          const keep = lines.filter((l) => l.materialId && L().num(l.net) > 0).map((l) => ({ materialId: Number(l.materialId), net: L().r2(L().num(l.net)) }));
          await App.Store.saveCbepGenDay(month, date, keep);
          msg = { kind: 'ok', text: keep.length ? `Saved ${L().shortDate(date)}: ${fmt(keep.reduce((a, l) => a + l.net, 0))} lbs.` : `Removed ${L().shortDate(date)}.` }; App.rerender();
        });
      }

      // ---- the month-end inventory check (what was stored at month-end, by your names → 196C categories)
      const checks = data.wcs.filter((w) => L().isCbepInventory(w) && L().inventoryMonthKey(w) === month);
      const st = h(`<div class="panel"><h2>Month-end inventory check — ${esc(monthLabel(month))}</h2>
        <p class="hint mt-0">Everything stored at month-end, by your own names (no WC), sorted into the 196C categories. It's the month's stored figures for the 196C and the checks below. CBEP checks count only toward the CBEP claim.</p>
        ${checks.length ? `<p>${checks.map((w) => `<a class="button" href="#/wc/${w.id}">${editable ? 'Open' : 'View'} the check (${esc(L().shortDate(w.date))})</a>`).join(' ')}</p>` : editable ? '<button type="button" class="primary" data-a="make-check">Make the month-end inventory check</button>' : '<p class="muted">Made inside the CBEP claim period for this month.</p>'}
        <table class="lines"><thead><tr><th>196C category</th><th class="num">End of last month</th><th class="num">End of this month</th><th>Batteries: accumulation start</th><th>Check</th></tr></thead>
        <tbody>${residuals.map((r) => { const row = M.rows.find((x) => x.residual === r); return `<tr><td>${esc(r)}</td><td class="num">${prevStored[r] !== undefined && prevStored[r] !== '' ? fmt(L().num(prevStored[r])) : '—'}</td>
          <td class="num">${stored[r] !== undefined && stored[r] !== '' ? fmt(L().num(stored[r])) : '—'}</td>
          <td>${L().isBattery(r) ? `<input type="date" data-acc="${esc(r)}" value="${esc(stored[`${r}|acc`] || '')}" ${editable ? '' : 'disabled'}>` : ''}</td>
          <td>${(() => {   // against the generation certificate once issued, else the daily log
            if (row.storedEnd === null) return '';
            if (!row.certs.length && !daily.totals[r]) return '';   // nothing to compare yet — the daily log is optional
            const gen = row.certs.length ? row.generated : daily.totals[r];
            return Math.abs(row.expectedGenerated - gen) < 0.01 ? '<span class="badge ok">adds up</span>'
              : `<span class="badge flag">${row.certs.length ? 'certificate' : 'daily log'} says ${fmt(gen)}; shipped + stored − last month = ${fmt(row.expectedGenerated)}</span>`;
          })()}</td></tr>`; }).join('')}</tbody></table>
        ${editable ? '<button type="button" data-a="save-acc">Save accumulation start dates</button>' : ''}</div>`);
      const mk = st.querySelector('[data-a="make-check"]');
      if (mk) mk.addEventListener('click', async () => { const id = await App.Store.createCbepCheck(month, lastDay(month)); App.Pages.wc.reset(); App.UI.go(`#/wc/${id}`); });
      const sa = st.querySelector('[data-a="save-acc"]');
      if (sa) sa.addEventListener('click', async () => {
        const values = { ...metaNow }; st.querySelectorAll('[data-acc]').forEach((i) => { if (i.value) values[`${i.dataset.acc}|acc`] = i.value; else delete values[`${i.dataset.acc}|acc`]; });
        await App.Store.saveCbepStored(month, values);
        msg = { kind: 'ok', text: 'Accumulation start dates saved.' }; App.rerender();
      });
      container.append(dl, st, gen);

      // ---- daily log ↔ certificates ↔ shipped + stored
      const recon = residuals.map((r) => {
        const row = M.rows.find((x) => x.residual === r); const d = daily.totals[r] || 0;
        const viaStorage = row.storedEnd === null ? null : row.expectedGenerated;
        const logged = d > 0;
        const ok = logged
          ? (!row.certs.length || Math.abs(d - row.generated) < 0.01) && (viaStorage === null || Math.abs(d - viaStorage) < 0.01)
          : (!row.certs.length || viaStorage === null || Math.abs(row.generated - viaStorage) < 0.01);
        return { r, d, cert: row.generated, ship: row.shipped, viaStorage, ok, logged };
      }).filter((x) => x.d || x.cert || x.ship || x.viaStorage);
      if (recon.length) container.append(h(`<div class="panel"><h2>Reconcile — ${esc(monthLabel(month))}</h2>
        <table class="compact"><thead><tr><th>196C category</th><th class="num">Daily log</th><th class="num">Generation certificate</th><th class="num">Shipped + stored − last month's stored</th><th></th></tr></thead>
        <tbody>${recon.map((x) => `<tr><td>${esc(x.r)}</td><td class="num">${x.logged ? fmt(x.d) : '<span class="muted">not kept</span>'}</td><td class="num">${x.cert ? fmt(x.cert) : '—'}</td><td class="num">${x.viaStorage === null ? '—' : fmt(x.viaStorage)}</td>
          <td>${x.ok ? '<span class="badge ok">matches</span>' : '<span class="badge flag">check</span>'}</td></tr>`).join('')}</tbody></table></div>`));

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
