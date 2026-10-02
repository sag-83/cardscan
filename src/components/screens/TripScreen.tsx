import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  Car,
  Check,
  ChevronDown,
  Copy,
  Crosshair,
  ExternalLink,
  Flag,
  Info,
  Loader2,
  MapPin,
  Navigation,
  RefreshCw,
  Route,
  SlidersHorizontal,
  Timer,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import { useStore } from '../../store/useStore'
import { normalizeStateValue } from '../../lib/usStates'
import { geocodePlace, getUserPosition, LocationError } from '../../lib/geocode'
import { formatDuration, formatMiles } from '../../lib/geoMath'
import { isLocationAccessEnabled } from '../../lib/locationAccess'
import {
  buildMapsLinks,
  buildTripText,
  DEFAULT_TRIP_OPTIONS,
  planTrip,
  stopAddressText,
  TripCancelledError,
  TripPlanError,
  type TripOptions,
  type TripOrigin,
  type TripPlan,
  type TripProgress,
  type TripStop,
} from '../../lib/tripPlanner'

const OPTIONS_KEY = 'cs_trip_options_v1'

// A day much longer than this stops being realistic once meals and overruns
// are accounted for, so the plan gets flagged rather than silently returned.
const LONG_DAY_MINUTES = 9 * 60

function loadOptions(): TripOptions {
  try {
    const raw = localStorage.getItem(OPTIONS_KEY)
    if (raw) return { ...DEFAULT_TRIP_OPTIONS, ...(JSON.parse(raw) as Partial<TripOptions>) }
  } catch {}
  return DEFAULT_TRIP_OPTIONS
}

function describeError(err: unknown): string {
  if (err instanceof LocationError) {
    if (err.code === 'https') return 'Location needs HTTPS. Open the live site, not a file preview.'
    if (err.code === 'denied') return 'Settings → Near Me (Location) → Enable → Allow'
    if (err.code === 'timeout') return 'Location timed out. Try again outdoors or with Wi-Fi on.'
    return err.message
  }
  if (err instanceof TripPlanError) return err.message
  return err instanceof Error ? err.message : 'Could not plan this route'
}

