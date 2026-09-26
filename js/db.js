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
  // v2: cancellations (daily totals) -> cancelledUnits (per-unit detail;
  // daily totals are now computed on the fly from these rows).
  // v3: transfers.claimPeriodId removed — a transfer can be split across
  // periods (partially cancelled), so the link is now transferAllocations,
  // many rows per transfer, one per period it's been allocated into.
  const DB_VERSION = 3;

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
        { name: 'collectorId', keyPath: 'collectorId' },
        { name: 'dateOfTransfer', keyPath: 'dateOfTransfer' },
      ],
    },
    {
      // Links a transfer (or a portion of one) to the claim period it was
      // actually cancelled in. A transfer with no rows here isn't cancelled
      // yet; rows summing to less than the transfer's total = partially
      // cancelled; summing to the full amount (in one row or split across
      // two) = fully cancelled. Status is always derived, never stored.
      name: 'transferAllocations',
      keyPath: 'id',
      autoIncrement: true,
      indexes: [
        { name: 'transferId', keyPath: 'transferId' },
        { name: 'claimPeriodId', keyPath: 'claimPeriodId' },
      ],
    },
    {
      name: 'cancelledUnits',
      keyPath: 'id',
      autoIncrement: true,
      indexes: [
        { name: 'claimPeriodId', keyPath: 'claimPeriodId' },
        { name: 'dateCancelled', keyPath: 'dateCancelled' },
        { name: 'originTransferId', keyPath: 'originTransferId' },
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
        const upgradeTx = req.transaction;

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

        // v1 -> v2: superseded by cancelledUnits (per-unit detail).
        if (event.oldVersion < 2 && db.objectStoreNames.contains('cancellations')) {
          db.deleteObjectStore('cancellations');
        }

        // v2 -> v3: a transfer's claimPeriodId becomes a transferAllocations
        // row instead (assumed fully allocated, since that's what a single
        // fixed period meant before), then the old index is retired.
        if (event.oldVersion < 3 && event.oldVersion > 0 && db.objectStoreNames.contains('transfers')) {
          const transferStore = upgradeTx.objectStore('transfers');
          const allocStore = upgradeTx.objectStore('transferAllocations');
          transferStore.openCursor().onsuccess = (cursorEvent) => {
            const cursor = cursorEvent.target.result;
            if (!cursor) return;
            const t = cursor.value;
            if (t.claimPeriodId) {
              const amts = t.amounts || {};
              allocStore.add({
                transferId: t.id,
                claimPeriodId: t.claimPeriodId,
                units: (amts.crt?.units || 0) + (amts.nonCrt?.units || 0) + (amts.cbep?.units || 0),
                weight: (amts.crt?.weight || 0) + (amts.nonCrt?.weight || 0) + (amts.cbep?.weight || 0),
                notes: 'Migrated automatically — this transfer was fully allocated to its old fixed period.',
              });
              delete t.claimPeriodId;
              cursor.update(t);
            }
            cursor.continue();
          };
          if (transferStore.indexNames.contains('claimPeriodId')) {
            transferStore.deleteIndex('claimPeriodId');
          }
        }
      };

      req.onblocked = () => {
        reject(new Error('Database upgrade blocked — close any other tabs with this site open, then reload.'));
      };

      req.onsuccess = () => {
        dbInstance = req.result;
        // If a future reload (or another tab) opens a newer version, step
        // aside instead of silently blocking it forever.
        dbInstance.onversionchange = () => {
          dbInstance.close();
          dbInstance = null;
        };
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

    /** Insert many records in one transaction — much faster than N separate add() calls. */
    bulkAdd(storeName, records) {
      return open().then((db) => new Promise((resolve, reject) => {
        const t = db.transaction(storeName, 'readwrite');
        const store = t.objectStore(storeName);
        records.forEach((r) => store.add(r));
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      }));
    },

    delete(storeName, id) {
      return tx(storeName, 'readwrite').then((store) => wrap(store.delete(id)));
    },

    /** Delete many records by id in one transaction. */
    bulkDelete(storeName, ids) {
      return open().then((db) => new Promise((resolve, reject) => {
        const t = db.transaction(storeName, 'readwrite');
        const store = t.objectStore(storeName);
        ids.forEach((id) => store.delete(id));
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      }));
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
