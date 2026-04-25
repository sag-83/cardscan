import type { Contact } from '../types/contact'

const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string
const GOOGLE_MAPS_SCRIPT_ID = 'google-maps-places-script'

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
const placeIdCache = new Map<string, string>()

function hasMapsKey(): boolean {
  return Boolean(GOOGLE_MAPS_KEY && !GOOGLE_MAPS_KEY.includes('your-'))
}

function loadPlacesService(): Promise<GooglePlacesService> {
  if (!hasMapsKey()) return Promise.reject(new Error('Missing Google Maps key'))
  if (placesPromise) return placesPromise

  placesPromise = new Promise((resolve, reject) => {
    const existingService = window.google?.maps?.places?.PlacesService
    if (existingService) {
      resolve(new existingService(document.createElement('div')))
      return
    }

    const existingScript = document.getElementById(GOOGLE_MAPS_SCRIPT_ID) as HTMLScriptElement | null
    const script = existingScript || document.createElement('script')

    script.id = GOOGLE_MAPS_SCRIPT_ID
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_KEY)}&libraries=places`
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

    if (!existingScript) document.head.appendChild(script)
  })

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
    return status('unknown', lookup.reason || 'No Maps match')
  }
  const placeId = lookup.placeId

  return new Promise((resolve) => {
    service.getDetails(
      { placeId, fields: ['business_status', 'opening_hours'] },
      (result, status) => {
        if (status !== 'OK') {
          resolve(status === 'REQUEST_DENIED' ? statusLabel('Maps blocked') : statusLabel('Hours unavailable'))
          return
        }
        resolve(readOpenState(result))
      }
    )
  })
}

function statusLabel(label: string): StoreOpenStatus {
  return status('unknown', label)
}
