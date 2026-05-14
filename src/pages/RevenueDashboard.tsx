import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { SavedInvoice } from '../types/invoice'
import { printSavedInvoice } from '../lib/invoicePrint'

// ─── Supabase / auth ─────────────────────────────────────────────────────────

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

// ─── Types ────────────────────────────────────────────────────────────────────

type Period = '7d' | '30d' | '90d' | '6m' | '1y' | 'all'

// ─── Design tokens ────────────────────────────────────────────────────────────

const SIDEBAR_W = 224

// Chart / data colors (unchanged — these are semantic)
const BLUE   = '#2563eb'
const GREEN  = '#059669'
const ORANGE = '#ea580c'
const PURPLE = '#7c3aed'
const TEAL   = '#0891b2'
const AMBER  = '#d97706'

// UI palette
const C = {
  indigo:  '#4f46e5',
  indigoL: '#6366f1',
  s900:    '#0f172a',
  s800:    '#1e293b',
  s700:    '#334155',
  s600:    '#475569',
  s500:    '#64748b',
  s400:    '#94a3b8',
  s300:    '#cbd5e1',
  s200:    '#e2e8f0',
  s100:    '#f1f5f9',
  s50:     '#f8fafc',
  white:   '#ffffff',
  pageBg:  '#eef2f7',
}

const card: React.CSSProperties = {
  background: C.white,
  border: `1px solid ${C.s200}`,
  borderRadius: 16,
  boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
  overflow: 'hidden',
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useCountUp(target: number, duration = 850): number {
  const [val, setVal] = useState(target)
  const rafRef  = useRef<number | null>(null)
  const prevRef = useRef(target)

  useEffect(() => {
    const from = prevRef.current
    prevRef.current = target
    if (from === target) return
    const startTime = performance.now()
    const tick = (now: number) => {
      const t      = Math.min((now - startTime) / duration, 1)
      const eased  = 1 - Math.pow(1 - t, 3)
      setVal(from + (target - from) * eased)
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [target, duration])

  return val
}

function useScrollSpy(ids: string[], offset = 130): string {
  const [active, setActive] = useState(ids[0] ?? '')
  useEffect(() => {
    const handler = () => {
      const visible = ids
        .map((id) => ({ id, top: document.getElementById(id)?.getBoundingClientRect().top ?? Infinity }))
        .filter((x) => x.top <= offset)
      if (visible.length) setActive(visible[visible.length - 1].id)
    }
    window.addEventListener('scroll', handler, { passive: true })
    return () => window.removeEventListener('scroll', handler)
  }, [ids, offset])
  return active
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  const days   = { '7d': 7, '30d': 30, '90d': 90, '6m': 182, '1y': 365 }[period]
  const ms     = days * 86_400_000
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

// ─── SVG icon components ──────────────────────────────────────────────────────

type IconName = 'home' | 'trending' | 'pie' | 'map' | 'users' | 'bar' | 'alert' | 'list' |
                'refresh' | 'download' | 'dollar' | 'check' | 'clock' | 'file' | 'x' | 'print'

function Icon({ name, size = 16, stroke = 'currentColor' }: { name: IconName; size?: number; stroke?: string }) {
  const s: React.CSSProperties = { width: size, height: size, flexShrink: 0, display: 'block' }
  const p = { fill: 'none', stroke, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'home':    return <svg style={s} viewBox="0 0 24 24" {...p}><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></svg>
    case 'trending':return <svg style={s} viewBox="0 0 24 24" {...p}><polyline points="23,6 13.5,15.5 8.5,10.5 1,18"/><polyline points="17,6 23,6 23,12"/></svg>
    case 'pie':     return <svg style={s} viewBox="0 0 24 24" {...p}><path d="M21.21 15.89A10 10 0 118 2.83"/><path d="M22 12A10 10 0 0012 2v10z"/></svg>
    case 'map':     return <svg style={s} viewBox="0 0 24 24" {...p}><polygon points="1,6 1,22 8,18 16,22 23,18 23,2 16,6 8,2"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>
    case 'users':   return <svg style={s} viewBox="0 0 24 24" {...p}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
    case 'bar':     return <svg style={s} viewBox="0 0 24 24" {...p}><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
    case 'alert':   return <svg style={s} viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
    case 'list':    return <svg style={s} viewBox="0 0 24 24" {...p}><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
    case 'refresh': return <svg style={s} viewBox="0 0 24 24" {...p}><polyline points="23,4 23,10 17,10"/><polyline points="1,20 1,14 7,14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
    case 'download':return <svg style={s} viewBox="0 0 24 24" {...p}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
    case 'dollar':  return <svg style={s} viewBox="0 0 24 24" {...p}><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
    case 'check':   return <svg style={s} viewBox="0 0 24 24" {...p}><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22,4 12,14.01 9,11.01"/></svg>
    case 'clock':   return <svg style={s} viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>
    case 'file':    return <svg style={s} viewBox="0 0 24 24" {...p}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
    case 'x':       return <svg style={s} viewBox="0 0 24 24" {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    case 'print':   return <svg style={s} viewBox="0 0 24 24" {...p}><polyline points="6,9 6,2 18,2 18,9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
    default: return null
  }
}

// ─── Utility components ───────────────────────────────────────────────────────

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 10, height: 10, borderRadius: 3, background: color, flexShrink: 0 }} />
      <div style={{ fontSize: 12, color: C.s500 }}>{label}</div>
    </div>
  )
}

function EmptyChart() {
  return <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.s400, fontSize: 14 }}>No data for this period</div>
}

