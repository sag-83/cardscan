/**
 * Map outlines for Trip filters: official US state borders, or a hull around
 * shops in a custom area / city when no official polygon exists.
 */

import type { Contact } from '../types/contact'
import { normalizeStateValue } from './usStates'

export type BoundaryFilter = {
  state: string
  city: string
  area: string
}

export type BoundaryLayer = {
  id: string
  label: string
  /** Primary (bright) vs context (faint state behind an area). */
  tone: 'primary' | 'context'
  geojson: GeoJSON.Feature | GeoJSON.FeatureCollection
}

type StateFeature = GeoJSON.Feature<GeoJSON.MultiPolygon | GeoJSON.Polygon, {
  name?: string
  NAME?: string
  STATE?: string
  postal?: string
}>

let statesCache: GeoJSON.FeatureCollection | null = null
let statesPromise: Promise<GeoJSON.FeatureCollection | null> | null = null

const CODE_TO_NAME: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia',
}

/** Public domain US states (name property = full state name). */
const STATES_URL =
  'https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json'

export async function loadUsStatesGeoJson(): Promise<GeoJSON.FeatureCollection | null> {
  if (statesCache) return statesCache
  if (statesPromise) return statesPromise
  statesPromise = (async () => {
    try {
      const res = await fetch(STATES_URL)
      if (!res.ok) return null
      const data = (await res.json()) as GeoJSON.FeatureCollection
      statesCache = data
      return data
    } catch {
      return null
    } finally {
      statesPromise = null
    }
  })()
  return statesPromise
}

function featureStateCode(feature: StateFeature): string {
  const props = feature.properties || {}
  const postal = (props.postal || props.STATE || '').toString()
  if (postal.length === 2) return normalizeStateValue(postal)
  const name = (props.name || props.NAME || '').toString()
  return normalizeStateValue(name)
}

export function findStateFeature(
  collection: GeoJSON.FeatureCollection,
  stateCode: string,
): GeoJSON.Feature | null {
  const code = normalizeStateValue(stateCode)
  if (!code) return null
  for (const feature of collection.features) {
    if (featureStateCode(feature as StateFeature) === code) return feature
  }
  // Fallback: match full name string on properties.name
  const full = CODE_TO_NAME[code]?.toLowerCase()
  if (!full) return null
  for (const feature of collection.features) {
    const name = ((feature.properties as { name?: string })?.name || '').toLowerCase()
    if (name === full) return feature
  }
  return null
}

type Pt = { x: number; y: number; lat: number; lng: number }

/** Monotone-chain convex hull → GeoJSON polygon (closed ring). */
export function convexHullPolygon(
  points: Array<{ lat: number; lng: number }>,
): GeoJSON.Feature<GeoJSON.Polygon> | null {
  const uniq = new Map<string, Pt>()
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue
    uniq.set(`${p.lat.toFixed(5)},${p.lng.toFixed(5)}`, {
      x: p.lng,
      y: p.lat,
      lat: p.lat,
      lng: p.lng,
    })
  }
  const pts = [...uniq.values()]
  if (pts.length < 3) {
    if (pts.length === 0) return null
    // Degenerate: small box around 1–2 points so something still draws.
    const pad = 0.08
    const lats = pts.map((p) => p.lat)
    const lngs = pts.map((p) => p.lng)
    const minLat = Math.min(...lats) - pad
    const maxLat = Math.max(...lats) + pad
    const minLng = Math.min(...lngs) - pad
    const maxLng = Math.max(...lngs) + pad
    return {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [minLng, minLat],
          [maxLng, minLat],
          [maxLng, maxLat],
          [minLng, maxLat],
          [minLng, minLat],
        ]],
      },
    }
  }

  pts.sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x))

  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

  const lower: Pt[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop()
    }
    lower.push(p)
  }
  const upper: Pt[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop()
    }
    upper.push(p)
  }
  upper.pop()
  lower.pop()
  const hull = lower.concat(upper)
  if (hull.length < 3) return null

  const ring = hull.map((p) => [p.lng, p.lat] as [number, number])
  ring.push(ring[0])
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [ring] },
  }
}

function padHull(
  feature: GeoJSON.Feature<GeoJSON.Polygon>,
  padDeg = 0.02,
): GeoJSON.Feature<GeoJSON.Polygon> {
  // Light outward nudge via bounding-box expand on vertices (visual breathing room).
  const ring = feature.geometry.coordinates[0]
  if (!ring?.length) return feature
  const lats = ring.map((c) => c[1])
  const lngs = ring.map((c) => c[0])
  const cy = (Math.min(...lats) + Math.max(...lats)) / 2
  const cx = (Math.min(...lngs) + Math.max(...lngs)) / 2
  const expanded = ring.map(([lng, lat]) => {
    const dlng = lng - cx
    const dlat = lat - cy
    const scale = 1 + padDeg / Math.max(0.05, Math.hypot(dlng, dlat))
    return [cx + dlng * Math.min(scale, 1.25), cy + dlat * Math.min(scale, 1.25)] as [number, number]
  })
  return {
    ...feature,
    geometry: { type: 'Polygon', coordinates: [expanded] },
  }
}

/**
 * Build outline layer(s) for the current trip filters.
 * `pointsFor` supplies lat/lng for contacts (map pins) used for area/city hulls.
 */
export async function buildBoundaryLayers(
  filter: BoundaryFilter,
  contacts: Contact[],
  pointsFor: (contact: Contact) => { lat: number; lng: number } | null,
): Promise<BoundaryLayer[]> {
  const state = normalizeStateValue(filter.state)
  const city = (filter.city || '').trim()
  const area = (filter.area || '').trim()
  if (!state && !city && !area) return []

  const layers: BoundaryLayer[] = []

  if (state) {
    const collection = await loadUsStatesGeoJson()
    const feature = collection ? findStateFeature(collection, state) : null
    if (feature) {
      layers.push({
        id: `state:${state}`,
        label: CODE_TO_NAME[state] || state,
        tone: area || city ? 'context' : 'primary',
        geojson: feature,
      })
    }
  }

  if (area) {
    const pts = contacts
      .filter((c) => (c.area || '').trim() === area)
      .filter((c) => !state || normalizeStateValue(c.state) === state)
      .map((c) => pointsFor(c))
      .filter((p): p is { lat: number; lng: number } => !!p)
    const hull = convexHullPolygon(pts)
    if (hull) {
      layers.push({
        id: `area:${area}`,
        label: area,
        tone: 'primary',
        geojson: padHull(hull),
      })
    }
  } else if (city) {
    const pts = contacts
      .filter((c) => c.city === city)
      .filter((c) => !state || normalizeStateValue(c.state) === state)
      .map((c) => pointsFor(c))
      .filter((p): p is { lat: number; lng: number } => !!p)
    const hull = convexHullPolygon(pts)
    if (hull) {
      layers.push({
        id: `city:${city}`,
        label: city,
        tone: 'primary',
        geojson: padHull(hull, 0.015),
      })
    }
  }

  return layers
}
