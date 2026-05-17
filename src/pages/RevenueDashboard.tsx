import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { FileText, TrendingDown, TrendingUp, X, Building2 } from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { SavedInvoice } from '../types/invoice'
import { AccountsReceivable } from '../components/dashboard/AccountsReceivable'
import { printSavedInvoice } from '../lib/invoicePrint'
import { TracingBeam } from '@/components/ui/tracing-beam'
import { BonusesIncentivesCard } from '@/components/ui/animated-dashboard-card'
import JobListingComponent, { type Job } from '@/components/ui/joblisting-component'

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
type IconName = 'home' | 'trending' | 'pie' | 'map' | 'users' | 'bar' | 'alert' | 'list' |
                'refresh' | 'download' | 'dollar' | 'check' | 'clock' | 'file' | 'x' |
                'print' | 'lock' | 'sun' | 'moon' | 'search' | 'chevron'

// ─── Chart + KPI accent colors ────────────────────────────────────────────────

const C = {
  indigo:  '#6366f1',
  emerald: '#10b981',
  amber:   '#f59e0b',
  violet:  '#8b5cf6',
  blue:    '#3b82f6',
  rose:    '#f43f5e',
  cyan:    '#06b6d4',
  lime:    '#84cc16',
}

const KPI_ACCENTS = [C.indigo, C.emerald, C.amber, C.blue, C.violet]
const MIX_COLORS  = [C.indigo, C.emerald, C.amber, C.violet, C.blue, C.rose, C.cyan, C.lime]

// ─── Theme context ────────────────────────────────────────────────────────────

const ThemeCtx = createContext(true)

function useTheme() {
  const [dark, setDark] = useState(() => {
    if (typeof window === 'undefined') return true
    const stored = localStorage.getItem('dash-theme')
    return stored ? stored === 'dark' : true
  })
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('dash-theme', dark ? 'dark' : 'light')
  }, [dark])
  return [dark, () => setDark((d) => !d)] as const
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useCountUp(target: number, duration = 900): number {
  const [val, setVal] = useState(target)
  const rafRef  = useRef<number | null>(null)
  const prevRef = useRef(target)
  useEffect(() => {
    const from = prevRef.current; prevRef.current = target
    if (from === target) return
    const t0 = performance.now()
    const tick = (now: number) => {
      const p = Math.min((now - t0) / duration, 1)
      setVal(from + (target - from) * (1 - Math.pow(1 - p, 3)))
      if (p < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [target, duration])
  return val
}

function useScrollSpy(ids: string[], offset = 130): string {
  const [active, setActive] = useState(ids[0] ?? '')
  useEffect(() => {
    const h = () => {
      const v = ids
        .map((id) => ({ id, top: document.getElementById(id)?.getBoundingClientRect().top ?? Infinity }))
        .filter((x) => x.top <= offset)
      if (v.length) setActive(v[v.length - 1].id)
    }
    window.addEventListener('scroll', h, { passive: true })
    return () => window.removeEventListener('scroll', h)
  }, [ids, offset])
  return active
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cn(...c: (string | false | undefined | null)[]): string {
  return c.filter(Boolean).join(' ')
}

function money(v: number, d = 0) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: d, maximumFractionDigits: d,
  }).format(v)
}

function moneyShort(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (Math.abs(v) >= 1_000)     return `$${(v / 1_000).toFixed(1)}k`
  return `$${v.toFixed(0)}`
}

function fmtMonthShort(ym: string) {
  const [y, m] = ym.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString('en-US', { month: 'short', year: '2-digit' })
}
function fmtMonthLong(ym: string) {
  const [y, m] = ym.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })
}
function daysAgo(d: string) { return Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000) }
function trendPct(c: number, p: number): number | null { return p === 0 ? null : ((c - p) / p) * 100 }

function periodBounds(p: Period): { currStart: Date | null; prevStart: Date; prevEnd: Date } {
  const now = new Date()
  if (p === 'all') return { currStart: null, prevStart: new Date(now.getFullYear() - 1, 0, 1), prevEnd: new Date(now.getFullYear(), 0, 0) }
  const days = { '7d': 7, '30d': 30, '90d': 90, '6m': 182, '1y': 365 }[p]
  const ms = days * 86_400_000
  const currStart = new Date(now.getTime() - ms)
  const prevEnd   = new Date(currStart.getTime() - 1)
  return { currStart, prevStart: new Date(prevEnd.getTime() - ms), prevEnd }
}
function filterByPeriod(invs: SavedInvoice[], p: Period) {
  const { currStart } = periodBounds(p)
  return currStart ? invs.filter((i) => new Date(i.date) >= currStart) : invs
}
function groupByMonth(invs: SavedInvoice[]) {
  const map = new Map<string, SavedInvoice[]>()
  ;[...invs].sort((a, b) => b.date.localeCompare(a.date)).forEach((inv) => {
    const k = inv.date.slice(0, 7)
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(inv)
  })
  return Array.from(map.entries()).map(([k, list]) => ({ month: k, label: fmtMonthLong(k), invoices: list, total: list.reduce((s, i) => s + i.total, 0) }))
}
function exportCSV(invoices: SavedInvoice[]) {
  const h = ['Date','Company','State','City','Type','Paid By','Items','Total','Notes']
  const rows = invoices.map((inv) => [
    inv.date, inv.company, inv.state, inv.city, inv.docKind, inv.paidBy,
    inv.items.map((it) => `${it.size} x${it.pcs} ${it.ct}ct`).join('; '),
    inv.total.toFixed(2), inv.notes,
  ].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
  const blob = new Blob([[h.join(','), ...rows].join('\n')], { type: 'text/csv' })
  Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `delta-${new Date().toISOString().slice(0, 10)}.csv` }).click()
}

// ─── SVG icons ────────────────────────────────────────────────────────────────

