import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { SavedInvoice } from '../types/invoice'
import { printSavedInvoice } from '../lib/invoicePrint'

// ─── Supabase ────────────────────────────────────────────────────────────────

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string
const APP_PASSWORD = (import.meta.env.VITE_APP_PASSWORD as string) ?? ''
const AUTH_KEY     = 'dash_auth_v1'

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

// ─── Types ───────────────────────────────────────────────────────────────────

type Period = '30d' | '90d' | '6m' | '1y' | 'all'

// ─── Design tokens ───────────────────────────────────────────────────────────

const BLUE   = '#2563eb'
const GREEN  = '#16a34a'
const ORANGE = '#ea580c'
const PURPLE = '#7c3aed'
const RED    = '#dc2626'
const TEAL   = '#0891b2'
const AMBER  = '#d97706'

const PAGE_BG   = '#f8fafc'
const CARD_BG   = '#ffffff'
const TEXT      = '#0f172a'
const TEXT2     = '#475569'
const TEXT3     = '#94a3b8'
const BORDER    = '#e2e8f0'
const HEADER_BG = '#0f172a'

const card: React.CSSProperties = {
  background: CARD_BG,
  border: `1px solid ${BORDER}`,
  borderRadius: 16,
  boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
  overflow: 'hidden',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function money(v: number, decimals = 0) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  }).format(v)
}

function fmtMonthShort(ym: string) {
  const [y, m] = ym.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString('en-US', { month: 'short', year: '2-digit' })
}

function fmtMonthLong(ym: string) {
  const [y, m] = ym.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })
}

function daysAgo(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000)
}

function trendPct(curr: number, prev: number): number | null {
  if (prev === 0) return null
  return ((curr - prev) / prev) * 100
}

function periodBounds(period: Period): { currStart: Date | null; prevStart: Date; prevEnd: Date } {
  const now = new Date()
  if (period === 'all') {
    return {
      currStart: null,
      prevStart: new Date(now.getFullYear() - 1, 0, 1),
      prevEnd:   new Date(now.getFullYear(), 0, 0),
    }
  }
  const days = { '30d': 30, '90d': 90, '6m': 182, '1y': 365 }[period]
  const ms        = days * 86_400_000
  const currStart = new Date(now.getTime() - ms)
  const prevEnd   = new Date(currStart.getTime() - 1)
  const prevStart = new Date(prevEnd.getTime() - ms)
  return { currStart, prevStart, prevEnd }
}

function filterByPeriod(invs: SavedInvoice[], period: Period): SavedInvoice[] {
  const { currStart } = periodBounds(period)
  if (!currStart) return invs
  return invs.filter((i) => new Date(i.date) >= currStart)
}

function groupByMonth(invs: SavedInvoice[]) {
  const map = new Map<string, SavedInvoice[]>()
  const sorted = [...invs].sort((a, b) => b.date.localeCompare(a.date))
  sorted.forEach((inv) => {
    const k = inv.date.slice(0, 7)
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(inv)
  })
  return Array.from(map.entries()).map(([k, list]) => ({
    month: k, label: fmtMonthLong(k),
    invoices: list,
    total: list.reduce((s, i) => s + i.total, 0),
  }))
}

