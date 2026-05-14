import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { SavedInvoice } from '../types/invoice'
import { printSavedInvoice } from '../lib/invoicePrint'

// ─── Supabase / auth ──────────────────────────────────────────────────────────

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

// ─── Dark premium color system ────────────────────────────────────────────────

const D = {
  // backgrounds
  page:    '#06090f',
  sidebar: '#08101a',
  card:    '#0d1625',
  card2:   '#0a1220',
  topbar:  'rgba(8,12,22,0.96)',
  hover:   '#111e30',

  // borders
  border:  'rgba(255,255,255,0.07)',
  borderM: 'rgba(255,255,255,0.11)',

  // text
  text:    '#e2eaf5',
  text2:   '#6e7f94',
  text3:   '#384555',

  // accent — teal/cyan
  teal:    '#14b8a6',
  tealBrt: '#2dd4bf',
  cyan:    '#22d3ee',

  // chart / semantic
  green:   '#10b981',
  orange:  '#f59e0b',
  red:     '#ef4444',
  redSoft: '#f87171',
  purple:  '#a855f7',
  blue:    '#3b82f6',
  indigo:  '#6366f1',
  amber:   '#d97706',
}

// Chart data colors (bright for dark bg)
const CH = {
  total:   '#22d3ee',   // cyan — total billed
  coll:    '#10b981',   // emerald — collected
  pending: '#f59e0b',   // amber
  memo:    '#a855f7',   // purple
  cash:    '#10b981',
  check:   '#3b82f6',
  inv:     '#6366f1',
  mix:     ['#22d3ee','#14b8a6','#10b981','#f59e0b','#a855f7','#6366f1','#06b6d4','#84cc16'],
}

const SIDEBAR_W = 224

function dc(extra?: React.CSSProperties): React.CSSProperties {
  return {
    background: `linear-gradient(135deg, ${D.card} 0%, ${D.card2} 100%)`,
    border: `1px solid ${D.border}`,
    borderRadius: 16,
    boxShadow: '0 4px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04)',
    overflow: 'hidden',
    ...extra,
  }
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useCountUp(target: number, duration = 900): number {
  const [val, setVal] = useState(target)
  const rafRef  = useRef<number | null>(null)
  const prevRef = useRef(target)

  useEffect(() => {
    const from = prevRef.current
    prevRef.current = target
    if (from === target) return
    const startTime = performance.now()
    const tick = (now: number) => {
      const t     = Math.min((now - startTime) / duration, 1)
      const eased = 1 - Math.pow(1 - t, 3)
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

// ─── SVG icons ────────────────────────────────────────────────────────────────

type IconName = 'home' | 'trending' | 'pie' | 'map' | 'users' | 'bar' | 'alert' | 'list' |
                'refresh' | 'download' | 'dollar' | 'check' | 'clock' | 'file' | 'x' | 'print' | 'lock'

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
    case 'lock':    return <svg style={s} viewBox="0 0 24 24" {...p}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
    default: return null
  }
}

// ─── Utility components ───────────────────────────────────────────────────────

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <div style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
      <div style={{ fontSize: 12, color: D.text2 }}>{label}</div>
    </div>
  )
}

function EmptyChart() {
  return <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: D.text3, fontSize: 14 }}>No data for this period</div>
}

function GlowTooltip({ active, payload, label, formatter }: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string
  formatter?: (v: number, name: string) => string
}) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#0a1220', borderRadius: 12, padding: '12px 16px', boxShadow: '0 8px 32px rgba(0,0,0,0.6)', minWidth: 160, border: `1px solid ${D.borderM}` }}>
      {label && <div style={{ color: D.text3, fontSize: 10, fontWeight: 700, marginBottom: 10, letterSpacing: '0.5px', textTransform: 'uppercase' }}>{label}</div>}
      {payload.map((p) => (
        <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 20, marginBottom: 5, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: p.color, boxShadow: `0 0 6px ${p.color}80`, flexShrink: 0 }} />
            <div style={{ color: D.text2, fontSize: 12 }}>{p.name}</div>
          </div>
          <div style={{ color: D.text, fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {formatter ? formatter(p.value, p.name) : money(p.value)}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Section label ────────────────────────────────────────────────────────────

function SectionLabel({ text }: { text: string }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, color: D.text3, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 1, background: D.border }} />
      {text}
      <div style={{ flex: 1, height: 1, background: D.border }} />
    </div>
  )
}

function CardHeader({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: D.text, letterSpacing: '-0.1px' }}>{title}</div>
        {sub && <div style={{ fontSize: 12, color: D.text2, marginTop: 3 }}>{sub}</div>}
      </div>
      {right}
    </div>
  )
}

// ─── Password gate ────────────────────────────────────────────────────────────

function PasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [pw, setPw]   = useState('')
  const [err, setErr] = useState('')

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: D.page, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ width: 420 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <img src="/delta-logo.png" alt="Delta Diamonds" style={{ height: 44, objectFit: 'contain', marginBottom: 14, opacity: 0.9 }} />
          <div style={{ fontSize: 12, color: D.text3, fontWeight: 500, letterSpacing: '1px', textTransform: 'uppercase' }}>Revenue Analytics Platform</div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (pw === APP_PASSWORD) { sessionStorage.setItem(AUTH_KEY, pw); onUnlock() }
            else setErr('Incorrect password.')
          }}
          style={{ ...dc({ padding: '36px 40px', overflow: 'visible' }) }}
        >
          {/* Lock icon ring */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
            <div style={{ width: 52, height: 52, borderRadius: 16, background: `rgba(20,184,166,0.12)`, border: `1px solid rgba(20,184,166,0.25)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="lock" size={22} stroke={D.tealBrt} />
            </div>
          </div>

          <div style={{ fontSize: 20, fontWeight: 800, color: D.text, marginBottom: 6, letterSpacing: '-0.3px', textAlign: 'center' }}>Protected Dashboard</div>
          <div style={{ fontSize: 13, color: D.text2, marginBottom: 28, textAlign: 'center' }}>Delta Diamonds — internal access only</div>

          <div style={{ marginBottom: err ? 8 : 20 }}>
            <input
              type="password" value={pw} onChange={(e) => { setPw(e.target.value); setErr('') }}
              placeholder="Enter access password" autoFocus
              style={{ width: '100%', padding: '13px 16px', borderRadius: 10, border: `1.5px solid ${err ? 'rgba(239,68,68,0.5)' : D.border}`, background: '#060a13', fontSize: 15, boxSizing: 'border-box', outline: 'none', color: D.text, fontFamily: 'inherit', transition: 'border-color 0.15s' }}
            />
          </div>

          {err && (
            <div style={{ color: D.redSoft, fontSize: 13, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="alert" size={13} stroke={D.redSoft} /> {err}
            </div>
          )}

          <button type="submit" className="btn btn-primary"
            style={{ width: '100%', padding: '13px', borderRadius: 10, border: 'none', background: `linear-gradient(135deg, ${D.teal}, ${D.cyan})`, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', boxShadow: `0 4px 20px rgba(20,184,166,0.3)` }}>
            Unlock Dashboard
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── KPI card ─────────────────────────────────────────────────────────────────

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
  const trendColor = isGood ? D.green : D.red

  return (
    <div
      style={{ ...dc({ padding: '22px 22px 20px', borderTop: `2px solid ${accentColor}` }) }}
      className={`card-lift${fadeClass ? ` fade-up ${fadeClass}` : ''}`}
    >
      {/* Icon badge + trend */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div style={{ width: 38, height: 38, borderRadius: 11, background: `${accentColor}18`, border: `1px solid ${accentColor}38`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 16px ${accentColor}25` }}>
          <Icon name={iconName} size={18} stroke={accentColor} />
        </div>
        {trend !== null && trend !== undefined && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: isGood ? 'rgba(16,185,129,0.14)' : 'rgba(239,68,68,0.14)', padding: '3px 9px', borderRadius: 99, border: `1px solid ${isGood ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}` }}>
            <span style={{ color: trendColor, fontSize: 10 }}>{isUp ? '▲' : '▼'}</span>
            <span style={{ color: trendColor, fontSize: 11, fontWeight: 700 }}>{Math.abs(trend).toFixed(1)}%</span>
          </div>
        )}
      </div>

      {/* Big animated number */}
      <div style={{ fontSize: 30, fontWeight: 800, color: D.text, lineHeight: 1, letterSpacing: '-0.5px', marginBottom: 7, fontVariantNumeric: 'tabular-nums' }}>
        {formatted}
      </div>

      <div style={{ fontSize: 10, fontWeight: 700, color: D.text3, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: sub ? 4 : 0 }}>{label}</div>
      {sub && <div style={{ fontSize: 12, color: D.text2 }}>{sub}</div>}
    </div>
  )
}

// ─── Revenue trend chart ──────────────────────────────────────────────────────

