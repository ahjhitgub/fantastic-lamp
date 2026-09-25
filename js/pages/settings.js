window.App = window.App || {};
App.Pages = App.Pages || {};

App.Pages.settings = (function () {
  async function renderProfile(container) {
    const profile = (await App.DB.get('facilityProfile', 'profile')) || { id: 'profile', recyclerName: '', cewID: '' };

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `
      <h2>Facility profile</h2>
      <p class="muted mt-0">Used on the dashboard and, later, to pre-fill "Approved Recycler" fields on generated forms.</p>
      <form>
        <div class="field-row">
          <div class="field">
            <label>Recycler name</label>
            <input name="recyclerName" value="${profile.recyclerName || ''}">
          </div>
          <div class="field">
            <label>CEWID #</label>
            <input name="cewID" value="${profile.cewID || ''}">
          </div>
        </div>
        <button type="submit" class="primary">Save profile</button>
      </form>
    `;
    container.appendChild(panel);

    panel.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await App.DB.put('facilityProfile', {
        id: 'profile',
        recyclerName: fd.get('recyclerName') || '',
        cewID: fd.get('cewID') || '',
      });
      await App.refreshShell();
    });
  }

  async function renderCollectors(container) {
    const collectors = await App.DB.getAll('collectors');
    collectors.sort((a, b) => a.name.localeCompare(b.name));

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `
      <h2>Collectors</h2>
      <p class="muted mt-0">Approved Collectors you receive transfers from. Kept here so Transfers can reference them by name later.</p>
      <form class="row" style="margin-bottom:14px;">
        <input name="name" placeholder="Collector name" required style="flex:2;">
        <input name="cewID" placeholder="Collector CEWID #" style="flex:1;">
        <button type="submit" class="primary">Add</button>
      </form>
      ${collectors.length ? `
        <table>
          <thead><tr><th>Name</th><th>CEWID</th><th></th></tr></thead>
          <tbody>
            ${collectors.map((c) => `
              <tr>
                <td>${c.name}</td>
                <td>${c.cewID || '—'}</td>
                <td><button type="button" class="danger" data-delete="${c.id}">Remove</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : '<p class="muted">No collectors on file yet.</p>'}
    `;
    container.appendChild(panel);

    panel.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const name = fd.get('name');
      if (!name) return;
      await App.DB.add('collectors', { name, cewID: fd.get('cewID') || '' });
      await App.Pages.settings.render(container);
    });

    panel.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await App.DB.delete('collectors', Number(btn.dataset.delete));
        await App.Pages.settings.render(container);
      });
    });
  }

  function renderBackup(container) {
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `
      <h2>Backup</h2>
      <p class="muted mt-0">
        Everything lives in this browser's local storage on this laptop — nothing is sent anywhere.
        Download a backup file regularly (it's a plain, readable .json file, attachments included)
        so you have a real copy on disk: for your own peace of mind, to move to a new machine, or
        to sync via a folder you already back up.
      </p>
      <div class="row">
        <button type="button" class="primary" data-action="export">Download backup (.json)</button>
        <label class="row" style="cursor:pointer;">
          <button type="button" data-action="import-trigger">Restore from backup…</button>
          <input type="file" accept="application/json" data-role="import-file" class="hidden">
        </label>
      </div>
    `;
    container.appendChild(panel);

    panel.querySelector('[data-action="export"]').addEventListener('click', async () => {
      await App.Backup.downloadBackup();
    });

    const fileInput = panel.querySelector('[data-role="import-file"]');
    panel.querySelector('[data-action="import-trigger"]').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      if (!confirm('This replaces everything currently in the app with the contents of this backup file. Continue?')) {
        fileInput.value = '';
        return;
      }
      await App.Backup.importFromFile(file);
      await App.refreshShell();
    });

    const danger = document.createElement('div');
    danger.className = 'panel';
    danger.innerHTML = `
      <h2>Start over</h2>
      <p class="muted mt-0">Erases every record in this browser. Download a backup first if you might want it back.</p>
      <button type="button" class="danger" data-action="clear-all">Erase all data</button>
    `;
    container.appendChild(danger);
    danger.querySelector('[data-action="clear-all"]').addEventListener('click', async () => {
      if (!confirm('This permanently erases all claim periods, transfers, and every other record in this browser. This cannot be undone. Continue?')) return;
      await App.DB.clearAll();
      App.State.currentPeriodId = null;
      await App.refreshShell();
    });
  }

  return {
    async render(container) {
      container.innerHTML = `
        <div class="page-header">
          <h1>Settings &amp; Backup</h1>
          <p>Your facility info, collector list, and the backup tools that keep a real copy of your data on this laptop.</p>
        </div>
      `;
      await renderProfile(container);
      await renderCollectors(container);
      renderBackup(container);
    },
  };
})();
