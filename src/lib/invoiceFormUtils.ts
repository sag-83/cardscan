import type { SavedInvoice, SavedInvoiceItem } from '../types/invoice'
import type { Contact } from '../types/contact'

export type DocKind = 'invoice' | 'memo'
export type PaidBy = 'cash' | 'check' | 'pending'
export type SizePrefix = '' | 'DGC' | 'STD' | 'TNB' | 'TUB' | 'TUC' | 'LDW' | 'PRCL' | 'NTRL'

export type InvoiceFormItem = {
  id: string
  prefix: SizePrefix
  size: string
  pcs: string
  ct: string
  pct: string
  amount: string
}

export const SIZE_PREFIX_OPTIONS: { value: SizePrefix; label: string }[] = [
  { value: '', label: 'Prefix' },
  { value: 'DGC', label: 'DGC' },
  { value: 'STD', label: 'STD' },
  { value: 'TNB', label: 'TNB' },
  { value: 'TUB', label: 'TUB' },
  { value: 'TUC', label: 'TUC' },
  { value: 'LDW', label: 'LDW' },
  { value: 'PRCL', label: 'PRCL' },
  { value: 'NTRL', label: 'NTRL' },
]

export function uid(): string {
  return Math.random().toString(36).slice(2, 9)
}

export function num(value: string): number {
  const parsed = parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function money(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function rowTotal(item: InvoiceFormItem): number {
  if (item.amount.trim()) return num(item.amount)
  return num(item.ct) * num(item.pct)
}

export function displaySize(item: InvoiceFormItem): string {
  const combined = [item.prefix, item.size].filter(Boolean).join(' ')
  return combined.toUpperCase() || '-'
}

export function blankInvoiceItem(): InvoiceFormItem {
  return { id: uid(), prefix: '', size: '', pcs: '1', ct: '', pct: '', amount: '' }
}

export function buildSavedInvoice(
  contact: Contact,
  input: {
    docKind: DocKind
    invoiceDate: string
    paidBy: PaidBy
    notes: string
    items: InvoiceFormItem[]
    grandTotalOverride: string
  },
): SavedInvoice {
  const subtotal = input.items.reduce((sum, item) => sum + rowTotal(item), 0)
  const finalTotal = input.grandTotalOverride.trim() ? num(input.grandTotalOverride) : subtotal
  const savedItems: SavedInvoiceItem[] = input.items
    .filter((item) => rowTotal(item) > 0 || item.size.trim() || item.prefix)
    .map((item) => ({
      size: displaySize(item),
      pcs: num(item.pcs),
      ct: num(item.ct),
      pct: num(item.pct),
      amount: rowTotal(item),
    }))

  return {
    id: uid(),
    contactId: contact.id,
    company: contact.company || contact.name || '',
    contactName: contact.name || '',
    state: contact.state || '',
    city: contact.city || '',
    date: input.invoiceDate,
    docKind: input.docKind,
    paidBy: input.docKind === 'invoice' ? input.paidBy : 'pending',
    items: savedItems.length ? savedItems : [{ size: '-', pcs: 0, ct: 0, pct: 0, amount: finalTotal }],
    total: finalTotal,
    notes: input.notes,
    saved_at: new Date().toISOString(),
  }
}