function Icon({ name, size = 16, className = '' }: { name: IconName; size?: number; className?: string }) {
  const s = { width: size, height: size, flexShrink: 0 as const }
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'home':    return <svg style={s} className={className} viewBox="0 0 24 24" {...p}><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></svg>
    case 'trending':return <svg style={s} className={className} viewBox="0 0 24 24" {...p}><polyline points="23,6 13.5,15.5 8.5,10.5 1,18"/><polyline points="17,6 23,6 23,12"/></svg>
    case 'pie':     return <svg style={s} className={className} viewBox="0 0 24 24" {...p}><path d="M21.21 15.89A10 10 0 118 2.83"/><path d="M22 12A10 10 0 0012 2v10z"/></svg>
    case 'map':     return <svg style={s} className={className} viewBox="0 0 24 24" {...p}><polygon points="1,6 1,22 8,18 16,22 23,18 23,2 16,6 8,2"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>
    case 'users':   return <svg style={s} className={className} viewBox="0 0 24 24" {...p}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
    case 'bar':     return <svg style={s} className={className} viewBox="0 0 24 24" {...p}><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
    case 'alert':   return <svg style={s} className={className} viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
    case 'list':    return <svg style={s} className={className} viewBox="0 0 24 24" {...p}><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
    case 'refresh': return <svg style={s} className={className} viewBox="0 0 24 24" {...p}><polyline points="23,4 23,10 17,10"/><polyline points="1,20 1,14 7,14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
    case 'download':return <svg style={s} className={className} viewBox="0 0 24 24" {...p}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
    case 'dollar':  return <svg style={s} className={className} viewBox="0 0 24 24" {...p}><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
    case 'check':   return <svg style={s} className={className} viewBox="0 0 24 24" {...p}><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22,4 12,14.01 9,11.01"/></svg>
    case 'clock':   return <svg style={s} className={className} viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>
    case 'file':    return <svg style={s} className={className} viewBox="0 0 24 24" {...p}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
    case 'x':       return <svg style={s} className={className} viewBox="0 0 24 24" {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    case 'print':   return <svg style={s} className={className} viewBox="0 0 24 24" {...p}><polyline points="6,9 6,2 18,2 18,9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
    case 'lock':    return <svg style={s} className={className} viewBox="0 0 24 24" {...p}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
    case 'sun':     return <svg style={s} className={className} viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
    case 'moon':    return <svg style={s} className={className} viewBox="0 0 24 24" {...p}><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
    case 'search':  return <svg style={s} className={className} viewBox="0 0 24 24" {...p}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
    case 'chevron': return <svg style={s} className={className} viewBox="0 0 24 24" {...p}><polyline points="6,9 12,15 18,9"/></svg>
    default: return null
  }
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skel({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-lg bg-slate-200 dark:bg-slate-800', className)} />
}

// ─── Chart tooltip ────────────────────────────────────────────────────────────

function ChartTip({ active, payload, label, fmt }: {
  active?: boolean; payload?: Array<{ name: string; value: number; color: string }>
  label?: string; fmt?: (v: number) => string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl bg-slate-900 dark:bg-slate-950 border border-slate-700 dark:border-slate-800 p-3 shadow-2xl min-w-[140px]">
      {label && <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">{label}</p>}
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-4 mb-1 last:mb-0">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: p.color }} />
            <span className="text-xs text-slate-400">{p.name}</span>
          </div>
          <span className="text-xs font-bold text-white tabular-nums">{fmt ? fmt(p.value) : money(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Password gate ────────────────────────────────────────────────────────────

function PasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [pw, setPw]   = useState('')
  const [err, setErr] = useState('')
  const dark = useContext(ThemeCtx)

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src="/delta-logo.png" alt="Delta Diamonds" className={cn('h-10 mx-auto mb-3', dark ? 'brightness-0 invert opacity-80' : 'opacity-90')} style={{ objectFit: 'contain' }} />
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-600">Revenue Analytics</p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (pw === APP_PASSWORD) { sessionStorage.setItem(AUTH_KEY, pw); onUnlock() }
            else setErr('Incorrect password.')
          }}
          className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl dark:shadow-slate-950 p-8"
        >
          <div className="flex justify-center mb-6">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20">
              <Icon name="lock" size={22} className="text-indigo-600 dark:text-indigo-400" />
            </div>
          </div>

          <h2 className="text-xl font-black text-center text-slate-900 dark:text-white mb-1 tracking-tight">Protected</h2>
          <p className="text-sm text-center text-slate-500 dark:text-slate-400 mb-6">Internal access only</p>

          <div className="relative mb-4">
            <Icon name="lock" size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-600" />
            <input
              type="password" value={pw} onChange={(e) => { setPw(e.target.value); setErr('') }}
              placeholder="Enter password" autoFocus
              className={cn(
                'w-full pl-10 pr-4 py-3 rounded-xl text-sm bg-slate-50 dark:bg-slate-800/60 border text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 outline-none transition-all duration-150',
                'focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/50',
                err ? 'border-red-400 dark:border-red-500/50' : 'border-slate-200 dark:border-slate-700'
              )}
            />
          </div>

          {err && (
            <div className="flex items-center gap-2 text-xs text-red-500 dark:text-red-400 mb-4">
              <Icon name="alert" size={12} className="flex-shrink-0" /> {err}
            </div>
          )}

          <button type="submit"
            className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-[0.98] text-white text-sm font-bold transition-all duration-150 shadow-lg shadow-indigo-500/20">
            Unlock Dashboard
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, rawValue, format, sub, trend, trendInverse, accent, icon, delay }: {
  label: string; rawValue: number; format: 'money' | 'count'; sub?: string
  trend?: number | null; trendInverse?: boolean; accent: string; icon: IconName; delay: number
}) {
  const animated  = useCountUp(rawValue)
  const formatted = format === 'money' ? money(animated) : String(Math.round(animated))
  const isUp      = (trend ?? 0) >= 0
  const isGood    = trendInverse ? !isUp : isUp

  return (
    <div
      className="relative bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-100 dark:border-slate-800 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-200 overflow-hidden animate-card-in"
      style={{ animationDelay: `${delay}ms`, borderTopWidth: 2, borderTopColor: accent }}
    >
      {/* subtle bg glow */}
      <div className="absolute top-0 right-0 w-24 h-24 rounded-full opacity-[0.06] blur-2xl pointer-events-none" style={{ background: accent, transform: 'translate(30%, -30%)' }} />

      <div className="flex items-start justify-between mb-4 relative">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center border" style={{ background: `${accent}18`, borderColor: `${accent}35` }}>
          <span style={{ color: accent }}><Icon name={icon} size={17} /></span>
        </div>
        {trend !== null && trend !== undefined && (
          <span className={cn(
            'inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full ring-1',
            isGood
              ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-emerald-200 dark:ring-emerald-500/20'
              : 'bg-red-50 dark:bg-red-500/10 text-red-500 dark:text-red-400 ring-red-200 dark:ring-red-500/20'
          )}>
            {isUp ? <TrendingUp className="size-3 shrink-0" aria-hidden /> : <TrendingDown className="size-3 shrink-0" aria-hidden />}{' '}
            {Math.abs(trend).toFixed(1)}%
          </span>
        )}
      </div>

      <div className="text-[1.75rem] font-black tracking-tight text-slate-900 dark:text-white tabular-nums mb-1 leading-none">
        {formatted}
      </div>
      <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400 dark:text-slate-600 mb-1">{label}</div>
      {sub && <div className="text-xs text-slate-500 dark:text-slate-500">{sub}</div>}
    </div>
  )
}

// ─── Section divider ──────────────────────────────────────────────────────────

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="h-px flex-1 bg-slate-100 dark:bg-slate-800" />
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-600 select-none">{label}</span>
      <div className="h-px flex-1 bg-slate-100 dark:bg-slate-800" />
    </div>
  )
}

// ─── Card wrapper ─────────────────────────────────────────────────────────────

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 overflow-hidden', className)}>
      {children}
    </div>
  )
}

function CardHead({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between px-6 pt-5 pb-4">
      <div>
        <h3 className="text-sm font-bold text-slate-900 dark:text-white tracking-tight">{title}</h3>
        {sub && <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{sub}</p>}
      </div>
      {right && <div className="flex-shrink-0">{right}</div>}
    </div>
  )
}

