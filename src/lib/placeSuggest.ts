/**
 * Address / customer typeahead for trip start/end.
 *
 * Priority:
 *  1. Local contacts (name / company → their saved address)
 *  2. Google Places Autocomplete when a Maps key is configured
 *  3. Photon (Komoot) — fast free geocoder, good for partial addresses
 *  4. Nominatim as a last-resort fallback
 *
 * Google predictions are returned immediately (place_id only). Coordinates
 * are fetched when the user picks a row — waiting on getDetails for every
 * prediction was why the dropdown often stayed empty.
 */

import type { Contact } from '../types/contact'
import { geocodeContactLocation, searchPlaces, type GeoPoint, type PlaceSuggestion } from './geocode'
import { loadGooglePlacesLibrary, mapsKeyAvailable } from './storeHours'

export type { PlaceSuggestion }

export interface TripPlaceSuggestion extends PlaceSuggestion {
  /** Shown under the main label (address for contacts, secondary line for Google). */
  subtitle?: string
  kind: 'place' | 'contact'
  /** Google Places id — resolve with {@link resolveTripPlace} on pick. */
  placeId?: string
  contactId?: string
}

const CONTACT_LIMIT = 5
const PLACE_LIMIT = 6

function contactAddressLine(c: Contact): string {
  return [c.address, c.city, c.state, c.zip].filter(Boolean).join(', ').trim()
}

function contactHasMappableAddress(c: Contact): boolean {
  return Boolean((c.address || c.city || c.zip || '').trim())
}

