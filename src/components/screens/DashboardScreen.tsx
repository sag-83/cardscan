import { useMemo } from 'react'
import { useStore } from '../../store/useStore'

type GroupStats = {
  key: string
  total: number
  customers: number
  conversion: number
}

function pct(value: number): string {
  return `${value.toFixed(1)}%`
}

export function DashboardScreen() {
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
      .map(([key, val]) => ({
        key,
        total: val.total,
        customers: val.customers,
        conversion: val.total ? (val.customers / val.total) * 100 : 0,
      }))
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
      .map(([key, val]) => ({
        key,
        total: val.total,
        customers: val.customers,
        conversion: val.total ? (val.customers / val.total) * 100 : 0,
      }))
      .sort((a, b) => b.conversion - a.conversion || b.total - a.total)
  }, [contacts])

  return (
    <div style={{ padding: '16px 16px 24px' }}>
      <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>Stats Dashboard</div>
      <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 14 }}>
        Territory performance snapshot
      </div>

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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 12, padding: 12 }}>
      <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 700, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 21, fontWeight: 800, marginTop: 4 }}>{value}</div>
    </div>
  )
}

function Section({ title }: { title: string }) {
  return (
    <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 700, marginTop: 16, marginBottom: 6, textTransform: 'uppercase' }}>
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
        <div
          key={row.key}
          style={{
            display: 'grid',
            gridTemplateColumns: '1.2fr 0.7fr 0.7fr 0.9fr',
            gap: 8,
            padding: '10px 12px',
            borderTop: index ? '1px solid var(--border2)' : 'none',
            alignItems: 'center',
            fontSize: 13,
          }}
        >
          <div style={{ fontWeight: 700 }}>{row.key}</div>
          <div style={{ color: 'var(--text2)' }}>{row.total}</div>
          <div style={{ color: 'var(--text2)' }}>{row.customers}</div>
          <div style={{ fontWeight: 700, color: 'var(--accent)', textAlign: 'right' }}>{pct(row.conversion)}</div>
        </div>
      ))}
    </div>
  )
}