function LegendDots({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="flex items-center gap-3">
      {items.map((i) => (
        <div key={i.label} className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: i.color }} />
          <span className="text-xs text-slate-400 dark:text-slate-500">{i.label}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Revenue trend chart ──────────────────────────────────────────────────────

function RevenueTrendChart({ invoices }: { invoices: SavedInvoice[] }) {
  const dark = useContext(ThemeCtx)
  const data = useMemo(() => {
    const map = new Map<string, { t: number; c: number }>()
    invoices.forEach((inv) => {
      const k = inv.date.slice(0, 7)
      const r = map.get(k) ?? { t: 0, c: 0 }
      r.t += inv.total
      if (inv.paidBy !== 'pending' && inv.docKind !== 'memo') r.c += inv.total
      map.set(k, r)
    })
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => ({ month: fmtMonthShort(k), 'Total Billed': Math.round(v.t), Collected: Math.round(v.c) }))
  }, [invoices])

  const grid = dark ? 'rgba(255,255,255,0.04)' : '#f1f5f9'
  const tick = dark ? '#475569' : '#94a3b8'

  return (
    <Card>
      <CardHead title="Revenue Trend" sub="Monthly invoiced vs collected"
        right={<LegendDots items={[{ color: C.indigo, label: 'Billed' }, { color: C.emerald, label: 'Collected' }]} />}
      />
      <div className="px-2 pb-5">
        {data.length ? (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 6 }}>
              <defs>
                <linearGradient id="gI" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.indigo} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={C.indigo} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gE" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.emerald} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={C.emerald} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="4 4" stroke={grid} vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: tick }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={moneyShort} tick={{ fontSize: 10, fill: tick }} axisLine={false} tickLine={false} width={52} />
              <Tooltip content={<ChartTip />} />
              <Area type="monotone" dataKey="Total Billed" stroke={C.indigo}  strokeWidth={2.5} fill="url(#gI)" dot={false} activeDot={{ r: 5, strokeWidth: 0 }} />
              <Area type="monotone" dataKey="Collected"    stroke={C.emerald} strokeWidth={2.5} fill="url(#gE)" dot={false} activeDot={{ r: 5, strokeWidth: 0 }} />
            </AreaChart>
          </ResponsiveContainer>
        ) : <div className="h-40 flex items-center justify-center text-sm text-slate-400">No data for this period</div>}
      </div>
    </Card>
  )
}

// ─── Payment methods donut ────────────────────────────────────────────────────

function PaymentDonut({ invoices }: { invoices: SavedInvoice[] }) {
  const data = useMemo(() => {
    const get = (fn: (i: SavedInvoice) => boolean) => invoices.filter(fn).reduce((s, i) => s + i.total, 0)
    return [
      { name: 'Cash',    value: Math.round(get((i) => i.paidBy === 'cash'  && i.docKind !== 'memo')), color: C.emerald, fill: C.emerald },
      { name: 'Check',   value: Math.round(get((i) => i.paidBy === 'check' && i.docKind !== 'memo')), color: C.blue,    fill: C.blue    },
      { name: 'Pending', value: Math.round(get((i) => i.paidBy === 'pending')),                       color: C.amber,   fill: C.amber   },
      { name: 'Memo',    value: Math.round(get((i) => i.docKind === 'memo')),                         color: C.violet,  fill: C.violet  },
    ].filter((d) => d.value > 0)
  }, [invoices])

  const total = data.reduce((s, d) => s + d.value, 0)

  return (
    <Card>
      <CardHead title="Payment Methods" sub="Revenue by collection type" />
      <div className="px-6 pb-6">
        {data.length ? (
          <div className="flex items-center gap-6">
            <div className="relative flex-shrink-0">
              <PieChart width={160} height={160}>
                <Pie data={data} cx={78} cy={78} innerRadius={50} outerRadius={74} dataKey="value" stroke="none" startAngle={90} endAngle={-270} />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0]
                  return (
                    <div className="rounded-xl bg-slate-900 border border-slate-700 p-3 shadow-2xl">
                      <p className="text-xs text-slate-400 mb-1">{d.name}</p>
                      <p className="text-sm font-bold text-white">{money(Number(d.value))}</p>
                      <p className="text-xs text-slate-500">{total > 0 ? ((Number(d.value) / total) * 100).toFixed(1) : 0}%</p>
                    </div>
                  )
                }} />
              </PieChart>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <p className="text-sm font-black text-slate-900 dark:text-white tabular-nums">{money(total)}</p>
                <p className="text-[10px] text-slate-400">total</p>
              </div>
            </div>
            <div className="flex-1 space-y-1">
              {data.map((d, i) => (
                <div key={d.name} className={cn('flex items-center justify-between py-2.5', i > 0 && 'border-t border-slate-100 dark:border-slate-800')}>
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: d.color }} />
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{d.name}</span>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold tabular-nums" style={{ color: d.color }}>{money(d.value)}</p>
                    <p className="text-[10px] text-slate-400">{total > 0 ? ((d.value / total) * 100).toFixed(1) : 0}%</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : <div className="h-32 flex items-center justify-center text-sm text-slate-400">No data</div>}
      </div>
    </Card>
  )
}

// ─── Collection efficiency ────────────────────────────────────────────────────

