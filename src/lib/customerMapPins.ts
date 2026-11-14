/**
 * Resolve contact pins for the in-app customer map.
 *
 * Strategy:
 *  1. Paint city/ZIP pins immediately (shared cache with Trips / Near Me)
 *  2. Refine every contact that has a street address to street-level coords
 *     — Google Geocoder when a Maps key is configured, else Nominatim
 *  3. Persist refined coords so the next open is fast and accurate
 */

import type { Contact } from '../types/contact'
import {
  geocodeCityCoords,
  geocodeContactLocation,
  geocodePostalCode,
  getCachedCityCoords,
  type GeoPoint,
} from './geocode'
import { loadGooglePlacesLibrary, mapsKeyAvailable } from './storeHours'

export type MapPinKind = 'customer' | 'prospect'

export interface CustomerMapPin {
  id: string
  contactId: string
  label: string
  kind: MapPinKind
  point: GeoPoint
  approximate: boolean
  address: string
  city: string
  state: string
}

const PIN_CACHE_KEY = 'cs_map_pin_coords_v2'

type PinCacheEntry = GeoPoint & { exact: boolean; savedAt: number }

function loadPinCache(): Map<string, PinCacheEntry> {
  try {
    const raw = localStorage.getItem(PIN_CACHE_KEY)
    if (!raw) return new Map()
    return new Map(JSON.parse(raw) as [string, PinCacheEntry][])
  } catch {
    return new Map()
  }
}

function savePinCache(cache: Map<string, PinCacheEntry>) {
  try {
    // Cap growth — keep the newest ~2k entries.
    const entries = [...cache.entries()]
    if (entries.length > 2200) {
      entries.sort((a, b) => (b[1].savedAt ?? 0) - (a[1].savedAt ?? 0))
      cache = new Map(entries.slice(0, 2000))
    }
    localStorage.setItem(PIN_CACHE_KEY, JSON.stringify([...cache.entries()]))
  } catch { /* private mode */ }
}

const pinCache = loadPinCache()

function pinLabel(c: Contact): string {
  return (c.company || c.name || 'Contact').trim()
}

function addressLine(c: Contact): string {
  return [c.address, c.city, c.state, c.zip].filter(Boolean).join(', ')
}

function cacheKey(c: Contact): string {
  return [c.address, c.city, c.state, c.zip]
    .map((p) => (p ?? '').trim().toUpperCase().replace(/\s+/g, ' '))
    .join('|')
}

function hasMappableLocation(c: Contact): boolean {
  return Boolean((c.address || c.city || c.zip || '').trim())
}

/** Tiny jitter only for approximate city pins so they don't stack. */
function cityJitter(point: GeoPoint, seed: string): GeoPoint {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const latNudge = ((h % 1000) / 1000 - 0.5) * 0.012
  const lngNudge = (((h / 1000) % 1000) / 1000 - 0.5) * 0.012
  return { lat: point.lat + latNudge, lng: point.lng + lngNudge }
}

function toPin(
  c: Contact,
  point: GeoPoint,
  approximate: boolean,
): CustomerMapPin {
  return {
    id: c.id,
    contactId: c.id,
    label: pinLabel(c),
    kind: c.is_customer ? 'customer' : 'prospect',
    point: approximate ? cityJitter(point, c.id) : point,
    approximate,
    address: addressLine(c),
    city: c.city || '',
    state: c.state || '',
  }
}

async function googleGeocode(query: string, signal?: AbortSignal): Promise<{ point: GeoPoint; exact: boolean } | null> {
  if (!mapsKeyAvailable()) return null
  const ready = await loadGooglePlacesLibrary()
  if (!ready || signal?.aborted || !window.google?.maps?.Geocoder) return null

  const geocoder = new window.google.maps.Geocoder()
  return new Promise((resolve) => {
    geocoder.geocode(
      { address: query, componentRestrictions: { country: 'US' } },
      (results, status) => {
        if (signal?.aborted || status !== 'OK' || !results?.[0]?.geometry?.location) {
          resolve(null)
          return
        }
        const loc = results[0].geometry.location
        const types = results[0].types || []
        const exact = types.some((t) => (
          t === 'street_address' || t === 'premise' || t === 'subpremise' || t === 'route'
        ))
        resolve({ point: { lat: loc.lat(), lng: loc.lng() }, exact })
      },
    )
  })
}

