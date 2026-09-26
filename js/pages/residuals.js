window.App = window.App || {};
App.Pages = App.Pages || {};

/**
 * Residuals for one month, calculated from WCs:
 * generated = shipped this month + end-of-month inventory − last month's end-of-month inventory.
 */
App.Pages.residuals = (function () {
  let monthOverride = null; // 'YYYY-MM'

  return {
    async render(container) {
      const { h, esc, fmt, header, options } = App.UI;
      const L = App.Logic;
      const data = await App.Store.loadAll();
      const active = data.periods.find((p) => p.id === App.State.currentPeriodId);
      const key = monthOverride || (active ? L.monthKey(active.year, active.month) : App.UI.today().slice(0, 7));
      const [year, month] = key.split('-').map(Number);
      const s = L.residualSummary({ year, month, materials: data.materials, wcs: data.wcs });
      const pv = L.fromIndex(L.monthIndex(year, month) - 1);
      const compName = (id) => (data.companies.find((c) => c.id === id) || {}).name || '—';
      const matName = (id) => (data.materials.find((m) => m.id === id) || {}).name || '?';

      container.append(header('Residuals', 'Calculated from residual-shipment WCs and end-of-month inventory WCs. Nothing here is typed in directly.'));

      const top = h(`
        <div class="panel"><div class="field-row">
          <div class="field"><label>Month</label><input type="month" data-f="month" value="${key}"></div>
          <div class="field" style="flex:3"><label>&nbsp;</label><p class="muted mt-0">Generated = shipped this month + this month's end-of-month inventory − ${esc(L.monthLabel(pv.year, pv.month))}'s end-of-month inventory.</p></div>
        </div></div>`);
      top.querySelector('[data-f="month"]').addEventListener('change', (e) => { monthOverride = e.target.value || null; App.rerender(); });
      container.append(top);

      s.warnings.forEach((w) => container.append(App.UI.notice(w, 'warning')));

      // quick create
      const types = data.wcTypes.filter((t) => t.kind === 'shipment' || t.kind === 'inventory');
      const create = h(`
        <form class="panel">
          <h2>New residual WC</h2>
          <div class="field-row">
            <div class="field"><label>Type</label><select name="typeId">${options(types.map((t) => ({ value: t.id, label: t.name })), '')}</select></div>
            <div class="field"><label>WC #</label><input name="wcNumber" required value="${esc(L.nextWcNumber(data.wcs))}"></div>
            <div class="field" style="flex:2"><label data-role="party-label"></label><select name="party"></select></div>
            <div class="field"><label>Date</label><input type="date" name="date" value="${App.UI.today().slice(0, 7) === key ? App.UI.today() : L.lastDayISO(year, month)}"></div>
            <div class="field"><label>&nbsp;</label><button type="submit" class="primary">Create and open</button></div>
          </div>
          <p class="hint">An inventory check counts as the end-of-month inventory for the month of its date (you can change that on the WC).</p>
          <div data-role="err"></div>
        </form>`);
      const typeSel = create.querySelector('[name="typeId"]');
      const syncParty = () => {
        const kind = (types.find((t) => t.id === Number(typeSel.value)) || {}).kind || 'generic';
        create.querySelector('[data-role="party-label"]').textContent = App.Store.partyLabel(kind);
        create.querySelector('[name="party"]').innerHTML = App.Store.partyOptions(kind, data.companies, '');
      };
      typeSel.addEventListener('change', syncParty);
      syncParty();
      create.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(create);
        try {
          const id = await App.Store.createWC({ wcNumber: fd.get('wcNumber'), typeId: Number(fd.get('typeId')), date: fd.get('date'), party: fd.get('party') });
          App.Pages.wc.reset();
          App.UI.go(`#/wc/${id}`);
        } catch (err) { create.querySelector('[data-role="err"]').replaceChildren(App.UI.notice(App.UI.errText(err), 'error')); }
      });
      container.append(create);

      // per-material summary
      const active2 = s.rows.filter((r) => r.prevStored || r.shipped || r.endStored);
      container.append(h(`
        <div class="panel"><h2>${esc(L.monthLabel(year, month))} by material</h2>
          ${active2.length ? `<div class="table-scroll"><table>
            <thead><tr><th>Material</th><th>196B column</th><th class="num">Stored end of ${esc(L.MONTHS[pv.month - 1])}</th><th class="num">Shipped</th><th class="num">Stored end of ${esc(L.MONTHS[month - 1])}</th><th class="num">Generated</th><th class="num">Stored from this month</th></tr></thead>
            <tbody>${active2.map((r) => `<tr>
              <td>${esc(r.material.name)}</td><td class="muted">${esc(r.material.category)}</td>
              <td class="num">${fmt(r.prevStored)}</td><td class="num">${fmt(r.shipped)}</td><td class="num">${fmt(r.endStored)}</td>
              <td class="num ${r.generated < 0 ? 'flag-text' : ''}"><strong>${fmt(r.generated)}</strong></td><td class="num">${fmt(r.monthlyStored)}</td></tr>`).join('')}</tbody>
          </table></div>` : '<p class="muted">No shipments or inventory recorded for this month or the one before.</p>'}
        </div>`));

      // 196B section V / IV
      const c = s.categories; const z = { generated: 0, stored: 0, shipped: 0 };
      const cols = L.FORM_V_CATEGORIES;
      const tot = cols.reduce((a, k) => { const v = c[k] || z; return { shipped: a.shipped + v.shipped, stored: a.stored + v.stored, generated: a.generated + v.generated }; }, { ...z });
      const lamps = c['LCD Lamps (§IV)'] || z; const plasma = c['Bare Plasma Panels (§IV)'] || z;
      container.append(h(`
        <div class="panel form-preview"><h2>For the 196B</h2>
          <h3>IV. Post-Cancellation Disposition</h3>
          <table><thead><tr><th>Screen type</th><th class="num">Generated</th><th class="num">Shipped</th><th class="num">Stored</th></tr></thead><tbody>
            <tr><td>Bare Plasma Panels</td><td class="num">${plasma.generated ? fmt(plasma.generated) : 'N/A'}</td><td class="num">${plasma.generated ? fmt(plasma.shipped) : 'N/A'}</td><td class="num">${plasma.generated ? fmt(plasma.stored) : 'N/A'}</td></tr>
            <tr><td>LCD Lamps</td><td class="num">${fmt(lamps.generated)}</td><td class="num">${fmt(lamps.shipped)}</td><td class="num">${fmt(lamps.stored)}</td></tr>
          </tbody></table>
          <h3>V. Treatment Residuals</h3>
          <div class="table-scroll"><table><thead><tr><th></th>${cols.map((k) => `<th class="num">${esc(k)}</th>`).join('')}<th class="num">Total</th></tr></thead><tbody>
            ${['shipped', 'stored', 'generated'].map((row) => `<tr><th>${row === 'generated' ? 'Total' : row[0].toUpperCase() + row.slice(1)}</th>${cols.map((k) => `<td class="num">${fmt((c[k] || z)[row])}</td>`).join('')}<td class="num"><strong>${fmt(tot[row])}</strong></td></tr>`).join('')}
          </tbody></table></div>
          <p class="hint">Shipped here = this month's generation that left the building (generated − stored), which is how your filed 196Bs report it. Other (Specify): WASTE.</p>
        </div>`));

      // source documents
      const docRow = (w) => {
        const lines = ((w.shipment || w.inventory || {}).lines || []).filter((l) => L.lineNet(l));
        return `<tr><td><a href="#/wc/${w.id}">${esc(w.wcNumber)}</a></td><td>${esc(w.date)}</td><td>${esc(compName(w.companyId))}</td>
          <td>${esc(lines.map((l) => `${matName(l.materialId)} ${fmt(L.lineNet(l))}`).join(', '))}</td></tr>`;
      };
      const docTable = (title, list, empty) => `<h3>${title}</h3>${list.length ? `<table><thead><tr><th>WC #</th><th>Date</th><th>Company</th><th>Materials (net lbs)</th></tr></thead><tbody>${list.map(docRow).join('')}</tbody></table>` : `<p class="muted">${empty}</p>`}`;
      container.append(h(`
        <div class="panel"><h2>Source WCs</h2>
          ${docTable(`Shipped in ${esc(L.monthLabel(year, month))}`, s.shipments, 'None.')}
          ${docTable(`End-of-month inventory — ${esc(L.monthLabel(year, month))}`, s.endDocs, 'None recorded yet.')}
          ${docTable(`End-of-month inventory — ${esc(L.monthLabel(pv.year, pv.month))}`, s.startDocs, 'None recorded.')}
        </div>`));
    },
  };
})();
