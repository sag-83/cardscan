/**
 * Address typeahead for trip start/end.
 *
 * Google Places is used when a Maps key is already configured (the same one
 * store-hours uses), because that's the list people expect from typing in
 * Maps. Nominatim is the fallback so the box still works without a key, and
 * so a quota failure doesn't leave the user typing into a dead field.
 */

import { searchPlaces, type PlaceSuggestion } from './geocode'
import { loadGooglePlacesLibrary, mapsKeyAvailable } from './storeHours'

export type { PlaceSuggestion }

interface GooglePlaceDetails {
  formatted_address?: string
  name?: string
  geometry?: { location?: { lat: () => number; lng: () => number } }
}

export async function suggestPlaces(
  text: string,
  signal?: AbortSignal,
): Promise<PlaceSuggestion[]> {
  const query = text.trim()
  if (query.length < 3) return []

  if (mapsKeyAvailable()) {
    try {
      const googleHits = await suggestFromGoogle(query, signal)
      if (signal?.aborted) return []
      if (googleHits.length > 0) return googleHits
    } catch {
      /* fall through — Nominatim still answers */
    }
  }

  if (signal?.aborted) return []
  return searchPlaces(query, signal)
}

async function suggestFromGoogle(
  query: string,
  signal?: AbortSignal,
): Promise<PlaceSuggestion[]> {
  const ready = await loadGooglePlacesLibrary()
  if (!ready || signal?.aborted) return []

  const Autocomplete = window.google?.maps?.places?.AutocompleteService
  const Places = window.google?.maps?.places?.PlacesService
  if (!Autocomplete || !Places) return []

  const autocomplete = new Autocomplete()
  const details = new Places(document.createElement('div'))

  const predictions = await new Promise<Array<{ description: string; place_id: string }>>((resolve) => {
    autocomplete.getPlacePredictions(
      { input: query, componentRestrictions: { country: 'us' } },
      (results, status) => {
        if (status !== 'OK' || !results) {
          resolve([])
          return
        }
        resolve(results.map((row) => ({ description: row.description, place_id: row.place_id })))
      },
    )
  })

  if (signal?.aborted || predictions.length === 0) return []

  const resolved = await Promise.all(
    predictions.slice(0, 6).map((prediction) => resolvePlace(details, prediction, signal)),
  )
  return resolved.filter((item): item is PlaceSuggestion => item !== null)
}

function resolvePlace(
  service: { getDetails: GooglePlacesGetDetails },
  prediction: { description: string; place_id: string },
  signal?: AbortSignal,
): Promise<PlaceSuggestion | null> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(null)
      return
    }
    service.getDetails(
      { placeId: prediction.place_id, fields: ['formatted_address', 'geometry', 'name'] },
      (result, status) => {
        if (signal?.aborted || status !== 'OK' || !result?.geometry?.location) {
          resolve(null)
          return
        }
        const location = result.geometry.location
        resolve({
          label: result.formatted_address || prediction.description,
          point: { lat: location.lat(), lng: location.lng() },
          exact: true,
        })
      },
    )
  })
}

type GooglePlacesGetDetails = (
  request: { placeId: string; fields: string[] },
  callback: (result: GooglePlaceDetails | null, status: string) => void,
) => void
