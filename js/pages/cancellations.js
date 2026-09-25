window.App = window.App || {};
App.Pages = App.Pages || {};

App.Pages.cancellations = (function () {
  let editingId = null;
  let viewMode = 'summary'; // 'summary' | 'units'
  let page = 0;
  const PAGE_SIZE = 100;

  function parseDateToISO(raw) {
    const s = (raw || '').trim();
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) {
      let [, mo, da, yr] = m;
      if (yr.length === 2) yr = '20' + yr;
      return `${yr.padStart(4, '0')}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}`;
    }
    return s;
  }

  function parseBulkRows(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const rows = [];
    for (const line of lines) {
      const cells = (line.includes('\t') ? line.split('\t') : line.split(',')).map((c) => c.trim());
      if (cells.length < 4) continue;
      const [dateRaw, manufacturer, model, poundsRaw, deviceType, method] = cells;
      if (/^date$/i.test(dateRaw)) continue; // skip a pasted header row
      const pounds = Number(poundsRaw);
      if (!dateRaw || Number.isNaN(pounds)) continue;
      rows.push({
        dateCancelled: parseDateToISO(dateRaw),
        manufacturer: manufacturer || '',
        model: model || '',
        pounds,
        deviceType: deviceType || '',
        cancellationMethod: method || '',
        originTransferId: null,
      });
    }
    return rows;
  }

  async function getPeriodUnits(periodId) {
    if (!periodId) return [];
    const rows = await App.DB.getAllByIndex('cancelledUnits', 'claimPeriodId', periodId);
    rows.sort((a, b) => (a.dateCancelled || '').localeCompare(b.dateCancelled || ''));
    return rows;
  }

  function transferLabel(t, collectors) {
    const cname = collectors.find((c) => c.id === t.collectorId)?.name || 'Unknown collector';
    return [t.dateOfTransfer, cname, t.handlerName, t.referenceNumber ? '#' + t.referenceNumber : '']
      .filter(Boolean).join(' — ');
  }

  // Origin tracking is about physical provenance, not formal claim-period
  // allocation, so this lists every transfer on file, not just ones
  // allocated to the active period.
  async function transferOptions(selected) {
    const [transfers, collectors] = await Promise.all([
      App.DB.getAll('transfers'),
      App.DB.getAll('collectors'),
    ]);
    transfers.sort((a, b) => (b.dateOfTransfer || '').localeCompare(a.dateOfTransfer || ''));
    const opts = ['<option value="">(unknown / not tracked)</option>'];
    transfers.forEach((t) => {
      opts.push(`<option value="${t.id}" ${selected === t.id ? 'selected' : ''}>${transferLabel(t, collectors)}</option>`);
    });
    return opts.join('');
  }

  function dailySummary(units) {
    const map = new Map();
    units.forEach((u) => {
      const key = u.dateCancelled || '(no date)';
      if (!map.has(key)) map.set(key, { date: key, count: 0, pounds: 0, methods: new Set() });
      const row = map.get(key);
      row.count += 1;
      row.pounds += Number(u.pounds) || 0;
      if (u.cancellationMethod) row.methods.add(u.cancellationMethod);
    });
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  async function transfersWeightForPeriod(periodId) {
    const totals = await App.Periods.computeAllocatedTotals(periodId);
    return totals.weight;
  }

  async function renderTotals(container, periodId, units) {
    const totalLbs = units.reduce((s, u) => s + (Number(u.pounds) || 0), 0);
    const transfersLbs = await transfersWeightForPeriod(periodId);
    const diff = totalLbs - transfersLbs;

    const panel = document.createElement('div');
    panel.className = 'stat-row';
    panel.innerHTML = `
      <div class="stat"><div class="value">${units.length.toLocaleString()}</div><div class="label">Units cancelled</div></div>
      <div class="stat"><div class="value">${totalLbs.toLocaleString()}</div><div class="label">Lbs cancelled</div></div>
      <div class="stat"><div class="value">${transfersLbs.toLocaleString()}</div><div class="label">Lbs transferred in</div></div>
      <div class="stat">
        <div class="value">${diff === 0 ? 'Matches' : (diff > 0 ? '+' : '') + diff.toLocaleString()}</div>
        <div class="label">${diff === 0 ? 'Cancelled = transferred' : 'Difference vs. transfers'}</div>
      </div>
    `;
    container.appendChild(panel);
  }

  async function renderForm(container, periodId, unit) {
    const isEdit = !!unit;
    const u = unit || { dateCancelled: '', manufacturer: '', model: '', pounds: '', deviceType: '', cancellationMethod: '', originTransferId: null };

    const methodSuggestions = [
      ...(App.Models.CANCELLATION_METHODS_BY_TYPE.NonCRT || []),
      ...(App.Models.CANCELLATION_METHODS_BY_TYPE.CBEP || []),
    ];

    const form = document.createElement('form');
    form.addEventListener('submit', (e) => e.preventDefault()); // safety net: never navigate, no matter what
    form.className = 'panel';
    form.innerHTML = `
      <h2>${isEdit ? 'Edit unit' : 'Add one unit'}</h2>
      <div class="field-row">
        <div class="field">
          <label>Date cancelled</label>
          <input name="dateCancelled" type="date" value="${u.dateCancelled || ''}" required>
        </div>
        <div class="field">
          <label>Manufacturer</label>
          <input name="manufacturer" value="${u.manufacturer || ''}">
        </div>
        <div class="field">
          <label>Model #</label>
          <input name="model" value="${u.model || ''}">
        </div>
        <div class="field">
          <label>Pounds</label>
          <input name="pounds" type="number" step="0.01" value="${u.pounds}" required>
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Type</label>
          <input name="deviceType" list="device-type-hints" value="${u.deviceType || ''}">
          <datalist id="device-type-hints">${App.Models.DEVICE_TYPE_HINTS.map((h) => `<option value="${h}">`).join('')}</datalist>
        </div>
        <div class="field">
          <label>Cancellation method</label>
          <input name="cancellationMethod" list="method-hints" value="${u.cancellationMethod || ''}">
          <datalist id="method-hints">${methodSuggestions.map((h) => `<option value="${h}">`).join('')}</datalist>
        </div>
        <div class="field" style="flex:2;">
          <label>Origin transfer <span class="muted">(optional)</span></label>
          <select name="originTransferId">${await transferOptions(u.originTransferId)}</select>
        </div>
      </div>
      <div class="row">
        <button type="submit" class="primary">${isEdit ? 'Save changes' : 'Add unit'}</button>
        ${isEdit ? '<button type="button" data-action="cancel-edit">Cancel</button>' : ''}
      </div>
    `;
    container.appendChild(form);

    if (isEdit) {
      form.querySelector('[data-action="cancel-edit"]').addEventListener('click', () => {
        editingId = null;
        App.Pages.cancellations.render(container);
      });
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const record = {
        claimPeriodId: periodId,
        dateCancelled: fd.get('dateCancelled'),
        manufacturer: fd.get('manufacturer') || '',
        model: fd.get('model') || '',
        pounds: Number(fd.get('pounds')) || 0,
        deviceType: fd.get('deviceType') || '',
        cancellationMethod: fd.get('cancellationMethod') || '',
        originTransferId: fd.get('originTransferId') ? Number(fd.get('originTransferId')) : null,
      };
      if (isEdit) {
        record.id = u.id;
        await App.DB.put('cancelledUnits', record);
      } else {
        await App.DB.add('cancelledUnits', record);
      }
      editingId = null;
      await App.Pages.cancellations.render(container);
    });
  }

  function renderBulkImport(container, periodId) {
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `
      <h2>Bulk import</h2>
      <p class="muted mt-0">
        Paste rows copied from a spreadsheet — tab or comma separated, in the order
        <strong>Date, Manufacturer, Model, Pounds, Type, Method</strong> (Type and Method
        are optional). A header row is fine, it's skipped automatically.
      </p>
      <div class="field">
        <textarea data-role="bulk-text" rows="6" placeholder="12/1/2024&#9;sony&#9;XR-65A80J&#9;47&#9;LED&#9;Dismantled to bare panel"></textarea>
      </div>
      <div class="row">
        <button type="button" class="primary" data-action="import">Import rows</button>
        <button type="button" class="danger" data-action="clear-period">Delete all units this period</button>
        <span class="muted" data-role="import-result"></span>
      </div>
    `;
    container.appendChild(panel);

    panel.querySelector('[data-action="import"]').addEventListener('click', async () => {
      const textarea = panel.querySelector('[data-role="bulk-text"]');
      const rows = parseBulkRows(textarea.value);
      const resultEl = panel.querySelector('[data-role="import-result"]');
      if (rows.length === 0) {
        resultEl.textContent = 'No valid rows found.';
        return;
      }
      try {
        await App.DB.bulkAdd('cancelledUnits', rows.map((r) => ({ ...r, claimPeriodId: periodId })));
        textarea.value = '';
        await App.Pages.cancellations.render(container);
      } catch (err) {
        resultEl.textContent = `Import failed: ${err && err.message ? err.message : err}`;
        // eslint-disable-next-line no-console
        console.error('bulk import failed', err);
      }
    });

    panel.querySelector('[data-action="clear-period"]').addEventListener('click', async () => {
      if (!confirm('Delete every cancelled unit logged for this period? This cannot be undone.')) return;
      const units = await getPeriodUnits(periodId);
      await App.DB.bulkDelete('cancelledUnits', units.map((u) => u.id));
      await App.Pages.cancellations.render(container);
    });
  }

  function renderViewToggle(container) {
    const row = document.createElement('div');
    row.className = 'row';
    row.style.marginBottom = '10px';
    row.innerHTML = `
      <button type="button" class="${viewMode === 'summary' ? 'primary' : ''}" data-view="summary">Daily summary</button>
      <button type="button" class="${viewMode === 'units' ? 'primary' : ''}" data-view="units">All units</button>
    `;
    container.appendChild(row);
    row.querySelectorAll('[data-view]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        viewMode = btn.dataset.view;
        page = 0;
        await App.Pages.cancellations.render(container);
      });
    });
  }

  function renderDailySummaryTable(container, units) {
    const days = dailySummary(units);
    const panel = document.createElement('div');
    panel.className = 'panel';
    if (days.length === 0) {
      panel.innerHTML = '<p class="muted mt-0">No units logged yet.</p>';
      container.appendChild(panel);
      return;
    }
    panel.innerHTML = `
      <h2>Daily totals — 196B/196C §VI</h2>
      <table>
        <thead><tr><th>Date</th><th class="num">Units</th><th class="num">Pounds</th><th>Method(s)</th></tr></thead>
        <tbody>
          ${days.map((d) => `
            <tr>
              <td>${d.date}</td>
              <td class="num">${d.count}</td>
              <td class="num">${d.pounds.toLocaleString()}</td>
              <td>${Array.from(d.methods).join(', ') || '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    container.appendChild(panel);
  }

  async function renderUnitsTable(container, units) {
    const collectors = await App.DB.getAll('collectors');
    const transfers = await App.DB.getAll('transfers');
    const transferMap = new Map(transfers.map((t) => [t.id, transferLabel(t, collectors)]));

    const panel = document.createElement('div');
    panel.className = 'panel';

    if (units.length === 0) {
      panel.innerHTML = '<h2>All units</h2><p class="muted mt-0">No units logged yet.</p>';
      container.appendChild(panel);
      return;
    }

    const totalPages = Math.max(1, Math.ceil(units.length / PAGE_SIZE));
    page = Math.min(page, totalPages - 1);
    const pageRows = units.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

    panel.innerHTML = `
      <div class="row spread">
        <h2>All units <span class="muted">(${units.length.toLocaleString()} total)</span></h2>
        <div class="row">
          <button type="button" data-page="prev" ${page === 0 ? 'disabled' : ''}>← Prev</button>
          <span class="muted">Page ${page + 1} of ${totalPages}</span>
          <button type="button" data-page="next" ${page >= totalPages - 1 ? 'disabled' : ''}>Next →</button>
        </div>
      </div>
      <table>
        <thead><tr><th>Date</th><th>Manufacturer</th><th>Model</th><th class="num">Lbs</th><th>Type</th><th>Method</th><th>Origin</th><th></th></tr></thead>
        <tbody>
          ${pageRows.map((u) => `
            <tr>
              <td>${u.dateCancelled || '—'}</td>
              <td>${u.manufacturer || '—'}</td>
              <td>${u.model || '—'}</td>
              <td class="num">${(Number(u.pounds) || 0).toLocaleString()}</td>
              <td>${u.deviceType || '—'}</td>
              <td>${u.cancellationMethod || '—'}</td>
              <td>${u.originTransferId ? (transferMap.get(u.originTransferId) || 'Unknown') : '—'}</td>
              <td class="row">
                <button type="button" data-edit="${u.id}">Edit</button>
                <button type="button" class="danger" data-delete="${u.id}">Delete</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    container.appendChild(panel);

    panel.querySelector('[data-page="prev"]').addEventListener('click', async () => {
      page = Math.max(0, page - 1);
      await App.Pages.cancellations.render(container);
    });
    panel.querySelector('[data-page="next"]').addEventListener('click', async () => {
      page += 1;
      await App.Pages.cancellations.render(container);
    });
    panel.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        editingId = Number(btn.dataset.edit);
        viewMode = 'units';
        await App.Pages.cancellations.render(container);
      });
    });
    panel.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this unit?')) return;
        await App.DB.delete('cancelledUnits', Number(btn.dataset.delete));
        await App.Pages.cancellations.render(container);
      });
    });
  }

  return {
    async render(container) {
      const periodId = App.State.currentPeriodId;

      container.innerHTML = `
        <div class="page-header">
          <h1>Cancellations</h1>
          <p>Per-unit cancellation detail for the active claim period — daily totals (§VI) are computed from these automatically.</p>
        </div>
      `;

      if (!periodId) {
        container.innerHTML += `
          <div class="empty-state">
            <h3>No claim period selected</h3>
            <p><a href="#/claimPeriods">Create or select one</a> first.</p>
          </div>`;
        return;
      }

      const units = await getPeriodUnits(periodId);
      await renderTotals(container, periodId, units);

      const editing = editingId ? units.find((u) => u.id === editingId) : null;
      await renderForm(container, periodId, editing);
      renderBulkImport(container, periodId);

      renderViewToggle(container);
      if (viewMode === 'summary') {
        renderDailySummaryTable(container, units);
      } else {
        await renderUnitsTable(container, units);
      }
    },
  };
})();
