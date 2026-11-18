/**
 * Multi-leg road trips: drive A → B with jewelry stopovers along the corridor,
 * then optionally explore around B for N days, then onward B → C, and so on.
 *
 * This is the general form of "I'm leaving New Jersey for Virginia (and maybe
 * further)": each leg is origin → destination, not a single-radius day plan.
 */

import type { Contact } from '../types/contact'
import type { TripItinerary, TripStopSnapshot } from '../types/trip'
import {
  distanceBetween,
  distanceToPolyline,
  estimateDriveMinutes,
  type GeoPoint,
} from './geoMath'
import {
  geocodeCityCoords,
  geocodeContactLocation,
  geocodePostalCode,
  getCachedCityCoords,
} from './geocode'
import { newTripId, snapshotFromPlan } from './tripHistory'
import { fetchDrivingRoute } from './osrm'
import {
  planTrip,
  type TripOptions,
  type TripOrigin,
  type TripPriority,
  type TripProgress,
} from './tripPlanner'

export interface RoadTripDestination {
  label: string
  point: GeoPoint
  /** When the destination is a customer, pin them as the arrival stop. */
  contactId?: string
}

export interface RoadTripLegInput {
  destination: RoadTripDestination
  /** Jewelry visits near the highway on the travel day. */
  maxStopovers: number
  maxDetourMiles: number
  /** 0 = arrive and stop; >0 = radius days from the destination. */
  exploreDays: number
  exploreStopsPerDay: number
  exploreRadiusMiles: number
  exploreMinutesPerStop: number
  priority: TripPriority
}

export interface RoadTripRequest {
  start: TripOrigin
  legs: RoadTripLegInput[]
  contacts: Contact[]
  omitIds: Set<string>
  filterState: string
  filterCity: string
  filterArea: string
  onProgress?: (label: string, progress?: TripProgress) => void
  signal?: AbortSignal
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}

function snapshotContact(c: Contact): TripStopSnapshot {
  return {
    contactId: c.id,
    name: c.name || '',
    company: c.company || '',
    city: c.city || '',
    state: c.state || '',
    address: c.address || '',
  }
}

function priorityScore(c: Contact, priority: TripPriority): number {
  if (priority === 'customers') {
    if (c.is_customer) return 3
    if (c.is_old_customer) return 2
    return 0
  }
  if (priority === 'prospects') return c.is_customer ? 0 : 2
  if (priority === 'goods-shown') return c.visited ? 3 : 0
  if (priority === 'convert') return c.visited && !c.is_customer ? 3 + c.stars : 0
  if (priority === 'top-rated') return c.stars
  return c.is_customer ? 1 : 0
}

async function locateContact(c: Contact): Promise<{ point: GeoPoint; approximate: boolean } | null> {
  const street = (c.address ?? '').trim()
  if (street) {
    const hit = await geocodeContactLocation(c)
    if (hit) return { point: hit.point, approximate: hit.approximate }
  }
  const city = (c.city ?? '').trim()
  const state = (c.state ?? '').trim()
  if (city) {
    const point = getCachedCityCoords(city, state) ?? await geocodeCityCoords(city, state)
    if (point) return { point, approximate: true }
  }
  const zip = (c.zip ?? '').trim()
  if (zip) {
    const point = await geocodePostalCode(zip)
    if (point) return { point, approximate: true }
  }
  return null
}

function straightCorridor(from: GeoPoint, to: GeoPoint): GeoPoint[] {
  // Fallback when OSRM is unavailable — still lets us score "along the way".
  const steps = 24
  const path: GeoPoint[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    path.push({
      lat: from.lat + (to.lat - from.lat) * t,
      lng: from.lng + (to.lng - from.lng) * t,
    })
  }
  return path
}

interface CorridorCandidate {
  contact: Contact
  point: GeoPoint
  alongMiles: number
  detourMiles: number
  score: number
}

async function pickCorridorStopovers(
  pool: Contact[],
  path: GeoPoint[],
  maxStopovers: number,
  maxDetourMiles: number,
  priority: TripPriority,
  onProgress?: (label: string) => void,
  signal?: AbortSignal,
): Promise<CorridorCandidate[]> {
  if (maxStopovers <= 0) return []

  const found: CorridorCandidate[] = []
  let i = 0
  for (const contact of pool) {
    throwIfAborted(signal)
    i++
    if (i % 8 === 0) onProgress?.(contact.company || contact.name || 'Contact')

    const located = await locateContact(contact)
    if (!located) continue

    const { miles, alongMiles } = distanceToPolyline(located.point, path)
    if (miles > maxDetourMiles) continue

    // Skip people sitting on top of the start or end (explore days cover those).
    let pathMiles = 0
    for (let s = 0; s < path.length - 1; s++) pathMiles += distanceBetween(path[s], path[s + 1])
    if (alongMiles < 8 || (pathMiles > 0 && alongMiles > pathMiles - 8)) continue

    found.push({
      contact,
      point: located.point,
      alongMiles,
      detourMiles: miles,
      score: priorityScore(contact, priority),
    })
  }

  found.sort((a, b) => (
    b.score - a.score
    || a.alongMiles - b.alongMiles
    || a.detourMiles - b.detourMiles
  ))

  // Keep geographic spread along the route: greedy take next if far enough
  // along from the last pick, otherwise fill remaining slots.
  const picked: CorridorCandidate[] = []
  const MIN_GAP_MILES = 12
  for (const cand of found) {
    if (picked.length >= maxStopovers) break
    const tooClose = picked.some((p) => Math.abs(p.alongMiles - cand.alongMiles) < MIN_GAP_MILES)
    if (tooClose) continue
    picked.push(cand)
  }
  if (picked.length < maxStopovers) {
    for (const cand of found) {
      if (picked.length >= maxStopovers) break
      if (picked.some((p) => p.contact.id === cand.contact.id)) continue
      picked.push(cand)
    }
  }

  return picked.sort((a, b) => a.alongMiles - b.alongMiles)
}

