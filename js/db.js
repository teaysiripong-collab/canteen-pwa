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

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('ยกเลิกการบันทึกข้อมูล'));
  });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateNumber(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${fieldName} ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป`);
  }
  return number;
}

function normalizeItem(item, { requireId = false, preserveTimestamps = false } = {}) {
  if (!isPlainObject(item)) throw new Error('รายการสินค้าในไฟล์สำรองไม่ถูกต้อง');
  const id = typeof item.id === 'string' ? item.id.trim() : '';
  const name = typeof item.name === 'string' ? item.name.trim() : '';
  if (requireId && !id) throw new Error('รายการสินค้าในไฟล์สำรองไม่มีรหัส');
  if (!name) throw new Error('กรุณากรอกชื่อสินค้า');

  const now = Date.now();
  const createdAt = preserveTimestamps ? Number(item.createdAt) : Number(item.createdAt) || now;
  const updatedAt = preserveTimestamps ? Number(item.updatedAt) : now;
  if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) {
    throw new Error(`วันที่ของรายการ "${name}" ไม่ถูกต้อง`);
  }

  return {
    id: id || uid(),
    name,
    barcode: typeof item.barcode === 'string' ? item.barcode.trim() : '',
    category: typeof item.category === 'string' ? item.category.trim() : '',
    quantity: validateNumber(item.quantity ?? 0, `จำนวนของ "${name}"`),
    unit: typeof item.unit === 'string' ? item.unit.trim() : '',
    price: validateNumber(item.price ?? 0, `ราคาของ "${name}"`),
    threshold: validateNumber(item.threshold ?? 0, `จุดเตือนของ "${name}"`),
    notes: typeof item.notes === 'string' ? item.notes.trim() : '',
    createdAt,
    updatedAt,
  };
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
  const record = normalizeItem(item);
  const database = await openDb();
  const transaction = database.transaction('items', 'readwrite');
  const store = transaction.objectStore('items');
  if (record.barcode) {
    const existing = await reqToPromise(store.index('barcode').get(record.barcode));
    if (existing && existing.id !== record.id) {
      transaction.abort();
      throw new Error(`Barcode / SKU "${record.barcode}" ถูกใช้แล้ว`);
    }
  }
  await reqToPromise(store.put(record));
  await transactionDone(transaction);
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
  if (!isPlainObject(payload) || !Array.isArray(payload.items)) {
    throw new Error('ไฟล์สำรองไม่ถูกต้อง: ต้องมีรายการ items');
  }
  if (payload.tombstones !== undefined && !Array.isArray(payload.tombstones)) {
    throw new Error('ไฟล์สำรองไม่ถูกต้อง: tombstones ต้องเป็นรายการ');
  }
  if (payload.settings !== undefined && !Array.isArray(payload.settings)) {
    throw new Error('ไฟล์สำรองไม่ถูกต้อง: settings ต้องเป็นรายการ');
  }

  const items = payload.items.map((item) => normalizeItem(item, {
    requireId: true,
    preserveTimestamps: true,
  }));
  const ids = new Set();
  const barcodes = new Set();
  for (const item of items) {
    if (ids.has(item.id)) throw new Error(`พบรหัสสินค้าซ้ำ "${item.id}" ในไฟล์สำรอง`);
    ids.add(item.id);
    if (item.barcode) {
      if (barcodes.has(item.barcode)) {
        throw new Error(`พบ Barcode / SKU ซ้ำ "${item.barcode}" ในไฟล์สำรอง`);
      }
      barcodes.add(item.barcode);
    }
  }

  const tombstones = (payload.tombstones || []).map((row) => {
    if (!isPlainObject(row) || typeof row.id !== 'string' || !row.id.trim() ||
        !Number.isFinite(Number(row.deletedAt))) {
      throw new Error('ข้อมูลรายการที่ลบในไฟล์สำรองไม่ถูกต้อง');
    }
    return { id: row.id.trim(), deletedAt: Number(row.deletedAt) };
  });
  const settings = (payload.settings || []).map((row) => {
    if (!isPlainObject(row) || typeof row.key !== 'string' || !row.key.trim() ||
        !Object.prototype.hasOwnProperty.call(row, 'value')) {
      throw new Error('ข้อมูลการตั้งค่าในไฟล์สำรองไม่ถูกต้อง');
    }
    return { key: row.key.trim(), value: row.value };
  });

  const db = await openDb();
  if (!replace) {
    const existingItems = await getAllItems();
    for (const existing of existingItems) {
      if (existing.barcode && barcodes.has(existing.barcode) && !ids.has(existing.id)) {
        throw new Error(`Barcode / SKU "${existing.barcode}" มีอยู่ในระบบแล้ว`);
      }
    }
  }
  const t = db.transaction(['items', 'tombstones', 'settings'], 'readwrite');
  if (replace) {
    t.objectStore('items').clear();
    t.objectStore('tombstones').clear();
    t.objectStore('settings').clear();
  }
  for (const item of items) t.objectStore('items').put(item);
  for (const ts of tombstones) t.objectStore('tombstones').put(ts);
  for (const setting of settings) t.objectStore('settings').put(setting);
  await transactionDone(t);
}
