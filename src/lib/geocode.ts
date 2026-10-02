import type { Contact } from '../types/contact'
import { getCachedUserPosition, isLocationAccessEnabled } from './locationAccess'
import { isStandalonePwa } from './pwa'
import { haversineDistance, type GeoPoint } from './geoMath'

export { haversineDistance }
export type { GeoPoint }

const CITY_CACHE_KEY = 'cs_geo_v1'
const ADDRESS_CACHE_KEY = 'cs_geo_addr_v1'

function loadCache(key: string): Map<string, GeoPoint> {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return new Map(JSON.parse(raw) as [string, GeoPoint][])
  } catch {}
  return new Map()
}

function saveCache(key: string, cache: Map<string, GeoPoint>) {
  try { localStorage.setItem(key, JSON.stringify([...cache.entries()])) } catch {}
}

const cityCache = loadCache(CITY_CACHE_KEY)
const addressCache = loadCache(ADDRESS_CACHE_KEY)

// Addresses that Nominatim couldn't resolve. Kept in memory only so a bad OCR
// read isn't retried on every plan, but a later edit to the card still gets a
// fresh attempt after a reload.
const addressMisses = new Set<string>()

// ─── Nominatim request scheduling ───────────────────────────────────────────
// Nominatim's usage policy allows roughly one request per second from a single
// client. Every lookup funnels through this queue so concurrent callers (Near
// Me sorting and the trip planner, say) can't accidentally burst past that and
// get the whole app rate-limited.

const MIN_REQUEST_GAP_MS = 350
let lastRequestAt = 0
let requestQueue: Promise<unknown> = Promise.resolve()

function schedule<T>(task: () => Promise<T>): Promise<T> {
  const run = requestQueue.then(async () => {
    const wait = MIN_REQUEST_GAP_MS - (Date.now() - lastRequestAt)
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastRequestAt = Date.now()
    return task()
  })
  requestQueue = run.catch(() => undefined)
  return run
}

const NOMINATIM_TIMEOUT_MS = 12_000

