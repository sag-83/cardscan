export type SavedInvoiceItem = {
  size: string
  pcs: number
  ct: number
  pct: number
  amount: number
}

export type InvoiceDirection = 'sale' | 'purchase'

export type SavedInvoice = {
  id: string
  /** Human-facing sequential document number, e.g. "S1001" (Sale) or "P1001" (Purchase). */
  invoiceNumber?: string
  /** Sale or Purchase — drives the invoiceNumber prefix and series. */
  direction?: InvoiceDirection
  contactId: string
  company: string
  contactName: string
  state: string
  city: string
  /** Customer street address / zip / phone, captured at invoice time for the printed Bill To / Ship To block. */
  contactAddress?: string
  contactZip?: string
  contactPhone?: string
  date: string
  docKind: 'invoice' | 'memo'
  paidBy: 'cash' | 'check' | 'pending'
  /** Payment terms in days (30/60/90). 0 or absent means due on receipt. */
  termsDays?: number
  items: SavedInvoiceItem[]
  /** Flat shipping charge added on top of the line items. Always shown on the printed invoice, even when 0. */
  shipping?: number
  total: number
  notes: string
  saved_at: string
}
