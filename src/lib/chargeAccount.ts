import type {
  ChargeInvoice,
  ChargeInvoiceItem,
  ChargePayment,
  ContactBalanceRow,
  LedgerInvoiceEntry,
  LedgerPaymentEntry,
} from '../types/chargeAccount'
import type { Contact } from '../types/contact'
import type { SavedInvoice, SavedInvoiceItem } from '../types/invoice'
import { uid } from './utils'
import { ensureSupabaseClient } from './supabase'

const IMPORT_INVOICE_PREFIX = 'imp-sales-'
const IMPORT_PAYMENT_PREFIX = 'imp-sales-pay-'

/** Balance above this is shown in red on the dashboard. */
export const LARGE_BALANCE_THRESHOLD = 5_000

export const CHARGE_ACCOUNT_SCHEMA_SQL = `
-- Charge accounts (AR) — separate from sales \`invoices\` (memos / pending payments)
create table if not exists charge_invoices (
  id text primary key,
  contact_id text not null references contacts(id) on delete cascade,
  date text not null default '',
  total numeric not null default 0,
  note text default '',
  created_at timestamptz default now()
);

create table if not exists charge_invoice_items (
  id text primary key,
  invoice_id text not null references charge_invoices(id) on delete cascade,
  item_name text not null default '',
  quantity numeric not null default 1,
  unit_price numeric not null default 0
);

create table if not exists charge_payments (
  id text primary key,
  contact_id text not null references contacts(id) on delete cascade,
  amount numeric not null default 0,
  date text not null default '',
  note text default '',
  created_at timestamptz default now()
);

alter table charge_invoices disable row level security;
alter table charge_invoice_items disable row level security;
alter table charge_payments disable row level security;

create index if not exists charge_invoices_contact_id_idx on charge_invoices (contact_id);
create index if not exists charge_payments_contact_id_idx on charge_payments (contact_id);
create index if not exists charge_invoice_items_invoice_id_idx on charge_invoice_items (invoice_id);

do $$ begin
  alter publication supabase_realtime add table charge_invoices;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table charge_payments;
exception when duplicate_object then null;
end $$;
`

function mapInvoiceRow(r: Record<string, unknown>): ChargeInvoice {
  return {
    id: String(r.id),
    contact_id: String(r.contact_id),
    date: String(r.date ?? ''),
    total: Number(r.total ?? 0),
    note: String(r.note ?? ''),
    created_at: String(r.created_at ?? ''),
  }
}

function mapItemRow(r: Record<string, unknown>): ChargeInvoiceItem {
  return {
    id: String(r.id),
    invoice_id: String(r.invoice_id),
    item_name: String(r.item_name ?? ''),
    quantity: Number(r.quantity ?? 0),
    unit_price: Number(r.unit_price ?? 0),
  }
}

function mapPaymentRow(r: Record<string, unknown>): ChargePayment {
  return {
    id: String(r.id),
    contact_id: String(r.contact_id),
    amount: Number(r.amount ?? 0),
    date: String(r.date ?? ''),
    note: String(r.note ?? ''),
    created_at: String(r.created_at ?? ''),
  }
}

export function lineItemTotal(quantity: number, unitPrice: number): number {
  return Math.round(quantity * unitPrice * 100) / 100
}

export function sumLineItems(items: Pick<ChargeInvoiceItem, 'quantity' | 'unit_price'>[]): number {
  return Math.round(items.reduce((s, it) => s + lineItemTotal(it.quantity, it.unit_price), 0) * 100) / 100
}

export function resolveSalesInvoiceContactId(inv: SavedInvoice, contacts: Contact[]): string {
  if (inv.contactId) return inv.contactId
  const key = (inv.company || inv.contactName || '').trim().toUpperCase()
  if (!key) return ''
  const match = contacts.find((c) => {
    const company = (c.company || '').trim().toUpperCase()
    const name = (c.name || '').trim().toUpperCase()
    return company === key || name === key
  })
  return match?.id ?? ''
}

