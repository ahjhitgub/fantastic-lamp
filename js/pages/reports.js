/* Claim forms & reports — made inside a claim period: 197S transfer summary, completeness, the CBEP checklist, claim review. */
window.App = window.App || {};
App.Pages = App.Pages || {};
App.Pages.reports = (function () {
  const L = () => App.Logic;
  let msg = null;
  const CEWIS_TEXT = { name: 'Recycler name', fein: 'Federal employer identification number (Settings)', contact: 'Recycler contact (Settings)', month: 'Reporting month',
    activity: 'Claim activity period', method: 'Cancellation method (chosen on the 196 in CEWIS)', pounds: 'Claimed pounds', dollars: 'Claimed $ amount (payment requested, on the claim period)' };
  const SEC_TEXT = { rec: 'shipped to a recycling facility', land: 'shipped to a hazardous waste landfill', stored: 'stored', none: 'not generated in this claim' };
  const ITEM_TEXT = { acc: 'accumulation start date', bol: 'bill of lading', wc: 'weight certificate with no other residuals on it', receipt: 'receipt from the receiving destination',
    ultimate: 'explanation of ultimate disposition (only if different)', manifest: 'hazardous waste manifest signed by generator and transporter' };
  const OTHER_TEXT = { 'other:flow': 'Material flow for every residual shipment', 'other:wc': 'A weight certificate for every residual shipment', 'other:manifest': 'Manifests for landfill shipments',
    'other:bol': 'Bills of lading for recycling-facility shipments', 'other:totals': 'Total pounds of each residual shipped', 'other:summed': 'Shipping documents summed to the 196C (no mismatches on the CBEP month page)',
    'daily:date': 'Daily cancellation summary: dates', 'daily:pounds': 'Daily cancellation summary: pounds', 'daily:method': 'Cancellation method (on the 196 in CEWIS)', 'daily:equal': 'Total cancelled = pounds claimed',
    'tr:summary': '197S transfer summary', 'tr:receipt': 'Transfer receipt (197) for every transfer', 'tr:wc': 'Weight certificate for every transfer', 'tr:logs': 'Collection logs (198) for every transfer',
    'tr:sa': 'Source-anonymous logs, if applicable', 'tr:pod': 'Proof of Designation, if applicable', 'tr:added': 'Transfer receipts add up to the summary', 'tr:equal': 'Weight transferred and claimed = weight cancelled' };

  /** Every checklist box the app can confirm from the data (key → true/false). */
  function checklist({ period, data, S, daily, M, stored, ships }) {
    const v = {}; const p = data.profile;
    const month = L().periodMonthKey(period);
    const gens = data.wcs.filter((w) => w.kind === 'generation' && w.generation && w.generation.forMonth === month);
    [...L().RESIDUALS_196C, ...L().BATTERY_CHEMISTRIES].forEach((r) => { v[`cert:${r}`] = gens.some((w) => w.generation.residual === r); });
    const claimed = L().sumAllocs(data.allocations.filter((a) => a.claimPeriodId === period.id));
    Object.assign(v, { 'cewis:name': !!p.recyclerName, 'cewis:fein': !!p.fein, 'cewis:contact': !!p.recyclerContact, 'cewis:month': true, 'cewis:activity': claimed.weight > 0,
      'cewis:method': false, 'cewis:pounds': claimed.weight > 0, 'cewis:dollars': L().parseMoney(period.requestedAmount) !== null });
    const mat = (id) => data.materials.find((m) => m.id === id);
    const pw = (w) => w.shipment.paperwork || {};
    const all = (list, f) => list.length > 0 && list.every(f);
    const chemOf = (w) => [...new Set((w.shipment.lines || []).filter((l) => L().lineProgram(w, l) === 'cbep').map((l) => L().residual196C(mat(l.materialId))).filter(L().isBattery))];
    const noMix = (w) => !L().shipmentIssues(w, data.materials).some((x) => /only one battery chemistry/.test(x.text));
    L().BATTERY_CHEMISTRIES.forEach((c) => {
      const mine = ships.filter((w) => chemOf(w).includes(c));
      const rec = mine.filter((w) => pw(w).destination === 'recycling'); const land = mine.filter((w) => pw(w).destination === 'landfill');
      Object.assign(v, {
        [`bat:${c}:rec`]: rec.length > 0, [`bat:${c}:rec:acc`]: all(rec, (w) => !!w.shipment.accumulationStart), [`bat:${c}:rec:bol`]: all(rec, (w) => !!pw(w).bol),
        [`bat:${c}:rec:wc`]: all(rec, noMix), [`bat:${c}:rec:receipt`]: all(rec, (w) => !!pw(w).receiptDate), [`bat:${c}:rec:ultimate`]: all(rec, (w) => !!pw(w).ultimate),
        [`bat:${c}:land`]: land.length > 0, [`bat:${c}:land:acc`]: all(land, (w) => !!w.shipment.accumulationStart),
        [`bat:${c}:land:manifest`]: all(land, (w) => !!pw(w).manifest && !!pw(w).sigGenerator && !!pw(w).sigTransporter),
        [`bat:${c}:land:wc`]: all(land, noMix), [`bat:${c}:land:ultimate`]: all(land, (w) => !!pw(w).ultimate),
      });
      const row = M.rows.find((r) => r.residual === c);
      v[`bat:${c}:stored`] = row.stored > 0; v[`bat:${c}:stored:acc`] = row.stored > 0 && !!stored[`${c}|acc`];
      v[`bat:${c}:none`] = row.generated === 0 && row.shipped === 0;
    });
    const others = ships.filter((w) => (w.shipment.lines || []).some((l) => L().lineProgram(w, l) === 'cbep' && !L().isBattery(L().residual196C(mat(l.materialId)))));
    const recO = others.filter((w) => pw(w).destination !== 'landfill'); const landO = others.filter((w) => pw(w).destination === 'landfill');
    const firstRows = S.rows.map((r) => data.wcs.find((w) => w.id === r.wcId) || {});
    Object.assign(v, {
      'other:flow': all(others, (w) => !!String(pw(w).materialFlow || '').trim()), 'other:wc': others.length > 0,
      'other:manifest': others.length > 0 && landO.every((w) => !!pw(w).manifest && !!pw(w).sigGenerator && !!pw(w).sigTransporter),
      'other:bol': others.length > 0 && recO.every((w) => !!pw(w).bol), 'other:totals': others.length > 0, 'other:summed': others.length > 0 && M.issues.length === 0,
      'daily:date': daily.days.length > 0, 'daily:pounds': daily.days.length > 0, 'daily:method': false,
      'daily:equal': daily.days.length > 0 && Math.abs(daily.total.weight - claimed.weight) < 0.01,
      'tr:summary': S.rows.length > 0, 'tr:receipt': S.rows.length > 0, 'tr:wc': S.rows.length > 0,
      'tr:logs': all(firstRows, (w) => !!L().logBasis(w.transfer || {}).log),
      'tr:sa': S.rows.length > 0 && firstRows.every((w) => { const g = (w.transfer || {}).form197 || {}; return !L().num(g.saCbep) && !L().num(g.saNonCrt); }),
      'tr:pod': false, 'tr:added': S.rows.length > 0,
      'tr:equal': S.rows.length > 0 && Math.abs(daily.total.weight - claimed.weight) < 0.01,
    });
    return v;
  }
  /** What the app couldn't confirm, in plain words (battery boxes only for the outcome that applies). */
  function notConfirmed(v) {
    const out = [];
    Object.keys(CEWIS_TEXT).forEach((k) => { if (!v[`cewis:${k}`]) out.push(`CEWIS: ${CEWIS_TEXT[k]}`); });
    [...L().RESIDUALS_196C, ...L().BATTERY_CHEMISTRIES].forEach((r) => { if (!v[`cert:${r}`] && !(L().isBattery(r) && v[`bat:${r}:none`])) out.push(`Generation certificate: ${r}`); });
    L().BATTERY_CHEMISTRIES.forEach((c) => {
      const secs = ['rec', 'land', 'stored', 'none'].filter((s) => v[`bat:${c}:${s}`]);
      if (!secs.length) out.push(`${c}: nothing recorded (shipped, stored or not generated)`);
      secs.forEach((sec) => Object.keys(ITEM_TEXT).forEach((it) => { const k = `bat:${c}:${sec}:${it}`; if (k in v && !v[k] && it !== 'ultimate') out.push(`${c} ${SEC_TEXT[sec]}: ${ITEM_TEXT[it]}`); }));
    });
    Object.keys(OTHER_TEXT).forEach((k) => { if (!v[k]) out.push(OTHER_TEXT[k]); });
    return out;
  }
  async function fillChecklist(v) {
    await App.UI.loadPdfLib();
    const bytes = await (await fetch('forms/CBEPClaimChecklist.pdf')).arrayBuffer();
    const pdf = await window.PDFLib.PDFDocument.load(bytes);
    const form = pdf.getForm();
    Object.entries(App.ChecklistMap).forEach(([field, key]) => { if (v[key]) { try { form.getCheckBox(field).check(); } catch (e) { /* field missing */ } } });
    return pdf.save();   // left fillable: tick anything the app can't confirm yourself
  }
  function printSheet(html) {
    const sheet = App.UI.h(`<div class="doc-sheet print-area" style="position:fixed;inset:0;overflow:auto;z-index:50">${html}</div>`);
    document.getElementById('main-content').append(sheet);
    const done = () => { sheet.remove(); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done); window.print(); setTimeout(done, 60000);
  }

  return {
    checklist, notConfirmed,
    async render(container) {
      const { h, esc, fmt, header } = App.UI;
      const data = await App.Store.loadAll();
      const period = App.Store.currentPeriod(data);
      container.append(header('Claim forms & reports', 'Made inside a claim period: the 197S transfer summary, a check of each transfer\'s documents, the CBEP checklist, and the claim\'s review after you submit.'));
      if (!period) { container.append(App.UI.empty('Pick a claim period', 'Claim forms are made inside a claim period — pick one at the top right.')); return; }
      if (msg) { container.append(App.UI.notice(msg.text, msg.kind)); msg = null; }
      const label = App.Models.formatPeriodLabel(period);
      const partyName = (w) => { if (!w.transfer) return ''; const P = App.Store.transferParties(w, data); return (P.customer && P.customer.name) || (P.selfCollected ? data.profile.recyclerName : ''); };
      const S = L().transferSummary({ period, allocations: data.allocations, wcs: data.wcs, partyName });

      // ---- 197S
      const sumHtml = (forPrint) => `<table class="${forPrint ? 'doc-table' : 'compact'}" ${forPrint ? '' : 'data-list="transfer-summary"'}><thead><tr><th>WC #</th><th>Received</th><th>Collector / handler</th><th class="num">Units claimed</th><th class="num">Lbs claimed</th><th>Note</th>${forPrint ? '' : '<th></th>'}</tr></thead>
        <tbody>${S.rows.map((r) => `<tr><td>${forPrint ? esc(r.wcNumber) : `<a href="#/wc/${r.wcId}">${esc(r.wcNumber)}</a>`}</td><td>${esc(L().shortDate(r.date))}</td><td>${esc(r.collector)}</td><td class="num">${fmt(r.units)}</td><td class="num">${fmt(r.weight)}</td>
          <td>${r.partial ? 'Partly claimed — the rest on another month\'s claim' : ''}</td>${forPrint ? '' : `<td><a href="#/doc/${r.wcId}/merged">Merged File</a></td>`}</tr>`).join('')}</tbody>
        <tfoot><tr><th colspan="3">Total</th><th class="num">${fmt(S.totals.units)}</th><th class="num">${fmt(S.totals.weight)}</th><th></th>${forPrint ? '' : '<th></th>'}</tr></tfoot></table>`;
      const s197 = h(`<div class="panel"><div class="row spread"><h2>197S — Transfer summary</h2><button type="button" data-a="print">Print</button></div>
        ${S.rows.length ? sumHtml(false) : '<p class="muted">No transfers allocated to this claim yet — allocate them on each transfer\'s WC (Claim periods section).</p>'}</div>`);
      s197.querySelector('[data-a="print"]').addEventListener('click', () => printSheet(`<h3>${esc(data.profile.recyclerName || '')} — 197S Transfer Summary, ${esc(label)}</h3>${sumHtml(true)}`));
      container.append(s197);

      // ---- each transfer's documents
      const rows = S.rows.map((r) => {
        const w = data.wcs.find((x) => x.id === r.wcId) || {};
        const T = App.Store.transfer198(w); const m = L().transferMath(w.transfer || {});
        const items = [['197', true], ['WC', m.irr.units > 0 || m.irr.weight > 0], [`198 ${T.basis.which}`, !!T.basis.log], ['198 C strikes', !T.plan || T.plan.complete]];
        return { r, items };
      });
      container.append(h(`<div class="panel"><h2>Each transfer's documents</h2>
        ${rows.length ? `<table class="compact" data-list="claim-complete"><thead><tr><th>WC #</th><th>197</th><th>WC</th><th>198 O/A</th><th>198 C strikes</th><th>Partial</th></tr></thead>
          <tbody>${rows.map(({ r, items }) => `<tr><td><a href="#/wc/${r.wcId}">${esc(r.wcNumber)}</a></td>${items.map(([k, ok]) => `<td>${ok ? '<span class="badge ok">✓</span>' : `<span class="badge flag">${esc(k)} missing</span>`}</td>`).join('')}<td>${r.partial ? 'yes — noted on its 197' : ''}</td></tr>`).join('')}</tbody></table>
          <p class="hint">Source-anonymous logs and Proofs of Designation, where they apply, are attached on each transfer.</p>` : '<p class="muted">—</p>'}</div>`));

      // ---- CBEP: the completeness checklist
      if (period.cewType === 'CBEP') {
        const month = L().periodMonthKey(period);
        const units = await App.DB.getAllByIndex('cancelledUnits', 'claimPeriodId', period.id);
        const daily = L().dailySummary(units, await App.Store.cbepDaily(period.id));
        const prev = period.month === 1 ? `${period.year - 1}-12` : `${period.year}-${String(period.month - 1).padStart(2, '0')}`;
        const stored = await App.Store.cbepStored(month);
        const ships = data.wcs.filter((w) => w.kind === 'shipment' && ((w.shipment && w.shipment.shipmentType) || 'cew') !== 'cew' && String(w.date || '').slice(0, 7) === month);
        const M = L().cbepMonth({ month, shipments: ships, generations: data.wcs.filter((w) => w.kind === 'generation'), stored, prevStored: await App.Store.cbepStored(prev), materials: data.materials });
        const v = checklist({ period, data, S, daily, M, stored, ships });
        const missing = notConfirmed(v);
        const done = Object.values(App.ChecklistMap).filter((k) => v[k]).length;
        const ck = h(`<div class="panel"><div class="row spread"><h2>CBEP Claim Completeness Checklist</h2><button type="button" class="primary" data-a="fill">Fill in the checklist PDF</button></div>
          <p class="hint mt-0">CalRecycle's checklist (Apr 2026), ticked from what's in the app: <strong>${done} of 108</strong> boxes. It stays fillable, so you can tick the rest yourself (like the cancellation method you pick in CEWIS). The 196C figures are on the <a href="#/cbep">CBEP month</a> page.</p>
          ${missing.length ? `<details ${missing.length < 15 ? 'open' : ''}><summary><strong>${missing.length} item(s) the app couldn't confirm</strong></summary><ul class="issues">${missing.map((x) => `<li class="warning">${esc(x)}</li>`).join('')}</ul></details>` : App.UI.notice('Everything on the checklist is confirmed.', 'ok').outerHTML}
          <div data-role="pdf"></div></div>`);
        ck.querySelector('[data-a="fill"]').addEventListener('click', async () => {
          const box = ck.querySelector('[data-role="pdf"]'); box.replaceChildren(h('<p class="muted">Filling in the checklist…</p>'));
          try {
            const url = URL.createObjectURL(new Blob([await fillChecklist(v)], { type: 'application/pdf' }));
            box.replaceChildren(h(`<div class="pdf-box"><div class="row"><a class="button" href="${url}" target="_blank" rel="noopener">Open in a new tab</a><a class="button" data-a="download" href="${url}" download="CBEP_Checklist_${month}.pdf">Download PDF</a></div><iframe class="pdf-frame" title="CBEP checklist" src="${url}"></iframe></div>`));
          } catch (err) { box.replaceChildren(App.UI.notice(`${App.UI.errText(err)} The checklist needs the site opened from its web address.`, 'error')); }
        });
        container.append(ck);
      }

      // ---- after submitting: CalRecycle's 30-day review, and closure
      const due = period.submittedDate ? (() => { const d = new Date(`${period.submittedDate}T00:00:00`); d.setDate(d.getDate() + 30); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })() : '';
      const owed = period.cewType === 'CBEP' ? L().claimOwed(data.wcs.filter((w) => w.kind === 'shipment' && String(w.date || '').slice(0, 7) === L().periodMonthKey(period)), data.materials) : [];
      const rv = h(`<div class="panel" data-period-ok><h2>Claim review</h2>
        <p class="hint mt-0">CalRecycle reviews a claim for completeness within 30 calendar days; an incomplete claim comes back with the reasons, to fix and resubmit.</p>
        <div class="field-row">
          <div class="field"><label>Submitted on</label><input type="date" data-r="submittedDate" value="${esc(period.submittedDate || '')}"></div>
          <div class="field"><label>Review due by</label><div class="readonly">${due ? esc(L().shortDate(due)) : '—'}</div></div>
          <div class="field"><label>Review result</label><select data-r="reviewStatus">${[['', 'Waiting'], ['complete', 'Complete'], ['incomplete', 'Incomplete — rejected']].map(([k, l]) => `<option value="${k}" ${(period.reviewStatus || '') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="field"><label>Closed on</label><input type="date" data-r="closedDate" value="${esc(period.closedDate || '')}"></div>
        </div>
        <div class="field"><label>Reasons it was incomplete / what to fix</label><textarea rows="2" data-r="deficiencies">${esc(period.deficiencies || '')}</textarea></div>
        ${owed.length ? `<h3>Still owed before it can close</h3><ul>${owed.map((o) => `<li><a href="#/wc/${o.wc.id}">${esc(o.text)}</a></li>`).join('')}</ul><p class="hint">These may come after submitting, but the claim isn't paid until they're in.</p>` : ''}
        <button type="button" class="primary" data-a="save">Save review</button></div>`);
      rv.querySelector('[data-a="save"]').addEventListener('click', async () => {
        const rec = await App.DB.get('claimPeriods', period.id);
        rv.querySelectorAll('[data-r]').forEach((i) => { rec[i.dataset.r] = i.value.trim(); });
        await App.DB.put('claimPeriods', rec);
        msg = { kind: 'ok', text: 'Claim review saved.' }; App.rerender();
      });
      container.append(rv);
    },
  };
}());
