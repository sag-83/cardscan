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
  if (priority === 'prospects') return c.is_customer ? 0 : 2
  if (priority === 'top-rated') return c.stars
  return c.is_customer ? 1 : 0
}

/** Hard filter: customers only / non-customers only / everyone. */
function matchesAudience(c: Contact, priority: TripPriority, endContactId?: string): boolean {
  if (endContactId && c.id === endContactId) return true
  if (priority === 'customers') return Boolean(c.is_customer || c.is_old_customer)
  if (priority === 'prospects') return !c.is_customer
  return true
}

/** City/ZIP only — fast enough to scan the library; street geocode is unnecessary for corridor banding. */
async function locateCheap(c: Contact): Promise<GeoPoint | null> {
  const city = (c.city ?? '').trim()
  const state = (c.state ?? '').trim()
  if (city) {
    const cached = getCachedCityCoords(city, state)
    if (cached) return cached
    return await geocodeCityCoords(city, state)
  }
  const zip = (c.zip ?? '').trim()
  if (zip) return await geocodePostalCode(zip)
  // Last resort: street (rare contacts with address but no city).
  const street = (c.address ?? '').trim()
  if (street) {
    const hit = await geocodeContactLocation(c)
    if (hit) return hit.point
  }
  return null
}

interface LatLngBounds {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
}

function pathBounds(path: GeoPoint[], padMiles: number): LatLngBounds {
  let minLat = Infinity
  let maxLat = -Infinity
  let minLng = Infinity
  let maxLng = -Infinity
  for (const p of path) {
    minLat = Math.min(minLat, p.lat)
    maxLat = Math.max(maxLat, p.lat)
    minLng = Math.min(minLng, p.lng)
    maxLng = Math.max(maxLng, p.lng)
  }
  const midLat = (minLat + maxLat) / 2
  const padLat = padMiles / 69
  const padLng = padMiles / Math.max(0.2, 69 * Math.cos((midLat * Math.PI) / 180))
  return {
    minLat: minLat - padLat,
    maxLat: maxLat + padLat,
    minLng: minLng - padLng,
    maxLng: maxLng + padLng,
  }
}

