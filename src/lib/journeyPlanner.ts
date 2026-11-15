/**
 * A → B multi-day journey.
 *
 * Spreads the drive from start to destination across N days. Day 1 works the
 * first stretch of the corridor, day 2 the next, …, day N arrives at B.
 * This is NOT “drive all the way on day 1, then loop around B.”
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
import { newTripId } from './tripHistory'
import { fetchDrivingRoute } from './osrm'
import type { TripOrigin, TripPriority, TripProgress } from './tripPlanner'

export interface JourneyRequest {
  start: TripOrigin
  end: { label: string; point: GeoPoint; contactId?: string }
  dayCount: number
  stopsPerDay: number
  /** How far off the A→B highway a shop can be. */
  maxDetourMiles: number
  minutesPerStop: number
  priority: TripPriority
  contacts: Contact[]
  omitIds: Set<string>
  filterState: string
  filterCity: string
  filterArea: string
  onProgress?: (label: string, progress?: TripProgress) => void
  signal?: AbortSignal
}

interface Located {
  contact: Contact
  point: GeoPoint
  alongMiles: number
  detourMiles: number
  score: number
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}

function snapshot(c: Contact): TripStopSnapshot {
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
  if (priority === 'top-rated') return c.stars
  return c.is_customer ? 1 : 0
}

async function locateContact(c: Contact): Promise<{ point: GeoPoint } | null> {
  const street = (c.address ?? '').trim()
  if (street) {
    const hit = await geocodeContactLocation(c)
    if (hit) return { point: hit.point }
  }
  const city = (c.city ?? '').trim()
  const state = (c.state ?? '').trim()
  if (city) {
    const point = getCachedCityCoords(city, state) ?? await geocodeCityCoords(city, state)
    if (point) return { point }
  }
  const zip = (c.zip ?? '').trim()
  if (zip) {
    const point = await geocodePostalCode(zip)
    if (point) return { point }
  }
  return null
}

