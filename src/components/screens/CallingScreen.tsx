import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  Ban,
  Building2,
  CalendarClock,
  Check,
  ChevronDown,
  CircleCheck,
  Clock,
  CloudOff,
  History,
  ListChecks,
  Loader2,
  MapPin,
  MessageSquare,
  Phone,
  PhoneCall,
  PhoneOff,
  RefreshCw,
  Search,
  SkipForward,
  SlidersHorizontal,
  Star,
  Target,
  ThumbsDown,
  ThumbsUp,
  Undo2,
  UserRound,
  X,
} from 'lucide-react'
import { useStore } from '../../store/useStore'
import { phoneKey, uid } from '../../lib/utils'
import { normalizeStateValue } from '../../lib/usStates'
import { deleteCallLogFromDB, saveContactToDB } from '../../lib/supabase'
import { IS_DEMO_MODE } from '../../lib/demo'
import { pushCallLog, syncCallLogs } from '../../lib/callSync'
import { LAST_TRIP_SCOPE_EVENT, loadLastTripScope, scopeLabel, type LastTripScope } from '../../lib/lastTripScope'
import { readSkippedCalls, writeSkippedCalls } from '../../lib/callSession'
import {
  buildCallQueue,
  buildHistories,
  contactPhone,
  DEFAULT_CALL_FILTERS,
  describeWhen,
  parkedReasonLabel,
  reasonLabel,
  type CallFilters,
  type ParkedEntry,
  type QueueEntry,
} from '../../lib/callQueue'
import {
  CALL_OUTCOMES,
  CALL_OUTCOME_ORDER,
  type CallLog,
  type CallOutcome,
} from '../../types/call'
import { CallTrackerPanel } from '../CallTrackerPanel'

/** Parked shops can still be opened from search so a rep can note and clear them. */
function parkedToQueueEntry(entry: ParkedEntry): QueueEntry {
  return {
    contact: entry.contact,
    history: entry.history,
    reason: entry.reason === 'callback-later' ? 'callback-due' : entry.reason === 'resting' ? 'retry' : 'fresh',
    score: 0,
    overdueDays: 0,
  }
}

const FILTERS_KEY = 'cs_call_filters_v1'

/** Default gap before a promised callback, used to pre-fill the date box. */
const DEFAULT_CALLBACK_DAYS = 7

function loadFilters(): CallFilters {
  try {
    const raw = localStorage.getItem(FILTERS_KEY)
    if (raw) return { ...DEFAULT_CALL_FILTERS, ...(JSON.parse(raw) as Partial<CallFilters>) }
  } catch {}
  return DEFAULT_CALL_FILTERS
}

