const ENABLED_KEY = 'cardscan_location_enabled'
const LAST_POS_KEY = 'cardscan_location_last'
const MAX_AGE_MS = 5 * 60 * 1000

export type LocationAccessStatus = {
  supported: boolean
  enabled: boolean
  permission: 'granted' | 'denied' | 'prompt' | 'unsupported'
}

export function supportsLocationAccess(): boolean {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator
}

export function isLocationAccessEnabled(): boolean {
  return localStorage.getItem(ENABLED_KEY) === 'true'
}

export function setLocationAccessEnabled(enabled: boolean): void {
  localStorage.setItem(ENABLED_KEY, enabled ? 'true' : 'false')
  if (!enabled) localStorage.removeItem(LAST_POS_KEY)
}

export function getLocationAccessStatus(): LocationAccessStatus {
  const supported = supportsLocationAccess()
  if (!supported) {
    return { supported: false, enabled: false, permission: 'unsupported' }
  }
  const enabled = isLocationAccessEnabled()
  return { supported: true, enabled, permission: enabled ? 'granted' : 'prompt' }
}

/** Call only from a button tap — shows the system “Allow location?” dialog. */
export async function enableLocationAccess(): Promise<'granted' | 'denied' | 'timeout' | 'unsupported'> {
  if (!supportsLocationAccess()) return 'unsupported'

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocationAccessEnabled(true)
        try {
          localStorage.setItem(
            LAST_POS_KEY,
            JSON.stringify({
              lat: p.coords.latitude,
              lng: p.coords.longitude,
              at: Date.now(),
            }),
          )
        } catch {
          /* ignore */
        }
        resolve('granted')
      },
      (e) => {
        if (e.code === e.PERMISSION_DENIED) {
          setLocationAccessEnabled(false)
          resolve('denied')
        } else if (e.code === e.TIMEOUT) {
          resolve('timeout')
        } else {
          setLocationAccessEnabled(false)
          resolve('denied')
        }
      },
      { enableHighAccuracy: true, timeout: 60_000, maximumAge: 0 },
    )
  })
}

export function getCachedUserPosition(): { lat: number; lng: number } | null {
  try {
    const raw = localStorage.getItem(LAST_POS_KEY)
    if (!raw) return null
    const { lat, lng, at } = JSON.parse(raw) as { lat: number; lng: number; at: number }
    if (Date.now() - at > MAX_AGE_MS) return null
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    return { lat, lng }
  } catch {
    return null
  }
}
