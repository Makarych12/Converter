/**
 * Хранилище: IndexedDB (основное, для истории и снапшотов) + localStorage (синхронный «горячий» кэш
 * последних курсов, чтобы отрисовать интерфейс до первого await — Zero-Latency старт).
 */

const DB_NAME = 'convector';
const STORE = 'kv';
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) { reject(new Error('IndexedDB недоступна')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB заблокирована'));
  }).catch((err) => {
    console.warn('[storage] IndexedDB недоступна, используем localStorage', err);
    return null;
  });
  return dbPromise;
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const req = fn(store);
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function idbGet(key) {
  const db = await openDB();
  if (!db) return lsGet(`idb:${key}`);
  try { return await tx(db, 'readonly', (s) => s.get(key)); } catch { return undefined; }
}

export async function idbSet(key, value) {
  const db = await openDB();
  if (!db) { lsSet(`idb:${key}`, value); return; }
  try { await tx(db, 'readwrite', (s) => s.put(value, key)); } catch (err) { console.warn('[storage] put', err); }
}

export function lsGet(key, fallback = undefined) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}

export function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* квота/приватный режим */ }
}