export function salesTotalsForContact(contactId: string, salesInvoices: SavedInvoice[], contacts: Contact[]) {
  let invoiceTotal = 0
  let paymentTotal = 0
  let pendingCount = 0
  for (const inv of salesInvoices) {
    const cid = resolveSalesInvoiceContactId(inv, contacts)
    if (cid !== contactId) continue
    if (inv.docKind === 'memo') continue
    invoiceTotal += Number(inv.total)
    if (inv.paidBy === 'pending') pendingCount += 1
    else paymentTotal += Number(inv.total)
  }
  return { invoiceTotal, paymentTotal, pendingCount }
}

export function computeContactBalance(
  contactId: string,
  invoices: ChargeInvoice[],
  payments: ChargePayment[],
  salesInvoices: SavedInvoice[] = [],
  contacts: Contact[] = [],
): number {
  const chargeInv = invoices
    .filter((i) => i.contact_id === contactId)
    .reduce((s, i) => s + Number(i.total), 0)
  const chargePay = payments
    .filter((p) => p.contact_id === contactId)
    .reduce((s, p) => s + Number(p.amount), 0)
  const sales = salesTotalsForContact(contactId, salesInvoices, contacts)
  return Math.round((chargeInv + sales.invoiceTotal - chargePay - sales.paymentTotal) * 100) / 100
}

export type BalanceTone = 'zero' | 'owed' | 'large'

export function balanceTone(balance: number): BalanceTone {
  if (balance <= 0) return 'zero'
  if (balance >= LARGE_BALANCE_THRESHOLD) return 'large'
  return 'owed'
}

export function contactLabel(c: Contact): string {
  return (c.company || c.name || 'Unknown').trim()
}

export function buildContactBalanceRows(
  contacts: Contact[],
  invoices: ChargeInvoice[],
  payments: ChargePayment[],
  salesInvoices: SavedInvoice[] = [],
): ContactBalanceRow[] {
  const contactMap = new Map(contacts.map((c) => [c.id, c]))

  for (const inv of salesInvoices) {
    const cid = resolveSalesInvoiceContactId(inv, contacts)
    if (cid && !contactMap.has(cid)) {
      contactMap.set(cid, {
        id: cid,
        name: inv.contactName,
        company: inv.company,
        city: inv.city,
        state: inv.state,
      } as Contact)
    }
  }

  return Array.from(contactMap.values())
    .map((c) => {
      const chargeInvoiceTotal = invoices
        .filter((i) => i.contact_id === c.id)
        .reduce((s, i) => s + Number(i.total), 0)
      const chargePaymentTotal = payments
        .filter((p) => p.contact_id === c.id)
        .reduce((s, p) => s + Number(p.amount), 0)
      const sales = salesTotalsForContact(c.id, salesInvoices, contacts)
      const invoiceTotal = chargeInvoiceTotal + sales.invoiceTotal
      const paymentTotal = chargePaymentTotal + sales.paymentTotal
      return {
        contactId: c.id,
        name: c.name,
        company: c.company,
        city: c.city,
        state: c.state,
        balance: Math.round((invoiceTotal - paymentTotal) * 100) / 100,
        invoiceTotal,
        paymentTotal,
        chargeInvoiceTotal,
        chargePaymentTotal,
        salesInvoiceTotal: sales.invoiceTotal,
        salesPaymentTotal: sales.paymentTotal,
        salesPendingCount: sales.pendingCount,
      }
    })
    .sort((a, b) => {
      const byBalance = b.balance - a.balance
      if (byBalance !== 0) return byBalance
      const na = (a.company || a.name || '').toUpperCase()
      const nb = (b.company || b.name || '').toUpperCase()
      return na.localeCompare(nb)
    })
}

export type AccountListFilter = 'owing' | 'activity' | 'all'

export function filterBalanceRows(
  rows: ContactBalanceRow[],
  filter: AccountListFilter,
): ContactBalanceRow[] {
  if (filter === 'all') return rows
  if (filter === 'owing') return rows.filter((r) => r.balance > 0.005)
  return rows.filter(
    (r) => r.invoiceTotal > 0 || r.paymentTotal > 0 || r.chargeInvoiceTotal > 0 || r.salesInvoiceTotal > 0,
  )
}