function RevenueTrendChart({ invoices }: { invoices: SavedInvoice[] }) {
  const data = useMemo(() => {
    const map = new Map<string, { total: number; collected: number }>()
    invoices.forEach((inv) => {
      const k = inv.date.slice(0, 7)
      const r = map.get(k) ?? { total: 0, collected: 0 }
      r.total += inv.total
      if (inv.paidBy !== 'pending' && inv.docKind !== 'memo') r.collected += inv.total
      map.set(k, r)
    })
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => ({ month: fmtMonthShort(k), Total: Math.round(v.total), Collected: Math.round(v.collected) }))
  }, [invoices])

  if (!data.length) return <div style={dc({ padding: '24px' })} className="card-lift"><EmptyChart /></div>

  const tickStyle = { fontSize: 11, fill: D.text3 }

  return (
    <div style={dc({ padding: '24px' })} className="card-lift">
      <CardHeader title="Revenue Trend" sub="Monthly invoiced vs collected"
        right={<div style={{ display: 'flex', gap: 16 }}><LegendDot color={CH.total} label="Total Billed" /><LegendDot color={CH.coll} label="Collected" /></div>}
      />
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 10 }}>
          <defs>
            <linearGradient id="gTotal" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={CH.total} stopOpacity={0.22} />
              <stop offset="100%" stopColor={CH.total} stopOpacity={0}    />
            </linearGradient>
            <linearGradient id="gColl" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={CH.coll} stopOpacity={0.22} />
              <stop offset="100%" stopColor={CH.coll} stopOpacity={0}    />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis dataKey="month" tick={tickStyle} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} tick={tickStyle} axisLine={false} tickLine={false} width={54} />
          <Tooltip content={<GlowTooltip />} />
          <Area type="monotone" dataKey="Total"     stroke={CH.total} strokeWidth={2.5} fill="url(#gTotal)" name="Total Billed" dot={false} activeDot={{ r: 5, strokeWidth: 0, fill: CH.total }} />
          <Area type="monotone" dataKey="Collected" stroke={CH.coll}  strokeWidth={2.5} fill="url(#gColl)"  name="Collected"   dot={false} activeDot={{ r: 5, strokeWidth: 0, fill: CH.coll  }} />
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

  if (!data.length) return <div style={dc({ padding: '24px' })} className="card-lift"><EmptyChart /></div>

  const t = { fontSize: 11, fill: D.text3 }

  return (
    <div style={dc({ padding: '24px' })} className="card-lift">
      <CardHeader title="Invoice Activity" sub="Monthly invoice & memo count"
        right={<div style={{ display: 'flex', gap: 14 }}><LegendDot color={CH.inv} label="Invoices" /><LegendDot color={CH.memo} label="Memos" /></div>}
      />
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barSize={14} barGap={3}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis dataKey="month" tick={t} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={t} axisLine={false} tickLine={false} width={28} />
          <Tooltip content={<GlowTooltip formatter={(v) => String(v)} />} />
          <Bar dataKey="Invoices" fill={CH.inv}  radius={[4,4,0,0]} name="Invoices" />
          <Bar dataKey="Memos"    fill={CH.memo} radius={[4,4,0,0]} name="Memos" />
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
      { name: 'Cash',    value: Math.round(cash),    color: CH.cash,    fill: CH.cash    },
      { name: 'Check',   value: Math.round(check),   color: CH.check,   fill: CH.check   },
      { name: 'Pending', value: Math.round(pending), color: CH.pending, fill: CH.pending },
      { name: 'Memo',    value: Math.round(memo),    color: CH.memo,    fill: CH.memo    },
    ].filter((d) => d.value > 0)
  }, [invoices])

  const total = data.reduce((s, d) => s + d.value, 0)

  if (!data.length) return <div style={dc({ padding: '24px' })} className="card-lift"><EmptyChart /></div>

  return (
    <div style={dc({ padding: '24px' })} className="card-lift">
      <CardHeader title="Payment Methods" sub="Revenue by collection type" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <PieChart width={170} height={170}>
            <Pie data={data} cx={83} cy={83} innerRadius={52} outerRadius={78} dataKey="value" stroke="none" startAngle={90} endAngle={-270} />
            <Tooltip content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const d = payload[0]
              return (
                <div style={{ background: '#0a1220', borderRadius: 10, padding: '10px 14px', border: `1px solid ${D.borderM}` }}>
                  <div style={{ color: D.text2, fontSize: 12, marginBottom: 4 }}>{d.name}</div>
                  <div style={{ color: D.text, fontSize: 14, fontWeight: 700 }}>{money(Number(d.value))}</div>
                  <div style={{ color: D.text3, fontSize: 12 }}>{total > 0 ? ((Number(d.value) / total) * 100).toFixed(1) : 0}%</div>
                </div>
              )
            }} />
          </PieChart>
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: D.text, fontVariantNumeric: 'tabular-nums' }}>{money(total)}</div>
            <div style={{ fontSize: 10, color: D.text3, marginTop: 1 }}>total</div>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          {data.map((d, i) => (
            <div key={d.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderTop: i ? `1px solid ${D.border}` : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 10, height: 10, borderRadius: 3, background: d.color, boxShadow: `0 0 6px ${d.color}70` }} />
                <div style={{ fontSize: 13, fontWeight: 600, color: D.text }}>{d.name}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: d.color }}>{money(d.value)}</div>
                <div style={{ fontSize: 11, color: D.text3 }}>{total > 0 ? ((d.value / total) * 100).toFixed(1) : 0}%</div>
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

  if (!data.length) return <div style={dc({ padding: '24px' })} className="card-lift"><EmptyChart /></div>

  const t = { fontSize: 11, fill: D.text3 }

  return (
    <div style={dc({ padding: '24px' })} className="card-lift">
      <CardHeader title="Revenue by State" sub="Top 10 states by billed amount"
        right={<div style={{ display: 'flex', gap: 14 }}><LegendDot color={CH.total} label="Total" /><LegendDot color={CH.pending} label="Pending" /></div>}
      />
      <ResponsiveContainer width="100%" height={Math.max(220, data.length * 34)}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 0, bottom: 0, left: 16 }} barSize={10} barGap={2}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
          <XAxis type="number" tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} tick={t} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="state" tick={{ fontSize: 12, fill: D.text2, fontWeight: 600 }} axisLine={false} tickLine={false} width={28} />
          <Tooltip content={<GlowTooltip />} />
          <Bar dataKey="Revenue" fill={CH.total}   radius={[0,4,4,0]} name="Total" />
          <Bar dataKey="Pending" fill={CH.pending} radius={[0,4,4,0]} name="Pending" />
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

  const coloredData = data.map((d, i) => ({ ...d, fill: CH.mix[i % CH.mix.length] }))

  if (!coloredData.length) return <div style={dc({ padding: '24px' })} className="card-lift"><EmptyChart /></div>

  const t = { fontSize: 11, fill: D.text3 }

  return (
    <div style={dc({ padding: '24px' })} className="card-lift">
      <CardHeader title="Product Mix" sub="Revenue by stone size prefix" />
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={coloredData} margin={{ top: 4, right: 4, bottom: 20, left: 10 }} barSize={32}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 12, fill: D.text2, fontWeight: 600 }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} tick={t} axisLine={false} tickLine={false} width={50} />
          <Tooltip content={<GlowTooltip />} />
          <Bar dataKey="Revenue" name="Revenue" radius={[6,6,0,0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Top customers leaderboard ────────────────────────────────────────────────

function TopCustomers({ invoices }: { invoices: SavedInvoice[] }) {
  const customers = useMemo(() => {
    const map = new Map<string, { total: number; paid: number; count: number }>()
    invoices.forEach((inv) => {
      const key = inv.company || inv.contactName || 'Unknown'
      const r = map.get(key) ?? { total: 0, paid: 0, count: 0 }
      r.total += inv.total; r.count += 1
      if (inv.paidBy !== 'pending' && inv.docKind !== 'memo') r.paid += inv.total
      map.set(key, r)
    })
    const sorted = Array.from(map.entries())
      .map(([name, v]) => ({ name, ...v, rate: v.total > 0 ? (v.paid / v.total) * 100 : 0 }))
      .sort((a, b) => b.total - a.total).slice(0, 9)
    const max = sorted[0]?.total ?? 1
    return sorted.map((r, i) => ({ ...r, rank: i + 1, pct: (r.total / max) * 100 }))
  }, [invoices])

  const rankBg = (i: number) => i === 0 ? D.amber : i === 1 ? '#8892a4' : i === 2 ? '#cd7f32' : D.card2
  const rankTx = (i: number) => i < 3 ? '#fff' : D.text3

  return (
    <div style={dc({ padding: '24px' })} className="card-lift">
      <CardHeader title="Top Customers" sub="Ranked by total billed value" />
      {customers.map((c, i) => (
        <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: i ? `1px solid ${D.border}` : 'none' }}>
          <div style={{ width: 26, height: 26, borderRadius: 8, background: rankBg(i), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: rankTx(i), flexShrink: 0 }}>
            {c.rank}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: D.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '55%' }}>{c.name}</div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: c.rate < 70 ? D.orange : D.green }}>{c.rate.toFixed(0)}% paid</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: D.text, fontVariantNumeric: 'tabular-nums' }}>{money(c.total)}</span>
              </div>
            </div>
            <div style={{ height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${c.pct}%`, borderRadius: 99, background: `linear-gradient(90deg, ${D.teal}, ${D.cyan})`, boxShadow: `0 0 8px ${D.teal}60`, transition: 'width 0.6s ease' }} />
            </div>
          </div>
        </div>
      ))}
      {!customers.length && <div style={{ padding: '24px 0', textAlign: 'center', color: D.text3, fontSize: 14 }}>No data</div>}
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

  const circ = 2 * Math.PI * 44
  const dash = (stats.rate / 100) * circ
  const gaugeColor = stats.rate >= 80 ? D.green : stats.rate >= 60 ? D.amber : D.red

  return (
    <div style={dc({ padding: '24px' })} className="card-lift">
      <CardHeader title="Collection Efficiency" sub="Payment collection performance" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <svg width={110} height={110}>
            <circle cx={55} cy={55} r={44} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={10} />
            <circle cx={55} cy={55} r={44} fill="none"
              stroke={gaugeColor} strokeWidth={10} strokeLinecap="round"
              strokeDasharray={`${dash} ${circ}`}
              transform="rotate(-90 55 55)"
              style={{ transition: 'stroke-dasharray 0.7s ease', filter: `drop-shadow(0 0 6px ${gaugeColor}80)` }}
            />
          </svg>
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
            <div style={{ fontSize: 19, fontWeight: 800, color: D.text }}>{stats.rate.toFixed(0)}%</div>
            <div style={{ fontSize: 10, color: D.text3 }}>collected</div>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          {[
            { label: 'Collected',        value: money(stats.collected),          color: D.green  },
            { label: 'Outstanding',      value: money(stats.pending),            color: D.orange },
            { label: 'Avg days overdue', value: `${stats.avgOverdue.toFixed(0)}d`, color: stats.avgOverdue > 30 ? D.red : D.text2 },
            { label: '30d+ overdue',     value: `${stats.overdue30} inv`,        color: stats.overdue30 > 0 ? D.red : D.text2 },
          ].map((row, i) => (
            <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: i ? `1px solid ${D.border}` : 'none' }}>
              <div style={{ fontSize: 12, color: D.text2 }}>{row.label}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: row.color, fontVariantNumeric: 'tabular-nums' }}>{row.value}</div>
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

  const urgencyColor = (d: number) => d > 30 ? D.red : d > 14 ? D.orange : D.amber
  const totalPending = rows.reduce((s, r) => s + r.total, 0)

  return (
    <div style={dc()} className="card-lift">
      <div style={{ padding: '18px 24px', borderBottom: `1px solid ${D.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(245,158,11,0.06)' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: D.text, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="alert" size={15} stroke={D.orange} /> Pending Receivables
          </div>
          <div style={{ fontSize: 12, color: D.text2, marginTop: 3 }}>{rows.length} outstanding invoice{rows.length !== 1 ? 's' : ''}</div>
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: D.orange, fontVariantNumeric: 'tabular-nums' }}>{money(totalPending)}</div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
              {['Company', 'State', 'Invoice Date', 'Days Outstanding', 'Amount', 'Action'].map((h, i) => (
                <th key={h} style={{ padding: '11px 16px', textAlign: i >= 3 ? 'right' : 'left', fontSize: 10, fontWeight: 700, color: D.text3, textTransform: 'uppercase', letterSpacing: '0.6px', borderBottom: `1px solid ${D.border}`, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const uc = urgencyColor(row.days)
              return (
                <tr key={row.id} className="tr-hover" style={{ borderBottom: `1px solid ${D.border}` }}>
                  <td style={{ padding: '13px 16px', fontWeight: 700, color: D.text, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.company || row.contactName}</td>
                  <td style={{ padding: '13px 16px', color: D.text2 }}>{row.state || '—'}</td>
                  <td style={{ padding: '13px 16px', color: D.text2 }}>{row.date}</td>
                  <td style={{ padding: '13px 16px', textAlign: 'right' }}>
                    <span style={{ background: `${uc}18`, color: uc, fontWeight: 700, fontSize: 12, padding: '3px 10px', borderRadius: 99, border: `1px solid ${uc}35` }}>
                      {row.days}d
                    </span>
                  </td>
                  <td style={{ padding: '13px 16px', textAlign: 'right', fontWeight: 800, color: D.orange, fontVariantNumeric: 'tabular-nums' }}>{money(row.total)}</td>
                  <td style={{ padding: '13px 16px', textAlign: 'right' }}>
                    {pickerOpen !== row.id ? (
                      <button onClick={() => setPickerOpen(row.id)} className="btn btn-paid"
                        style={{ padding: '6px 14px', borderRadius: 8, border: `1.5px solid rgba(16,185,129,0.35)`, background: 'rgba(16,185,129,0.08)', fontSize: 12, fontWeight: 700, color: D.green, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit' }}>
                        Mark Paid
                      </button>
                    ) : (
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button onClick={() => { onMarkPaid(row.id, 'cash');  setPickerOpen(null) }} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: D.green,   color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Cash</button>
                        <button onClick={() => { onMarkPaid(row.id, 'check'); setPickerOpen(null) }} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: D.blue,    color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Check</button>
                        <button onClick={() => setPickerOpen(null)} style={{ padding: '6px 10px', borderRadius: 8, border: `1px solid ${D.border}`, background: 'transparent', fontSize: 12, color: D.text2, cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
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
  const statusColor = isMemo ? D.purple : isPending ? D.orange : inv.paidBy === 'cash' ? D.green : D.blue
  const statusLabel = isMemo ? 'MEMO' : isPending ? 'PENDING' : inv.paidBy === 'cash' ? 'CASH' : 'CHECK'

  return (
    <div style={{ background: isMemo ? 'rgba(168,85,247,0.07)' : isPending ? 'rgba(245,158,11,0.07)' : 'rgba(255,255,255,0.03)', border: `1px solid ${D.border}`, borderRadius: 10, padding: '13px 16px', marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: D.text }}>{inv.date}</div>
          <div style={{ fontSize: 12, color: D.text2, marginTop: 2 }}>
            {inv.docKind.toUpperCase()} · <span style={{ color: statusColor, fontWeight: 700 }}>{statusLabel}</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: statusColor, fontVariantNumeric: 'tabular-nums' }}>{money(inv.total, 2)}</div>
          <button onClick={() => printSavedInvoice(inv)} className="btn btn-ghost"
            style={{ padding: '5px 10px', borderRadius: 8, border: `1px solid ${D.border}`, background: 'transparent', fontSize: 12, fontWeight: 600, color: D.text2, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'inherit' }}>
            <Icon name="print" size={12} stroke={D.text2} /> Print
          </button>
          {isPending && onMarkPaid && !showPicker && (
            <button onClick={() => setShowPicker(true)} className="btn btn-paid"
              style={{ padding: '5px 10px', borderRadius: 8, border: `1.5px solid rgba(16,185,129,0.3)`, background: 'rgba(16,185,129,0.08)', fontSize: 12, fontWeight: 700, color: D.green, cursor: 'pointer', fontFamily: 'inherit' }}>Mark Paid</button>
          )}
          {isPending && onMarkPaid && showPicker && (
            <>
              <button onClick={() => { onMarkPaid(inv.id, 'cash');  setShowPicker(false) }} style={{ padding: '5px 10px', borderRadius: 8, border: 'none', background: D.green, fontSize: 12, fontWeight: 700, color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>Cash</button>
              <button onClick={() => { onMarkPaid(inv.id, 'check'); setShowPicker(false) }} style={{ padding: '5px 10px', borderRadius: 8, border: 'none', background: D.blue,  fontSize: 12, fontWeight: 700, color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>Check</button>
              <button onClick={() => setShowPicker(false)} style={{ padding: '5px 9px', borderRadius: 8, border: `1px solid ${D.border}`, background: 'transparent', fontSize: 12, color: D.text2, cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
            </>
          )}
          {isMemo && onDelete && (
            <button onClick={() => { if (window.confirm('Delete this memo?')) onDelete(inv.id) }} className="btn btn-danger"
              style={{ padding: '5px 10px', borderRadius: 8, border: `1.5px solid rgba(239,68,68,0.3)`, background: 'rgba(239,68,68,0.08)', fontSize: 12, fontWeight: 700, color: D.redSoft, cursor: 'pointer', fontFamily: 'inherit' }}>Delete</button>
          )}
        </div>
      </div>
      {inv.items.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr>
            {['Size','Pcs','Ct','P/Ct','Amount'].map((h, i) => (
              <th key={h} style={{ textAlign: i === 0 ? 'left' : 'right', padding: '4px 6px', fontWeight: 700, color: D.text3, borderBottom: `1px solid ${D.border}` }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {inv.items.map((item, i) => (
              <tr key={i} className="tr-hover">
                <td style={{ padding: '5px 6px', borderBottom: `1px solid ${D.border}`, fontWeight: 600, color: D.text }}>{item.size}</td>
                <td style={{ padding: '5px 6px', borderBottom: `1px solid ${D.border}`, textAlign: 'right', color: D.text2 }}>{item.pcs}</td>
                <td style={{ padding: '5px 6px', borderBottom: `1px solid ${D.border}`, textAlign: 'right', color: D.text2 }}>{item.ct.toFixed(2)}</td>
                <td style={{ padding: '5px 6px', borderBottom: `1px solid ${D.border}`, textAlign: 'right', color: D.text2 }}>{money(item.pct, 2)}</td>
                <td style={{ padding: '5px 6px', borderBottom: `1px solid ${D.border}`, textAlign: 'right', fontWeight: 700, color: D.text, fontVariantNumeric: 'tabular-nums' }}>{money(item.amount, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {inv.notes && <div style={{ fontSize: 12, color: D.text2, marginTop: 8, fontStyle: 'italic' }}>Note: {inv.notes}</div>}
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
  const [expanded,     setExpanded]     = useState<Set<string>>(new Set())
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
    <div style={dc()}>
      <div style={{ padding: '18px 24px', borderBottom: `1px solid ${D.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: D.text, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="list" size={15} stroke={D.tealBrt} /> Shop Ledger
          </div>
          <div style={{ fontSize: 12, color: D.text2, marginTop: 3 }}>{filtered.length} shops · click any row to expand</div>
        </div>
        <input type="search" value={ledgerSearch} onChange={(e) => setLedgerSearch(e.target.value)}
          placeholder="Search shops…"
          style={{ padding: '9px 14px', borderRadius: 10, border: `1.5px solid ${D.border}`, background: '#060a13', fontSize: 13, outline: 'none', width: 220, color: D.text, fontFamily: 'inherit' }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2.5fr 1fr 1fr 1fr 0.8fr 64px', padding: '10px 24px', background: 'rgba(255,255,255,0.02)', borderBottom: `1px solid ${D.border}` }}>
        {['Shop', 'Sold', 'Paid', 'Pending', 'Last Sale', ''].map((h) => (
          <div key={h} style={{ fontSize: 10, fontWeight: 700, color: D.text3, textTransform: 'uppercase', letterSpacing: '0.7px' }}>{h}</div>
        ))}
      </div>

      {filtered.map((shop) => (
        <div key={shop.key}>
          <div onClick={() => toggle(shop.key)} className="tr-hover"
            style={{ display: 'grid', gridTemplateColumns: '2.5fr 1fr 1fr 1fr 0.8fr 64px', padding: '14px 24px', borderBottom: `1px solid ${D.border}`, cursor: 'pointer', background: expanded.has(shop.key) ? 'rgba(20,184,166,0.05)' : 'transparent', transition: 'background 0.15s' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: D.text }}>{shop.company}</div>
              <div style={{ fontSize: 12, color: D.text2, marginTop: 2 }}>{[shop.city, shop.state].filter(Boolean).join(', ')} · {shop.invoiceCount} inv</div>
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: CH.total, alignSelf: 'center', fontVariantNumeric: 'tabular-nums' }}>{money(shop.totalSold)}</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: D.green, alignSelf: 'center', fontVariantNumeric: 'tabular-nums' }}>{money(shop.totalPaid)}</div>
            <div style={{ fontSize: 14, fontWeight: shop.totalPending > 0 ? 700 : 400, color: shop.totalPending > 0 ? D.orange : D.text3, alignSelf: 'center', fontVariantNumeric: 'tabular-nums' }}>{shop.totalPending > 0 ? money(shop.totalPending) : '—'}</div>
            <div style={{ fontSize: 13, color: D.text2, alignSelf: 'center' }}>{shop.lastDate}</div>
            <div style={{ fontSize: 12, color: D.tealBrt, fontWeight: 700, alignSelf: 'center', textAlign: 'right' }}>{expanded.has(shop.key) ? '▲' : '▼'}</div>
          </div>
          {expanded.has(shop.key) && (
            <div style={{ padding: '16px 24px', background: 'rgba(20,184,166,0.04)', borderBottom: `1px solid ${D.border}` }}>
              {groupByMonth(shop.invoices).map(({ month, label, invoices: mInvs, total }) => (
                <div key={month} style={{ marginBottom: 18 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: D.text3, textTransform: 'uppercase', letterSpacing: '0.6px' }}>{label}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: CH.total, fontVariantNumeric: 'tabular-nums' }}>{money(total)} · {mInvs.length} inv</div>
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
        <div style={{ padding: '48px', textAlign: 'center', color: D.text3, fontSize: 14 }}>No shops match your search.</div>
      )}
    </div>
  )
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

const SECTION_IDS = ['overview', 'revenue', 'payments', 'geography', 'customers', 'products', 'receivables', 'ledger'] as const
type SectionId = typeof SECTION_IDS[number]

const NAV_ITEMS: { id: SectionId; label: string; icon: IconName }[] = [
  { id: 'overview',    label: 'Overview',      icon: 'home'     },
  { id: 'revenue',     label: 'Revenue Trend', icon: 'trending' },
  { id: 'payments',    label: 'Payments',      icon: 'pie'      },
  { id: 'geography',   label: 'By State',      icon: 'map'      },
  { id: 'customers',   label: 'Customers',     icon: 'users'    },
  { id: 'products',    label: 'Product Mix',   icon: 'bar'      },
  { id: 'receivables', label: 'Receivables',   icon: 'alert'    },
  { id: 'ledger',      label: 'Shop Ledger',   icon: 'list'     },
]

function Sidebar({ active, pendingCount, onNav, onRefresh, onExport, loading }: {
  active: string; pendingCount: number
  onNav: (id: SectionId) => void; onRefresh: () => void; onExport: () => void; loading: boolean
}) {
  return (
    <aside style={{ position: 'fixed', left: 0, top: 0, bottom: 0, width: SIDEBAR_W, background: D.sidebar, display: 'flex', flexDirection: 'column', zIndex: 200, borderRight: `1px solid ${D.border}`, overflowY: 'auto' }}>
      {/* Logo */}
      <div style={{ padding: '22px 20px 18px', borderBottom: `1px solid ${D.border}` }}>
        <img src="/delta-logo.png" alt="Delta Diamonds" style={{ height: 28, objectFit: 'contain', filter: 'brightness(0) invert(1)', opacity: 0.85 }} />
        <div style={{ fontSize: 10, color: D.text3, marginTop: 8, fontWeight: 600, letterSpacing: '0.8px', textTransform: 'uppercase' }}>Revenue Analytics</div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '12px 10px' }}>
        {NAV_ITEMS.map((item) => {
          const isActive = active === item.id
          return (
            <button key={item.id} onClick={() => onNav(item.id)}
              className={`nav-btn${isActive ? ' nav-active' : ''}`}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', border: 'none', background: 'transparent', color: isActive ? D.tealBrt : 'rgba(255,255,255,0.38)', fontSize: 13, fontWeight: isActive ? 600 : 400, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', marginBottom: 2, position: 'relative' }}>
              <Icon name={item.icon} size={16} stroke="currentColor" />
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.id === 'receivables' && pendingCount > 0 && (
                <span style={{ background: D.red, color: '#fff', fontSize: 10, fontWeight: 800, borderRadius: 99, padding: '1px 6px', minWidth: 18, textAlign: 'center', boxShadow: `0 0 8px ${D.red}60` }}>
                  {pendingCount}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      {/* Bottom actions */}
      <div style={{ padding: '12px 10px 20px', borderTop: `1px solid ${D.border}` }}>
        <button onClick={onRefresh} disabled={loading} className="nav-btn"
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', border: 'none', background: 'transparent', color: loading ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.38)', fontSize: 13, cursor: loading ? 'default' : 'pointer', fontFamily: 'inherit', borderRadius: 9, marginBottom: 2 }}>
          <Icon name="refresh" size={15} stroke="currentColor" />
          {loading ? 'Refreshing…' : 'Refresh Data'}
        </button>
        <button onClick={onExport} className="nav-btn"
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.38)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', borderRadius: 9 }}>
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

  const navTo = (id: SectionId) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

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
    const prevInvs = allInvoices.filter((i) => { const d = new Date(i.date); return d >= prevStart && d <= prevEnd })
    const total         = invoices.reduce((s, i) => s + i.total, 0)
    const prevTotal     = prevInvs.reduce((s, i) => s + i.total, 0)
    const collected     = invoices.filter((i) => i.paidBy !== 'pending' && i.docKind !== 'memo').reduce((s, i) => s + i.total, 0)
    const prevCollected = prevInvs.filter((i) => i.paidBy !== 'pending' && i.docKind !== 'memo').reduce((s, i) => s + i.total, 0)
    const pending       = invoices.filter((i) => i.paidBy === 'pending').reduce((s, i) => s + i.total, 0)
    const count         = invoices.length
    const prevCount     = prevInvs.length
    const avg           = count > 0 ? total / count : 0
    const prevAvg       = prevCount > 0 ? prevTotal / prevCount : 0
    const collRate      = total > 0 ? (collected / total) * 100 : 0
    const pendingCount  = invoices.filter((i) => i.paidBy === 'pending').length
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

  const PERIODS: [Period, string][] = [['7d','7D'],['30d','30D'],['90d','90D'],['6m','6M'],['1y','1Y'],['all','All']]
  const hasFilters = search || stateFilter !== 'all'
  const activeLabel = NAV_ITEMS.find((n) => n.id === activeSection)?.label ?? 'Dashboard'

  return (
    <div style={{ fontFamily: 'Inter, system-ui, -apple-system, sans-serif', background: D.page, minHeight: '100vh', color: D.text, display: 'flex' }}>

      {/* ── Sidebar ── */}
      <Sidebar active={activeSection} pendingCount={kpi.pendingCount}
        onNav={navTo} onRefresh={load} onExport={() => exportCSV(invoices)} loading={loading} />

      {/* ── Main ── */}
      <div style={{ marginLeft: SIDEBAR_W, flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>

        {/* Sticky top bar */}
        <header style={{ position: 'sticky', top: 0, zIndex: 90, background: D.topbar, backdropFilter: 'blur(16px)', borderBottom: `1px solid ${D.border}`, padding: '0 32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', height: 58, gap: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: D.text, marginRight: 4, minWidth: 120 }}>{activeLabel}</div>
            <div style={{ width: 1, height: 18, background: D.border, flexShrink: 0 }} />

            {/* Period tabs */}
            <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,0.05)', borderRadius: 10, padding: 3, flexShrink: 0 }}>
              {PERIODS.map(([p, label]) => (
                <button key={p} onClick={() => setPeriod(p)}
                  className={`period-tab${period === p ? ' period-active' : ''}`}
                  style={{ padding: '5px 12px', borderRadius: 8, border: 'none', background: 'transparent', color: period === p ? D.tealBrt : 'rgba(255,255,255,0.32)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {label}
                </button>
              ))}
            </div>

            {/* State filter */}
            <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}
              style={{ padding: '7px 10px', borderRadius: 8, border: `1px solid ${D.border}`, background: '#0a0e18', color: D.text, fontSize: 12, cursor: 'pointer', outline: 'none', fontFamily: 'inherit' }}>
              <option value="all">All States</option>
              {allStates.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>

            {/* Search */}
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search company…"
              style={{ flex: 1, maxWidth: 210, padding: '7px 12px', borderRadius: 8, border: `1px solid ${D.border}`, background: '#0a0e18', color: D.text, fontSize: 13, outline: 'none', fontFamily: 'inherit' }} />

            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              {lastRefresh && (
                <div style={{ fontSize: 11, color: D.text3, whiteSpace: 'nowrap' }}>
                  {lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              )}
              {loading && <div className="spin" style={{ width: 16, height: 16, border: `2px solid ${D.border}`, borderTopColor: D.teal, borderRadius: '50%' }} />}
            </div>
          </div>

          {hasFilters && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 10, fontSize: 12 }}>
              <span style={{ color: D.text2 }}>Filtered: <strong style={{ color: D.text }}>{invoices.length}</strong> of <strong style={{ color: D.text }}>{allInvoices.length}</strong></span>
              {search && <span style={{ background: 'rgba(20,184,166,0.14)', color: D.tealBrt, padding: '2px 10px', borderRadius: 99, fontWeight: 700, border: `1px solid rgba(20,184,166,0.3)` }}>{search}</span>}
              {stateFilter !== 'all' && <span style={{ background: 'rgba(20,184,166,0.14)', color: D.tealBrt, padding: '2px 10px', borderRadius: 99, fontWeight: 700, border: `1px solid rgba(20,184,166,0.3)` }}>{stateFilter}</span>}
              <button onClick={() => { setSearch(''); setStateFilter('all') }}
                style={{ marginLeft: 4, fontSize: 12, color: D.tealBrt, border: 'none', background: 'none', cursor: 'pointer', fontWeight: 700, fontFamily: 'inherit' }}>Clear</button>
            </div>
          )}
        </header>

        {/* Page content */}
        <div style={{ flex: 1, padding: '32px 32px 80px' }}>

          {error && (
            <div style={{ background: 'rgba(239,68,68,0.1)', border: `1px solid rgba(239,68,68,0.25)`, borderRadius: 12, padding: '14px 18px', marginBottom: 24, color: D.redSoft, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="alert" size={16} stroke={D.redSoft} /> {error}
            </div>
          )}

          {loading && !allInvoices.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '120px 0', gap: 18 }}>
              <div className="spin" style={{ width: 40, height: 40, border: `3px solid ${D.border}`, borderTopColor: D.teal, borderRadius: '50%', boxShadow: `0 0 20px ${D.teal}30` }} />
              <div style={{ fontSize: 15, color: D.text3 }}>Loading from Supabase…</div>
            </div>
          ) : allInvoices.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '120px 0', gap: 14 }}>
              <div style={{ fontSize: 52, opacity: 0.4 }}>🧾</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: D.text }}>No invoices yet</div>
              <div style={{ fontSize: 14, color: D.text2 }}>Create invoices in the app — they'll appear here automatically.</div>
            </div>
          ) : (
            <>
              {/* ── KPIs ── */}
              <div id="overview" style={{ marginBottom: 32, scrollMarginTop: 80 }}>
                <SectionLabel text="Overview" />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14 }}>
                  <KpiCard label="Total Revenue"    rawValue={kpi.total}     format="money" sub="All billed"                                   trend={kpi.totalTrend}  accentColor={D.teal}    iconName="dollar"   fadeClass="fade-up-1" />
                  <KpiCard label="Collected"         rawValue={kpi.collected} format="money" sub={`${kpi.collRate.toFixed(0)}% collection rate`}  trend={kpi.collTrend}  accentColor={D.green}   iconName="check"    fadeClass="fade-up-2" />
                  <KpiCard label="Outstanding"       rawValue={kpi.pending}   format="money" sub={`${kpi.pendingCount} pending invoices`}          trend={null}           accentColor={D.orange}  iconName="clock"    fadeClass="fade-up-3" />
                  <KpiCard label="Total Documents"   rawValue={kpi.count}     format="count" sub="Invoices + memos"                              trend={kpi.countTrend} accentColor={D.indigo}  iconName="file"     fadeClass="fade-up-4" />
                  <KpiCard label="Avg Deal Size"     rawValue={kpi.avg}       format="money" sub="Per invoice"                                   trend={kpi.avgTrend}   accentColor={D.purple}  iconName="trending" fadeClass="fade-up-5" />
                </div>
              </div>

              {/* ── Revenue Trend ── */}
              <div id="revenue" style={{ marginBottom: 20, scrollMarginTop: 80 }}>
                <SectionLabel text="Revenue Trend" />
                <RevenueTrendChart invoices={invoices} />
              </div>

              {/* ── Payments + Collection ── */}
              <div id="payments" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20, scrollMarginTop: 80 }}>
                <PaymentDonut invoices={invoices} />
                <CollectionCard invoices={invoices} />
              </div>

              {/* ── By State + Customers ── */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                <div id="geography" style={{ scrollMarginTop: 80 }}>
                  <StateRevenueChart invoices={invoices} />
                </div>
                <div id="customers" style={{ scrollMarginTop: 80 }}>
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
                  <div style={{ ...dc({ padding: '24px' }), display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{ width: 42, height: 42, borderRadius: 12, background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="check" size={20} stroke={D.green} />
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: D.text }}>All caught up</div>
                      <div style={{ fontSize: 13, color: D.text2, marginTop: 2 }}>No pending receivables in this period.</div>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Shop Ledger ── */}
              <div id="ledger" style={{ scrollMarginTop: 80 }}>
                <SectionLabel text="Shop Ledger" />
                <ShopLedger invoices={invoices} onMarkPaid={markPaid} onDelete={deleteMemo} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
