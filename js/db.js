/**
 * db.js
 * All data lives in this browser's IndexedDB — nothing leaves the machine.
 * Settings → Backup writes it all to a .json file.
 */
window.App = window.App || {};

App.DB = (function () {
  const DB_NAME = 'calrecycleTracker';
  // v2: per-unit cancellations. v3: transfers split from periods via allocations.
  // v4: weight certificates (wcs) become the central record; companies, WC types,
  //     statuses, materials; cancelled units carry a lot # instead of a transfer id.
  const DB_VERSION = 4;
  let dbInstance = null;

  const idx = (name, keyPath = name) => ({ name, keyPath });
  const STORE_DEFS = [
    { name: 'meta', keyPath: 'key' },
    { name: 'facilityProfile', keyPath: 'id' },
    { name: 'companies', keyPath: 'id', autoIncrement: true, indexes: [idx('name')] },
    { name: 'wcTypes', keyPath: 'id', autoIncrement: true },
    { name: 'wcStatuses', keyPath: 'id', autoIncrement: true },
    { name: 'materials', keyPath: 'id', autoIncrement: true },
    { name: 'wcs', keyPath: 'id', autoIncrement: true, indexes: [idx('wcNumber'), idx('kind'), idx('date')] },
    { name: 'claimPeriods', keyPath: 'id', autoIncrement: true,
      indexes: [idx('cewType'), { name: 'cewType_year_month', keyPath: ['cewType', 'year', 'month'] }] },
    { name: 'transferAllocations', keyPath: 'id', autoIncrement: true, indexes: [idx('wcId'), idx('claimPeriodId')] },
    { name: 'cancelledUnits', keyPath: 'id', autoIncrement: true,
      indexes: [idx('claimPeriodId'), idx('dateCancelled'), idx('lotNumber')] },
    { name: 'batteryDisposition', keyPath: 'id', autoIncrement: true, indexes: [idx('claimPeriodId')] },
    { name: 'panelDisposition', keyPath: 'id', autoIncrement: true, indexes: [idx('claimPeriodId')] },
    { name: 'attachments', keyPath: 'id', autoIncrement: true, indexes: [idx('linkedEntityType'), idx('linkedEntityId')] },
    // Legacy (pre-v4). Kept so old data survives and still appears in backups; migrated on first load.
    { name: 'collectors', keyPath: 'id', autoIncrement: true },
    { name: 'transfers', keyPath: 'id', autoIncrement: true },
    { name: 'shipmentRecords', keyPath: 'id', autoIncrement: true },
    { name: 'residualMaterials', keyPath: 'id', autoIncrement: true },
    { name: 'residualGenerationLog', keyPath: 'id', autoIncrement: true },
    { name: 'physicalInventoryCounts', keyPath: 'id', autoIncrement: true },
  ];

  function open() {
    if (dbInstance) return Promise.resolve(dbInstance);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (event) => {
        const db = req.result;
        const upgradeTx = req.transaction;
        STORE_DEFS.forEach((def) => {
          const store = db.objectStoreNames.contains(def.name)
            ? upgradeTx.objectStore(def.name)
            : db.createObjectStore(def.name, { keyPath: def.keyPath, autoIncrement: !!def.autoIncrement });
          (def.indexes || []).forEach((i) => {
            if (!store.indexNames.contains(i.name)) store.createIndex(i.name, i.keyPath, { unique: false });
          });
        });
        if (event.oldVersion < 2 && db.objectStoreNames.contains('cancellations')) db.deleteObjectStore('cancellations');
      };
      req.onblocked = () => reject(new Error('Database upgrade blocked — close any other tabs with this site open, then reload.'));
      req.onsuccess = () => {
        dbInstance = req.result;
        dbInstance.onversionchange = () => { dbInstance.close(); dbInstance = null; };
        resolve(dbInstance);
      };
      req.onerror = () => reject(req.error);
    });
  }

  const wrap = (request) => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const store = (name, mode) => open().then((db) => db.transaction(name, mode).objectStore(name));
  const batch = (name, fn) => open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(name, 'readwrite');
    fn(t.objectStore(name));
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
  }));

  return {
    STORE_DEFS,
    open,
    add: (s, r) => store(s, 'readwrite').then((st) => wrap(st.add(r))),
    put: (s, r) => store(s, 'readwrite').then((st) => wrap(st.put(r))),
    get: (s, id) => store(s, 'readonly').then((st) => wrap(st.get(id))),
    getAll: (s) => store(s, 'readonly').then((st) => wrap(st.getAll())),
    getAllByIndex: (s, i, v) => store(s, 'readonly').then((st) => wrap(st.index(i).getAll(v))),
    delete: (s, id) => store(s, 'readwrite').then((st) => wrap(st.delete(id))),
    count: (s) => store(s, 'readonly').then((st) => wrap(st.count())),
    bulkAdd: (s, records) => batch(s, (st) => records.forEach((r) => st.add(r))),
    bulkPut: (s, records) => batch(s, (st) => records.forEach((r) => st.put(r))),
    bulkDelete: (s, ids) => batch(s, (st) => ids.forEach((id) => st.delete(id))),
    async clearAll() {
      const db = await open();
      const names = Array.from(db.objectStoreNames);
      const t = db.transaction(names, 'readwrite');
      names.forEach((n) => t.objectStore(n).clear());
      return new Promise((resolve, reject) => { t.oncomplete = () => resolve(); t.onerror = () => reject(t.error); });
    },
  };
})();
