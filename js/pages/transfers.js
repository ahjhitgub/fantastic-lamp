window.App = window.App || {};
App.Pages = App.Pages || {};

App.Pages.transfers = (function () {
  let editingId = null;

  function blankAmounts() {
    return {
      crt: { units: 0, weight: 0 },
      nonCrt: { units: 0, weight: 0 },
      cbep: { units: 0, weight: 0 },
      saUnits: 0,
    };
  }

  async function getPeriodTransfers(periodId) {
    if (!periodId) return [];
    const rows = await App.DB.getAllByIndex('transfers', 'claimPeriodId', periodId);
    rows.sort((a, b) => (a.dateOfTransfer || '').localeCompare(b.dateOfTransfer || ''));
    return rows;
  }

  function sumAmounts(transfers) {
    const total = blankAmounts();
    transfers.forEach((t) => {
      ['crt', 'nonCrt', 'cbep'].forEach((k) => {
        total[k].units += Number(t.amounts?.[k]?.units) || 0;
        total[k].weight += Number(t.amounts?.[k]?.weight) || 0;
      });
      total.saUnits += Number(t.amounts?.saUnits) || 0;
    });
    return total;
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

  async function renderTotals(container, periodId) {
    const transfers = await getPeriodTransfers(periodId);
    const total = sumAmounts(transfers);
    const panel = document.createElement('div');
    panel.className = 'stat-row';
    panel.innerHTML = `
      <div class="stat"><div class="value">${transfers.length}</div><div class="label">Transfers this period</div></div>
      <div class="stat"><div class="value">${total.nonCrt.units.toLocaleString()}</div><div class="label">Non-CRT units</div></div>
      <div class="stat"><div class="value">${total.nonCrt.weight.toLocaleString()}</div><div class="label">Non-CRT lbs</div></div>
      <div class="stat"><div class="value">${total.cbep.weight.toLocaleString()}</div><div class="label">CBEP lbs</div></div>
      <div class="stat"><div class="value">${total.crt.weight.toLocaleString()}</div><div class="label">CRT lbs</div></div>
    `;
    container.appendChild(panel);
    const note = document.createElement('p');
    note.className = 'muted';
    note.style.marginTop = '-8px';
    note.textContent = "Check these against your Transfer Summary's grand totals — they should match exactly.";
    container.appendChild(note);
  }

  async function renderForm(container, periodId, transfer) {
    const isEdit = !!transfer;
    const t = transfer || {
      dateOfTransfer: '',
      collectorId: '',
      handlerName: '',
      referenceNumber: '',
      amounts: blankAmounts(),
      collectorActivityNotes: '',
    };
    const amounts = t.amounts || blankAmounts();

    const form = document.createElement('form');
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
        claimPeriodId: periodId,
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

      if (isEdit) {
        record.id = t.id;
        record.attachmentIds = t.attachmentIds || [];
        await App.DB.put('transfers', record);
        await App.Pages.transfers.render(container);
      } else {
        const id = await App.DB.add('transfers', { ...record, attachmentIds: [] });
        // Drop straight into edit mode so documents can be attached right away.
        editingId = id;
        await App.Pages.transfers.render(container);
      }
    });
  }

  async function renderAttachments(container, transfer) {
    await App.Attachments.renderSection(container, {
      linkedEntityType: 'transfer',
      linkedEntityId: transfer.id,
    });
  }

  async function renderTable(container, transfers) {
    const collectors = await App.DB.getAll('collectors');
    const collectorName = (id) => collectors.find((c) => c.id === id)?.name || '—';

    if (transfers.length === 0) {
      container.innerHTML += `
        <div class="empty-state">
          <h3>No transfers logged for this period yet</h3>
          <p>Add one above for each collector batch — this is your CalRecycle 197 receipt.</p>
        </div>`;
      return;
    }

    const rows = transfers.map((t) => {
      const parts = [];
      if (t.amounts?.nonCrt?.weight) parts.push(`Non-CRT ${t.amounts.nonCrt.weight.toLocaleString()} lbs`);
      if (t.amounts?.cbep?.weight) parts.push(`CBEP ${t.amounts.cbep.weight.toLocaleString()} lbs`);
      if (t.amounts?.crt?.weight) parts.push(`CRT ${t.amounts.crt.weight.toLocaleString()} lbs`);
      return `
        <tr>
          <td>${t.dateOfTransfer || '—'}</td>
          <td>${collectorName(t.collectorId)}</td>
          <td>${t.handlerName || '—'}</td>
          <td>${t.referenceNumber || '—'}</td>
          <td class="num">${parts.join(', ') || '—'}</td>
          <td class="num">${(t.attachmentIds || []).length}</td>
          <td class="row">
            <button type="button" data-edit="${t.id}">Edit</button>
            <button type="button" class="danger" data-delete="${t.id}">Delete</button>
          </td>
        </tr>
      `;
    }).join('');

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `
      <h2>All transfers this period</h2>
      <table>
        <thead><tr><th>Date</th><th>Collector</th><th>Handler</th><th>Ref #</th><th class="num">Amounts</th><th class="num">Docs</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
    container.appendChild(panel);

    panel.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        editingId = Number(btn.dataset.edit);
        await App.Pages.transfers.render(container);
      });
    });
    panel.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this transfer? Any attached documents will also be removed.')) return;
        const id = Number(btn.dataset.delete);
        const docs = await App.DB.getAllByIndex('attachments', 'linkedEntityId', id);
        for (const d of docs) {
          if (d.linkedEntityType === 'transfer') await App.DB.delete('attachments', d.id);
        }
        await App.DB.delete('transfers', id);
        if (editingId === id) editingId = null;
        await App.Pages.transfers.render(container);
      });
    });
  }

  return {
    async render(container) {
      const periodId = App.State.currentPeriodId;

      container.innerHTML = `
        <div class="page-header">
          <h1>Transfers</h1>
          <p>CalRecycle 197 receipts for the active claim period — one per collector/handler batch.</p>
        </div>
      `;

      if (!periodId) {
        container.innerHTML += `
          <div class="empty-state">
            <h3>No claim period selected</h3>
            <p><a href="#/claimPeriods">Create or select one</a> first — transfers are always scoped to a period.</p>
          </div>`;
        return;
      }

      await renderTotals(container, periodId);

      const transfers = await getPeriodTransfers(periodId);
      const editing = editingId ? transfers.find((t) => t.id === editingId) : null;

      await renderForm(container, periodId, editing);

      if (editing) {
        await renderAttachments(container, editing);
      }

      await renderTable(container, transfers);
    },
  };
})();
