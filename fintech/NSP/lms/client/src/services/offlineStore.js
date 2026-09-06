import { openDB } from 'idb';

const DB_NAME = 'talentledger-offline';
const DB_VERSION = 1;

let dbPromise;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('apiCache')) {
          db.createObjectStore('apiCache', { keyPath: 'url' });
        }
        if (!db.objectStoreNames.contains('mutationQueue')) {
          db.createObjectStore('mutationQueue', { keyPath: 'id', autoIncrement: true });
        }
      },
    });
  }
  return dbPromise;
}

export async function cacheApiResponse(url, data) {
  const db = await getDB();
  await db.put('apiCache', { url, data, cachedAt: Date.now() });
}

export async function getCachedApiResponse(url) {
  const db = await getDB();
  const entry = await db.get('apiCache', url);
  return entry?.data ?? null;
}

export async function queueMutation(method, url, body) {
  const db = await getDB();
  await db.add('mutationQueue', { method, url, body, queuedAt: Date.now() });
}

export async function getQueuedMutations() {
  const db = await getDB();
  return db.getAll('mutationQueue');
}

export async function clearMutation(id) {
  const db = await getDB();
  await db.delete('mutationQueue', id);
}