export function TripScreen() {
  const contacts = useStore((s) => s.contacts)
  const showToast = useStore((s) => s.showToast)
  const setDetailContactId = useStore((s) => s.setDetailContactId)

  const [originMode, setOriginMode] = useState<'device' | 'place'>('device')
  const [placeText, setPlaceText] = useState('')

  const [filterState, setFilterState] = useState('')
  const [filterCity, setFilterCity] = useState('')
  const [filterType, setFilterType] = useState('')
  const [minStars, setMinStars] = useState(0)

  const [options, setOptions] = useState<TripOptions>(loadOptions)
  const [setupOpen, setSetupOpen] = useState(true)

  const [working, setWorking] = useState(false)
  const [progress, setProgress] = useState<TripProgress | null>(null)
  const [plan, setPlan] = useState<TripPlan | null>(null)
  const [error, setError] = useState('')
  const [excluded, setExcluded] = useState<string[]>([])
  const [lastOrigin, setLastOrigin] = useState<TripOrigin | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    try { localStorage.setItem(OPTIONS_KEY, JSON.stringify(options)) } catch {}
  }, [options])

  useEffect(() => () => abortRef.current?.abort(), [])

  const states = useMemo(
    () => [...new Set(contacts.map((c) => normalizeStateValue(c.state)).filter(Boolean))].sort(),
    [contacts],
  )
  const cities = useMemo(() => {
    const source = filterState
      ? contacts.filter((c) => normalizeStateValue(c.state) === filterState)
      : contacts
    return [...new Set(source.map((c) => c.city).filter(Boolean))].sort()
  }, [contacts, filterState])

  const scoped = useMemo(() => contacts.filter((c) => {
    if (filterState && normalizeStateValue(c.state) !== filterState) return false
    if (filterCity && c.city !== filterCity) return false
    if (filterType === 'customer' && !c.is_customer) return false
    if (filterType === 'old_customer' && !c.is_old_customer) return false
    if (filterType === 'goods_shown' && !c.visited) return false
    if (filterType === 'not_visited' && c.visited) return false
    if (minStars > 0 && c.stars < minStars) return false
    return true
  }), [contacts, filterState, filterCity, filterType, minStars])

  const resolveOrigin = async (): Promise<TripOrigin> => {
    if (originMode === 'device') {
      if (!isLocationAccessEnabled()) {
        throw new TripPlanError('Turn on Settings → Near Me (Location) first, or enter a place instead.')
      }
      return { label: 'My location', point: await getUserPosition() }
    }
    const typed = placeText.trim()
    if (!typed) throw new TripPlanError('Type a city, ZIP or address to start from.')
    const point = await geocodePlace(typed)
    if (!point) throw new TripPlanError(`Could not find "${typed}". Try adding the state.`)
    return { label: typed, point }
  }

  const run = async (overrides?: { origin?: TripOrigin; excluded?: string[] }) => {
    if (working) return
    const excludedNow = overrides?.excluded ?? excluded

    setError('')
    setWorking(true)
    setProgress(null)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const origin = overrides?.origin ?? (await resolveOrigin())
      setLastOrigin(origin)

      const pool = scoped.filter((c) => !excludedNow.includes(c.id))
      if (pool.length === 0) throw new TripPlanError('No contacts match these filters.')

      const result = await planTrip(pool, origin, options, setProgress, controller.signal)
      setPlan(result)
      setSetupOpen(false)
    } catch (err) {
      if (err instanceof TripCancelledError) return
      setError(describeError(err))
    } finally {
      setWorking(false)
      setProgress(null)
      abortRef.current = null
    }
  }

  const removeStop = (id: string) => {
    const next = [...excluded, id]
    setExcluded(next)
    void run({ origin: lastOrigin ?? undefined, excluded: next })
  }

  const restoreRemoved = () => {
    setExcluded([])
    void run({ origin: lastOrigin ?? undefined, excluded: [] })
  }

  const copyPlan = async () => {
    if (!plan) return
    const text = buildTripText(plan)
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        showToast('Route copied — paste it anywhere')
      } else {
        showToast('Copying is not available in this browser')
      }
    } catch {
      showToast('Could not copy the route')
    }
  }

  return (
    <div style={{ paddingBottom: 24 }}>
      <div style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border2)' }}>
        <button
          type="button"
          onClick={() => setSetupOpen((v) => !v)}
          aria-expanded={setupOpen}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 10,
            padding: '12px 16px', border: 'none', background: 'none',
            cursor: 'pointer', textAlign: 'left', WebkitTapHighlightColor: 'transparent',
          }}
        >
          <SlidersHorizontal className="size-4 shrink-0" style={{ color: 'var(--accent)' }} aria-hidden />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>Trip setup</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>
              {scoped.length} contact{scoped.length === 1 ? '' : 's'} in scope · up to {options.maxStops} stops
              {' · '}{options.radiusMiles} mi
            </div>
          </div>
          <ChevronDown
            className="size-5 shrink-0"
            style={{
              color: 'var(--text3)',
              transform: setupOpen ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s ease',
            }}
            aria-hidden
          />
        </button>

        {setupOpen && (
          <div style={{ padding: '0 16px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Group label="Start from">
              <div style={{ display: 'flex', gap: 6 }}>
                <SegButton
                  active={originMode === 'device'}
                  onClick={() => setOriginMode('device')}
                  icon={<Crosshair className="size-3.5 shrink-0" aria-hidden />}
                  label="My location"
                />
                <SegButton
                  active={originMode === 'place'}
                  onClick={() => setOriginMode('place')}
                  icon={<MapPin className="size-3.5 shrink-0" aria-hidden />}
                  label="A place"
                />
              </div>
              {originMode === 'place' && (
                <input
                  value={placeText}
                  onChange={(e) => setPlaceText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void run() }}
                  placeholder="Lancaster, PA  ·  19106  ·  hotel address"
                  style={{
                    width: '100%', padding: '10px 12px', marginTop: 8,
                    background: 'var(--bg3)', border: '1.5px solid var(--border)',
                    borderRadius: 10, fontSize: 15, color: 'var(--text)',
                  }}
                />
              )}
            </Group>

            <Group label="Which contacts">
              <div style={{ display: 'flex', gap: 6 }}>
                <select
                  value={filterState}
                  onChange={(e) => {
                    setFilterState(e.target.value)
                    setFilterCity('')
                  }}
                  style={{ ...dropdownStyle(!!filterState), flex: 0.7 }}
                >
                  <option value="">All states</option>
                  {states.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select
                  value={filterCity}
                  onChange={(e) => setFilterCity(e.target.value)}
                  style={{ ...dropdownStyle(!!filterCity), flex: 1.3, minWidth: 0 }}
                >
                  <option value="">All cities</option>
                  {cities.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  style={{ ...dropdownStyle(!!filterType), flex: 1.4, minWidth: 0 }}
                >
                  <option value="">Everyone</option>
                  <option value="customer">Customers only</option>
                  <option value="old_customer">Old customers only</option>
                  <option value="goods_shown">Goods shown</option>
                  <option value="not_visited">Not visited yet</option>
                </select>
                <select
                  value={minStars}
                  onChange={(e) => setMinStars(Number(e.target.value))}
                  style={{ ...dropdownStyle(minStars > 0), flex: 0.9 }}
                >
                  <option value={0}>Any stars</option>
                  <option value={2}>2★ and up</option>
                  <option value={3}>3★ and up</option>
                  <option value={4}>4★ only</option>
                </select>
              </div>
            </Group>

            <Group label="Trip shape">
              <SliderRow
                label="Search radius"
                value={options.radiusMiles}
                min={5}
                max={250}
                step={5}
                format={(v) => `${v} mi`}
                onChange={(radiusMiles) => setOptions((o) => ({ ...o, radiusMiles }))}
              />
              <SliderRow
                label="Stops to visit"
                value={options.maxStops}
                min={2}
                max={20}
                step={1}
                format={(v) => `${v}`}
                onChange={(maxStops) => setOptions((o) => ({ ...o, maxStops }))}
              />
              <SliderRow
                label="Time at each stop"
                value={options.minutesPerStop}
                min={0}
                max={120}
                step={5}
                format={(v) => (v === 0 ? 'none' : `${v} min`)}
                onChange={(minutesPerStop) => setOptions((o) => ({ ...o, minutesPerStop }))}
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <select
                  value={options.priority}
                  onChange={(e) => setOptions((o) => ({ ...o, priority: e.target.value as TripOptions['priority'] }))}
                  style={{ ...dropdownStyle(options.priority !== 'none'), flex: 1.4, minWidth: 0 }}
                >
                  <option value="none">No preference</option>
                  <option value="customers">Favour customers</option>
                  <option value="top-rated">Favour top-rated</option>
                </select>
                <SegButton
                  active={options.roundTrip}
                  onClick={() => setOptions((o) => ({ ...o, roundTrip: !o.roundTrip }))}
                  icon={options.roundTrip
                    ? <Check className="size-3.5 shrink-0" aria-hidden />
                    : <Flag className="size-3.5 shrink-0" aria-hidden />}
                  label="Round trip"
                />
              </div>
            </Group>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => void run()}
                disabled={working}
                style={{
                  flex: 1, padding: '13px 16px', borderRadius: 12, border: 'none',
                  background: working ? 'var(--bg4)' : 'var(--accent)',
                  color: working ? 'var(--text3)' : '#fff',
                  fontSize: 15, fontWeight: 800,
                  cursor: working ? 'default' : 'pointer',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                {working
                  ? <><Loader2 className="size-4 animate-spin" aria-hidden />Planning…</>
                  : <><Route className="size-4 shrink-0" aria-hidden />Plan my route</>}
              </button>
              {working && (
                <button
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                  style={{
                    padding: '13px 16px', borderRadius: 12, cursor: 'pointer',
                    border: '1.5px solid var(--danger)', background: 'transparent',
                    color: 'var(--danger)', fontSize: 14, fontWeight: 800,
                  }}
                >
                  Stop
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {working && <ProgressBanner progress={progress} />}

      {error && (
        <div style={{
          margin: '12px 16px', padding: '12px 14px', borderRadius: 12,
          background: 'var(--chip-danger-bg)', color: 'var(--chip-danger-fg)',
          fontSize: 13, fontWeight: 600, display: 'flex', gap: 9, alignItems: 'flex-start',
        }}>
          <TriangleAlert className="size-4 shrink-0" style={{ marginTop: 1 }} aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {!plan && !working && !error && <EmptyState hasContacts={contacts.length > 0} />}

      {plan && (
        <PlanView
          plan={plan}
          excludedCount={excluded.length}
          busy={working}
          onOpenContact={setDetailContactId}
          onRemoveStop={removeStop}
          onRestoreRemoved={restoreRemoved}
          onReplan={() => void run({ origin: lastOrigin ?? undefined })}
          onCopy={() => void copyPlan()}
        />
      )}
    </div>
  )
}

function ProgressBanner({ progress }: { progress: TripProgress | null }) {
  const phaseLabel = progress?.phase === 'scanning'
    ? 'Checking which areas are in range'
    : progress?.phase === 'locating'
      ? 'Pinning addresses on the map'
      : 'Working out the best order'

  const pct = progress && progress.total > 0
    ? Math.round((progress.done / progress.total) * 100)
    : null

  return (
    <div style={{ padding: '14px 16px', background: 'var(--bg2)', borderBottom: '1px solid var(--border2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Loader2 className="size-4 animate-spin shrink-0" style={{ color: 'var(--accent)' }} aria-hidden />
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{phaseLabel}</div>
        {pct !== null && (
          <div style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: 'var(--text3)' }}>
            {progress!.done}/{progress!.total}
          </div>
        )}
      </div>
      <div style={{ height: 6, borderRadius: 99, background: 'var(--bg4)', overflow: 'hidden' }}>
        <div style={{
          width: `${pct ?? 15}%`, height: '100%', borderRadius: 99,
          background: 'var(--accent)', transition: 'width 0.25s ease',
        }} />
      </div>
      {progress?.label && (
        <div style={{
          fontSize: 11, color: 'var(--text3)', marginTop: 7,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {progress.label}
        </div>
      )}
      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
        Addresses are looked up one at a time to stay within the map service limits. Results are
        saved, so planning the same area again is fast.
      </div>
    </div>
  )
}

function EmptyState({ hasContacts }: { hasContacts: boolean }) {
  return (
    <div style={{ textAlign: 'center', padding: '56px 28px', color: 'var(--text3)' }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14, color: 'var(--text3)' }}>
        <Route size={44} strokeWidth={1.25} aria-hidden />
      </div>
      <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text2)', marginBottom: 8 }}>
        {hasContacts ? 'Plan a day of visits' : 'No contacts yet'}
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.55, maxWidth: 320, margin: '0 auto' }}>
        {hasContacts
          ? 'Pick where you are starting from, how far you will travel and how many stores you want to see. You get the stops in driving order with a Maps link for each leg.'
          : 'Scan some cards first — the planner routes between the addresses you have saved.'}
      </div>
    </div>
  )
}

function PlanView({
  plan, excludedCount, busy, onOpenContact, onRemoveStop, onRestoreRemoved, onReplan, onCopy,
}: {
  plan: TripPlan
  excludedCount: number
  busy: boolean
  onOpenContact: (id: string) => void
  onRemoveStop: (id: string) => void
  onRestoreRemoved: () => void
  onReplan: () => void
  onCopy: () => void
}) {
  const mapsLinks = useMemo(() => buildMapsLinks(plan), [plan])
  const dayMinutes = plan.driveMinutes + plan.visitMinutes
  const approximateCount = plan.stops.filter((s) => s.approximate).length

  return (
    <div>
      <div style={{ padding: '14px 16px 10px', background: 'var(--bg)' }}>
        <div style={{
          background: 'var(--bg2)', borderRadius: 16, padding: 16,
          border: '1px solid var(--border2)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <Navigation className="size-4 shrink-0" style={{ color: 'var(--accent)' }} aria-hidden />
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', flex: 1, minWidth: 0 }}>
              {plan.stops.length} stop{plan.stops.length === 1 ? '' : 's'} from {plan.origin.label}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <Stat icon={<Car className="size-3.5" aria-hidden />} value={formatMiles(plan.totalMiles)} label="driving" />
            <Stat icon={<Timer className="size-3.5" aria-hidden />} value={formatDuration(plan.driveMinutes)} label="on the road" />
            <Stat icon={<Flag className="size-3.5" aria-hidden />} value={formatDuration(dayMinutes)} label="whole day" />
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
            <Chip
              tone={plan.costSource === 'road' ? 'success' : 'warning'}
              icon={plan.costSource === 'road'
                ? <Check className="size-3 shrink-0" aria-hidden />
                : <Info className="size-3 shrink-0" aria-hidden />}
              text={plan.costSource === 'road' ? 'Real driving times' : 'Estimated times'}
            />
            {plan.roundTrip && (
              <Chip tone="info" icon={<RefreshCw className="size-3 shrink-0" aria-hidden />} text="Returns to start" />
            )}
            {approximateCount > 0 && (
              <Chip
                tone="warning"
                icon={<MapPin className="size-3 shrink-0" aria-hidden />}
                text={`${approximateCount} approximate pin${approximateCount === 1 ? '' : 's'}`}
              />
            )}
            {dayMinutes > LONG_DAY_MINUTES && (
              <Chip tone="danger" icon={<TriangleAlert className="size-3 shrink-0" aria-hidden />} text="Long day" />
            )}
          </div>

          {plan.skipped.overCap > 0 && (
            <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 12, lineHeight: 1.5 }}>
              {plan.skipped.overCap} more contact{plan.skipped.overCap === 1 ? '' : 's'} in range didn't fit
              the {plan.stops.length}-stop limit. Raise "Stops to visit" to include more.
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: '0 16px 12px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={onCopy} style={secondaryButtonStyle()}>
          <Copy className="size-3.5 shrink-0" aria-hidden />
          Copy list
        </button>
        <button type="button" onClick={onReplan} disabled={busy} style={secondaryButtonStyle(busy)}>
          <RefreshCw className="size-3.5 shrink-0" aria-hidden />
          Re-plan
        </button>
        {excludedCount > 0 && (
          <button type="button" onClick={onRestoreRemoved} disabled={busy} style={secondaryButtonStyle(busy)}>
            <X className="size-3.5 shrink-0" aria-hidden />
            Restore {excludedCount} removed
          </button>
        )}
      </div>

      <SectionLabel>The route</SectionLabel>

      <OriginRow label={plan.origin.label} />

      {plan.stops.map((stop, index) => (
        <StopRow
          key={stop.contact.id}
          stop={stop}
          index={index}
          busy={busy}
          onOpen={() => onOpenContact(stop.contact.id)}
          onRemove={() => onRemoveStop(stop.contact.id)}
        />
      ))}

      {plan.roundTrip && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
          background: 'var(--bg2)', borderBottom: '1px solid var(--border2)',
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
            background: 'var(--action-neutral-bg)', color: 'var(--action-neutral-fg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Flag className="size-3.5" aria-hidden />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text2)' }}>
              Back to {plan.origin.label}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 1 }}>
              {formatMiles(plan.returnMiles)} · {formatDuration(plan.returnMinutes)}
            </div>
          </div>
        </div>
      )}

      {mapsLinks.length > 0 && (
        <>
          <SectionLabel>Open in Google Maps</SectionLabel>
          <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {mapsLinks.map((link, index) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '12px 14px', borderRadius: 12,
                  background: 'var(--chip-accent-bg)', color: 'var(--accent)',
                  border: '1.5px solid var(--accent)',
                  fontSize: 13, fontWeight: 800, textDecoration: 'none',
                }}
              >
                <ExternalLink className="size-4 shrink-0" aria-hidden />
                <span style={{ flex: 1, minWidth: 0 }}>
                  {mapsLinks.length > 1 ? `Leg ${index + 1}: ` : ''}{link.label}
                </span>
              </a>
            ))}
            <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.5, padding: '2px 2px 0' }}>
              {mapsLinks.length > 1
                ? 'Google Maps caps the stops per link, so the day is split into legs that pick up where the last one ended.'
                : 'Opens the full route with every stop as a waypoint.'}
            </div>
          </div>
        </>
      )}

      <SkippedNote plan={plan} />
    </div>
  )
}

