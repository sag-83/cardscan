import type { InvoiceDirection, SavedInvoice, SavedInvoiceItem } from '../types/invoice'
import type { Contact, ContactAddress } from '../types/contact'
import { normalizeTermsDays } from './invoiceTerms'

export type { InvoiceDirection }

/** First number in every series — Sale invoices run S1000, S1001, … and Purchases P1000, P1001, … */
const INVOICE_NUMBER_START = 1000

export const DIRECTION_PREFIX: Record<InvoiceDirection, string> = { sale: 'S', purchase: 'P' }

export const DIRECTION_OPTIONS: { value: InvoiceDirection; label: string }[] = [
  { value: 'sale', label: 'Sale' },
  { value: 'purchase', label: 'Purchase' },
]

/**
 * Document-number prefix. Memos run a completely separate series from invoices
 * so a consignment memo can never share a number with a real (billed) invoice:
 *   sale invoice  → S…     sale memo     → M…
 *   purchase inv. → P…     purchase memo → PM…
 */
export function documentPrefix(direction: InvoiceDirection, docKind: 'invoice' | 'memo'): string {
  if (docKind === 'memo') return direction === 'purchase' ? 'PM' : 'M'
  return DIRECTION_PREFIX[direction]
}

/** Next free number in this document's own series, one past the highest already used. */
export function nextInvoiceNumber(
  direction: InvoiceDirection,
  docKind: 'invoice' | 'memo',
  existing: SavedInvoice[],
): string {
  const prefix = documentPrefix(direction, docKind)
  const pattern = new RegExp(`^${prefix}(\\d+)$`)
  let highest = INVOICE_NUMBER_START - 1
  for (const inv of existing) {
    const match = inv.invoiceNumber?.match(pattern)
    if (!match) continue
    const value = parseInt(match[1], 10)
    if (Number.isFinite(value) && value > highest) highest = value
  }
  return `${prefix}${highest + 1}`
}

const EMPTY_CONTACT_FIELDS = {
  title: '',
  email: '',
  extra_emails: [] as string[],
  phone_mobile: '',
  phone_work: '',
  phone_fax: '',
  extra_phones: [] as string[],
  website: '',
  instagram: '',
  social_media: {} as Record<string, string>,
  address: '',
  zip: '',
  country: '',
  extra_addresses: [] as ContactAddress[],
  area: '',
  notes: '',
  user_notes: '',
  back_notes: '',
  stars: 0,
  front_image: '',
  back_image: '',
  front_image_url: '',
  front_thumb_url: '',
  back_image_url: '',
  sent_to_sheets: false,
  visited: false,
  is_customer: false,
  is_old_customer: false,
} as const

/** Minimal contact for editing an invoice on the web dashboard when full contact row is unavailable. */
export function contactStubFromInvoice(inv: SavedInvoice): Contact {
  return {
    id: inv.contactId,
    name: inv.contactName || '',
    company: inv.company || '',
    city: inv.city || '',
    state: inv.state || '',
    scanned_at: inv.saved_at || '',
    created_at: inv.saved_at || '',
    ...EMPTY_CONTACT_FIELDS,
    address: inv.contactAddress || '',
    zip: inv.contactZip || '',
    phone_mobile: inv.contactPhone || '',
  }
}

export type DocKind = 'invoice' | 'memo'
export type PaidBy = 'cash' | 'check' | 'pending'
export type SizePrefix = '' | 'DGC' | 'STD' | 'TNB' | 'TUB' | 'TUC' | 'LDW' | 'PRCL' | 'NTRL' | 'JEW' | 'LAB' | 'TNC'

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
  { value: 'JEW', label: 'JEW' },
  { value: 'LAB', label: 'LAB' },
  { value: 'TNC', label: 'TNC' },
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

export type InvoiceFormInput = {
  docKind: DocKind
  direction: InvoiceDirection
  invoiceDate: string
  paidBy: PaidBy
  termsDays: number
  notes: string
  items: InvoiceFormItem[]
  shipping: string
  /** Signed manual adjustment (round off) added on top of subtotal + shipping. */
  roundOff: string
}

function buildSavedInvoiceCore(
  contact: Contact,
  input: InvoiceFormInput,
): Omit<SavedInvoice, 'id' | 'saved_at' | 'invoiceNumber'> {
  const subtotal = input.items.reduce((sum, item) => sum + rowTotal(item), 0)
  const shippingAmount = num(input.shipping)
  const finalTotal = subtotal + shippingAmount + num(input.roundOff)
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
    contactId: contact.id,
    company: contact.company || contact.name || '',
    contactName: contact.name || '',
    state: contact.state || '',
    city: contact.city || '',
    contactAddress: contact.address || '',
    contactZip: contact.zip || '',
    contactPhone: contact.phone_mobile || contact.phone_work || '',
    direction: input.direction,
    date: input.invoiceDate,
    docKind: input.docKind,
    paidBy: input.docKind === 'invoice' ? input.paidBy : 'pending',
    termsDays: input.docKind === 'invoice' ? normalizeTermsDays(input.termsDays) : 0,
    items: savedItems.length ? savedItems : [{ size: '-', pcs: 0, ct: 0, pct: 0, amount: finalTotal }],
    shipping: shippingAmount,
    total: finalTotal,
    notes: input.notes,
  }
}

export function buildSavedInvoice(
  contact: Contact,
  input: InvoiceFormInput,
  existingInvoices: SavedInvoice[] = [],
): SavedInvoice {
  return {
    id: uid(),
    saved_at: new Date().toISOString(),
    invoiceNumber: nextInvoiceNumber(input.direction, input.docKind, existingInvoices),
    ...buildSavedInvoiceCore(contact, input),
  }
}

export function buildSavedInvoiceUpdate(
  contact: Contact,
  existing: SavedInvoice,
  input: InvoiceFormInput,
): SavedInvoice {
  return {
    id: existing.id,
    saved_at: new Date().toISOString(),
    invoiceNumber: existing.invoiceNumber,
    ...buildSavedInvoiceCore(contact, input),
  }
}

/** Reverse SavedInvoice line → editable form row (for web dashboard edit). */
export function savedItemToFormItem(item: SavedInvoiceItem): InvoiceFormItem {
  const sizeStr = (item.size || '').trim()
  let prefix: SizePrefix = ''
  let size = sizeStr
  for (const opt of SIZE_PREFIX_OPTIONS) {
    if (!opt.value) continue
    if (sizeStr === opt.value || sizeStr.startsWith(`${opt.value} `)) {
      prefix = opt.value
      size = sizeStr.slice(opt.value.length).trim()
      break
    }
  }
  return {
    id: uid(),
    prefix,
    size,
    pcs: String(item.pcs ?? 1),
    ct: item.ct ? String(item.ct) : '',
    pct: item.pct ? String(item.pct) : '',
    amount: item.amount ? String(item.amount) : '',
  }
}

/** Reverse the stored total back into the signed round-off adjustment for editing. */
export function roundOffFromInvoice(invoice: SavedInvoice): string {
  const lineSum = (invoice.items ?? []).reduce((s, it) => s + it.amount, 0) + (invoice.shipping ?? 0)
  const delta = Math.round((invoice.total - lineSum) * 100) / 100
  return Math.abs(delta) < 0.005 ? '' : String(delta)
}
