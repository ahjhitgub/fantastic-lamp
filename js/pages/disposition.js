window.App = window.App || {};
App.Pages = App.Pages || {};

App.Pages.disposition = (function () {
  let editingId = null;
  let editingStore = null; // guards against an id from one store (battery) matching another (panel) by coincidence

  // CBEP periods use batteryDisposition/batteryType; NonCRT periods use panelDisposition/screenType.
  function config(cewType) {
    if (cewType === 'CBEP') {
      return { store: 'batteryDisposition', typeField: 'batteryType', types: App.Models.BATTERY_TYPES, label: 'Battery type', formTitle: 'battery' };
    }
    if (cewType === 'NonCRT') {
      return { store: 'panelDisposition', typeField: 'screenType', types: App.Models.SCREEN_TYPES, label: 'Screen type', formTitle: 'screen' };
    }
    return null;
  }

  async function getRows(store, periodId) {
    return App.DB.getAllByIndex(store, 'claimPeriodId', periodId);
  }

  async function renderForm(container, periodId, cfg, row) {
    const isEdit = !!row;
    const r = row || { [cfg.typeField]: cfg.types[0], weightGenerated: '', weightShipped: '', weightStored: '' };

    const form = document.createElement('form');
    form.className = 'panel';
    form.innerHTML = `
      <h2>${isEdit ? `Edit ${cfg.formTitle} row` : `Add ${cfg.formTitle} row`}</h2>
      <div class="field-row">
        <div class="field">
          <label>${cfg.label}</label>
          <select name="type">
            ${cfg.types.map((t) => `<option value="${t}" ${r[cfg.typeField] === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Weight generated (lbs)</label>
          <input name="weightGenerated" type="number" step="0.01" value="${r.weightGenerated}">
        </div>
        <div class="field">
          <label>Weight shipped (lbs)</label>
          <input name="weightShipped" type="number" step="0.01" value="${r.weightShipped}">
        </div>
        <div class="field">
          <label>Weight stored (lbs)</label>
          <input name="weightStored" type="number" step="0.01" value="${r.weightStored}">
        </div>
      </div>
      <div class="row">
        <button type="submit" class="primary">${isEdit ? 'Save changes' : 'Add row'}</button>
        ${isEdit ? '<button type="button" data-action="cancel">Cancel</button>' : ''}
      </div>
    `;
    container.appendChild(form);

    if (isEdit) {
      form.querySelector('[data-action="cancel"]').addEventListener('click', () => {
        editingId = null;
        editingStore = null;
        App.Pages.disposition.render(container);
      });
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const num = (n) => Number(fd.get(n)) || 0;
      const record = {
        claimPeriodId: periodId,
        [cfg.typeField]: fd.get('type'),
        weightGenerated: num('weightGenerated'),
        weightShipped: num('weightShipped'),
        weightStored: num('weightStored'),
      };
      if (isEdit) {
        record.id = r.id;
        record.detail = r.detail || [];
        await App.DB.put(cfg.store, record);
      } else {
        await App.DB.add(cfg.store, { ...record, detail: [] });
      }
      editingId = null;
      editingStore = null;
      await App.Pages.disposition.render(container);
    });
  }

  function renderTable(container, cfg, rows) {
    const panel = document.createElement('div');
    panel.className = 'panel';

    if (rows.length === 0) {
      panel.innerHTML = `<h2>This period</h2><p class="muted mt-0">No rows logged yet.</p>`;
      container.appendChild(panel);
      return;
    }

    panel.innerHTML = `
      <h2>This period</h2>
      <table>
        <thead><tr><th>${cfg.label}</th><th class="num">Generated</th><th class="num">Shipped</th><th class="num">Stored</th><th></th></tr></thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td>${r[cfg.typeField]}</td>
              <td class="num">${(Number(r.weightGenerated) || 0).toLocaleString()}</td>
              <td class="num">${(Number(r.weightShipped) || 0).toLocaleString()}</td>
              <td class="num">${(Number(r.weightStored) || 0).toLocaleString()}</td>
              <td class="row">
                <button type="button" data-edit="${r.id}">Edit</button>
                <button type="button" class="danger" data-delete="${r.id}">Delete</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    container.appendChild(panel);

    panel.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        editingId = Number(btn.dataset.edit);
        editingStore = cfg.store;
        await App.Pages.disposition.render(container);
      });
    });
    panel.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this row?')) return;
        await App.DB.delete(cfg.store, Number(btn.dataset.delete));
        await App.Pages.disposition.render(container);
      });
    });
  }

  return {
    async render(container) {
      const periodId = App.State.currentPeriodId;

      container.innerHTML = `
        <div class="page-header">
          <h1>Battery / Panel Disposition</h1>
          <p>Post-cancellation disposition — batteries for CBEP periods (196C §IV), bare panels &amp; LCD lamps for Non-CRT periods (196B §IV).</p>
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

      const periods = await App.DB.getAll('claimPeriods');
      const period = periods.find((p) => p.id === periodId);
      const cfg = config(period?.cewType);

      if (!cfg) {
        container.innerHTML += `
          <div class="empty-state">
            <h3>Not applicable</h3>
            <p>The active period is CRT, which this table doesn't cover — switch to a CBEP or Non-CRT period.</p>
          </div>`;
        return;
      }

      const rows = await getRows(cfg.store, periodId);
      const editing = (editingId && editingStore === cfg.store) ? rows.find((r) => r.id === editingId) : null;
      await renderForm(container, periodId, cfg, editing);
      renderTable(container, cfg, rows);
    },
  };
})();
