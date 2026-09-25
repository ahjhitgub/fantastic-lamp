window.App = window.App || {};
App.Pages = App.Pages || {};

App.Pages.claimPeriods = (function () {
  let editingId = null; // id of the period being edited, or null for "new"

  async function getPeriods() {
    const periods = await App.DB.getAll('claimPeriods');
    periods.sort((a, b) => (b.year - a.year) || (b.month - a.month) || (a.cewType > b.cewType ? 1 : -1));
    return periods;
  }

  function monthOptions(selected) {
    return App.Models.MONTH_NAMES
      .map((name, i) => `<option value="${i + 1}" ${selected === i + 1 ? 'selected' : ''}>${name}</option>`)
      .join('');
  }

  function cewTypeOptions(selected) {
    return App.Models.CEW_TYPES
      .map((t) => `<option value="${t}" ${selected === t ? 'selected' : ''}>${App.Models.CEW_TYPE_LABELS[t]}</option>`)
      .join('');
  }

  async function previousPeriodOptions(cewType, excludeId, selected) {
    const all = await getPeriods();
    const candidates = all.filter((p) => p.cewType === cewType && p.id !== excludeId);
    const opts = ['<option value="">(none)</option>'];
    candidates.forEach((p) => {
      opts.push(`<option value="${p.id}" ${selected === p.id ? 'selected' : ''}>${App.Models.formatPeriodLabel(p)}</option>`);
    });
    return opts.join('');
  }

  async function renderForm(container, period) {
    const isEdit = !!period;
    const p = period || { cewType: 'CBEP', year: new Date().getFullYear(), month: new Date().getMonth() + 1, status: 'draft' };

    const form = document.createElement('form');
    form.className = 'panel';
    form.innerHTML = `
      <h2>${isEdit ? 'Edit claim period' : 'New claim period'}</h2>
      <div class="field-row">
        <div class="field">
          <label>CEW type</label>
          <select name="cewType">${cewTypeOptions(p.cewType)}</select>
        </div>
        <div class="field">
          <label>Month</label>
          <select name="month">${monthOptions(p.month)}</select>
        </div>
        <div class="field">
          <label>Year</label>
          <input name="year" type="number" value="${p.year}" required>
        </div>
        <div class="field">
          <label>Status</label>
          <select name="status">
            <option value="draft" ${p.status === 'draft' ? 'selected' : ''}>Draft</option>
            <option value="submitted" ${p.status === 'submitted' ? 'selected' : ''}>Submitted</option>
          </select>
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Claim activity period start</label>
          <input name="periodStart" type="date" value="${p.periodStart || ''}">
        </div>
        <div class="field">
          <label>Claim activity period end</label>
          <input name="periodEnd" type="date" value="${p.periodEnd || ''}">
        </div>
        <div class="field">
          <label>Previous period (carries forward stored totals)</label>
          <select name="previousPeriodId" data-role="prev-select">
            <option value="">(none)</option>
          </select>
        </div>
      </div>
      <div class="field">
        <label>Notes</label>
        <textarea name="notes" rows="2">${p.notes || ''}</textarea>
      </div>
      <div class="row">
        <button type="submit" class="primary">${isEdit ? 'Save changes' : 'Create period'}</button>
        ${isEdit ? '<button type="button" data-action="cancel-edit">Cancel</button>' : ''}
      </div>
    `;

    container.appendChild(form);

    const prevSelect = form.querySelector('[data-role="prev-select"]');
    const cewTypeSelect = form.querySelector('[name="cewType"]');
    async function refreshPrevOptions() {
      prevSelect.innerHTML = await previousPeriodOptions(cewTypeSelect.value, p.id, p.previousPeriodId);
    }
    await refreshPrevOptions();
    cewTypeSelect.addEventListener('change', refreshPrevOptions);

    if (isEdit) {
      form.querySelector('[data-action="cancel-edit"]').addEventListener('click', () => {
        editingId = null;
        App.Pages.claimPeriods.render(container);
      });
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const record = {
        cewType: fd.get('cewType'),
        year: Number(fd.get('year')),
        month: Number(fd.get('month')),
        status: fd.get('status'),
        periodStart: fd.get('periodStart') || '',
        periodEnd: fd.get('periodEnd') || '',
        previousPeriodId: fd.get('previousPeriodId') ? Number(fd.get('previousPeriodId')) : null,
        notes: fd.get('notes') || '',
      };
      if (isEdit) {
        record.id = p.id;
        await App.DB.put('claimPeriods', record);
      } else {
        const id = await App.DB.add('claimPeriods', record);
        App.State.currentPeriodId = id;
      }
      editingId = null;
      await App.refreshShell();
    });
  }

  async function renderTable(container, periods) {
    if (periods.length === 0) {
      container.innerHTML += `
        <div class="empty-state">
          <h3>No claim periods yet</h3>
          <p>Add one above — everything else in the app (transfers, cancellations, residuals) hangs off a claim period.</p>
        </div>`;
      return;
    }

    const rows = periods.map((p) => `
      <tr>
        <td>${App.Models.CEW_TYPE_LABELS[p.cewType]}</td>
        <td>${App.Models.MONTH_NAMES[p.month - 1]} ${p.year}</td>
        <td><span class="badge ${p.status === 'draft' ? '' : 'flag'}">${p.status}</span></td>
        <td>${App.Models.CLAIM_FORM_BY_TYPE[p.cewType] || '—'}</td>
        <td class="row">
          <button type="button" data-edit="${p.id}">Edit</button>
          <button type="button" class="danger" data-delete="${p.id}">Delete</button>
        </td>
      </tr>
    `).join('');

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `
      <h2>All claim periods</h2>
      <table>
        <thead><tr><th>CEW type</th><th>Period</th><th>Status</th><th>Claim form</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
    container.appendChild(panel);

    panel.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        editingId = Number(btn.dataset.edit);
        await App.Pages.claimPeriods.render(container);
      });
    });
    panel.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.delete);
        if (!confirm('Delete this claim period? Records linked to it (transfers, cancellations, etc.) will be orphaned, not deleted.')) return;
        await App.DB.delete('claimPeriods', id);
        if (App.State.currentPeriodId === id) App.State.currentPeriodId = null;
        await App.refreshShell();
      });
    });
  }

  return {
    async render(container) {
      container.innerHTML = `
        <div class="page-header">
          <h1>Claim Periods</h1>
          <p>One record per CEW type per reporting month — CalRecycle 196B (Non-CRT) and 196C (CBEP) each file separately even for the same month.</p>
        </div>
      `;

      const periods = await getPeriods();
      const editing = editingId ? periods.find((p) => p.id === editingId) : null;
      await renderForm(container, editing);
      await renderTable(container, periods);
    },
  };
})();
