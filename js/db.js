/**
 * db.js
 * All data lives in the browser's IndexedDB — nothing leaves this machine,
 * no server, no account. Use the Settings page's Export/Import to back the
 * data up to an actual file on disk.
 *
 * This file only knows how to open the database and do generic
 * get/getAll/put/add/delete/query-by-index. Page modules build on top of
 * these primitives; they don't touch indexedDB directly.
 */
window.App = window.App || {};

App.DB = (function () {
  const DB_NAME = 'calrecycleTracker';
  const DB_VERSION = 1;

  /** @type {IDBDatabase|null} */
  let dbInstance = null;

  const STORE_DEFS = [
    { name: 'facilityProfile', keyPath: 'id' },
    {
      name: 'collectors',
      keyPath: 'id',
      autoIncrement: true,
      indexes: [{ name: 'name', keyPath: 'name' }],
    },
    {
      name: 'claimPeriods',
      keyPath: 'id',
      autoIncrement: true,
      indexes: [
        { name: 'cewType', keyPath: 'cewType' },
        { name: 'cewType_year_month', keyPath: ['cewType', 'year', 'month'] },
      ],
    },
    {
      name: 'transfers',
      keyPath: 'id',
      autoIncrement: true,
      indexes: [
        { name: 'claimPeriodId', keyPath: 'claimPeriodId' },
        { name: 'collectorId', keyPath: 'collectorId' },
        { name: 'dateOfTransfer', keyPath: 'dateOfTransfer' },
      ],
    },
    {
      name: 'cancellations',
      keyPath: 'id',
      autoIncrement: true,
      indexes: [
        { name: 'claimPeriodId', keyPath: 'claimPeriodId' },
        { name: 'dateCancelled', keyPath: 'dateCancelled' },
      ],
    },
    {
      name: 'batteryDisposition',
      keyPath: 'id',
      autoIncrement: true,
      indexes: [{ name: 'claimPeriodId', keyPath: 'claimPeriodId' }],
    },
    {
      name: 'panelDisposition',
      keyPath: 'id',
      autoIncrement: true,
      indexes: [{ name: 'claimPeriodId', keyPath: 'claimPeriodId' }],
    },
    {
      name: 'residualMaterials',
      keyPath: 'id',
      autoIncrement: true,
      indexes: [{ name: 'claimPeriodId', keyPath: 'claimPeriodId' }],
    },
    {
      name: 'residualGenerationLog',
      keyPath: 'id',
      autoIncrement: true,
      indexes: [
        { name: 'claimPeriodId', keyPath: 'claimPeriodId' },
        { name: 'date', keyPath: 'date' },
      ],
    },
    {
      name: 'physicalInventoryCounts',
      keyPath: 'id',
      autoIncrement: true,
      indexes: [{ name: 'claimPeriodId', keyPath: 'claimPeriodId' }],
    },
    {
      name: 'shipmentRecords',
      keyPath: 'id',
      autoIncrement: true,
      indexes: [{ name: 'claimPeriodId', keyPath: 'claimPeriodId' }],
    },
    {
      name: 'attachments',
      keyPath: 'id',
      autoIncrement: true,
      indexes: [
        { name: 'linkedEntityType', keyPath: 'linkedEntityType' },
        { name: 'linkedEntityId', keyPath: 'linkedEntityId' },
      ],
    },
  ];

  function open() {
    if (dbInstance) return Promise.resolve(dbInstance);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (event) => {
        const db = req.result;
        STORE_DEFS.forEach((def) => {
          if (db.objectStoreNames.contains(def.name)) return;
          const store = db.createObjectStore(def.name, {
            keyPath: def.keyPath,
            autoIncrement: !!def.autoIncrement,
          });
          (def.indexes || []).forEach((idx) => {
            store.createIndex(idx.name, idx.keyPath, { unique: !!idx.unique });
          });
        });
      };

      req.onsuccess = () => {
        dbInstance = req.result;
        resolve(dbInstance);
      };

      req.onerror = () => reject(req.error);
    });
  }

  function tx(storeName, mode) {
    return open().then((db) => db.transaction(storeName, mode).objectStore(storeName));
  }

  function wrap(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  return {
    STORE_DEFS,

    /** Insert a new record. Returns the generated id. */
    add(storeName, record) {
      return tx(storeName, 'readwrite').then((store) => wrap(store.add(record)));
    },

    /** Insert or overwrite a record (record must include its keyPath field). */
    put(storeName, record) {
      return tx(storeName, 'readwrite').then((store) => wrap(store.put(record)));
    },

    get(storeName, id) {
      return tx(storeName, 'readonly').then((store) => wrap(store.get(id)));
    },

    getAll(storeName) {
      return tx(storeName, 'readonly').then((store) => wrap(store.getAll()));
    },

    getAllByIndex(storeName, indexName, value) {
      return tx(storeName, 'readonly').then(
        (store) => wrap(store.index(indexName).getAll(value))
      );
    },

    delete(storeName, id) {
      return tx(storeName, 'readwrite').then((store) => wrap(store.delete(id)));
    },

    count(storeName) {
      return tx(storeName, 'readonly').then((store) => wrap(store.count()));
    },

    /** Wipe every store. Used by Settings > "Start over". */
    async clearAll() {
      const db = await open();
      const names = Array.from(db.objectStoreNames);
      const t = db.transaction(names, 'readwrite');
      names.forEach((n) => t.objectStore(n).clear());
      return new Promise((resolve, reject) => {
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      });
    },
  };
})();