function OriginRow({ label }: { label: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
      background: 'var(--bg2)', borderBottom: '1px solid var(--border2)',
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
        background: 'var(--chip-success-bg)', color: 'var(--chip-success-fg)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Crosshair className="size-3.5" aria-hidden />
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text2)' }}>
        Start · {label}
      </div>
    </div>
  )
}

function StopRow({ stop, index, busy, onOpen, onRemove }: {
  stop: TripStop
  index: number
  busy: boolean
  onOpen: () => void
  onRemove: () => void
}) {
  const { contact } = stop
  const name = contact.company || contact.name || 'Unknown'
  const address = stopAddressText(stop)
  const phone = contact.phone_mobile || contact.phone_work

  return (
    <div style={{
      display: 'flex', gap: 12, padding: '12px 16px',
      background: 'var(--bg2)', borderBottom: '1px solid var(--border2)',
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
        background: 'var(--accent)', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, fontWeight: 800,
      }}>
        {index + 1}
      </div>

      <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={onOpen}>
        <div style={{
          fontSize: 15, fontWeight: 700, color: 'var(--text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {name}
        </div>
        {contact.name && contact.company && (
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 1 }}>{contact.name}</div>
        )}
        {address && (
          <div style={{ fontSize: 12.5, color: 'var(--text2)', marginTop: 3, lineHeight: 1.4 }}>
            {address}
          </div>
        )}
        {phone && (
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{phone}</div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 7 }}>
          <Chip
            tone="info"
            icon={<Car className="size-3 shrink-0" aria-hidden />}
            text={`${formatMiles(stop.legMiles)} · ${formatDuration(stop.legMinutes)}`}
          />
          <Chip
            tone="neutral"
            icon={<Timer className="size-3 shrink-0" aria-hidden />}
            text={`arrive ~${formatDuration(stop.arriveAfterMinutes)} in`}
          />
          {stop.approximate && (
            <Chip tone="warning" icon={<MapPin className="size-3 shrink-0" aria-hidden />} text="approx" />
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={onRemove}
        disabled={busy}
        title="Remove this stop and re-plan"
        aria-label={`Remove ${name} from the route`}
        style={{
          width: 32, height: 32, borderRadius: 10, flexShrink: 0, alignSelf: 'flex-start',
          border: 'none', background: 'var(--bg3)', color: 'var(--text3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1,
        }}
      >
        <Trash2 className="size-4" aria-hidden />
      </button>
    </div>
  )
}

function SkippedNote({ plan }: { plan: TripPlan }) {
  const parts: string[] = []
  if (plan.skipped.outOfRadius > 0) parts.push(`${plan.skipped.outOfRadius} outside the radius`)
  if (plan.skipped.noAddress > 0) parts.push(`${plan.skipped.noAddress} with no address saved`)
  if (plan.skipped.unresolved > 0) parts.push(`${plan.skipped.unresolved} whose address couldn't be found on the map`)
  if (parts.length === 0) return null

  return (
    <div style={{
      margin: '18px 16px 0', padding: '12px 14px', borderRadius: 12,
      background: 'var(--bg2)', border: '1px solid var(--border2)',
      fontSize: 11.5, color: 'var(--text3)', lineHeight: 1.55,
      display: 'flex', gap: 9, alignItems: 'flex-start',
    }}>
      <Info className="size-3.5 shrink-0" style={{ marginTop: 1 }} aria-hidden />
      <span>Left out: {parts.join(', ')}.</span>
    </div>
  )
}

// ─── Small building blocks ──────────────────────────────────────────────────

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div style={{
        fontSize: 11, fontWeight: 700, color: 'var(--text3)',
        textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 7,
      }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{
      fontSize: 12, fontWeight: 600, color: 'var(--text3)',
      padding: '16px 16px 6px', textTransform: 'uppercase',
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

function SliderRow({ label, value, min, max, step, format, onChange }: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (value: number) => string
  onChange: (value: number) => void
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)' }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--accent)' }}>{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
      />
    </div>
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
      <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>{value}</div>
    </div>
  )
}

type ChipTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

function Chip({ tone, icon, text }: { tone: ChipTone; icon: ReactNode; text: string }) {
  const palette: Record<ChipTone, { bg: string; fg: string }> = {
    success: { bg: 'var(--chip-success-bg)', fg: 'var(--chip-success-fg)' },
    warning: { bg: 'var(--chip-warning-bg)', fg: 'var(--chip-warning-fg)' },
    danger: { bg: 'var(--chip-danger-bg)', fg: 'var(--chip-danger-fg)' },
    info: { bg: 'var(--chip-info-bg)', fg: 'var(--chip-info-fg)' },
    neutral: { bg: 'var(--action-neutral-bg)', fg: 'var(--action-neutral-fg)' },
  }
  const { bg, fg } = palette[tone]

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

function secondaryButtonStyle(disabled = false): CSSProperties {
  return {
    padding: '9px 14px', borderRadius: 999,
    border: '1.5px solid var(--border)', background: 'var(--bg2)',
    color: 'var(--text2)', fontSize: 12.5, fontWeight: 800,
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
    display: 'inline-flex', alignItems: 'center', gap: 6,
  }
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
