const DB_NAME = 'canteen-inventory';
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains('items')) {
        const store = db.createObjectStore('items', { keyPath: 'id' });
        store.createIndex('barcode', 'barcode', { unique: false });
        store.createIndex('category', 'category', { unique: false });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('tombstones')) {
        db.createObjectStore('tombstones', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode = 'readonly') {
  return openDb().then((db) => db.transaction(store, mode).objectStore(store));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function uid() {
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 10)
  );
}

export async function getAllItems() {
  const store = await tx('items');
  return reqToPromise(store.getAll());
}

export async function getItem(id) {
  const store = await tx('items');
  return reqToPromise(store.get(id));
}

export async function findByBarcode(barcode) {
  if (!barcode) return null;
  const store = await tx('items');
  const idx = store.index('barcode');
  return reqToPromise(idx.get(barcode));
}

export async function putItem(item) {
  const now = Date.now();
  const record = {
    id: item.id || uid(),
    name: (item.name || '').trim(),
    barcode: (item.barcode || '').trim(),
    category: (item.category || '').trim(),
    quantity: Number(item.quantity) || 0,
    unit: (item.unit || '').trim(),
    price: Number(item.price) || 0,
    threshold: Number(item.threshold) || 0,
    notes: (item.notes || '').trim(),
    createdAt: item.createdAt || now,
    updatedAt: now,
  };
  const store = await tx('items', 'readwrite');
  await reqToPromise(store.put(record));
  return record;
}

export async function deleteItem(id) {
  const db = await openDb();
  const t = db.transaction(['items', 'tombstones'], 'readwrite');
  await reqToPromise(t.objectStore('items').delete(id));
  await reqToPromise(
    t.objectStore('tombstones').put({ id, deletedAt: Date.now() })
  );
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function getTombstones() {
  const store = await tx('tombstones');
  return reqToPromise(store.getAll());
}

export async function clearTombstones(ids) {
  const store = await tx('tombstones', 'readwrite');
  for (const id of ids) await reqToPromise(store.delete(id));
}

export async function wipeAll() {
  const db = await openDb();
  const t = db.transaction(['items', 'tombstones', 'settings'], 'readwrite');
  await Promise.all([
    reqToPromise(t.objectStore('items').clear()),
    reqToPromise(t.objectStore('tombstones').clear()),
    reqToPromise(t.objectStore('settings').clear()),
  ]);
}

export async function getSetting(key, fallback = null) {
  const store = await tx('settings');
  const row = await reqToPromise(store.get(key));
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  const store = await tx('settings', 'readwrite');
  await reqToPromise(store.put({ key, value }));
}

export async function getCategories() {
  const items = await getAllItems();
  return [...new Set(items.map((i) => i.category).filter(Boolean))].sort();
}

export async function exportAll() {
  const [items, tombstones, db] = await Promise.all([
    getAllItems(),
    getTombstones(),
    openDb(),
  ]);
  const settingsStore = db.transaction('settings').objectStore('settings');
  const settings = await reqToPromise(settingsStore.getAll());
  return {
    exportedAt: Date.now(),
    items,
    tombstones,
    settings,
  };
}

export async function importAll(payload, { replace = false } = {}) {
  if (!payload || !Array.isArray(payload.items)) {
    throw new Error('Invalid backup file');
  }
  const db = await openDb();
  const t = db.transaction(['items', 'tombstones', 'settings'], 'readwrite');
  if (replace) {
    await Promise.all([
      reqToPromise(t.objectStore('items').clear()),
      reqToPromise(t.objectStore('tombstones').clear()),
    ]);
  }
  for (const item of payload.items) {
    await reqToPromise(t.objectStore('items').put(item));
  }
  for (const ts of payload.tombstones || []) {
    await reqToPromise(t.objectStore('tombstones').put(ts));
  }
  for (const s of payload.settings || []) {
    await reqToPromise(t.objectStore('settings').put(s));
  }
}