function mapSalesItemLines(items: SavedInvoiceItem[]) {
  return items.map((it) => {
    const qty = it.pcs > 0 ? it.pcs : 1
    const unit = qty > 0 ? it.amount / qty : it.amount
    const label = [it.size, it.pcs ? `${it.pcs} pcs` : '', it.ct ? `${it.ct} ct` : ''].filter(Boolean).join(' · ') || 'Line item'
    return { label, quantity: qty, unit_price: unit, lineTotal: it.amount }
  })
}

export function getMergedInvoicesForContact(
  contactId: string,
  chargeInvoices: ChargeInvoice[],
  salesInvoices: SavedInvoice[],
  contacts: Contact[],
): LedgerInvoiceEntry[] {
  const charge: LedgerInvoiceEntry[] = chargeInvoices
    .filter((i) => i.contact_id === contactId)
    .map((i) => ({
      id: i.id,
      source: 'charge' as const,
      date: i.date,
      total: i.total,
      note: i.note,
      items: (i.items ?? []).map((it) => ({
        label: it.item_name,
        quantity: it.quantity,
        unit_price: it.unit_price,
        lineTotal: lineItemTotal(it.quantity, it.unit_price),
      })),
    }))

  const sales: LedgerInvoiceEntry[] = salesInvoices
    .filter((inv) => resolveSalesInvoiceContactId(inv, contacts) === contactId)
    .map((inv) => ({
      id: inv.id,
      source: 'sales' as const,
      date: inv.date,
      total: inv.total,
      note: inv.notes || (inv.docKind === 'memo' ? 'Memo' : ''),
      status: inv.docKind === 'memo' ? 'memo' : inv.paidBy,
      items: mapSalesItemLines(inv.items ?? []),
    }))

  return [...charge, ...sales].sort((a, b) => b.date.localeCompare(a.date))
}

export function getMergedPaymentsForContact(
  contactId: string,
  chargePayments: ChargePayment[],
  salesInvoices: SavedInvoice[],
  contacts: Contact[],
): LedgerPaymentEntry[] {
  const charge: LedgerPaymentEntry[] = chargePayments
    .filter((p) => p.contact_id === contactId)
    .map((p) => ({
      id: p.id,
      source: 'charge' as const,
      date: p.date,
      amount: p.amount,
      note: p.note,
    }))

  const sales: LedgerPaymentEntry[] = salesInvoices
    .filter((inv) => resolveSalesInvoiceContactId(inv, contacts) === contactId)
    .filter((inv) => inv.docKind !== 'memo' && inv.paidBy !== 'pending')
    .map((inv) => ({
      id: `sales-pay-${inv.id}`,
      source: 'sales' as const,
      date: inv.date,
      amount: inv.total,
      note: `Sales invoice · ${inv.paidBy}`,
    }))

  return [...charge, ...sales].sort((a, b) => b.date.localeCompare(a.date))
}

