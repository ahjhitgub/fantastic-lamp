window.App = window.App || {};
App.Pages = App.Pages || {};

App.Pages.residuals = (function () {
  let editingMaterialId = null;
  let editingShipmentId = null;

  function materialHintsList() {
    return App.Models.RESIDUAL_MATERIAL_HINTS.map((h) => `<option value="${h}">`).join('');
  }
  function destinationHintsList() {
    return App.Models.SHIPMENT_DESTINATION_HINTS.map((h) => `<option value="${h}">`).join('');
  }

  async function getMaterials(periodId) {
    const rows = await App.DB.getAllByIndex('residualMaterials', 'claimPeriodId', periodId);
    rows.sort((a, b) => (a.materialCategory || '').localeCompare(b.materialCategory || ''));
    return rows;
  }

  async function getShipments(periodId) {
    const rows = await App.DB.getAllByIndex('shipmentRecords', 'claimPeriodId', periodId);
    rows.sort((a, b) => (a.dateShipped || '').localeCompare(b.dateShipped || ''));
    return rows;
  }

  // ---------- Materials (monthly summary, one row per material) ----------

  async function renderMaterialForm(container, periodId, material) {
    const isEdit = !!material;
    const m = material || { materialCategory: '', generatedWeight: '', weightShipped: '', weightStored: '', shippingDestinations: '' };

    const form = document.createElement('form');
    form.className = 'panel';
    form.innerHTML = `
      <h2>${isEdit ? 'Edit material' : 'Add material'}</h2>
      <div class="field-row">
        <div class="field" style="flex:2;">
          <label>Material</label>
          <input name="materialCategory" list="material-hints" value="${m.materialCategory || ''}" required>
          <datalist id="material-hints">${materialHintsList()}</datalist>
        </div>
        <div class="field">
          <label>Generated (lbs)</label>
          <input name="generatedWeight" type="number" step="0.01" value="${m.generatedWeight}">
        </div>
        <div class="field">
          <label>Shipped (lbs)</label>
          <input name="weightShipped" type="number" step="0.01" value="${m.weightShipped}">
        </div>
        <div class="field">
          <label>Total stored (lbs)</label>
          <input name="weightStored" type="number" step="0.01" value="${m.weightStored}">
        </div>
      </div>
      <div class="row">
        <button type="submit" class="primary">${isEdit ? 'Save changes' : 'Add material'}</button>
        ${isEdit ? '<button type="button" data-action="cancel">Cancel</button>' : ''}
      </div>
    `;
    container.appendChild(form);

    if (isEdit) {
      form.querySelector('[data-action="cancel"]').addEventListener('click', () => {
        editingMaterialId = null;
        App.Pages.residuals.render(container);
      });
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const num = (n) => Number(fd.get(n)) || 0;
      const record = {
        claimPeriodId: periodId,
        materialCategory: fd.get('materialCategory'),
        generatedWeight: num('generatedWeight'),
        weightShipped: num('weightShipped'),
        weightStored: num('weightStored'),
      };
      if (isEdit) {
        record.id = m.id;
        await App.DB.put('residualMaterials', record);
      } else {
        await App.DB.add('residualMaterials', record);
      }
      editingMaterialId = null;
      await App.Pages.residuals.render(container);
    });
  }

  function renderMaterialsTable(container, materials) {
    const panel = document.createElement('div');
    panel.className = 'panel';

    if (materials.length === 0) {
      panel.innerHTML = `
        <h2>Materials this period</h2>
        <p class="muted mt-0">No materials logged yet — this is your monthly Residual Summary, one row per material (Steel, ABS Plastic, Circuit Boards, LCD Panels, etc).</p>
      `;
      container.appendChild(panel);
      return;
    }

    const totals = materials.reduce((acc, m) => ({
      generated: acc.generated + (Number(m.generatedWeight) || 0),
      shipped: acc.shipped + (Number(m.weightShipped) || 0),
      stored: acc.stored + (Number(m.weightStored) || 0),
    }), { generated: 0, shipped: 0, stored: 0 });

    panel.innerHTML = `
      <h2>Materials this period</h2>
      <table>
        <thead><tr><th>Material</th><th class="num">Generated</th><th class="num">Shipped</th><th class="num">Total stored</th><th></th></tr></thead>
        <tbody>
          ${materials.map((m) => `
            <tr>
              <td>${m.materialCategory}</td>
              <td class="num">${(Number(m.generatedWeight) || 0).toLocaleString()}</td>
              <td class="num">${(Number(m.weightShipped) || 0).toLocaleString()}</td>
              <td class="num">${(Number(m.weightStored) || 0).toLocaleString()}</td>
              <td class="row">
                <button type="button" data-edit="${m.id}">Edit</button>
                <button type="button" class="danger" data-delete="${m.id}">Delete</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
        <tfoot>
          <tr>
            <th>Total</th>
            <th class="num">${totals.generated.toLocaleString()}</th>
            <th class="num">${totals.shipped.toLocaleString()}</th>
            <th class="num">${totals.stored.toLocaleString()}</th>
            <th></th>
          </tr>
        </tfoot>
      </table>
    `;
    container.appendChild(panel);

    panel.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        editingMaterialId = Number(btn.dataset.edit);
        await App.Pages.residuals.render(container);
      });
    });
    panel.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this material row?')) return;
        await App.DB.delete('residualMaterials', Number(btn.dataset.delete));
        await App.Pages.residuals.render(container);
      });
    });
  }

  // ---------- Shipments (individual outbound Weight Certificates) ----------

  async function renderShipmentForm(container, periodId, shipment) {
    const isEdit = !!shipment;
    const s = shipment || { materialType: '', dateShipped: '', poundsShipped: '', poundsClaimed: '', initialDestination: '', referenceNumber: '', description: '' };

    const form = document.createElement('form');
    form.className = 'panel';
    form.innerHTML = `
      <h2>${isEdit ? 'Edit shipment' : 'Add shipment'}</h2>
      <div class="field-row">
        <div class="field">
          <label>Date shipped</label>
          <input name="dateShipped" type="date" value="${s.dateShipped || ''}" required>
        </div>
        <div class="field">
          <label>Material</label>
          <input name="materialType" list="material-hints-ship" value="${s.materialType || ''}" required>
          <datalist id="material-hints-ship">${materialHintsList()}</datalist>
        </div>
        <div class="field">
          <label>Pounds shipped</label>
          <input name="poundsShipped" type="number" step="0.01" value="${s.poundsShipped}">
        </div>
        <div class="field">
          <label>Pounds claimed</label>
          <input name="poundsClaimed" type="number" step="0.01" value="${s.poundsClaimed}">
        </div>
      </div>
      <div class="field-row">
        <div class="field" style="flex:2;">
          <label>Destination</label>
          <input name="initialDestination" list="destination-hints" value="${s.initialDestination || ''}">
          <datalist id="destination-hints">${destinationHintsList()}</datalist>
        </div>
        <div class="field">
          <label>WC / reference #</label>
          <input name="referenceNumber" value="${s.referenceNumber || ''}">
        </div>
      </div>
      <div class="field">
        <label>Notes</label>
        <textarea name="description" rows="2">${s.description || ''}</textarea>
      </div>
      <div class="row">
        <button type="submit" class="primary">${isEdit ? 'Save changes' : 'Add shipment'}</button>
        ${isEdit ? '<button type="button" data-action="cancel">Done editing</button>' : ''}
      </div>
    `;
    container.appendChild(form);

    if (isEdit) {
      form.querySelector('[data-action="cancel"]').addEventListener('click', () => {
        editingShipmentId = null;
        App.Pages.residuals.render(container);
      });
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const num = (n) => Number(fd.get(n)) || 0;
      const record = {
        claimPeriodId: periodId,
        dateShipped: fd.get('dateShipped'),
        materialType: fd.get('materialType'),
        poundsShipped: num('poundsShipped'),
        poundsClaimed: num('poundsClaimed'),
        initialDestination: fd.get('initialDestination') || '',
        referenceNumber: fd.get('referenceNumber') || '',
        description: fd.get('description') || '',
      };
      if (isEdit) {
        record.id = s.id;
        record.attachmentIds = s.attachmentIds || [];
        await App.DB.put('shipmentRecords', record);
        await App.Pages.residuals.render(container);
      } else {
        const id = await App.DB.add('shipmentRecords', { ...record, attachmentIds: [] });
        editingShipmentId = id; // drop into edit mode so a WC can be attached right away
        await App.Pages.residuals.render(container);
      }
    });
  }

  async function renderShipmentAttachments(container, shipment) {
    await App.Attachments.renderSection(container, {
      linkedEntityType: 'shipmentRecord',
      linkedEntityId: shipment.id,
    });
  }

  function renderShipmentsTable(container, shipments) {
    const panel = document.createElement('div');
    panel.className = 'panel';

    if (shipments.length === 0) {
      panel.innerHTML = `
        <h2>Shipments this period</h2>
        <p class="muted mt-0">No shipments logged yet — one row per outbound Weight Certificate.</p>
      `;
      container.appendChild(panel);
      return;
    }

    panel.innerHTML = `
      <h2>Shipments this period</h2>
      <table>
        <thead><tr><th>Date</th><th>Material</th><th class="num">Lbs shipped</th><th>Destination</th><th>Ref #</th><th class="num">Docs</th><th></th></tr></thead>
        <tbody>
          ${shipments.map((s) => `
            <tr>
              <td>${s.dateShipped || '—'}</td>
              <td>${s.materialType || '—'}</td>
              <td class="num">${(Number(s.poundsShipped) || 0).toLocaleString()}</td>
              <td>${s.initialDestination || '—'}</td>
              <td>${s.referenceNumber || '—'}</td>
              <td class="num">${(s.attachmentIds || []).length}</td>
              <td class="row">
                <button type="button" data-edit="${s.id}">Edit</button>
                <button type="button" class="danger" data-delete="${s.id}">Delete</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    container.appendChild(panel);

    panel.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        editingShipmentId = Number(btn.dataset.edit);
        await App.Pages.residuals.render(container);
      });
    });
    panel.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this shipment? Any attached documents will also be removed.')) return;
        const id = Number(btn.dataset.delete);
        const docs = await App.DB.getAllByIndex('attachments', 'linkedEntityId', id);
        for (const d of docs) {
          if (d.linkedEntityType === 'shipmentRecord') await App.DB.delete('attachments', d.id);
        }
        await App.DB.delete('shipmentRecords', id);
        if (editingShipmentId === id) editingShipmentId = null;
        await App.Pages.residuals.render(container);
      });
    });
  }

  return {
    async render(container) {
      const periodId = App.State.currentPeriodId;

      container.innerHTML = `
        <div class="page-header">
          <h1>Residuals &amp; Inventory</h1>
          <p>Monthly material totals (196B/196C §V) and the individual shipments behind them, for the active claim period.</p>
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

      const materials = await getMaterials(periodId);
      const editingMaterial = editingMaterialId ? materials.find((m) => m.id === editingMaterialId) : null;
      await renderMaterialForm(container, periodId, editingMaterial);
      renderMaterialsTable(container, materials);

      const shipments = await getShipments(periodId);
      const editingShipment = editingShipmentId ? shipments.find((s) => s.id === editingShipmentId) : null;
      await renderShipmentForm(container, periodId, editingShipment);
      if (editingShipment) {
        await renderShipmentAttachments(container, editingShipment);
      }
      renderShipmentsTable(container, shipments);

      const note = document.createElement('div');
      note.className = 'coming-next';
      note.innerHTML = `<strong>Coming later:</strong> the daily scale-ticket generation log and the manual
        month-end physical inventory count sheet — both already in the data model
        (<code>residualGenerationLog</code>, <code>physicalInventoryCounts</code>) but not wired up yet.`;
      container.appendChild(note);
    },
  };
})();