function toDateInput(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function defaultCallbackDate(): string {
  const date = new Date()
  date.setDate(date.getDate() + DEFAULT_CALLBACK_DAYS)
  return toDateInput(date)
}

export function CallingScreen() {
  const contacts = useStore((s) => s.contacts)
  const callLogs = useStore((s) => s.callLogs)
  const addCallLog = useStore((s) => s.addCallLog)
  const mergeCallLogs = useStore((s) => s.mergeCallLogs)
  const markCallLogSynced = useStore((s) => s.markCallLogSynced)
  const deleteCallLog = useStore((s) => s.deleteCallLog)
  const updateContact = useStore((s) => s.updateContact)
  const setDetailContactId = useStore((s) => s.setDetailContactId)
  const showToast = useStore((s) => s.showToast)

  const [filters, setFilters] = useState<CallFilters>(loadFilters)
  const [setupOpen, setSetupOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)

  // Passed over for now, not logged. Session-only: tomorrow they come back.
  const [skipped, setSkipped] = useState<string[]>(readSkippedCalls)

  const [searchQuery, setSearchQuery] = useState('')
  /** Jump to a specific shop (after a dial, or to clear someone mid-list). */
  const [focusedId, setFocusedId] = useState<string | null>(null)

  const [note, setNote] = useState('')
  const [pendingOutcome, setPendingOutcome] = useState<CallOutcome | null>(null)
  const [callbackDate, setCallbackDate] = useState(defaultCallbackDate)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [tripHint, setTripHint] = useState<LastTripScope | null>(() => loadLastTripScope())
  const [hintDismissed, setHintDismissed] = useState(false)
  const [trackerOpen, setTrackerOpen] = useState(false)

  useEffect(() => {
    setTripHint(loadLastTripScope())
    const refresh = () => setTripHint(loadLastTripScope())
    window.addEventListener(LAST_TRIP_SCOPE_EVENT, refresh)
    return () => window.removeEventListener(LAST_TRIP_SCOPE_EVENT, refresh)
  }, [])

  const syncHandles = useRef({ merge: mergeCallLogs, markSynced: markCallLogSynced })
  syncHandles.current = { merge: mergeCallLogs, markSynced: markCallLogSynced }

  useEffect(() => {
    try { localStorage.setItem(FILTERS_KEY, JSON.stringify(filters)) } catch {}
  }, [filters])

  useEffect(() => {
    writeSkippedCalls(skipped)
  }, [skipped])

  // One reconcile on arrival: push anything stranded offline, then pull.
  const synced = useRef(false)
  useEffect(() => {
    if (synced.current) return
    synced.current = true
    const logs = useStore.getState().callLogs
    void syncCallLogs(logs, syncHandles.current)
  }, [])

  const states = useMemo(
    () => [...new Set(contacts.map((c) => normalizeStateValue(c.state)).filter(Boolean))].sort(),
    [contacts],
  )
  const cities = useMemo(() => {
    const source = filters.state
      ? contacts.filter((c) => normalizeStateValue(c.state) === filters.state)
      : contacts
    return [...new Set(source.map((c) => c.city).filter(Boolean))].sort()
  }, [contacts, filters.state])

  const queue = useMemo(
    () => buildCallQueue(contacts, callLogs, filters),
    [contacts, callLogs, filters],
  )

  const upNext = useMemo(
    () => queue.due.filter((entry) => !skipped.includes(entry.contact.id)),
    [queue.due, skipped],
  )

  const searchHits = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (q.length < 2) return [] as QueueEntry[]
    const digits = phoneKey(searchQuery)
    const pool = [...queue.due, ...queue.parked.map(parkedToQueueEntry)]
    const hits: QueueEntry[] = []
    for (const entry of pool) {
      if (hits.length >= 12) break
      const c = entry.contact
      const hay = [c.name, c.company, c.city, c.email, c.phone_mobile, c.phone_work]
        .join(' ')
        .toLowerCase()
      const textMatch = hay.includes(q)
      const phoneMatch = digits.length >= 3 && (
        phoneKey(c.phone_mobile).includes(digits) ||
        phoneKey(c.phone_work).includes(digits)
      )
      if (textMatch || phoneMatch) hits.push(entry)
    }
    return hits
  }, [searchQuery, queue.due, queue.parked])

  const histories = useMemo(() => buildHistories(callLogs), [callLogs])

  const focusedEntry = useMemo(() => {
    if (!focusedId) return undefined
    const fromDue = queue.due.find((entry) => entry.contact.id === focusedId)
    if (fromDue) return fromDue
    const parked = queue.parked.find((entry) => entry.contact.id === focusedId)
    if (parked) return parkedToQueueEntry(parked)
    const contact = contacts.find((c) => c.id === focusedId)
    if (!contact || !contactPhone(contact)) return undefined
    return {
      contact,
      history: histories.get(focusedId) ?? { logs: [], attempts: 0 },
      reason: 'fresh' as const,
      score: 0,
      overdueDays: 0,
    }
  }, [focusedId, queue.due, queue.parked, contacts, histories])

  const active: QueueEntry | undefined = focusedEntry ?? upNext[0]
  const workingFromSearch = Boolean(focusedEntry)

  const todayStartMs = useMemo(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    return start.getTime()
  }, [callLogs.length])

  const loggedTodayCount = useMemo(
    () => callLogs.filter((log) => Date.parse(log.called_at) >= todayStartMs).length,
    [callLogs, todayStartMs],
  )

  const unsyncedCount = useMemo(
    () => callLogs.reduce((n, log) => (log.synced ? n : n + 1), 0),
    [callLogs],
  )

  // A new card means a clean slate for the note and outcome.
  const activeId = active?.contact.id
  useEffect(() => {
    setNote('')
    setPendingOutcome(null)
    setCallbackDate(defaultCallbackDate())
    setHistoryOpen(false)
  }, [activeId])

  const patchFilters = (next: Partial<CallFilters>) => setFilters((f) => ({ ...f, ...next }))

  const clearSearchFocus = () => {
    setFocusedId(null)
    setSearchQuery('')
  }

  const pickSearchHit = (entry: QueueEntry) => {
    setFocusedId(entry.contact.id)
    setSearchQuery('')
    setSkipped((list) => list.filter((id) => id !== entry.contact.id))
  }

  const logCall = (outcome: CallOutcome) => {
    if (!active) return
    const contact = active.contact
    const now = new Date().toISOString()
    const wantsCallback = outcome === 'callback'

    const log: CallLog = {
      id: uid(),
      contact_id: contact.id,
      called_at: now,
      outcome,
      note: note.trim(),
      callback_at: wantsCallback && callbackDate
        ? new Date(`${callbackDate}T09:00:00`).toISOString()
        : undefined,
      created_at: now,
      synced: false,
    }

    addCallLog(log)
    void pushCallLog(log, syncHandles.current)
    clearSearchFocus()

    // A promised callback is also a reminder the client wants on his phone,
    // and the app already pushes notifications for contact follow-ups — so the
    // promise is written there too rather than inventing a second mechanism.
    if (wantsCallback && log.callback_at) {
      const followup = {
        followup_at: log.callback_at,
        followup_note: log.note || `Call back — ${contact.company || contact.name}`,
      }
      updateContact(contact.id, followup)
      if (!IS_DEMO_MODE) {
        const fresh = useStore.getState().contacts.find((c) => c.id === contact.id)
        if (fresh) void saveContactToDB(fresh)
      }
    }

    if (outcome === 'interested') {
      showToast('Interested — they show up in Trips → Interested on the phone')
    } else {
      showToast(`${CALL_OUTCOMES[outcome].short} — logged${wantsCallback ? ' with a reminder' : ''}`)
    }
  }

  const undoLog = (log: CallLog) => {
    deleteCallLog(log.id)
    if (!IS_DEMO_MODE) void deleteCallLogFromDB(log.id)
    setSkipped((list) => list.filter((id) => id !== log.contact_id))
    showToast('Call removed — back in the queue')
  }

  const resync = async () => {
    setSyncing(true)
    const result = await syncCallLogs(useStore.getState().callLogs, syncHandles.current)
    setSyncing(false)
    showToast(
      result.failed > 0
        ? `${result.failed} call${result.failed === 1 ? '' : 's'} still not saved to the cloud`
        : 'Call log is up to date',
    )
  }

  return (
    <div style={{ paddingBottom: 24 }}>
      <SetupPanel
        open={setupOpen}
        onToggle={() => setSetupOpen((v) => !v)}
        filters={filters}
        onChange={patchFilters}
        states={states}
        cities={cities}
        stats={queue.stats}
      />

      {tripHint && !hintDismissed && (tripHint.state || tripHint.city) &&
        (filters.state !== tripHint.state || filters.city !== tripHint.city) && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 9,
          margin: '12px 16px 0', padding: '10px 12px', borderRadius: 12,
          background: 'var(--chip-accent-bg)', border: '1px solid var(--accent)',
        }}>
          <MapPin className="size-4 shrink-0" style={{ color: 'var(--accent)' }} aria-hidden />
          <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: 'var(--text2)', lineHeight: 1.4 }}>
            Last trip was around {scopeLabel(tripHint)}. Call that area first?
          </div>
          <button
            type="button"
            onClick={() => {
              patchFilters({ state: tripHint.state, city: tripHint.city })
              setHintDismissed(true)
            }}
            style={{
              flexShrink: 0, padding: '7px 11px', borderRadius: 999, cursor: 'pointer',
              border: '1.5px solid var(--accent)', background: 'var(--accent)',
              color: '#fff', fontSize: 12, fontWeight: 800,
            }}
          >
            Call {tripHint.state || 'there'}
          </button>
          <button
            type="button"
            onClick={() => setHintDismissed(true)}
            aria-label="Dismiss trip hint"
            style={{
              flexShrink: 0, width: 28, height: 28, borderRadius: 8, border: 'none',
              background: 'transparent', color: 'var(--text3)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      )}

      <TallyBar stats={queue.stats} remaining={upNext.length} />

      <button
        type="button"
        onClick={() => setTrackerOpen(true)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          width: 'calc(100% - 32px)', margin: '0 16px 10px',
          padding: '12px 14px', borderRadius: 14, textAlign: 'left',
          border: '1.5px solid var(--accent)', background: 'var(--chip-accent-bg)',
          color: 'var(--accent)', cursor: 'pointer',
        }}
      >
        <History className="size-5 shrink-0" aria-hidden />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>Call log & results</div>
          <div style={{ fontSize: 11.5, fontWeight: 600, opacity: 0.85, marginTop: 1 }}>
            {callLogs.length === 0
              ? 'Track every dial — opens week / month / all history'
              : `${loggedTodayCount} today · ${callLogs.length} saved · week & month stats`}
          </div>
        </div>
        <ChevronDown
          className="size-5 shrink-0"
          style={{ transform: 'rotate(-90deg)' }}
          aria-hidden
        />
      </button>

      <CallSearchBar
        query={searchQuery}
        onQuery={setSearchQuery}
        hits={searchHits}
        onPick={pickSearchHit}
        focused={workingFromSearch ? active?.contact ?? null : null}
        onClearFocus={clearSearchFocus}
      />

      {unsyncedCount > 0 && (
        <button
          type="button"
          onClick={() => void resync()}
          disabled={syncing}
          style={{
            display: 'flex', alignItems: 'center', gap: 9, width: 'calc(100% - 32px)',
            margin: '12px 16px 0', padding: '10px 13px', borderRadius: 12, textAlign: 'left',
            background: 'var(--chip-warning-bg)', color: 'var(--chip-warning-fg)',
            border: 'none', fontSize: 12.5, fontWeight: 700, cursor: syncing ? 'default' : 'pointer',
          }}
        >
          {syncing
            ? <Loader2 className="size-4 animate-spin shrink-0" aria-hidden />
            : <CloudOff className="size-4 shrink-0" aria-hidden />}
          <span style={{ flex: 1 }}>
            {unsyncedCount} call{unsyncedCount === 1 ? '' : 's'} saved on this device only — tap to retry
          </span>
        </button>
      )}

      {active ? (
        <CallCard
          entry={active}
          note={note}
          onNote={setNote}
          pendingOutcome={pendingOutcome}
          onPendingOutcome={setPendingOutcome}
          callbackDate={callbackDate}
          onCallbackDate={setCallbackDate}
          historyOpen={historyOpen}
          onToggleHistory={() => setHistoryOpen((v) => !v)}
          onLog={logCall}
          onSkip={() => {
            setSkipped((list) => (
              list.includes(active.contact.id) ? list : [...list, active.contact.id]
            ))
            clearSearchFocus()
          }}
          onOpenContact={() => setDetailContactId(active.contact.id)}
        />
      ) : (
        <QueueEmpty
          stats={queue.stats}
          skippedCount={skipped.length}
          onRestoreSkipped={() => setSkipped([])}
        />
      )}

      {upNext.length > 1 && <UpNext entries={upNext.slice(1, 6)} total={upNext.length - 1} />}

      {queue.parked.length > 0 && <ParkedNote queue={queue} />}

      <CallTrackerPanel
        open={trackerOpen}
        onClose={() => setTrackerOpen(false)}
        logs={callLogs}
        contacts={contacts}
        onUndo={undoLog}
        onOpenContact={(id) => {
          setTrackerOpen(false)
          setDetailContactId(id)
        }}
        onWorkAgain={(contactId) => {
          setFocusedId(contactId)
          setSearchQuery('')
          setSkipped((list) => list.filter((id) => id !== contactId))
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }}
      />
    </div>
  )
}

