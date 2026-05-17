import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronLeft,
  Loader2,
  Plus,
  Receipt,
  Wallet,
  X,
} from 'lucide-react'
import { useStore } from '../../store/useStore'
import { syncContactsFromDB } from '../../lib/supabase'
import {
  balanceTone,
  buildContactBalanceRows,
  computeContactBalance,
  contactLabel,
  createChargeInvoice,
  createChargePayment,
  fetchChargeAccountData,
  filterBalanceRows,
  getMergedInvoicesForContact,
  getMergedPaymentsForContact,
  importSalesInvoicesToChargeLedger,
  LARGE_BALANCE_THRESHOLD,
  lineItemTotal,
  sumLineItems,
  type AccountListFilter,
  type NewChargeLineItem,
} from '../../lib/chargeAccount'
import type { ChargeInvoice, ChargePayment, ContactBalanceRow, LedgerInvoiceEntry } from '../../types/chargeAccount'
import type { Contact } from '../../types/contact'
import type { SavedInvoice } from '../../types/invoice'
import { cn } from '../../lib/utils'

function money(v: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(v)
}

function balanceClasses(tone: ReturnType<typeof balanceTone>) {
  if (tone === 'large') return 'text-red-600 dark:text-red-400 font-extrabold'
  if (tone === 'owed') return 'text-amber-600 dark:text-amber-400 font-bold'
  return 'text-slate-400 dark:text-slate-500 font-semibold'
}

type DraftLine = { item_name: string; quantity: string; unit_price: string }

const emptyLine = (): DraftLine => ({ item_name: '', quantity: '1', unit_price: '' })

const FILTER_TABS: { id: AccountListFilter; label: string }[] = [
  { id: 'owing', label: 'Owing' },
  { id: 'activity', label: 'With activity' },
  { id: 'all', label: 'All contacts' },
]

