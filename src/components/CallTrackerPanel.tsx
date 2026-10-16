/**
 * Call-center style tracking page: period totals, outcome mix, and the full
 * searchable log of every dial that was saved with an outcome.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  CalendarClock,
  Clock,
  History,
  PhoneCall,
  Search,
  Undo2,
  X,
} from 'lucide-react'
import { phoneKey } from '../lib/utils'
import { describeWhen } from '../lib/callQueue'
import { normalizeStateValue } from '../lib/usStates'
import {
  CALL_OUTCOMES,
  CALL_OUTCOME_ORDER,
  type CallLog,
  type CallOutcome,
} from '../types/call'
import type { Contact } from '../types/contact'

export type TrackerPeriod = 'today' | 'week' | 'month' | 'all'

type Props = {
  open: boolean
  onClose: () => void
  logs: CallLog[]
  contacts: Contact[]
  onUndo: (log: CallLog) => void
  onOpenContact: (id: string) => void
  onWorkAgain: (contactId: string) => void
}

const DAY_MS = 24 * 60 * 60 * 1000

function startOfToday(now = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
}

function periodStart(period: TrackerPeriod, now = new Date()): number {
  const today = startOfToday(now)
  if (period === 'today') return today
  if (period === 'week') return today - 6 * DAY_MS
  if (period === 'month') return today - 29 * DAY_MS
  return 0
}

function periodLabel(period: TrackerPeriod): string {
  if (period === 'today') return 'Today'
  if (period === 'week') return 'Last 7 days'
  if (period === 'month') return 'Last 30 days'
  return 'All time'
}

type TrackerStats = {
  total: number
  reached: number
  interested: number
  callbacks: number
  noAnswer: number
  notInterested: number
  badNumber: number
  doNotCall: number
  uniqueShops: number
  withNotes: number
  byOutcome: Record<CallOutcome, number>
}

function buildStats(logs: CallLog[]): TrackerStats {
  const byOutcome = Object.fromEntries(
    CALL_OUTCOME_ORDER.map((outcome) => [outcome, 0]),
  ) as Record<CallOutcome, number>
  const shops = new Set<string>()
  let reached = 0
  let withNotes = 0

  for (const log of logs) {
    byOutcome[log.outcome] = (byOutcome[log.outcome] ?? 0) + 1
    shops.add(log.contact_id)
    if (CALL_OUTCOMES[log.outcome]?.reached) reached++
    if (log.note.trim()) withNotes++
  }

  return {
    total: logs.length,
    reached,
    interested: byOutcome.interested,
    callbacks: byOutcome.callback,
    noAnswer: byOutcome['no-answer'],
    notInterested: byOutcome['not-interested'],
    badNumber: byOutcome['bad-number'],
    doNotCall: byOutcome['do-not-call'],
    uniqueShops: shops.size,
    withNotes,
    byOutcome,
  }
}

export function CallTrackerPanel({
  open, onClose, logs, contacts, onUndo, onOpenContact, onWorkAgain,
}: Props) {
  const [period, setPeriod] = useState<TrackerPeriod>('week')
  const [filter, setFilter] = useState('')
  const [outcomeFilter, setOutcomeFilter] = useState<CallOutcome | 'all'>('all')

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [open])

  const contactById = useMemo(() => {
    const map = new Map<string, Contact>()
    for (const contact of contacts) map.set(contact.id, contact)
    return map
  }, [contacts])

  const scopedLogs = useMemo(() => {
    const start = periodStart(period)
    return logs
      .filter((log) => Date.parse(log.called_at) >= start)
      .sort((a, b) => b.called_at.localeCompare(a.called_at))
  }, [logs, period])

  const stats = useMemo(() => buildStats(scopedLogs), [scopedLogs])

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const digits = phoneKey(filter)
    return scopedLogs.filter((log) => {
      if (outcomeFilter !== 'all' && log.outcome !== outcomeFilter) return false
      if (!q && digits.length < 3) return true
      const contact = contactById.get(log.contact_id)
      const hay = [
        contact?.name,
        contact?.company,
        contact?.city,
        contact?.state,
        contact?.phone_mobile,
        contact?.phone_work,
        log.note,
        CALL_OUTCOMES[log.outcome]?.short,
      ].join(' ').toLowerCase()
      const textMatch = q.length > 0 && hay.includes(q)
      const phoneMatch = digits.length >= 3 && (
        phoneKey(contact?.phone_mobile).includes(digits) ||
        phoneKey(contact?.phone_work).includes(digits)
      )
      return textMatch || phoneMatch
    })
  }, [scopedLogs, filter, outcomeFilter, contactById])

  if (!open) return null

  const connectPct = stats.total > 0 ? Math.round((stats.reached / stats.total) * 100) : 0
  const interestPct = stats.total > 0 ? Math.round((stats.interested / stats.total) * 100) : 0

  const nameFor = (contactId: string) => {
    const contact = contactById.get(contactId)
    return contact ? contact.company || contact.name || 'Unknown' : 'Deleted contact'
  }

  const placeFor = (contactId: string) => {
    const contact = contactById.get(contactId)
    if (!contact) return ''
    return [contact.city, normalizeStateValue(contact.state)].filter(Boolean).join(', ')
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Call log tracker"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        background: 'var(--bg)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '12px 14px',
        borderBottom: '1px solid var(--border2)',
        background: 'var(--bg2)',
      }}>
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to Calls"
          style={{
            width: 36, height: 36, borderRadius: 10, border: 'none',
            background: 'var(--bg3)', color: 'var(--text)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <ArrowLeft className="size-5" aria-hidden />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>Call log</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 1 }}>
            Results for every dial you saved · {logs.length} total
          </div>
        </div>
        <History className="size-5 shrink-0" style={{ color: 'var(--accent)' }} aria-hidden />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 28 }}>
        <div style={{ padding: '12px 14px 0', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {([
            ['today', 'Today'],
            ['week', '7 days'],
            ['month', '30 days'],
            ['all', 'All'],
          ] as const).map(([value, label]) => (
            <PeriodChip
              key={value}
              active={period === value}
              label={label}
              onClick={() => setPeriod(value)}
            />
          ))}
        </div>

        <div style={{ padding: '12px 14px 0' }}>
          <div style={{
            background: 'var(--bg2)', border: '1px solid var(--border2)',
            borderRadius: 16, padding: 14,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', marginBottom: 10 }}>
              {periodLabel(period)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <BigStat value={String(stats.total)} label="Calls logged" />
              <BigStat value={`${connectPct}%`} label="Got through" />
              <BigStat value={String(stats.interested)} label="Interested" accent />
              <BigStat value={String(stats.uniqueShops)} label="Shops touched" />
            </div>

            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 12,
            }}>
              <MiniStat value={stats.noAnswer} label="No answer" />
              <MiniStat value={stats.callbacks} label="Callbacks" />
              <MiniStat value={stats.notInterested} label="Not interested" />
              <MiniStat value={stats.badNumber} label="Wrong #" />
              <MiniStat value={stats.doNotCall} label="Do not call" />
              <MiniStat value={stats.withNotes} label="With notes" />
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                marginBottom: 6,
              }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)' }}>
                  Outcome mix
                </span>
                <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--accent)' }}>
                  {interestPct}% interested
                </span>
              </div>
              {CALL_OUTCOME_ORDER.map((outcome) => {
                const count = stats.byOutcome[outcome] ?? 0
                const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0
                const meta = CALL_OUTCOMES[outcome]
                const { bg, fg } = tonePalette(meta.tone)
                return (
                  <button
                    key={outcome}
                    type="button"
                    onClick={() => setOutcomeFilter((cur) => (cur === outcome ? 'all' : outcome))}
                    style={{
                      display: 'block', width: '100%', border: 'none', background: 'none',
                      padding: '5px 0', cursor: 'pointer', textAlign: 'left',
                      opacity: outcomeFilter === 'all' || outcomeFilter === outcome ? 1 : 0.4,
                    }}
                  >
                    <div style={{
                      display: 'flex', justifyContent: 'space-between', gap: 8,
                      fontSize: 11.5, fontWeight: 700, color: 'var(--text2)', marginBottom: 3,
                    }}>
                      <span style={{ color: outcomeFilter === outcome ? fg : 'var(--text2)' }}>
                        {meta.short}
                      </span>
                      <span>{count} · {pct}%</span>
                    </div>
                    <div style={{ height: 6, borderRadius: 99, background: 'var(--bg4)', overflow: 'hidden' }}>
                      <div style={{
                        width: `${pct}%`, height: '100%', borderRadius: 99,
                        background: fg, opacity: 0.75,
                      }} />
                    </div>
                  </button>
                )
              })}
              {outcomeFilter !== 'all' && (
                <button
                  type="button"
                  onClick={() => setOutcomeFilter('all')}
                  style={{
                    marginTop: 6, border: 'none', background: 'none', padding: 0,
                    color: 'var(--accent)', fontSize: 12, fontWeight: 800, cursor: 'pointer',
                  }}
                >
                  Clear outcome filter
                </button>
              )}
            </div>
          </div>
        </div>

        <div style={{ padding: '14px 14px 0' }}>
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <Search
              className="size-4"
              style={{
                position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                color: 'var(--text3)', pointerEvents: 'none',
              }}
              aria-hidden
            />
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Search company, city, notes…"
              aria-label="Search call log"
              style={{
                width: '100%', padding: '11px 40px 11px 38px', borderRadius: 12,
                background: 'var(--bg2)', border: '1px solid var(--border2)',
                fontSize: 15, color: 'var(--text)',
              }}
            />
            {filter && (
              <button
                type="button"
                onClick={() => setFilter('')}
                aria-label="Clear search"
                style={{
                  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                  width: 26, height: 26, borderRadius: '50%', border: 'none',
                  background: 'var(--bg4)', color: 'var(--text3)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                }}
              >
                <X className="size-3.5" aria-hidden />
              </button>
            )}
          </div>

          <div style={{
            fontSize: 12, fontWeight: 700, color: 'var(--text3)',
            textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 8,
          }}>
            {visible.length} result{visible.length === 1 ? '' : 's'}
            {outcomeFilter !== 'all' ? ` · ${CALL_OUTCOMES[outcomeFilter].short}` : ''}
          </div>

          {visible.length === 0 ? (
            <div style={{
              padding: '28px 16px', borderRadius: 14, textAlign: 'center',
              background: 'var(--bg2)', border: '1px solid var(--border2)',
              color: 'var(--text3)', fontSize: 13, lineHeight: 1.5,
            }}>
              {logs.length === 0
                ? 'No calls saved yet. On the Calls screen, pick an outcome and tap Save — every result lands here.'
                : 'Nothing in this period matches. Try All time, or clear the search.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {visible.map((log) => {
                const meta = CALL_OUTCOMES[log.outcome]
                const { bg, fg } = tonePalette(meta?.tone ?? 'neutral')
                const place = placeFor(log.contact_id)
                return (
                  <div
                    key={log.id}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 10,
                      padding: '12px 12px', borderRadius: 12,
                      background: 'var(--bg2)', border: '1px solid var(--border2)',
                    }}
                  >
                    <span style={{
                      flexShrink: 0, marginTop: 1, padding: '4px 8px', borderRadius: 999,
                      background: bg, color: fg, fontSize: 10.5, fontWeight: 800,
                    }}>
                      {meta?.short ?? log.outcome}
                    </span>
                    <button
                      type="button"
                      onClick={() => onOpenContact(log.contact_id)}
                      style={{
                        flex: 1, minWidth: 0, border: 'none', background: 'none', padding: 0,
                        textAlign: 'left', cursor: 'pointer',
                      }}
                    >
                      <div style={{
                        fontSize: 14, fontWeight: 800, color: 'var(--text)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {nameFor(log.contact_id)}
                      </div>
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 5,
                        fontSize: 11.5, color: 'var(--text3)', marginTop: 3,
                      }}>
                        <Clock className="size-3 shrink-0" aria-hidden />
                        {describeWhen(log.called_at)}
                        {place ? ` · ${place}` : ''}
                      </div>
                      {log.callback_at && (
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 5,
                          fontSize: 11.5, color: 'var(--chip-info-fg)', marginTop: 3,
                        }}>
                          <CalendarClock className="size-3 shrink-0" aria-hidden />
                          Callback {describeWhen(log.callback_at)}
                        </div>
                      )}
                      {log.note && (
                        <div style={{
                          fontSize: 12.5, color: 'var(--text2)', marginTop: 5, lineHeight: 1.45,
                        }}>
                          {log.note}
                        </div>
                      )}
                    </button>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0 }}>
                      <button
                        type="button"
                        onClick={() => {
                          onWorkAgain(log.contact_id)
                          onClose()
                        }}
                        aria-label="Call again"
                        title="Open on Calls to dial or add another result"
                        style={{
                          width: 30, height: 30, borderRadius: 8, border: 'none',
                          background: 'var(--chip-accent-bg)', color: 'var(--accent)', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        <PhoneCall className="size-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => onUndo(log)}
                        aria-label="Undo this call"
                        title="Undo — puts them back in the queue"
                        style={{
                          width: 30, height: 30, borderRadius: 8, border: 'none',
                          background: 'var(--bg3)', color: 'var(--text3)', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        <Undo2 className="size-3.5" aria-hidden />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PeriodChip({ active, label, onClick }: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '8px 12px', borderRadius: 999, cursor: 'pointer',
        fontSize: 12.5, fontWeight: 800,
        border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        background: active ? 'var(--accent)' : 'var(--bg2)',
        color: active ? '#fff' : 'var(--text2)',
      }}
    >
      {label}
    </button>
  )
}

function BigStat({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div style={{
      padding: '10px 11px', borderRadius: 12, background: 'var(--bg3)',
    }}>
      <div style={{
        fontSize: 22, fontWeight: 800,
        color: accent ? 'var(--accent)' : 'var(--text)',
      }}>
        {value}
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', marginTop: 2 }}>
        {label}
      </div>
    </div>
  )
}

function MiniStat({ value, label }: { value: number; label: string }) {
  return (
    <div style={{
      padding: '8px 9px', borderRadius: 10, background: 'var(--bg)',
      border: '1px solid var(--border2)',
    }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{value}</div>
      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', marginTop: 1, lineHeight: 1.25 }}>
        {label}
      </div>
    </div>
  )
}

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

function tonePalette(tone: Tone): { bg: string; fg: string } {
  const palette: Record<Tone, { bg: string; fg: string }> = {
    success: { bg: 'var(--chip-success-bg)', fg: 'var(--chip-success-fg)' },
    warning: { bg: 'var(--chip-warning-bg)', fg: 'var(--chip-warning-fg)' },
    danger: { bg: 'var(--chip-danger-bg)', fg: 'var(--chip-danger-fg)' },
    info: { bg: 'var(--chip-info-bg)', fg: 'var(--chip-info-fg)' },
    neutral: { bg: 'var(--action-neutral-bg)', fg: 'var(--action-neutral-fg)' },
  }
  return palette[tone]
}