function normalizeQuery(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Loose match so "s n y jovi" hits "S.N.Y. Jovi" / "SNY Jovi Jewelry". */
function scoreContact(query: string, contact: Contact): number {
  const q = normalizeQuery(query)
  if (q.length < 2) return 0

  const name = normalizeQuery(contact.name || '')
  const company = normalizeQuery(contact.company || '')
  const haystacks = [name, company].filter(Boolean)
  if (!haystacks.length) return 0

  let best = 0
  for (const hay of haystacks) {
    if (hay === q) best = Math.max(best, 100)
    else if (hay.startsWith(q)) best = Math.max(best, 90)
    else if (hay.includes(q)) best = Math.max(best, 70)

    // Token match: every query word appears somewhere in name/company.
    const tokens = q.split(' ').filter(Boolean)
    if (tokens.length > 1 && tokens.every((t) => hay.includes(t))) {
      best = Math.max(best, 80)
    }

    // Compact alphanumeric: "snyjovi" ↔ "s n y jovi"
    const compactQ = q.replace(/[^a-z0-9]/g, '')
    const compactH = hay.replace(/[^a-z0-9]/g, '')
    if (compactQ.length >= 3 && compactH.includes(compactQ)) {
      best = Math.max(best, 75)
    }
  }

  if (contact.is_customer) best += 5
  return best
}

export function suggestContacts(query: string, contacts: Contact[]): TripPlaceSuggestion[] {
  const q = normalizeQuery(query)
  if (q.length < 2) return []

  return contacts
    .filter(contactHasMappableAddress)
    .map((c) => ({ contact: c, score: scoreContact(q, c) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || (a.contact.name || '').localeCompare(b.contact.name || ''))
    .slice(0, CONTACT_LIMIT)
    .map(({ contact: c }) => {
      const title = (c.company || c.name || 'Contact').trim()
      const who = c.company && c.name && c.company !== c.name ? c.name : ''
      const address = contactAddressLine(c)
      return {
        label: title,
        subtitle: [who, address].filter(Boolean).join(' · '),
        // Filled in on pick via resolveTripPlace.
        point: { lat: 0, lng: 0 },
        exact: Boolean(c.address?.trim()),
        kind: 'contact' as const,
        contactId: c.id,
      }
    })
}

async function suggestFromGoogle(query: string, signal?: AbortSignal): Promise<TripPlaceSuggestion[]> {
  const ready = await loadGooglePlacesLibrary()
  if (!ready || signal?.aborted) return []

  const Autocomplete = window.google?.maps?.places?.AutocompleteService
  if (!Autocomplete) return []

  const autocomplete = new Autocomplete()

  const predictions = await new Promise<Array<{
    description: string
    place_id: string
    main?: string
    secondary?: string
  }>>((resolve) => {
    autocomplete.getPlacePredictions(
      {
        input: query,
        componentRestrictions: { country: 'us' },
      },
      (results, status) => {
        if (status !== 'OK' || !results) {
          resolve([])
          return
        }
        resolve(results.map((row) => ({
          description: row.description,
          place_id: row.place_id,
          main: row.structured_formatting?.main_text,
          secondary: row.structured_formatting?.secondary_text,
        })))
      },
    )
  })

  if (signal?.aborted || predictions.length === 0) return []

  // Return predictions immediately — coords come from resolveTripPlace on pick.
  return predictions.slice(0, PLACE_LIMIT).map((prediction) => ({
    label: prediction.main || prediction.description,
    subtitle: prediction.secondary || (prediction.main ? prediction.description : undefined),
    point: { lat: 0, lng: 0 },
    exact: true,
    kind: 'place' as const,
    placeId: prediction.place_id,
  }))
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] }
  properties?: {
    name?: string
    street?: string
    housenumber?: string
    city?: string
    town?: string
    village?: string
    state?: string
    postcode?: string
    country?: string
    countrycode?: string
    osm_value?: string
  }
}

async function suggestFromPhoton(query: string, signal?: AbortSignal): Promise<TripPlaceSuggestion[]> {
  const url = new URL('https://photon.komoot.io/api/')
  url.searchParams.set('q', query)
  url.searchParams.set('limit', String(PLACE_LIMIT))
  url.searchParams.set('lang', 'en')
  // Bias toward the mid-Atlantic / Northeast where most of this library lives.
  url.searchParams.set('lat', '40.75')
  url.searchParams.set('lon', '-74.0')

  const res = await fetch(url.toString(), { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) return []
  const data = await res.json() as { features?: PhotonFeature[] }
  const features = Array.isArray(data.features) ? data.features : []

  const seen = new Set<string>()
  const out: TripPlaceSuggestion[] = []

  for (const feature of features) {
    const coords = feature.geometry?.coordinates
    const p = feature.properties
    if (!coords || !p) continue

    const cc = (p.countrycode || '').toLowerCase()
    if (cc && cc !== 'us') continue

    const [lng, lat] = coords
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue

    const street = [p.housenumber, p.street].filter(Boolean).join(' ')
    const town = p.city || p.town || p.village || ''
    const region = [p.state, p.postcode].filter(Boolean).join(' ')
    const label = [street || p.name || '', town, region].filter(Boolean).join(', ')
      || p.name
      || ''
    if (!label || seen.has(label)) continue
    seen.add(label)

    const exact = Boolean(street) || p.osm_value === 'house' || p.osm_value === 'building'
    out.push({
      label,
      subtitle: p.name && street && p.name !== street ? p.name : undefined,
      point: { lat, lng },
      exact,
      kind: 'place',
    })
  }

  return out
}

function dedupePlaces(items: TripPlaceSuggestion[]): TripPlaceSuggestion[] {
  const seen = new Set<string>()
  const out: TripPlaceSuggestion[] = []
  for (const item of items) {
    const key = `${item.kind}:${item.contactId || item.placeId || item.label.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

/**
 * Combined typeahead: contacts first, then map places.
 * Pass `contacts` so customer names resolve to their card addresses.
 */
export async function suggestPlaces(
  text: string,
  signal?: AbortSignal,
  contacts: Contact[] = [],
): Promise<TripPlaceSuggestion[]> {
  const query = text.trim()
  if (query.length < 2) return []

  const contactHits = suggestContacts(query, contacts)

  let placeHits: TripPlaceSuggestion[] = []

  if (mapsKeyAvailable()) {
    try {
      placeHits = await suggestFromGoogle(query, signal)
    } catch {
      /* fall through */
    }
  }

  if ((!placeHits.length || placeHits.length < 3) && !signal?.aborted) {
    try {
      const photon = await suggestFromPhoton(query, signal)
      placeHits = dedupePlaces([...placeHits, ...photon])
    } catch {
      /* fall through */
    }
  }

  if (!placeHits.length && !signal?.aborted) {
    try {
      const nomi = await searchPlaces(query, signal)
      placeHits = nomi.map((hit) => ({
        ...hit,
        kind: 'place' as const,
      }))
    } catch {
      placeHits = []
    }
  }

  if (signal?.aborted) return []
  return dedupePlaces([...contactHits, ...placeHits]).slice(0, CONTACT_LIMIT + PLACE_LIMIT)
}

async function resolveGooglePlaceId(
  placeId: string,
  signal?: AbortSignal,
): Promise<{ label: string; point: GeoPoint } | null> {
  const ready = await loadGooglePlacesLibrary()
  if (!ready || signal?.aborted) return null

  const Places = window.google?.maps?.places?.PlacesService
  if (!Places) return null
  const service = new Places(document.createElement('div'))

  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(null)
      return
    }
    service.getDetails(
      { placeId, fields: ['formatted_address', 'geometry', 'name'] },
      (result, status) => {
        if (signal?.aborted || status !== 'OK' || !result?.geometry?.location) {
          resolve(null)
          return
        }
        const location = result.geometry.location
        resolve({
          label: result.formatted_address || result.name || '',
          point: { lat: location.lat(), lng: location.lng() },
        })
      },
    )
  })
}

/**
 * Turn a picked suggestion into a concrete lat/lng + display label.
 * Contacts are geocoded from their card address; Google rows use Place Details.
 */
export async function resolveTripPlace(
  suggestion: TripPlaceSuggestion,
  contacts: Contact[] = [],
  signal?: AbortSignal,
): Promise<PlaceSuggestion | null> {
  if (suggestion.kind === 'contact' && suggestion.contactId) {
    const contact = contacts.find((c) => c.id === suggestion.contactId)
    if (!contact) return null
    const loc = await geocodeContactLocation(contact)
    if (!loc || signal?.aborted) return null
    const address = contactAddressLine(contact)
    const title = (contact.company || contact.name || suggestion.label).trim()
    return {
      label: address ? `${title} — ${address}` : title,
      point: loc.point,
      exact: !loc.approximate,
    }
  }

  if (suggestion.placeId) {
    const resolved = await resolveGooglePlaceId(suggestion.placeId, signal)
    if (!resolved || signal?.aborted) return null
    return {
      label: resolved.label || suggestion.label,
      point: resolved.point,
      exact: true,
    }
  }

  // Photon / Nominatim already have coordinates.
  if (
    Number.isFinite(suggestion.point.lat)
    && Number.isFinite(suggestion.point.lng)
    && (suggestion.point.lat !== 0 || suggestion.point.lng !== 0)
  ) {
    return {
      label: suggestion.label,
      point: suggestion.point,
      exact: suggestion.exact,
    }
  }

  return null
}
