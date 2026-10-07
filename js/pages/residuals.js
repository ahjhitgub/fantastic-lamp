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
      const active = App.Store.currentPeriod(data);
      // a CBEP claim: storage, generation certificates and the 196C — the CBEP side of residuals
      if (active && active.cewType === 'CBEP') {
        container.append(header('Residuals', 'This CBEP claim\'s residuals: what\'s generated each day, the month-end inventory check, the generation certificates (one per residual type, each battery chemistry separately) and the 196C figures.'));
        await App.Pages.cbep.render(container, { embedded: true });
        return;
      }
      const key = active ? L.monthKey(active.year, active.month) : (monthOverride || App.UI.today().slice(0, 7));
      const [year, month] = key.split('-').map(Number);
      const s = L.residualSummary({ year, month, materials: data.materials, wcs: data.wcs });
      const pv = L.fromIndex(L.monthIndex(year, month) - 1);
      const compName = (id) => (data.companies.find((c) => c.id === id) || {}).name || '—';
      const matName = (id) => (data.materials.find((m) => m.id === id) || {}).name || '?';

      container.append(header('Residuals', 'Calculated from residual shipments (CEW lines only) and end-of-month inventory. Nothing here is typed in directly.'));

      const top = h(`
        <div class="panel"><div class="field-row">
          <div class="field"><label>Month</label><input type="month" data-f="month" value="${key}" ${active ? 'disabled title="The claim period\'s month"' : ''}></div>
          <div class="field" style="flex:3"><label>&nbsp;</label><p class="muted mt-0">Generated = shipped this month + this month's end-of-month inventory − ${esc(L.monthLabel(pv.year, pv.month))}'s end-of-month inventory.</p></div>
        </div></div>`);
      top.querySelector('[data-f="month"]').addEventListener('change', (e) => { monthOverride = e.target.value || null; App.rerender(); });
      container.append(top);

      s.warnings.forEach((w) => container.append(App.UI.notice(w, 'warning')));
      if (s.nonCewShipped) container.append(App.UI.notice(`${fmt(s.nonCewShipped)} lbs shipped this month is marked non-CEW and isn't counted as residuals.`, 'ok'));

      // quick create
      const shipType = data.wcTypes.find((t) => t.kind === 'shipment');
      const invType = data.wcTypes.find((t) => t.kind === 'inventory');
      const create = h(`
        <form class="panel">
          <h2>${active ? 'Month-end inventory check' : 'New residual shipment'}</h2>
          <div class="field-row">
            <div class="field" style="flex:2"><label>What</label><select name="what">
              ${active ? `<option value="general">End-of-month inventory — general entry (no WC)</option>
              <option value="invwc">Inventory — weight certificate (LCD lamps need one of their own)</option>` : '<option value="ship">Residual shipment (WC)</option>'}
            </select></div>
            <div class="field" data-role="wc-field"><label>WC #</label><input name="wcNumber" value="${esc(L.nextWcNumber(data.allWcs))}"></div>
            <div class="field" style="flex:2" data-role="party-field"><label>Going to</label><select name="party">${App.Store.partyOptions('shipment', data.companies, '')}</select></div>
            <div class="field"><label>Date</label><input type="date" name="date" value="${App.UI.today().slice(0, 7) === key ? App.UI.today() : L.lastDayISO(year, month)}"></div>
            <div class="field"><label>&nbsp;</label><button type="submit" class="primary">Create and open</button></div>
          </div>
          <p class="hint">${active ? `Counts as the end-of-month inventory for ${esc(L.monthLabel(year, month))}, even if it's dated after the month ends. Inventory is always for our facility.`
            : 'Month-end inventory checks are made inside the <strong>CEW Non-CRT claim period</strong> for their month (pick it at the top right); CBEP stored amounts inside the CBEP claim period. CBEP generation certificates can also be issued <a href="#/cbep">here</a>.'}</p>
          <div data-role="err"></div>
        </form>`);
      const whatSel = create.querySelector('[name="what"]');
      const sync = () => {
        const w = whatSel.value;
        create.querySelector('[data-role="wc-field"]').hidden = w === 'general';
        create.querySelector('[data-role="party-field"]').hidden = w !== 'ship';
      };
      whatSel.addEventListener('change', sync);
      sync();
      create.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(create);
        const w = fd.get('what');
        try {
          const id = await App.Store.createWC({
            wcNumber: fd.get('wcNumber'), typeId: (w === 'ship' ? shipType : invType).id, date: fd.get('date'),
            party: w === 'ship' ? fd.get('party') : null, noWc: w === 'general',
          });
          if (active && w !== 'ship') {   // a check made in this claim counts for its month, whatever its date
            const rec = await App.DB.get('wcs', id); rec.inventory = { ...(rec.inventory || {}), forMonth: key }; await App.DB.put('wcs', rec);
          }
          App.Pages.wc.reset();
          App.UI.go(`#/wc/${id}`);
        } catch (err) { create.querySelector('[data-role="err"]').replaceChildren(App.UI.notice(App.UI.errText(err), 'error')); }
      });
      container.append(create);

      const fifo = L.residualFifo({ materials: data.materials, wcs: data.wcs });
      const monthIdx = L.monthIndex(year, month);
      const endLayers = fifo.storage.get(monthIdx);
      const fifoFor = (materialId) => {
        let fromStorage = 0; let fromMonth = 0;
        s.shipments.forEach((w) => (fifo.notes.get(w.id) || []).filter((n) => n.materialId === materialId).forEach((n) => {
          fromStorage += n.fromStorage.reduce((a, x) => a + x.lbs, 0); fromMonth += n.fromMonth;
        }));
        return { fromStorage, fromMonth };
      };
      // per-material summary
      const active2 = s.rows.filter((r) => r.prevStored || r.shipped || r.endStored);
      container.append(h(`
        <div class="panel"><h2>${esc(L.monthLabel(year, month))} by material</h2>
          ${active2.length ? `<div class="table-scroll"><table data-list="residual-materials">
            <thead><tr><th>Material</th><th>196B column</th><th class="num">Stored end of ${esc(L.MONTHS[pv.month - 1])}</th><th class="num">Shipped</th>
              <th class="num">…from earlier storage</th><th class="num">…from ${esc(L.MONTHS[month - 1])}</th>
              <th class="num">Stored end of ${esc(L.MONTHS[month - 1])}</th><th class="num">Generated</th><th class="num">Stored from this month</th><th>In storage at month end, by month generated</th></tr></thead>
            <tbody>${active2.map((r) => { const f = fifoFor(r.material.id); const layers = (endLayers && endLayers.get(r.material.id)) || []; return `<tr>
              <td>${esc(r.material.name)}</td><td class="muted">${esc(r.material.category)}</td>
              <td class="num">${fmt(r.prevStored)}</td><td class="num">${fmt(r.shipped)}</td>
              <td class="num">${fmt(f.fromStorage)}</td><td class="num">${fmt(f.fromMonth)}</td>
              <td class="num">${fmt(r.endStored)}</td>
              <td class="num ${r.generated < 0 ? 'flag-text' : ''}"><strong>${fmt(r.generated)}</strong></td><td class="num">${fmt(r.monthlyStored)}</td>
              <td class="small">${layers.map((y) => `${esc(L.monthLabelFromIndex(y.idx))}: ${fmt(y.lbs)}`).join(' · ') || '<span class="muted">—</span>'}</td></tr>`; }).join('')}</tbody>
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
        let items;
        if (w.kind === 'inventory') {
          const t = L.netByMaterial(lines);
          items = [...t].map(([id, v]) => `${matName(id)} ${fmt(v.net)}`);
        } else {
          items = lines.map((l) => `${l.description || matName(l.materialId)}${l.description && l.materialId != null ? ` (${matName(l.materialId)})` : ''} ${fmt(L.lineNet(l))}${l.cew === false ? ' — non-CEW' : ''}`);
          const paid = L.settlementText(w.shipment && w.shipment.settlement);
          if (paid) items.push(paid);
          (fifo.notes.get(w.id) || []).filter((n) => n.fromStorage.length).forEach((n) => items.push(L.storageNoteText(n)));
        }
        return `<tr><td><a href="#/wc/${w.id}">${w.wcNumber ? esc(w.wcNumber) : 'general entry'}</a></td><td>${esc(w.date)}</td><td>${esc(w.kind === 'inventory' ? 'Ours' : compName(w.companyId))}</td>
          <td>${esc(items.join(', '))}</td></tr>`;
      };
      const docTable = (key, title, list, empty) => `<h3>${title}</h3>${list.length ? `<table data-list="residual-${key}"><thead><tr><th>WC #</th><th>Date</th><th>Company</th><th>Materials (net lbs)</th></tr></thead><tbody>${list.map(docRow).join('')}</tbody></table>` : `<p class="muted">${empty}</p>`}`;
      container.append(h(`
        <div class="panel"><h2>Source WCs</h2>
          ${docTable('shipped', `Shipped in ${esc(L.monthLabel(year, month))}`, s.shipments, 'None.')}
          ${docTable('end', `End-of-month inventory — ${esc(L.monthLabel(year, month))}`, s.endDocs, 'None recorded yet.')}
          ${docTable('prev', `End-of-month inventory — ${esc(L.monthLabel(pv.year, pv.month))}`, s.startDocs, 'None recorded.')}
        </div>`));
      if (active && active.cewType === 'NonCRT') {
        const sub = document.createElement('div');
        await App.Pages.disposition.render(sub);
        const ph = sub.querySelector('.page-header'); if (ph) ph.remove();
        container.append(...Array.from(sub.childNodes));
      }
    },
  };
})();
