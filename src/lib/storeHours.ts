import type { Contact } from '../types/contact'

const GOOGLE_MAPS_SCRIPT_ID = 'google-maps-places-script'
const OPEN_STATUS_CACHE_TTL_MS = 5 * 60 * 1000

export type StoreOpenState = 'open' | 'closed' | 'unknown'

export interface StoreOpenStatus {
  state: StoreOpenState
  label: string
  updatedAt: number
}

type GooglePlacesStatus = 'OK' | 'ZERO_RESULTS' | 'OVER_QUERY_LIMIT' | 'REQUEST_DENIED' | string

interface GooglePlaceResult {
  name?: string
  place_id?: string
  business_status?: string
  opening_hours?: {
    isOpen?: () => boolean
    open_now?: boolean
  }
}

interface GooglePlacesService {
  findPlaceFromQuery(
    request: { query: string; fields: string[] },
    callback: (results: GooglePlaceResult[] | null, status: GooglePlacesStatus) => void
  ): void
  textSearch(
    request: { query: string },
    callback: (results: GooglePlaceResult[] | null, status: GooglePlacesStatus) => void
  ): void
  getDetails(
    request: { placeId: string; fields: string[] },
    callback: (result: GooglePlaceResult | null, status: GooglePlacesStatus) => void
  ): void
}

declare global {
  interface Window {
    google?: {
      maps?: {
        places?: {
          PlacesService: new (element: HTMLElement) => GooglePlacesService
          PlacesServiceStatus: Record<string, GooglePlacesStatus>
        }
      }
    }
  }
}

let placesPromise: Promise<GooglePlacesService> | null = null
let loadedMapsKey = ''
const placeIdCache = new Map<string, string>()
const openStatusCache = new Map<string, StoreOpenStatus>()

function getStoreState(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem('cs_store_v2') || localStorage.getItem('cs_store_demo_v2')
    if (!raw) return null
    const parsed = JSON.parse(raw) as { state?: Record<string, unknown> }
    return parsed.state ?? null
  } catch {
    return null
  }
}

function getMapsKey(): string {
  const envKey =
    (import.meta.env.VITE_GOOGLE_MAPS_KEY as string) ||
    (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string) ||
    ''
  const fromStore = (getStoreState()?.mapsApiKey as string) || ''
  return (fromStore || envKey).trim()
}

function hasMapsKey(): boolean {
  const key = getMapsKey()
  return Boolean(key && !key.includes('your-'))
}

