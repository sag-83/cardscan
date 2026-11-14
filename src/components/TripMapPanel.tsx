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
}: Props) {
  const mapEl = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const fittedRef = useRef(false)

  const [pins, setPins] = useState<CustomerMapPin[]>([])
  const [loading, setLoading] = useState(true)
  const [refining, setRefining] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null)
  const [selected, setSelected] = useState<CustomerMapPin | null>(null)
  const [error, setError] = useState('')
  const detailContactId = useStore((s) => s.detailContactId)

  const visible = useMemo(() => {
    if (filter === 'all') return pins
    return pins.filter((p) => p.kind === filter)
  }, [pins, filter])

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
        await resolveCustomerMapPins(contacts, controller.signal, {
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
  }, [contacts])

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

  // Resize when expand/collapse or detail closes.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const t = window.setTimeout(() => map.invalidateSize(), 180)
    return () => window.clearTimeout(t)
  }, [expanded, fill, active, detailContactId])

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
          position: 'relative', height: '48vh', minHeight: 240, maxHeight: 480,
          display: 'flex', flexDirection: 'column',
          borderBottom: '1px solid var(--border2)', background: 'var(--bg2)',
        }

  return (
    <div style={shellStyle}>
      <div style={{
        padding: '8px 12px', borderBottom: '1px solid var(--border2)',
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
        background: 'var(--bg2)',
      }}>
        <MapPin className="size-3.5 shrink-0" style={{ color: 'var(--accent)' }} aria-hidden />
        <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 750, color: 'var(--text2)' }}>
          {loading
            ? 'Placing pins…'
            : refining
              ? `Refining… ${counts.exact}/${counts.all} street`
              : `${visible.length} pins · tap to plan`}
        </div>
        <button
          type="button"
          onClick={onToggleExpand}
          aria-label={expanded ? 'Minimize map' : 'Maximize map'}
          style={iconBtnStyle}
        >
          {expanded
            ? <Minimize2 className="size-3.5" aria-hidden />
            : <Maximize2 className="size-3.5" aria-hidden />}
        </button>
      </div>

      <div style={{
        display: 'flex', gap: 6, padding: '8px 10px', flexShrink: 0,
        overflowX: 'auto', borderBottom: '1px solid var(--border2)',
      }}>
        <FilterChip active={filter === 'all'} label={`All (${counts.all})`} onClick={() => onFilterChange('all')} />
        <FilterChip
          active={filter === 'customer'}
          label={`Customers (${counts.customer})`}
          color={CUSTOMER_COLOR}
          onClick={() => onFilterChange('customer')}
        />
        <FilterChip
          active={filter === 'prospect'}
          label={`Non-customers (${counts.prospect})`}
          color={PROSPECT_COLOR}
          onClick={() => onFilterChange('prospect')}
        />
      </div>

      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <div ref={mapEl} style={{ position: 'absolute', inset: 0 }} />

        {loading && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 500,
            background: 'rgba(0,0,0,0.28)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Loader2 className="size-5 animate-spin" style={{ color: 'var(--accent)' }} aria-hidden />
          </div>
        )}

        {refining && !loading && (
          <div style={{
            position: 'absolute', left: 10, right: 10, top: 10, zIndex: 500,
            padding: '7px 10px', borderRadius: 10, fontSize: 11.5, fontWeight: 700,
            background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text2)',
            display: 'flex', alignItems: 'center', gap: 7,
          }}>
            <Loader2 className="size-3.5 animate-spin" style={{ color: 'var(--accent)' }} aria-hidden />
            Improving accuracy{progress ? ` · ${progress.done}/${progress.total}` : ''}
          </div>
        )}

        {error && !loading && (
          <div style={{
            position: 'absolute', left: 10, right: 10, top: 10, zIndex: 500,
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
  active, label, color, onClick,
}: {
  active: boolean
  label: string
  color?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flexShrink: 0, padding: '6px 10px', borderRadius: 99, cursor: 'pointer',
        fontSize: 11.5, fontWeight: 750, whiteSpace: 'nowrap',
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