export async function importSalesInvoicesToChargeLedger(
  salesInvoices: SavedInvoice[],
  contacts: Contact[],
): Promise<{ imported: number; payments: number; skipped: number }> {
  const sb = ensureSupabaseClient()
  if (!sb) throw new Error('Supabase is not configured')

  const existing = await fetchChargeAccountData()
  const existingIds = new Set(existing.invoices.map((i) => i.id))

  let imported = 0
  let payments = 0
  let skipped = 0

  for (const inv of salesInvoices) {
    if (inv.docKind === 'memo') {
      skipped += 1
      continue
    }
    const contactId = resolveSalesInvoiceContactId(inv, contacts)
    if (!contactId) {
      skipped += 1
      continue
    }

    const chargeId = `${IMPORT_INVOICE_PREFIX}${inv.id}`
    if (existingIds.has(chargeId)) {
      skipped += 1
      continue
    }

    const items = (inv.items ?? []).map((it) => {
      const qty = it.pcs > 0 ? it.pcs : 1
      const unit = qty > 0 ? it.amount / qty : it.amount
      const name = [it.size, it.pcs ? `${it.pcs} pcs` : '', it.ct ? `${it.ct} ct` : ''].filter(Boolean).join(' · ') || 'Line item'
      return { item_name: name, quantity: qty, unit_price: Math.round(unit * 100) / 100 }
    })

    if (!items.length && inv.total > 0) {
      items.push({ item_name: 'Imported sales invoice', quantity: 1, unit_price: inv.total })
    }

    const created_at = inv.saved_at || new Date().toISOString()
    const note = [inv.notes, `Imported from sales invoice ${inv.id}`].filter(Boolean).join(' · ')

    const { error: invErr } = await sb.from('charge_invoices').insert({
      id: chargeId,
      contact_id: contactId,
      date: inv.date,
      total: inv.total,
      note,
      created_at,
    })
    if (invErr) throw new Error(invErr.message)

    if (items.length) {
      const { error: itemsErr } = await sb.from('charge_invoice_items').insert(
        items.map((it) => ({
          id: uid(),
          invoice_id: chargeId,
          item_name: it.item_name,
          quantity: it.quantity,
          unit_price: it.unit_price,
        })),
      )
      if (itemsErr) throw new Error(itemsErr.message)
    }

    existingIds.add(chargeId)
    imported += 1

    if (inv.paidBy !== 'pending') {
      const payId = `${IMPORT_PAYMENT_PREFIX}${inv.id}`
      const { error: payErr } = await sb.from('charge_payments').insert({
        id: payId,
        contact_id: contactId,
        amount: inv.total,
        date: inv.date,
        note: `Imported · paid ${inv.paidBy}`,
        created_at,
      })
      if (payErr && !payErr.message.includes('duplicate')) throw new Error(payErr.message)
      else payments += 1
    }
  }

  return { imported, payments, skipped }
}

export async function fetchChargeAccountData(): Promise<{
  invoices: ChargeInvoice[]
  payments: ChargePayment[]
}> {
  const sb = ensureSupabaseClient()
  if (!sb) throw new Error('Supabase is not configured')

  const [invRes, payRes, itemsRes] = await Promise.all([
    sb.from('charge_invoices').select('*').order('date', { ascending: false }),
    sb.from('charge_payments').select('*').order('date', { ascending: false }),
    sb.from('charge_invoice_items').select('*'),
  ])

  if (invRes.error) throw new Error(invRes.error.message)
  if (payRes.error) throw new Error(payRes.error.message)
  if (itemsRes.error) throw new Error(itemsRes.error.message)

  const itemsByInvoice = new Map<string, ChargeInvoiceItem[]>()
  for (const row of itemsRes.data ?? []) {
    const item = mapItemRow(row as Record<string, unknown>)
    const list = itemsByInvoice.get(item.invoice_id) ?? []
    list.push(item)
    itemsByInvoice.set(item.invoice_id, list)
  }

  const invoices = (invRes.data ?? []).map((row) => {
    const inv = mapInvoiceRow(row as Record<string, unknown>)
    return { ...inv, items: itemsByInvoice.get(inv.id) ?? [] }
  })

  const payments = (payRes.data ?? []).map((row) => mapPaymentRow(row as Record<string, unknown>))

  return { invoices, payments }
}

export type NewChargeLineItem = {
  item_name: string
  quantity: number
  unit_price: number
}

export async function createChargeInvoice(input: {
  contact_id: string
  date: string
  note: string
  items: NewChargeLineItem[]
}): Promise<ChargeInvoice> {
  const sb = ensureSupabaseClient()
  if (!sb) throw new Error('Supabase is not configured')

  const id = uid()
  const created_at = new Date().toISOString()
  const total = sumLineItems(input.items)
  const date = input.date || created_at.slice(0, 10)

  const { error: invErr } = await sb.from('charge_invoices').insert({
    id,
    contact_id: input.contact_id,
    date,
    total,
    note: input.note ?? '',
    created_at,
  })
  if (invErr) throw new Error(invErr.message)

  const items: ChargeInvoiceItem[] = input.items
    .filter((it) => it.item_name.trim())
    .map((it) => ({
      id: uid(),
      invoice_id: id,
      item_name: it.item_name.trim(),
      quantity: Number(it.quantity) || 0,
      unit_price: Number(it.unit_price) || 0,
    }))

  if (items.length) {
    const { error: itemsErr } = await sb.from('charge_invoice_items').insert(
      items.map((it) => ({
        id: it.id,
        invoice_id: it.invoice_id,
        item_name: it.item_name,
        quantity: it.quantity,
        unit_price: it.unit_price,
      })),
    )
    if (itemsErr) throw new Error(itemsErr.message)
  }

  return { id, contact_id: input.contact_id, date, total, note: input.note ?? '', created_at, items }
}

