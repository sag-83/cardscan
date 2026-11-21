/**
 * Where the trip search radius is measured from.
 *
 * Home / device / a typed place = radius from that start.
 * A selected state / city / area = radius from that territory (so “Maryland +
 * 150 mi” plans Maryland, not “can I reach Maryland from NJ in 150 mi?”).
 */

import type { Contact } from '../types/contact'
import { getCachedPinPoint } from './customerMapPins'
import {
  geocodeCityCoords,
  geocodePlace,
  getCachedCityCoords,
  type GeoPoint,
} from './geocode'
import { normalizeStateValue } from './usStates'
import type { TripOrigin } from './tripPlanner'

export function describeTripScope(filterState: string, filterCity: string, filterArea: string): string {
  const state = (filterState || '').trim()
  const city = (filterCity || '').trim()
  const area = (filterArea || '').trim()
  if (area && city) return `${area} · ${city}${state ? `, ${state}` : ''}`
  if (area) return state ? `${area} (${state})` : area
  if (city) return state ? `${city}, ${state}` : city
  if (state) return state
  return ''
}

function averagePoint(points: GeoPoint[]): GeoPoint {
  const lat = points.reduce((s, p) => s + p.lat, 0) / points.length
  const lng = points.reduce((s, p) => s + p.lng, 0) / points.length
  return { lat, lng }
}

/** Centroid of scoped contacts we already have coordinates for. */
function centroidFromContacts(contacts: Contact[]): GeoPoint | null {
  const points: GeoPoint[] = []
  for (const c of contacts) {
    const pin = getCachedPinPoint(c)
    if (pin) {
      points.push(pin.point)
      continue
    }
    const city = (c.city || '').trim()
    const state = normalizeStateValue(c.state)
    if (city && state) {
      const cached = getCachedCityCoords(city, state)
      if (cached) points.push(cached)
    }
  }
  if (!points.length) return null
  return averagePoint(points)
}

/**
 * Resolve a radius/route center for the selected territory.
 * Returns null when no state/city/area filter is set — caller should use Start.
 */
export async function resolveTripScopeOrigin(opts: {
  contacts: Contact[]
  filterState: string
  filterCity: string
  filterArea: string
}): Promise<TripOrigin | null> {
  const label = describeTripScope(opts.filterState, opts.filterCity, opts.filterArea)
  if (!label) return null

  const fromPool = centroidFromContacts(opts.contacts)
  if (fromPool) return { label, point: fromPool }

  const state = (opts.filterState || '').trim()
  const city = (opts.filterCity || '').trim()
  const area = (opts.filterArea || '').trim()

  if (city) {
    const point = state
      ? await geocodeCityCoords(city, state)
      : await geocodePlace(city)
    if (point) return { label, point }
  }

  if (area) {
    const query = state ? `${area}, ${state}` : area
    const point = await geocodePlace(query)
    if (point) return { label, point }
  }

  if (state) {
    // State name alone → Nominatim / Google place geocode (centroid-ish).
    const point = await geocodePlace(state)
    if (point) return { label, point }
  }

  return null
}
