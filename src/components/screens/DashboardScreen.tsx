import { useMemo, useState, type ReactNode } from 'react'
import {
  Banknote,
  Check,
  ClipboardList,
  FileText,
  Globe,
  Landmark,
  Loader,
  X,
} from 'lucide-react'
import { useStore } from '../../store/useStore'
import { SavedInvoice } from '../../types/invoice'
import { updateInvoiceInDB, deleteInvoiceFromDB } from '../../lib/supabase'

// ─── helpers ────────────────────────────────────────────────────────────────

function money(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(value)
}

function pct(value: number): string {
  return `${value.toFixed(1)}%`
}

function invStatusLabel(inv: SavedInvoice): string {
  if (inv.docKind === 'memo') return 'MEMO'
  if (inv.paidBy === 'pending') return 'PENDING'
  if (inv.paidBy === 'cash') return 'CASH'
  return 'CHECK'
}

function invStatusColor(inv: SavedInvoice): string {
  if (inv.docKind === 'memo') return '#8b5cf6'
  if (inv.paidBy === 'pending') return '#ff9500'
  return '#34c759'
}

// ─── Stats tab (original) ────────────────────────────────────────────────────

type GroupStats = { key: string; total: number; customers: number; conversion: number }

function StatsTab() {
  const contacts = useStore((s) => s.contacts)
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  const totals = useMemo(() => {
    const total = contacts.length
    const customers = contacts.filter((c) => c.is_customer).length
    const newThisMonth = contacts.filter((c) => {
      const dt = new Date(c.created_at || c.scanned_at || '')
      return Number.isFinite(dt.getTime()) && dt >= monthStart
    }).length
    const overallConversion = total > 0 ? (customers / total) * 100 : 0
    return { total, customers, newThisMonth, overallConversion }
  }, [contacts, monthStart])

  const byState = useMemo<GroupStats[]>(() => {
    const map = new Map<string, { total: number; customers: number }>()
    contacts.forEach((c) => {
      if (!c.state) return
      const item = map.get(c.state) ?? { total: 0, customers: 0 }
      item.total += 1
      if (c.is_customer) item.customers += 1
      map.set(c.state, item)
    })
    return Array.from(map.entries())
      .map(([key, val]) => ({ key, total: val.total, customers: val.customers, conversion: val.total ? (val.customers / val.total) * 100 : 0 }))
      .sort((a, b) => b.conversion - a.conversion || b.total - a.total)
  }, [contacts])

  const byArea = useMemo<GroupStats[]>(() => {
    const map = new Map<string, { total: number; customers: number }>()
    contacts.forEach((c) => {
      if (!c.area) return
      const item = map.get(c.area) ?? { total: 0, customers: 0 }
      item.total += 1
      if (c.is_customer) item.customers += 1
      map.set(c.area, item)
    })
    return Array.from(map.entries())
      .map(([key, val]) => ({ key, total: val.total, customers: val.customers, conversion: val.total ? (val.customers / val.total) * 100 : 0 }))
      .sort((a, b) => b.conversion - a.conversion || b.total - a.total)
  }, [contacts])

  return (
    <div style={{ padding: '16px 16px 24px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <StatCard label="Total Stores" value={String(totals.total)} />
        <StatCard label="Customers" value={String(totals.customers)} />
        <StatCard label="Conversion" value={pct(totals.overallConversion)} />
        <StatCard label="New This Month" value={String(totals.newThisMonth)} />
      </div>
      <Section title="Conversion by State" />
      <StatsTable rows={byState} emptyLabel="No state data yet" />
      <Section title="Conversion by Area" />
      <StatsTable rows={byArea} emptyLabel="No area data yet" />
    </div>
  )
}

// ─── Revenue tab ─────────────────────────────────────────────────────────────

type LedgerRow = {
  key: string
  company: string
  state: string
  city: string
  invoiceCount: number
  totalSold: number
  totalPaid: number
  totalPending: number
  lastDate: string
  invoices: SavedInvoice[]
}

function RevenueTab() {
  const invoices = useStore((s) => s.invoices)
  const updateInvoice = useStore((s) => s.updateInvoice)
  const deleteInvoice = useStore((s) => s.deleteInvoice)
  const showToast = useStore((s) => s.showToast)
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  const [selectedCompany, setSelectedCompany] = useState('all')

  const companies = useMemo(() => {
    const names = new Set<string>()
    invoices.forEach((inv) => {
      const n = inv.company || inv.contactName
      if (n) names.add(n)
    })
    return Array.from(names).sort()
  }, [invoices])

  const filteredInvoices = useMemo(() => {
    if (selectedCompany === 'all') return invoices
    return invoices.filter((inv) => (inv.company || inv.contactName) === selectedCompany)
  }, [invoices, selectedCompany])

  const handleMarkPaid = (id: string, paidBy: 'cash' | 'check') => {
    updateInvoice(id, { paidBy })
    updateInvoiceInDB(id, { paidBy }).catch(() => {})
    showToast(`Marked as paid (${paidBy})`)
  }

  const handleDelete = (id: string) => {
    deleteInvoice(id)
    deleteInvoiceFromDB(id).catch(() => {})
    showToast('Memo deleted')
  }

  const summary = useMemo(() => {
    let totalRevenue = 0
    let thisMonth = 0
    let pending = 0
    filteredInvoices.forEach((inv) => {
      totalRevenue += inv.total
      if (inv.paidBy === 'pending') pending += inv.total
      const dt = new Date(inv.saved_at)
      if (dt >= monthStart) thisMonth += inv.total
    })
    return { totalRevenue, thisMonth, pending, count: filteredInvoices.length }
  }, [filteredInvoices, monthStart])

  const ledger = useMemo<LedgerRow[]>(() => {
    const map = new Map<string, LedgerRow>()
    filteredInvoices.forEach((inv) => {
      const key = inv.contactId || inv.company
      const row = map.get(key) ?? {
        key,
        company: inv.company || inv.contactName || 'Unknown',
        state: inv.state,
        city: inv.city,
        invoiceCount: 0,
        totalSold: 0,
        totalPaid: 0,
        totalPending: 0,
        lastDate: inv.date,
        invoices: [],
      }
      row.invoiceCount += 1
      row.totalSold += inv.total
      if (inv.paidBy === 'pending') row.totalPending += inv.total
      else row.totalPaid += inv.total
      if (inv.date > row.lastDate) row.lastDate = inv.date
      row.invoices.push(inv)
      map.set(key, row)
    })
    return Array.from(map.values()).sort((a, b) => b.totalSold - a.totalSold)
  }, [filteredInvoices])

  const byState = useMemo(() => {
    const map = new Map<string, { sold: number; pending: number; count: number }>()
    filteredInvoices.forEach((inv) => {
      if (!inv.state) return
      const row = map.get(inv.state) ?? { sold: 0, pending: 0, count: 0 }
      row.sold += inv.total
      if (inv.paidBy === 'pending') row.pending += inv.total
      row.count += 1
      map.set(inv.state, row)
    })
    return Array.from(map.entries())
      .map(([key, val]) => ({ key, ...val }))
      .sort((a, b) => b.sold - a.sold)
  }, [filteredInvoices])

  const byPayment = useMemo(() => {
    const cash      = filteredInvoices.filter((i) => i.paidBy === 'cash'    && i.docKind !== 'memo')
    const check     = filteredInvoices.filter((i) => i.paidBy === 'check'   && i.docKind !== 'memo')
    const pending   = filteredInvoices.filter((i) => i.paidBy === 'pending')
    const memos     = filteredInvoices.filter((i) => i.docKind === 'memo')
    const sum = (arr: SavedInvoice[]) => arr.reduce((s, i) => s + i.total, 0)
    return {
      cash: sum(cash), cashCount: cash.length,
      check: sum(check), checkCount: check.length,
      pending: sum(pending), pendingCount: pending.length,
      memo: sum(memos), memoCount: memos.length,
    }
  }, [filteredInvoices])

  const pendingInvoices = useMemo(
    () => filteredInvoices.filter((i) => i.paidBy === 'pending').sort((a, b) => b.total - a.total),
    [filteredInvoices]
  )

  const byMonth = useMemo(() => {
    const map = new Map<string, { sold: number; count: number }>()
    filteredInvoices.forEach((inv) => {
      const key = inv.date.slice(0, 7)
      const row = map.get(key) ?? { sold: 0, count: 0 }
      row.sold += inv.total
      row.count += 1
      map.set(key, row)
    })
    const rows = Array.from(map.entries())
      .map(([key, val]) => {
        const [year, month] = key.split('-')
        const label = new Date(Number(year), Number(month) - 1, 1)
          .toLocaleString('en-US', { month: 'short', year: '2-digit' })
        return { key, label, ...val }
      })
      .sort((a, b) => b.key.localeCompare(a.key))
      .slice(0, 6)
    const max = Math.max(...rows.map((r) => r.sold), 1)
    return rows.map((r) => ({ ...r, pct: (r.sold / max) * 100 }))
  }, [filteredInvoices])

  if (!invoices.length) {
    return (
      <div style={{ textAlign: 'center', padding: '70px 24px', color: 'var(--text3)' }}>
        <div style={{ fontSize: 44, marginBottom: 12, display: 'flex', justifyContent: 'center', color: 'var(--text3)' }}>
          <FileText size={44} strokeWidth={1.25} aria-hidden />
        </div>
        <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text2)', marginBottom: 6 }}>No invoices yet</div>
        <div>Create an invoice from any contact card — it will appear here automatically.</div>
      </div>
    )
  }

  return (
    <div style={{ padding: '16px 16px 24px' }}>

      {/* Company filter + web dashboard link */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center' }}>
        <select
          value={selectedCompany}
          onChange={(e) => setSelectedCompany(e.target.value)}
          style={{ flex: 1, padding: '9px 12px', borderRadius: 10, border: '1.5px solid var(--border)', background: 'var(--bg3)', color: 'var(--text)', fontSize: 14 }}
        >
          <option value="all">All Shops ({invoices.length})</option>
          {companies.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => window.open('/dashboard', '_blank')}
          style={{ padding: '9px 12px', borderRadius: 10, border: '1.5px solid var(--accent)', background: 'transparent', color: 'var(--accent)', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <Globe size={16} strokeWidth={2} aria-hidden />
          Web
        </button>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
        <StatCard label="Total Revenue" value={money(summary.totalRevenue)} accent />
        <StatCard label="This Month" value={money(summary.thisMonth)} />
        <StatCard label="Pending" value={money(summary.pending)} danger={summary.pending > 0} />
        <StatCard label="Invoices" value={String(summary.count)} />
      </div>

      {/* Pending payments */}
      {pendingInvoices.length > 0 && (
        <>
          <Section title={`Pending payments · ${pendingInvoices.length}`} color="#ff9500" />
          <div style={{ background: 'var(--bg2)', border: '1.5px solid rgba(255,149,0,0.35)', borderRadius: 12, overflow: 'hidden', marginBottom: 4 }}>
            {pendingInvoices.map((inv, i) => (
              <PendingRow key={inv.id} inv={inv} isFirst={i === 0} onMarkPaid={handleMarkPaid} />
            ))}
          </div>
        </>
      )}

      {/* Payment breakdown */}
      <Section title="Payment Breakdown" />
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 12, overflow: 'hidden', marginBottom: 4 }}>
        <PaymentBreakdownRow label="Cash" amount={byPayment.cash} count={byPayment.cashCount} color="#34c759" icon={<Banknote className="size-3.5 shrink-0" aria-hidden />} />
        <PaymentBreakdownRow label="Check" amount={byPayment.check} count={byPayment.checkCount} color="#007aff" divider icon={<Landmark className="size-3.5 shrink-0" aria-hidden />} />
        <PaymentBreakdownRow label="Pending" amount={byPayment.pending} count={byPayment.pendingCount} color="#ff9500" divider icon={<Loader className="size-3.5 shrink-0" aria-hidden />} />
        {byPayment.memoCount > 0 && (
          <PaymentBreakdownRow label="Memo" amount={byPayment.memo} count={byPayment.memoCount} color="#8b5cf6" divider icon={<ClipboardList className="size-3.5 shrink-0" aria-hidden />} />
        )}
      </div>

      {/* Monthly revenue chart */}
      {byMonth.length > 0 && (
        <>
          <Section title="Revenue by Month" />
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 12, overflow: 'hidden', marginBottom: 4 }}>
            {byMonth.map((row, i) => (
              <div key={row.key} style={{ padding: '10px 14px', borderTop: i ? '1px solid var(--border2)' : 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, minWidth: 60 }}>{row.label}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontSize: 12, color: 'var(--text3)' }}>{row.count} inv</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--accent)', minWidth: 72, textAlign: 'right' }}>{money(row.sold)}</div>
                  </div>
                </div>
                <div style={{ height: 6, borderRadius: 99, background: 'var(--bg4)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${row.pct}%`, borderRadius: 99, background: 'var(--accent)', transition: 'width 0.4s ease' }} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Ledger by company — expandable */}
      <Section title="Ledger by Shop" />
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 12, overflow: 'hidden', marginBottom: 4 }}>
        {ledger.map((row) => (
          <LedgerRowItem key={row.key} row={row} onMarkPaid={handleMarkPaid} onDelete={handleDelete} />
        ))}
      </div>

      {/* Revenue by state */}
      {byState.length > 0 && (
        <>
          <Section title="Revenue by State" />
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 12, overflow: 'hidden' }}>
            {byState.map((row, i) => (
              <div key={row.key} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 0.8fr 0.6fr', gap: 4, padding: '10px 12px', borderTop: i ? '1px solid var(--border2)' : 'none', alignItems: 'center', fontSize: 13 }}>
                <div style={{ fontWeight: 700 }}>{row.key}</div>
                <div style={{ fontWeight: 700, color: 'var(--accent)' }}>{money(row.sold)}</div>
                <div style={{ color: '#ff9500', fontSize: 12 }}>{row.pending > 0 ? money(row.pending) : '—'}</div>
                <div style={{ color: 'var(--text3)', fontSize: 12, textAlign: 'right' }}>{row.count} inv</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── PendingRow — with mark-as-paid ──────────────────────────────────────────

function PendingRow({ inv, isFirst, onMarkPaid }: {
  inv: SavedInvoice
  isFirst: boolean
  onMarkPaid: (id: string, paidBy: 'cash' | 'check') => void
}) {
  const [showPicker, setShowPicker] = useState(false)
  return (
    <div style={{ borderTop: isFirst ? 'none' : '1px solid var(--border2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {inv.company || inv.contactName || 'Unknown'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
            {[inv.city, inv.state].filter(Boolean).join(', ')} · {inv.date}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginLeft: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#ff9500' }}>{money(inv.total)}</div>
          {!showPicker ? (
            <button
              type="button"
              onClick={() => setShowPicker(true)}
              style={{ fontSize: 11, fontWeight: 700, padding: '5px 10px', borderRadius: 8, border: '1.5px solid #34c759', background: 'transparent', color: '#34c759', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <Check size={12} strokeWidth={3} aria-hidden />
              Paid
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => { onMarkPaid(inv.id, 'cash'); setShowPicker(false) }}
                style={{ fontSize: 11, fontWeight: 700, padding: '5px 9px', borderRadius: 8, border: 'none', background: '#34c759', color: '#fff', cursor: 'pointer' }}>
                Cash
              </button>
              <button onClick={() => { onMarkPaid(inv.id, 'check'); setShowPicker(false) }}
                style={{ fontSize: 11, fontWeight: 700, padding: '5px 9px', borderRadius: 8, border: 'none', background: '#007aff', color: '#fff', cursor: 'pointer' }}>
                Check
              </button>
              <button type="button" onClick={() => setShowPicker(false)}
                style={{ fontSize: 11, padding: '5px 7px', borderRadius: 8, border: '1.5px solid var(--border)', background: 'transparent', color: 'var(--text3)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                <X size={14} strokeWidth={2.5} aria-hidden />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Individual invoice row in ledger ────────────────────────────────────────

function InvoiceLineItem({ inv, onMarkPaid, onDelete }: {
  inv: SavedInvoice
  onMarkPaid: (id: string, paidBy: 'cash' | 'check') => void
  onDelete: (id: string) => void
}) {
  const [showPicker, setShowPicker] = useState(false)
  const isMemo = inv.docKind === 'memo'
  const isPending = inv.paidBy === 'pending' && !isMemo
  const label = invStatusLabel(inv)
  const color = invStatusColor(inv)

  return (
    <div style={{ padding: '9px 12px', borderTop: '1px solid var(--border2)', background: isMemo ? 'rgba(139,92,246,0.05)' : isPending ? 'rgba(255,149,0,0.05)' : 'transparent' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{inv.date}</div>
            <div style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: color + '22', color, border: `1px solid ${color}55` }}>
              {label}
            </div>
          </div>
          {inv.items.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>
              {inv.items.slice(0, 3).map((it) => it.size).filter(Boolean).join(' · ')}
              {inv.items.length > 3 ? ` +${inv.items.length - 3}` : ''}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color }}>{money(inv.total)}</div>
          {isPending && !showPicker && (
            <button type="button" onClick={() => setShowPicker(true)}
              style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 7, border: '1.5px solid #34c759', background: 'transparent', color: '#34c759', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Check size={12} strokeWidth={3} aria-hidden />
              Paid
            </button>
          )}
          {isPending && showPicker && (
            <div style={{ display: 'flex', gap: 3 }}>
              <button onClick={() => { onMarkPaid(inv.id, 'cash'); setShowPicker(false) }}
                style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 7, border: 'none', background: '#34c759', color: '#fff', cursor: 'pointer' }}>
                Cash
              </button>
              <button onClick={() => { onMarkPaid(inv.id, 'check'); setShowPicker(false) }}
                style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 7, border: 'none', background: '#007aff', color: '#fff', cursor: 'pointer' }}>
                Check
              </button>
              <button type="button" onClick={() => setShowPicker(false)}
                style={{ fontSize: 10, padding: '3px 6px', borderRadius: 7, border: '1.5px solid var(--border)', background: 'transparent', color: 'var(--text3)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                <X size={12} strokeWidth={2.5} aria-hidden />
              </button>
            </div>
          )}
          {isMemo && (
            <button onClick={() => onDelete(inv.id)}
              style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 7, border: '1.5px solid #ff3b30', background: 'transparent', color: '#ff3b30', cursor: 'pointer' }}>
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Ledger row — expandable ─────────────────────────────────────────────────

function LedgerRowItem({ row, onMarkPaid, onDelete }: {
  row: LedgerRow
  onMarkPaid: (id: string, paidBy: 'cash' | 'check') => void
  onDelete: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const sortedInvoices = useMemo(
    () => [...row.invoices].sort((a, b) => b.date.localeCompare(a.date)),
    [row.invoices]
  )

  return (
    <div style={{ borderTop: '1px solid var(--border2)' }}>
      <div
        onClick={() => setExpanded((v) => !v)}
        style={{ padding: '12px 14px', cursor: 'pointer', background: expanded ? 'rgba(0,122,255,0.04)' : 'transparent', transition: 'background 0.15s' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 800, lineHeight: 1.3, marginBottom: 2 }}>{row.company}</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8 }}>
              {[row.city, row.state].filter(Boolean).join(', ')} · {row.invoiceCount} inv · Last: {row.lastDate}
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 700, flexShrink: 0, marginLeft: 8, marginTop: 2 }}>
            {expanded ? '▲' : '▼'}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
          {[
            { label: 'Sold',    value: money(row.totalSold),    color: 'var(--accent)' },
            { label: 'Paid',    value: money(row.totalPaid),    color: '#34c759' },
            { label: 'Pending', value: row.totalPending > 0 ? money(row.totalPending) : '—', color: row.totalPending > 0 ? '#ff9500' : 'var(--text3)' },
          ].map(({ label, value, color }) => (
            <div key={label}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
              <div style={{ fontSize: 13, fontWeight: 800, color }}>{value}</div>
            </div>
          ))}
        </div>
      </div>
      {expanded && (
        <div style={{ borderTop: '1px solid var(--border2)', background: 'var(--bg3)' }}>
          {sortedInvoices.map((inv) => (
            <InvoiceLineItem key={inv.id} inv={inv} onMarkPaid={onMarkPaid} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  )
}

function PaymentBreakdownRow({ label, amount, count, color, divider, icon }: {
  label: string
  amount: number
  count: number
  color: string
  divider?: boolean
  icon?: ReactNode
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', borderTop: divider ? '1px solid var(--border2)' : 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon ? (
          <span style={{ color, display: 'flex', alignItems: 'center' }}>{icon}</span>
        ) : (
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
        )}
        <div style={{ fontSize: 14, fontWeight: 700 }}>{label}</div>
        <div style={{ fontSize: 12, color: 'var(--text3)' }}>{count} inv</div>
      </div>
      <div style={{ fontSize: 15, fontWeight: 800, color }}>{money(amount)}</div>
    </div>
  )
}

// ─── Shared primitives ───────────────────────────────────────────────────────

function StatCard({ label, value, accent, danger }: { label: string; value: string; accent?: boolean; danger?: boolean }) {
  const color = danger ? '#ff9500' : accent ? 'var(--accent)' : 'var(--text)'
  return (
    <div style={{ background: 'var(--bg2)', border: `1px solid ${danger ? 'rgba(255,149,0,0.3)' : 'var(--border2)'}`, borderRadius: 12, padding: 12 }}>
      <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 700, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 21, fontWeight: 800, marginTop: 4, color }}>{value}</div>
    </div>
  )
}

function Section({ title, color }: { title: string; color?: string }) {
  return (
    <div style={{ fontSize: 12, color: color ?? 'var(--text3)', fontWeight: 700, marginTop: 16, marginBottom: 6, textTransform: 'uppercase' }}>
      {title}
    </div>
  )
}

function StatsTable({ rows, emptyLabel }: { rows: GroupStats[]; emptyLabel: string }) {
  if (!rows.length) {
    return <div style={{ padding: 12, background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 12, color: 'var(--text3)' }}>{emptyLabel}</div>
  }
  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 12, overflow: 'hidden' }}>
      {rows.slice(0, 12).map((row, index) => (
        <div key={row.key} style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.7fr 0.7fr 0.9fr', gap: 8, padding: '10px 12px', borderTop: index ? '1px solid var(--border2)' : 'none', alignItems: 'center', fontSize: 13 }}>
          <div style={{ fontWeight: 700 }}>{row.key}</div>
          <div style={{ color: 'var(--text2)' }}>{row.total}</div>
          <div style={{ color: 'var(--text2)' }}>{row.customers}</div>
          <div style={{ fontWeight: 700, color: 'var(--accent)', textAlign: 'right' }}>{pct(row.conversion)}</div>
        </div>
      ))}
    </div>
  )
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export function DashboardScreen() {
  const [tab, setTab] = useState<'stats' | 'revenue'>('stats')
  const invoiceCount = useStore((s) => s.invoices.length)

  return (
    <div>
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, padding: '12px 16px 0', background: 'var(--bg2)', borderBottom: '1px solid var(--border2)', position: 'sticky', top: 53, zIndex: 10 }}>
        {([['stats', 'Stats'], ['revenue', 'Revenue']] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              flex: 1, padding: '9px 0', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 14, fontWeight: 700,
              color: tab === id ? 'var(--accent)' : 'var(--text3)',
              borderBottom: `2.5px solid ${tab === id ? 'var(--accent)' : 'transparent'}`,
              transition: 'color 0.15s',
            }}
          >
            {label}
            {id === 'revenue' && invoiceCount > 0 && (
              <span style={{ marginLeft: 6, fontSize: 11, background: 'var(--accent)', color: '#fff', borderRadius: 99, padding: '1px 6px', fontWeight: 800 }}>
                {invoiceCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'stats' ? <StatsTab /> : <RevenueTab />}
    </div>
  )
}