export async function createChargePayment(input: {
  contact_id: string
  amount: number
  date: string
  note: string
}): Promise<ChargePayment> {
  const sb = ensureSupabaseClient()
  if (!sb) throw new Error('Supabase is not configured')

  const id = uid()
  const created_at = new Date().toISOString()
  const payment: ChargePayment = {
    id,
    contact_id: input.contact_id,
    amount: Math.round(Number(input.amount) * 100) / 100,
    date: input.date || created_at.slice(0, 10),
    note: input.note ?? '',
    created_at,
  }

  const { error } = await sb.from('charge_payments').insert({
    id: payment.id,
    contact_id: payment.contact_id,
    amount: payment.amount,
    date: payment.date,
    note: payment.note,
    created_at: payment.created_at,
  })
  if (error) throw new Error(error.message)

  return payment
}

export async function updateChargeInvoice(
  invoiceId: string,
  input: {
    contact_id: string
    date: string
    note: string
    items: NewChargeLineItem[]
  },
): Promise<ChargeInvoice> {
  const sb = ensureSupabaseClient()
  if (!sb) throw new Error('Supabase is not configured')

  const total = sumLineItems(input.items)
  const date = input.date || new Date().toISOString().slice(0, 10)

  const { error: invErr } = await sb
    .from('charge_invoices')
    .update({
      contact_id: input.contact_id,
      date,
      total,
      note: input.note ?? '',
    })
    .eq('id', invoiceId)
  if (invErr) throw new Error(invErr.message)

  const { error: delErr } = await sb.from('charge_invoice_items').delete().eq('invoice_id', invoiceId)
  if (delErr) throw new Error(delErr.message)

  const items: ChargeInvoiceItem[] = input.items
    .filter((it) => it.item_name.trim())
    .map((it) => ({
      id: uid(),
      invoice_id: invoiceId,
      item_name: it.item_name.trim(),
      quantity: Number(it.quantity) || 0,
      unit_price: Number(it.unit_price) || 0,
    }))

  if (items.length) {
    const { error: itemsErr } = await sb.from('charge_invoice_items').insert(
      items.map((it) => ({
        id: it.id,
        invoice_id: it.invoice_id,
        item_name: it.item_name,
        quantity: it.quantity,
        unit_price: it.unit_price,
      })),
    )
    if (itemsErr) throw new Error(itemsErr.message)
  }

  return {
    id: invoiceId,
    contact_id: input.contact_id,
    date,
    total,
    note: input.note ?? '',
    created_at: new Date().toISOString(),
    items,
  }
}

export async function deleteChargeInvoice(invoiceId: string): Promise<void> {
  const sb = ensureSupabaseClient()
  if (!sb) throw new Error('Supabase is not configured')

  const { error: itemsErr } = await sb.from('charge_invoice_items').delete().eq('invoice_id', invoiceId)
  if (itemsErr) throw new Error(itemsErr.message)

  const { error: invErr } = await sb.from('charge_invoices').delete().eq('id', invoiceId)
  if (invErr) throw new Error(invErr.message)
}

export async function deleteChargePayment(paymentId: string): Promise<void> {
  const sb = ensureSupabaseClient()
  if (!sb) throw new Error('Supabase is not configured')

  const { error } = await sb.from('charge_payments').delete().eq('id', paymentId)
  if (error) throw new Error(error.message)
}
