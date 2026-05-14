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
  items: SavedInvoiceItem[]
  total: number
  notes: string
  saved_at: string
}
