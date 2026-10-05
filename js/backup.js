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
    await markBackedUp('download');
  }

  // ---- when was the last backup; automatic backups into a folder you choose (Chrome / Edge)
  async function markBackedUp(how) { await App.DB.put('meta', { key: 'lastBackup', at: new Date().toISOString(), how }); }
  async function lastBackup() { return App.DB.get('meta', 'lastBackup'); }
  const folderSupported = () => typeof window.showDirectoryPicker === 'function';
  async function folder() { const r = await App.DB.get('meta', 'backupFolder'); return r && r.handle; }
  async function chooseFolder() {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'calrecycle-backups' });
    await App.DB.put('meta', { key: 'backupFolder', handle, name: handle.name });
    await writeToFolder(handle);
    return handle.name;
  }
  async function folderPermission() {
    const h = await folder(); if (!h || !h.queryPermission) return 'none';
    return h.queryPermission({ mode: 'readwrite' });
  }
  async function allowFolder() { const h = await folder(); if (!h) return false; return (await h.requestPermission({ mode: 'readwrite' })) === 'granted'; }
  async function writeToFolder(handle) {
    const dump = await exportAll();
    const file = await handle.getFileHandle(`calrecycle-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`, { create: true });
    const w = await file.createWritable(); await w.write(JSON.stringify(dump)); await w.close();
    await markBackedUp('folder');
  }
  /** On start: if a folder is set and allowed, back up once a day. */
  async function autoBackup() {
    try {
      const h = await folder(); if (!h || (await folderPermission()) !== 'granted') return false;
      const last = await lastBackup();
      if (last && Date.now() - Date.parse(last.at) < 20 * 3600 * 1000) return false;
      await writeToFolder(h); return true;
    } catch (e) { return false; }
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

  return { downloadBackup, importFromFile, lastBackup, folderSupported, folder, chooseFolder, folderPermission, allowFolder, autoBackup, writeToFolder };
})();