async function nominatimLookup(params: Record<string, string>): Promise<GeoPoint | null> {
  return schedule(async () => {
    const query = new URLSearchParams({ format: 'json', limit: '1', ...params })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), NOMINATIM_TIMEOUT_MS)
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?${query}`, {
        headers: { 'User-Agent': 'CardScanApp/1.0' },
        signal: controller.signal,
      })
      if (!res.ok) return null
      const data = await res.json() as { lat: string; lon: string }[]
      if (!data[0]) return null
      const lat = parseFloat(data[0].lat)
      const lng = parseFloat(data[0].lon)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
      return { lat, lng }
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  })
}

// ─── City-level lookups (used by Near Me sorting) ───────────────────────────

function cityKey(city: string, state: string): string {
  return `${city.trim().toUpperCase()}|${state.trim().toUpperCase()}`
}

async function geocodeCity(city: string, state: string): Promise<GeoPoint | null> {
  const key = cityKey(city, state)
  if (cityCache.has(key)) return cityCache.get(key)!
  const point = await nominatimLookup({
    q: [city, state, 'USA'].filter(Boolean).join(', '),
  })
  if (!point) return null
  cityCache.set(key, point)
  saveCache(CITY_CACHE_KEY, cityCache)
  return point
}

/** City/state centroid, served from cache when it's already been looked up. */
export function geocodeCityCoords(city: string, state: string): Promise<GeoPoint | null> {
  if (!city.trim()) return Promise.resolve(null)
  return geocodeCity(city, state)
}

/** Synchronous cache peek — lets callers skip the network for known cities. */
export function getCachedCityCoords(city: string, state: string): GeoPoint | null {
  if (!city.trim()) return null
  return cityCache.get(cityKey(city, state)) ?? null
}

// ─── Street-level and freeform lookups (used by the trip planner) ───────────

function addressKey(street: string, city: string, state: string, zip: string): string {
  return [street, city, state, zip]
    .map((part) => part.trim().toUpperCase().replace(/\s+/g, ' '))
    .join('|')
}

async function geocodeStreetAddress(
  street: string,
  city: string,
  state: string,
  zip: string,
): Promise<GeoPoint | null> {
  const key = addressKey(street, city, state, zip)
  if (addressCache.has(key)) return addressCache.get(key)!
  if (addressMisses.has(key)) return null

  // Structured parameters beat a single q= string here: scanned cards carry
  // suite numbers and inconsistent punctuation that confuse freeform parsing.
  const params: Record<string, string> = { street, country: 'USA' }
  if (city) params.city = city
  if (state) params.state = state
  if (zip) params.postalcode = zip

  const point = await nominatimLookup(params)
  if (!point) {
    addressMisses.add(key)
    return null
  }
  addressCache.set(key, point)
  saveCache(ADDRESS_CACHE_KEY, addressCache)
  return point
}

export async function geocodePostalCode(zip: string): Promise<GeoPoint | null> {
  const key = addressKey('', '', '', zip)
  if (addressCache.has(key)) return addressCache.get(key)!
  const point = await nominatimLookup({ postalcode: zip, country: 'USA' })
  if (!point) return null
  addressCache.set(key, point)
  saveCache(ADDRESS_CACHE_KEY, addressCache)
  return point
}

export interface ResolvedLocation {
  point: GeoPoint
  /** True when only the city or ZIP resolved, so the pin isn't the storefront. */
  approximate: boolean
}

/**
 * Best available coordinates for a contact, trying the street address first and
 * degrading to ZIP or city centroid. `approximate` tells the caller the stop
 * can be ordered but its exact position shouldn't be trusted.
 */
export async function geocodeContactLocation(contact: Contact): Promise<ResolvedLocation | null> {
  const street = (contact.address ?? '').trim()
  const city = (contact.city ?? '').trim()
  const state = (contact.state ?? '').trim()
  const zip = (contact.zip ?? '').trim()

  if (street && (city || zip)) {
    const exact = await geocodeStreetAddress(street, city, state, zip)
    if (exact) return { point: exact, approximate: false }
  }

  if (zip) {
    const byZip = await geocodePostalCode(zip)
    if (byZip) return { point: byZip, approximate: true }
  }

  if (city) {
    const byCity = await geocodeCity(city, state)
    if (byCity) return { point: byCity, approximate: true }
  }

  return null
}

/** Resolves whatever the user typed as a starting point — city, ZIP or address. */
export async function geocodePlace(text: string): Promise<GeoPoint | null> {
  const query = text.trim()
  if (!query) return null
  const key = addressKey(query, '', '', '')
  if (addressCache.has(key)) return addressCache.get(key)!

  const point = await nominatimLookup({ q: query, countrycodes: 'us' })
  if (!point) return null
  addressCache.set(key, point)
  saveCache(ADDRESS_CACHE_KEY, addressCache)
  return point
}

// ─── Device location ────────────────────────────────────────────────────────

function isSecureLocationContext(): boolean {
  return window.isSecureContext || ['localhost', '127.0.0.1'].includes(window.location.hostname)
}

export class LocationError extends Error {
  constructor(
    message: string,
    readonly code: 'https' | 'denied' | 'unavailable' | 'timeout' | 'unsupported'
  ) {
    super(message)
    this.name = 'LocationError'
  }
}

function getPositionOnce(options: PositionOptions): Promise<GeoPoint> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new LocationError('Location not supported on this device', 'unsupported'))
      return
    }

    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => {
        const codes: Record<number, LocationError['code']> = {
          [e.PERMISSION_DENIED]: 'denied',
          [e.POSITION_UNAVAILABLE]: 'unavailable',
          [e.TIMEOUT]: 'timeout',
        }
        const messages: Record<number, string> = {
          [e.PERMISSION_DENIED]: 'Location permission was denied',
          [e.POSITION_UNAVAILABLE]: 'Location is unavailable right now',
          [e.TIMEOUT]: 'Location timed out',
        }
        const code = codes[e.code] ?? 'unavailable'
        reject(new LocationError(e.message || messages[e.code] || 'Could not get location', code))
      },
      options
    )
  })
}

export async function getUserPosition(): Promise<GeoPoint> {
  if (!isSecureLocationContext()) {
    throw new LocationError('Location requires HTTPS', 'https')
  }

  if (!isLocationAccessEnabled()) {
    throw new LocationError('Enable location in Settings first', 'denied')
  }

  const cached = getCachedUserPosition()
  if (cached) return cached

  const baseTimeout = isStandalonePwa() ? 45_000 : 25_000

  try {
    return await getPositionOnce({
      enableHighAccuracy: false,
      timeout: baseTimeout,
      maximumAge: 60_000,
    })
  } catch (err) {
    if (err instanceof LocationError && err.code === 'denied') throw err
    if (err instanceof LocationError && err.code !== 'timeout' && err.code !== 'unavailable') {
      throw err
    }

    try {
      return await getPositionOnce({
        enableHighAccuracy: true,
        timeout: isStandalonePwa() ? 60_000 : 35_000,
        maximumAge: 0,
      })
    } catch (retryErr) {
      if (retryErr instanceof LocationError) throw retryErr
      throw new LocationError(
        retryErr instanceof Error ? retryErr.message : 'Could not get location',
        'unavailable',
      )
    }
  }
}

export async function geocodeContacts(
  contacts: Contact[],
  userPos: GeoPoint,
  onUpdate: (distances: Map<string, number>) => void
): Promise<void> {
  // Group contacts by unique city+state
  const cityMap = new Map<string, string[]>()
  contacts.forEach((c) => {
    if (!c.city) return
    const key = cityKey(c.city, c.state || '')
    if (!cityMap.has(key)) cityMap.set(key, [])
    cityMap.get(key)!.push(c.id)
  })

  const distances = new Map<string, number>()

  // First pass: instantly apply already-cached cities
  cityMap.forEach((ids, key) => {
    if (!cityCache.has(key)) return
    const coords = cityCache.get(key)!
    const dist = haversineDistance(userPos.lat, userPos.lng, coords.lat, coords.lng)
    ids.forEach((id) => distances.set(id, dist))
  })
  if (distances.size > 0) onUpdate(new Map(distances))

  // Second pass: geocode uncached cities (the shared queue paces the requests)
  for (const [key, ids] of cityMap) {
    if (cityCache.has(key)) continue
    const [city, state = ''] = key.split('|')
    const coords = await geocodeCity(city, state)
    if (coords) {
      const dist = haversineDistance(userPos.lat, userPos.lng, coords.lat, coords.lng)
      ids.forEach((id) => distances.set(id, dist))
      onUpdate(new Map(distances))
    }
  }
}

export function formatDistance(miles: number): string {
  if (miles < 0.1) return `${Math.round(miles * 5280)} ft`
  if (miles < 10) return `${miles.toFixed(1)} mi`
  return `${Math.round(miles)} mi`
}
