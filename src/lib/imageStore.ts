const DB_NAME = 'cardscan_images'
const STORE_NAME = 'images'
const DB_VERSION = 1

let _db: IDBDatabase | null = null

function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db)
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME)
    req.onsuccess = () => { _db = req.result; resolve(req.result) }
    req.onerror = () => reject(req.error)
  })
}

export async function saveImage(key: string, base64: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(base64, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function loadImages(keys: string[]): Promise<Record<string, string>> {
  if (!keys.length) return {}
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const result: Record<string, string> = {}
    const tx = db.transaction(STORE_NAME, 'readonly')
    let pending = keys.length
    const done = () => { if (--pending === 0) resolve(result) }
    keys.forEach((key) => {
      const req = tx.objectStore(STORE_NAME).get(key)
      req.onsuccess = () => { if (req.result) result[key] = req.result as string; done() }
      req.onerror = () => done()
    })
    tx.onerror = () => reject(tx.error)
  })
}

export async function deleteImages(keys: string[]): Promise<void> {
  if (!keys.length) return
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    keys.forEach((key) => tx.objectStore(STORE_NAME).delete(key))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
