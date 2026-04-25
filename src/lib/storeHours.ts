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

function contactPlaceQuery(contact: Contact): string {
  return [
    contact.company || contact.name,
    contact.address,
    contact.city,
    contact.state,
    contact.zip,
  ].filter(Boolean).join(', ')
}

function findPlaceId(service: GooglePlacesService, contact: Contact): Promise<string | null> {
  const query = contactPlaceQuery(contact)
  if (!query) return Promise.resolve(null)
  if (placeIdCache.has(query)) return Promise.resolve(placeIdCache.get(query)!)

  return new Promise((resolve) => {
    service.findPlaceFromQuery({ query, fields: ['place_id'] }, (results, status) => {
      if (status !== 'OK' || !results?.[0]?.place_id) {
        resolve(null)
        return
      }
      placeIdCache.set(query, results[0].place_id)
      resolve(results[0].place_id)
    })
  })
}

function readOpenState(place: GooglePlaceResult | null): StoreOpenStatus {
  const now = Date.now()
  if (!place || place.business_status === 'CLOSED_PERMANENTLY') {
    return { state: 'unknown', label: 'Hours unknown', updatedAt: now }
  }

  const isOpen = place.opening_hours?.isOpen?.() ?? place.opening_hours?.open_now
  if (isOpen === true) return { state: 'open', label: 'Open now', updatedAt: now }
  if (isOpen === false) return { state: 'closed', label: 'Closed now', updatedAt: now }
  return { state: 'unknown', label: 'Hours unknown', updatedAt: now }
}

export async function getStoreOpenStatus(contact: Contact): Promise<StoreOpenStatus> {
  if (!hasMapsKey()) return { state: 'unknown', label: 'Hours unavailable', updatedAt: Date.now() }

  const service = await loadPlacesService()
  const placeId = await findPlaceId(service, contact)
  if (!placeId) return { state: 'unknown', label: 'Hours unknown', updatedAt: Date.now() }

  return new Promise((resolve) => {
    service.getDetails(
      { placeId, fields: ['business_status', 'opening_hours'] },
      (result, status) => {
        if (status !== 'OK') {
          resolve({ state: 'unknown', label: 'Hours unknown', updatedAt: Date.now() })
          return
        }
        resolve(readOpenState(result))
      }
    )
  })
}
