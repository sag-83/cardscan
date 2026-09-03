import type { SavedInvoice } from '../types/invoice'

/** Reminders land at 10am local so they never fire at odd hours. */
export const REMINDER_HOUR = 10
/** How many days before the due date the first payment reminder fires. */
export const PRE_DUE_DAYS = 3

export const TERMS_PRESETS = [0, 30, 60, 90]

export function normalizeTermsDays(raw: unknown): number {
  const days = Math.round(Number(raw))
  if (!Number.isFinite(days) || days <= 0) return 0
  return Math.min(days, 365)
}

export function termsLabel(days: number): string {
  return normalizeTermsDays(days) > 0 ? `Net ${normalizeTermsDays(days)}` : 'COD'
}

/** Payment due moment: invoice date + terms, at 10am local. Null when no terms are set. */
export function invoiceDueAt(invoice: Pick<SavedInvoice, 'date' | 'termsDays'>): Date | null {
  const days = normalizeTermsDays(invoice.termsDays)
  if (days <= 0) return null
  const due = new Date(`${invoice.date}T00:00:00`)
  if (Number.isNaN(due.getTime())) return null
  due.setDate(due.getDate() + days)
  due.setHours(REMINDER_HOUR, 0, 0, 0)
  return due
}

export function formatDueDate(due: Date): string {
  return due.toLocaleDateString('en-US')
}

/** Due date as shown on the invoice, or empty when the invoice has no terms. */
export function dueDateLabel(invoice: Pick<SavedInvoice, 'date' | 'termsDays'>): string {
  const due = invoiceDueAt(invoice)
  return due ? formatDueDate(due) : ''
}

/** Only unpaid sales invoices chase payment — memos and settled invoices never do. */
export function isAwaitingPayment(invoice: SavedInvoice): boolean {
  return invoice.docKind === 'invoice' && invoice.paidBy === 'pending'
}