function DarkTooltip({ active, payload, label, formatter }: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string
  formatter?: (v: number, name: string) => string
}) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: C.s800, borderRadius: 10, padding: '12px 16px', boxShadow: '0 8px 24px rgba(0,0,0,0.28)', minWidth: 160, border: `1px solid ${C.s700}` }}>
      {label && <div style={{ color: C.s400, fontSize: 11, fontWeight: 600, marginBottom: 10, letterSpacing: '0.4px', textTransform: 'uppercase' }}>{label}</div>}
      {payload.map((p) => (
        <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 20, marginBottom: 5, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: p.color, flexShrink: 0 }} />
            <div style={{ color: C.s400, fontSize: 12 }}>{p.name}</div>
          </div>
          <div style={{ color: '#f1f5f9', fontSize: 13, fontWeight: 700 }}>
            {formatter ? formatter(p.value, p.name) : money(p.value)}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Password gate ────────────────────────────────────────────────────────────

function PasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [pw, setPw]   = useState('')
  const [err, setErr] = useState('')

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: C.pageBg, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ width: 420 }}>
        {/* Logo card */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <img src="/delta-logo.png" alt="Delta Diamonds" style={{ height: 48, objectFit: 'contain', marginBottom: 12 }} />
          <div style={{ fontSize: 13, color: C.s500, fontWeight: 500, letterSpacing: '0.3px' }}>Revenue Analytics Platform</div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (pw === APP_PASSWORD) { sessionStorage.setItem(AUTH_KEY, pw); onUnlock() }
            else setErr('Incorrect password. Please try again.')
          }}
          style={{ ...card, padding: '36px 40px' }}
        >
          <div style={{ fontSize: 20, fontWeight: 800, color: C.s900, marginBottom: 6, letterSpacing: '-0.3px' }}>Sign in to Dashboard</div>
          <div style={{ fontSize: 13, color: C.s500, marginBottom: 28 }}>Protected with a password — Delta Diamonds internal</div>

          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: C.s600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
            Password
          </label>
          <input
            type="password" value={pw} onChange={(e) => { setPw(e.target.value); setErr('') }}
            placeholder="Enter access password" autoFocus
            style={{ width: '100%', padding: '12px 16px', borderRadius: 10, border: `1.5px solid ${err ? '#ef4444' : C.s200}`, fontSize: 15, marginBottom: err ? 8 : 20, boxSizing: 'border-box', outline: 'none', color: C.s900, transition: 'border-color 0.15s', fontFamily: 'inherit' }}
          />
          {err && <div style={{ color: '#ef4444', fontSize: 13, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="alert" size={14} stroke="#ef4444" /> {err}
          </div>}

          <button type="submit"
            className="btn btn-primary"
            style={{ width: '100%', padding: '13px', borderRadius: 10, border: 'none', background: C.indigo, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '-0.1px' }}>
            Unlock Dashboard
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── KPI card (with count-up animation) ──────────────────────────────────────

function KpiCard({ label, rawValue, format, sub, trend, trendInverse, accentColor, iconName, fadeClass }: {
  label: string
  rawValue: number
  format: 'money' | 'count' | 'pct'
  sub?: string
  trend?: number | null
  trendInverse?: boolean
  accentColor: string
  iconName: IconName
  fadeClass?: string
}) {
  const animated  = useCountUp(rawValue)
  const formatted = format === 'money' ? money(animated) : format === 'pct' ? `${animated.toFixed(1)}%` : String(Math.round(animated))
  const isUp      = (trend ?? 0) >= 0
  const isGood    = trendInverse ? !isUp : isUp
  const trendCol  = isGood ? GREEN : '#ef4444'

  return (
    <div style={{ ...card, padding: '20px 22px', borderTop: `3px solid ${accentColor}` }} className={`card-lift${fadeClass ? ` fade-up ${fadeClass}` : ''}`}>
      {/* Icon badge + trend pill row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: accentColor + '15', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={iconName} size={18} stroke={accentColor} />
        </div>
        {trend !== null && trend !== undefined && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: isGood ? '#f0fdf4' : '#fef2f2', padding: '3px 9px', borderRadius: 99, border: `1px solid ${isGood ? '#bbf7d0' : '#fecaca'}` }}>
            <span style={{ color: trendCol, fontSize: 10 }}>{isUp ? '▲' : '▼'}</span>
            <span style={{ color: trendCol, fontSize: 11, fontWeight: 700 }}>{Math.abs(trend).toFixed(1)}%</span>
          </div>
        )}
      </div>

      {/* Value */}
      <div style={{ fontSize: 28, fontWeight: 800, color: C.s900, lineHeight: 1, letterSpacing: '-0.5px', marginBottom: 6, fontVariantNumeric: 'tabular-nums' }}>
        {formatted}
      </div>

      {/* Label + sub */}
      <div style={{ fontSize: 11, fontWeight: 700, color: C.s400, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: sub ? 4 : 0 }}>{label}</div>
      {sub && <div style={{ fontSize: 12, color: C.s500 }}>{sub}</div>}
    </div>
  )
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: C.s900, letterSpacing: '-0.2px' }}>{title}</div>
      {sub && <div style={{ fontSize: 12, color: C.s500, marginTop: 3 }}>{sub}</div>}
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

  if (!data.length) return <div style={{ ...card }} className="card-lift"><EmptyChart /></div>

  return (
    <div style={{ ...card, padding: '24px' }} className="card-lift">
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
              <stop offset="0%"   stopColor={BLUE}  stopOpacity={0.15} />
              <stop offset="100%" stopColor={BLUE}  stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradCollected" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={GREEN} stopOpacity={0.15} />
              <stop offset="100%" stopColor={GREEN} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={C.s100} vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 12, fill: C.s400 }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} tick={{ fontSize: 11, fill: C.s400 }} axisLine={false} tickLine={false} width={54} />
          <Tooltip content={<DarkTooltip />} />
          <Area type="monotone" dataKey="Total"     stroke={BLUE}  strokeWidth={2.5} fill="url(#gradTotal)"     name="Total Billed" dot={false} activeDot={{ r: 5, strokeWidth: 0 }} />
          <Area type="monotone" dataKey="Collected" stroke={GREEN} strokeWidth={2.5} fill="url(#gradCollected)" name="Collected"    dot={false} activeDot={{ r: 5, strokeWidth: 0 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Invoice activity chart ───────────────────────────────────────────────────

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

  if (!data.length) return <div style={{ ...card }} className="card-lift"><EmptyChart /></div>

  return (
    <div style={{ ...card, padding: '24px' }} className="card-lift">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <SectionHeader title="Invoice Activity" sub="Monthly invoice & memo count" />
        <div style={{ display: 'flex', gap: 16 }}>
          <LegendDot color={BLUE}   label="Invoices" />
          <LegendDot color={PURPLE} label="Memos" />
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barSize={14} barGap={3}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.s100} vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 12, fill: C.s400 }} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: C.s400 }} axisLine={false} tickLine={false} width={28} />
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

  if (!data.length) return <div style={{ ...card }} className="card-lift"><EmptyChart /></div>

  return (
    <div style={{ ...card, padding: '24px' }} className="card-lift">
      <SectionHeader title="Payment Methods" sub="Revenue by collection type" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <PieChart width={170} height={170}>
            <Pie data={data} cx={83} cy={83} innerRadius={52} outerRadius={78} dataKey="value" stroke="none" startAngle={90} endAngle={-270} />
            <Tooltip content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const d = payload[0]
              return (
                <div style={{ background: C.s800, borderRadius: 10, padding: '10px 14px', border: `1px solid ${C.s700}` }}>
                  <div style={{ color: C.s400, fontSize: 12, marginBottom: 4 }}>{d.name}</div>
                  <div style={{ color: '#f1f5f9', fontSize: 14, fontWeight: 700 }}>{money(Number(d.value))}</div>
                  <div style={{ color: C.s500, fontSize: 12 }}>{total > 0 ? ((Number(d.value) / total) * 100).toFixed(1) : 0}%</div>
                </div>
              )
            }} />
          </PieChart>
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.s900 }}>{money(total)}</div>
            <div style={{ fontSize: 10, color: C.s400, marginTop: 1 }}>total</div>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          {data.map((d) => (
            <div key={d.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderBottom: `1px solid ${C.s100}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 10, height: 10, borderRadius: 3, background: d.color, flexShrink: 0 }} />
                <div style={{ fontSize: 13, fontWeight: 600, color: C.s800 }}>{d.name}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: d.color }}>{money(d.value)}</div>
                <div style={{ fontSize: 11, color: C.s400 }}>{total > 0 ? ((d.value / total) * 100).toFixed(1) : 0}%</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Revenue by state ─────────────────────────────────────────────────────────

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

  if (!data.length) return <div style={{ ...card }} className="card-lift"><EmptyChart /></div>

  return (
    <div style={{ ...card, padding: '24px' }} className="card-lift">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <SectionHeader title="Revenue by State" sub="Top 10 states by billed amount" />
        <div style={{ display: 'flex', gap: 16 }}>
          <LegendDot color={BLUE}   label="Total" />
          <LegendDot color={ORANGE} label="Pending" />
        </div>
      </div>
      <ResponsiveContainer width="100%" height={Math.max(220, data.length * 34)}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 0, bottom: 0, left: 16 }} barSize={10} barGap={2}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.s100} horizontal={false} />
          <XAxis type="number" tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} tick={{ fontSize: 11, fill: C.s400 }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="state" tick={{ fontSize: 12, fill: C.s600, fontWeight: 600 }} axisLine={false} tickLine={false} width={28} />
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
        const key = item.size.trim().split(/\s+/)[0] || 'Other'
        map.set(key, (map.get(key) ?? 0) + item.amount)
      })
    })
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, Revenue: Math.round(value) }))
      .sort((a, b) => b.Revenue - a.Revenue).slice(0, 8)
  }, [invoices])

  const COLORS = [BLUE, TEAL, GREEN, AMBER, PURPLE, ORANGE, '#06b6d4', '#84cc16']
  const coloredData = data.map((d, i) => ({ ...d, fill: COLORS[i % COLORS.length] }))

  if (!coloredData.length) return <div style={{ ...card }} className="card-lift"><EmptyChart /></div>

  return (
    <div style={{ ...card, padding: '24px' }} className="card-lift">
      <SectionHeader title="Product Mix" sub="Revenue by stone size prefix" />
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={coloredData} margin={{ top: 4, right: 4, bottom: 20, left: 10 }} barSize={32}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.s100} vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 12, fill: C.s600, fontWeight: 600 }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} tick={{ fontSize: 11, fill: C.s400 }} axisLine={false} tickLine={false} width={50} />
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
    <div style={{ ...card, padding: '24px' }} className="card-lift">
      <SectionHeader title="Top Customers" sub="Ranked by total billed value" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {customers.map((c, i) => (
          <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: i ? `1px solid ${C.s100}` : 'none' }}>
            <div style={{ width: 26, height: 26, borderRadius: 8, background: i === 0 ? AMBER : i === 1 ? C.s300 : i === 2 ? '#cd7f32' : C.s100, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: i < 3 ? '#fff' : C.s400, flexShrink: 0 }}>
              {c.rank}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.s900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '55%' }}>{c.name}</div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
                  <div style={{ fontSize: 11, color: c.collectRate < 70 ? ORANGE : GREEN, fontWeight: 700 }}>{c.collectRate.toFixed(0)}% paid</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: C.s900 }}>{money(c.total)}</div>
                </div>
              </div>
              <div style={{ height: 5, borderRadius: 99, background: C.s100, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${c.barPct}%`, borderRadius: 99, background: `linear-gradient(90deg, ${C.indigo}, ${TEAL})`, transition: 'width 0.6s ease' }} />
              </div>
            </div>
          </div>
        ))}
        {!customers.length && <div style={{ padding: '24px 0', textAlign: 'center', color: C.s400, fontSize: 14 }}>No data for this period</div>}
      </div>
    </div>
  )
}

