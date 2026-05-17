import type { Contact } from '../types/contact'
import type { SavedInvoice } from '../types/invoice'
import {
  ensureSupabaseClient,
  mapContactRow,
  syncContactsFromDB,
  syncInvoicesFromDB,
} from './supabase'
import { dedupeContacts, mergeContact, normalizeContact } from './utils'

const POLL_MS = 30_000

export function contactUpdatedAt(c: Contact): number {
  const raw = c.updated_at || c.created_at || c.scanned_at
  if (!raw) return 0
  const t = new Date(raw).getTime()
  return Number.isFinite(t) ? t : 0
}

function mergePair(existing: Contact, incoming: Contact): Contact {
  const newer = contactUpdatedAt(incoming) >= contactUpdatedAt(existing) ? incoming : existing
  const older = newer === incoming ? existing : incoming
  return normalizeContact({
    ...mergeContact(older, newer),
    ...newer,
    id: existing.id,
    updated_at: newer.updated_at || incoming.updated_at || existing.updated_at,
  })
}

/** Merge local + cloud; newer `updated_at` wins per contact id. */
export function mergeCloudAndLocalContacts(local: Contact[], cloud: Contact[]): Contact[] {
  const byId = new Map<string, Contact>()

  const ingest = (raw: Contact) => {
    const c = normalizeContact(mapContactRow(raw as Contact & Record<string, unknown>))
    const prev = byId.get(c.id)
    byId.set(c.id, prev ? mergePair(prev, c) : c)
  }

  local.forEach(ingest)
  cloud.forEach(ingest)

  return dedupeContacts(Array.from(byId.values()))
}

function invoiceTime(inv: SavedInvoice): number {
  const t = new Date(inv.saved_at).getTime()
  return Number.isFinite(t) ? t : 0
}

export function mergeCloudAndLocalInvoices(local: SavedInvoice[], cloud: SavedInvoice[]): SavedInvoice[] {
  const byId = new Map<string, SavedInvoice>()
  for (const inv of [...local, ...cloud]) {
    const prev = byId.get(inv.id)
    if (!prev || invoiceTime(inv) >= invoiceTime(prev)) byId.set(inv.id, inv)
  }
  return Array.from(byId.values()).sort((a, b) => b.saved_at.localeCompare(a.saved_at))
}

export type CloudSyncStore = {
  getContacts: () => Contact[]
  setContacts: (contacts: Contact[]) => void
  getInvoices: () => SavedInvoice[]
  setInvoices: (invoices: SavedInvoice[]) => void
  deleteContact: (id: string) => void
  deleteInvoice: (id: string) => void
}

export async function pullAndMergeFromCloud(store: CloudSyncStore): Promise<{
  contacts: number
  invoices: number
}> {
  const [cloudContacts, cloudInvoices] = await Promise.all([
    syncContactsFromDB(),
    syncInvoicesFromDB(),
  ])

  const mergedContacts = mergeCloudAndLocalContacts(store.getContacts(), cloudContacts)
  const mergedInvoices = mergeCloudAndLocalInvoices(store.getInvoices(), cloudInvoices)

  store.setContacts(mergedContacts)
  store.setInvoices(mergedInvoices)

  return { contacts: cloudContacts.length, invoices: cloudInvoices.length }
}

function applyContactRow(store: CloudSyncStore, row: Record<string, unknown>, event: string) {
  const id = String(row.id ?? '')
  if (!id) return

  if (event === 'DELETE') {
    store.deleteContact(id)
    return
  }

  const incoming = mapContactRow(row)
  const current = store.getContacts()
  const existing = current.find((c) => c.id === id)
  const nextContact = existing ? mergePair(existing, incoming) : incoming
  const next = existing
    ? current.map((c) => (c.id === id ? nextContact : c))
    : [...current, nextContact]

  store.setContacts(dedupeContacts(next))
}

function applyInvoiceRow(store: CloudSyncStore, row: Record<string, unknown>, event: string) {
  const id = String(row.id ?? '')
  if (!id) return

  if (event === 'DELETE') {
    store.deleteInvoice(id)
    return
  }

  const incoming: SavedInvoice = {
    id,
    contactId: String(row.contact_id ?? ''),
    company: String(row.company ?? ''),
    contactName: String(row.contact_name ?? ''),
    state: String(row.state ?? ''),
    city: String(row.city ?? ''),
    date: String(row.date ?? ''),
    docKind: (row.doc_kind as SavedInvoice['docKind']) ?? 'invoice',
    paidBy: (row.paid_by as SavedInvoice['paidBy']) ?? 'cash',
    items: (row.items as SavedInvoice['items']) ?? [],
    total: Number(row.total ?? 0),
    notes: String(row.notes ?? ''),
    saved_at: String(row.saved_at ?? new Date().toISOString()),
  }

  const current = store.getInvoices()
  const existing = current.find((i) => i.id === id)
  if (!existing) {
    store.setInvoices(mergeCloudAndLocalInvoices(current, [incoming]))
    return
  }
  if (invoiceTime(incoming) >= invoiceTime(existing)) {
    store.setInvoices(current.map((i) => (i.id === id ? incoming : i)))
  }
}

let syncing = false

export async function runCloudSync(store: CloudSyncStore, quiet = false): Promise<void> {
  if (syncing) return
  syncing = true
  try {
    await pullAndMergeFromCloud(store)
  } catch (err) {
    if (!quiet) console.warn('Cloud sync failed:', err)
  } finally {
    syncing = false
  }
}

/** Realtime + periodic polling so all devices stay in sync without manual backup/restore. */
export function startCloudRealtimeSync(
  store: CloudSyncStore,
  onStatus?: (connected: boolean) => void
): () => void {
  const sb = ensureSupabaseClient()
  if (!sb) return () => {}

  void runCloudSync(store, true)

  const channel = sb
    .channel('cardscan-live-sync')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'contacts' },
      (payload: { new: Record<string, unknown> | null; old: Record<string, unknown> | null; eventType: string }) => {
        const row = (payload.new ?? payload.old) as Record<string, unknown>
        if (row) applyContactRow(store, row, payload.eventType)
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'invoices' },
      (payload: { new: Record<string, unknown> | null; old: Record<string, unknown> | null; eventType: string }) => {
        const row = (payload.new ?? payload.old) as Record<string, unknown>
        if (row) applyInvoiceRow(store, row, payload.eventType)
      }
    )
    .subscribe((status: string) => {
      const live = status === 'SUBSCRIBED'
      onStatus?.(live)
      if (live) void runCloudSync(store, true)
    })

  const pollId = window.setInterval(() => {
    if (document.visibilityState === 'visible') void runCloudSync(store, true)
  }, POLL_MS)

  const onVisible = () => {
    if (document.visibilityState === 'visible') void runCloudSync(store, true)
  }
  document.addEventListener('visibilitychange', onVisible)

  return () => {
    window.clearInterval(pollId)
    document.removeEventListener('visibilitychange', onVisible)
    void sb.removeChannel(channel)
  }
}
