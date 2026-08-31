'use strict';

const DB_NAME = 'esim-manager-db';
const DB_VERSION = 1;

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('sims')) {
        const store = db.createObjectStore('sims', { keyPath: 'id' });
        store.createIndex('by_updated', 'updatedAt');
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  return _dbPromise;
}

function tx(store, mode = 'readonly') {
  return openDB().then((db) => db.transaction(store, mode).objectStore(store));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const DB = {
  async getAll() {
    const s = await tx('sims');
    const items = await reqToPromise(s.getAll());
    return items.sort((a, b) => getSortKey(b) < getSortKey(a) ? -1 : 1);
  },

  async get(id) {
    const s = await tx('sims');
    return reqToPromise(s.get(id));
  },

  async put(sim) {
    const now = Date.now();
    sim.updatedAt = now;
    if (!sim.id) sim.id = 'sim_' + now + '_' + Math.random().toString(36).slice(2, 8);
    const s = await tx('sims', 'readwrite');
    await reqToPromise(s.put(sim));
    return sim;
  },

  async delete(id) {
    const s = await tx('sims', 'readwrite');
    await reqToPromise(s.delete(id));
  },

  async bulkPut(items) {
    if (!items.length) return;
    const db = await openDB();
    const t = db.transaction('sims', 'readwrite');
    const s = t.objectStore('sims');
    await Promise.all(items.map((sim) => reqToPromise(s.put(sim))));
  },

  // Meta helpers (sync metadata, settings)
  async getMeta(key) {
    const s = await tx('meta');
    const r = await reqToPromise(s.get(key));
    return r ? r.value : null;
  },

  async setMeta(key, value) {
    const s = await tx('meta', 'readwrite');
    await reqToPromise(s.put({ key, value, updatedAt: Date.now() }));
  },

  async clear() {
    const db = await openDB();
    const t = db.transaction('sims', 'readwrite');
    await reqToPromise(t.objectStore('sims').clear());
  }
};

function getSortKey(sim) {
  // Ordenar por estado: activas primero, luego por fecha de actualización
  const statusRank = { active: 0, recharge_pending: 1, soon: 2, inactive: 3 };
  return (statusRank[sim.statusStatus] ?? 9) + '_' + (sim.updatedAt || 0);
}
