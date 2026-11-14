import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  ExternalLink,
  Loader2,
  MapPin,
  Maximize2,
  Minimize2,
  Navigation,
  Flag,
  Search,
  X,
} from 'lucide-react'
import type { Contact } from '../types/contact'
import { useStore } from '../store/useStore'
import {
  googleMapsSearchUrl,
  resolveCustomerMapPins,
  type CustomerMapPin,
} from '../lib/customerMapPins'

export type TripMapFilter = 'all' | 'customer' | 'prospect'

const CUSTOMER_COLOR = '#34c759'
const PROSPECT_COLOR = '#ff9500'
const HIGHLIGHT_COLOR = '#007aff'

export interface TripMapPick {
  label: string
  point: { lat: number; lng: number }
  contactId: string
  address: string
}

interface Props {
  contacts: Contact[]
  /** Embedded half-height vs full takeover. */
  expanded: boolean
  onToggleExpand: () => void
  onOpenContact: (id: string) => void
  /** When set, pin sheet offers “Use as destination”. */
  onPickDestination?: (pick: TripMapPick) => void
  /** When set, pin sheet offers “Start from here”. */
  onPickStart?: (pick: TripMapPick) => void
  /** Planned stop ids — drawn thicker / blue ring. */
  highlightIds?: Set<string>
  filter: TripMapFilter
  onFilterChange: (filter: TripMapFilter) => void
  /** Desktop side panel uses fill height; mobile uses fraction. */
  fill?: boolean
  /** When false the panel may be CSS-hidden; remount is avoided but size must refresh. */
  active?: boolean
  /** Phone Trips: thinner chrome so the map itself gets ~half the screen. */
  compact?: boolean
}

