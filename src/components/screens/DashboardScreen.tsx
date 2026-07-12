import { useMemo, useState } from 'react'
import {
  Check,
  ClipboardList,
  Eye,
  EyeOff,
  FileText,
  Globe,
  ScanFace,
  X,
} from 'lucide-react'
import { useSensitiveFigures } from '../../hooks/useSensitiveFigures'
import { isRevenueSessionUnlocked, lockRevenueSession } from '../../lib/revenueLock'
import { RevenueUnlockGate } from '../RevenueUnlockGate'
import { useStore } from '../../store/useStore'
import { SavedInvoice, SavedInvoiceItem } from '../../types/invoice'
import { deleteInvoiceSynced, saveInvoiceSynced } from '../../lib/invoiceSync'
import { isInvoiceInCalendarMonth } from '../../lib/invoiceStats'
import { uid } from '../../lib/utils'
import { normalizeStateValue } from '../../lib/usStates'

function openWebAnalyticsDashboard() {
  const base = window.location.origin.replace(/\/$/, '')
  window.open(`${base}/dashboard`, '_blank', 'noopener,noreferrer')
}

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

function sumItems(items: SavedInvoiceItem[]): number {
  return items.reduce((s, it) => s + it.amount, 0)
}

function itemLabel(it: SavedInvoiceItem): string {
  const parts = [it.size, it.pcs ? `${it.pcs} pcs` : '', it.ct ? `${it.ct} ct` : ''].filter(Boolean)
  return parts.join(' · ') || 'Line item'
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
      const state = normalizeStateValue(c.state)
      if (!state) return
      const item = map.get(state) ?? { total: 0, customers: 0 }
      item.total += 1
      if (c.is_customer) item.customers += 1
      map.set(state, item)
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

function RevenueTab({
  figuresVisible,
  maskFigure,
  onToggleFigures,
}: {
  figuresVisible: boolean
  maskFigure: (value: string) => string
  onToggleFigures: () => void
}) {
  const invoices = useStore((s) => s.invoices)
  const addInvoice = useStore((s) => s.addInvoice)
  const updateInvoice = useStore((s) => s.updateInvoice)
  const deleteInvoice = useStore((s) => s.deleteInvoice)
  const showToast = useStore((s) => s.showToast)
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

  const handleMarkPaid = async (id: string, paidBy: 'cash' | 'check') => {
    const inv = invoices.find((i) => i.id === id)
    if (!inv) return
    const updated: SavedInvoice = { ...inv, paidBy, saved_at: new Date().toISOString() }
    updateInvoice(id, { paidBy, saved_at: updated.saved_at })
    const ok = await saveInvoiceSynced(updated)
    if (ok) showToast(`Marked as paid (${paidBy})`)
    else showToast('Saved locally — Supabase update failed')
  }

  const handleClearMemo = async (id: string) => {
    const ok = await deleteInvoiceSynced(id, deleteInvoice)
    if (ok) showToast('Memo cleared')
    else showToast('Could not delete from cloud — try again in Settings')
  }

  const handleConvertMemo = async (inv: SavedInvoice, selectedIndices: number[], soldDate: string) => {
    if (!selectedIndices.length) {
      showToast('Select at least one item')
      return
    }
    const selected = selectedIndices.map((i) => inv.items[i])
    const newTotal = sumItems(selected)
    const saleDate = soldDate || new Date().toISOString().slice(0, 10)
    const newInv: SavedInvoice = {
      ...inv,
      id: uid(),
      docKind: 'invoice',
      paidBy: 'pending',
      items: selected,
      total: newTotal,
      date: saleDate,
      saved_at: new Date().toISOString(),
    }
    const saved = await saveInvoiceSynced(newInv)
    if (!saved) {
      showToast('Could not save new invoice to cloud')
      return
    }
    addInvoice(newInv)
    await deleteInvoiceSynced(inv.id, deleteInvoice)
    const discarded = inv.items.length - selected.length
    if (discarded > 0) {
      showToast(`Invoice created · ${discarded} unsold item(s) discarded`)
    } else {
      showToast('Memo converted to invoice')
    }
  }

  const summary = useMemo(() => {
    let totalRevenue = 0
    let thisMonth = 0
    let pending = 0
    filteredInvoices.forEach((inv) => {
      if (inv.docKind === 'memo') return
      totalRevenue += inv.total
      if (inv.paidBy === 'pending') pending += inv.total
      if (isInvoiceInCalendarMonth(inv.date)) thisMonth += inv.total
    })
    return { totalRevenue, thisMonth, pending, count: filteredInvoices.length }
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

  const memoInvoices = useMemo(
    () => filteredInvoices.filter((i) => i.docKind === 'memo').sort((a, b) => b.date.localeCompare(a.date)),
    [filteredInvoices]
  )

  const pendingInvoices = useMemo(
    () => filteredInvoices.filter((i) => i.paidBy === 'pending' && i.docKind !== 'memo').sort((a, b) => b.total - a.total),
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

      {/* Company filter + actions — stacked so Web is not clipped on narrow screens */}
      <div style={{ marginBottom: 14 }}>
        <select
          value={selectedCompany}
          onChange={(e) => setSelectedCompany(e.target.value)}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '9px 12px',
            borderRadius: 10,
            border: '1.5px solid var(--border)',
            background: 'var(--bg3)',
            color: 'var(--text)',
            fontSize: 14,
            marginBottom: 8,
          }}
        >
          <option value="all">All Shops ({invoices.length})</option>
          {companies.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            onClick={onToggleFigures}
            aria-label={figuresVisible ? 'Hide revenue figures' : 'Show revenue figures'}
            style={{
              padding: '9px 11px',
              borderRadius: 10,
              border: '1.5px solid var(--border)',
              background: 'var(--bg3)',
              color: 'var(--text2)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              flexShrink: 0,
            }}
          >
            {figuresVisible ? <EyeOff size={18} strokeWidth={2} aria-hidden /> : <Eye size={18} strokeWidth={2} aria-hidden />}
          </button>
          <button
            type="button"
            onClick={openWebAnalyticsDashboard}
            aria-label="Open web dashboard"
            style={{
              flex: 1,
              minWidth: 0,
              padding: '9px 12px',
              borderRadius: 10,
              border: '1.5px solid var(--accent)',
              background: 'transparent',
              color: 'var(--accent)',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <Globe size={16} strokeWidth={2} aria-hidden />
            Web dashboard
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
        <StatCard label="Total Revenue" value={maskFigure(money(summary.totalRevenue))} accent />
        <StatCard label="This Month" value={maskFigure(money(summary.thisMonth))} />
        <StatCard label="Pending" value={maskFigure(money(summary.pending))} danger={summary.pending > 0} />
        <StatCard label="Invoices" value={String(summary.count)} />
      </div>

      {/* Memos — consignment at shops */}
      {memoInvoices.length > 0 && (
        <>
          <Section title={`Memos · ${memoInvoices.length}`} color="#8b5cf6" />
          <div style={{ background: 'var(--bg2)', border: '1.5px solid rgba(139,92,246,0.35)', borderRadius: 12, overflow: 'hidden', marginBottom: 4 }}>
            {memoInvoices.map((inv, i) => (
              <MemoRow
                key={inv.id}
                inv={inv}
                isFirst={i === 0}
                onClear={() => {
                  if (window.confirm('Clear this memo? Items are marked as collected back.')) handleClearMemo(inv.id)
                }}
                onConvert={(indices, soldDate) => handleConvertMemo(inv, indices, soldDate)}
              />
            ))}
          </div>
        </>
      )}

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

// ─── MemoRow — clear or convert sold lines to invoice ────────────────────────

function MemoRow({ inv, isFirst, onClear, onConvert }: {
  inv: SavedInvoice
  isFirst: boolean
  onClear: () => void
  onConvert: (selectedIndices: number[], soldDate: string) => void
}) {
  const [converting, setConverting] = useState(false)
  const [soldDate, setSoldDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [selected, setSelected] = useState<Set<number>>(() => new Set(inv.items.map((_, i) => i)))

  const toggleItem = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const startConvert = () => {
    setSelected(new Set(inv.items.map((_, i) => i)))
    setSoldDate(new Date().toISOString().slice(0, 10))
    setConverting(true)
  }

  const submitConvert = () => {
    const indices = [...selected].sort((a, b) => a - b)
    if (!indices.length) return
    const unselected = inv.items.length - indices.length
    const msg = unselected > 0
      ? `Create invoice for ${indices.length} sold item(s)? ${unselected} unsold item(s) will be discarded.`
      : 'Convert entire memo to a pending invoice?'
    if (!window.confirm(msg)) return
    onConvert(indices, soldDate)
    setConverting(false)
  }

  const itemCount = inv.items.length

  return (
    <div style={{ borderTop: isFirst ? 'none' : '1px solid var(--border2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {inv.company || inv.contactName || 'Unknown'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
            {[inv.city, inv.state].filter(Boolean).join(', ')} · {inv.date}
            {itemCount > 0 ? ` · ${itemCount} item${itemCount === 1 ? '' : 's'}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#8b5cf6' }}>{money(inv.total)}</div>
          {!converting ? (
            <>
              <button
                type="button"
                onClick={onClear}
                style={{ fontSize: 11, fontWeight: 700, padding: '5px 9px', borderRadius: 8, border: '1.5px solid var(--border)', background: 'transparent', color: 'var(--text3)', cursor: 'pointer' }}
              >
                Clear
              </button>
              <button
                type="button"
                onClick={startConvert}
                style={{ fontSize: 11, fontWeight: 700, padding: '5px 10px', borderRadius: 8, border: '1.5px solid #8b5cf6', background: 'transparent', color: '#8b5cf6', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <ClipboardList size={12} strokeWidth={2.5} aria-hidden />
                Sold
              </button>
            </>
          ) : null}
        </div>
      </div>
      {converting && (
        <div style={{ padding: '0 12px 12px', borderTop: '1px solid var(--border2)', background: 'rgba(139,92,246,0.04)' }}>
          <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, margin: '10px 0 8px' }}>
            Select sold items to invoice. Unselected items are discarded.
          </div>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text3)', marginBottom: 8 }}>
            Date sold
            <input
              type="date"
              value={soldDate}
              onChange={(e) => setSoldDate(e.target.value)}
              style={{
                display: 'block',
                width: '100%',
                marginTop: 4,
                padding: '8px 10px',
                borderRadius: 8,
                border: '1.5px solid var(--border)',
                background: 'var(--bg3)',
                color: 'var(--text)',
                fontSize: 14,
              }}
            />
          </label>
          {inv.items.map((it, i) => (
            <label
              key={i}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: i ? '1px solid var(--border2)' : 'none', cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                checked={selected.has(i)}
                onChange={() => toggleItem(i)}
                style={{ width: 18, height: 18, accentColor: '#8b5cf6', flexShrink: 0 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{itemLabel(it)}</div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#8b5cf6', flexShrink: 0 }}>{money(it.amount)}</div>
            </label>
          ))}
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            <button
              type="button"
              onClick={submitConvert}
              disabled={selected.size === 0}
              style={{ flex: 1, fontSize: 12, fontWeight: 700, padding: '8px 12px', borderRadius: 8, border: 'none', background: selected.size === 0 ? 'var(--bg4)' : '#8b5cf6', color: selected.size === 0 ? 'var(--text3)' : '#fff', cursor: selected.size === 0 ? 'default' : 'pointer' }}
            >
              Create invoice ({selected.size})
            </button>
            <button
              type="button"
              onClick={() => setConverting(false)}
              style={{ fontSize: 12, fontWeight: 700, padding: '8px 12px', borderRadius: 8, border: '1.5px solid var(--border)', background: 'transparent', color: 'var(--text3)', cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </div>
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
  const [showRevenueGate, setShowRevenueGate] = useState(false)
  const invoiceCount = useStore((s) => s.invoices.length)
  const { visible: figuresVisible, toggle: toggleFigures, mask: maskFigure } = useSensitiveFigures()

  const openRevenueTab = () => {
    if (isRevenueSessionUnlocked()) {
      setTab('revenue')
      return
    }
    setShowRevenueGate(true)
  }

  const handleTab = (id: 'stats' | 'revenue') => {
    if (id === 'stats') {
      lockRevenueSession()
      setTab('stats')
      return
    }
    if (tab === 'revenue') return
    openRevenueTab()
  }

  return (
    <div>
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, padding: '12px 16px 0', background: 'var(--bg2)', borderBottom: '1px solid var(--border2)', position: 'sticky', top: 53, zIndex: 10 }}>
        {([['stats', 'Stats'], ['revenue', 'Revenue']] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => void handleTab(id)}
            style={{
              flex: 1, padding: '9px 0', border: 'none', background: 'none',
              cursor: 'pointer',
              fontSize: 14, fontWeight: 700,
              color: tab === id ? 'var(--accent)' : 'var(--text3)',
              borderBottom: `2.5px solid ${tab === id ? 'var(--accent)' : 'transparent'}`,
              transition: 'color 0.15s',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
            }}
          >
            {id === 'revenue' && <ScanFace size={15} strokeWidth={2} aria-hidden />}
            {label}
            {id === 'revenue' && invoiceCount > 0 && (
              <span style={{ marginLeft: 4, fontSize: 11, background: 'var(--accent)', color: '#fff', borderRadius: 99, padding: '1px 6px', fontWeight: 800 }}>
                {invoiceCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'stats' ? (
        <StatsTab />
      ) : (
        <RevenueTab
          figuresVisible={figuresVisible}
          maskFigure={maskFigure}
          onToggleFigures={toggleFigures}
        />
      )}

      {showRevenueGate && (
        <RevenueUnlockGate
          onUnlocked={() => {
            setShowRevenueGate(false)
            setTab('revenue')
          }}
          onCancel={() => setShowRevenueGate(false)}
        />
      )}
    </div>
  )
}
