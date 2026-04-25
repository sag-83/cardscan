import type { Contact } from '../types/contact'

const CACHE_KEY = 'cs_geo_v1'

function loadCache(): Map<string, { lat: number; lng: number }> {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw) return new Map(JSON.parse(raw) as [string, { lat: number; lng: number }][])
  } catch {}
  return new Map()
}

function saveCache(cache: Map<string, { lat: number; lng: number }>) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify([...cache.entries()])) } catch {}
}

const geoCache = loadCache()

async function geocodeCity(city: string, state: string): Promise<{ lat: number; lng: number } | null> {
  const key = `${city.trim().toUpperCase()}|${state.trim().toUpperCase()}`
  if (geoCache.has(key)) return geoCache.get(key)!
  try {
    const q = encodeURIComponent([city, state, 'USA'].filter(Boolean).join(', '))
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`,
      { headers: { 'User-Agent': 'CardScanApp/1.0' } }
    )
    if (!res.ok) return null
    const data = await res.json() as { lat: string; lon: string }[]
    if (!data[0]) return null
    const result = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
    geoCache.set(key, result)
    saveCache(geoCache)
    return result
  } catch { return null }
}

export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function isSecureLocationContext(): boolean {
  return window.isSecureContext || ['localhost', '127.0.0.1'].includes(window.location.hostname)
}

function getPositionOnce(options: PositionOptions): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Location not supported on this device'))
      return
    }

    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => {
        const fallbackMessages: Record<number, string> = {
          [e.PERMISSION_DENIED]: 'Location permission was denied',
          [e.POSITION_UNAVAILABLE]: 'Location is unavailable right now',
          [e.TIMEOUT]: 'Location timed out',
        }
        reject(new Error(e.message || fallbackMessages[e.code] || 'Could not get location'))
      },
      options
    )
  })
}

export async function getUserPosition(): Promise<{ lat: number; lng: number }> {
  if (!isSecureLocationContext()) {
    throw new Error('Location requires HTTPS on iPhone Safari')
  }

  try {
    const permissions = navigator.permissions
    if (permissions?.query) {
      const status = await permissions.query({ name: 'geolocation' as PermissionName })
      if (status.state === 'denied') throw new Error('Location permission is blocked for this site')
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('blocked')) throw err
  }

  try {
    return await getPositionOnce({ enableHighAccuracy: false, timeout: 20000, maximumAge: 5 * 60 * 1000 })
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (!/timed out|unavailable/i.test(message)) throw err
    return getPositionOnce({ enableHighAccuracy: true, timeout: 30000, maximumAge: 0 })
  }
}

export async function geocodeContacts(
  contacts: Contact[],
  userPos: { lat: number; lng: number },
  onUpdate: (distances: Map<string, number>) => void
): Promise<void> {
  // Group contacts by unique city+state
  const cityMap = new Map<string, string[]>()
  contacts.forEach((c) => {
    if (!c.city) return
    const key = `${c.city.trim().toUpperCase()}|${(c.state || '').trim().toUpperCase()}`
    if (!cityMap.has(key)) cityMap.set(key, [])
    cityMap.get(key)!.push(c.id)
  })

  const distances = new Map<string, number>()

  // First pass: instantly apply already-cached cities
  cityMap.forEach((ids, key) => {
    if (!geoCache.has(key)) return
    const coords = geoCache.get(key)!
    const dist = haversineDistance(userPos.lat, userPos.lng, coords.lat, coords.lng)
    ids.forEach((id) => distances.set(id, dist))
  })
  if (distances.size > 0) onUpdate(new Map(distances))

  // Second pass: geocode uncached cities one at a time (Nominatim rate limit)
  for (const [key, ids] of cityMap) {
    if (geoCache.has(key)) continue
    const [city, state = ''] = key.split('|')
    const coords = await geocodeCity(city, state)
    if (coords) {
      const dist = haversineDistance(userPos.lat, userPos.lng, coords.lat, coords.lng)
      ids.forEach((id) => distances.set(id, dist))
      onUpdate(new Map(distances))
    }
    await new Promise((r) => setTimeout(r, 220))
  }
}

export function formatDistance(miles: number): string {
  if (miles < 0.1) return `${Math.round(miles * 5280)} ft`
  if (miles < 10) return `${miles.toFixed(1)} mi`
  return `${Math.round(miles)} mi`
}