export function TripMapPanel({
  contacts,
  expanded,
  onToggleExpand,
  onOpenContact,
  onPickDestination,
  onPickStart,
  highlightIds,
  filter,
  onFilterChange,
  fill = false,
  active = true,
  compact = false,
}: Props) {
  const mapEl = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const fittedRef = useRef(false)
  const contactsRef = useRef(contacts)
  contactsRef.current = contacts

  const [pins, setPins] = useState<CustomerMapPin[]>([])
  const [loading, setLoading] = useState(true)
  const [refining, setRefining] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null)
  const [selected, setSelected] = useState<CustomerMapPin | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const detailContactId = useStore((s) => s.detailContactId)

  // Only re-resolve when the contact set actually changes — not on every
  // store tick (visited flags, etc.) which would abort mid-geocode forever.
  const contactKey = useMemo(
    () => `${contacts.length}:${contacts[0]?.id ?? ''}:${contacts[contacts.length - 1]?.id ?? ''}`,
    [contacts],
  )

  const visible = useMemo(() => {
    let list = filter === 'all' ? pins : pins.filter((p) => p.kind === filter)
    const q = query.trim().toLowerCase()
    if (q) {
      list = list.filter((p) => (
        p.label.toLowerCase().includes(q)
        || p.address.toLowerCase().includes(q)
        || p.city.toLowerCase().includes(q)
        || p.state.toLowerCase().includes(q)
      ))
    }
    return list
  }, [pins, filter, query])

  const searchHits = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    return visible.slice(0, 8)
  }, [query, visible])

  const counts = useMemo(() => {
    let customer = 0
    let prospect = 0
    let exact = 0
    for (const p of pins) {
      if (p.kind === 'customer') customer++
      else prospect++
      if (!p.approximate) exact++
    }
    return { customer, prospect, all: pins.length, exact }
  }, [pins])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setRefining(false)
    setError('')
    fittedRef.current = false

    void (async () => {
      try {
        await resolveCustomerMapPins(contactsRef.current, controller.signal, {
          onProgress: (done, total, label) => setProgress({ done, total, label }),
          onUpdate: (next) => {
            if (controller.signal.aborted) return
            setPins(next)
            setLoading(false)
            setRefining(true)
          },
        })
        if (controller.signal.aborted) return
        setRefining(false)
        setProgress(null)
      } catch (err) {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : 'Could not build the map')
        setLoading(false)
        setRefining(false)
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
          setRefining(false)
          setProgress(null)
        }
      }
    })()

    return () => controller.abort()
  }, [contactKey])

  useEffect(() => {
    if (!pins.length && !loading) {
      setError('No contacts have an address we can place on the map.')
    } else if (pins.length) {
      setError('')
    }
  }, [pins.length, loading])

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return
    const map = L.map(mapEl.current, {
      zoomControl: true,
      attributionControl: true,
    }).setView([39.5, -98.35], 4)

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map)

    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    const t = window.setTimeout(() => map.invalidateSize(), 80)
    return () => {
      window.clearTimeout(t)
      map.remove()
      mapRef.current = null
      layerRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const t = window.setTimeout(() => map.invalidateSize(), 180)
    return () => window.clearTimeout(t)
  }, [expanded, fill, active, compact, detailContactId])

  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return

    layer.clearLayers()
    if (!visible.length) return

    const bounds = L.latLngBounds([])
    for (const pin of visible) {
      const highlighted = highlightIds?.has(pin.contactId)
      const marker = L.circleMarker([pin.point.lat, pin.point.lng], {
        radius: highlighted ? 10 : pin.kind === 'customer' ? 8 : 7,
        color: highlighted ? HIGHLIGHT_COLOR : '#fff',
        weight: highlighted ? 2.5 : 1.5,
        fillColor: pin.kind === 'customer' ? CUSTOMER_COLOR : PROSPECT_COLOR,
        fillOpacity: pin.approximate ? 0.7 : 0.95,
      })
      marker.bindTooltip(pin.label, { direction: 'top', opacity: 0.95 })
      marker.on('click', () => setSelected(pin))
      marker.addTo(layer)
      bounds.extend([pin.point.lat, pin.point.lng])
    }

    if (bounds.isValid() && !fittedRef.current) {
      map.fitBounds(bounds.pad(0.12), { maxZoom: 11, animate: true })
      fittedRef.current = true
    }
    window.setTimeout(() => map.invalidateSize(), 30)
  }, [visible, highlightIds])

  const focusPin = (pin: CustomerMapPin) => {
    setSelected(pin)
    setQuery(pin.label)
    mapRef.current?.flyTo([pin.point.lat, pin.point.lng], 12, { duration: 0.6 })
  }

  const shellStyle: CSSProperties = expanded
    ? {
        position: 'fixed', inset: 0, zIndex: 85,
        display: 'flex', flexDirection: 'column', background: 'var(--bg)',
      }
    : fill
      ? {
          position: 'relative', height: '100%', minHeight: 0,
          display: 'flex', flexDirection: 'column',
          borderRight: '1px solid var(--border2)', background: 'var(--bg2)',
        }
      : {
          position: 'relative', height: '100%', minHeight: 0,
          display: 'flex', flexDirection: 'column',
          borderBottom: '1px solid var(--border2)', background: 'var(--bg2)',
        }

  const statusText = loading
    ? (progress ? `Placing… ${progress.done}/${progress.total}` : 'Placing pins…')
    : refining
      ? `Refining ${counts.exact}/${counts.all}`
      : `${visible.length}${query.trim() ? ` match` : ''} · tap pin`

  return (
    <div style={shellStyle}>
      <div style={{
        padding: compact ? '5px 8px' : '8px 12px',
        borderBottom: '1px solid var(--border2)',
        display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
        background: 'var(--bg2)',
      }}>
        <MapPin className="size-3.5 shrink-0" style={{ color: 'var(--accent)' }} aria-hidden />
        <div style={{
          flex: 1, minWidth: 0,
          fontSize: compact ? 11.5 : 12.5, fontWeight: 750, color: 'var(--text2)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {statusText}
        </div>
        <button
          type="button"
          onClick={onToggleExpand}
          aria-label={expanded ? 'Minimize map' : 'Maximize map'}
          style={{ ...iconBtnStyle, width: compact ? 28 : 30, height: compact ? 28 : 30 }}
        >
          {expanded
            ? <Minimize2 className="size-3.5" aria-hidden />
            : <Maximize2 className="size-3.5" aria-hidden />}
        </button>
      </div>

      <div style={{
        display: 'flex', gap: compact ? 4 : 6,
        padding: compact ? '5px 8px' : '8px 10px',
        flexShrink: 0,
        overflowX: 'auto', borderBottom: '1px solid var(--border2)',
      }}>
        <FilterChip
          active={filter === 'all'}
          label={compact ? `All ${counts.all}` : `All (${counts.all})`}
          compact={compact}
          onClick={() => onFilterChange('all')}
        />
        <FilterChip
          active={filter === 'customer'}
          label={compact ? `Cust ${counts.customer}` : `Customers (${counts.customer})`}
          color={CUSTOMER_COLOR}
          compact={compact}
          onClick={() => onFilterChange('customer')}
        />
        <FilterChip
          active={filter === 'prospect'}
          label={compact ? `Non ${counts.prospect}` : `Non-customers (${counts.prospect})`}
          color={PROSPECT_COLOR}
          compact={compact}
          onClick={() => onFilterChange('prospect')}
        />
      </div>

      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {/* Search floats on the map so the tile area stays large on phones. */}
        <div style={{
          position: 'absolute', left: 8, right: compact ? 52 : 8, top: 8, zIndex: 550,
        }}>
          <div style={{ position: 'relative' }}>
            <Search
              className="size-3.5"
              style={{
                position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
                color: 'var(--text3)', pointerEvents: 'none',
              }}
              aria-hidden
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search shop, city…"
              aria-label="Search map pins"
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: compact ? '7px 30px 7px 28px' : '9px 34px 9px 32px',
                borderRadius: 10,
                border: '1.5px solid var(--border)',
                background: 'var(--bg2)',
                color: 'var(--text)',
                fontSize: compact ? 12.5 : 13,
                fontWeight: 600,
                boxShadow: '0 4px 14px rgba(0,0,0,0.22)',
              }}
            />
            {query.trim() && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                style={{
                  position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
                  ...iconBtnStyle, width: 24, height: 24,
                }}
              >
                <X className="size-3" aria-hidden />
              </button>
            )}
          </div>
          {searchHits.length > 0 && query.trim().length >= 2 && (
            <div style={{
              marginTop: 4, borderRadius: 12, overflow: 'hidden',
              background: 'var(--bg2)', border: '1px solid var(--border)',
              boxShadow: '0 12px 28px rgba(0,0,0,0.35)',
              maxHeight: compact ? 160 : 220, overflowY: 'auto',
            }}>
              {searchHits.map((pin) => (
                <button
                  key={pin.id}
                  type="button"
                  onClick={() => focusPin(pin)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '9px 11px', border: 'none', borderBottom: '1px solid var(--border2)',
                    background: 'transparent', cursor: 'pointer', color: 'var(--text)',
                  }}
                >
                  <div style={{ fontSize: 12.5, fontWeight: 750 }}>{pin.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                    {pin.kind === 'customer' ? 'Customer' : 'Non-customer'}
                    {pin.city ? ` · ${pin.city}${pin.state ? `, ${pin.state}` : ''}` : ''}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div ref={mapEl} style={{ position: 'absolute', inset: 0 }} />

        {loading && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 500,
            background: 'rgba(0,0,0,0.28)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 10,
          }}>
            <Loader2 className="size-5 animate-spin" style={{ color: 'var(--accent)' }} aria-hidden />
            <div style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>
              {progress ? `${progress.done} / ${progress.total}` : 'Starting…'}
            </div>
          </div>
        )}

        {refining && !loading && (
          <div style={{
            position: 'absolute', left: 8, right: 8, top: compact ? 46 : 52, zIndex: 500,
            padding: compact ? '5px 8px' : '7px 10px', borderRadius: 10,
            fontSize: compact ? 10.5 : 11.5, fontWeight: 700,
            background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text2)',
            display: 'flex', alignItems: 'center', gap: 7,
          }}>
            <Loader2 className="size-3.5 animate-spin" style={{ color: 'var(--accent)' }} aria-hidden />
            Improving accuracy{progress ? ` · ${progress.done}/${progress.total}` : ''}
          </div>
        )}

        {error && !loading && (
          <div style={{
            position: 'absolute', left: 8, right: 8, top: compact ? 46 : 52, zIndex: 500,
            padding: '10px 12px', borderRadius: 10, fontSize: 12, fontWeight: 650,
            background: 'var(--chip-danger-bg)', color: 'var(--chip-danger-fg)',
          }}>
            {error}
          </div>
        )}

        {selected && (
          <div style={{
            position: 'absolute', left: 10, right: 10, bottom: 10, zIndex: 500,
            background: 'var(--bg2)', borderRadius: 14, padding: 12,
            border: '1px solid var(--border)',
            boxShadow: '0 10px 28px rgba(0,0,0,0.28)',
          }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{selected.label}</div>
            <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 3, lineHeight: 1.4 }}>
              {selected.kind === 'customer' ? 'Customer' : 'Non-customer'}
              {selected.approximate ? ' · city pin' : ' · street pin'}
              {selected.address ? ` · ${selected.address}` : ''}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
              {onPickDestination && (
                <button
                  type="button"
                  onClick={() => {
                    onPickDestination({
                      label: selected.address
                        ? `${selected.label} — ${selected.address}`
                        : selected.label,
                      point: selected.point,
                      contactId: selected.contactId,
                      address: selected.address,
                    })
                    setSelected(null)
                    if (expanded) onToggleExpand()
                  }}
                  style={actionBtn(true)}
                >
                  <Flag className="size-3.5 shrink-0" aria-hidden />
                  Set destination
                </button>
              )}
              {onPickStart && (
                <button
                  type="button"
                  onClick={() => {
                    onPickStart({
                      label: selected.address
                        ? `${selected.label} — ${selected.address}`
                        : selected.label,
                      point: selected.point,
                      contactId: selected.contactId,
                      address: selected.address,
                    })
                    setSelected(null)
                    if (expanded) onToggleExpand()
                  }}
                  style={actionBtn(false)}
                >
                  <Navigation className="size-3.5 shrink-0" aria-hidden />
                  Start here
                </button>
              )}
              <button
                type="button"
                onClick={() => onOpenContact(selected.contactId)}
                style={actionBtn(false)}
              >
                Business card
              </button>
              <a
                href={googleMapsSearchUrl(selected)}
                target="_blank"
                rel="noreferrer"
                style={{ ...actionBtn(false), textDecoration: 'none' }}
              >
                <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                Directions
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function FilterChip({
  active, label, color, onClick, compact,
}: {
  active: boolean
  label: string
  color?: string
  onClick: () => void
  compact?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flexShrink: 0,
        padding: compact ? '4px 8px' : '6px 10px',
        borderRadius: 99, cursor: 'pointer',
        fontSize: compact ? 11 : 11.5, fontWeight: 750, whiteSpace: 'nowrap',
        border: `1.5px solid ${active ? (color || 'var(--accent)') : 'var(--border)'}`,
        background: active ? 'var(--chip-accent-bg)' : 'var(--bg3)',
        color: active ? (color || 'var(--accent)') : 'var(--text2)',
        display: 'inline-flex', alignItems: 'center', gap: 5,
      }}
    >
      {color && <span style={{ width: 7, height: 7, borderRadius: 99, background: color }} />}
      {label}
    </button>
  )
}

const iconBtnStyle: CSSProperties = {
  width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg3)', color: 'var(--text2)', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}

function actionBtn(primary: boolean): CSSProperties {
  return {
    padding: '8px 10px', borderRadius: 10, cursor: 'pointer',
    border: primary ? 'none' : '1.5px solid var(--border)',
    background: primary ? 'var(--accent)' : 'var(--bg3)',
    color: primary ? '#fff' : 'var(--text)',
    fontSize: 12, fontWeight: 800,
    display: 'inline-flex', alignItems: 'center', gap: 5,
  }
}
