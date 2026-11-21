import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  ExternalLink,
  Loader2,
  MapPin,
  Maximize2,
  Minimize2,
  Moon,
  Navigation,
  Flag,
  Plus,
  Search,
  Sun,
  X,
} from 'lucide-react'
import type { Contact } from '../types/contact'
import { useStore } from '../store/useStore'
import { useTheme } from '../hooks/useTheme'
import { geocodePlace } from '../lib/geocode'
import {
  googleMapsSearchUrl,
  resolveCustomerMapPins,
  type CustomerMapPin,
} from '../lib/customerMapPins'
import {
  buildBoundaryLayers,
  type BoundaryFilter,
} from '../lib/mapBoundaries'

export type TripMapFilter = 'all' | 'customer' | 'prospect'
/** Tap a pin to apply this role without opening the sheet first. */
export type TripMapTapMode = 'pick' | 'start' | 'end' | 'via'

const CUSTOMER_COLOR = '#34c759'
const PROSPECT_COLOR = '#ff9500'
const HIGHLIGHT_COLOR = '#007aff'
const START_COLOR = '#30d158'
const END_COLOR = '#ff453a'
const VIA_COLOR = '#bf5af2'

/** Distinct colors per itinerary day drawn on the map. */
export const TRIP_DAY_COLORS = [
  '#007aff', '#ff9500', '#34c759', '#af52de', '#ff2d55', '#5ac8fa', '#ffcc00', '#ff3b30',
]

export interface TripMapDayRoute {
  dayIndex: number
  label: string
  contactIds: string[]
}

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
  /** End / final destination for this hop. */
  onPickEnd?: (pick: TripMapPick) => void
  /** Start from here. */
  onPickStart?: (pick: TripMapPick) => void
  /** Toggle a shop into the manual “my picks” basket. */
  onPickVia?: (pick: TripMapPick) => void
  /** Planned stop ids — drawn thicker / blue ring. */
  highlightIds?: Set<string>
  /** Contact ids currently chosen as start / end / mid stops (map rings). */
  routeMarks?: { startId?: string | null; endId?: string | null; viaIds?: string[] }
  /** Shops the user added by hand (purple rings). */
  selectedStopIds?: Set<string>
  tapMode: TripMapTapMode
  onTapModeChange: (mode: TripMapTapMode) => void
  filter: TripMapFilter
  onFilterChange: (filter: TripMapFilter) => void
  /** Desktop side panel uses fill height; mobile uses fraction. */
  fill?: boolean
  /** When false the panel may be CSS-hidden; remount is avoided but size must refresh. */
  active?: boolean
  /** Phone Trips: thinner chrome so the map itself gets ~half the screen. */
  compact?: boolean
  /** Planned multi-day routes — colored polylines + day badges on the map. */
  dayRoutes?: TripMapDayRoute[]
  /**
   * Only auto-fit the camera when this token changes (e.g. new itinerary id).
   * Reorder / add / delete keep the live trail redraw without zooming out.
   */
  routeFitToken?: string
  /** State / city / area from trip setup — drawn as a map outline. */
  boundaryFilter?: BoundaryFilter
  /** Saved home — always shown as a home icon on the map. */
  homePlace?: { label: string; point?: { lat: number; lng: number } | null }
  /** Persist geocoded home coords back into trip settings. */
  onHomeResolved?: (point: { lat: number; lng: number }) => void
}

function toPick(pin: CustomerMapPin): TripMapPick {
  return {
    label: pin.label,
    point: pin.point,
    contactId: pin.contactId,
    address: pin.address,
  }
}