// ─── Search ─────────────────────────────────────────────────────────────────

function CallSearchBar({
  query, onQuery, hits, onPick, focused, onClearFocus,
}: {
  query: string
  onQuery: (value: string) => void
  hits: QueueEntry[]
  onPick: (entry: QueueEntry) => void
  focused: ContactLike | null
  onClearFocus: () => void
}) {
  const showHits = query.trim().length >= 2

  return (
    <div style={{ padding: '0 16px 4px' }}>
      <div style={{ position: 'relative' }}>
        <Search
          className="size-4"
          style={{
            position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
            color: 'var(--text3)', pointerEvents: 'none',
          }}
          aria-hidden
        />
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search who you just called…"
          aria-label="Search call list"
          style={{
            width: '100%', padding: '11px 40px 11px 38px', borderRadius: 12,
            background: 'var(--bg2)', border: '1px solid var(--border2)',
            fontSize: 15, color: 'var(--text)',
          }}
        />
        {query && (
          <button
            type="button"
            onClick={() => onQuery('')}
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

      {focused && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginTop: 8,
          padding: '8px 11px', borderRadius: 10,
          background: 'var(--chip-accent-bg)', border: '1px solid var(--accent)',
        }}>
          <Search className="size-3.5 shrink-0" style={{ color: 'var(--accent)' }} aria-hidden />
          <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, color: 'var(--text2)' }}>
            Working on {focused.company || focused.name || 'this contact'} — add notes, then save to clear them
          </div>
          <button
            type="button"
            onClick={onClearFocus}
            style={{
              flexShrink: 0, padding: '5px 9px', borderRadius: 8, border: 'none',
              background: 'var(--bg2)', color: 'var(--text2)', fontSize: 11.5,
              fontWeight: 800, cursor: 'pointer',
            }}
          >
            Back to queue
          </button>
        </div>
      )}

      {showHits && (
        <div style={{
          marginTop: 8, borderRadius: 12, overflow: 'hidden',
          border: '1px solid var(--border2)', background: 'var(--bg2)',
          maxHeight: 280, overflowY: 'auto',
        }}>
          {hits.length === 0 ? (
            <div style={{ padding: '14px 14px', fontSize: 13, color: 'var(--text3)' }}>
              No matches in this call list
            </div>
          ) : hits.map((entry) => {
            const c = entry.contact
            const title = c.company || c.name || 'Unknown'
            const subtitle = [c.name && c.company ? c.name : '', c.city, normalizeStateValue(c.state)]
              .filter(Boolean)
              .join(' · ')
            const phone = contactPhone(c)
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onPick(entry)}
                style={{
                  display: 'flex', flexDirection: 'column', gap: 2, width: '100%',
                  padding: '11px 13px', border: 'none', borderBottom: '1px solid var(--border2)',
                  background: 'transparent', textAlign: 'left', cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{title}</div>
                {(subtitle || phone) && (
                  <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                    {[subtitle, phone].filter(Boolean).join(' · ')}
                  </div>
                )}
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', marginTop: 2 }}>
                  {reasonLabel(entry)}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

type ContactLike = { name?: string; company?: string }

// ─── Setup ──────────────────────────────────────────────────────────────────

function SetupPanel({
  open, onToggle, filters, onChange, states, cities, stats,
}: {
  open: boolean
  onToggle: () => void
  filters: CallFilters
  onChange: (next: Partial<CallFilters>) => void
  states: string[]
  cities: string[]
  stats: ReturnType<typeof buildCallQueue>['stats']
}) {
  const scope = filters.state || filters.city
    ? [filters.city, filters.state].filter(Boolean).join(', ')
    : 'everywhere'

  return (
    <div style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border2)' }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 16px', border: 'none', background: 'none',
          cursor: 'pointer', textAlign: 'left', WebkitTapHighlightColor: 'transparent',
        }}
      >
        <SlidersHorizontal className="size-4 shrink-0" style={{ color: 'var(--accent)' }} aria-hidden />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>Call list</div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>
            {filters.audience === 'prospects' ? 'Non-customers' : 'Everyone'} · {scope}
            {' · '}{stats.dueNow} ready to call
          </div>
        </div>
        <ChevronDown
          className="size-5 shrink-0"
          style={{
            color: 'var(--text3)',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease',
          }}
          aria-hidden
        />
      </button>

      {open && (
        <div style={{ padding: '0 16px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <FieldLabel>Who to call</FieldLabel>
            <div style={{ display: 'flex', gap: 6 }}>
              <SegButton
                active={filters.audience === 'prospects'}
                onClick={() => onChange({ audience: 'prospects' })}
                icon={<Target className="size-3.5 shrink-0" aria-hidden />}
                label="Not customers"
              />
              <SegButton
                active={filters.audience === 'everyone'}
                onClick={() => onChange({ audience: 'everyone' })}
                icon={<UserRound className="size-3.5 shrink-0" aria-hidden />}
                label="Everyone"
              />
            </div>
          </div>

          <div>
            <FieldLabel>Area</FieldLabel>
            <div style={{ display: 'flex', gap: 6 }}>
              <select
                value={filters.state}
                onChange={(e) => onChange({ state: e.target.value, city: '' })}
                style={{ ...dropdownStyle(!!filters.state), flex: 0.7 }}
                aria-label="State"
              >
                <option value="">All states</option>
                {states.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select
                value={filters.city}
                onChange={(e) => onChange({ city: e.target.value })}
                style={{ ...dropdownStyle(!!filters.city), flex: 1.3, minWidth: 0 }}
                aria-label="City"
              >
                <option value="">All cities</option>
                {cities.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select
                value={filters.minStars}
                onChange={(e) => onChange({ minStars: Number(e.target.value) })}
                style={{ ...dropdownStyle(filters.minStars > 0), flex: 0.8 }}
                aria-label="Minimum stars"
              >
                <option value={0}>Any ★</option>
                <option value={2}>2★ up</option>
                <option value={3}>3★ up</option>
                <option value={4}>4★</option>
              </select>
            </div>
          </div>

          <div style={{ fontSize: 11.5, color: 'var(--text3)', lineHeight: 1.5 }}>
            Not customers hides anyone marked a customer or an old customer.
            Due callbacks come first, then numbers that rang out and have rested a few days,
            then names never tried — higher-rated shops first.
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Tally ──────────────────────────────────────────────────────────────────

function TallyBar({ stats, remaining }: {
  stats: ReturnType<typeof buildCallQueue>['stats']
  remaining: number
}) {
  const worked = stats.callable - remaining
  const pct = stats.callable > 0 ? Math.round((worked / stats.callable) * 100) : 0

  return (
    <div style={{ padding: '14px 16px 12px', background: 'var(--bg)' }}>
      <div style={{
        background: 'var(--bg2)', border: '1px solid var(--border2)',
        borderRadius: 16, padding: 14,
      }}>
        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          <Stat icon={<PhoneCall className="size-3.5" aria-hidden />} value={`${stats.calledToday}`} label="called today" />
          <Stat icon={<MessageSquare className="size-3.5" aria-hidden />} value={`${stats.reachedToday}`} label="got through" />
          <Stat icon={<ThumbsUp className="size-3.5" aria-hidden />} value={`${stats.interestedToday}`} label="interested" />
        </div>

        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 5,
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)' }}>
            {remaining} left to work through
          </span>
          <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--accent)' }}>{pct}%</span>
        </div>
        <div style={{ height: 6, borderRadius: 99, background: 'var(--bg4)', overflow: 'hidden' }}>
          <div style={{
            width: `${pct}%`, height: '100%', borderRadius: 99,
            background: 'var(--accent)', transition: 'width 0.3s ease',
          }} />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
          <Chip tone="neutral" icon={<ListChecks className="size-3 shrink-0" aria-hidden />} text={`${stats.called} of ${stats.callable} touched`} />
          {stats.interested > 0 && (
            <Chip tone="success" icon={<ThumbsUp className="size-3 shrink-0" aria-hidden />} text={`${stats.interested} interested`} />
          )}
          {stats.callbacksLater > 0 && (
            <Chip tone="info" icon={<CalendarClock className="size-3 shrink-0" aria-hidden />} text={`${stats.callbacksLater} booked later`} />
          )}
          {stats.noPhone > 0 && (
            <Chip tone="warning" icon={<PhoneOff className="size-3 shrink-0" aria-hidden />} text={`${stats.noPhone} no number`} />
          )}
        </div>
      </div>
    </div>
  )
}

// ─── The card being called ──────────────────────────────────────────────────

function CallCard({
  entry, note, onNote, pendingOutcome, onPendingOutcome, callbackDate, onCallbackDate,
  historyOpen, onToggleHistory, onLog, onSkip, onOpenContact,
}: {
  entry: QueueEntry
  note: string
  onNote: (value: string) => void
  pendingOutcome: CallOutcome | null
  onPendingOutcome: (outcome: CallOutcome | null) => void
  callbackDate: string
  onCallbackDate: (value: string) => void
  historyOpen: boolean
  onToggleHistory: () => void
  onLog: (outcome: CallOutcome) => void
  onSkip: () => void
  onOpenContact: () => void
}) {
  const { contact, history } = entry
  const name = contact.company || contact.name || 'Unknown'
  const place = [contact.city, normalizeStateValue(contact.state)].filter(Boolean).join(', ')
  const phones = [
    { label: 'Mobile', value: (contact.phone_mobile ?? '').trim() },
    { label: 'Work', value: (contact.phone_work ?? '').trim() },
    ...(contact.extra_phones ?? [])
      .filter((phone) => (phone ?? '').trim())
      .map((phone) => ({ label: 'Other', value: phone.trim() })),
  ].filter((phone) => phone.value)

  const cardNotes = [contact.user_notes, contact.notes, contact.back_notes]
    .map((text) => (text ?? '').trim())
    .filter(Boolean)

  const needsDate = pendingOutcome === 'callback'

  return (
    <div style={{ padding: '0 16px' }}>
      <div style={{
        background: 'var(--bg2)', border: '1px solid var(--border2)',
        borderRadius: 16, padding: 16,
      }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 11 }}>
          <Chip
            tone={entry.reason === 'callback-due' ? 'danger' : entry.reason === 'retry' ? 'info' : 'accent'}
            icon={entry.reason === 'callback-due'
              ? <CalendarClock className="size-3 shrink-0" aria-hidden />
              : entry.reason === 'retry'
                ? <RefreshCw className="size-3 shrink-0" aria-hidden />
                : <Target className="size-3 shrink-0" aria-hidden />}
            text={reasonLabel(entry)}
          />
          {contact.is_old_customer && (
            <Chip tone="success" icon={<History className="size-3 shrink-0" aria-hidden />} text="Bought before" />
          )}
          {contact.visited && (
            <Chip tone="neutral" icon={<Check className="size-3 shrink-0" aria-hidden />} text="Goods shown" />
          )}
          {(contact.stars ?? 0) > 0 && (
            <Chip tone="warning" icon={<Star className="size-3 shrink-0" aria-hidden />} text={`${contact.stars}★`} />
          )}
        </div>

        <button
          type="button"
          onClick={onOpenContact}
          style={{
            border: 'none', background: 'none', padding: 0, textAlign: 'left',
            cursor: 'pointer', width: '100%',
          }}
        >
          <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--text)', lineHeight: 1.25 }}>
            {name}
          </div>
          {contact.name && contact.company && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 5,
              fontSize: 13, color: 'var(--text2)', marginTop: 3,
            }}>
              <UserRound className="size-3.5 shrink-0" aria-hidden />
              {contact.name}{contact.title ? ` · ${contact.title}` : ''}
            </div>
          )}
          {place && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 5,
              fontSize: 12.5, color: 'var(--text3)', marginTop: 3,
            }}>
              <MapPin className="size-3.5 shrink-0" aria-hidden />
              {place}
            </div>
          )}
        </button>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 13 }}>
          {phones.map((phone) => (
            <a
              key={`${phone.label}-${phone.value}`}
              href={`tel:${phone.value}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '13px 15px', borderRadius: 12, textDecoration: 'none',
                background: 'var(--accent)', color: '#fff', fontSize: 16, fontWeight: 800,
              }}
            >
              <Phone className="size-4 shrink-0" aria-hidden />
              <span style={{ flex: 1, minWidth: 0 }}>{phone.value}</span>
              <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.85 }}>{phone.label}</span>
            </a>
          ))}
        </div>

        {cardNotes.length > 0 && (
          <div style={{
            marginTop: 12, padding: '10px 12px', borderRadius: 10,
            background: 'var(--bg3)', fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.5,
          }}>
            {cardNotes.map((text, index) => (
              <div key={index} style={{ marginTop: index === 0 ? 0 : 6 }}>{text}</div>
            ))}
          </div>
        )}

        {history.attempts > 0 && (
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              onClick={onToggleHistory}
              style={{
                display: 'flex', alignItems: 'center', gap: 7, width: '100%',
                padding: '8px 10px', borderRadius: 10, cursor: 'pointer',
                border: '1px solid var(--border2)', background: 'var(--bg3)',
                color: 'var(--text2)', fontSize: 12, fontWeight: 700, textAlign: 'left',
              }}
            >
              <Clock className="size-3.5 shrink-0" aria-hidden />
              <span style={{ flex: 1 }}>
                {history.attempts} previous call{history.attempts === 1 ? '' : 's'}
                {history.lastCalledAt ? ` · last ${describeWhen(history.lastCalledAt)}` : ''}
              </span>
              <ChevronDown
                className="size-4 shrink-0"
                style={{ transform: historyOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
                aria-hidden
              />
            </button>
            {historyOpen && (
              <div style={{ marginTop: 7, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {history.logs.map((log) => (
                  <div
                    key={log.id}
                    style={{
                      padding: '8px 11px', borderRadius: 9, background: 'var(--bg3)',
                      fontSize: 12, color: 'var(--text2)', lineHeight: 1.45,
                    }}
                  >
                    <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
                      <span style={{ fontWeight: 800, color: 'var(--text)' }}>
                        {CALL_OUTCOMES[log.outcome]?.short ?? log.outcome}
                      </span>
                      <span style={{ color: 'var(--text3)' }}>{describeWhen(log.called_at)}</span>
                    </div>
                    {log.note && <div style={{ marginTop: 3 }}>{log.note}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          <FieldLabel>How did it go?</FieldLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {CALL_OUTCOME_ORDER.map((outcome) => (
              <OutcomeButton
                key={outcome}
                outcome={outcome}
                active={pendingOutcome === outcome}
                onClick={() => onPendingOutcome(pendingOutcome === outcome ? null : outcome)}
              />
            ))}
          </div>
        </div>

        {needsDate && (
          <div style={{ marginTop: 11 }}>
            <FieldLabel>Call back on</FieldLabel>
            <input
              type="date"
              value={callbackDate}
              min={toDateInput(new Date())}
              onChange={(event) => onCallbackDate(event.target.value)}
              aria-label="Callback date"
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 10,
                background: 'var(--bg3)', border: '1.5px solid var(--border)',
                fontSize: 15, color: 'var(--text)',
              }}
            />
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 5, lineHeight: 1.45 }}>
              Saved as a follow-up too, so the app reminds you that morning.
            </div>
          </div>
        )}

        <div style={{ marginTop: 11 }}>
          <FieldLabel>Notes</FieldLabel>
          <textarea
            value={note}
            onChange={(event) => onNote(event.target.value)}
            placeholder="What they said, who to ask for next time…"
            rows={3}
            aria-label="Call notes"
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 10, resize: 'vertical',
              background: 'var(--bg3)', border: '1.5px solid var(--border)',
              fontSize: 14, color: 'var(--text)', lineHeight: 1.45,
              fontFamily: 'inherit',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button
            type="button"
            onClick={() => pendingOutcome && onLog(pendingOutcome)}
            disabled={!pendingOutcome}
            style={{
              flex: 1, padding: '13px 16px', borderRadius: 12, border: 'none',
              background: pendingOutcome ? 'var(--accent)' : 'var(--bg4)',
              color: pendingOutcome ? '#fff' : 'var(--text3)',
              fontSize: 15, fontWeight: 800,
              cursor: pendingOutcome ? 'pointer' : 'default',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            <CircleCheck className="size-4 shrink-0" aria-hidden />
            {pendingOutcome ? 'Save and next' : 'Pick an outcome'}
          </button>
          <button
            type="button"
            onClick={onSkip}
            title="Leave this one for later today"
            style={{
              padding: '13px 15px', borderRadius: 12, cursor: 'pointer',
              border: '1.5px solid var(--border)', background: 'var(--bg3)',
              color: 'var(--text2)', fontSize: 13, fontWeight: 800,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            <SkipForward className="size-4 shrink-0" aria-hidden />
            Skip
          </button>
        </div>
      </div>
    </div>
  )
}

const OUTCOME_ICON: Record<CallOutcome, ReactNode> = {
  interested: <ThumbsUp className="size-3.5 shrink-0" aria-hidden />,
  callback: <CalendarClock className="size-3.5 shrink-0" aria-hidden />,
  'no-answer': <PhoneOff className="size-3.5 shrink-0" aria-hidden />,
  'not-interested': <ThumbsDown className="size-3.5 shrink-0" aria-hidden />,
  'bad-number': <PhoneOff className="size-3.5 shrink-0" aria-hidden />,
  'do-not-call': <Ban className="size-3.5 shrink-0" aria-hidden />,
}

function OutcomeButton({ outcome, active, onClick }: {
  outcome: CallOutcome
  active: boolean
  onClick: () => void
}) {
  const meta = CALL_OUTCOMES[outcome]
  const { bg, fg } = tonePalette(meta.tone)

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7,
        padding: '11px 12px', borderRadius: 11, cursor: 'pointer',
        border: `1.5px solid ${active ? fg : 'var(--border)'}`,
        background: active ? bg : 'var(--bg3)',
        color: active ? fg : 'var(--text2)',
        fontSize: 12.5, fontWeight: 800, textAlign: 'left',
      }}
    >
      {OUTCOME_ICON[outcome]}
      <span style={{ flex: 1, minWidth: 0 }}>{meta.label}</span>
    </button>
  )
}

// ─── Supporting sections ────────────────────────────────────────────────────

function QueueEmpty({ stats, skippedCount, onRestoreSkipped }: {
  stats: ReturnType<typeof buildCallQueue>['stats']
  skippedCount: number
  onRestoreSkipped: () => void
}) {
  const nothingInScope = stats.callable === 0

  return (
    <div style={{ textAlign: 'center', padding: '48px 28px', color: 'var(--text3)' }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
        {nothingInScope
          ? <PhoneOff size={44} strokeWidth={1.25} aria-hidden />
          : <CircleCheck size={44} strokeWidth={1.25} style={{ color: 'var(--chip-success-fg)' }} aria-hidden />}
      </div>
      <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text2)', marginBottom: 8 }}>
        {nothingInScope ? 'Nobody to call here' : 'That is the whole list'}
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.55, maxWidth: 330, margin: '0 auto' }}>
        {nothingInScope
          ? 'No contacts match these filters, or none of them have a phone number saved. Widen the area or switch to Everyone.'
          : `Every number in this area has been worked through. ${stats.callbacksLater} callback${stats.callbacksLater === 1 ? ' is' : 's are'} booked for later.`}
      </div>
      {skippedCount > 0 && (
        <button
          type="button"
          onClick={onRestoreSkipped}
          style={{
            marginTop: 16, padding: '10px 16px', borderRadius: 999, cursor: 'pointer',
            border: '1.5px solid var(--accent)', background: 'var(--chip-accent-bg)',
            color: 'var(--accent)', fontSize: 13, fontWeight: 800,
            display: 'inline-flex', alignItems: 'center', gap: 7,
          }}
        >
          <Undo2 className="size-4 shrink-0" aria-hidden />
          Bring back {skippedCount} skipped
        </button>
      )}
    </div>
  )
}

function UpNext({ entries, total }: { entries: QueueEntry[]; total: number }) {
  return (
    <>
      <SectionLabel>Next up · {total} waiting</SectionLabel>
      <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {entries.map((entry) => (
          <div
            key={entry.contact.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 12px', borderRadius: 11,
              background: 'var(--bg2)', border: '1px solid var(--border2)',
            }}
          >
            <Building2 className="size-4 shrink-0" style={{ color: 'var(--text3)' }} aria-hidden />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 13.5, fontWeight: 700, color: 'var(--text)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {entry.contact.company || entry.contact.name || 'Unknown'}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 1 }}>
                {[entry.contact.city, normalizeStateValue(entry.contact.state)].filter(Boolean).join(', ')
                  || contactPhone(entry.contact)}
              </div>
            </div>
            {entry.reason === 'callback-due' && (
              <CalendarClock className="size-3.5 shrink-0" style={{ color: 'var(--chip-danger-fg)' }} aria-hidden />
            )}
          </div>
        ))}
      </div>
    </>
  )
}

function ParkedNote({ queue }: { queue: ReturnType<typeof buildCallQueue> }) {
  const counts = new Map<string, number>()
  for (const entry of queue.parked) {
    const label = parkedReasonLabel(entry.reason)
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }

  return (
    <div style={{
      margin: '18px 16px 0', padding: '12px 14px', borderRadius: 12,
      background: 'var(--bg2)', border: '1px solid var(--border2)',
      fontSize: 11.5, color: 'var(--text3)', lineHeight: 1.6,
    }}>
      <div style={{ fontWeight: 800, color: 'var(--text2)', marginBottom: 4 }}>Held back</div>
      {[...counts.entries()].map(([label, count]) => (
        <div key={label}>{count} · {label}</div>
      ))}
    </div>
  )
}

// ─── Small building blocks ──────────────────────────────────────────────────

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: 'var(--text3)',
      textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 7,
    }}>
      {children}
    </div>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{
      fontSize: 12, fontWeight: 600, color: 'var(--text3)',
      padding: '18px 16px 7px', textTransform: 'uppercase',
      letterSpacing: '0.6px', background: 'var(--bg)',
    }}>
      {children}
    </div>
  )
}

function SegButton({ active, onClick, icon, label }: {
  active: boolean
  onClick: () => void
  icon: ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1, padding: '9px 12px', borderRadius: 10, cursor: 'pointer',
        fontSize: 12.5, fontWeight: 800, whiteSpace: 'nowrap',
        border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        background: active ? 'var(--chip-accent-bg)' : 'var(--bg3)',
        color: active ? 'var(--accent)' : 'var(--text2)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      }}
    >
      {icon}
      {label}
    </button>
  )
}

function Stat({ icon, value, label }: { icon: ReactNode; value: string; label: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        color: 'var(--text3)', fontSize: 11, fontWeight: 600, marginBottom: 3,
      }}>
        {icon}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      </div>
      <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--text)' }}>{value}</div>
    </div>
  )
}

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'accent'

function tonePalette(tone: Tone): { bg: string; fg: string } {
  const palette: Record<Tone, { bg: string; fg: string }> = {
    success: { bg: 'var(--chip-success-bg)', fg: 'var(--chip-success-fg)' },
    warning: { bg: 'var(--chip-warning-bg)', fg: 'var(--chip-warning-fg)' },
    danger: { bg: 'var(--chip-danger-bg)', fg: 'var(--chip-danger-fg)' },
    info: { bg: 'var(--chip-info-bg)', fg: 'var(--chip-info-fg)' },
    neutral: { bg: 'var(--action-neutral-bg)', fg: 'var(--action-neutral-fg)' },
    accent: { bg: 'var(--chip-accent-bg)', fg: 'var(--accent)' },
  }
  return palette[tone]
}

function Chip({ tone, icon, text }: { tone: Tone; icon: ReactNode; text: string }) {
  const { bg, fg } = tonePalette(tone)
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 8px', borderRadius: 999,
      background: bg, color: fg, fontSize: 11, fontWeight: 800,
    }}>
      {icon}
      {text}
    </span>
  )
}

function dropdownStyle(active: boolean): CSSProperties {
  return {
    flex: 1, padding: '9px 8px', borderRadius: 10, fontSize: 12.5, fontWeight: 600,
    border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'var(--chip-accent-bg)' : 'var(--bg3)',
    color: active ? 'var(--accent)' : 'var(--text2)',
    cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none',
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%238e8e93' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center',
    paddingRight: 22,
  }
}
