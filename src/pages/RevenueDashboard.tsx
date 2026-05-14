import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { SavedInvoice } from '../types/invoice'
import { printSavedInvoice } from '../lib/invoicePrint'

// ─── Supabase ────────────────────────────────────────────────────────────────

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string
const APP_PASSWORD = (import.meta.env.VITE_APP_PASSWORD as string) ?? ''
const AUTH_KEY = 'dash_auth_v1'

async function fetchInvoices(): Promise<SavedInvoice[]> {
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY)
  const { data, error } = await sb.from('invoices').select('*').order('saved_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({
    id: r.id, contactId: r.contact_id, company: r.company,
    contactName: r.contact_name, state: r.state, city: r.city,
    date: r.date, docKind: r.doc_kind, paidBy: r.paid_by,
    items: r.items ?? [], total: Number(r.total),
    notes: r.notes, saved_at: r.saved_at,
  })) as SavedInvoice[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function money(v: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v)
}

function moneyFull(v: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(v)
}

function formatMonth(ym: string) {
  const [y, m] = ym.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString('en-US', { month: 'short', year: '2-digit' })
}

function exportCSV(invoices: SavedInvoice[]) {
  const headers = ['Date', 'Company', 'State', 'City', 'Type', 'Paid By', 'Items', 'Total', 'Notes']
  const rows = invoices.map((inv) => [
    inv.date,
    inv.company,
    inv.state,
    inv.city,
    inv.docKind,
    inv.paidBy,
    inv.items.map((it) => `${it.size} x${it.pcs} ${it.ct}ct`).join('; '),
    inv.total.toFixed(2),
    inv.notes,
  ].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
  const blob = new Blob([[headers.join(','), ...rows].join('\n')], { type: 'text/csv' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
  a.download = `invoices_${new Date().toISOString().slice(0, 10)}.csv`; a.click()
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const ACCENT = '#0066ff'
const GREEN = '#16a34a'
const ORANGE = '#ea580c'
const BORDER = '#e5e7eb'
const BG = '#f9fafb'
const CARD_BG = '#ffffff'
const TEXT = '#111827'
const TEXT2 = '#6b7280'
const TEXT3 = '#9ca3af'

// ─── Password gate ───────────────────────────────────────────────────────────

function PasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (pw === APP_PASSWORD) { sessionStorage.setItem(AUTH_KEY, pw); onUnlock() }
    else setErr('Incorrect password')
  }
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: BG, fontFamily: "'DM Sans', sans-serif" }}>
      <form onSubmit={submit} style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 32, width: 360, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 4, color: TEXT }}>Revenue Dashboard</div>
        <div style={{ fontSize: 14, color: TEXT2, marginBottom: 24 }}>Delta Diamonds — Protected</div>
        <input type="password" value={pw} onChange={(e) => { setPw(e.target.value); setErr('') }}
          placeholder="Access password" autoFocus
          style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: `1.5px solid ${err ? '#ef4444' : BORDER}`, fontSize: 15, marginBottom: 10, boxSizing: 'border-box', outline: 'none' }} />
        {err && <div style={{ color: '#ef4444', fontSize: 13, marginBottom: 10 }}>{err}</div>}
        <button type="submit" style={{ width: '100%', padding: '12px', borderRadius: 10, border: 'none', background: ACCENT, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
          Unlock
        </button>
      </form>
    </div>
  )
}

// ─── Stat card ───────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '20px 22px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: TEXT3, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: color ?? TEXT, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: TEXT2, marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

// ─── Monthly chart ───────────────────────────────────────────────────────────

