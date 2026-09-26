/**
 * backup.js
 * IndexedDB data lives inside the browser profile, which isn't a file you
 * can see in Finder/Explorer. This module exports everything to one plain
 * .json file (attachments included, as base64) so you always have a real,
 * portable file on disk — back it up, move it to a new laptop, put it in a
 * private cloud folder, whatever you want.
 */
window.App = window.App || {};

App.Backup = (function () {
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result); // data: URL
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function base64ToBlob(dataUrl) {
    return fetch(dataUrl).then((r) => r.blob());
  }

  async function exportAll() {
    const dump = { exportedAt: new Date().toISOString(), version: 1, stores: {} };

    for (const def of App.DB.STORE_DEFS) {
      const rows = await App.DB.getAll(def.name);
      if (def.name === 'attachments') {
        dump.stores[def.name] = await Promise.all(
          rows.map(async (row) => ({
            ...row,
            blob: undefined,
            blobData: row.blob ? await blobToBase64(row.blob) : null,
          }))
        );
      } else {
        dump.stores[def.name] = rows;
      }
    }
    return dump;
  }

  async function downloadBackup() {
    const dump = await exportAll();
    const json = JSON.stringify(dump, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `calrecycle-tracker-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /** Replaces ALL existing data with what's in the file. Caller should confirm first. */
  async function importFromFile(file) {
    const text = await file.text();
    const dump = JSON.parse(text);
    await App.DB.clearAll();

    for (const [storeName, rows] of Object.entries(dump.stores || {})) {
      for (const row of rows) {
        if (storeName === 'attachments' && row.blobData) {
          row.blob = await base64ToBlob(row.blobData);
          delete row.blobData;
        }
        await App.DB.put(storeName, row);
      }
    }
  }

  return { downloadBackup, importFromFile };
})();
