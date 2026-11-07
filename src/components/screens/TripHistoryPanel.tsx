import { useMemo, useState } from 'react'
import {
  Check,
  ChevronDown,
  ClipboardList,
  MapPin,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import type { Contact } from '../../types/contact'
import type { TripLog, TripStopSnapshot } from '../../types/trip'
import { allLoggedVisitedIds } from '../../lib/tripHistory'
import { normalizeStateValue } from '../../lib/usStates'

interface Props {
  tripLogs: TripLog[]
  contacts: Contact[]
  onOpenContact: (id: string) => void
  onDeleteLog: (id: string) => void
  onClearAll: () => void
}

function formatDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  if (!y || !m || !d) return day
  try {
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return day
  }
}

function stopTitle(stop: TripStopSnapshot): string {
  return (stop.company || stop.name || 'Contact').trim()
}

function stopSub(stop: TripStopSnapshot): string {
  const who = stop.company && stop.name && stop.company !== stop.name ? stop.name : ''
  const place = [stop.city, stop.state].filter(Boolean).join(', ')
  return [who, place || stop.address].filter(Boolean).join(' · ')
}

function scopeLabel(log: TripLog): string {
  const area = [log.filterCity, log.filterState].filter(Boolean).join(', ')
  if (area) return area
  const fromStops = log.planned
    .map((s) => normalizeStateValue(s.state))
    .filter(Boolean)
  const top = fromStops[0]
  return top || shortPlace(log.originLabel) || 'Trip'
}

function shortPlace(label: string): string {
  const parts = label.split(',').map((p) => p.trim()).filter(Boolean)
  if (parts.length <= 2) return label
  return parts.slice(0, 2).join(', ')
}

/** Roll up visits by state for the visual overview chips. */
function stateBreakdown(logs: TripLog[]): Array<{ state: string; visits: number; days: number }> {
  const map = new Map<string, { visits: Set<string>; days: Set<string> }>()

  for (const log of logs) {
    for (const id of log.visitedIds) {
      const stop = log.planned.find((s) => s.contactId === id)
      const state = normalizeStateValue(stop?.state || log.filterState) || '—'
      let row = map.get(state)
      if (!row) {
        row = { visits: new Set(), days: new Set() }
        map.set(state, row)
      }
      row.visits.add(id)
      row.days.add(log.day)
    }
  }

  return [...map.entries()]
    .map(([state, row]) => ({ state, visits: row.visits.size, days: row.days.size }))
    .sort((a, b) => b.visits - a.visits || a.state.localeCompare(b.state))
}

