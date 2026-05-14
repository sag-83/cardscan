import { useMemo, useState } from 'react'
import { useStore } from '../../store/useStore'
import { SavedInvoice } from '../../types/invoice'

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
  company: string
  state: string
  city: string
  invoiceCount: number
  totalSold: number
  totalPaid: number
  totalPending: number
  lastDate: string
}

function RevenueTab() {
  const invoices = useStore((s) => s.invoices)
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  const summary = useMemo(() => {
    let totalRevenue = 0
    let thisMonth = 0
    let pending = 0
    invoices.forEach((inv) => {
      totalRevenue += inv.total
      if (inv.paidBy === 'pending') pending += inv.total
      const dt = new Date(inv.saved_at)
      if (dt >= monthStart) thisMonth += inv.total
    })
    return { totalRevenue, thisMonth, pending, count: invoices.length }
  }, [invoices, monthStart])

  const ledger = useMemo<LedgerRow[]>(() => {
    const map = new Map<string, LedgerRow>()
    invoices.forEach((inv) => {
      const key = inv.contactId || inv.company
      const row = map.get(key) ?? {
        company: inv.company || inv.contactName || 'Unknown',
        state: inv.state,
        city: inv.city,
        invoiceCount: 0,
        totalSold: 0,
        totalPaid: 0,
        totalPending: 0,
        lastDate: inv.date,
      }
      row.invoiceCount += 1
      row.totalSold += inv.total
      if (inv.paidBy === 'pending') row.totalPending += inv.total
      else row.totalPaid += inv.total
      if (inv.date > row.lastDate) row.lastDate = inv.date
      map.set(key, row)
    })
    return Array.from(map.values()).sort((a, b) => b.totalSold - a.totalSold)
  }, [invoices])

  const byState = useMemo(() => {
    const map = new Map<string, { sold: number; pending: number; count: number }>()
    invoices.forEach((inv) => {
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
  }, [invoices])

  const byPayment = useMemo(() => {
    const cash = invoices.filter((i) => i.paidBy === 'cash').reduce((s, i) => s + i.total, 0)
    const check = invoices.filter((i) => i.paidBy === 'check').reduce((s, i) => s + i.total, 0)
    const pending = invoices.filter((i) => i.paidBy === 'pending').reduce((s, i) => s + i.total, 0)
    const cashCount = invoices.filter((i) => i.paidBy === 'cash').length
    const checkCount = invoices.filter((i) => i.paidBy === 'check').length
    const pendingCount = invoices.filter((i) => i.paidBy === 'pending').length
    return { cash, check, pending, cashCount, checkCount, pendingCount }
  }, [invoices])

  const pendingInvoices = useMemo(
    () => invoices.filter((i) => i.paidBy === 'pending').sort((a, b) => b.total - a.total),
    [invoices]
  )

  const byMonth = useMemo(() => {
    const map = new Map<string, { sold: number; count: number }>()
    invoices.forEach((inv) => {
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
  }, [invoices])

  if (!invoices.length) {
    return (
      <div style={{ textAlign: 'center', padding: '70px 24px', color: 'var(--text3)' }}>
        <div style={{ fontSize: 44, marginBottom: 12 }}>🧾</div>
        <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text2)', marginBottom: 6 }}>No invoices yet</div>
        <div>Create an invoice from any contact card — it will appear here automatically.</div>
      </div>
    )
  }

  return (
    <div style={{ padding: '16px 16px 24px' }}>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
        <StatCard label="Total Revenue" value={money(summary.totalRevenue)} accent />
        <StatCard label="This Month" value={money(summary.thisMonth)} />
        <StatCard label="Pending" value={money(summary.pending)} danger={summary.pending > 0} />
        <StatCard label="Invoices" value={String(summary.count)} />
      </div>

      {/* Pending payments — most urgent */}
      {pendingInvoices.length > 0 && (
        <>
          <Section title={`⚠️ Pending Payments · ${pendingInvoices.length}`} color="#ff9500" />
          <div style={{ background: 'var(--bg2)', border: '1.5px solid rgba(255,149,0,0.35)', borderRadius: 12, overflow: 'hidden', marginBottom: 4 }}>
            {pendingInvoices.slice(0, 8).map((inv, i) => (
              <PendingRow key={inv.id} inv={inv} isFirst={i === 0} />
            ))}
          </div>
        </>
      )}

      {/* Payment breakdown */}
      <Section title="Payment Breakdown" />
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 12, overflow: 'hidden', marginBottom: 4 }}>
        <PaymentBreakdownRow label="💵 Cash" amount={byPayment.cash} count={byPayment.cashCount} color="#34c759" />
        <PaymentBreakdownRow label="🏦 Check" amount={byPayment.check} count={byPayment.checkCount} color="#007aff" divider />
        <PaymentBreakdownRow label="⏳ Pending" amount={byPayment.pending} count={byPayment.pendingCount} color="#ff9500" divider />
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

      {/* Ledger by company */}
      <Section title="Ledger by Shop" />
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 12, overflow: 'hidden', marginBottom: 4 }}>
        {ledger.map((row, i) => (
          <LedgerRowItem key={row.company + i} row={row} />
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

function PendingRow({ inv, isFirst }: { inv: SavedInvoice; isFirst: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderTop: isFirst ? 'none' : '1px solid var(--border2)' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {inv.company || inv.contactName || 'Unknown'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
          {[inv.city, inv.state].filter(Boolean).join(', ')} · {inv.date}
        </div>
      </div>
      <div style={{ fontSize: 15, fontWeight: 800, color: '#ff9500', flexShrink: 0, marginLeft: 12 }}>
        {money(inv.total)}
      </div>
    </div>
  )
}

function PaymentBreakdownRow({ label, amount, count, color, divider }: { label: string; amount: number; count: number; color: string; divider?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', borderTop: divider ? '1px solid var(--border2)' : 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <div style={{ fontSize: 14, fontWeight: 700 }}>{label}</div>
        <div style={{ fontSize: 12, color: 'var(--text3)' }}>{count} invoice{count !== 1 ? 's' : ''}</div>
      </div>
      <div style={{ fontSize: 15, fontWeight: 800, color }}>{money(amount)}</div>
    </div>
  )
}

function LedgerRowItem({ row }: { row: LedgerRow }) {
  return (
    <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border2)' }}>
      <div style={{ fontSize: 14, fontWeight: 800, lineHeight: 1.3, marginBottom: 2 }}>
        {row.company}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 10 }}>
        {[row.city, row.state].filter(Boolean).join(', ')} · {row.invoiceCount} inv · Last: {row.lastDate}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
        {[
          { label: 'Sold', value: money(row.totalSold), color: 'var(--accent)' },
          { label: 'Paid', value: money(row.totalPaid), color: '#34c759' },
          { label: 'Pending', value: row.totalPending > 0 ? money(row.totalPending) : '—', color: row.totalPending > 0 ? '#ff9500' : 'var(--text3)' },
        ].map(({ label, value, color }) => (
          <div key={label}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
            <div style={{ fontSize: 13, fontWeight: 800, color }}>{value}</div>
          </div>
        ))}
      </div>
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
