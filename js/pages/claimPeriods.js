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

  function showError(form, err) {
    let box = form.querySelector('[data-role="form-error"]');
    if (!box) {
      box = document.createElement('p');
      box.dataset.role = 'form-error';
      box.style.color = 'var(--flag)';
      form.prepend(box);
    }
    box.textContent = `Couldn't save: ${err && err.message ? err.message : err}`;
    // eslint-disable-next-line no-console
    console.error('claimPeriods save failed', err);
  }

  async function renderForm(container, period) {
    const isEdit = !!period;
    const p = period || { cewType: 'CBEP', year: new Date().getFullYear(), month: new Date().getMonth() + 1, status: 'draft' };

    const form = document.createElement('form');
    form.addEventListener('submit', (e) => e.preventDefault()); // safety net: never navigate, no matter what
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
          <label>Previous period <span class="muted">(carries forward stored totals)</span></label>
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

    // Every listener is attached synchronously, right here, before any
    // `await` — so there is no moment where the visible, clickable form
    // has no submit handler yet (a real gap there used to let a click fall
    // through to the browser's native form submission instead).
    const prevSelect = form.querySelector('[data-role="prev-select"]');
    const cewTypeSelect = form.querySelector('[name="cewType"]');
    async function refreshPrevOptions() {
      prevSelect.innerHTML = await previousPeriodOptions(cewTypeSelect.value, p.id, p.previousPeriodId);
    }
    cewTypeSelect.addEventListener('change', refreshPrevOptions);

    if (isEdit) {
      form.querySelector('[data-action="cancel-edit"]').addEventListener('click', () => {
        editingId = null;
        App.rerender();
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
        previousPeriodId: fd.get('previousPeriodId') ? Number(fd.get('previousPeriodId')) : null,
        notes: fd.get('notes') || '',
      };
      try {
        if (isEdit) {
          record.id = p.id;
          await App.DB.put('claimPeriods', record);
        } else {
          const clash = await App.DB.getAllByIndex('claimPeriods', 'cewType_year_month', [record.cewType, record.year, record.month]);
          if (clash.length) throw new Error('That claim period already exists.');
          const id = await App.DB.add('claimPeriods', record);
          App.setPeriod(id);
        }
        editingId = null;
        await App.refreshShell();
      } catch (err) {
        showError(form, err);
      }
    });


    // Populate the dropdown last — purely cosmetic, doesn't need to block
    // the form being fully interactive.
    await refreshPrevOptions();
  }

  async function renderAllocatedTransfers(container, period) {
    const [start, totals] = await Promise.all([
      App.Periods.computeActivityStart(period.id),
      App.Periods.computeAllocatedTotals(period.id),
    ]);
    const end = App.Periods.lastDayOfMonthISO(period.year, period.month);

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `
      <h2>Claim activity period</h2>
      <p class="muted mt-0">Computed from which transfers are allocated to this period on the Transfers page — not typed in here.</p>
      <div class="field-row">
        <div class="field">
          <label>Start</label>
          <div>${start || '— once a transfer is allocated to this period —'}</div>
        </div>
        <div class="field">
          <label>End</label>
          <div>${end} <span class="muted">(always the last day of ${App.Models.MONTH_NAMES[period.month - 1]})</span></div>
        </div>
        <div class="field">
          <label>Allocated so far</label>
          <div>${totals.units.toLocaleString()} units / ${totals.weight.toLocaleString()} lbs</div>
        </div>
      </div>
      <p class="muted" style="margin-bottom:0;"><a href="#/transfers">Manage which transfers count toward this period →</a></p>
    `;
    container.appendChild(panel);
  }

  async function renderTable(container, periods) {
    if (periods.length === 0) {
      container.insertAdjacentHTML('beforeend', `
        <div class="empty-state">
          <h3>No claim periods yet</h3>
          <p>Add one above, or create one straight from a transfer's “Claim periods” panel.</p>
        </div>`);
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
        App.rerender();
      });
    });
    panel.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.delete);
        const units = await App.DB.getAllByIndex('cancelledUnits', 'claimPeriodId', id);
        if (!confirm(`Delete this claim period? Its transfer allocations${units.length ? ` and its ${units.length} logged cancelled units` : ''} will also be removed. The WCs themselves are not deleted.`)) return;
        try {
          const allocs = await App.Periods.getAllocationsForPeriod(id);
          await App.DB.bulkDelete('transferAllocations', allocs.map((a) => a.id));
          await App.DB.bulkDelete('cancelledUnits', units.map((u) => u.id));
          await App.DB.delete('claimPeriods', id);
          if (App.State.currentPeriodId === id) App.setPeriod(null);
          await App.refreshShell();
        } catch (err) {
          alert(`Couldn't delete: ${err && err.message ? err.message : err}`);
          // eslint-disable-next-line no-console
          console.error('claimPeriods delete failed', err);
        }
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
      if (editing) {
        await renderAllocatedTransfers(container, editing);
      }
      await renderTable(container, periods);
    },
  };
})();
