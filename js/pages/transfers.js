window.App = window.App || {};
App.Pages = App.Pages || {};

App.Pages.transfers = (function () {
  let editingId = null; // transfer whose fields/attachments/allocations are expanded open

  function blankAmounts() {
    return {
      crt: { units: 0, weight: 0 },
      nonCrt: { units: 0, weight: 0 },
      cbep: { units: 0, weight: 0 },
      saUnits: 0,
    };
  }

  async function getAllTransfers() {
    const rows = await App.DB.getAll('transfers');
    rows.sort((a, b) => (b.dateOfTransfer || '').localeCompare(a.dateOfTransfer || '')); // newest first
    return rows;
  }

  async function collectorOptions(selected) {
    const collectors = await App.DB.getAll('collectors');
    collectors.sort((a, b) => a.name.localeCompare(b.name));
    if (collectors.length === 0) {
      return '<option value="">(add collectors in Settings first)</option>';
    }
    const blank = `<option value="" ${selected ? '' : 'selected'}>— select collector —</option>`;
    return blank + collectors.map((c) => `
      <option value="${c.id}" ${selected === c.id ? 'selected' : ''}>${c.name}${c.cewID ? ' — ' + c.cewID : ''}</option>
    `).join('');
  }

  /** Claim periods whose CEW type matches a non-zero bucket on this transfer (or all periods, if none match). */
  async function periodOptionsForTransfer(transfer) {
    const periods = await App.DB.getAll('claimPeriods');
    const relevant = ['crt', 'nonCrt', 'cbep']
      .filter((k) => (transfer.amounts?.[k]?.weight || 0) > 0 || (transfer.amounts?.[k]?.units || 0) > 0)
      .map((k) => (k === 'crt' ? 'CRT' : k === 'nonCrt' ? 'NonCRT' : 'CBEP'));
    const pool = relevant.length ? periods.filter((p) => relevant.includes(p.cewType)) : periods;
    pool.sort((a, b) => (b.year - a.year) || (b.month - a.month));
    if (pool.length === 0) return '<option value="">(create a matching claim period first)</option>';
    return pool.map((p) => `<option value="${p.id}">${App.Models.formatPeriodLabel(p)}</option>`).join('');
  }

  // ---------- Add / edit a transfer ----------

  async function renderForm(container, transfer) {
    const isEdit = !!transfer;
    const t = transfer || {
      dateOfTransfer: '', collectorId: '', handlerName: '', referenceNumber: '',
      amounts: blankAmounts(), collectorActivityNotes: '',
    };
    const amounts = t.amounts || blankAmounts();

    const form = document.createElement('form');
    form.addEventListener('submit', (e) => e.preventDefault()); // safety net: never navigate, no matter what
    form.className = 'panel';
    form.innerHTML = `
      <h2>${isEdit ? 'Edit transfer' : 'New transfer'}</h2>
      <div class="field-row">
        <div class="field">
          <label>Date of transfer</label>
          <input name="dateOfTransfer" type="date" value="${t.dateOfTransfer || ''}" required>
        </div>
        <div class="field">
          <label>Collector (CEWID)</label>
          <select name="collectorId">${await collectorOptions(t.collectorId)}</select>
        </div>
        <div class="field">
          <label>Handler name <span class="muted">(optional)</span></label>
          <input name="handlerName" value="${t.handlerName || ''}" placeholder="e.g. Cash 4 Cans Riverside">
        </div>
        <div class="field">
          <label>WC / reference #</label>
          <input name="referenceNumber" value="${t.referenceNumber || ''}" placeholder="e.g. 634">
        </div>
      </div>

      <div class="field-row">
        <div class="field">
          <label>Non-CRT units</label>
          <input name="nonCrtUnits" type="number" step="1" value="${amounts.nonCrt?.units ?? 0}">
        </div>
        <div class="field">
          <label>Non-CRT weight (lbs)</label>
          <input name="nonCrtWeight" type="number" step="0.01" value="${amounts.nonCrt?.weight ?? 0}">
        </div>
        <div class="field">
          <label>CBEP units</label>
          <input name="cbepUnits" type="number" step="1" value="${amounts.cbep?.units ?? 0}">
        </div>
        <div class="field">
          <label>CBEP weight (lbs)</label>
          <input name="cbepWeight" type="number" step="0.01" value="${amounts.cbep?.weight ?? 0}">
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>CRT units</label>
          <input name="crtUnits" type="number" step="1" value="${amounts.crt?.units ?? 0}">
        </div>
        <div class="field">
          <label>CRT weight (lbs)</label>
          <input name="crtWeight" type="number" step="0.01" value="${amounts.crt?.weight ?? 0}">
        </div>
        <div class="field">
          <label>SA units</label>
          <input name="saUnits" type="number" step="1" value="${amounts.saUnits ?? 0}">
        </div>
      </div>

      <div class="field">
        <label>Collector activity / discrepancy notes</label>
        <textarea name="collectorActivityNotes" rows="2">${t.collectorActivityNotes || ''}</textarea>
      </div>

      <div class="row">
        <button type="submit" class="primary">${isEdit ? 'Save changes' : 'Create transfer'}</button>
        ${isEdit ? '<button type="button" data-action="cancel-edit">Done editing</button>' : ''}
      </div>
    `;
    container.appendChild(form);

    if (isEdit) {
      form.querySelector('[data-action="cancel-edit"]').addEventListener('click', () => {
        editingId = null;
        App.Pages.transfers.render(container);
      });
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const num = (name) => Number(fd.get(name)) || 0;
      const record = {
        dateOfTransfer: fd.get('dateOfTransfer'),
        collectorId: fd.get('collectorId') ? Number(fd.get('collectorId')) : null,
        handlerName: fd.get('handlerName') || '',
        referenceNumber: fd.get('referenceNumber') || '',
        amounts: {
          crt: { units: num('crtUnits'), weight: num('crtWeight') },
          nonCrt: { units: num('nonCrtUnits'), weight: num('nonCrtWeight') },
          cbep: { units: num('cbepUnits'), weight: num('cbepWeight') },
          saUnits: num('saUnits'),
        },
        collectorActivityNotes: fd.get('collectorActivityNotes') || '',
      };
      try {
        if (isEdit) {
          record.id = t.id;
          record.attachmentIds = t.attachmentIds || [];
          await App.DB.put('transfers', record);
          await App.Pages.transfers.render(container);
        } else {
          const id = await App.DB.add('transfers', { ...record, attachmentIds: [] });
          editingId = id; // drop into edit mode so documents/allocations can be added right away
          await App.Pages.transfers.render(container);
        }
      } catch (err) {
        alert(`Couldn't save this transfer: ${err && err.message ? err.message : err}`);
        // eslint-disable-next-line no-console
        console.error('transfer save failed', err);
      }
    });
  }

  // ---------- Attachments (documents) ----------

  async function renderAttachments(container, transfer) {
    await App.Attachments.renderSection(container, {
      linkedEntityType: 'transfer',
      linkedEntityId: transfer.id,
    });
  }

  // ---------- Allocations (which claim period(s) this transfer counts toward) ----------

  async function renderAllocations(container, transfer) {
    const status = await App.Periods.computeTransferStatus(transfer);
    const periods = await App.DB.getAll('claimPeriods');
    const periodLabel = (id) => {
      const p = periods.find((pp) => pp.id === id);
      return p ? App.Models.formatPeriodLabel(p) : 'Unknown period';
    };

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `
      <h2>Cancellation status <span class="badge ${status.status === 'Not yet cancelled' ? 'flag' : ''}">${status.status}</span></h2>
      <p class="muted mt-0">
        ${status.allocatedUnits.toLocaleString()} units / ${status.allocatedWeight.toLocaleString()} lbs allocated so far —
        ${status.remainingUnits.toLocaleString()} units / ${status.remainingWeight.toLocaleString()} lbs not yet assigned to a claim period.
      </p>
      ${status.allocations.length ? `
        <table>
          <thead><tr><th>Claim period</th><th class="num">Units</th><th class="num">Weight</th><th></th></tr></thead>
          <tbody>
            ${status.allocations.map((a) => `
              <tr>
                <td>${periodLabel(a.claimPeriodId)}</td>
                <td class="num">${(Number(a.units) || 0).toLocaleString()}</td>
                <td class="num">${(Number(a.weight) || 0).toLocaleString()}</td>
                <td><button type="button" class="danger" data-remove-alloc="${a.id}">Remove</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : ''}
      <form data-role="alloc-form" style="margin-top:14px;">
        <div class="field-row">
          <div class="field" style="flex:2;">
            <label>Allocate to claim period</label>
            <select name="claimPeriodId">${await periodOptionsForTransfer(transfer)}</select>
          </div>
          <div class="field">
            <label>Units</label>
            <input name="units" type="number" step="1" value="${status.remainingUnits || ''}">
          </div>
          <div class="field">
            <label>Weight (lbs)</label>
            <input name="weight" type="number" step="0.01" value="${status.remainingWeight || ''}">
          </div>
        </div>
        <button type="submit" class="primary">Add allocation</button>
      </form>
    `;
    container.appendChild(panel);

    panel.querySelectorAll('[data-remove-alloc]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await App.DB.delete('transferAllocations', Number(btn.dataset.removeAlloc));
        await App.Pages.transfers.render(container);
      });
    });

    panel.querySelector('[data-role="alloc-form"]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const claimPeriodId = fd.get('claimPeriodId') ? Number(fd.get('claimPeriodId')) : null;
      if (!claimPeriodId) return;
      const units = Number(fd.get('units')) || 0;
      const weight = Number(fd.get('weight')) || 0;
      if (weight > status.remainingWeight) {
        const proceed = confirm(
          `This allocates more than the ${status.remainingWeight.toLocaleString()} lbs remaining on this transfer. Continue anyway?`
        );
        if (!proceed) return;
      }
      try {
        await App.DB.add('transferAllocations', { transferId: transfer.id, claimPeriodId, units, weight });
        await App.Pages.transfers.render(container);
      } catch (err) {
        alert(`Couldn't save this allocation: ${err && err.message ? err.message : err}`);
        // eslint-disable-next-line no-console
        console.error('allocation save failed', err);
      }
    });
  }

  // ---------- The list of all transfers ----------

  async function renderTable(container, transfers) {
    if (transfers.length === 0) {
      container.innerHTML += `
        <div class="empty-state">
          <h3>No transfers logged yet</h3>
          <p>Add one above for each collector batch — this is your CalRecycle 197 receipt. Transfers aren't tied to a single claim period; you'll allocate each one (in full or in part) to the period it's actually cancelled in.</p>
        </div>`;
      return;
    }

    const statuses = await Promise.all(transfers.map((t) => App.Periods.computeTransferStatus(t)));
    const collectors = await App.DB.getAll('collectors');
    const collectorName = (id) => collectors.find((c) => c.id === id)?.name || '—';

    const rows = transfers.map((t, i) => {
      const parts = [];
      if (t.amounts?.nonCrt?.weight) parts.push(`Non-CRT ${t.amounts.nonCrt.weight.toLocaleString()} lbs`);
      if (t.amounts?.cbep?.weight) parts.push(`CBEP ${t.amounts.cbep.weight.toLocaleString()} lbs`);
      if (t.amounts?.crt?.weight) parts.push(`CRT ${t.amounts.crt.weight.toLocaleString()} lbs`);
      const status = statuses[i];
      const badgeClass = status.status === 'Not yet cancelled' ? 'flag' : '';
      return `
        <tr>
          <td>${t.dateOfTransfer || '—'}</td>
          <td>${collectorName(t.collectorId)}</td>
          <td>${t.handlerName || '—'}</td>
          <td>${t.referenceNumber || '—'}</td>
          <td class="num">${parts.join(', ') || '—'}</td>
          <td><span class="badge ${badgeClass}">${status.status}</span></td>
          <td class="num">${(t.attachmentIds || []).length}</td>
          <td class="row">
            <button type="button" data-edit="${t.id}">${editingId === t.id ? 'Close' : 'Edit'}</button>
            <button type="button" class="danger" data-delete="${t.id}">Delete</button>
          </td>
        </tr>
      `;
    }).join('');

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `
      <h2>All transfers</h2>
      <table>
        <thead><tr><th>Date</th><th>Collector</th><th>Handler</th><th>Ref #</th><th class="num">Amounts</th><th>Status</th><th class="num">Docs</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
    container.appendChild(panel);

    panel.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.edit);
        editingId = editingId === id ? null : id;
        await App.Pages.transfers.render(container);
      });
    });
    panel.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this transfer? Its attachments and any claim-period allocations will also be removed.')) return;
        const id = Number(btn.dataset.delete);
        try {
          const docs = await App.DB.getAllByIndex('attachments', 'linkedEntityId', id);
          for (const d of docs) {
            if (d.linkedEntityType === 'transfer') await App.DB.delete('attachments', d.id);
          }
          const allocs = await App.Periods.getAllocationsForTransfer(id);
          await App.DB.bulkDelete('transferAllocations', allocs.map((a) => a.id));
          await App.DB.delete('transfers', id);
          if (editingId === id) editingId = null;
          await App.Pages.transfers.render(container);
        } catch (err) {
          alert(`Couldn't delete: ${err && err.message ? err.message : err}`);
          // eslint-disable-next-line no-console
          console.error('transfer delete failed', err);
        }
      });
    });
  }

  return {
    async render(container) {
      container.innerHTML = `
        <div class="page-header">
          <h1>Transfers</h1>
          <p>Every collector transfer you've logged — CalRecycle 197 receipts. A transfer stays here permanently; below it you allocate how much of it counts toward each claim period as it gets cancelled.</p>
        </div>
      `;

      const transfers = await getAllTransfers();
      const editing = editingId ? transfers.find((t) => t.id === editingId) : null;

      await renderForm(container, editing);
      if (editing) {
        await renderAllocations(container, editing);
        await renderAttachments(container, editing);
      }
      await renderTable(container, transfers);
    },
  };
})();
