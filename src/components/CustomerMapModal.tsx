import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { ExternalLink, Loader2, MapPin, X } from 'lucide-react'
import type { Contact } from '../types/contact'
import { useStore } from '../store/useStore'
import {
  googleMapsSearchUrl,
  resolveCustomerMapPins,
  type CustomerMapPin,
} from '../lib/customerMapPins'

type Filter = 'all' | 'customer' | 'prospect'

const CUSTOMER_COLOR = '#34c759'
const PROSPECT_COLOR = '#ff9500'

interface Props {
  contacts: Contact[]
  onClose: () => void
  /** Opens the contact card; map stays mounted underneath so Back returns here. */
  onOpenContact: (id: string) => void
}

export function CustomerMapModal({ contacts, onClose, onOpenContact }: Props) {
  const mapEl = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const fittedRef = useRef(false)

  const [pins, setPins] = useState<CustomerMapPin[]>([])
  const [loading, setLoading] = useState(true)
  const [refining, setRefining] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
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

  // Progressive geocode: city pins first, then street refinement.
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
            // First paint with any pins → drop the blocking overlay so the
            // user can already browse while streets keep refining.
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
    }
  }, [pins.length, loading])

  // Init map once
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

    const t = window.setTimeout(() => map.invalidateSize(), 50)
    return () => {
      window.clearTimeout(t)
      map.remove()
      mapRef.current = null
      layerRef.current = null
    }
  }, [])

  // Redraw markers when the filtered set changes (including street refinements).
  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return

    layer.clearLayers()
    if (!visible.length) return

    const bounds = L.latLngBounds([])
    for (const pin of visible) {
      const marker = L.circleMarker([pin.point.lat, pin.point.lng], {
        radius: pin.kind === 'customer' ? 9 : 7,
        color: '#fff',
        weight: 1.5,
        fillColor: pin.kind === 'customer' ? CUSTOMER_COLOR : PROSPECT_COLOR,
        fillOpacity: pin.approximate ? 0.7 : 0.95,
      })
      marker.bindTooltip(pin.label, { direction: 'top', opacity: 0.95 })
      marker.on('click', () => {
        setSelected(pin)
        // Open the business card; map stays mounted (z-index below ContactDetail).
        onOpenContact(pin.contactId)
      })
      marker.addTo(layer)
      bounds.extend([pin.point.lat, pin.point.lng])
    }

    if (bounds.isValid() && !fittedRef.current) {
      map.fitBounds(bounds.pad(0.12), { maxZoom: 12, animate: true })
      fittedRef.current = true
    }
    window.setTimeout(() => map.invalidateSize(), 30)
  }, [visible, onOpenContact])

  // When the business card closes, refresh Leaflet layout so the map is usable again.
  useEffect(() => {
    if (detailContactId) return
    const map = mapRef.current
    if (!map) return
    const t = window.setTimeout(() => map.invalidateSize(), 220)
    return () => window.clearTimeout(t)
  }, [detailContactId])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Customer map"
      style={{
        position: 'fixed', inset: 0, zIndex: 90,
        background: 'var(--bg)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      <div style={{
        padding: '12px 14px', borderBottom: '1px solid var(--border2)',
        display: 'flex', alignItems: 'center', gap: 10,
        background: 'var(--bg2)',
      }}>
        <MapPin className="size-4 shrink-0" style={{ color: 'var(--accent)' }} aria-hidden />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>Customer map</div>
          <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 1 }}>
            {loading
              ? 'Placing pins…'
              : refining
                ? `Refining addresses… ${counts.exact}/${counts.all} street-level`
                : `${visible.length} shown · tap a pin for the business card · green = customer`}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close map"
          style={{
            width: 34, height: 34, borderRadius: 99, border: 'none',
            background: 'var(--bg3)', color: 'var(--text3)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <div style={{
        display: 'flex', gap: 6, padding: '10px 14px',
        borderBottom: '1px solid var(--border2)', background: 'var(--bg2)',
        overflowX: 'auto',
      }}>
        <FilterChip
          active={filter === 'all'}
          label={`All (${counts.all})`}
          onClick={() => setFilter('all')}
        />
        <FilterChip
          active={filter === 'customer'}
          label={`Customers (${counts.customer})`}
          color={CUSTOMER_COLOR}
          onClick={() => setFilter('customer')}
        />
        <FilterChip
          active={filter === 'prospect'}
          label={`Non-customers (${counts.prospect})`}
          color={PROSPECT_COLOR}
          onClick={() => setFilter('prospect')}
        />
      </div>

      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <div ref={mapEl} style={{ position: 'absolute', inset: 0 }} />

        {loading && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 500,
            background: 'rgba(0,0,0,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 24,
          }}>
            <div style={{
              background: 'var(--bg2)', borderRadius: 14, padding: '16px 18px',
              maxWidth: 280, width: '100%', border: '1px solid var(--border)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Loader2 className="size-4 animate-spin" style={{ color: 'var(--accent)' }} aria-hidden />
                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>
                  Pinning contacts
                </div>
              </div>
              {progress && (
                <>
                  <div style={{ height: 6, borderRadius: 99, background: 'var(--bg4)', overflow: 'hidden' }}>
                    <div style={{
                      width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 10}%`,
                      height: '100%', background: 'var(--accent)', borderRadius: 99,
                    }} />
                  </div>
                  <div style={{
                    fontSize: 11, color: 'var(--text3)', marginTop: 7,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {progress.done}/{progress.total} · {progress.label}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {refining && !loading && (
          <div style={{
            position: 'absolute', left: 12, right: 12, top: 12, zIndex: 500,
            padding: '8px 12px', borderRadius: 10,
            background: 'var(--bg2)', border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 12, fontWeight: 700, color: 'var(--text2)',
          }}>
            <Loader2 className="size-3.5 animate-spin shrink-0" style={{ color: 'var(--accent)' }} aria-hidden />
            Improving pin accuracy…
            {progress ? ` ${progress.done}/${progress.total}` : ''}
          </div>
        )}

        {error && !loading && (
          <div style={{
            position: 'absolute', left: 16, right: 16, top: 16, zIndex: 500,
            padding: '12px 14px', borderRadius: 12,
            background: 'var(--chip-danger-bg)', color: 'var(--chip-danger-fg)',
            fontSize: 13, fontWeight: 600,
          }}>
            {error}
          </div>
        )}

        {selected && (
          <div style={{
            position: 'absolute', left: 12, right: 12, bottom: 16, zIndex: 500,
            background: 'var(--bg2)', borderRadius: 14, padding: 14,
            border: '1px solid var(--border)',
            boxShadow: '0 10px 28px rgba(0,0,0,0.28)',
          }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div style={{
                width: 10, height: 10, borderRadius: 99, marginTop: 5, flexShrink: 0,
                background: selected.kind === 'customer' ? CUSTOMER_COLOR : PROSPECT_COLOR,
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>
                  {selected.label}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 3, lineHeight: 1.4 }}>
                  {selected.kind === 'customer' ? 'Customer' : 'Non-customer'}
                  {selected.approximate ? ' · approximating city' : ' · street address'}
                  {selected.address ? ` · ${selected.address}` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Dismiss"
                style={{
                  border: 'none', background: 'none', padding: 4, cursor: 'pointer',
                  color: 'var(--text3)',
                }}
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button
                type="button"
                onClick={() => onOpenContact(selected.contactId)}
                style={sheetBtnStyle(false)}
              >
                Open business card
              </button>
              <a
                href={googleMapsSearchUrl(selected)}
                target="_blank"
                rel="noreferrer"
                style={{ ...sheetBtnStyle(true), textDecoration: 'none' }}
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
        flexShrink: 0, padding: '7px 12px', borderRadius: 99, cursor: 'pointer',
        fontSize: 12.5, fontWeight: 750, whiteSpace: 'nowrap',
        border: `1.5px solid ${active ? (color || 'var(--accent)') : 'var(--border)'}`,
        background: active ? 'var(--chip-accent-bg)' : 'var(--bg3)',
        color: active ? (color || 'var(--accent)') : 'var(--text2)',
        display: 'inline-flex', alignItems: 'center', gap: 6,
      }}
    >
      {color && (
        <span style={{
          width: 8, height: 8, borderRadius: 99, background: color, flexShrink: 0,
        }} />
      )}
      {label}
    </button>
  )
}

function sheetBtnStyle(primary: boolean): CSSProperties {
  return {
    flex: 1, padding: '11px 12px', borderRadius: 11, cursor: 'pointer',
    border: primary ? 'none' : '1.5px solid var(--border)',
    background: primary ? 'var(--accent)' : 'var(--bg3)',
    color: primary ? '#fff' : 'var(--text)',
    fontSize: 13, fontWeight: 800,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  }
}
