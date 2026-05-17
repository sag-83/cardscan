import { isStandalonePwa } from './pwa'

const ENABLED_KEY = 'cardscan_location_enabled'
const LAST_POS_KEY = 'cardscan_location_last'
const MAX_AGE_MS = 5 * 60 * 1000

export type LocationAccessStatus = {
  supported: boolean
  enabled: boolean
  permission: 'granted' | 'denied' | 'prompt' | 'unsupported'
  blocked: boolean
  needsHomeScreen: boolean
}

export type EnableLocationResult =
  | 'granted'
  | 'denied'
  | 'blocked'
  | 'timeout'
  | 'unsupported'
  | 'need-standalone'

export function supportsLocationAccess(): boolean {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator
}

export function isLikelyIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return (
    /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

export function isLocationAccessEnabled(): boolean {
  return localStorage.getItem(ENABLED_KEY) === 'true'
}

export function setLocationAccessEnabled(enabled: boolean): void {
  localStorage.setItem(ENABLED_KEY, enabled ? 'true' : 'false')
  if (!enabled) localStorage.removeItem(LAST_POS_KEY)
}

export async function queryGeolocationPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  if (!supportsLocationAccess()) return 'unknown'
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName })
    if (status.state === 'granted') return 'granted'
    if (status.state === 'denied') return 'denied'
    return 'prompt'
  } catch {
    return 'unknown'
  }
}

export function getLocationAccessStatus(): LocationAccessStatus {
  const supported = supportsLocationAccess()
  if (!supported) {
    return { supported: false, enabled: false, permission: 'unsupported', blocked: false, needsHomeScreen: false }
  }
  return {
    supported: true,
    enabled: isLocationAccessEnabled(),
    permission: isLocationAccessEnabled() ? 'granted' : 'prompt',
    blocked: false,
    needsHomeScreen: isLikelyIOS() && !isStandalonePwa(),
  }
}

function savePosition(p: GeolocationPosition): void {
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
}

/** Call only from a button tap — triggers the system location dialog when iOS allows it. */
function requestLocationFromGesture(): Promise<EnableLocationResult> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: EnableLocationResult) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    const onSuccess = (p: GeolocationPosition) => {
      if (watchId != null) navigator.geolocation.clearWatch(watchId)
      savePosition(p)
      finish('granted')
    }

    const onError = (e: GeolocationPositionError) => {
      if (watchId != null) navigator.geolocation.clearWatch(watchId)
      setLocationAccessEnabled(false)
      if (e.code === e.PERMISSION_DENIED) finish('denied')
      else if (e.code === e.TIMEOUT) finish('timeout')
      else finish('denied')
    }

    const options: PositionOptions = { enableHighAccuracy: true, timeout: 60_000, maximumAge: 0 }

    // watchPosition often surfaces the iOS prompt more reliably than a single getCurrentPosition.
    let watchId: number | null = navigator.geolocation.watchPosition(onSuccess, onError, options)

    navigator.geolocation.getCurrentPosition(onSuccess, () => {
      /* watchPosition handles success/error */
    }, options)
  })
}

export async function enableLocationAccess(): Promise<EnableLocationResult> {
  if (!supportsLocationAccess()) return 'unsupported'

  if (isLikelyIOS() && !isStandalonePwa()) {
    return 'need-standalone'
  }

  const perm = await queryGeolocationPermission()
  if (perm === 'denied') return 'blocked'

  const result = await requestLocationFromGesture()
  if (result === 'denied') {
    const after = await queryGeolocationPermission()
    if (after === 'denied') return 'blocked'
  }
  return result
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
