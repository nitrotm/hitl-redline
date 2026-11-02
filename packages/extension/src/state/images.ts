import type { SnapshotWithImages } from '@redline/shared'

// The screenshots of the snapshots, too big for storage.local: in IndexedDB, which the background
// and the sidebar share (one origin, the extension's), by session and snapshot.

export type SnapshotImages = SnapshotWithImages['images']

const DB = 'redline'
const STORE = 'images'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function run<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = body(db.transaction(STORE, mode).objectStore(STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

const key = (sessionId: string, snapshotId: string) => `${sessionId}/${snapshotId}`

export function putImages(sessionId: string, snapshotId: string, images: SnapshotImages): Promise<IDBValidKey> {
  return run('readwrite', (store) => store.put(images, key(sessionId, snapshotId)))
}

export async function getImages(sessionId: string, snapshotId: string): Promise<SnapshotImages | undefined> {
  return (await run('readonly', (store) => store.get(key(sessionId, snapshotId)))) as SnapshotImages | undefined
}

export function deleteImages(sessionId: string, snapshotId: string): Promise<undefined> {
  return run('readwrite', (store) => store.delete(key(sessionId, snapshotId)))
}

// every snapshot of a session, when it is discarded
export function deleteSessionImages(sessionId: string): Promise<undefined> {
  return run('readwrite', (store) => store.delete(IDBKeyRange.bound(`${sessionId}/`, `${sessionId}/￿`)))
}
