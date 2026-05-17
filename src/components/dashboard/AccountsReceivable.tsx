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
  LARGE_BALANCE_THRESHOLD,
  lineItemTotal,
  sumLineItems,
  type NewChargeLineItem,
} from '../../lib/chargeAccount'
import type { ChargeInvoice, ChargePayment } from '../../types/chargeAccount'
import type { Contact } from '../../types/contact'
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

function balanceRowBg(tone: ReturnType<typeof balanceTone>) {
  if (tone === 'large') return 'bg-red-50/80 dark:bg-red-500/5 border-red-100 dark:border-red-500/20'
  if (tone === 'owed') return 'bg-amber-50/60 dark:bg-amber-500/5 border-amber-100 dark:border-amber-500/15'
  return 'border-slate-100 dark:border-slate-800'
}

type DraftLine = { item_name: string; quantity: string; unit_price: string }

const emptyLine = (): DraftLine => ({ item_name: '', quantity: '1', unit_price: '' })

export function AccountsReceivable({
  onOutstandingCount,
}: {
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
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [expandedInv, setExpandedInv] = useState<Set<string>>(() => new Set())

  const [invoiceOpen, setInvoiceOpen] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [saving, setSaving] = useState(false)

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

  const rows = useMemo(
    () => buildContactBalanceRows(contacts, chargeInvoices, chargePayments),
    [contacts, chargeInvoices, chargePayments],
  )

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => {
      const c = contactById.get(r.contactId)
      const label = (r.company || r.name || '').toLowerCase()
      const extra = [r.city, r.state, c?.email].filter(Boolean).join(' ').toLowerCase()
      return label.includes(q) || extra.includes(q)
    })
  }, [rows, search, contactById])

  const outstandingCount = useMemo(
    () => rows.filter((r) => r.balance > 0).length,
    [rows],
  )

  useEffect(() => {
    onOutstandingCount?.(outstandingCount)
  }, [outstandingCount, onOutstandingCount])

  const selectedContact = selectedId ? contactById.get(selectedId) : undefined
  const selectedBalance = selectedId
    ? computeContactBalance(selectedId, chargeInvoices, chargePayments)
    : 0

  const contactInvoices = useMemo(
    () =>
      selectedId
        ? chargeInvoices.filter((i) => i.contact_id === selectedId).sort((a, b) => b.date.localeCompare(a.date))
        : [],
    [chargeInvoices, selectedId],
  )

  const contactPayments = useMemo(
    () =>
      selectedId
        ? chargePayments.filter((p) => p.contact_id === selectedId).sort((a, b) => b.date.localeCompare(a.date))
        : [],
    [chargePayments, selectedId],
  )

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

      {!selectedId ? (
        <AccountsList
          rows={filteredRows}
          search={search}
          onSearch={setSearch}
          onSelect={setSelectedId}
          onRefresh={() => void reload()}
          loading={loading}
          outstandingCount={outstandingCount}
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
  search,
  onSearch,
  onSelect,
  onRefresh,
  loading,
  outstandingCount,
}: {
  rows: ReturnType<typeof buildContactBalanceRows>
  search: string
  onSearch: (v: string) => void
  onSelect: (id: string) => void
  onRefresh: () => void
  loading: boolean
  outstandingCount: number
}) {
  const totalOwed = rows.reduce((s, r) => s + Math.max(0, r.balance), 0)

  return (
    <div className="rounded-2xl border border-slate-100 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">All accounts</h3>
          <p className="mt-0.5 text-xs text-slate-400">
            {outstandingCount} owing · {money(totalOwed)} outstanding
            {LARGE_BALANCE_THRESHOLD > 0 && (
              <span className="text-slate-500"> · red ≥ {money(LARGE_BALANCE_THRESHOLD)}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search contacts…"
            className="w-44 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          />
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {loading ? '…' : 'Refresh'}
          </button>
        </div>
      </div>

      {!rows.length ? (
        <p className="px-5 py-10 text-center text-sm text-slate-400">No contacts match.</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((row) => {
            const tone = balanceTone(row.balance)
            return (
              <li key={row.contactId}>
                <button
                  type="button"
                  onClick={() => onSelect(row.contactId)}
                  className={cn(
                    'flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60',
                    balanceRowBg(tone),
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-slate-900 dark:text-white">
                      {(row.company || row.name || 'Unknown').toUpperCase()}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-slate-400">
                      {[row.city, row.state].filter(Boolean).join(', ') || '—'}
                      {row.invoiceTotal > 0 || row.paymentTotal > 0
                        ? ` · inv ${money(row.invoiceTotal)} · paid ${money(row.paymentTotal)}`
                        : ''}
                    </div>
                  </div>
                  <div className={cn('tabular-nums text-base', balanceClasses(tone))}>
                    {money(row.balance)}
                  </div>
                  <ChevronDown className="size-4 -rotate-90 text-slate-300" aria-hidden />
                </button>
              </li>
            )
          })}
        </ul>
      )}
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
  invoices: ChargeInvoice[]
  payments: ChargePayment[]
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
        All accounts
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
          <p className="px-5 py-6 text-sm text-slate-400">No charge invoices yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {invoices.map((inv) => {
              const open = expandedInv.has(inv.id)
              return (
                <li key={inv.id}>
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
                      <div className="text-sm font-bold text-slate-800 dark:text-slate-100">{inv.date}</div>
                      {inv.note && <p className="truncate text-xs text-slate-400">{inv.note}</p>}
                    </div>
                    <span className="text-sm font-extrabold tabular-nums text-indigo-600 dark:text-indigo-400">
                      {money(inv.total)}
                    </span>
                  </button>
                  {open && (inv.items?.length ?? 0) > 0 && (
                    <ul className="border-t border-slate-100 bg-slate-50/80 px-5 py-2 dark:border-slate-800 dark:bg-slate-950/40">
                      {inv.items!.map((it) => (
                        <li
                          key={it.id}
                          className="flex justify-between gap-4 py-1.5 text-xs text-slate-600 dark:text-slate-300"
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {it.item_name} · {it.quantity} × {money(it.unit_price)}
                          </span>
                          <span className="font-semibold tabular-nums">
                            {money(lineItemTotal(it.quantity, it.unit_price))}
                          </span>
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
              <li key={p.id} className="flex items-center justify-between gap-4 px-5 py-3">
                <div>
                  <div className="text-sm font-bold text-slate-800 dark:text-slate-100">{p.date}</div>
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
        aria-labelledby="charge-modal-title"
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 id="charge-modal-title" className="text-base font-bold text-slate-900 dark:text-white">
            {title}
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close">
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