function MonthlyChart({ invoices }: { invoices: SavedInvoice[] }) {
  const rows = useMemo(() => {
    const map = new Map<string, { sold: number; count: number }>()
    invoices.forEach((inv) => {
      const key = inv.date.slice(0, 7)
      const r = map.get(key) ?? { sold: 0, count: 0 }
      r.sold += inv.total; r.count += 1; map.set(key, r)
    })
    const sorted = Array.from(map.entries())
      .map(([key, v]) => ({ key, label: formatMonth(key), ...v }))
      .sort((a, b) => a.key.localeCompare(b.key))
      .slice(-12)
    const max = Math.max(...sorted.map((r) => r.sold), 1)
    return sorted.map((r) => ({ ...r, pct: (r.sold / max) * 100 }))
  }, [invoices])

  if (!rows.length) return null

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '22px 24px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: TEXT3, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 16 }}>Revenue by Month</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((row) => (
          <div key={row.key}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>{row.label}</div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{ fontSize: 12, color: TEXT2 }}>{row.count} inv</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: ACCENT, minWidth: 80, textAlign: 'right' }}>{money(row.sold)}</div>
              </div>
            </div>
            <div style={{ height: 8, borderRadius: 99, background: '#f3f4f6', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${row.pct}%`, borderRadius: 99, background: ACCENT, transition: 'width 0.5s ease' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── State chart ─────────────────────────────────────────────────────────────

function StateChart({ invoices }: { invoices: SavedInvoice[] }) {
  const rows = useMemo(() => {
    const map = new Map<string, { sold: number; pending: number; count: number }>()
    invoices.forEach((inv) => {
      if (!inv.state) return
      const r = map.get(inv.state) ?? { sold: 0, pending: 0, count: 0 }
      r.sold += inv.total; if (inv.paidBy === 'pending') r.pending += inv.total; r.count += 1
      map.set(inv.state, r)
    })
    const sorted = Array.from(map.entries()).map(([key, v]) => ({ key, ...v })).sort((a, b) => b.sold - a.sold)
    const max = Math.max(...sorted.map((r) => r.sold), 1)
    return sorted.map((r) => ({ ...r, pct: (r.sold / max) * 100 }))
  }, [invoices])

  if (!rows.length) return null

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '22px 24px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: TEXT3, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 16 }}>Revenue by State</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((row) => (
          <div key={row.key}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>{row.key}</div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                {row.pending > 0 && <div style={{ fontSize: 12, color: ORANGE }}>{money(row.pending)} pending</div>}
                <div style={{ fontSize: 12, color: TEXT2 }}>{row.count} inv</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: ACCENT, minWidth: 80, textAlign: 'right' }}>{money(row.sold)}</div>
              </div>
            </div>
            <div style={{ height: 8, borderRadius: 99, background: '#f3f4f6', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${row.pct}%`, borderRadius: 99, background: GREEN }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Payment breakdown ───────────────────────────────────────────────────────

function PaymentBreakdown({ invoices }: { invoices: SavedInvoice[] }) {
  const stats = useMemo(() => {
    const cash = invoices.filter((i) => i.paidBy === 'cash')
    const check = invoices.filter((i) => i.paidBy === 'check')
    const pending = invoices.filter((i) => i.paidBy === 'pending')
    const sum = (arr: SavedInvoice[]) => arr.reduce((s, i) => s + i.total, 0)
    return [
      { label: 'Cash', amount: sum(cash), count: cash.length, color: GREEN },
      { label: 'Check', amount: sum(check), count: check.length, color: ACCENT },
      { label: 'Pending', amount: sum(pending), count: pending.length, color: ORANGE },
    ]
  }, [invoices])

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '22px 24px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: TEXT3, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 16 }}>Payment Breakdown</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {stats.map((s, i) => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 0', borderTop: i ? `1px solid ${BORDER}` : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: s.color }} />
              <div style={{ fontSize: 15, fontWeight: 600, color: TEXT }}>{s.label}</div>
              <div style={{ fontSize: 13, color: TEXT2 }}>{s.count} invoice{s.count !== 1 ? 's' : ''}</div>
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: s.color }}>{money(s.amount)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Invoice detail row ──────────────────────────────────────────────────────

function InvoiceDetailRow({ inv }: { inv: SavedInvoice }) {
  const paidColor = inv.paidBy === 'pending' ? ORANGE : inv.paidBy === 'cash' ? GREEN : ACCENT
  return (
    <div style={{ background: inv.paidBy === 'pending' ? '#fff7ed' : '#f9fafb', border: `1px solid ${BORDER}`, borderRadius: 10, padding: '14px 16px', marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>{inv.date}</div>
          <div style={{ fontSize: 12, color: TEXT2, marginTop: 2 }}>
            {inv.docKind.toUpperCase()} · <span style={{ color: paidColor, fontWeight: 700 }}>{inv.paidBy.toUpperCase()}</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: paidColor }}>{moneyFull(inv.total)}</div>
          <button
            onClick={() => printSavedInvoice(inv)}
            style={{ padding: '6px 14px', borderRadius: 8, border: `1.5px solid ${BORDER}`, background: '#fff', fontSize: 12, fontWeight: 700, color: TEXT2, cursor: 'pointer' }}
          >
            🖨 Re-print
          </button>
        </div>
      </div>
      {inv.items.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: TEXT3 }}>
              {['Size', 'Pcs', 'Ct', 'P/Ct', 'Amount'].map((h, i) => (
                <th key={h} style={{ textAlign: i === 0 ? 'left' : 'right', padding: '4px 6px', fontWeight: 700, borderBottom: `1px solid ${BORDER}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {inv.items.map((item, i) => (
              <tr key={i}>
                <td style={{ padding: '4px 6px', borderBottom: `1px solid ${BORDER}`, fontWeight: 600 }}>{item.size}</td>
                <td style={{ padding: '4px 6px', borderBottom: `1px solid ${BORDER}`, textAlign: 'right' }}>{item.pcs}</td>
                <td style={{ padding: '4px 6px', borderBottom: `1px solid ${BORDER}`, textAlign: 'right' }}>{item.ct.toFixed(2)}</td>
                <td style={{ padding: '4px 6px', borderBottom: `1px solid ${BORDER}`, textAlign: 'right' }}>{moneyFull(item.pct)}</td>
                <td style={{ padding: '4px 6px', borderBottom: `1px solid ${BORDER}`, textAlign: 'right', fontWeight: 700 }}>{moneyFull(item.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {inv.notes && <div style={{ fontSize: 12, color: TEXT2, marginTop: 8, fontStyle: 'italic' }}>Note: {inv.notes}</div>}
    </div>
  )
}

// ─── Shop ledger ─────────────────────────────────────────────────────────────

type ShopRow = { key: string; company: string; state: string; city: string; invoiceCount: number; totalSold: number; totalPaid: number; totalPending: number; lastDate: string; invoices: SavedInvoice[] }

function ShopLedger({ invoices }: { invoices: SavedInvoice[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const shops = useMemo<ShopRow[]>(() => {
    const map = new Map<string, ShopRow>()
    invoices.forEach((inv) => {
      const key = inv.contactId || inv.company
      const row = map.get(key) ?? { key, company: inv.company || inv.contactName || 'Unknown', state: inv.state, city: inv.city, invoiceCount: 0, totalSold: 0, totalPaid: 0, totalPending: 0, lastDate: inv.date, invoices: [] }
      row.invoiceCount += 1
      row.totalSold += inv.total
      if (inv.paidBy === 'pending') row.totalPending += inv.total
      else row.totalPaid += inv.total
      if (inv.date > row.lastDate) row.lastDate = inv.date
      row.invoices.push(inv)
      map.set(key, row)
    })
    return Array.from(map.values()).sort((a, b) => b.totalSold - a.totalSold)
  }, [invoices])

  const toggle = (key: string) => setExpanded((prev) => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
      <div style={{ padding: '18px 24px', borderBottom: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: TEXT3, textTransform: 'uppercase', letterSpacing: '0.6px' }}>Ledger by Shop</div>
        <div style={{ fontSize: 12, color: TEXT2 }}>{shops.length} shops</div>
      </div>
      {/* Table header */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 80px', gap: 0, padding: '10px 24px', background: '#f9fafb', borderBottom: `1px solid ${BORDER}` }}>
        {['Shop', 'Sold', 'Paid', 'Pending', 'Last Sale', ''].map((h) => (
          <div key={h} style={{ fontSize: 11, fontWeight: 700, color: TEXT3, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</div>
        ))}
      </div>
      {shops.map((shop) => (
        <div key={shop.key}>
          <div
            onClick={() => toggle(shop.key)}
            style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 80px', gap: 0, padding: '14px 24px', borderBottom: `1px solid ${BORDER}`, cursor: 'pointer', background: expanded.has(shop.key) ? '#f0f7ff' : CARD_BG, transition: 'background 0.15s' }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>{shop.company}</div>
              <div style={{ fontSize: 12, color: TEXT2, marginTop: 2 }}>{[shop.city, shop.state].filter(Boolean).join(', ')} · {shop.invoiceCount} inv</div>
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: ACCENT, alignSelf: 'center' }}>{money(shop.totalSold)}</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: GREEN, alignSelf: 'center' }}>{money(shop.totalPaid)}</div>
            <div style={{ fontSize: 14, fontWeight: shop.totalPending > 0 ? 700 : 400, color: shop.totalPending > 0 ? ORANGE : TEXT3, alignSelf: 'center' }}>
              {shop.totalPending > 0 ? money(shop.totalPending) : '—'}
            </div>
            <div style={{ fontSize: 13, color: TEXT2, alignSelf: 'center' }}>{shop.lastDate}</div>
            <div style={{ fontSize: 13, color: ACCENT, fontWeight: 700, alignSelf: 'center', textAlign: 'right' }}>
              {expanded.has(shop.key) ? '▲ Hide' : '▼ Show'}
            </div>
          </div>
          {expanded.has(shop.key) && (
            <div style={{ padding: '16px 24px', background: '#f8faff', borderBottom: `1px solid ${BORDER}` }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: TEXT3, textTransform: 'uppercase', marginBottom: 10 }}>Invoice History</div>
              {shop.invoices.sort((a, b) => b.date.localeCompare(a.date)).map((inv) => (
                <InvoiceDetailRow key={inv.id} inv={inv} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Main dashboard ──────────────────────────────────────────────────────────

export function RevenueDashboard() {
  const [unlocked, setUnlocked] = useState(
    !APP_PASSWORD || sessionStorage.getItem(AUTH_KEY) === APP_PASSWORD
  )
  const [invoices, setInvoices] = useState<SavedInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const load = async () => {
    setLoading(true); setError('')
    try {
      const data = await fetchInvoices()
      setInvoices(data); setLastRefresh(new Date())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (unlocked) { void load() } }, [unlocked])

  const summary = useMemo(() => {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    let total = 0, thisMonth = 0, pending = 0
    invoices.forEach((inv) => {
      total += inv.total
      if (inv.paidBy === 'pending') pending += inv.total
      if (new Date(inv.saved_at) >= monthStart) thisMonth += inv.total
    })
    return { total, thisMonth, pending, count: invoices.length }
  }, [invoices])

  if (!unlocked) return <PasswordGate onUnlock={() => setUnlocked(true)} />

  const baseStyle: React.CSSProperties = {
    fontFamily: "'DM Sans', sans-serif",
    background: BG,
    minHeight: '100vh',
    color: TEXT,
  }

  return (
    <div style={baseStyle}>
      {/* Header */}
      <div style={{ background: CARD_BG, borderBottom: `1px solid ${BORDER}`, padding: '0 32px' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 64 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <img src="/delta-logo.png" alt="Delta Diamonds" style={{ height: 32, objectFit: 'contain' }} />
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: TEXT }}>Revenue Dashboard</div>
              <div style={{ fontSize: 12, color: TEXT2 }}>Delta Diamonds Inc.</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {lastRefresh && <div style={{ fontSize: 12, color: TEXT3 }}>Updated {lastRefresh.toLocaleTimeString()}</div>}
            <button onClick={load} disabled={loading}
              style={{ padding: '8px 16px', borderRadius: 8, border: `1.5px solid ${BORDER}`, background: CARD_BG, fontSize: 13, fontWeight: 700, color: TEXT2, cursor: 'pointer' }}>
              {loading ? 'Loading…' : '↻ Refresh'}
            </button>
            <button onClick={() => exportCSV(invoices)}
              style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: ACCENT, fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer' }}>
              ↓ Export CSV
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 32px 60px' }}>
        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 16px', marginBottom: 20, color: '#dc2626', fontSize: 14 }}>
            ❌ {error} — Check your Supabase credentials or run the SQL schema in Settings.
          </div>
        )}

        {loading && !invoices.length ? (
          <div style={{ textAlign: 'center', padding: '80px 0', color: TEXT3, fontSize: 15 }}>Loading invoices from Supabase…</div>
        ) : invoices.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🧾</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: TEXT, marginBottom: 6 }}>No invoices yet</div>
            <div style={{ color: TEXT2 }}>Create invoices in the app — they will appear here automatically.</div>
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
              <StatCard label="Total Revenue" value={money(summary.total)} color={ACCENT} />
              <StatCard label="This Month" value={money(summary.thisMonth)} />
              <StatCard label="Pending Collection" value={money(summary.pending)} color={summary.pending > 0 ? ORANGE : TEXT} sub={summary.pending > 0 ? 'Needs follow-up' : 'All collected'} />
              <StatCard label="Total Invoices" value={String(summary.count)} sub="All time" />
            </div>

            {/* Charts row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
              <MonthlyChart invoices={invoices} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <StateChart invoices={invoices} />
                <PaymentBreakdown invoices={invoices} />
              </div>
            </div>

            {/* Shop ledger — full width */}
            <ShopLedger invoices={invoices} />
          </>
        )}
      </div>
    </div>
  )
}
