/**
 * Zustand persist storage that does not block the UI on every tap.
 *
 * Persist runs after every store write — toast, nav, star, call log. The
 * saved blob is the whole contact library. If we stringify that on the
 * calling thread, the next tap (including the nav bar) never lands.
 *
 * This storage:
 *   1. Skips the write when persisted fields did not change (toast, screen).
 *   2. Batches stringify + localStorage by 400ms when they did.
 *   3. Flushes on hide / unload so a kill-switch does not lose the last tap.
 */

import type { PersistStorage, StorageValue } from 'zustand/middleware'

const FLUSH_MS = 400

const PERSIST_KEYS = [
  'contacts',
  'callLogs',
  'invoices',
  'apiKey',
  'apiKey2',
  'apiKey3',
  'sbUrl',
  'sbKey',
  'sheetsWebhook',
  'invoiceSheetsWebhook',
  'theme',
] as const

type PersistedSlice = Record<(typeof PERSIST_KEYS)[number], unknown> & Record<string, unknown>

let timer: ReturnType<typeof setTimeout> | null = null
let queued: { name: string; value: StorageValue<PersistedSlice> } | null = null
let lastSlice: PersistedSlice | null = null
let listening = false

function samePersisted(a: PersistedSlice | null, b: PersistedSlice): boolean {
  if (!a) return false
  return PERSIST_KEYS.every((key) => a[key] === b[key])
}

function stripImagesForWrite(state: PersistedSlice): PersistedSlice {
  const contacts = state.contacts
  if (!Array.isArray(contacts)) return state
  let changed = false
  const next = contacts.map((contact: { front_image?: string; back_image?: string }) => {
    if (!contact?.front_image && !contact?.back_image) return contact
    changed = true
    return { ...contact, front_image: '', back_image: '' }
  })
  return changed ? { ...state, contacts: next } : state
}

function flush(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (!queued) return
  const { name, value } = queued
  queued = null
  try {
    const payload: StorageValue<PersistedSlice> = {
      ...value,
      state: stripImagesForWrite(value.state),
    }
    localStorage.setItem(name, JSON.stringify(payload))
  } catch {
    /* quota or private mode — the in-memory store is still the source of truth */
  }
}

function ensureLifecycleFlush(): void {
  if (listening || typeof window === 'undefined') return
  listening = true
  const onHide = () => flush()
  window.addEventListener('pagehide', onHide)
  window.addEventListener('beforeunload', onHide)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
}

export const debouncedPersistStorage: PersistStorage<any> = {
  getItem: (name) => {
    try {
      const raw = localStorage.getItem(name)
      if (!raw) return null
      const parsed = JSON.parse(raw) as StorageValue<PersistedSlice>
      lastSlice = parsed.state ?? null
      return parsed
    } catch {
      return null
    }
  },
  setItem: (name, value) => {
    const slice = value.state
    if (samePersisted(lastSlice, slice)) return
    lastSlice = slice
    ensureLifecycleFlush()
    queued = { name, value }
    if (timer) return
    timer = setTimeout(flush, FLUSH_MS)
  },
  removeItem: (name) => {
    queued = null
    lastSlice = null
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    try {
      localStorage.removeItem(name)
    } catch {
      /* ignore */
    }
  },
}