export function TripMapPanel({
  contacts,
  expanded,
  onToggleExpand,
  onOpenContact,
  onPickEnd,
  onPickStart,
  onPickVia,
  highlightIds,
  routeMarks,
  selectedStopIds,
  tapMode,
  onTapModeChange,
  filter,
  onFilterChange,
  fill = false,
  active = true,
  compact = false,
  dayRoutes = [],
  routeFitToken = '',
  boundaryFilter = { state: '', city: '', area: '' },
  homePlace,
  onHomeResolved,
}: Props) {
  const { theme, toggle: toggleTheme } = useTheme()
  const mapEl = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const routeLayerRef = useRef<L.LayerGroup | null>(null)
  const boundaryLayerRef = useRef<L.LayerGroup | null>(null)
  const homeLayerRef = useRef<L.LayerGroup | null>(null)
  const zoomCtrlRef = useRef<L.Control.Zoom | null>(null)
  const onHomeResolvedRef = useRef(onHomeResolved)
  onHomeResolvedRef.current = onHomeResolved
  const fittedRef = useRef(false)
  /** Only auto-fit the itinerary route once per route fingerprint — never fight user zoom. */
  const routeFitKeyRef = useRef<string>('')
  const boundaryFitKeyRef = useRef<string>('')
  const userInteractingRef = useRef(false)
  const contactsRef = useRef(contacts)
  contactsRef.current = contacts
  const tapModeRef = useRef(tapMode)
  tapModeRef.current = tapMode
  const pickRef = useRef({ onPickStart, onPickEnd, onPickVia, onToggleExpand, expanded })
  pickRef.current = { onPickStart, onPickEnd, onPickVia, onToggleExpand, expanded }

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
    // Zoom control bottom-right on all sizes — pinch alone was unreliable inside
    // the nested Trips scroll/overflow layout.
    const map = L.map(mapEl.current, {
      zoomControl: false,
      attributionControl: true,
      dragging: true,
      touchZoom: true,
      scrollWheelZoom: true,
      doubleClickZoom: true,
      boxZoom: true,
      keyboard: true,
      bounceAtZoomLimits: false,
      // Prefer canvas markers under the hood for smoother pan/zoom with hundreds of pins.
      preferCanvas: true,
    }).setView([39.5, -98.35], 4)

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map)

    // Track gestures so pin/route redraws never yank the camera mid-pinch.
    const markInteract = () => { userInteractingRef.current = true }
    const clearInteract = () => {
      window.setTimeout(() => { userInteractingRef.current = false }, 400)
    }
    map.on('zoomstart', markInteract)
    map.on('movestart', markInteract)
    map.on('dragstart', markInteract)
    map.on('zoomend', clearInteract)
    map.on('moveend', clearInteract)

    layerRef.current = L.layerGroup().addTo(map)
    routeLayerRef.current = L.layerGroup().addTo(map)
    boundaryLayerRef.current = L.layerGroup().addTo(map)
    homeLayerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map

    zoomCtrlRef.current = L.control.zoom({ position: 'bottomright' })
    zoomCtrlRef.current.addTo(map)

    const t = window.setTimeout(() => map.invalidateSize({ pan: false }), 80)
    return () => {
      window.clearTimeout(t)
      map.off('zoomstart', markInteract)
      map.off('movestart', markInteract)
      map.off('dragstart', markInteract)
      map.off('zoomend', clearInteract)
      map.off('moveend', clearInteract)
      map.remove()
      mapRef.current = null
      layerRef.current = null
      routeLayerRef.current = null
      boundaryLayerRef.current = null
      homeLayerRef.current = null
      zoomCtrlRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    // Always keep +/- visible — compact phones still need a reliable zoom UI.
    if (!zoomCtrlRef.current) {
      zoomCtrlRef.current = L.control.zoom({ position: 'bottomright' })
      zoomCtrlRef.current.addTo(map)
    }
  }, [compact, active])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const t = window.setTimeout(() => map.invalidateSize({ pan: false }), 180)
    return () => window.clearTimeout(t)
  }, [expanded, fill, active, compact, detailContactId])

  const dayColorByContact = useMemo(() => {
    const map = new Map<string, { dayIndex: number; color: string; label: string }>()
    for (const day of dayRoutes) {
      const color = TRIP_DAY_COLORS[(day.dayIndex - 1) % TRIP_DAY_COLORS.length]
      for (const id of day.contactIds) {
        if (!map.has(id)) map.set(id, { dayIndex: day.dayIndex, color, label: day.label })
      }
    }
    return map
  }, [dayRoutes])

  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return

    layer.clearLayers()
    if (!visible.length) return

    const viaSet = new Set([
      ...(routeMarks?.viaIds ?? []),
      ...(selectedStopIds ? [...selectedStopIds] : []),
    ])
    const bounds = L.latLngBounds([])
    for (const pin of visible) {
      const isStart = routeMarks?.startId === pin.contactId
      const isEnd = routeMarks?.endId === pin.contactId
      const isVia = viaSet.has(pin.contactId)
      const highlighted = highlightIds?.has(pin.contactId)
      const dayMeta = dayColorByContact.get(pin.contactId)
      const ring = isStart
        ? START_COLOR
        : isEnd
          ? END_COLOR
          : isVia
            ? VIA_COLOR
            : dayMeta
              ? dayMeta.color
              : highlighted
                ? HIGHLIGHT_COLOR
                : '#fff'
      const fill = dayMeta
        ? dayMeta.color
        : pin.kind === 'customer' ? CUSTOMER_COLOR : PROSPECT_COLOR
      const marker = L.circleMarker([pin.point.lat, pin.point.lng], {
        radius: isStart || isEnd || isVia || dayMeta || highlighted ? 10 : pin.kind === 'customer' ? 8 : 7,
        color: ring,
        weight: isStart || isEnd || isVia || dayMeta || highlighted ? 2.5 : 1.5,
        fillColor: fill,
        fillOpacity: pin.approximate ? 0.7 : 0.95,
      })
      const tip = isStart
        ? `START · ${pin.label}`
        : isEnd
          ? `END · ${pin.label}`
          : isVia
            ? `PICKED · ${pin.label}`
            : dayMeta
              ? `Day ${dayMeta.dayIndex} · ${pin.label}`
              : pin.label
      marker.bindTooltip(tip, { direction: 'top', opacity: 0.95 })
      marker.on('click', () => {
        const mode = tapModeRef.current
        const h = pickRef.current
        const pick = toPick(pin)
        if (mode === 'start' && h.onPickStart) {
          h.onPickStart(pick)
          setSelected(null)
          setQuery('')
          if (h.expanded) h.onToggleExpand()
          return
        }
        if (mode === 'end' && h.onPickEnd) {
          h.onPickEnd(pick)
          setSelected(null)
          setQuery('')
          if (h.expanded) h.onToggleExpand()
          return
        }
        if (mode === 'via' && h.onPickVia) {
          h.onPickVia(pick)
          // Stay in Add mode so the rep can keep tapping shops.
          setSelected(null)
          setQuery('')
          return
        }
        // Tap same pin again → close the action sheet.
        setSelected((prev) => (prev?.contactId === pin.contactId ? null : pin))
      })
      marker.addTo(layer)
      bounds.extend([pin.point.lat, pin.point.lng])
    }

    // Fit once when pins first appear — never again while refining or toggling
    // highlights (that was yanking the camera mid-zoom).
    if (bounds.isValid() && !fittedRef.current && !userInteractingRef.current) {
      map.fitBounds(bounds.pad(0.12), { maxZoom: 11, animate: false })
      fittedRef.current = true
    }
  }, [visible, highlightIds, routeMarks, selectedStopIds, dayColorByContact])

  // Draw colored day paths once pins exist (order follows itinerary stop list).
  useEffect(() => {
    const map = mapRef.current
    const routeLayer = routeLayerRef.current
    if (!map || !routeLayer) return
    routeLayer.clearLayers()
    if (!dayRoutes.length || !pins.length) {
      routeFitKeyRef.current = ''
      return
    }

    const byId = new Map(pins.map((p) => [p.contactId, p]))
    const routeBounds = L.latLngBounds([])
    let drew = false
    let prevDayLast: L.LatLngExpression | null = null

    for (const day of dayRoutes) {
      const color = TRIP_DAY_COLORS[(day.dayIndex - 1) % TRIP_DAY_COLORS.length]
      const pts: L.LatLngExpression[] = []
      for (const id of day.contactIds) {
        const pin = byId.get(id)
        if (!pin) continue
        pts.push([pin.point.lat, pin.point.lng])
        routeBounds.extend([pin.point.lat, pin.point.lng])
      }
      if (!pts.length) continue

      // Dashed link from yesterday's last stop → today's first (whole trip connected).
      if (prevDayLast && pts[0]) {
        L.polyline([prevDayLast, pts[0]], {
          color: '#8e8e93',
          weight: 3,
          opacity: 0.55,
          dashArray: '8 10',
          lineJoin: 'round',
        }).bindTooltip('Overnight → next day', { sticky: true }).addTo(routeLayer)
        drew = true
      }

      if (pts.length >= 2) {
        drew = true
        L.polyline(pts, {
          color,
          weight: 4,
          opacity: 0.85,
          lineJoin: 'round',
        }).bindTooltip(day.label || `Day ${day.dayIndex}`, { sticky: true }).addTo(routeLayer)
      } else {
        drew = true
      }

      const first = pts[0] as [number, number]
      L.marker(first, {
        interactive: false,
        icon: L.divIcon({
          className: '',
          html: `<div style="
            background:${color};color:#fff;font:800 10px/1 system-ui,sans-serif;
            padding:4px 6px;border-radius:8px;border:1.5px solid #fff;
            box-shadow:0 2px 8px rgba(0,0,0,.35);white-space:nowrap;
          ">D${day.dayIndex}</div>`,
          iconSize: [28, 18],
          iconAnchor: [14, 22],
        }),
      }).addTo(routeLayer)

      prevDayLast = pts[pts.length - 1]
    }

    // Fit only when a *new* itinerary is built (token change) — never on
    // reorder / add / delete so the live trail updates in place.
    const token = routeFitToken || ''
    if (
      drew
      && routeBounds.isValid()
      && token
      && token !== routeFitKeyRef.current
      && !userInteractingRef.current
    ) {
      routeFitKeyRef.current = token
      map.fitBounds(routeBounds.pad(0.18), { maxZoom: 11, animate: true })
    }
  }, [dayRoutes, pins, routeFitToken])

  // Highlight the selected state / city / area as a map outline.
  useEffect(() => {
    const map = mapRef.current
    const layer = boundaryLayerRef.current
    if (!map || !layer) return

    let cancelled = false
    const key = `${boundaryFilter.state}|${boundaryFilter.city}|${boundaryFilter.area}`

    ;(async () => {
      layer.clearLayers()
      if (!boundaryFilter.state && !boundaryFilter.city && !boundaryFilter.area) {
        boundaryFitKeyRef.current = ''
        return
      }

      const pinById = new Map(pins.map((p) => [p.contactId, p]))
      const layers = await buildBoundaryLayers(
        boundaryFilter,
        contacts,
        (c) => {
          const pin = pinById.get(c.id)
          return pin ? pin.point : null
        },
      )
      if (cancelled) return

      const bounds = L.latLngBounds([])
      for (const item of layers) {
        const isPrimary = item.tone === 'primary'
        const geo = L.geoJSON(item.geojson as GeoJSON.GeoJsonObject, {
          // Outline only — never steal taps from shop pins underneath.
          interactive: false,
          style: {
            color: isPrimary ? '#ff3b30' : '#007aff',
            weight: isPrimary ? 3.5 : 2,
            opacity: isPrimary ? 0.95 : 0.55,
            fillColor: isPrimary ? '#ff3b30' : '#007aff',
            fillOpacity: isPrimary ? 0.08 : 0.04,
            dashArray: isPrimary ? undefined : '6 8',
          },
        })
        geo.addTo(layer)
        try {
          const b = geo.getBounds()
          if (b.isValid()) bounds.extend(b)
        } catch {
          /* ignore empty */
        }
      }

      if (
        bounds.isValid()
        && key
        && key !== boundaryFitKeyRef.current
        && !userInteractingRef.current
      ) {
        boundaryFitKeyRef.current = key
        map.fitBounds(bounds.pad(0.18), { maxZoom: 10, animate: true })
      }
    })()

    return () => { cancelled = true }
  }, [boundaryFilter.state, boundaryFilter.city, boundaryFilter.area, contacts, pins])

  // Home icon — fixed screen size at every zoom so the base is always obvious.
  useEffect(() => {
    const map = mapRef.current
    const layer = homeLayerRef.current
    if (!map || !layer) return

    let cancelled = false
    layer.clearLayers()

    const label = (homePlace?.label || '').trim()
    if (!label && !homePlace?.point) return

    ;(async () => {
      let point = homePlace?.point ?? null
      if (!point && label) {
        point = await geocodePlace(label)
        if (point && !cancelled) onHomeResolvedRef.current?.(point)
      }
      if (cancelled || !point) return

      const icon = L.divIcon({
        className: 'trip-home-marker',
        html: `<div style="
          width:28px;height:28px;border-radius:50%;
          background:#007aff;border:2.5px solid #fff;
          box-shadow:0 2px 10px rgba(0,0,0,.4);
          display:flex;align-items:center;justify-content:center;
        ">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
            fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
            aria-hidden="true">
            <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/>
            <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          </svg>
        </div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      })

      const marker = L.marker([point.lat, point.lng], {
        icon,
        interactive: false,
        keyboard: false,
        zIndexOffset: 800,
      })
      marker.bindTooltip(label ? `Home · ${label}` : 'Home', {
        direction: 'top',
        opacity: 0.95,
        offset: [0, -12],
      })
      marker.addTo(layer)
    })()

    return () => { cancelled = true }
  }, [homePlace?.label, homePlace?.point?.lat, homePlace?.point?.lng])

  const applyPick = (pin: CustomerMapPin, role: 'start' | 'end' | 'via') => {
    const pick = toPick(pin)
    if (role === 'start') onPickStart?.(pick)
    else if (role === 'end') onPickEnd?.(pick)
    else onPickVia?.(pick)
    setSelected(null)
    setQuery('')
    // Keep the map open when adding stops so the rep can keep tapping.
    if (role !== 'via' && expanded) onToggleExpand()
  }

  const focusPin = (pin: CustomerMapPin) => {
    setSelected((prev) => {
      if (prev?.contactId === pin.contactId) return null
      return pin
    })
    // Don't dump the name into search — that filtered the map and looked broken.
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
        {compact && (
          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle theme"
            style={{ ...iconBtnStyle, width: 28, height: 28 }}
          >
            {theme === 'dark'
              ? <Sun className="size-3.5" aria-hidden />
              : <Moon className="size-3.5" aria-hidden />}
          </button>
        )}
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

      <div style={{
        display: 'flex', gap: 4,
        padding: compact ? '5px 8px' : '6px 10px',
        flexShrink: 0, overflowX: 'auto',
        borderBottom: '1px solid var(--border2)',
        background: 'var(--bg3)',
      }}>
        <ModeChip
          active={tapMode === 'pick'}
          label="Tap info"
          compact={compact}
          onClick={() => onTapModeChange('pick')}
        />
        <ModeChip
          active={tapMode === 'start'}
          label="Start"
          color={START_COLOR}
          compact={compact}
          onClick={() => onTapModeChange('start')}
        />
        <ModeChip
          active={tapMode === 'end'}
          label="End"
          color={END_COLOR}
          compact={compact}
          onClick={() => onTapModeChange('end')}
        />
        {onPickVia && (
          <ModeChip
            active={tapMode === 'via'}
            label={selectedStopIds?.size ? `Add (${selectedStopIds.size})` : 'Add stop'}
            color={VIA_COLOR}
            compact={compact}
            onClick={() => onTapModeChange('via')}
          />
        )}
      </div>

      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {/* Search floats on the map. Zoom is bottom-right (desktop only). */}
        <div style={{
          position: 'absolute', left: 8, right: 8, top: 8, zIndex: 550,
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

        <div
          ref={mapEl}
          style={{
            position: 'absolute', inset: 0,
            // Keep pinch/pan on the map — don't let parent Trips scroll steal gestures.
            touchAction: 'none',
            zIndex: 1,
          }}
        />

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
              {onPickStart && (
                <button
                  type="button"
                  onClick={() => applyPick(selected, 'start')}
                  style={actionBtn(true)}
                >
                  <Navigation className="size-3.5 shrink-0" aria-hidden />
                  Start here
                </button>
              )}
              {onPickEnd && (
                <button
                  type="button"
                  onClick={() => applyPick(selected, 'end')}
                  style={actionBtn(false)}
                >
                  <Flag className="size-3.5 shrink-0" aria-hidden />
                  End here
                </button>
              )}
              {onPickVia && (
                <button
                  type="button"
                  onClick={() => applyPick(selected, 'via')}
                  style={actionBtn(false)}
                >
                  <Plus className="size-3.5 shrink-0" aria-hidden />
                  {selectedStopIds?.has(selected.contactId) ? 'Remove stop' : 'Add stop'}
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

function ModeChip({
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
        padding: compact ? '5px 9px' : '6px 11px',
        borderRadius: 10, cursor: 'pointer',
        fontSize: compact ? 11 : 11.5, fontWeight: 800, whiteSpace: 'nowrap',
        border: `1.5px solid ${active ? (color || 'var(--accent)') : 'var(--border)'}`,
        background: active ? (color ? `${color}22` : 'var(--chip-accent-bg)') : 'var(--bg2)',
        color: active ? (color || 'var(--accent)') : 'var(--text2)',
      }}
    >
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