function loadPlacesService(): Promise<GooglePlacesService> {
  if (!hasMapsKey()) return Promise.reject(new Error('Missing Google Maps key'))
  const mapsKey = getMapsKey()
  if (placesPromise && loadedMapsKey === mapsKey) return placesPromise

  placesPromise = new Promise((resolve, reject) => {
    const existingService = window.google?.maps?.places?.PlacesService
    if (existingService) {
      resolve(new existingService(document.createElement('div')))
      return
    }

    const existingScript = document.getElementById(GOOGLE_MAPS_SCRIPT_ID) as HTMLScriptElement | null
    if (existingScript && loadedMapsKey !== mapsKey) existingScript.remove()
    const script = document.createElement('script')

    script.id = GOOGLE_MAPS_SCRIPT_ID
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(mapsKey)}&libraries=places`
    script.async = true
    script.defer = true
    script.onload = () => {
      const serviceCtor = window.google?.maps?.places?.PlacesService
      if (!serviceCtor) {
        reject(new Error('Google Places did not load'))
        return
      }
      resolve(new serviceCtor(document.createElement('div')))
    }
    script.onerror = () => reject(new Error('Google Places failed to load'))

    document.head.appendChild(script)
  })

  loadedMapsKey = mapsKey
  return placesPromise
}

function status(state: StoreOpenState, label: string): StoreOpenStatus {
  return { state, label, updatedAt: Date.now() }
}

function contactPlaceQueries(contact: Contact): string[] {
  const business = contact.company || contact.name
  const fullAddress = [contact.address, contact.city, contact.state, contact.zip].filter(Boolean).join(', ')
  const cityState = [contact.city, contact.state].filter(Boolean).join(', ')

  return [
    [business, fullAddress].filter(Boolean).join(', '),
    [business, cityState].filter(Boolean).join(', '),
    [contact.name, cityState].filter(Boolean).join(', '),
  ].filter((query, index, queries) => query && queries.indexOf(query) === index)
}

interface PlaceLookupResult {
  placeId: string | null
  reason?: string
}

function lookupReasonFromStatus(status: GooglePlacesStatus): string | undefined {
  if (status === 'REQUEST_DENIED') return 'Maps blocked'
  if (status === 'OVER_QUERY_LIMIT') return 'Maps quota hit'
  if (status === 'ZERO_RESULTS') return undefined
  if (status && status !== 'OK') return `Maps ${status}`
  return undefined
}

function placeIdFromFindPlace(service: GooglePlacesService, query: string): Promise<PlaceLookupResult> {
  if (!query) return Promise.resolve({ placeId: null })
  if (placeIdCache.has(query)) return Promise.resolve({ placeId: placeIdCache.get(query)! })

  return new Promise((resolve) => {
    service.findPlaceFromQuery({ query, fields: ['place_id'] }, (results, status) => {
      if (status !== 'OK' || !results?.[0]?.place_id) {
        resolve({ placeId: null, reason: lookupReasonFromStatus(status) })
        return
      }
      placeIdCache.set(query, results[0].place_id)
      resolve({ placeId: results[0].place_id })
    })
  })
}

function placeIdFromTextSearch(service: GooglePlacesService, query: string): Promise<PlaceLookupResult> {
  if (!query) return Promise.resolve({ placeId: null })
  if (placeIdCache.has(query)) return Promise.resolve({ placeId: placeIdCache.get(query)! })

  return new Promise((resolve) => {
    service.textSearch({ query }, (results, status) => {
      if (status !== 'OK' || !results?.[0]?.place_id) {
        resolve({ placeId: null, reason: lookupReasonFromStatus(status) })
        return
      }
      placeIdCache.set(query, results[0].place_id)
      resolve({ placeId: results[0].place_id })
    })
  })
}

async function findPlaceId(service: GooglePlacesService, contact: Contact): Promise<PlaceLookupResult> {
  let lastReason: string | undefined

  for (const query of contactPlaceQueries(contact)) {
    const findPlace = await placeIdFromFindPlace(service, query)
    if (findPlace.placeId) return findPlace
    if (findPlace.reason) lastReason = findPlace.reason

    const textSearch = await placeIdFromTextSearch(service, query)
    if (textSearch.placeId) return textSearch
    if (textSearch.reason) lastReason = textSearch.reason
  }

  return { placeId: null, reason: lastReason || 'No Maps match' }
}

function readOpenState(place: GooglePlaceResult | null): StoreOpenStatus {
  if (!place || place.business_status === 'CLOSED_PERMANENTLY') {
    return status('unknown', 'Hours unavailable')
  }

  const isOpen = place.opening_hours?.isOpen?.() ?? place.opening_hours?.open_now
  if (isOpen === true) return status('open', 'Open now')
  if (isOpen === false) return status('closed', 'Closed now')
  return status('unknown', 'No hours listed')
}

export async function getStoreOpenStatus(contact: Contact): Promise<StoreOpenStatus> {
  const cached = openStatusCache.get(contact.id)
  if (cached && Date.now() - cached.updatedAt < OPEN_STATUS_CACHE_TTL_MS) return cached
  if (!hasMapsKey()) return status('unknown', 'Maps key missing')

  let service: GooglePlacesService
  try {
    service = await loadPlacesService()
  } catch {
    return status('unknown', 'Maps failed')
  }

  const lookup = await findPlaceId(service, contact)
  if (!lookup.placeId) {
    console.warn('Store hours lookup failed', {
      contact: contact.company || contact.name,
      reason: lookup.reason,
      queries: contactPlaceQueries(contact),
    })
    const fallback = status('unknown', lookup.reason || 'No Maps match')
    openStatusCache.set(contact.id, fallback)
    return fallback
  }
  const placeId = lookup.placeId

  return new Promise((resolve) => {
    service.getDetails(
      { placeId, fields: ['business_status', 'opening_hours'] },
      (result, status) => {
        if (status !== 'OK') {
          const fallback = status === 'REQUEST_DENIED' ? statusLabel('Maps blocked') : statusLabel('Hours unavailable')
          openStatusCache.set(contact.id, fallback)
          resolve(fallback)
          return
        }
        const resolved = readOpenState(result)
        openStatusCache.set(contact.id, resolved)
        resolve(resolved)
      }
    )
  })
}

function statusLabel(label: string): StoreOpenStatus {
  return status('unknown', label)
}