function CollectionCard({ invoices }: { invoices: SavedInvoice[] }) {
  const s = useMemo(() => {
    const total     = invoices.reduce((s, i) => s + i.total, 0)
    const collected = invoices.filter((i) => i.paidBy !== 'pending' && i.docKind !== 'memo').reduce((s, i) => s + i.total, 0)
    const pending   = invoices.filter((i) => i.paidBy === 'pending').reduce((s, i) => s + i.total, 0)
    const rate      = total > 0 ? (collected / total) * 100 : 0
    const ages      = invoices.filter((i) => i.paidBy === 'pending').map((i) => daysAgo(i.date))
    const avg       = ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : 0
    const over30    = invoices.filter((i) => i.paidBy === 'pending' && daysAgo(i.date) > 30).length
    return { rate, collected, pending, avg, over30 }
  }, [invoices])

  const circ = 2 * Math.PI * 42
  const dash = (s.rate / 100) * circ
  const col  = s.rate >= 80 ? C.emerald : s.rate >= 60 ? C.amber : C.rose

  return (
    <Card>
      <CardHead title="Collection Efficiency" sub="Payment performance" />
      <div className="px-6 pb-6 flex items-center gap-6">
        <div className="relative flex-shrink-0">
          <svg width={100} height={100} className="-rotate-90">
            <circle cx={50} cy={50} r={42} fill="none" stroke="currentColor" strokeWidth={8} className="text-slate-100 dark:text-slate-800" />
            <circle cx={50} cy={50} r={42} fill="none"
              strokeWidth={8} strokeLinecap="round"
              strokeDasharray={`${dash} ${circ}`}
              style={{ stroke: col, filter: `drop-shadow(0 0 6px ${col}60)`, transition: 'stroke-dasharray 0.8s ease' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <p className="text-lg font-black text-slate-900 dark:text-white">{s.rate.toFixed(0)}%</p>
            <p className="text-[9px] text-slate-400 uppercase tracking-wider">paid</p>
          </div>
        </div>
        <div className="flex-1 space-y-0">
          {[
            { l: 'Collected',     v: money(s.collected),       c: C.emerald },
            { l: 'Outstanding',   v: money(s.pending),         c: C.amber   },
            { l: 'Avg days',      v: `${s.avg.toFixed(0)}d`,   c: s.avg > 30 ? C.rose : 'text' },
            { l: '30d+ overdue',  v: `${s.over30} inv`,        c: s.over30 > 0 ? C.rose : 'text' },
          ].map((row, i) => (
            <div key={row.l} className={cn('flex items-center justify-between py-2', i > 0 && 'border-t border-slate-100 dark:border-slate-800')}>
              <span className="text-xs text-slate-500 dark:text-slate-400">{row.l}</span>
              <span className={cn('text-xs font-bold tabular-nums', row.c === 'text' ? 'text-slate-700 dark:text-slate-300' : undefined)} style={{ color: row.c === 'text' ? undefined : row.c }}>
                {row.v}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}

// ─── Revenue by state ─────────────────────────────────────────────────────────

function StateRevenueChart({ invoices }: { invoices: SavedInvoice[] }) {
  const dark = useContext(ThemeCtx)
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

  const grid = dark ? 'rgba(255,255,255,0.04)' : '#f1f5f9'
  const tick = dark ? '#475569' : '#94a3b8'

  return (
    <Card>
      <CardHead title="Revenue by State" sub="Top 10 states"
        right={<LegendDots items={[{ color: C.indigo, label: 'Total' }, { color: C.amber, label: 'Pending' }]} />}
      />
      <div className="px-2 pb-5">
        {data.length ? (
          <ResponsiveContainer width="100%" height={Math.max(200, data.length * 32)}>
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 16 }} barSize={8} barGap={2}>
              <CartesianGrid strokeDasharray="4 4" stroke={grid} horizontal={false} />
              <XAxis type="number" tickFormatter={moneyShort} tick={{ fontSize: 10, fill: tick }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="state" tick={{ fontSize: 11, fill: tick, fontWeight: 600 }} axisLine={false} tickLine={false} width={26} />
              <Tooltip content={<ChartTip />} />
              <Bar dataKey="Revenue" fill={C.indigo} radius={[0,4,4,0]} name="Total" />
              <Bar dataKey="Pending" fill={C.amber}  radius={[0,4,4,0]} name="Pending" />
            </BarChart>
          </ResponsiveContainer>
        ) : <div className="h-40 flex items-center justify-center text-sm text-slate-400">No data</div>}
      </div>
    </Card>
  )
}

// ─── Top customers ────────────────────────────────────────────────────────────

function TopCustomers({ invoices }: { invoices: SavedInvoice[] }) {
  const list = useMemo(() => {
    const map = new Map<string, { t: number; p: number; n: number }>()
    invoices.forEach((inv) => {
      const k = inv.company || inv.contactName || 'Unknown'
      const r = map.get(k) ?? { t: 0, p: 0, n: 0 }
      r.t += inv.total; r.n++
      if (inv.paidBy !== 'pending' && inv.docKind !== 'memo') r.p += inv.total
      map.set(k, r)
    })
    const sorted = Array.from(map.entries())
      .map(([name, v]) => ({ name, ...v, rate: v.t > 0 ? (v.p / v.t) * 100 : 0 }))
      .sort((a, b) => b.t - a.t).slice(0, 8)
    const max = sorted[0]?.t ?? 1
    return sorted.map((r, i) => ({ ...r, rank: i + 1, pct: (r.t / max) * 100 }))
  }, [invoices])

  const rankStyle = (i: number) =>
    i === 0 ? 'bg-amber-400 text-white' :
    i === 1 ? 'bg-slate-400 text-white' :
    i === 2 ? 'bg-amber-700/80 text-white' :
              'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600'

  return (
    <Card>
      <CardHead title="Top Customers" sub="By total billed value" />
      <div className="px-6 pb-4">
        {list.map((c, i) => (
          <div key={c.name} className={cn('flex items-center gap-3 py-2.5', i > 0 && 'border-t border-slate-50 dark:border-slate-800/60')}>
            <div className={cn('w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-black flex-shrink-0', rankStyle(i))}>
              {c.rank}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[55%]">{c.name}</p>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={cn('text-[11px] font-bold', c.rate < 70 ? 'text-amber-500' : 'text-emerald-500')}>{c.rate.toFixed(0)}%</span>
                  <span className="text-sm font-black tabular-nums text-slate-900 dark:text-white">{money(c.t)}</span>
                </div>
              </div>
              <div className="h-1 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div className="h-full rounded-full transition-all duration-700" style={{ width: `${c.pct}%`, background: `linear-gradient(90deg, ${C.indigo}, ${C.violet})` }} />
              </div>
            </div>
          </div>
        ))}
        {!list.length && <p className="text-sm text-slate-400 py-6 text-center">No data</p>}
      </div>
    </Card>
  )
}

// ─── Product mix ──────────────────────────────────────────────────────────────

function ProductMixChart({ invoices }: { invoices: SavedInvoice[] }) {
  const dark = useContext(ThemeCtx)
  const data = useMemo(() => {
    const map = new Map<string, number>()
    invoices.forEach((inv) => inv.items.forEach((it) => {
      const k = it.size.trim().split(/\s+/)[0] || 'Other'
      map.set(k, (map.get(k) ?? 0) + it.amount)
    }))
    return Array.from(map.entries())
      .map(([name, v], i) => ({ name, Revenue: Math.round(v), fill: MIX_COLORS[i % MIX_COLORS.length] }))
      .sort((a, b) => b.Revenue - a.Revenue).slice(0, 8)
  }, [invoices])

  const tick = dark ? '#475569' : '#94a3b8'

  return (
    <Card>
      <CardHead title="Product Mix" sub="Revenue by size prefix" />
      <div className="px-2 pb-5">
        {data.length ? (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data} margin={{ top: 4, right: 8, bottom: 16, left: 8 }} barSize={28}>
              <CartesianGrid strokeDasharray="4 4" stroke={dark ? 'rgba(255,255,255,0.04)' : '#f1f5f9'} vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: tick, fontWeight: 600 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={moneyShort} tick={{ fontSize: 10, fill: tick }} axisLine={false} tickLine={false} width={48} />
              <Tooltip content={<ChartTip />} />
              <Bar dataKey="Revenue" name="Revenue" radius={[5,5,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : <div className="h-40 flex items-center justify-center text-sm text-slate-400">No data</div>}
      </div>
    </Card>
  )
}

// ─── Invoice activity ─────────────────────────────────────────────────────────

function ActivityChart({ invoices }: { invoices: SavedInvoice[] }) {
  const dark = useContext(ThemeCtx)
  const data = useMemo(() => {
    const map = new Map<string, { i: number; m: number }>()
    invoices.forEach((inv) => {
      const k = inv.date.slice(0, 7)
      const r = map.get(k) ?? { i: 0, m: 0 }
      if (inv.docKind === 'memo') r.m++; else r.i++
      map.set(k, r)
    })
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => ({ month: fmtMonthShort(k), Invoices: v.i, Memos: v.m }))
  }, [invoices])

  const tick = dark ? '#475569' : '#94a3b8'

  return (
    <Card>
      <CardHead title="Document Activity" sub="Monthly count"
        right={<LegendDots items={[{ color: C.indigo, label: 'Invoices' }, { color: C.violet, label: 'Memos' }]} />}
      />
      <div className="px-2 pb-5">
        {data.length ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barSize={12} barGap={3}>
              <CartesianGrid strokeDasharray="4 4" stroke={dark ? 'rgba(255,255,255,0.04)' : '#f1f5f9'} vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: tick }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: tick }} axisLine={false} tickLine={false} width={24} />
              <Tooltip content={<ChartTip fmt={(v) => String(v)} />} />
              <Bar dataKey="Invoices" fill={C.indigo} radius={[4,4,0,0]} />
              <Bar dataKey="Memos"    fill={C.violet} radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : <div className="h-40 flex items-center justify-center text-sm text-slate-400">No data</div>}
      </div>
    </Card>
  )
}

// ─── Pending receivables ──────────────────────────────────────────────────────

function PendingTable({ invoices, onMarkPaid }: {
  invoices: SavedInvoice[]
  onMarkPaid: (id: string, by: 'cash' | 'check') => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  const rows = useMemo(() =>
    invoices.filter((i) => i.paidBy === 'pending')
      .map((i) => ({ ...i, days: daysAgo(i.date) }))
      .sort((a, b) => b.days - a.days),
    [invoices]
  )

  if (!rows.length) return null

  const urg = (d: number) => d > 30 ? 'text-red-500 bg-red-50 dark:bg-red-500/10 ring-red-200 dark:ring-red-500/20' :
                             d > 14 ? 'text-amber-600 bg-amber-50 dark:bg-amber-500/10 ring-amber-200 dark:ring-amber-500/20' :
                                      'text-yellow-600 bg-yellow-50 dark:bg-yellow-500/10 ring-yellow-200 dark:ring-yellow-500/20'
  const total = rows.reduce((s, r) => s + r.total, 0)

  return (
    <Card>
      <div className="flex items-center justify-between px-6 py-4 bg-amber-50 dark:bg-amber-500/5 border-b border-amber-100 dark:border-amber-500/10">
        <div className="flex items-center gap-2.5">
          <Icon name="alert" size={16} className="text-amber-500" />
          <div>
            <p className="text-sm font-bold text-slate-900 dark:text-white">Pending Receivables</p>
            <p className="text-xs text-slate-500">{rows.length} outstanding</p>
          </div>
        </div>
        <span className="text-xl font-black text-amber-500 tabular-nums">{money(total)}</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800/50">
              {['Company', 'State', 'Date', 'Age', 'Amount', ''].map((h, i) => (
                <th key={h} className={cn('px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-600 border-b border-slate-100 dark:border-slate-800 whitespace-nowrap', i >= 3 ? 'text-right' : 'text-left')}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-50 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors duration-100">
                <td className="px-5 py-3.5 font-semibold text-slate-800 dark:text-slate-200 max-w-[180px] truncate">{r.company || r.contactName}</td>
                <td className="px-5 py-3.5 text-slate-500 dark:text-slate-400">{r.state || '—'}</td>
                <td className="px-5 py-3.5 text-slate-500 dark:text-slate-400 tabular-nums">{r.date}</td>
                <td className="px-5 py-3.5 text-right">
                  <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full ring-1', urg(r.days))}>{r.days}d</span>
                </td>
                <td className="px-5 py-3.5 text-right font-black text-amber-500 tabular-nums">{money(r.total)}</td>
                <td className="px-5 py-3.5 text-right">
                  {open !== r.id ? (
                    <button onClick={() => setOpen(r.id)}
                      className="text-[11px] font-bold px-3 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-colors duration-150 whitespace-nowrap">
                      Mark Paid
                    </button>
                  ) : (
                    <div className="flex items-center justify-end gap-1.5">
                      <button onClick={() => { onMarkPaid(r.id, 'cash');  setOpen(null) }} className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white transition-colors duration-150">Cash</button>
                      <button onClick={() => { onMarkPaid(r.id, 'check'); setOpen(null) }} className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-400 text-white transition-colors duration-150">Check</button>
                      <button type="button" onClick={() => setOpen(null)} className="text-[11px] font-bold px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors duration-150 inline-flex items-center justify-center">
                        <X className="size-3.5" aria-hidden />
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ─── Invoice detail row ───────────────────────────────────────────────────────

function InvoiceRow({ inv, onMarkPaid, onDelete }: {
  inv: SavedInvoice; onMarkPaid?: (id: string, b: 'cash' | 'check') => void; onDelete?: (id: string) => void
}) {
  const [show, setShow] = useState(false)
  const isMemo    = inv.docKind === 'memo'
  const isPending = inv.paidBy === 'pending' && !isMemo
  const col = isMemo ? C.violet : isPending ? C.amber : inv.paidBy === 'cash' ? C.emerald : C.blue
  const lbl = isMemo ? 'MEMO' : isPending ? 'PENDING' : inv.paidBy === 'cash' ? 'CASH' : 'CHECK'

  return (
    <div className={cn('rounded-xl border p-3.5 mb-2 last:mb-0', isMemo ? 'bg-violet-50 dark:bg-violet-500/5 border-violet-100 dark:border-violet-500/15' : isPending ? 'bg-amber-50 dark:bg-amber-500/5 border-amber-100 dark:border-amber-500/15' : 'bg-slate-50 dark:bg-slate-800/40 border-slate-100 dark:border-slate-800')}>
      <div className="flex items-start justify-between flex-wrap gap-2 mb-2">
        <div>
          <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{inv.date}</p>
          <p className="text-xs text-slate-400 mt-0.5">{inv.docKind.toUpperCase()} · <span className="font-bold" style={{ color: col }}>{lbl}</span></p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-black tabular-nums" style={{ color: col }}>{money(inv.total, 2)}</span>
          <button onClick={() => printSavedInvoice(inv)} className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors duration-150">
            <Icon name="print" size={11} /> Print
          </button>
          {isPending && onMarkPaid && !show && (
            <button onClick={() => setShow(true)} className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-colors duration-150">Mark Paid</button>
          )}
          {isPending && onMarkPaid && show && (
            <>
              <button onClick={() => { onMarkPaid(inv.id, 'cash');  setShow(false) }} className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-emerald-500 text-white hover:bg-emerald-400 transition-colors">Cash</button>
              <button onClick={() => { onMarkPaid(inv.id, 'check'); setShow(false) }} className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-blue-500 text-white hover:bg-blue-400 transition-colors">Check</button>
              <button type="button" onClick={() => setShow(false)} className="text-[11px] font-bold px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors inline-flex items-center justify-center">
                <X className="size-3.5" aria-hidden />
              </button>
            </>
          )}
          {isMemo && onDelete && (
            <button onClick={() => { if (window.confirm('Delete this memo?')) onDelete(inv.id) }} className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-red-200 dark:border-red-500/25 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors duration-150">Delete</button>
          )}
        </div>
      </div>
      {inv.items.length > 0 && (
        <table className="w-full text-xs mt-2">
          <thead><tr className="text-slate-400 dark:text-slate-600">
            {['Size','Pcs','Ct','P/Ct','Amount'].map((h, i) => (
              <th key={h} className={cn('py-1.5 font-bold border-b border-slate-200 dark:border-slate-700', i === 0 ? 'text-left' : 'text-right')}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {inv.items.map((it, i) => (
              <tr key={i} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                <td className="py-1.5 font-semibold text-slate-700 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800">{it.size}</td>
                <td className="py-1.5 text-right text-slate-500 border-b border-slate-100 dark:border-slate-800">{it.pcs}</td>
                <td className="py-1.5 text-right text-slate-500 border-b border-slate-100 dark:border-slate-800">{it.ct.toFixed(2)}</td>
                <td className="py-1.5 text-right text-slate-500 border-b border-slate-100 dark:border-slate-800 tabular-nums">{money(it.pct, 2)}</td>
                <td className="py-1.5 text-right font-bold text-slate-800 dark:text-slate-200 border-b border-slate-100 dark:border-slate-800 tabular-nums">{money(it.amount, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {inv.notes && <p className="text-xs text-slate-500 mt-2 italic">{inv.notes}</p>}
    </div>
  )
}

// ─── Shop ledger ──────────────────────────────────────────────────────────────

type ShopRow = { key: string; company: string; state: string; city: string; n: number; sold: number; paid: number; pending: number; last: string; invoices: SavedInvoice[] }

function ShopLedger({ invoices, onMarkPaid, onDelete }: {
  invoices: SavedInvoice[]
  onMarkPaid: (id: string, b: 'cash' | 'check') => void
  onDelete: (id: string) => void
}) {
  const [exp, setExp]   = useState<Set<string>>(new Set())
  const [q,   setQ]     = useState('')

  const shops = useMemo<ShopRow[]>(() => {
    const map = new Map<string, ShopRow>()
    invoices.forEach((inv) => {
      const key = inv.contactId || inv.company
      const r = map.get(key) ?? { key, company: inv.company || inv.contactName || 'Unknown', state: inv.state, city: inv.city, n: 0, sold: 0, paid: 0, pending: 0, last: inv.date, invoices: [] }
      r.n++; r.sold += inv.total
      if (inv.paidBy === 'pending') r.pending += inv.total; else r.paid += inv.total
      if (inv.date > r.last) r.last = inv.date
      r.invoices.push(inv); map.set(key, r)
    })
    return Array.from(map.values()).sort((a, b) => b.sold - a.sold)
  }, [invoices])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? shops.filter((sh) => sh.company.toLowerCase().includes(s)) : shops
  }, [shops, q])

  const toggle = (key: string) => setExp((p) => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n })

  return (
    <Card>
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
        <div>
          <p className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2"><Icon name="list" size={15} className="text-indigo-500" /> Shop Ledger</p>
          <p className="text-xs text-slate-400 mt-0.5">{filtered.length} shops</p>
        </div>
        <div className="relative">
          <Icon name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
            className="pl-8 pr-3 py-1.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 outline-none focus:ring-2 focus:ring-indigo-500/30 transition-all duration-150 w-48" />
        </div>
      </div>

      <div className="grid grid-cols-[2.5fr_1fr_1fr_1fr_0.8fr_40px] gap-0 px-6 py-2.5 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800">
        {['Shop', 'Sold', 'Paid', 'Pending', 'Last Sale', ''].map((h) => (
          <span key={h} className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-600">{h}</span>
        ))}
      </div>

      {filtered.map((sh) => (
        <div key={sh.key}>
          <div onClick={() => toggle(sh.key)}
            className={cn('grid grid-cols-[2.5fr_1fr_1fr_1fr_0.8fr_40px] px-6 py-3.5 border-b border-slate-50 dark:border-slate-800/60 cursor-pointer transition-colors duration-150', exp.has(sh.key) ? 'bg-indigo-50/50 dark:bg-indigo-500/5' : 'hover:bg-slate-50 dark:hover:bg-slate-800/30')}>
            <div>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{sh.company}</p>
              <p className="text-xs text-slate-400 mt-0.5">{[sh.city, sh.state].filter(Boolean).join(', ')} · {sh.n} inv</p>
            </div>
            <p className="text-sm font-bold tabular-nums self-center" style={{ color: C.indigo }}>{money(sh.sold)}</p>
            <p className="text-sm font-semibold tabular-nums self-center text-emerald-500">{money(sh.paid)}</p>
            <p className={cn('text-sm tabular-nums self-center', sh.pending > 0 ? 'font-bold text-amber-500' : 'text-slate-300 dark:text-slate-700')}>{sh.pending > 0 ? money(sh.pending) : '—'}</p>
            <p className="text-xs text-slate-400 self-center tabular-nums">{sh.last}</p>
            <Icon name="chevron" size={16} className={cn('self-center text-slate-400 dark:text-slate-600 transition-transform duration-200', exp.has(sh.key) ? 'rotate-180' : '')} />
          </div>
          {exp.has(sh.key) && (
            <div className="px-6 py-4 bg-indigo-50/30 dark:bg-indigo-500/[0.03] border-b border-slate-100 dark:border-slate-800 animate-fade-in">
              {groupByMonth(sh.invoices).map(({ month, label, invoices: mi, total }) => (
                <div key={month} className="mb-5 last:mb-0">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-600">{label}</span>
                    <span className="text-xs font-bold tabular-nums" style={{ color: C.indigo }}>{money(total)} · {mi.length} inv</span>
                  </div>
                  {mi.map((inv) => <InvoiceRow key={inv.id} inv={inv} onMarkPaid={onMarkPaid} onDelete={onDelete} />)}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      {!filtered.length && <p className="text-sm text-slate-400 text-center py-12">No shops found.</p>}
    </Card>
  )
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

const SECTIONS = ['overview', 'accounts', 'revenue', 'payments', 'geography', 'customers', 'products', 'reminders', 'receivables', 'ledger'] as const
type SectionId = typeof SECTIONS[number]

const NAV: { id: SectionId; label: string; icon: IconName }[] = [
  { id: 'overview',    label: 'Overview',      icon: 'home'     },
  { id: 'accounts',    label: 'Accounts',      icon: 'dollar'   },
  { id: 'revenue',     label: 'Revenue',       icon: 'trending' },
  { id: 'payments',    label: 'Payments',      icon: 'pie'      },
  { id: 'geography',   label: 'By State',      icon: 'map'      },
  { id: 'customers',   label: 'Customers',     icon: 'users'    },
  { id: 'products',    label: 'Products',      icon: 'bar'      },
  { id: 'reminders',   label: 'Reminders',     icon: 'clock'    },
  { id: 'receivables', label: 'Receivables',   icon: 'alert'    },
  { id: 'ledger',      label: 'Shop Ledger',   icon: 'list'     },
]

function Sidebar({ active, badge, accountsBadge, onNav, onRefresh, onExport, loading }: {
  active: string; badge: number; accountsBadge: number
  onNav: (id: SectionId) => void; onRefresh: () => void; onExport: () => void; loading: boolean
}) {
  return (
    <aside className="fixed inset-y-0 left-0 w-[240px] bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col z-50 overflow-y-auto">
      {/* Logo */}
      <div className="px-5 py-6 border-b border-slate-100 dark:border-slate-800">
        <img src="/delta-logo.png" alt="Delta Diamonds" className="h-7 object-contain dark:brightness-0 dark:invert dark:opacity-80" />
        <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-600 mt-2">Revenue Analytics</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV.map((item) => {
          const isActive = active === item.id
          return (
            <button key={item.id} onClick={() => onNav(item.id)}
              className={cn(
                'flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm transition-all duration-150 group relative',
                isActive
                  ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-semibold'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200'
              )}>
              {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full bg-indigo-500 dark:bg-indigo-400" />}
              <Icon name={item.icon} size={16} className="flex-shrink-0 transition-colors duration-150" />
              <span className="flex-1 text-left">{item.label}</span>
              {item.id === 'receivables' && badge > 0 && (
                <span className="text-[10px] font-black bg-red-500 text-white rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-tight shadow-sm shadow-red-500/30">
                  {badge}
                </span>
              )}
              {item.id === 'accounts' && accountsBadge > 0 && (
                <span className="text-[10px] font-black bg-amber-500 text-white rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-tight shadow-sm shadow-amber-500/30">
                  {accountsBadge}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      {/* Bottom actions */}
      <div className="px-3 py-4 border-t border-slate-100 dark:border-slate-800 space-y-0.5">
        <button onClick={onRefresh} disabled={loading}
          className={cn('flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm transition-all duration-150', loading ? 'text-slate-300 dark:text-slate-700 cursor-default' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-300')}>
          <Icon name="refresh" size={16} className={cn('flex-shrink-0', loading && 'animate-spin')} />
          {loading ? 'Refreshing…' : 'Refresh Data'}
        </button>
        <button onClick={onExport}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-300 transition-all duration-150">
          <Icon name="download" size={16} className="flex-shrink-0" />
          Export CSV
        </button>
      </div>
    </aside>
  )
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

export function RevenueDashboard() {
  const [dark, toggleDark] = useTheme()
  const [unlocked, setUnlocked] = useState(!APP_PASSWORD || sessionStorage.getItem(AUTH_KEY) === APP_PASSWORD)
  const [allInvoices, setAll] = useState<SavedInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [lastRefresh, setLR]  = useState<Date | null>(null)

  const [period,  setPeriod]  = useState<Period>('all')
  const [state,   setState]   = useState('all')
  const [search,  setSearch]  = useState('')
  const [accountsOutstanding, setAccountsOutstanding] = useState(0)

  const active = useScrollSpy([...SECTIONS])

  const load = async () => {
    setLoading(true); setError('')
    try { const d = await fetchInvoices(); setAll(d); setLR(new Date()) }
    catch (e) { setError((e as Error).message) }
    finally { setLoading(false) }
  }

  useEffect(() => { if (unlocked) void load() }, [unlocked])

  const markPaid = async (id: string, paidBy: 'cash' | 'check') => {
    setAll((p) => p.map((i) => i.id === id ? { ...i, paidBy } : i))
    await createClient(SUPABASE_URL, SUPABASE_KEY).from('invoices').update({ paid_by: paidBy }).eq('id', id)
  }

  const deleteMemo = async (id: string) => {
    setAll((p) => p.filter((i) => i.id !== id))
    await createClient(SUPABASE_URL, SUPABASE_KEY).from('invoices').delete().eq('id', id)
  }

  const navTo = (id: SectionId) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const allStates = useMemo(() => Array.from(new Set(allInvoices.map((i) => i.state).filter(Boolean))).sort(), [allInvoices])

  const invoices = useMemo(() => {
    let d = filterByPeriod(allInvoices, period)
    if (state !== 'all') d = d.filter((i) => i.state === state)
    const q = search.trim().toLowerCase()
    if (q) d = d.filter((i) => i.company.toLowerCase().includes(q) || i.contactName.toLowerCase().includes(q))
    return d
  }, [allInvoices, period, state, search])

  const reminderJobs = useMemo((): Job[] => {
    return invoices
      .filter((i) => i.paidBy === 'pending')
      .slice(0, 12)
      .map((inv) => ({
        id: inv.id,
        company: inv.company || inv.contactName || 'Shop',
        title: 'Outstanding balance',
        salary: money(inv.total),
        location: [inv.city, inv.state].filter(Boolean).join(', ') || '—',
        remote: 'No',
        job_time: `Invoice ${inv.date}`,
        job_description: ['Open invoice — follow up for payment.', inv.notes && `Notes: ${inv.notes}`]
          .filter(Boolean)
          .join(' '),
        logo: (
          <Building2
            className="size-9 shrink-0 rounded-lg border border-slate-200 bg-slate-50 p-1.5 text-amber-600 dark:border-slate-700 dark:bg-slate-800 dark:text-amber-400"
            aria-hidden
          />
        ),
      }))
  }, [invoices])

  const kpi = useMemo(() => {
    const { currStart, prevStart, prevEnd } = periodBounds(period)
    const prev = allInvoices.filter((i) => { const d = new Date(i.date); return d >= prevStart && d <= prevEnd })
    const total    = invoices.reduce((s, i) => s + i.total, 0)
    const pTotal   = prev.reduce((s, i) => s + i.total, 0)
    const coll     = invoices.filter((i) => i.paidBy !== 'pending' && i.docKind !== 'memo').reduce((s, i) => s + i.total, 0)
    const pColl    = prev.filter((i) => i.paidBy !== 'pending' && i.docKind !== 'memo').reduce((s, i) => s + i.total, 0)
    const pending  = invoices.filter((i) => i.paidBy === 'pending').reduce((s, i) => s + i.total, 0)
    const n        = invoices.length
    const pN       = prev.length
    const avg      = n > 0 ? total / n : 0
    const pAvg     = pN > 0 ? pTotal / pN : 0
    void currStart
    return {
      total, coll, pending, n, avg,
      collRate:     total > 0 ? (coll / total) * 100 : 0,
      pendingCount: invoices.filter((i) => i.paidBy === 'pending').length,
      totalT:  trendPct(total, pTotal),
      collT:   trendPct(coll, pColl),
      countT:  trendPct(n, pN),
      avgT:    trendPct(avg, pAvg),
    }
  }, [invoices, allInvoices, period])

  if (!unlocked) return (
    <ThemeCtx.Provider value={dark}>
      <PasswordGate onUnlock={() => setUnlocked(true)} />
    </ThemeCtx.Provider>
  )

  const PERIODS: [Period, string][] = [['7d','7D'],['30d','30D'],['90d','90D'],['6m','6M'],['1y','1Y'],['all','All']]
  const hasFilter = search || state !== 'all'
  const activeLabel = NAV.find((n) => n.id === active)?.label ?? 'Dashboard'

  return (
    <ThemeCtx.Provider value={dark}>
      <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950 font-sans text-slate-900 dark:text-slate-50">

        {/* ── Sidebar ── */}
        <Sidebar active={active} badge={kpi.pendingCount} accountsBadge={accountsOutstanding}
          onNav={navTo} onRefresh={load} onExport={() => exportCSV(invoices)} loading={loading} />

        {/* ── Main ── */}
        <div className="ml-[240px] flex-1 min-w-0 flex flex-col">

          {/* Sticky top bar */}
          <header className="sticky top-0 z-40 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-slate-200/80 dark:border-slate-800/80 px-8">
            <div className="flex items-center h-14 gap-3">
              <h1 className="text-sm font-bold text-slate-900 dark:text-white min-w-[120px]">{activeLabel}</h1>
              <div className="w-px h-4 bg-slate-200 dark:bg-slate-700" />

              {/* Period tabs */}
              <div className="flex items-center gap-0.5 bg-slate-100 dark:bg-slate-800 rounded-xl p-1">
                {PERIODS.map(([p, label]) => (
                  <button key={p} onClick={() => setPeriod(p)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-150',
                      period === p
                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                    )}>
                    {label}
                  </button>
                ))}
              </div>

              {/* State filter */}
              <select value={state} onChange={(e) => setState(e.target.value)}
                className="px-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 outline-none focus:ring-2 focus:ring-indigo-500/30 transition-all duration-150">
                <option value="all">All States</option>
                {allStates.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>

              {/* Search */}
              <div className="relative flex-1 max-w-[200px]">
                <Icon name="search" size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…"
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 outline-none focus:ring-2 focus:ring-indigo-500/30 transition-all duration-150" />
              </div>

              <div className="ml-auto flex items-center gap-2">
                {lastRefresh && <p className="text-[11px] text-slate-400 dark:text-slate-600 tabular-nums">{lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>}
                {loading && <div className="w-4 h-4 rounded-full border-2 border-slate-200 dark:border-slate-700 border-t-indigo-500 animate-spin" />}
                <button onClick={toggleDark}
                  className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors duration-150 text-slate-500 dark:text-slate-400">
                  <Icon name={dark ? 'sun' : 'moon'} size={16} />
                </button>
              </div>
            </div>

            {/* Filter pills */}
            {hasFilter && (
              <div className="flex items-center gap-2 pb-2.5 text-xs">
                <span className="text-slate-500"><strong className="text-slate-800 dark:text-slate-200">{invoices.length}</strong> of <strong className="text-slate-800 dark:text-slate-200">{allInvoices.length}</strong></span>
                {search && <span className="px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-semibold ring-1 ring-indigo-200 dark:ring-indigo-500/20">{search}</span>}
                {state !== 'all' && <span className="px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-semibold ring-1 ring-indigo-200 dark:ring-indigo-500/20">{state}</span>}
                <button onClick={() => { setSearch(''); setState('all') }} className="text-indigo-600 dark:text-indigo-400 font-semibold hover:underline ml-1">Clear</button>
              </div>
            )}
          </header>

          {/* Content */}
          <main className="flex-1 px-8 py-8 space-y-8">
            <TracingBeam className="space-y-8">
            {error && (
              <div className="flex items-center gap-2.5 p-4 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-sm">
                <Icon name="alert" size={16} className="flex-shrink-0" /> {error}
              </div>
            )}

            <section id="accounts" className="scroll-mt-20">
              <SectionDivider label="Charge Accounts" />
              <AccountsReceivable onOutstandingCount={setAccountsOutstanding} />
            </section>

            {loading && !allInvoices.length ? (
              /* Loading skeleton */
              <div className="space-y-8">
                <div>
                  <SectionDivider label="Overview" />
                  <div className="grid grid-cols-5 gap-4">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-100 dark:border-slate-800">
                        <Skel className="w-9 h-9 mb-4 rounded-xl" />
                        <Skel className="w-28 h-7 mb-2" />
                        <Skel className="w-16 h-2.5 mb-2" />
                        <Skel className="w-20 h-3" />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 h-72">
                  <div className="p-6"><Skel className="w-36 h-4 mb-2" /><Skel className="w-48 h-3" /></div>
                  <div className="px-6"><Skel className="w-full h-44" /></div>
                </div>
              </div>
            ) : allInvoices.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-32 gap-4">
                <FileText className="w-14 h-14 opacity-30 text-slate-400" strokeWidth={1.25} aria-hidden />
                <h2 className="text-xl font-bold text-slate-800 dark:text-slate-200">No invoices yet</h2>
                <p className="text-sm text-slate-400">Create invoices in the app — they'll appear here automatically.</p>
              </div>
            ) : (
              <>
                {/* KPIs */}
                <section id="overview" className="scroll-mt-20">
                  <SectionDivider label="Overview" />
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-stretch">
                    <BonusesIncentivesCard
                      className="mx-auto w-full max-w-md shrink-0 xl:mx-0"
                      bonusText="Collected"
                      incentivesText="Outstanding"
                      bonusesValue={kpi.coll}
                      incentivesValue={kpi.pending}
                      backgroundColor="bg-slate-50/80 dark:bg-slate-950/60"
                      borderColor="border-slate-200/80 dark:border-slate-800"
                      onMoreDetails={() => navTo('receivables')}
                    />
                    <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      <KpiCard label="Total Revenue"   rawValue={kpi.total}   format="money" sub="All billed"                                    trend={kpi.totalT} accent={KPI_ACCENTS[0]} icon="dollar"   delay={0}   />
                      <KpiCard label="Collected"        rawValue={kpi.coll}    format="money" sub={`${kpi.collRate.toFixed(0)}% collection rate`}  trend={kpi.collT}  accent={KPI_ACCENTS[1]} icon="check"    delay={60}  />
                      <KpiCard label="Outstanding"      rawValue={kpi.pending} format="money" sub={`${kpi.pendingCount} invoices`}                 trend={null}       accent={KPI_ACCENTS[2]} icon="clock"    delay={120} />
                      <KpiCard label="Total Documents"  rawValue={kpi.n}       format="count" sub="Invoices + memos"                              trend={kpi.countT} accent={KPI_ACCENTS[3]} icon="file"     delay={180} />
                      <KpiCard label="Avg Deal Size"    rawValue={kpi.avg}     format="money" sub="Per invoice"                                   trend={kpi.avgT}   accent={KPI_ACCENTS[4]} icon="trending" delay={240} />
                    </div>
                  </div>
                </section>

                {/* Revenue trend */}
                <section id="revenue" className="scroll-mt-20">
                  <SectionDivider label="Revenue Trend" />
                  <RevenueTrendChart invoices={invoices} />
                </section>

                {/* Payments + Collection */}
                <section id="payments" className="scroll-mt-20">
                  <SectionDivider label="Payments" />
                  <div className="grid grid-cols-2 gap-5">
                    <PaymentDonut   invoices={invoices} />
                    <CollectionCard invoices={invoices} />
                  </div>
                </section>

                {/* Geography + Customers */}
                <div className="grid grid-cols-2 gap-5">
                  <section id="geography" className="scroll-mt-20"><StateRevenueChart invoices={invoices} /></section>
                  <section id="customers" className="scroll-mt-20"><TopCustomers      invoices={invoices} /></section>
                </div>

                {/* Products + Activity */}
                <section id="products" className="scroll-mt-20">
                  <SectionDivider label="Products" />
                  <div className="grid grid-cols-2 gap-5">
                    <ProductMixChart invoices={invoices} />
                    <ActivityChart   invoices={invoices} />
                  </div>
                </section>

                {reminderJobs.length > 0 && (
                  <section id="reminders" className="scroll-mt-20">
                    <SectionDivider label="Reminders" />
                    <div className="relative min-h-[100px] overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                      <JobListingComponent jobs={reminderJobs} className="p-4 md:p-6" />
                    </div>
                  </section>
                )}

                {/* Receivables */}
                <section id="receivables" className="scroll-mt-20">
                  <SectionDivider label="Receivables" />
                  {invoices.some((i) => i.paidBy === 'pending') ? (
                    <PendingTable invoices={invoices} onMarkPaid={markPaid} />
                  ) : (
                    <Card>
                      <div className="flex items-center gap-3 p-6">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 flex-shrink-0">
                          <Icon name="check" size={18} className="text-emerald-500" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-900 dark:text-white">All caught up</p>
                          <p className="text-xs text-slate-400 mt-0.5">No pending receivables in this period.</p>
                        </div>
                      </div>
                    </Card>
                  )}
                </section>

                {/* Shop ledger */}
                <section id="ledger" className="scroll-mt-20 pb-20">
                  <SectionDivider label="Shop Ledger" />
                  <ShopLedger invoices={invoices} onMarkPaid={markPaid} onDelete={deleteMemo} />
                </section>
              </>
            )}
            </TracingBeam>
          </main>
        </div>
      </div>
    </ThemeCtx.Provider>
  )
}
