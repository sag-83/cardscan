import type { SavedInvoice } from '../types/invoice'

export type PaidBy = SavedInvoice['paidBy']

/** Map Supabase / legacy values to the three statuses the dashboard expects. */
export function normalizePaidBy(raw: unknown): PaidBy {
  const s = String(raw ?? '').trim().toLowerCase()
  if (s === 'cash') return 'cash'
  if (s === 'check') return 'check'
  return 'pending'
}
