export type SavedInvoiceItem = {
  size: string
  pcs: number
  ct: number
  pct: number
  amount: number
}

export type SavedInvoice = {
  id: string
  contactId: string
  company: string
  contactName: string
  state: string
  city: string
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