// ─── Collection efficiency ────────────────────────────────────────────────────

function CollectionCard({ invoices }: { invoices: SavedInvoice[] }) {
  const stats = useMemo(() => {
    const total     = invoices.reduce((s, i) => s + i.total, 0)
    const collected = invoices.filter((i) => i.paidBy !== 'pending' && i.docKind !== 'memo').reduce((s, i) => s + i.total, 0)
    const pending   = invoices.filter((i) => i.paidBy === 'pending').reduce((s, i) => s + i.total, 0)
    const rate      = total > 0 ? (collected / total) * 100 : 0
    const avgDays   = invoices.filter((i) => i.paidBy === 'pending').map((i) => daysAgo(i.date))
    const avgOverdue = avgDays.length ? avgDays.reduce((a, b) => a + b, 0) / avgDays.length : 0
    const overdue30  = invoices.filter((i) => i.paidBy === 'pending' && daysAgo(i.date) > 30).length
    return { rate, collected, pending, total, avgOverdue, overdue30 }
  }, [invoices])

  const circumference = 2 * Math.PI * 44
  const dash = (stats.rate / 100) * circumference
  const gaugeColor = stats.rate >= 80 ? GREEN : stats.rate >= 60 ? AMBER : '#ef4444'

  return (
    <div style={{ ...card, padding: '24px' }} className="card-lift">
      <SectionHeader title="Collection Efficiency" sub="Payment collection performance" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <svg width={110} height={110}>
            <circle cx={55} cy={55} r={44} fill="none" stroke={C.s100} strokeWidth={10} />
            <circle cx={55} cy={55} r={44} fill="none"
              stroke={gaugeColor} strokeWidth={10} strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference}`}
              transform="rotate(-90 55 55)"
              style={{ transition: 'stroke-dasharray 0.7s ease' }}
            />
          </svg>
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.s900 }}>{stats.rate.toFixed(0)}%</div>
            <div style={{ fontSize: 10, color: C.s400 }}>collected</div>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          {[
            { label: 'Collected',      value: money(stats.collected), color: GREEN },
            { label: 'Outstanding',    value: money(stats.pending),   color: ORANGE },
            { label: 'Avg days overdue', value: `${stats.avgOverdue.toFixed(0)}d`, color: stats.avgOverdue > 30 ? '#ef4444' : C.s600 },
            { label: '30d+ overdue',   value: `${stats.overdue30} inv`, color: stats.overdue30 > 0 ? '#ef4444' : C.s600 },
          ].map((row, i) => (
            <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderTop: i ? `1px solid ${C.s100}` : 'none' }}>
              <div style={{ fontSize: 12, color: C.s500 }}>{row.label}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: row.color }}>{row.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Pending receivables table ────────────────────────────────────────────────

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

  const urgencyColor = (days: number) => days > 30 ? '#ef4444' : days > 14 ? ORANGE : AMBER
  const totalPending = rows.reduce((s, r) => s + r.total, 0)

  return (
    <div style={{ ...card }} className="card-lift">
      <div style={{ padding: '18px 24px', borderBottom: `1px solid ${C.s200}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fffbeb' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.s900, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="alert" size={16} stroke={ORANGE} /> Pending Receivables
          </div>
          <div style={{ fontSize: 13, color: C.s600, marginTop: 3 }}>{rows.length} outstanding invoice{rows.length !== 1 ? 's' : ''} — follow up promptly</div>
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: ORANGE, fontVariantNumeric: 'tabular-nums' }}>{money(totalPending)}</div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: C.s50 }}>
              {['Company', 'State', 'Invoice Date', 'Days Outstanding', 'Amount', 'Action'].map((h, i) => (
                <th key={h} style={{ padding: '11px 16px', textAlign: i >= 3 ? 'right' : 'left', fontSize: 11, fontWeight: 700, color: C.s400, textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: `1px solid ${C.s200}`, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const uc = urgencyColor(row.days)
              return (
                <tr key={row.id} className="tr-hover" style={{ borderBottom: `1px solid ${C.s100}` }}>
                  <td style={{ padding: '13px 16px', fontWeight: 700, color: C.s900, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.company || row.contactName}</td>
                  <td style={{ padding: '13px 16px', color: C.s600 }}>{row.state || '—'}</td>
                  <td style={{ padding: '13px 16px', color: C.s600 }}>{row.date}</td>
                  <td style={{ padding: '13px 16px', textAlign: 'right' }}>
                    <span style={{ background: uc + '15', color: uc, fontWeight: 700, fontSize: 12, padding: '3px 10px', borderRadius: 99, border: `1px solid ${uc}30` }}>
                      {row.days}d
                    </span>
                  </td>
                  <td style={{ padding: '13px 16px', textAlign: 'right', fontWeight: 800, color: ORANGE, fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>{money(row.total)}</td>
                  <td style={{ padding: '13px 16px', textAlign: 'right' }}>
                    {pickerOpen !== row.id ? (
                      <button onClick={() => setPickerOpen(row.id)} className="btn btn-paid"
                        style={{ padding: '6px 14px', borderRadius: 8, border: `1.5px solid ${GREEN}`, background: '#fff', fontSize: 12, fontWeight: 700, color: GREEN, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit' }}>
                        Mark Paid
                      </button>
                    ) : (
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button onClick={() => { onMarkPaid(row.id, 'cash');  setPickerOpen(null) }} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: GREEN,    color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Cash</button>
                        <button onClick={() => { onMarkPaid(row.id, 'check'); setPickerOpen(null) }} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: C.indigo, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Check</button>
                        <button onClick={() => setPickerOpen(null)} style={{ padding: '6px 10px', borderRadius: 8, border: `1px solid ${C.s200}`, background: '#fff', fontSize: 12, color: C.s600, cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
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

// ─── Invoice detail row ───────────────────────────────────────────────────────

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
    <div style={{ background: isMemo ? '#faf5ff' : isPending ? '#fff7ed' : C.s50, border: `1px solid ${C.s200}`, borderRadius: 10, padding: '14px 16px', marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.s900 }}>{inv.date}</div>
          <div style={{ fontSize: 12, color: C.s500, marginTop: 2 }}>
            {inv.docKind.toUpperCase()} · <span style={{ color: statusColor, fontWeight: 700 }}>{statusLabel}</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: statusColor, fontVariantNumeric: 'tabular-nums' }}>{money(inv.total, 2)}</div>
          <button onClick={() => printSavedInvoice(inv)} className="btn btn-ghost"
            style={{ padding: '5px 11px', borderRadius: 8, border: `1.5px solid ${C.s200}`, background: '#fff', fontSize: 12, fontWeight: 600, color: C.s600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'inherit' }}>
            <Icon name="print" size={12} stroke={C.s500} /> Print
          </button>
          {isPending && onMarkPaid && !showPicker && (
            <button onClick={() => setShowPicker(true)} className="btn btn-paid"
              style={{ padding: '5px 11px', borderRadius: 8, border: `1.5px solid ${GREEN}`, background: '#fff', fontSize: 12, fontWeight: 700, color: GREEN, cursor: 'pointer', fontFamily: 'inherit' }}>Mark Paid</button>
          )}
          {isPending && onMarkPaid && showPicker && (
            <>
              <button onClick={() => { onMarkPaid(inv.id, 'cash');  setShowPicker(false) }} style={{ padding: '5px 11px', borderRadius: 8, border: 'none', background: GREEN,    fontSize: 12, fontWeight: 700, color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>Cash</button>
              <button onClick={() => { onMarkPaid(inv.id, 'check'); setShowPicker(false) }} style={{ padding: '5px 11px', borderRadius: 8, border: 'none', background: C.indigo, fontSize: 12, fontWeight: 700, color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>Check</button>
              <button onClick={() => setShowPicker(false)} style={{ padding: '5px 9px', borderRadius: 8, border: `1.5px solid ${C.s200}`, background: '#fff', fontSize: 12, color: C.s500, cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
            </>
          )}
          {isMemo && onDelete && (
            <button onClick={() => { if (window.confirm('Delete this memo?')) onDelete(inv.id) }} className="btn btn-danger"
              style={{ padding: '5px 11px', borderRadius: 8, border: '1.5px solid #fca5a5', background: '#fff', fontSize: 12, fontWeight: 700, color: '#ef4444', cursor: 'pointer', fontFamily: 'inherit' }}>Delete</button>
          )}
        </div>
      </div>
      {inv.items.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr>
            {['Size', 'Pcs', 'Ct', 'P/Ct', 'Amount'].map((h, i) => (
              <th key={h} style={{ textAlign: i === 0 ? 'left' : 'right', padding: '4px 6px', fontWeight: 700, color: C.s400, borderBottom: `1px solid ${C.s200}` }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {inv.items.map((item, i) => (
              <tr key={i} className="tr-hover">
                <td style={{ padding: '5px 6px', borderBottom: `1px solid ${C.s100}`, fontWeight: 600, color: C.s800 }}>{item.size}</td>
                <td style={{ padding: '5px 6px', borderBottom: `1px solid ${C.s100}`, textAlign: 'right', color: C.s700 }}>{item.pcs}</td>
                <td style={{ padding: '5px 6px', borderBottom: `1px solid ${C.s100}`, textAlign: 'right', color: C.s700 }}>{item.ct.toFixed(2)}</td>
                <td style={{ padding: '5px 6px', borderBottom: `1px solid ${C.s100}`, textAlign: 'right', color: C.s700 }}>{money(item.pct, 2)}</td>
                <td style={{ padding: '5px 6px', borderBottom: `1px solid ${C.s100}`, textAlign: 'right', fontWeight: 700, color: C.s900 }}>{money(item.amount, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {inv.notes && <div style={{ fontSize: 12, color: C.s500, marginTop: 8, fontStyle: 'italic' }}>Note: {inv.notes}</div>}
    </div>
  )
}

// ─── Shop ledger ──────────────────────────────────────────────────────────────

type ShopRow = {
  key: string; company: string; state: string; city: string
  invoiceCount: number; totalSold: number; totalPaid: number; totalPending: number
  lastDate: string; invoices: SavedInvoice[]
}

function ShopLedger({ invoices, onMarkPaid, onDelete }: {
  invoices: SavedInvoice[]
  onMarkPaid: (id: string, paidBy: 'cash' | 'check') => void
  onDelete: (id: string) => void
}) {
  const [expanded, setExpanded]     = useState<Set<string>>(new Set())
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
      <div style={{ padding: '18px 24px', borderBottom: `1px solid ${C.s200}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.s900, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="list" size={16} stroke={C.indigo} /> Shop Ledger
          </div>
          <div style={{ fontSize: 13, color: C.s500, marginTop: 3 }}>{filtered.length} shops · click any row to view invoices</div>
        </div>
        <input type="search" value={ledgerSearch} onChange={(e) => setLedgerSearch(e.target.value)}
          placeholder="Search shops…"
          style={{ padding: '9px 14px', borderRadius: 10, border: `1.5px solid ${C.s200}`, fontSize: 13, outline: 'none', width: 220, color: C.s900, fontFamily: 'inherit', background: C.s50 }} />
      </div>

      {/* Column headers */}
      <div style={{ display: 'grid', gridTemplateColumns: '2.5fr 1fr 1fr 1fr 0.8fr 64px', padding: '10px 24px', background: C.s50, borderBottom: `1px solid ${C.s200}` }}>
        {['Shop', 'Sold', 'Paid', 'Pending', 'Last Sale', ''].map((h) => (
          <div key={h} style={{ fontSize: 11, fontWeight: 700, color: C.s400, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</div>
        ))}
      </div>

      {filtered.map((shop) => (
        <div key={shop.key}>
          <div
            onClick={() => toggle(shop.key)}
            className="tr-hover"
            style={{ display: 'grid', gridTemplateColumns: '2.5fr 1fr 1fr 1fr 0.8fr 64px', padding: '14px 24px', borderBottom: `1px solid ${C.s100}`, cursor: 'pointer', background: expanded.has(shop.key) ? '#eff6ff' : C.white, transition: 'background 0.15s' }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.s900 }}>{shop.company}</div>
              <div style={{ fontSize: 12, color: C.s500, marginTop: 2 }}>{[shop.city, shop.state].filter(Boolean).join(', ')} · {shop.invoiceCount} inv</div>
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: BLUE,  alignSelf: 'center', fontVariantNumeric: 'tabular-nums' }}>{money(shop.totalSold)}</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: GREEN, alignSelf: 'center', fontVariantNumeric: 'tabular-nums' }}>{money(shop.totalPaid)}</div>
            <div style={{ fontSize: 14, fontWeight: shop.totalPending > 0 ? 700 : 400, color: shop.totalPending > 0 ? ORANGE : C.s400, alignSelf: 'center', fontVariantNumeric: 'tabular-nums' }}>{shop.totalPending > 0 ? money(shop.totalPending) : '—'}</div>
            <div style={{ fontSize: 13, color: C.s500, alignSelf: 'center' }}>{shop.lastDate}</div>
            <div style={{ fontSize: 12, color: C.indigo, fontWeight: 700, alignSelf: 'center', textAlign: 'right' }}>{expanded.has(shop.key) ? '▲ Hide' : '▼ Show'}</div>
          </div>
          {expanded.has(shop.key) && (
            <div style={{ padding: '16px 24px', background: '#eff6ff', borderBottom: `1px solid ${C.s200}` }}>
              {groupByMonth(shop.invoices).map(({ month, label, invoices: mInvs, total }) => (
                <div key={month} style={{ marginBottom: 18 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.s400, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
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
        <div style={{ padding: '48px', textAlign: 'center', color: C.s400, fontSize: 14 }}>No shops match your search.</div>
      )}
    </div>
  )
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

const SECTION_IDS = ['overview', 'revenue', 'payments', 'geography', 'customers', 'products', 'receivables', 'ledger'] as const
type SectionId = typeof SECTION_IDS[number]

const NAV_ITEMS: { id: SectionId; label: string; icon: IconName }[] = [
  { id: 'overview',    label: 'Overview',     icon: 'home'     },
  { id: 'revenue',     label: 'Revenue Trend', icon: 'trending' },
  { id: 'payments',    label: 'Payments',     icon: 'pie'      },
  { id: 'geography',   label: 'By State',     icon: 'map'      },
  { id: 'customers',   label: 'Customers',    icon: 'users'    },
  { id: 'products',    label: 'Product Mix',  icon: 'bar'      },
  { id: 'receivables', label: 'Receivables',  icon: 'alert'    },
  { id: 'ledger',      label: 'Shop Ledger',  icon: 'list'     },
]

function Sidebar({ active, pendingCount, onNav, onRefresh, onExport, loading }: {
  active: string
  pendingCount: number
  onNav: (id: SectionId) => void
  onRefresh: () => void
  onExport: () => void
  loading: boolean
}) {
  return (
    <aside style={{ position: 'fixed', left: 0, top: 0, bottom: 0, width: SIDEBAR_W, background: C.s900, display: 'flex', flexDirection: 'column', zIndex: 200, borderRight: '1px solid rgba(255,255,255,0.06)', overflowY: 'auto' }}>
      {/* Logo */}
      <div style={{ padding: '22px 20px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <img src="/delta-logo.png" alt="Delta Diamonds" style={{ height: 28, objectFit: 'contain', opacity: 0.92 }} />
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 7, fontWeight: 500, letterSpacing: '0.5px', textTransform: 'uppercase' }}>Revenue Analytics</div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '12px 10px' }}>
        {NAV_ITEMS.map((item) => {
          const isActive = active === item.id
          return (
            <button
              key={item.id}
              onClick={() => onNav(item.id)}
              className={`nav-btn${isActive ? ' nav-active' : ''}`}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', border: 'none', background: 'transparent', color: isActive ? '#a5b4fc' : 'rgba(255,255,255,0.55)', fontSize: 13, fontWeight: isActive ? 600 : 400, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', marginBottom: 2, position: 'relative' }}
            >
              <Icon name={item.icon} size={16} stroke="currentColor" />
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.id === 'receivables' && pendingCount > 0 && (
                <span style={{ background: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 800, borderRadius: 99, padding: '1px 6px', minWidth: 18, textAlign: 'center' }}>
                  {pendingCount}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      {/* Bottom actions */}
      <div style={{ padding: '12px 10px 20px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <button onClick={onRefresh} disabled={loading}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', border: 'none', background: 'transparent', color: loading ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.5)', fontSize: 13, cursor: loading ? 'default' : 'pointer', fontFamily: 'inherit', borderRadius: 9, marginBottom: 2 }}
          className="nav-btn"
        >
          <Icon name="refresh" size={15} stroke="currentColor" />
          {loading ? 'Refreshing…' : 'Refresh Data'}
        </button>
        <button onClick={onExport}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.5)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', borderRadius: 9 }}
          className="nav-btn"
        >
          <Icon name="download" size={15} stroke="currentColor" />
          Export CSV
        </button>
      </div>
    </aside>
  )
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

export function RevenueDashboard() {
  const [unlocked, setUnlocked] = useState(!APP_PASSWORD || sessionStorage.getItem(AUTH_KEY) === APP_PASSWORD)
  const [allInvoices, setAllInvoices] = useState<SavedInvoice[]>([])
  const [loading, setLoading]   = useState(true)
  const [error,   setError]     = useState('')
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const [period,      setPeriod]      = useState<Period>('all')
  const [stateFilter, setStateFilter] = useState('all')
  const [search,      setSearch]      = useState('')

  const activeSection = useScrollSpy([...SECTION_IDS])

  const load = async () => {
    setLoading(true); setError('')
    try { const data = await fetchInvoices(); setAllInvoices(data); setLastRefresh(new Date()) }
    catch (err) { setError((err as Error).message) }
    finally { setLoading(false) }
  }

  useEffect(() => { if (unlocked) { void load() } }, [unlocked])

  const markPaid = async (id: string, paidBy: 'cash' | 'check') => {
    const sb = createClient(SUPABASE_URL, SUPABASE_KEY)
    setAllInvoices((prev) => prev.map((inv) => inv.id === id ? { ...inv, paidBy } : inv))
    await sb.from('invoices').update({ paid_by: paidBy }).eq('id', id)
  }

  const deleteMemo = async (id: string) => {
    const sb = createClient(SUPABASE_URL, SUPABASE_KEY)
    setAllInvoices((prev) => prev.filter((inv) => inv.id !== id))
    await sb.from('invoices').delete().eq('id', id)
  }

  const navTo = (id: SectionId) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const allStates = useMemo(() => {
    const s = new Set(allInvoices.map((i) => i.state).filter(Boolean))
    return Array.from(s).sort()
  }, [allInvoices])

  const invoices = useMemo(() => {
    let data = filterByPeriod(allInvoices, period)
    if (stateFilter !== 'all') data = data.filter((i) => i.state === stateFilter)
    const q = search.trim().toLowerCase()
    if (q) data = data.filter((i) => i.company.toLowerCase().includes(q) || i.contactName.toLowerCase().includes(q))
    return data
  }, [allInvoices, period, stateFilter, search])

  const kpi = useMemo(() => {
    const { currStart, prevStart, prevEnd } = periodBounds(period)
    const prevInvs = allInvoices.filter((i) => {
      const d = new Date(i.date); return d >= prevStart && d <= prevEnd
    })
    const total          = invoices.reduce((s, i) => s + i.total, 0)
    const prevTotal      = prevInvs.reduce((s, i) => s + i.total, 0)
    const collected      = invoices.filter((i) => i.paidBy !== 'pending' && i.docKind !== 'memo').reduce((s, i) => s + i.total, 0)
    const prevCollected  = prevInvs.filter((i) => i.paidBy !== 'pending' && i.docKind !== 'memo').reduce((s, i) => s + i.total, 0)
    const pending        = invoices.filter((i) => i.paidBy === 'pending').reduce((s, i) => s + i.total, 0)
    const count          = invoices.length
    const prevCount      = prevInvs.length
    const avg            = count > 0 ? total / count : 0
    const prevAvg        = prevCount > 0 ? prevTotal / prevCount : 0
    const collRate       = total > 0 ? (collected / total) * 100 : 0
    const pendingCount   = invoices.filter((i) => i.paidBy === 'pending').length
    void currStart
    return {
      total, collected, pending, count, avg, collRate, pendingCount,
      totalTrend: trendPct(total, prevTotal),
      collTrend:  trendPct(collected, prevCollected),
      countTrend: trendPct(count, prevCount),
      avgTrend:   trendPct(avg, prevAvg),
    }
  }, [invoices, allInvoices, period])

  if (!unlocked) return <PasswordGate onUnlock={() => setUnlocked(true)} />

  const PERIODS: [Period, string][] = [['7d','7D'], ['30d','30D'], ['90d','90D'], ['6m','6M'], ['1y','1Y'], ['all','All']]

  const hasFilters = search || stateFilter !== 'all'

  return (
    <div style={{ fontFamily: 'Inter, system-ui, -apple-system, sans-serif', background: C.pageBg, minHeight: '100vh', color: C.s900, display: 'flex' }}>

      {/* ── Sidebar ── */}
      <Sidebar
        active={activeSection}
        pendingCount={kpi.pendingCount}
        onNav={navTo}
        onRefresh={load}
        onExport={() => exportCSV(invoices)}
        loading={loading}
      />

      {/* ── Main content ── */}
      <div style={{ marginLeft: SIDEBAR_W, flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>

        {/* Sticky top bar */}
        <header style={{ position: 'sticky', top: 0, zIndex: 90, background: '#fff', borderBottom: `1px solid ${C.s200}`, padding: '0 32px', boxShadow: '0 1px 8px rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', height: 58, gap: 12, flexWrap: 'wrap' }}>

            {/* Title */}
            <div style={{ fontSize: 14, fontWeight: 700, color: C.s900, marginRight: 6 }}>
              {NAV_ITEMS.find((n) => n.id === activeSection)?.label ?? 'Dashboard'}
            </div>

            <div style={{ width: 1, height: 20, background: C.s200, flexShrink: 0 }} />

            {/* Period tabs */}
            <div style={{ display: 'flex', gap: 2, background: C.s900, borderRadius: 10, padding: 3 }}>
              {PERIODS.map(([p, label]) => (
                <button key={p} onClick={() => setPeriod(p)}
                  className={`period-tab${period === p ? ' period-active' : ''}`}
                  style={{ padding: '5px 13px', borderRadius: 8, border: 'none', background: 'transparent', color: period === p ? C.s900 : 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {label}
                </button>
              ))}
            </div>

            {/* State filter */}
            <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}
              style={{ padding: '7px 10px', borderRadius: 8, border: `1.5px solid ${C.s200}`, background: C.s50, color: C.s700, fontSize: 12, cursor: 'pointer', outline: 'none', fontFamily: 'inherit' }}>
              <option value="all">All States</option>
              {allStates.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>

            {/* Search */}
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search company…"
              style={{ flex: 1, maxWidth: 210, padding: '7px 12px', borderRadius: 8, border: `1.5px solid ${C.s200}`, background: C.s50, color: C.s900, fontSize: 13, outline: 'none', fontFamily: 'inherit' }} />

            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              {lastRefresh && (
                <div style={{ fontSize: 11, color: C.s400, whiteSpace: 'nowrap' }}>
                  Updated {lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              )}
              {loading && <div className="spin" style={{ width: 16, height: 16, border: `2px solid ${C.s200}`, borderTopColor: C.indigo, borderRadius: '50%' }} />}
            </div>
          </div>

          {/* Active filters bar */}
          {hasFilters && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 10, fontSize: 12 }}>
              <span style={{ color: C.s500 }}>Filtered: <strong style={{ color: C.s800 }}>{invoices.length}</strong> of <strong style={{ color: C.s800 }}>{allInvoices.length}</strong> invoices</span>
              {search && <span style={{ background: C.indigo + '15', color: C.indigo, padding: '2px 10px', borderRadius: 99, fontWeight: 700, border: `1px solid ${C.indigo}30` }}>{search}</span>}
              {stateFilter !== 'all' && <span style={{ background: C.indigo + '15', color: C.indigo, padding: '2px 10px', borderRadius: 99, fontWeight: 700, border: `1px solid ${C.indigo}30` }}>{stateFilter}</span>}
              <button onClick={() => { setSearch(''); setStateFilter('all') }}
                style={{ marginLeft: 4, fontSize: 12, color: C.indigo, border: 'none', background: 'none', cursor: 'pointer', fontWeight: 700, fontFamily: 'inherit' }}>Clear</button>
            </div>
          )}
        </header>

        {/* Page body */}
        <div style={{ flex: 1, padding: '32px 32px 80px' }}>

          {/* Error banner */}
          {error && (
            <div style={{ background: '#fef2f2', border: `1px solid #fecaca`, borderRadius: 12, padding: '14px 18px', marginBottom: 24, color: '#ef4444', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="alert" size={16} stroke="#ef4444" /> {error}
            </div>
          )}

          {loading && !allInvoices.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '120px 0', gap: 16 }}>
              <div className="spin" style={{ width: 36, height: 36, border: `3px solid ${C.s200}`, borderTopColor: C.indigo, borderRadius: '50%' }} />
              <div style={{ fontSize: 15, color: C.s400 }}>Loading from Supabase…</div>
            </div>
          ) : allInvoices.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '120px 0', gap: 12 }}>
              <div style={{ fontSize: 52 }}>🧾</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: C.s900 }}>No invoices yet</div>
              <div style={{ fontSize: 14, color: C.s500 }}>Create invoices in the app — they'll appear here automatically.</div>
            </div>
          ) : (
            <>
              {/* ── KPIs ── */}
              <div id="overview" style={{ marginBottom: 32, scrollMarginTop: 80 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.s400, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 14 }}>Overview</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14 }}>
                  <KpiCard label="Total Revenue"  rawValue={kpi.total}     format="money" sub="All billed"                                  trend={kpi.totalTrend}  accentColor={C.indigo} iconName="dollar" fadeClass="fade-up-1" />
                  <KpiCard label="Collected"       rawValue={kpi.collected} format="money" sub={`${kpi.collRate.toFixed(0)}% collection rate`} trend={kpi.collTrend}  accentColor={GREEN}    iconName="check"  fadeClass="fade-up-2" />
                  <KpiCard label="Outstanding"     rawValue={kpi.pending}   format="money" sub={`${kpi.pendingCount} pending invoices`}         trend={null}           accentColor={ORANGE}   iconName="clock"  fadeClass="fade-up-3" />
                  <KpiCard label="Total Documents" rawValue={kpi.count}     format="count" sub="Invoices + memos"                             trend={kpi.countTrend} accentColor={TEAL}     iconName="file"   fadeClass="fade-up-4" />
                  <KpiCard label="Avg Deal Size"   rawValue={kpi.avg}       format="money" sub="Per invoice"                                  trend={kpi.avgTrend}   accentColor={PURPLE}   iconName="trending" fadeClass="fade-up-5" />
                </div>
              </div>

              {/* ── Revenue Trend ── */}
              <div id="revenue" style={{ marginBottom: 20, scrollMarginTop: 80 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.s400, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 14 }}>Revenue Trend</div>
                <RevenueTrendChart invoices={invoices} />
              </div>

              {/* ── Payments + Collection ── */}
              <div id="payments" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20, scrollMarginTop: 80 }}>
                <PaymentDonut invoices={invoices} />
                <CollectionCard invoices={invoices} />
              </div>

              {/* ── By State + Top Customers ── */}
              <div id="geography" style={{ scrollMarginTop: 80 }}>
                <div id="customers" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20, scrollMarginTop: 80 }}>
                  <StateRevenueChart invoices={invoices} />
                  <TopCustomers invoices={invoices} />
                </div>
              </div>

              {/* ── Product Mix + Activity ── */}
              <div id="products" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24, scrollMarginTop: 80 }}>
                <ProductMixChart invoices={invoices} />
                <InvoiceActivityChart invoices={invoices} />
              </div>

              {/* ── Receivables ── */}
              <div id="receivables" style={{ marginBottom: 24, scrollMarginTop: 80 }}>
                {invoices.some((i) => i.paidBy === 'pending') ? (
                  <PendingTable invoices={invoices} onMarkPaid={markPaid} />
                ) : (
                  <div style={{ ...card, padding: '28px 24px', display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 12, background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="check" size={20} stroke={GREEN} />
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: C.s900 }}>All caught up</div>
                      <div style={{ fontSize: 13, color: C.s500, marginTop: 2 }}>No pending receivables in this period.</div>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Shop Ledger ── */}
              <div id="ledger" style={{ scrollMarginTop: 80 }}>
                <ShopLedger invoices={invoices} onMarkPaid={markPaid} onDelete={deleteMemo} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
