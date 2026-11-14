/**
 * Resolve contact pins for the in-app customer map.
 *
 * City/ZIP centroids first (fast, shared cache with Trips / Near Me), then
 * street-level refinement for anyone already in the address cache. Full
 * street geocoding of 700+ cards would take many minutes on Nominatim, so the
 * map opens quickly with town pins and improves what it can.
 */

import type { Contact } from '../types/contact'
import {
  geocodeCityCoords,
  geocodeContactLocation,
  geocodePostalCode,
  getCachedCityCoords,
  type GeoPoint,
} from './geocode'

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

function pinLabel(c: Contact): string {
  return (c.company || c.name || 'Contact').trim()
}

function addressLine(c: Contact): string {
  return [c.address, c.city, c.state, c.zip].filter(Boolean).join(', ')
}

function hasMappableLocation(c: Contact): boolean {
  return Boolean((c.address || c.city || c.zip || '').trim())
}

/** Tiny jitter so contacts in the same city don't stack on one pixel. */
function jitter(point: GeoPoint, seed: string): GeoPoint {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const latNudge = ((h % 1000) / 1000 - 0.5) * 0.04
  const lngNudge = (((h / 1000) % 1000) / 1000 - 0.5) * 0.04
  return { lat: point.lat + latNudge, lng: point.lng + lngNudge }
}

export async function resolveCustomerMapPins(
  contacts: Contact[],
  onProgress?: (done: number, total: number, label: string) => void,
  signal?: AbortSignal,
): Promise<CustomerMapPin[]> {
  const pool = contacts.filter(hasMappableLocation)
  const pins: CustomerMapPin[] = []
  const total = pool.length
  let done = 0

  // ── Phase 1: city / ZIP centroids (shared lookups) ──────────────────────
  const groups = new Map<string, Contact[]>()
  for (const c of pool) {
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
      pins.push({
        id: c.id,
        contactId: c.id,
        label: pinLabel(c),
        kind: c.is_customer ? 'customer' : 'prospect',
        point: jitter(point, c.id),
        approximate: true,
        address: addressLine(c),
        city: c.city || '',
        state: c.state || '',
      })
    }
  }

  // ── Phase 2: street-level where the address cache already has a hit ──────
  // Only try contacts that have a street line — and cap the work so opening
  // the map never hangs on a cold Nominatim queue.
  const STREET_BUDGET = 40
  let refined = 0
  for (const c of pool) {
    if (signal?.aborted || refined >= STREET_BUDGET) break
    if (!(c.address ?? '').trim()) continue
    const hit = await geocodeContactLocation(c)
    if (!hit || hit.approximate) continue
    refined++
    const idx = pins.findIndex((p) => p.contactId === c.id)
    const next: CustomerMapPin = {
      id: c.id,
      contactId: c.id,
      label: pinLabel(c),
      kind: c.is_customer ? 'customer' : 'prospect',
      point: hit.point,
      approximate: false,
      address: addressLine(c),
      city: c.city || '',
      state: c.state || '',
    }
    if (idx >= 0) pins[idx] = next
    else pins.push(next)
  }

  return pins
}

export function googleMapsSearchUrl(pin: CustomerMapPin): string {
  const q = pin.address || `${pin.point.lat},${pin.point.lng}`
  return `https://maps.google.com/?q=${encodeURIComponent(q)}`
}