async function refineStreetPin(
  c: Contact,
  signal?: AbortSignal,
): Promise<{ point: GeoPoint; exact: boolean } | null> {
  const street = (c.address ?? '').trim()
  if (!street) return null

  const key = cacheKey(c)
  const cached = pinCache.get(key)
  if (cached?.exact) return { point: cached, exact: true }

  const query = addressLine(c)
  if (!query) return null

  // Prefer Google when available — much more accurate for US street addresses.
  const googleHit = await googleGeocode(query, signal)
  if (googleHit) {
    pinCache.set(key, { ...googleHit.point, exact: googleHit.exact, savedAt: Date.now() })
    return googleHit
  }

  if (signal?.aborted) return null
  const hit = await geocodeContactLocation(c)
  if (!hit) return null
  pinCache.set(key, {
    ...hit.point,
    exact: !hit.approximate,
    savedAt: Date.now(),
  })
  return { point: hit.point, exact: !hit.approximate }
}

export interface ResolvePinsHandlers {
  onProgress?: (done: number, total: number, label: string) => void
  /** Called after the fast city pass, then again as street pins refine. */
  onUpdate?: (pins: CustomerMapPin[]) => void
}

/**
 * Resolves pins progressively. Callers should show the first onUpdate
 * immediately, then accept refinements as street geocoding finishes.
 */
export async function resolveCustomerMapPins(
  contacts: Contact[],
  signal?: AbortSignal,
  handlers: ResolvePinsHandlers = {},
): Promise<CustomerMapPin[]> {
  const { onProgress, onUpdate } = handlers
  const pool = contacts.filter(hasMappableLocation)
  const byId = new Map<string, CustomerMapPin>()

  const publish = () => onUpdate?.([...byId.values()])

  // ── Phase 0: restore exact pins from local cache instantly ──────────────
  for (const c of pool) {
    const cached = pinCache.get(cacheKey(c))
    if (cached?.exact) {
      byId.set(c.id, toPin(c, cached, false))
    }
  }
  if (byId.size) publish()

  // ── Phase 1: city / ZIP centroids for everyone else ─────────────────────
  const groups = new Map<string, Contact[]>()
  for (const c of pool) {
    if (byId.has(c.id) && !byId.get(c.id)!.approximate) continue
    const city = (c.city ?? '').trim()
    const state = (c.state ?? '').trim()
    const zip = (c.zip ?? '').trim()
    const key = city
      ? `city:${city.toUpperCase()}|${state.toUpperCase()}`
      : `zip:${zip.toUpperCase()}`
    const list = groups.get(key)
    if (list) list.push(c)
    else groups.set(key, [c])
  }

  let done = 0
  const total = pool.length
  for (const [key, list] of groups) {
    if (signal?.aborted) break

    let point: GeoPoint | null = null
    if (key.startsWith('city:')) {
      const [, rest = ''] = key.split('city:')
      const [city = '', state = ''] = rest.split('|')
      point = getCachedCityCoords(city, state) ?? await geocodeCityCoords(city, state)
    } else {
      const zip = key.slice(4)
      point = zip ? await geocodePostalCode(zip) : null
    }

    for (const c of list) {
      done++
      onProgress?.(done, total, pinLabel(c))
      if (!point) continue
      // Don't overwrite an exact pin with a city centroid.
      const existing = byId.get(c.id)
      if (existing && !existing.approximate) continue
      byId.set(c.id, toPin(c, point, true))
    }
  }
  publish()

  // ── Phase 2: street-level for every contact with a street line ──────────
  // Customers first (the pins the rep cares about most), then the rest.
  const toRefine = [...pool]
    .filter((c) => (c.address ?? '').trim())
    .sort((a, b) => Number(b.is_customer) - Number(a.is_customer))

  let refined = 0
  for (const c of toRefine) {
    if (signal?.aborted) break
    const existing = byId.get(c.id)
    if (existing && !existing.approximate) {
      refined++
      onProgress?.(refined, toRefine.length, pinLabel(c))
      continue
    }

    const hit = await refineStreetPin(c, signal)
    refined++
    onProgress?.(refined, toRefine.length, pinLabel(c))
    if (!hit) continue
    byId.set(c.id, toPin(c, hit.point, !hit.exact))

    // Publish every few refinements so the map moves pins live.
    if (refined % 5 === 0 || refined === toRefine.length) publish()
  }

  savePinCache(pinCache)
  publish()
  return [...byId.values()]
}

export function googleMapsSearchUrl(pin: CustomerMapPin): string {
  const q = pin.address || `${pin.point.lat},${pin.point.lng}`
  return `https://maps.google.com/?q=${encodeURIComponent(q)}`
}
