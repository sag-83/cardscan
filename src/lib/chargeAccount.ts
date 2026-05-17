import type { ChargeInvoice, ChargeInvoiceItem, ChargePayment, ContactBalanceRow } from '../types/chargeAccount'
import type { Contact } from '../types/contact'
import { uid } from './utils'
import { ensureSupabaseClient } from './supabase'

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

export function computeContactBalance(
  contactId: string,
  invoices: ChargeInvoice[],
  payments: ChargePayment[],
): number {
  const inv = invoices
    .filter((i) => i.contact_id === contactId)
    .reduce((s, i) => s + Number(i.total), 0)
  const pay = payments
    .filter((p) => p.contact_id === contactId)
    .reduce((s, p) => s + Number(p.amount), 0)
  return Math.round((inv - pay) * 100) / 100
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
): ContactBalanceRow[] {
  return contacts
    .map((c) => {
      const invoiceTotal = invoices
        .filter((i) => i.contact_id === c.id)
        .reduce((s, i) => s + Number(i.total), 0)
      const paymentTotal = payments
        .filter((p) => p.contact_id === c.id)
        .reduce((s, p) => s + Number(p.amount), 0)
      return {
        contactId: c.id,
        name: c.name,
        company: c.company,
        city: c.city,
        state: c.state,
        balance: Math.round((invoiceTotal - paymentTotal) * 100) / 100,
        invoiceTotal,
        paymentTotal,
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