function exportCSV(invoices: SavedInvoice[]) {
  const headers = ['Date','Company','State','City','Type','Paid By','Items','Total','Notes']
  const rows = invoices.map((inv) => [
    inv.date, inv.company, inv.state, inv.city, inv.docKind, inv.paidBy,
    inv.items.map((it) => `${it.size} x${it.pcs} ${it.ct}ct`).join('; '),
    inv.total.toFixed(2), inv.notes,
  ].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
  const blob = new Blob([[headers.join(','), ...rows].join('\n')], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `delta-invoices-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
}

// ─── Password gate ───────────────────────────────────────────────────────────

function PasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [pw, setPw] = useState(''); const [err, setErr] = useState('')
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: PAGE_BG, fontFamily: 'system-ui, sans-serif' }}>
      <form onSubmit={(e) => { e.preventDefault(); if (pw === APP_PASSWORD) { sessionStorage.setItem(AUTH_KEY, pw); onUnlock() } else setErr('Incorrect password') }}
        style={{ ...card, padding: 40, width: 380 }}>
        <div style={{ fontSize: 24, fontWeight: 800, color: TEXT, marginBottom: 4 }}>Revenue Dashboard</div>
        <div style={{ fontSize: 14, color: TEXT2, marginBottom: 28 }}>Delta Diamonds — Protected</div>
        <input type="password" value={pw} onChange={(e) => { setPw(e.target.value); setErr('') }}
          placeholder="Access password" autoFocus
          style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: `1.5px solid ${err ? RED : BORDER}`, fontSize: 15, marginBottom: 10, boxSizing: 'border-box', outline: 'none', color: TEXT }} />
        {err && <div style={{ color: RED, fontSize: 13, marginBottom: 10 }}>{err}</div>}
        <button type="submit" style={{ width: '100%', padding: 13, borderRadius: 10, border: 'none', background: BLUE, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>Unlock</button>
      </form>
    </div>
  )
}

// ─── Custom dark tooltip (shared by charts) ──────────────────────────────────

function DarkTooltip({ active, payload, label, formatter }: {
  active?: boolean; payload?: Array<{ name: string; value: number; color: string }>
  label?: string; formatter?: (v: number, name: string) => string
}) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#1e293b', borderRadius: 10, padding: '12px 16px', boxShadow: '0 8px 24px rgba(0,0,0,0.25)', minWidth: 160 }}>
      {label && <div style={{ color: '#94a3b8', fontSize: 12, fontWeight: 600, marginBottom: 10, letterSpacing: '0.3px' }}>{label}</div>}
      {payload.map((p) => (
        <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 20, marginBottom: 5, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: p.color, flexShrink: 0 }} />
            <div style={{ color: '#94a3b8', fontSize: 12 }}>{p.name}</div>
          </div>
          <div style={{ color: '#f1f5f9', fontSize: 13, fontWeight: 700 }}>
            {formatter ? formatter(p.value, p.name) : money(p.value)}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── KPI card ────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, trend, trendInverse, accentColor }: {
  label: string; value: string; sub?: string
  trend?: number | null; trendInverse?: boolean; accentColor?: string
}) {
  const isUp   = (trend ?? 0) >= 0
  const isGood = trendInverse ? !isUp : isUp
  const trendColor = isGood ? GREEN : RED

  return (
    <div style={{ ...card, padding: '22px 24px', borderTop: `3px solid ${accentColor ?? BLUE}` }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: TEXT3, textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 10 }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 800, color: TEXT, lineHeight: 1, marginBottom: 8 }}>{value}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {sub && <div style={{ fontSize: 13, color: TEXT2 }}>{sub}</div>}
        {trend !== null && trend !== undefined && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: isGood ? '#f0fdf4' : '#fef2f2', padding: '3px 8px', borderRadius: 99 }}>
            <span style={{ color: trendColor, fontSize: 11 }}>{isUp ? '▲' : '▼'}</span>
            <span style={{ color: trendColor, fontSize: 12, fontWeight: 700 }}>{Math.abs(trend).toFixed(1)}%</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: TEXT }}>{title}</div>
      {sub && <div style={{ fontSize: 12, color: TEXT2, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

// ─── Revenue trend chart ──────────────────────────────────────────────────────

function RevenueTrendChart({ invoices }: { invoices: SavedInvoice[] }) {
  const data = useMemo(() => {
    const map = new Map<string, { total: number; collected: number; count: number }>()
    invoices.forEach((inv) => {
      const k = inv.date.slice(0, 7)
      const r = map.get(k) ?? { total: 0, collected: 0, count: 0 }
      r.total += inv.total
      if (inv.paidBy !== 'pending' && inv.docKind !== 'memo') r.collected += inv.total
      r.count += 1; map.set(k, r)
    })
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => ({ month: fmtMonthShort(k), Total: Math.round(v.total), Collected: Math.round(v.collected), Invoices: v.count }))
  }, [invoices])

  if (!data.length) return <EmptyChart />

  return (
    <div style={{ ...card, padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <SectionHeader title="Revenue Trend" sub="Monthly invoiced vs collected" />
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <LegendDot color={BLUE}  label="Total Billed" />
          <LegendDot color={GREEN} label="Collected" />
        </div>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 10 }}>
          <defs>
            <linearGradient id="gradTotal" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={BLUE}  stopOpacity={0.18} />
              <stop offset="100%" stopColor={BLUE}  stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradCollected" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={GREEN} stopOpacity={0.18} />
              <stop offset="100%" stopColor={GREEN} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 12, fill: TEXT3 }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} tick={{ fontSize: 11, fill: TEXT3 }} axisLine={false} tickLine={false} width={52} />
          <Tooltip content={<DarkTooltip />} />
          <Area type="monotone" dataKey="Total"     stroke={BLUE}  strokeWidth={2.5} fill="url(#gradTotal)"     name="Total Billed" />
          <Area type="monotone" dataKey="Collected" stroke={GREEN} strokeWidth={2.5} fill="url(#gradCollected)" name="Collected" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Invoice activity chart ────────────────────────────────────────────────────

function InvoiceActivityChart({ invoices }: { invoices: SavedInvoice[] }) {
  const data = useMemo(() => {
    const map = new Map<string, { invoices: number; memos: number }>()
    invoices.forEach((inv) => {
      const k = inv.date.slice(0, 7)
      const r = map.get(k) ?? { invoices: 0, memos: 0 }
      if (inv.docKind === 'memo') r.memos += 1; else r.invoices += 1
      map.set(k, r)
    })
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => ({ month: fmtMonthShort(k), Invoices: v.invoices, Memos: v.memos }))
  }, [invoices])

  if (!data.length) return <EmptyChart />

  return (
    <div style={{ ...card, padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <SectionHeader title="Invoice Activity" sub="Monthly invoice & memo count" />
        <div style={{ display: 'flex', gap: 16 }}>
          <LegendDot color={BLUE}   label="Invoices" />
          <LegendDot color={PURPLE} label="Memos" />
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barSize={14} barGap={3}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 12, fill: TEXT3 }} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: TEXT3 }} axisLine={false} tickLine={false} width={28} />
          <Tooltip content={<DarkTooltip formatter={(v) => String(v)} />} />
          <Bar dataKey="Invoices" fill={BLUE}   radius={[4, 4, 0, 0]} name="Invoices" />
          <Bar dataKey="Memos"    fill={PURPLE} radius={[4, 4, 0, 0]} name="Memos" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Payment methods donut ────────────────────────────────────────────────────

function PaymentDonut({ invoices }: { invoices: SavedInvoice[] }) {
  const data = useMemo(() => {
    const cash    = invoices.filter((i) => i.paidBy === 'cash'    && i.docKind !== 'memo').reduce((s, i) => s + i.total, 0)
    const check   = invoices.filter((i) => i.paidBy === 'check'   && i.docKind !== 'memo').reduce((s, i) => s + i.total, 0)
    const pending = invoices.filter((i) => i.paidBy === 'pending').reduce((s, i) => s + i.total, 0)
    const memo    = invoices.filter((i) => i.docKind === 'memo').reduce((s, i) => s + i.total, 0)
    return [
      { name: 'Cash',    value: Math.round(cash),    color: GREEN,  fill: GREEN  },
      { name: 'Check',   value: Math.round(check),   color: BLUE,   fill: BLUE   },
      { name: 'Pending', value: Math.round(pending), color: ORANGE, fill: ORANGE },
      { name: 'Memo',    value: Math.round(memo),    color: PURPLE, fill: PURPLE },
    ].filter((d) => d.value > 0)
  }, [invoices])

  const total = data.reduce((s, d) => s + d.value, 0)

  if (!data.length) return <EmptyChart />

  return (
    <div style={{ ...card, padding: '24px' }}>
      <SectionHeader title="Payment Methods" sub="Revenue by collection type" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <PieChart width={180} height={180}>
            <Pie data={data} cx={88} cy={88} innerRadius={54} outerRadius={82} dataKey="value" stroke="none" startAngle={90} endAngle={-270} />
            <Tooltip content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const d = payload[0]
              return (
                <div style={{ background: '#1e293b', borderRadius: 10, padding: '10px 14px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>{d.name}</div>
                  <div style={{ color: '#f1f5f9', fontSize: 14, fontWeight: 700 }}>{money(Number(d.value))}</div>
                  <div style={{ color: '#64748b', fontSize: 12 }}>{total > 0 ? ((Number(d.value) / total) * 100).toFixed(1) : 0}%</div>
                </div>
              )
            }} />
          </PieChart>
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>{money(total)}</div>
            <div style={{ fontSize: 10, color: TEXT3 }}>total</div>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          {data.map((d) => (
            <div key={d.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderBottom: `1px solid ${BORDER}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 10, height: 10, borderRadius: 3, background: d.color }} />
                <div style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>{d.name}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: d.color }}>{money(d.value)}</div>
                <div style={{ fontSize: 11, color: TEXT3 }}>{total > 0 ? ((d.value / total) * 100).toFixed(1) : 0}%</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Revenue by state chart ────────────────────────────────────────────────────