export function AccountsReceivable({
  salesInvoices,
  onOutstandingCount,
}: {
  salesInvoices: SavedInvoice[]
  onOutstandingCount?: (count: number) => void
}) {
  const contacts = useStore((s) => s.contacts)
  const setContacts = useStore((s) => s.setContacts)
  const chargeInvoices = useStore((s) => s.chargeInvoices)
  const chargePayments = useStore((s) => s.chargePayments)
  const setChargeInvoices = useStore((s) => s.setChargeInvoices)
  const setChargePayments = useStore((s) => s.setChargePayments)
  const addChargeInvoice = useStore((s) => s.addChargeInvoice)
  const addChargePayment = useStore((s) => s.addChargePayment)

  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [listFilter, setListFilter] = useState<AccountListFilter>('owing')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [expandedInv, setExpandedInv] = useState<Set<string>>(() => new Set())

  const [invoiceOpen, setInvoiceOpen] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const salesCount = useMemo(
    () => salesInvoices.filter((i) => i.docKind !== 'memo').length,
    [salesInvoices],
  )

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [cloudContacts, charge] = await Promise.all([
        syncContactsFromDB(),
        fetchChargeAccountData(),
      ])
      setContacts(cloudContacts)
      setChargeInvoices(charge.invoices)
      setChargePayments(charge.payments)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [setContacts, setChargeInvoices, setChargePayments])

  useEffect(() => {
    void reload()
  }, [reload])

  const contactById = useMemo(() => {
    const m = new Map<string, Contact>()
    contacts.forEach((c) => m.set(c.id, c))
    return m
  }, [contacts])

  const allRows = useMemo(
    () => buildContactBalanceRows(contacts, chargeInvoices, chargePayments, salesInvoices),
    [contacts, chargeInvoices, chargePayments, salesInvoices],
  )

  const filteredRows = useMemo(() => {
    let list = filterBalanceRows(allRows, listFilter)
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter((r) => {
      const c = contactById.get(r.contactId)
      const label = (r.company || r.name || '').toLowerCase()
      const extra = [r.city, r.state, c?.email].filter(Boolean).join(' ').toLowerCase()
      return label.includes(q) || extra.includes(q)
    })
  }, [allRows, listFilter, search, contactById])

  const outstandingCount = useMemo(
    () => allRows.filter((r) => r.balance > 0).length,
    [allRows],
  )

  const totalOwed = useMemo(
    () => allRows.reduce((s, r) => s + Math.max(0, r.balance), 0),
    [allRows],
  )

  useEffect(() => {
    onOutstandingCount?.(outstandingCount)
  }, [outstandingCount, onOutstandingCount])

  const selectedContact = selectedId ? contactById.get(selectedId) : undefined
  const selectedBalance = selectedId
    ? computeContactBalance(selectedId, chargeInvoices, chargePayments, salesInvoices, contacts)
    : 0

  const contactInvoices = useMemo(
    () =>
      selectedId
        ? getMergedInvoicesForContact(selectedId, chargeInvoices, salesInvoices, contacts)
        : [],
    [selectedId, chargeInvoices, salesInvoices, contacts],
  )

  const contactPayments = useMemo(
    () =>
      selectedId
        ? getMergedPaymentsForContact(selectedId, chargePayments, salesInvoices, contacts)
        : [],
    [selectedId, chargePayments, salesInvoices, contacts],
  )

  const handleImportSales = async () => {
    setImporting(true)
    setError('')
    try {
      const result = await importSalesInvoicesToChargeLedger(salesInvoices, contacts)
      await reload()
      setError('')
      alert(
        `Imported ${result.imported} invoice(s) and ${result.payments} payment(s). Skipped ${result.skipped}. Balances now use your sales history.`,
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setImporting(false)
    }
  }

  const handleCreateInvoice = async (payload: {
    date: string
    note: string
    items: NewChargeLineItem[]
  }) => {
    if (!selectedId) return
    setSaving(true)
    try {
      const inv = await createChargeInvoice({
        contact_id: selectedId,
        date: payload.date,
        note: payload.note,
        items: payload.items,
      })
      addChargeInvoice(inv)
      setInvoiceOpen(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleCreatePayment = async (payload: { date: string; amount: number; note: string }) => {
    if (!selectedId) return
    setSaving(true)
    try {
      const pay = await createChargePayment({
        contact_id: selectedId,
        amount: payload.amount,
        date: payload.date,
        note: payload.note,
      })
      addChargePayment(pay)
      setPaymentOpen(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (loading && !contacts.length) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
        <Loader2 className="size-5 animate-spin" aria-hidden />
        Loading charge accounts…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-300">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} className="shrink-0 opacity-70 hover:opacity-100" aria-label="Dismiss">
            <X className="size-4" />
          </button>
        </div>
      )}

      {salesCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-100 bg-indigo-50/80 px-4 py-3 text-sm dark:border-indigo-500/25 dark:bg-indigo-500/10">
          <p className="text-indigo-900 dark:text-indigo-200">
            <strong>{salesCount} sales invoices</strong> from the app are included in balances automatically.
            Pending = amount still owed; cash/check = already paid.
          </p>
          {chargeInvoices.length === 0 && (
            <button
              type="button"
              disabled={importing}
              onClick={() => void handleImportSales()}
              className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {importing ? 'Importing…' : 'Copy to charge ledger'}
            </button>
          )}
        </div>
      )}

      {!selectedId ? (
        <AccountsList
          rows={filteredRows}
          allRowCount={allRows.length}
          search={search}
          onSearch={setSearch}
          listFilter={listFilter}
          onListFilter={setListFilter}
          onSelect={setSelectedId}
          onRefresh={() => void reload()}
          loading={loading}
          outstandingCount={outstandingCount}
          totalOwed={totalOwed}
        />
      ) : selectedContact ? (
        <ContactLedger
          contact={selectedContact}
          balance={selectedBalance}
          invoices={contactInvoices}
          payments={contactPayments}
          expandedInv={expandedInv}
          onToggleInv={(id) =>
            setExpandedInv((prev) => {
              const next = new Set(prev)
              if (next.has(id)) next.delete(id)
              else next.add(id)
              return next
            })
          }
          onBack={() => setSelectedId(null)}
          onAddInvoice={() => setInvoiceOpen(true)}
          onLogPayment={() => setPaymentOpen(true)}
        />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
          Contact not found.
          <button type="button" className="ml-2 font-semibold text-indigo-600" onClick={() => setSelectedId(null)}>
            Back
          </button>
        </div>
      )}

      {invoiceOpen && selectedContact && (
        <AddInvoiceModal
          contact={selectedContact}
          saving={saving}
          onClose={() => setInvoiceOpen(false)}
          onSubmit={handleCreateInvoice}
        />
      )}

      {paymentOpen && selectedContact && (
        <LogPaymentModal
          contact={selectedContact}
          balance={selectedBalance}
          saving={saving}
          onClose={() => setPaymentOpen(false)}
          onSubmit={handleCreatePayment}
        />
      )}
    </div>
  )
}

function AccountsList({
  rows,
  allRowCount,
  search,
  onSearch,
  listFilter,
  onListFilter,
  onSelect,
  onRefresh,
  loading,
  outstandingCount,
  totalOwed,
}: {
  rows: ContactBalanceRow[]
  allRowCount: number
  search: string
  onSearch: (v: string) => void
  listFilter: AccountListFilter
  onListFilter: (f: AccountListFilter) => void
  onSelect: (id: string) => void
  onRefresh: () => void
  loading: boolean
  outstandingCount: number
  totalOwed: number
}) {
  const topOwing = rows.filter((r) => r.balance > 0).slice(0, 6)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="Total outstanding" value={money(totalOwed)} accent="amber" />
        <SummaryCard label="Accounts owing" value={String(outstandingCount)} accent="indigo" />
        <SummaryCard label="Shown" value={String(rows.length)} sub={`of ${allRowCount} contacts`} />
        <SummaryCard label="Red flag" value={money(LARGE_BALANCE_THRESHOLD)} sub="balance threshold" />
      </div>

      {topOwing.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {topOwing.map((r) => (
            <button
              key={r.contactId}
              type="button"
              onClick={() => onSelect(r.contactId)}
              className={cn(
                'min-w-[140px] shrink-0 rounded-xl border px-3 py-2 text-left transition hover:ring-2 hover:ring-indigo-500/30',
                balanceTone(r.balance) === 'large'
                  ? 'border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10'
                  : 'border-amber-200 bg-amber-50 dark:border-amber-500/25 dark:bg-amber-500/10',
              )}
            >
              <div className="truncate text-[11px] font-bold uppercase text-slate-700 dark:text-slate-200">
                {(r.company || r.name || '?').slice(0, 22)}
              </div>
              <div className={cn('mt-1 text-lg tabular-nums', balanceClasses(balanceTone(r.balance)))}>
                {money(r.balance)}
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <div className="flex flex-wrap gap-1">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => onListFilter(tab.id)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-xs font-bold transition',
                  listFilter === tab.id
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800',
                )}
              >
                {tab.label}
                {tab.id === 'owing' && outstandingCount > 0 && (
                  <span className="ml-1 opacity-80">({outstandingCount})</span>
                )}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="search"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Search shop…"
              className="w-40 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-800"
            />
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold disabled:opacity-50 dark:border-slate-700"
            >
              {loading ? '…' : 'Refresh'}
            </button>
          </div>
        </div>

        {!rows.length ? (
          <p className="px-4 py-12 text-center text-sm text-slate-400">
            {listFilter === 'owing'
              ? 'No outstanding balances — switch to “With activity” or search a shop.'
              : 'No matches.'}
          </p>
        ) : (
          <div className="max-h-[min(52vh,520px)] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2.5">Shop</th>
                  <th className="hidden px-2 py-2.5 sm:table-cell">Location</th>
                  <th className="px-2 py-2.5 text-right">Invoiced</th>
                  <th className="px-2 py-2.5 text-right">Paid</th>
                  <th className="px-4 py-2.5 text-right">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rows.map((row) => {
                  const tone = balanceTone(row.balance)
                  return (
                    <tr
                      key={row.contactId}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelect(row.contactId)}
                      onKeyDown={(e) => e.key === 'Enter' && onSelect(row.contactId)}
                      className={cn(
                        'cursor-pointer transition hover:bg-slate-50 dark:hover:bg-slate-800/50',
                        tone === 'large' && 'bg-red-50/50 dark:bg-red-500/5',
                        tone === 'owed' && row.balance > 0 && 'bg-amber-50/40 dark:bg-amber-500/5',
                      )}
                    >
                      <td className="max-w-[200px] px-4 py-2">
                        <div className="truncate font-bold text-slate-900 dark:text-white">
                          {(row.company || row.name || 'Unknown').toUpperCase()}
                        </div>
                        {row.salesPendingCount > 0 && (
                          <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                            {row.salesPendingCount} pending sales
                          </span>
                        )}
                      </td>
                      <td className="hidden max-w-[120px] truncate px-2 py-2 text-xs text-slate-400 sm:table-cell">
                        {[row.city, row.state].filter(Boolean).join(', ') || '—'}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">
                        {money(row.invoiceTotal)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                        {money(row.paymentTotal)}
                      </td>
                      <td className={cn('px-4 py-2 text-right tabular-nums', balanceClasses(tone))}>
                        {money(row.balance)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub?: string
  accent?: 'indigo' | 'amber'
}) {
  const ring =
    accent === 'amber'
      ? 'border-amber-100 dark:border-amber-500/20'
      : 'border-slate-100 dark:border-slate-800'
  return (
    <div className={cn('rounded-xl border bg-white px-4 py-3 dark:bg-slate-900', ring)}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-extrabold tabular-nums text-slate-900 dark:text-white">{value}</p>
      {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
    </div>
  )
}

function ContactLedger({
  contact,
  balance,
  invoices,
  payments,
  expandedInv,
  onToggleInv,
  onBack,
  onAddInvoice,
  onLogPayment,
}: {
  contact: Contact
  balance: number
  invoices: LedgerInvoiceEntry[]
  payments: ReturnType<typeof getMergedPaymentsForContact>
  expandedInv: Set<string>
  onToggleInv: (id: string) => void
  onBack: () => void
  onAddInvoice: () => void
  onLogPayment: () => void
}) {
  const tone = balanceTone(balance)

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400"
      >
        <ChevronLeft className="size-4" aria-hidden />
        Back to accounts
      </button>

      <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Contact ledger</p>
        <h3 className="mt-1 text-lg font-extrabold text-slate-900 dark:text-white">
          {contactLabel(contact).toUpperCase()}
        </h3>
        <p className="text-xs text-slate-400">
          {[contact.city, contact.state].filter(Boolean).join(', ')}
          {contact.phone_mobile ? ` · ${contact.phone_mobile}` : ''}
        </p>
        <p className={cn('mt-4 text-3xl tabular-nums', balanceClasses(tone))}>
          {money(balance)}
          <span className="ml-2 text-sm font-medium text-slate-400">balance owed</span>
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onAddInvoice}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-500"
          >
            <Receipt className="size-4" aria-hidden />
            Add invoice
          </button>
          <button
            type="button"
            onClick={onLogPayment}
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
          >
            <Wallet className="size-4" aria-hidden />
            Log payment
          </button>
        </div>
      </div>

      <LedgerSection title={`Invoices · ${invoices.length}`}>
        {!invoices.length ? (
          <p className="px-5 py-6 text-sm text-slate-400">No invoices yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {invoices.map((inv) => {
              const open = expandedInv.has(inv.id)
              const statusLabel =
                inv.status === 'pending'
                  ? 'Pending'
                  : inv.status === 'cash'
                    ? 'Cash'
                    : inv.status === 'check'
                      ? 'Check'
                      : inv.status === 'memo'
                        ? 'Memo'
                        : null
              return (
                <li key={`${inv.source}-${inv.id}`}>
                  <button
                    type="button"
                    onClick={() => onToggleInv(inv.id)}
                    className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  >
                    <ChevronDown
                      className={cn('size-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-slate-800 dark:text-slate-100">{inv.date}</span>
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 text-[10px] font-bold uppercase',
                            inv.source === 'sales'
                              ? 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300'
                              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
                          )}
                        >
                          {inv.source === 'sales' ? 'Sales' : 'Charge'}
                        </span>
                        {statusLabel && (
                          <span
                            className={cn(
                              'rounded px-1.5 py-0.5 text-[10px] font-bold',
                              inv.status === 'pending'
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300'
                                : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300',
                            )}
                          >
                            {statusLabel}
                          </span>
                        )}
                      </div>
                      {inv.note && <p className="truncate text-xs text-slate-400">{inv.note}</p>}
                    </div>
                    <span className="text-sm font-extrabold tabular-nums text-indigo-600 dark:text-indigo-400">
                      {money(inv.total)}
                    </span>
                  </button>
                  {open && (inv.items?.length ?? 0) > 0 && (
                    <ul className="border-t border-slate-100 bg-slate-50/80 px-5 py-2 dark:border-slate-800 dark:bg-slate-950/40">
                      {inv.items!.map((it, idx) => (
                        <li
                          key={idx}
                          className="flex justify-between gap-4 py-1.5 text-xs text-slate-600 dark:text-slate-300"
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {it.label} · {it.quantity} × {money(it.unit_price)}
                          </span>
                          <span className="font-semibold tabular-nums">{money(it.lineTotal)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </LedgerSection>

      <LedgerSection title={`Payments · ${payments.length}`}>
        {!payments.length ? (
          <p className="px-5 py-6 text-sm text-slate-400">No payments logged yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {payments.map((p) => (
              <li key={`${p.source}-${p.id}`} className="flex items-center justify-between gap-4 px-5 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-800 dark:text-slate-100">{p.date}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-500 dark:bg-slate-800">
                      {p.source}
                    </span>
                  </div>
                  {p.note && <p className="text-xs text-slate-400">{p.note}</p>}
                </div>
                <span className="text-sm font-extrabold tabular-nums text-emerald-600 dark:text-emerald-400">
                  −{money(p.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </LedgerSection>
    </div>
  )
}

function LedgerSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-100 px-5 py-3 dark:border-slate-800">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">{title}</h4>
      </div>
      {children}
    </div>
  )
}

function ModalShell({
  title,
  children,
  onClose,
}: {
  title: string
  children: React.ReactNode
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        role="dialog"
        aria-modal="true"
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

function AddInvoiceModal({
  contact,
  saving,
  onClose,
  onSubmit,
}: {
  contact: Contact
  saving: boolean
  onClose: () => void
  onSubmit: (p: { date: string; note: string; items: NewChargeLineItem[] }) => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(today)
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([emptyLine(), emptyLine()])

  const parsed: NewChargeLineItem[] = lines
    .filter((l) => l.item_name.trim())
    .map((l) => ({
      item_name: l.item_name.trim(),
      quantity: Number(l.quantity) || 0,
      unit_price: Number(l.unit_price) || 0,
    }))

  const total = sumLineItems(parsed)

  return (
    <ModalShell title={`Add invoice · ${contactLabel(contact)}`} onClose={onClose}>
      <div className="space-y-4">
        <label className="block text-xs font-semibold text-slate-500">
          Date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
        </label>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Line items</span>
            <button
              type="button"
              onClick={() => setLines((prev) => [...prev, emptyLine()])}
              className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600"
            >
              <Plus className="size-3.5" aria-hidden />
              Add line
            </button>
          </div>
          <div className="space-y-2">
            {lines.map((line, i) => (
              <div key={i} className="grid grid-cols-12 gap-2">
                <input
                  placeholder="Item"
                  value={line.item_name}
                  onChange={(e) =>
                    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, item_name: e.target.value } : l)))
                  }
                  className="col-span-6 rounded-lg border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
                />
                <input
                  type="number"
                  min={0}
                  step="any"
                  placeholder="Qty"
                  value={line.quantity}
                  onChange={(e) =>
                    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, quantity: e.target.value } : l)))
                  }
                  className="col-span-2 rounded-lg border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
                />
                <input
                  type="number"
                  min={0}
                  step="any"
                  placeholder="Price"
                  value={line.unit_price}
                  onChange={(e) =>
                    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, unit_price: e.target.value } : l)))
                  }
                  className="col-span-3 rounded-lg border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
                />
                <button
                  type="button"
                  onClick={() => setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, j) => j !== i)))}
                  className="col-span-1 flex items-center justify-center text-slate-300 hover:text-red-500"
                  aria-label="Remove line"
                >
                  <X className="size-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
        <label className="block text-xs font-semibold text-slate-500">
          Note (optional)
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
        </label>
        <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800">
          <span className="text-sm font-semibold text-slate-500">Total</span>
          <span className="text-xl font-extrabold tabular-nums text-indigo-600 dark:text-indigo-400">{money(total)}</span>
        </div>
        <button
          type="button"
          disabled={saving || !parsed.length || total <= 0}
          onClick={() => onSubmit({ date, note, items: parsed })}
          className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save invoice'}
        </button>
      </div>
    </ModalShell>
  )
}

function LogPaymentModal({
  contact,
  balance,
  saving,
  onClose,
  onSubmit,
}: {
  contact: Contact
  balance: number
  saving: boolean
  onClose: () => void
  onSubmit: (p: { date: string; amount: number; note: string }) => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(today)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const num = Number(amount) || 0

  return (
    <ModalShell title={`Log payment · ${contactLabel(contact)}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-xs text-slate-400">
          Current balance: <strong className={balanceClasses(balanceTone(balance))}>{money(balance)}</strong>
        </p>
        <label className="block text-xs font-semibold text-slate-500">
          Amount
          <input
            type="number"
            min={0}
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
        </label>
        <label className="block text-xs font-semibold text-slate-500">
          Date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
        </label>
        <label className="block text-xs font-semibold text-slate-500">
          Note (optional)
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
        </label>
        <button
          type="button"
          disabled={saving || num <= 0}
          onClick={() => onSubmit({ date, amount: num, note })}
          className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save payment'}
        </button>
      </div>
    </ModalShell>
  )
}