function straightCorridor(from: GeoPoint, to: GeoPoint): GeoPoint[] {
  const steps = 32
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

function pathLengthMiles(path: GeoPoint[]): number {
  let miles = 0
  for (let i = 0; i < path.length - 1; i++) miles += distanceBetween(path[i], path[i + 1])
  return miles
}

function shortLabel(label: string): string {
  const parts = label.split(/[·,—,]/).map((p) => p.trim()).filter(Boolean)
  if (parts.length <= 2) return label
  return parts.slice(0, 2).join(', ')
}

/**
 * Build an N-day itinerary that progresses from start toward end along the road.
 */
export async function planJourney(req: JourneyRequest): Promise<TripItinerary> {
  const dayCount = Math.max(1, Math.min(21, Math.round(req.dayCount)))
  const stopsPerDay = Math.max(2, Math.min(30, Math.round(req.stopsPerDay)))
  const detour = Math.max(5, Math.min(80, req.maxDetourMiles))

  throwIfAborted(req.signal)
  req.onProgress?.('Routing start → destination…')

  const route = await fetchDrivingRoute(req.start.point, req.end.point, req.signal)
  const path = route?.geometry?.length
    ? route.geometry
    : straightCorridor(req.start.point, req.end.point)
  const totalMiles = route?.miles ?? pathLengthMiles(path) * 1.05

  const omit = new Set(req.omitIds)
  if (req.end.contactId) omit.delete(req.end.contactId) // allow end shop on last day

  const pool = req.contacts.filter((c) => !omit.has(c.id) || c.id === req.end.contactId)
  const located: Located[] = []
  let i = 0
  for (const contact of pool) {
    throwIfAborted(req.signal)
    i++
    if (i % 10 === 0) {
      req.onProgress?.(`Finding shops along the route · ${i}/${pool.length}`)
    }
    if (contact.id === req.end.contactId) {
      located.push({
        contact,
        point: req.end.point,
        alongMiles: totalMiles,
        detourMiles: 0,
        score: 99,
      })
      continue
    }
    const hit = await locateContact(contact)
    if (!hit) continue
    const { miles, alongMiles } = distanceToPolyline(hit.point, path)
    if (miles > detour) continue
    // Skip shops sitting on top of the start.
    if (alongMiles < 5) continue
    located.push({
      contact,
      point: hit.point,
      alongMiles,
      detourMiles: miles,
      score: priorityScore(contact, req.priority),
    })
  }

  // Slice the corridor into dayCount bands by distance along the route.
  const band = totalMiles / dayCount
  const days: TripItinerary['days'] = []
  const used = new Set<string>()

  for (let d = 0; d < dayCount; d++) {
    throwIfAborted(req.signal)
    const lo = d * band
    const hi = (d + 1) * band
    const isLast = d === dayCount - 1

    req.onProgress?.(`Planning day ${d + 1} of ${dayCount}…`)

    // Shops whose position along A→B falls in this day's stretch.
    // Last day also takes anything past the previous bands.
    let bandPool = located.filter((c) => {
      if (used.has(c.contact.id)) return false
      if (isLast) return c.alongMiles >= lo - band * 0.15
      return c.alongMiles >= lo - band * 0.05 && c.alongMiles < hi + band * 0.05
    })

    bandPool.sort((a, b) => (
      b.score - a.score
      || a.alongMiles - b.alongMiles
      || a.detourMiles - b.detourMiles
    ))

    // Spread picks along the day's stretch so we don't cluster one exit.
    const picked: Located[] = []
    const minGap = Math.max(4, (hi - lo) / Math.max(stopsPerDay, 2) * 0.35)
    for (const cand of bandPool) {
      if (picked.length >= stopsPerDay) break
      if (cand.contact.id === req.end.contactId && !isLast) continue
      const tooClose = picked.some((p) => Math.abs(p.alongMiles - cand.alongMiles) < minGap)
      if (tooClose) continue
      picked.push(cand)
    }
    // Fill remaining slots without gap constraint.
    if (picked.length < stopsPerDay) {
      for (const cand of bandPool) {
        if (picked.length >= stopsPerDay) break
        if (cand.contact.id === req.end.contactId && !isLast) continue
        if (picked.some((p) => p.contact.id === cand.contact.id)) continue
        picked.push(cand)
      }
    }

    picked.sort((a, b) => a.alongMiles - b.alongMiles)

    // Last day: ensure destination shop is the final stop.
    if (isLast && req.end.contactId) {
      const dest = located.find((c) => c.contact.id === req.end.contactId)
        ?? {
          contact: req.contacts.find((c) => c.id === req.end.contactId)!,
          point: req.end.point,
          alongMiles: totalMiles,
          detourMiles: 0,
          score: 99,
        }
      if (dest?.contact) {
        const without = picked.filter((p) => p.contact.id !== dest.contact.id)
        without.push(dest)
        picked.length = 0
        picked.push(...without.slice(-stopsPerDay))
        picked.sort((a, b) => a.alongMiles - b.alongMiles)
        // Force dest last
        const only = picked.filter((p) => p.contact.id !== dest.contact.id)
        only.push(dest)
        picked.length = 0
        picked.push(...only)
      }
    }

    if (!picked.length && !isLast) continue
    if (!picked.length && isLast) {
      // Still emit a day that ends at the destination label even with no shops.
      days.push({
        dayIndex: d + 1,
        kind: 'travel',
        title: `Day ${d + 1} · arrive ${shortLabel(req.end.label)}`,
        originLabel: days.length ? days[days.length - 1].endLabel || req.start.label : req.start.label,
        endLabel: req.end.label,
        stops: [],
        totalMiles: band,
        driveMinutes: estimateDriveMinutes(band / 1.3),
        visitMinutes: 0,
      })
      break
    }

    for (const p of picked) used.add(p.contact.id)

    const originLabel = d === 0
      ? req.start.label
      : (days[days.length - 1]?.stops.slice(-1)[0]
        ? (days[days.length - 1].stops.slice(-1)[0].company
          || days[days.length - 1].stops.slice(-1)[0].name
          || days[days.length - 1].endLabel)
        : req.start.label)

    const lastStop = picked[picked.length - 1]
    const endLabel = isLast
      ? req.end.label
      : (lastStop.contact.company || lastStop.contact.name || lastStop.contact.city || `Day ${d + 1} end`)

    let dayMiles = 0
    let prev = d === 0 ? req.start.point : picked[0].point
    if (d === 0) {
      for (const p of picked) {
        dayMiles += distanceBetween(prev, p.point) * 1.25
        prev = p.point
      }
    } else {
      prev = picked[0].point
      for (let s = 1; s < picked.length; s++) {
        dayMiles += distanceBetween(prev, picked[s].point) * 1.25
        prev = picked[s].point
      }
    }

    const visitMinutes = picked.length * Math.max(0, req.minutesPerStop)
    const driveMinutes = estimateDriveMinutes(dayMiles / 1.25)

    days.push({
      dayIndex: d + 1,
      kind: 'travel',
      title: isLast
        ? `Day ${d + 1} · arrive ${shortLabel(req.end.label)}`
        : `Day ${d + 1} · toward ${shortLabel(req.end.label)}`,
      originLabel,
      endLabel,
      stops: picked.map((p) => snapshot(p.contact)),
      totalMiles: dayMiles,
      driveMinutes,
      visitMinutes,
    })
  }

  if (!days.length) {
    throw new Error(
      'Could not place shops along this route. Try favouring everyone, a wider area, or more days.',
    )
  }

  return {
    id: newTripId('journey'),
    created_at: new Date().toISOString(),
    label: `${shortLabel(req.start.label)} → ${shortLabel(req.end.label)} · ${days.length} day${days.length === 1 ? '' : 's'}`,
    dayCount: days.length,
    stopsPerDay,
    originLabel: req.start.label,
    endLabel: req.end.label,
    filterState: req.filterState,
    filterCity: req.filterCity,
    filterArea: req.filterArea,
    days,
  }
}