export function TripHistoryPanel({
  tripLogs, contacts, onOpenContact, onDeleteLog, onClearAll,
}: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filterState, setFilterState] = useState('')

  const visitedIds = useMemo(() => allLoggedVisitedIds(tripLogs), [tripLogs])
  const byState = useMemo(() => stateBreakdown(tripLogs), [tripLogs])
  const tripDays = useMemo(() => new Set(tripLogs.map((l) => l.day)).size, [tripLogs])

  const filtered = useMemo(() => {
    if (!filterState) return tripLogs
    return tripLogs.filter((log) => {
      if (normalizeStateValue(log.filterState) === filterState) return true
      return log.planned.some((s) => normalizeStateValue(s.state) === filterState)
    })
  }, [tripLogs, filterState])

  const goodsShownExtra = useMemo(() => {
    // Contacts marked visited on the card but never on a trip log — still "done".
    let n = 0
    for (const c of contacts) {
      if (c.visited && !visitedIds.has(c.id)) n++
    }
    return n
  }, [contacts, visitedIds])

  if (tripLogs.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '48px 28px', color: 'var(--text3)' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
          <ClipboardList size={42} strokeWidth={1.25} aria-hidden />
        </div>
        <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text2)', marginBottom: 8 }}>
          No trips logged yet
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.55, maxWidth: 320, margin: '0 auto' }}>
          Plan a route, drive it, then tap <span style={{ fontWeight: 750, color: 'var(--text2)' }}>Log today's visits</span>.
          Those stops show up here so you can see what's done across the month.
        </div>
      </div>
    )
  }

  return (
    <div style={{ paddingBottom: 28 }}>
      <div style={{ padding: '14px 16px 8px' }}>
        <div style={{
          background: 'var(--bg2)', borderRadius: 16, padding: 16,
          border: '1px solid var(--border2)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <ClipboardList className="size-4 shrink-0" style={{ color: 'var(--accent)' }} aria-hidden />
            <div style={{ flex: 1, fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>
              Visit history
            </div>
            <button
              type="button"
              onClick={onClearAll}
              style={{
                border: 'none', background: 'none', padding: 0, cursor: 'pointer',
                fontSize: 11, fontWeight: 700, color: 'var(--text3)',
              }}
            >
              Clear all
            </button>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <StatCard value={String(visitedIds.size)} label="unique visits" />
            <StatCard value={String(tripDays)} label="trip days" />
            <StatCard value={String(tripLogs.length)} label="logs" />
          </div>

          {goodsShownExtra > 0 && (
            <div style={{
              fontSize: 11.5, color: 'var(--text3)', lineHeight: 1.45, marginBottom: 10,
              display: 'flex', gap: 7, alignItems: 'flex-start',
            }}>
              <TriangleAlert className="size-3.5 shrink-0" style={{ marginTop: 1 }} aria-hidden />
              <span>
                {goodsShownExtra} more contact{goodsShownExtra === 1 ? '' : 's'} marked goods shown
                on the card (not from a trip log).
              </span>
            </div>
          )}

          {byState.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <FilterChip
                active={!filterState}
                label="All"
                onClick={() => setFilterState('')}
              />
              {byState.map((row) => (
                <FilterChip
                  key={row.state}
                  active={filterState === row.state}
                  label={`${row.state} · ${row.visits}`}
                  onClick={() => setFilterState(filterState === row.state ? '' : row.state)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{
        padding: '4px 16px 10px', fontSize: 11, fontWeight: 700,
        color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.4px',
      }}>
        {filtered.length} trip{filtered.length === 1 ? '' : 's'}
        {filterState ? ` in ${filterState}` : ''}
      </div>

      <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {filtered.map((log) => {
          const open = expandedId === log.id
          const visited = log.planned.filter((s) => log.visitedIds.includes(s.contactId))
          const skipped = log.planned.filter((s) => log.skippedIds.includes(s.contactId))
          const pct = log.planned.length
            ? Math.round((visited.length / log.planned.length) * 100)
            : 0

          return (
            <div
              key={log.id}
              style={{
                background: 'var(--bg2)', borderRadius: 14,
                border: '1px solid var(--border2)', overflow: 'hidden',
              }}
            >
              <button
                type="button"
                onClick={() => setExpandedId(open ? null : log.id)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: '13px 14px', border: 'none', background: 'none',
                  cursor: 'pointer', textAlign: 'left',
                }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                  background: 'var(--chip-success-bg)', color: 'var(--chip-success-fg)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 850,
                }}>
                  {visited.length}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>
                    {formatDay(log.day)}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                    {scopeLabel(log)}
                    {' · '}
                    {visited.length} visited
                    {skipped.length > 0 ? ` · ${skipped.length} skipped` : ''}
                    {log.dayIndex && log.dayCount
                      ? ` · itinerary day ${log.dayIndex}/${log.dayCount}`
                      : ''}
                  </div>
                  <div style={{
                    height: 4, borderRadius: 99, background: 'var(--bg4)',
                    overflow: 'hidden', marginTop: 8,
                  }}>
                    <div style={{
                      width: `${pct}%`, height: '100%', borderRadius: 99,
                      background: 'var(--chip-success-fg)',
                    }} />
                  </div>
                </div>
                <ChevronDown
                  className="size-4 shrink-0"
                  style={{
                    color: 'var(--text3)', marginTop: 4,
                    transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.15s ease',
                  }}
                  aria-hidden
                />
              </button>

              {open && (
                <div style={{ borderTop: '1px solid var(--border2)', padding: '8px 10px 12px' }}>
                  {visited.length > 0 && (
                    <StopGroup
                      title="Visited"
                      tone="success"
                      stops={visited}
                      onOpenContact={onOpenContact}
                    />
                  )}
                  {skipped.length > 0 && (
                    <StopGroup
                      title="Skipped / left for later"
                      tone="muted"
                      stops={skipped}
                      onOpenContact={onOpenContact}
                    />
                  )}
                  {log.originLabel && (
                    <div style={{
                      fontSize: 11.5, color: 'var(--text3)', marginTop: 8,
                      padding: '0 6px', lineHeight: 1.4,
                    }}>
                      From {shortPlace(log.originLabel)}
                      {log.endLabel ? ` → ${shortPlace(log.endLabel)}` : ''}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (!confirm('Delete this trip log? Those visits can be suggested again.')) return
                      onDeleteLog(log.id)
                    }}
                    style={{
                      marginTop: 10, marginLeft: 6,
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      border: 'none', background: 'none', padding: 0, cursor: 'pointer',
                      fontSize: 12, fontWeight: 700, color: 'var(--danger)',
                    }}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                    Delete this log
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div style={{
      flex: 1, padding: '10px 8px', borderRadius: 12, textAlign: 'center',
      background: 'var(--bg3)', border: '1px solid var(--border2)',
    }}>
      <div style={{ fontSize: 18, fontWeight: 850, color: 'var(--text)' }}>{value}</div>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text3)', marginTop: 2 }}>
        {label}
      </div>
    </div>
  )
}

function FilterChip({
  active, label, onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '5px 10px', borderRadius: 99, cursor: 'pointer',
        border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        background: active ? 'var(--chip-accent-bg)' : 'var(--bg3)',
        color: active ? 'var(--accent)' : 'var(--text3)',
        fontSize: 11.5, fontWeight: 750,
      }}
    >
      {label}
    </button>
  )
}

function StopGroup({
  title, tone, stops, onOpenContact,
}: {
  title: string
  tone: 'success' | 'muted'
  stops: TripStopSnapshot[]
  onOpenContact: (id: string) => void
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{
        fontSize: 11, fontWeight: 750, color: 'var(--text3)',
        textTransform: 'uppercase', letterSpacing: '0.35px',
        padding: '4px 6px 6px',
      }}>
        {title}
      </div>
      {stops.map((stop) => (
        <button
          key={stop.contactId}
          type="button"
          onClick={() => onOpenContact(stop.contactId)}
          style={{
            width: '100%', display: 'flex', gap: 10, alignItems: 'flex-start',
            padding: '8px 8px', borderRadius: 10, border: 'none',
            background: 'transparent', textAlign: 'left', cursor: 'pointer',
          }}
        >
          <div style={{
            width: 22, height: 22, borderRadius: 7, flexShrink: 0, marginTop: 1,
            background: tone === 'success' ? 'var(--chip-success-bg)' : 'var(--bg4)',
            color: tone === 'success' ? 'var(--chip-success-fg)' : 'var(--text3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {tone === 'success'
              ? <Check className="size-3" aria-hidden />
              : <X className="size-3" aria-hidden />}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 13, fontWeight: 750,
              color: tone === 'success' ? 'var(--text)' : 'var(--text3)',
              textDecoration: tone === 'muted' ? 'line-through' : 'none',
            }}>
              {stopTitle(stop)}
            </div>
            {stopSub(stop) && (
              <div style={{
                fontSize: 11.5, color: 'var(--text3)', marginTop: 1,
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <MapPin className="size-3 shrink-0" aria-hidden />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {stopSub(stop)}
                </span>
              </div>
            )}
          </div>
        </button>
      ))}
    </div>
  )
}
