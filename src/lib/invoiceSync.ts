import type { SavedInvoice } from '../types/invoice'
import {
  deleteInvoiceFromDB,
  saveInvoiceToDB,
  syncInvoicesFromDB,
} from './supabase'

const DELETED_IDS_KEY = 'cs_deleted_invoice_ids_v1'

export function getDeletedInvoiceIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DELETED_IDS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

function persistDeletedIds(ids: Set<string>): void {
  try {
    localStorage.setItem(DELETED_IDS_KEY, JSON.stringify([...ids]))
  } catch {
    /* ignore */
  }
}

export function recordInvoiceDeletion(id: string): void {
  const ids = getDeletedInvoiceIds()
  ids.add(id)
  persistDeletedIds(ids)
}

export function clearInvoiceDeletion(id: string): void {
  const ids = getDeletedInvoiceIds()
  if (!ids.delete(id)) return
  persistDeletedIds(ids)
}

/** Delete from Supabase first, then local store. Prevents sync/backup from resurrecting rows. */
export async function deleteInvoiceSynced(
  id: string,
  removeLocal: (id: string) => void,
): Promise<boolean> {
  const ok = await deleteInvoiceFromDB(id)
  if (!ok) return false
  recordInvoiceDeletion(id)
  removeLocal(id)
  return true
}

export async function saveInvoiceSynced(invoice: SavedInvoice): Promise<boolean> {
  const ok = await saveInvoiceToDB(invoice)
  if (ok) clearInvoiceDeletion(invoice.id)
  return ok
}

/** Retry deletes for invoices removed locally but still in cloud. */
export async function reconcileInvoiceDeletions(cloudInvoiceIds: string[]): Promise<number> {
  const deleted = getDeletedInvoiceIds()
  if (!deleted.size) return 0

  const cloudSet = new Set(cloudInvoiceIds)
  let removed = 0

  for (const id of deleted) {
    if (!cloudSet.has(id)) {
      clearInvoiceDeletion(id)
      continue
    }
    const ok = await deleteInvoiceFromDB(id)
    if (ok) {
      clearInvoiceDeletion(id)
      removed++
    }
  }

  return removed
}

/** Remove cloud invoices that are no longer in the local app (after backup / sync). */
export async function pruneOrphanInvoicesFromDB(keepIds: string[]): Promise<number> {
  const cloud = await syncInvoicesFromDB()
  const keep = new Set(keepIds)
  let pruned = 0

  for (const inv of cloud) {
    if (keep.has(inv.id)) continue
    const ok = await deleteInvoiceFromDB(inv.id)
    if (ok) {
      recordInvoiceDeletion(inv.id)
      pruned++
    }
  }

  return pruned
}