function StateRevenueChart({ invoices }: { invoices: SavedInvoice[] }) {
  const data = useMemo(() => {
    const map = new Map<string, { Revenue: number; Pending: number }>()
    invoices.forEach((inv) => {
      if (!inv.state) return
      const r = map.get(inv.state) ?? { Revenue: 0, Pending: 0 }
      r.Revenue += inv.total
      if (inv.paidBy === 'pending') r.Pending += inv.total
      map.set(inv.state, r)
    })
    return Array.from(map.entries())
      .map(([state, v]) => ({ state, Revenue: Math.round(v.Revenue), Pending: Math.round(v.Pending) }))
      .sort((a, b) => b.Revenue - a.Revenue).slice(0, 10)
  }, [invoices])

  if (!data.length) return <EmptyChart />

  return (
    <div style={{ ...card, padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <SectionHeader title="Revenue by State" sub="Top 10 states by billed amount" />
        <div style={{ display: 'flex', gap: 16 }}>
          <LegendDot color={BLUE}   label="Total" />
          <LegendDot color={ORANGE} label="Pending" />
        </div>
      </div>
      <ResponsiveContainer width="100%" height={Math.max(220, data.length * 34)}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 0, bottom: 0, left: 16 }} barSize={10} barGap={2}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
          <XAxis type="number" tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} tick={{ fontSize: 11, fill: TEXT3 }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="state" tick={{ fontSize: 12, fill: TEXT2, fontWeight: 600 }} axisLine={false} tickLine={false} width={28} />
          <Tooltip content={<DarkTooltip />} />
          <Bar dataKey="Revenue" fill={BLUE}   radius={[0, 4, 4, 0]} name="Total" />
          <Bar dataKey="Pending" fill={ORANGE} radius={[0, 4, 4, 0]} name="Pending" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Product mix chart ────────────────────────────────────────────────────────

function ProductMixChart({ invoices }: { invoices: SavedInvoice[] }) {
  const data = useMemo(() => {
    const map = new Map<string, number>()
    invoices.forEach((inv) => {
      inv.items.forEach((item) => {
        const parts = item.size.trim().split(/\s+/)
        const key = parts[0] || 'Other'
        map.set(key, (map.get(key) ?? 0) + item.amount)
      })
    })
    const sorted = Array.from(map.entries())
      .map(([name, value]) => ({ name, Revenue: Math.round(value) }))
      .sort((a, b) => b.Revenue - a.Revenue).slice(0, 8)
    return sorted
  }, [invoices])

  const COLORS = [BLUE, TEAL, GREEN, AMBER, PURPLE, ORANGE, '#06b6d4', '#84cc16']
  const coloredData = data.map((d, i) => ({ ...d, fill: COLORS[i % COLORS.length] }))

  if (!coloredData.length) return <EmptyChart />

  return (
    <div style={{ ...card, padding: '24px' }}>
      <SectionHeader title="Product Mix" sub="Revenue by size prefix" />
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={coloredData} margin={{ top: 4, right: 4, bottom: 20, left: 10 }} barSize={32}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 12, fill: TEXT2, fontWeight: 600 }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} tick={{ fontSize: 11, fill: TEXT3 }} axisLine={false} tickLine={false} width={48} />
          <Tooltip content={<DarkTooltip />} />
          <Bar dataKey="Revenue" name="Revenue" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Top customers leaderboard ────────────────────────────────────────────────

function TopCustomers({ invoices }: { invoices: SavedInvoice[] }) {
  const customers = useMemo(() => {
    const map = new Map<string, { total: number; paid: number; count: number; hasPending: boolean }>()
    invoices.forEach((inv) => {
      const key = inv.company || inv.contactName || 'Unknown'
      const r = map.get(key) ?? { total: 0, paid: 0, count: 0, hasPending: false }
      r.total += inv.total; r.count += 1
      if (inv.paidBy !== 'pending' && inv.docKind !== 'memo') r.paid += inv.total
      if (inv.paidBy === 'pending') r.hasPending = true
      map.set(key, r)
    })
    const sorted = Array.from(map.entries())
      .map(([name, v]) => ({ name, ...v, collectRate: v.total > 0 ? (v.paid / v.total) * 100 : 0 }))
      .sort((a, b) => b.total - a.total).slice(0, 9)
    const maxTotal = sorted[0]?.total ?? 1
    return sorted.map((r, i) => ({ ...r, rank: i + 1, barPct: (r.total / maxTotal) * 100 }))
  }, [invoices])

  return (
    <div style={{ ...card, padding: '24px' }}>
      <SectionHeader title="Top Customers" sub="Ranked by total billed value" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {customers.map((c, i) => (
          <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: i ? `1px solid ${BORDER}` : 'none' }}>
            <div style={{ width: 24, height: 24, borderRadius: 8, background: i < 3 ? [AMBER, '#94a3b8', '#cd7f32'][i] : '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: i < 3 ? '#fff' : TEXT3, flexShrink: 0 }}>
              {c.rank}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '55%' }}>{c.name}</div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
                  <div style={{ fontSize: 11, color: c.collectRate < 70 ? ORANGE : GREEN, fontWeight: 700 }}>{c.collectRate.toFixed(0)}% paid</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>{money(c.total)}</div>
                </div>
              </div>
              <div style={{ height: 5, borderRadius: 99, background: '#f1f5f9', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${c.barPct}%`, borderRadius: 99, background: `linear-gradient(90deg, ${BLUE}, ${TEAL})`, transition: 'width 0.5s ease' }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Collection efficiency card ───────────────────────────────────────────────

function CollectionCard({ invoices }: { invoices: SavedInvoice[] }) {
  const stats = useMemo(() => {
    const total      = invoices.reduce((s, i) => s + i.total, 0)
    const collected  = invoices.filter((i) => i.paidBy !== 'pending' && i.docKind !== 'memo').reduce((s, i) => s + i.total, 0)
    const pending    = invoices.filter((i) => i.paidBy === 'pending').reduce((s, i) => s + i.total, 0)
    const rate       = total > 0 ? (collected / total) * 100 : 0
    const avgDays    = invoices.filter((i) => i.paidBy === 'pending').map((i) => daysAgo(i.date))
    const avgOverdue = avgDays.length ? avgDays.reduce((a, b) => a + b, 0) / avgDays.length : 0
    const overdue30  = invoices.filter((i) => i.paidBy === 'pending' && daysAgo(i.date) > 30).length
    return { rate, collected, pending, total, avgOverdue, overdue30 }
  }, [invoices])

  const circumference = 2 * Math.PI * 44
  const dash = (stats.rate / 100) * circumference

  return (
    <div style={{ ...card, padding: '24px' }}>
      <SectionHeader title="Collection Efficiency" sub="Payment collection performance" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        {/* Ring gauge */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <svg width={110} height={110}>
            <circle cx={55} cy={55} r={44} fill="none" stroke="#f1f5f9" strokeWidth={10} />
            <circle cx={55} cy={55} r={44} fill="none"
              stroke={stats.rate >= 80 ? GREEN : stats.rate >= 60 ? AMBER : RED}
              strokeWidth={10} strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference}`}
              transform="rotate(-90 55 55)"
              style={{ transition: 'stroke-dasharray 0.6s ease' }}
            />
          </svg>
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: TEXT }}>{stats.rate.toFixed(0)}%</div>
            <div style={{ fontSize: 10, color: TEXT3 }}>collected</div>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          {[
            { label: 'Collected', value: money(stats.collected), color: GREEN },
            { label: 'Outstanding', value: money(stats.pending), color: ORANGE },
            { label: 'Avg days overdue', value: `${stats.avgOverdue.toFixed(0)}d`, color: stats.avgOverdue > 30 ? RED : TEXT2 },
            { label: '30d+ overdue', value: `${stats.overdue30} inv`, color: stats.overdue30 > 0 ? RED : TEXT2 },
          ].map((row, i) => (
            <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderTop: i ? `1px solid ${BORDER}` : 'none' }}>
              <div style={{ fontSize: 12, color: TEXT2 }}>{row.label}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: row.color }}>{row.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Pending receivables table ─────────────────────────────────────────────────

function PendingTable({ invoices, onMarkPaid }: {
  invoices: SavedInvoice[]
  onMarkPaid: (id: string, paidBy: 'cash' | 'check') => void
}) {
  const [pickerOpen, setPickerOpen] = useState<string | null>(null)

  const rows = useMemo(() =>
    invoices.filter((i) => i.paidBy === 'pending')
      .map((i) => ({ ...i, days: daysAgo(i.date) }))
      .sort((a, b) => b.days - a.days),
    [invoices]
  )

  if (!rows.length) return null

  const urgencyColor = (days: number) => days > 30 ? RED : days > 14 ? ORANGE : AMBER

  const totalPending = rows.reduce((s, r) => s + r.total, 0)

  return (
    <div style={{ ...card }}>
      <div style={{ padding: '20px 24px', borderBottom: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fffbeb' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: TEXT }}>⚠️ Pending Receivables</div>
          <div style={{ fontSize: 13, color: TEXT2, marginTop: 2 }}>{rows.length} outstanding invoice{rows.length !== 1 ? 's' : ''} — collect promptly</div>
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: ORANGE }}>{money(totalPending)}</div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8fafc' }}>
              {['Company', 'State', 'Invoice Date', 'Days Outstanding', 'Amount', 'Action'].map((h, i) => (
                <th key={h} style={{ padding: '11px 16px', textAlign: i >= 3 ? 'right' : 'left', fontSize: 11, fontWeight: 700, color: TEXT3, textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: `1px solid ${BORDER}`, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const uc = urgencyColor(row.days)
              return (
                <tr key={row.id} style={{ borderBottom: `1px solid ${BORDER}` }}>
                  <td style={{ padding: '13px 16px', fontWeight: 700, color: TEXT, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.company || row.contactName}</td>
                  <td style={{ padding: '13px 16px', color: TEXT2 }}>{row.state || '—'}</td>
                  <td style={{ padding: '13px 16px', color: TEXT2 }}>{row.date}</td>
                  <td style={{ padding: '13px 16px', textAlign: 'right' }}>
                    <span style={{ background: uc + '18', color: uc, fontWeight: 700, fontSize: 12, padding: '3px 10px', borderRadius: 99 }}>
                      {row.days}d
                    </span>
                  </td>
                  <td style={{ padding: '13px 16px', textAlign: 'right', fontWeight: 800, color: ORANGE, fontSize: 14 }}>{money(row.total)}</td>
                  <td style={{ padding: '13px 16px', textAlign: 'right' }}>
                    {pickerOpen !== row.id ? (
                      <button onClick={() => setPickerOpen(row.id)}
                        style={{ padding: '6px 14px', borderRadius: 8, border: `1.5px solid ${GREEN}`, background: '#fff', fontSize: 12, fontWeight: 700, color: GREEN, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        Mark Paid
                      </button>
                    ) : (
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button onClick={() => { onMarkPaid(row.id, 'cash');  setPickerOpen(null) }} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: GREEN, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Cash</button>
                        <button onClick={() => { onMarkPaid(row.id, 'check'); setPickerOpen(null) }} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: BLUE,  color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Check</button>
                        <button onClick={() => setPickerOpen(null)} style={{ padding: '6px 10px', borderRadius: 8, border: `1px solid ${BORDER}`, background: '#fff', fontSize: 12, color: TEXT2, cursor: 'pointer' }}>✕</button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Invoice detail row (used inside Shop Ledger) ─────────────────────────────

function InvoiceDetailRow({ inv, onMarkPaid, onDelete }: {
  inv: SavedInvoice
  onMarkPaid?: (id: string, paidBy: 'cash' | 'check') => void
  onDelete?: (id: string) => void
}) {
  const [showPicker, setShowPicker] = useState(false)
  const isMemo    = inv.docKind === 'memo'
  const isPending = inv.paidBy === 'pending' && !isMemo
  const statusColor = isMemo ? PURPLE : isPending ? ORANGE : inv.paidBy === 'cash' ? GREEN : BLUE
  const statusLabel = isMemo ? 'MEMO' : isPending ? 'PENDING' : inv.paidBy === 'cash' ? 'CASH' : 'CHECK'

  return (
    <div style={{ background: isMemo ? '#faf5ff' : isPending ? '#fff7ed' : '#f8fafc', border: `1px solid ${BORDER}`, borderRadius: 10, padding: '14px 16px', marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>{inv.date}</div>
          <div style={{ fontSize: 12, color: TEXT2, marginTop: 2 }}>
            {inv.docKind.toUpperCase()} ·{' '}
            <span style={{ color: statusColor, fontWeight: 700 }}>{statusLabel}</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: statusColor }}>{money(inv.total, 2)}</div>
          <button onClick={() => printSavedInvoice(inv)} style={{ padding: '6px 12px', borderRadius: 8, border: `1.5px solid ${BORDER}`, background: '#fff', fontSize: 12, fontWeight: 700, color: TEXT2, cursor: 'pointer' }}>🖨 Re-print</button>
          {isPending && onMarkPaid && !showPicker && (
            <button onClick={() => setShowPicker(true)} style={{ padding: '6px 12px', borderRadius: 8, border: `1.5px solid ${GREEN}`, background: '#fff', fontSize: 12, fontWeight: 700, color: GREEN, cursor: 'pointer' }}>Mark Paid</button>
          )}
          {isPending && onMarkPaid && showPicker && (
            <>
              <button onClick={() => { onMarkPaid(inv.id, 'cash');  setShowPicker(false) }} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: GREEN, fontSize: 12, fontWeight: 700, color: '#fff', cursor: 'pointer' }}>Cash</button>
              <button onClick={() => { onMarkPaid(inv.id, 'check'); setShowPicker(false) }} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: BLUE,  fontSize: 12, fontWeight: 700, color: '#fff', cursor: 'pointer' }}>Check</button>
              <button onClick={() => setShowPicker(false)} style={{ padding: '6px 10px', borderRadius: 8, border: `1.5px solid ${BORDER}`, background: '#fff', fontSize: 12, color: TEXT2, cursor: 'pointer' }}>✕</button>
            </>
          )}
          {isMemo && onDelete && (
            <button onClick={() => { if (window.confirm('Delete this memo?')) onDelete(inv.id) }} style={{ padding: '6px 12px', borderRadius: 8, border: '1.5px solid #ef4444', background: '#fff', fontSize: 12, fontWeight: 700, color: '#ef4444', cursor: 'pointer' }}>Delete</button>
          )}
        </div>
      </div>
      {inv.items.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr style={{ color: TEXT3 }}>
            {['Size', 'Pcs', 'Ct', 'P/Ct', 'Amount'].map((h, i) => (
              <th key={h} style={{ textAlign: i === 0 ? 'left' : 'right', padding: '4px 6px', fontWeight: 700, borderBottom: `1px solid ${BORDER}` }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {inv.items.map((item, i) => (
              <tr key={i}>
                <td style={{ padding: '4px 6px', borderBottom: `1px solid ${BORDER}`, fontWeight: 600 }}>{item.size}</td>
                <td style={{ padding: '4px 6px', borderBottom: `1px solid ${BORDER}`, textAlign: 'right' }}>{item.pcs}</td>
                <td style={{ padding: '4px 6px', borderBottom: `1px solid ${BORDER}`, textAlign: 'right' }}>{item.ct.toFixed(2)}</td>
                <td style={{ padding: '4px 6px', borderBottom: `1px solid ${BORDER}`, textAlign: 'right' }}>{money(item.pct, 2)}</td>
                <td style={{ padding: '4px 6px', borderBottom: `1px solid ${BORDER}`, textAlign: 'right', fontWeight: 700 }}>{money(item.amount, 2)}</td>
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

function ShopLedger({ invoices, onMarkPaid, onDelete }: {
  invoices: SavedInvoice[]
  onMarkPaid: (id: string, paidBy: 'cash' | 'check') => void
  onDelete: (id: string) => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [ledgerSearch, setLedgerSearch] = useState('')

  const shops = useMemo<ShopRow[]>(() => {
    const map = new Map<string, ShopRow>()
    invoices.forEach((inv) => {
      const key = inv.contactId || inv.company
      const row = map.get(key) ?? { key, company: inv.company || inv.contactName || 'Unknown', state: inv.state, city: inv.city, invoiceCount: 0, totalSold: 0, totalPaid: 0, totalPending: 0, lastDate: inv.date, invoices: [] }
      row.invoiceCount++; row.totalSold += inv.total
      if (inv.paidBy === 'pending') row.totalPending += inv.total; else row.totalPaid += inv.total
      if (inv.date > row.lastDate) row.lastDate = inv.date
      row.invoices.push(inv); map.set(key, row)
    })
    return Array.from(map.values()).sort((a, b) => b.totalSold - a.totalSold)
  }, [invoices])

  const filtered = useMemo(() => {
    const q = ledgerSearch.trim().toLowerCase()
    if (!q) return shops
    return shops.filter((s) => s.company.toLowerCase().includes(q))
  }, [shops, ledgerSearch])

  const toggle = (key: string) => setExpanded((prev) => {
    const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next
  })

  return (
    <div style={{ ...card }}>
      <div style={{ padding: '20px 24px', borderBottom: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: TEXT }}>Shop Ledger</div>
          <div style={{ fontSize: 13, color: TEXT2, marginTop: 2 }}>{filtered.length} shops · click any row to view invoices</div>
        </div>
        <input type="search" value={ledgerSearch} onChange={(e) => setLedgerSearch(e.target.value)}
          placeholder="Search shops…"
          style={{ padding: '9px 14px', borderRadius: 10, border: `1.5px solid ${BORDER}`, fontSize: 13, outline: 'none', width: 220, color: TEXT }} />
      </div>
      {/* Column header */}
      <div style={{ display: 'grid', gridTemplateColumns: '2.5fr 1fr 1fr 1fr 0.8fr 64px', gap: 0, padding: '10px 24px', background: '#f8fafc', borderBottom: `1px solid ${BORDER}` }}>
        {['Shop', 'Sold', 'Paid', 'Pending', 'Last Sale', ''].map((h) => (
          <div key={h} style={{ fontSize: 11, fontWeight: 700, color: TEXT3, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</div>
        ))}
      </div>
      {filtered.map((shop) => (
        <div key={shop.key}>
          <div onClick={() => toggle(shop.key)} style={{ display: 'grid', gridTemplateColumns: '2.5fr 1fr 1fr 1fr 0.8fr 64px', gap: 0, padding: '14px 24px', borderBottom: `1px solid ${BORDER}`, cursor: 'pointer', background: expanded.has(shop.key) ? '#eff6ff' : CARD_BG, transition: 'background 0.15s' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>{shop.company}</div>
              <div style={{ fontSize: 12, color: TEXT2, marginTop: 2 }}>{[shop.city, shop.state].filter(Boolean).join(', ')} · {shop.invoiceCount} inv</div>
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: BLUE,  alignSelf: 'center' }}>{money(shop.totalSold)}</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: GREEN, alignSelf: 'center' }}>{money(shop.totalPaid)}</div>
            <div style={{ fontSize: 14, fontWeight: shop.totalPending > 0 ? 700 : 400, color: shop.totalPending > 0 ? ORANGE : TEXT3, alignSelf: 'center' }}>{shop.totalPending > 0 ? money(shop.totalPending) : '—'}</div>
            <div style={{ fontSize: 13, color: TEXT2, alignSelf: 'center' }}>{shop.lastDate}</div>
            <div style={{ fontSize: 12, color: BLUE, fontWeight: 700, alignSelf: 'center', textAlign: 'right' }}>{expanded.has(shop.key) ? '▲ Hide' : '▼ Show'}</div>
          </div>
          {expanded.has(shop.key) && (
            <div style={{ padding: '16px 24px', background: '#f0f7ff', borderBottom: `1px solid ${BORDER}` }}>
              {groupByMonth(shop.invoices).map(({ month, label, invoices: mInvs, total }) => (
                <div key={month} style={{ marginBottom: 18 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: TEXT3, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: BLUE }}>{money(total)} · {mInvs.length} inv</div>
                  </div>
                  {mInvs.map((inv) => (
                    <InvoiceDetailRow key={inv.id} inv={inv} onMarkPaid={onMarkPaid} onDelete={onDelete} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      {!filtered.length && (
        <div style={{ padding: '40px', textAlign: 'center', color: TEXT3, fontSize: 14 }}>No shops match your search.</div>
      )}
    </div>
  )
}

// ─── Utility components ───────────────────────────────────────────────────────

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 10, height: 10, borderRadius: 3, background: color }} />
      <div style={{ fontSize: 12, color: TEXT2 }}>{label}</div>
    </div>
  )
}

function EmptyChart() {
  return <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: TEXT3, fontSize: 14 }}>No data for this period</div>
}

// ─── Main dashboard ──────────────────────────────────────────────────────────

export function RevenueDashboard() {
  const [unlocked, setUnlocked] = useState(!APP_PASSWORD || sessionStorage.getItem(AUTH_KEY) === APP_PASSWORD)
  const [allInvoices, setAllInvoices] = useState<SavedInvoice[]>([])
  const [loading, setLoading]   = useState(true)
  const [error,   setError]     = useState('')
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const [period,    setPeriod]    = useState<Period>('all')
  const [stateFilter, setStateFilter] = useState('all')
  const [search,    setSearch]    = useState('')

  const load = async () => {
    setLoading(true); setError('')
    try { const data = await fetchInvoices(); setAllInvoices(data); setLastRefresh(new Date()) }
    catch (err) { setError((err as Error).message) }
    finally { setLoading(false) }
  }

  useEffect(() => { if (unlocked) { void load() } }, [unlocked])

  const markPaid = async (id: string, paidBy: 'cash' | 'check') => {
    const sb = createClient(SUPABASE_URL, SUPABASE_KEY)
    await sb.from('invoices').update({ paid_by: paidBy }).eq('id', id)
    setAllInvoices((prev) => prev.map((inv) => inv.id === id ? { ...inv, paidBy } : inv))
  }

  const deleteMemo = async (id: string) => {
    const sb = createClient(SUPABASE_URL, SUPABASE_KEY)
    await sb.from('invoices').delete().eq('id', id)
    setAllInvoices((prev) => prev.filter((inv) => inv.id !== id))
  }

  // Unique states for filter
  const allStates = useMemo(() => {
    const s = new Set(allInvoices.map((i) => i.state).filter(Boolean))
    return Array.from(s).sort()
  }, [allInvoices])

  // Apply all filters
  const invoices = useMemo(() => {
    let data = filterByPeriod(allInvoices, period)
    if (stateFilter !== 'all') data = data.filter((i) => i.state === stateFilter)
    const q = search.trim().toLowerCase()
    if (q) data = data.filter((i) => i.company.toLowerCase().includes(q) || i.contactName.toLowerCase().includes(q))
    return data
  }, [allInvoices, period, stateFilter, search])

  // KPI computations
  const kpi = useMemo(() => {
    const { currStart, prevStart, prevEnd } = periodBounds(period)
    const prevInvs = allInvoices.filter((i) => {
      const d = new Date(i.date)
      return d >= prevStart && d <= prevEnd
    })
    const total     = invoices.reduce((s, i) => s + i.total, 0)
    const prevTotal = prevInvs.reduce((s, i) => s + i.total, 0)
    const collected     = invoices.filter((i) => i.paidBy !== 'pending' && i.docKind !== 'memo').reduce((s, i) => s + i.total, 0)
    const prevCollected = prevInvs.filter((i) => i.paidBy !== 'pending' && i.docKind !== 'memo').reduce((s, i) => s + i.total, 0)
    const pending   = invoices.filter((i) => i.paidBy === 'pending').reduce((s, i) => s + i.total, 0)
    const count     = invoices.length
    const prevCount = prevInvs.length
    const avg       = count > 0 ? total / count : 0
    const prevAvg   = prevCount > 0 ? prevTotal / prevCount : 0
    const collRate  = total > 0 ? (collected / total) * 100 : 0
    void currStart
    return {
      total, collected, pending, count, avg, collRate,
      totalTrend: trendPct(total, prevTotal),
      collTrend:  trendPct(collected, prevCollected),
      countTrend: trendPct(count, prevCount),
      avgTrend:   trendPct(avg, prevAvg),
    }
  }, [invoices, allInvoices, period])

  if (!unlocked) return <PasswordGate onUnlock={() => setUnlocked(true)} />

  const PERIODS: [Period, string][] = [['30d','30D'], ['90d','90D'], ['6m','6M'], ['1y','1Y'], ['all','All']]

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', background: PAGE_BG, minHeight: '100vh', color: TEXT }}>

      {/* ── Header ── */}
      <div style={{ background: HEADER_BG, padding: '0 32px', position: 'sticky', top: 0, zIndex: 100, boxShadow: '0 2px 12px rgba(0,0,0,0.3)' }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', alignItems: 'center', height: 60, gap: 20 }}>
          <img src="/delta-logo.png" alt="Delta Diamonds" style={{ height: 28, objectFit: 'contain', opacity: 0.9 }} />
          <div style={{ borderLeft: '1px solid rgba(255,255,255,0.15)', height: 24, marginRight: 4 }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.2px' }}>Revenue Analytics</div>

          {/* Period selector */}
          <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,0.08)', borderRadius: 10, padding: 3, marginLeft: 8 }}>
            {PERIODS.map(([p, label]) => (
              <button key={p} onClick={() => setPeriod(p)}
                style={{ padding: '5px 12px', borderRadius: 8, border: 'none', background: period === p ? 'rgba(255,255,255,0.9)' : 'transparent', color: period === p ? TEXT : '#94a3b8', fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s' }}>
                {label}
              </button>
            ))}
          </div>

          {/* State filter */}
          <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.08)', color: '#f1f5f9', fontSize: 12, cursor: 'pointer', outline: 'none' }}>
            <option value="all">All States</option>
            {allStates.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>

          {/* Search */}
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search company…"
            style={{ flex: 1, maxWidth: 220, padding: '7px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.08)', color: '#f1f5f9', fontSize: 13, outline: 'none' }} />

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            {lastRefresh && <div style={{ fontSize: 11, color: '#64748b' }}>↺ {lastRefresh.toLocaleTimeString()}</div>}
            <button onClick={load} disabled={loading}
              style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: '#94a3b8', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              {loading ? '…' : 'Refresh'}
            </button>
            <button onClick={() => exportCSV(invoices)}
              style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: BLUE, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              ↓ CSV
            </button>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '28px 32px 72px' }}>
        {error && (
          <div style={{ background: '#fef2f2', border: `1px solid #fecaca`, borderRadius: 12, padding: '14px 18px', marginBottom: 24, color: RED, fontSize: 14 }}>
            ❌ {error}
          </div>
        )}

        {(search || stateFilter !== 'all') && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, background: '#eff6ff', border: `1px solid #bfdbfe`, borderRadius: 10, padding: '10px 16px', fontSize: 13 }}>
            <div style={{ color: TEXT2 }}>Showing <strong>{invoices.length}</strong> of <strong>{allInvoices.length}</strong> invoices</div>
            {search && <span style={{ background: BLUE, color: '#fff', padding: '2px 10px', borderRadius: 99, fontSize: 12, fontWeight: 700 }}>{search}</span>}
            {stateFilter !== 'all' && <span style={{ background: BLUE, color: '#fff', padding: '2px 10px', borderRadius: 99, fontSize: 12, fontWeight: 700 }}>{stateFilter}</span>}
            <button onClick={() => { setSearch(''); setStateFilter('all') }} style={{ marginLeft: 'auto', fontSize: 12, color: BLUE, border: 'none', background: 'none', cursor: 'pointer', fontWeight: 700 }}>Clear filters</button>
          </div>
        )}

        {loading && !allInvoices.length ? (
          <div style={{ textAlign: 'center', padding: '100px 0', color: TEXT3, fontSize: 15 }}>Loading from Supabase…</div>
        ) : allInvoices.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '100px 0' }}>
            <div style={{ fontSize: 52, marginBottom: 14 }}>🧾</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: TEXT, marginBottom: 8 }}>No invoices yet</div>
            <div style={{ color: TEXT2 }}>Create invoices in the app — they'll appear here automatically.</div>
          </div>
        ) : (
          <>
            {/* ── KPI row ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16, marginBottom: 24 }}>
              <KpiCard label="Total Revenue"      value={money(kpi.total)}     sub="All billed"           trend={kpi.totalTrend}  accentColor={BLUE}   />
              <KpiCard label="Collected"          value={money(kpi.collected)} sub={`${kpi.collRate.toFixed(0)}% collection rate`} trend={kpi.collTrend}  accentColor={GREEN}  />
              <KpiCard label="Pending"            value={money(kpi.pending)}   sub={`${invoices.filter((i) => i.paidBy === 'pending').length} invoices`}     trend={null}          accentColor={ORANGE} />
              <KpiCard label="Total Invoices"     value={String(kpi.count)}    sub="Invoices + memos"     trend={kpi.countTrend}  accentColor={TEAL}   />
              <KpiCard label="Avg Deal Size"      value={money(kpi.avg)}       sub="Per invoice"          trend={kpi.avgTrend}    accentColor={PURPLE} />
            </div>

            {/* ── Row 1: Revenue trend + Payment donut ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 16, marginBottom: 16 }}>
              <RevenueTrendChart invoices={invoices} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <PaymentDonut invoices={invoices} />
                <CollectionCard invoices={invoices} />
              </div>
            </div>

            {/* ── Row 2: State chart + Top customers ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <StateRevenueChart invoices={invoices} />
              <TopCustomers invoices={invoices} />
            </div>

            {/* ── Row 3: Product mix + Invoice activity ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
              <ProductMixChart invoices={invoices} />
              <InvoiceActivityChart invoices={invoices} />
            </div>

            {/* ── Pending receivables table ── */}
            {invoices.some((i) => i.paidBy === 'pending') && (
              <div style={{ marginBottom: 24 }}>
                <PendingTable invoices={invoices} onMarkPaid={markPaid} />
              </div>
            )}

            {/* ── Shop ledger ── */}
            <ShopLedger invoices={invoices} onMarkPaid={markPaid} onDelete={deleteMemo} />
          </>
        )}
      </div>
    </div>
  )
}