export async function planRoadTrip(req: RoadTripRequest): Promise<TripItinerary> {
  if (!req.legs.length) throw new Error('Add at least one destination for the road trip.')

  const omit = new Set(req.omitIds)
  const days: TripItinerary['days'] = []
  let origin = req.start
  let dayIndex = 0

  for (let legIndex = 0; legIndex < req.legs.length; legIndex++) {
    throwIfAborted(req.signal)
    const leg = req.legs[legIndex]
    const dest = leg.destination

    req.onProgress?.(`Routing to ${dest.label}…`)

    const route = await fetchDrivingRoute(origin.point, dest.point, req.signal)
    const path = route?.geometry?.length
      ? route.geometry
      : straightCorridor(origin.point, dest.point)
    const driveMiles = route?.miles ?? estimateRoadMilesFallback(origin.point, dest.point)
    const driveMinutes = route?.minutes ?? estimateDriveMinutes(distanceBetween(origin.point, dest.point))

    const pool = req.contacts.filter((c) => !omit.has(c.id) && c.id !== dest.contactId)
    req.onProgress?.(`Finding stopovers toward ${dest.label}…`)

    const stopovers = await pickCorridorStopovers(
      pool,
      path,
      leg.maxStopovers,
      leg.maxDetourMiles,
      leg.priority,
      (label) => req.onProgress?.(`Stopovers · ${label}`),
      req.signal,
    )

    for (const s of stopovers) omit.add(s.contact.id)

    const travelStops: TripStopSnapshot[] = stopovers.map((s) => snapshotContact(s.contact))

    // Arrival: preferred customer, if the destination was picked from contacts.
    if (dest.contactId) {
      const arrival = req.contacts.find((c) => c.id === dest.contactId)
      if (arrival && !omit.has(arrival.id)) {
        travelStops.push(snapshotContact(arrival))
        omit.add(arrival.id)
      }
    }

    dayIndex++
    const visitMinutes = travelStops.length * Math.max(0, leg.exploreMinutesPerStop)
    days.push({
      dayIndex,
      kind: 'travel',
      title: `Drive to ${shortLabel(dest.label)}${travelStops.length ? ` · ${stopovers.length} stopover${stopovers.length === 1 ? '' : 's'}` : ''}`,
      originLabel: origin.label,
      endLabel: dest.label,
      stops: travelStops,
      totalMiles: driveMiles,
      driveMinutes,
      visitMinutes,
    })

    // Explore days around the destination base.
    for (let e = 0; e < leg.exploreDays; e++) {
      throwIfAborted(req.signal)
      const exploreOrigin: TripOrigin = { label: dest.label, point: dest.point }
      const explorePool = req.contacts.filter((c) => !omit.has(c.id))
      if (!explorePool.length) break

      req.onProgress?.(
        `Exploring near ${dest.label} · day ${e + 1}`,
        undefined,
      )

      try {
        const plan = await planTrip(
          explorePool,
          exploreOrigin,
          null,
          {
            radiusMiles: leg.exploreRadiusMiles,
            maxStops: leg.exploreStopsPerDay,
            minutesPerStop: leg.exploreMinutesPerStop,
            priority: leg.priority,
          } satisfies TripOptions,
          (progress) => req.onProgress?.(`Explore · ${dest.label}`, progress),
          req.signal,
        )

        if (!plan.stops.length) break
        for (const stop of plan.stops) omit.add(stop.contact.id)

        dayIndex++
        days.push({
          dayIndex,
          kind: 'explore',
          title: `Explore ${shortLabel(dest.label)} · day ${e + 1}`,
          originLabel: dest.label,
          endLabel: '',
          stops: snapshotFromPlan(plan),
          totalMiles: plan.totalMiles,
          driveMinutes: plan.driveMinutes,
          visitMinutes: plan.visitMinutes,
        })
      } catch {
        break
      }
    }

    // Next leg starts from this destination.
    origin = { label: dest.label, point: dest.point }
  }

  if (!days.length) {
    throw new Error('Could not build this road trip — try a wider detour or fewer filters.')
  }

  const last = req.legs[req.legs.length - 1]?.destination
  return {
    id: newTripId('road'),
    created_at: new Date().toISOString(),
    label: roadTripLabel(req.start.label, req.legs.map((l) => l.destination.label)),
    dayCount: days.length,
    stopsPerDay: req.legs[0]?.exploreStopsPerDay || req.legs[0]?.maxStopovers || 8,
    originLabel: req.start.label,
    endLabel: last?.label ?? '',
    filterState: req.filterState,
    filterCity: req.filterCity,
    filterArea: req.filterArea,
    days,
  }
}

function estimateRoadMilesFallback(a: GeoPoint, b: GeoPoint): number {
  return distanceBetween(a, b) * 1.3
}

function shortLabel(label: string): string {
  const parts = label.split(',').map((p) => p.trim()).filter(Boolean)
  if (parts.length <= 2) return label
  return parts.slice(0, 2).join(', ')
}

function roadTripLabel(start: string, destinations: string[]): string {
  const chain = [shortLabel(start), ...destinations.map(shortLabel)]
  if (chain.length <= 3) return chain.join(' → ')
  return `${chain[0]} → … → ${chain[chain.length - 1]} · ${destinations.length} legs`
}
