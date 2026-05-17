/** Accounts receivable (charge account) — separate from sales SavedInvoice / `invoices` table. */

export type ChargeInvoiceItem = {
  id: string
  invoice_id: string
  item_name: string
  quantity: number
  unit_price: number
}

export type ChargeInvoice = {
  id: string
  contact_id: string
  date: string
  total: number
  note: string
  created_at: string
  items?: ChargeInvoiceItem[]
}

export type ChargePayment = {
  id: string
  contact_id: string
  amount: number
  date: string
  note: string
  created_at: string
}

export type ContactBalanceRow = {
  contactId: string
  name: string
  company: string
  city: string
  state: string
  balance: number
  invoiceTotal: number
  paymentTotal: number
  chargeInvoiceTotal: number
  chargePaymentTotal: number
  salesInvoiceTotal: number
  salesPaymentTotal: number
  salesPendingCount: number
}

export type LedgerInvoiceEntry = {
  id: string
  source: 'charge' | 'sales'
  date: string
  total: number
  note: string
  status?: 'pending' | 'cash' | 'check' | 'memo'
  items?: { label: string; quantity: number; unit_price: number; lineTotal: number }[]
}

export type LedgerPaymentEntry = {
  id: string
  source: 'charge' | 'sales'
  date: string
  amount: number
  note: string
}