function inBounds(p: GeoPoint, b: LatLngBounds): boolean {
  return p.lat >= b.minLat && p.lat <= b.maxLat && p.lng >= b.minLng && p.lng <= b.maxLng
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

  // Don't scan Texas when the drive is PA → VA: audience + corridor bounding box first.
  const bounds = pathBounds(path, detour + 40)
  const pool = req.contacts.filter((c) => (
    ( !omit.has(c.id) || c.id === req.end.contactId )
    && matchesAudience(c, req.priority, req.end.contactId)
  ))

  req.onProgress?.(`Shortlisting shops near the route (not the whole country)…`)

  const located: Located[] = []
  let i = 0
  for (const contact of pool) {
    throwIfAborted(req.signal)
    i++
    if (i % 15 === 0) {
      req.onProgress?.(
        `Checking shops near the route · ${i}/${pool.length} (kept ${located.length})`,
      )
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

    const point = await locateCheap(contact)
    if (!point) continue
    // Far from the A→B box (e.g. Texas on a PA→VA trip) — skip before corridor math.
    if (!inBounds(point, bounds)) continue

    const { miles, alongMiles } = distanceToPolyline(point, path)
    if (miles > detour) continue
    if (alongMiles < 5) continue

    located.push({
      contact,
      point,
      alongMiles,
      detourMiles: miles,
      score: priorityScore(contact, req.priority),
    })
  }

  req.onProgress?.(
    `Using ${located.length} shops along the corridor (skipped ${Math.max(0, pool.length - located.length)} far away)`,
  )

  // Chain days like a real trip: day 2 starts where day 1 ended (Passaic → next),
  // never jump ahead to a far stretch of the highway.
  const band = totalMiles / dayCount
  const days: TripItinerary['days'] = []
  const used = new Set<string>()

  let cursorAlong = 0
  let cursorPoint = req.start.point
  let cursorLabel = req.start.label

  for (let d = 0; d < dayCount; d++) {
    throwIfAborted(req.signal)
    const isLast = d === dayCount - 1
    // Soft ceiling so we don't burn tomorrow's corridor today — but always
    // continue from the cursor, never teleport.
    const targetHi = (d + 1) * band

    req.onProgress?.(`Planning day ${d + 1} of ${dayCount}…`)

    // Only shops still ahead of (or right next to) where we slept last night.
    let ahead = located.filter((c) => {
      if (used.has(c.contact.id)) return false
      if (c.contact.id === req.end.contactId && !isLast) return false
      return c.alongMiles >= cursorAlong - 3
    })

    if (!isLast) {
      // Prefer the next stretch; allow a little overrun if the band is thin.
      const capped = ahead.filter((c) => c.alongMiles <= targetHi + band * 0.35)
      if (capped.length >= Math.min(3, stopsPerDay)) ahead = capped
    }

    // Walk the corridor in order. When two shops are close, keep the better score.
    ahead.sort((a, b) => a.alongMiles - b.alongMiles || b.score - a.score || a.detourMiles - b.detourMiles)

    const picked: Located[] = []
    const minGap = 3
    for (const cand of ahead) {
      if (picked.length >= stopsPerDay) break
      const tooClose = picked.some((p) => Math.abs(p.alongMiles - cand.alongMiles) < minGap)
      if (tooClose) {
        // Replace prior pick if this one is clearly better and almost same place.
        const last = picked[picked.length - 1]
        if (last && Math.abs(last.alongMiles - cand.alongMiles) < minGap && cand.score > last.score) {
          picked[picked.length - 1] = cand
        }
        continue
      }
      picked.push(cand)
    }

    // Last day: arrive at the destination shop.
    if (isLast && req.end.contactId) {
      const dest = located.find((c) => c.contact.id === req.end.contactId)
      if (dest?.contact) {
        const without = picked.filter((p) => p.contact.id !== dest.contact.id)
        while (without.length >= stopsPerDay) without.shift()
        without.push(dest)
        picked.length = 0
        picked.push(...without)
      }
    }

    if (!picked.length) {
      if (!isLast) continue
      days.push({
        dayIndex: days.length + 1,
        kind: 'travel',
        title: `Day ${days.length + 1} · arrive ${shortLabel(req.end.label)}`,
        originLabel: cursorLabel,
        endLabel: req.end.label,
        stops: [],
        totalMiles: Math.max(0, totalMiles - cursorAlong),
        driveMinutes: estimateDriveMinutes(Math.max(0, totalMiles - cursorAlong) / 1.3),
        visitMinutes: 0,
      })
      break
    }

    for (const p of picked) used.add(p.contact.id)

    const lastStop = picked[picked.length - 1]
    const endLabel = isLast
      ? req.end.label
      : (lastStop.contact.company || lastStop.contact.name || lastStop.contact.city || `Day ${d + 1} end`)

    // Miles from last night's end → each stop today (connected web).
    let dayMiles = 0
    let prev = cursorPoint
    for (const p of picked) {
      dayMiles += distanceBetween(prev, p.point) * 1.25
      prev = p.point
    }

    const dayIndex = days.length + 1
    days.push({
      dayIndex,
      kind: 'travel',
      title: isLast
        ? `Day ${dayIndex} · arrive ${shortLabel(req.end.label)}`
        : `Day ${dayIndex} · from ${shortLabel(cursorLabel)}`,
      originLabel: cursorLabel,
      endLabel,
      stops: picked.map((p) => snapshot(p.contact)),
      totalMiles: dayMiles,
      driveMinutes: estimateDriveMinutes(dayMiles / 1.25),
      visitMinutes: picked.length * Math.max(0, req.minutesPerStop),
    })

    // Tomorrow morning starts here — where today ended.
    cursorAlong = lastStop.alongMiles
    cursorPoint = lastStop.point
    cursorLabel = lastStop.contact.company || lastStop.contact.name || endLabel
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
