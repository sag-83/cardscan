/**
 * A → B multi-day journey.
 *
 * Spreads the drive from start to destination across N days. Day 1 works the
 * first stretch of the corridor, day 2 the next, …, day N arrives at B.
 * This is NOT “drive all the way on day 1, then loop around B.”
 */

import type { Contact } from '../types/contact'
import type { TripItinerary, TripStopSnapshot } from '../types/trip'
import { getCachedPinPoint } from './customerMapPins'
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
import { planRoute, type CostMatrix } from './routeOptimizer'
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

/**
 * Prefer street pin cache (same coords the map shows), then city/ZIP.
 * Keeps itinerary geometry aligned with what the rep sees on the map.
 */
async function locateCheap(c: Contact): Promise<GeoPoint | null> {
  const pin = getCachedPinPoint(c)
  if (pin?.exact) return pin.point

  const city = (c.city ?? '').trim()
  const state = (c.state ?? '').trim()
  if (city) {
    const cached = getCachedCityCoords(city, state)
    if (cached) return pin?.point ?? cached
    const cityPt = await geocodeCityCoords(city, state)
    if (cityPt) return pin?.point ?? cityPt
  }
  if (pin?.point) return pin.point
  const zip = (c.zip ?? '').trim()
  if (zip) return await geocodePostalCode(zip)
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
 * Density of shops within `radiusMiles` of a seed — prefer jewelry packs
 * over lonely highway exits (only inside today's corridor stretch).
 */
function clusterDensity(seed: Located, pool: Located[], radiusMiles: number): number {
  let n = 0
  for (const o of pool) {
    if (distanceBetween(seed.point, o.point) <= radiusMiles) n++
  }
  return n
}

/**
 * Pick up to `limit` shops inside today's corridor band.
 *
 * Like Google Maps A→B (progress is sacred) + orienteering (max prize / min
 * detour): stay in this day's stretch of the highway, prefer a tight cluster
 * on/near that stretch, never wander back toward the start.
 */
function selectBandCluster(
  candidates: Located[],
  origin: GeoPoint,
  limit: number,
  targetAlong: number,
): Located[] {
  if (!candidates.length || limit <= 0) return []
  if (candidates.length <= limit) {
    return orderLocatedTowardEnd(origin, candidates)
  }

  const RADIUS = 12
  let bestSeed = candidates[0]
  let bestScore = -Infinity
  for (const seed of candidates) {
    const dens = clusterDensity(seed, candidates, RADIUS)
    // Progress toward today's band midpoint beats a denser cluster behind us.
    const alongPenalty = Math.abs(seed.alongMiles - targetAlong) * 0.55
    const score = dens * 8
      + seed.score * 2
      - seed.detourMiles * 0.5
      - alongPenalty
      - distanceBetween(origin, seed.point) * 0.05
    if (score > bestScore) {
      bestScore = score
      bestSeed = seed
    }
  }

  const picked: Located[] = [bestSeed]
  const remaining = candidates.filter((c) => c.contact.id !== bestSeed.contact.id)

  while (picked.length < limit && remaining.length) {
    const centroid = {
      lat: picked.reduce((s, p) => s + p.point.lat, 0) / picked.length,
      lng: picked.reduce((s, p) => s + p.point.lng, 0) / picked.length,
    }
    let bestIdx = 0
    let bestCost = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i]
      const near = Math.min(...picked.map((p) => distanceBetween(p.point, c.point)))
      const toCentroid = distanceBetween(centroid, c.point)
      const alongDrift = Math.abs(c.alongMiles - targetAlong) * 0.4
      // Cheap add to the cluster, still anchored to today's corridor mile.
      const cost = near * 0.55
        + toCentroid * 0.25
        + c.detourMiles * 0.3
        + alongDrift
        - c.score * 0.35
      if (cost < bestCost) {
        bestCost = cost
        bestIdx = i
      }
    }
    picked.push(remaining.splice(bestIdx, 1)[0])
  }

  return orderLocatedTowardEnd(origin, picked)
}

/**
 * TSP order for the day, but always finish at the stop furthest along the
 * A→B corridor — so tomorrow morning is closer to the destination (connected trip).
 */
function orderLocatedTowardEnd(origin: GeoPoint, items: Located[]): Located[] {
  if (items.length <= 1) return items

  // Furthest along the highway becomes the day's "end" (pinned in the TSP).
  let endItem = items[0]
  for (const it of items) {
    if (it.alongMiles > endItem.alongMiles) endItem = it
  }

  const others = items.filter((i) => i.contact.id !== endItem.contact.id)
  if (!others.length) return [endItem]

  // Matrix: 0 = morning origin, 1..n = middle stops, n+1 = day-end (furthest along).
  const middle = others
  const n = middle.length
  const size = n + 2
  const pts: GeoPoint[] = [origin, ...middle.map((i) => i.point), endItem.point]
  const matrix: CostMatrix = Array.from({ length: size }, () => Array(size).fill(0))
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      if (i === j) continue
      matrix[i][j] = distanceBetween(pts[i], pts[j])
    }
  }

  const endIndex = size - 1
  const { order } = planRoute(matrix, {
    candidates: middle.map((_, i) => i + 1),
    limit: n,
    endIndex,
  })

  // order is [0, mid…]; append the pinned end stop.
  const orderedMids = order.slice(1).map((idx) => middle[idx - 1]).filter(Boolean)
  return [...orderedMids, endItem]
}

/**
 * Build an N-day itinerary that progresses from start toward end along the road.
 *
 * Backbone = Google-Maps-style A→B progress (each day owns the next stretch).
 * Inside a stretch = pack the densest nearby shops with a short TSP tour.
 * Clusters never pull the trip backward or skip a whole region to jump to B.
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
  if (req.end.contactId) omit.delete(req.end.contactId)

  const bounds = pathBounds(path, detour + 40)
  const pool = req.contacts.filter((c) => (
    (!omit.has(c.id) || c.id === req.end.contactId)
    && matchesAudience(c, req.priority, req.end.contactId)
  ))

  req.onProgress?.('Shortlisting shops near the route (not the whole country)…')

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
    if (!inBounds(point, bounds)) continue

    const { miles, alongMiles } = distanceToPolyline(point, path)
    if (miles > detour) continue
    if (alongMiles < 0.5) continue

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

  // Equal corridor slices — day 1 owns the first stretch, day N the last.
  // Soft edges let a thin band borrow a little, but never steal tomorrow's region.
  const band = Math.max(1, totalMiles / dayCount)
  const soft = band * 0.2
  const days: TripItinerary['days'] = []
  const remaining = new Map(located.map((c) => [c.contact.id, c]))

  let cursorAlong = 0
  let cursorPoint = req.start.point
  let cursorLabel = req.start.label

  for (let d = 0; d < dayCount; d++) {
    throwIfAborted(req.signal)
    const isLast = d === dayCount - 1
    // Hard progressive bands along A→B (the Google Maps backbone).
    const bandLo = d * band
    const bandHi = (d + 1) * band
    const targetAlong = (bandLo + bandHi) / 2
    // Soft pad for sparse stretches; last day takes everything left to the end.
    const windowLo = Math.max(0, bandLo - soft)
    const windowHi = isLast ? totalMiles + 1 : bandHi + soft

    req.onProgress?.(
      `Day ${d + 1}/${dayCount} · mile ${Math.round(bandLo)}–${Math.round(bandHi)} of the drive…`,
    )

    let poolForDay = [...remaining.values()].filter((c) => {
      if (c.contact.id === req.end.contactId && !isLast) return false
      // Must be in today's stretch (or just ahead of where we slept if behind band).
      if (c.alongMiles < Math.min(cursorAlong - 5, windowLo)) return false
      if (c.alongMiles > windowHi) return false
      // Prefer not to revisit miles we already passed (stay progressive).
      if (!isLast && c.alongMiles < bandLo - soft * 1.5 && c.alongMiles < cursorAlong - 2) {
        return false
      }
      return true
    })

    // Sparse band: gently widen toward B only (never back toward A).
    if (!isLast && poolForDay.length < stopsPerDay) {
      let hi = windowHi
      while (poolForDay.length < stopsPerDay && hi < bandHi + band * 0.55) {
        hi += band * 0.15
        poolForDay = [...remaining.values()].filter((c) => {
          if (c.contact.id === req.end.contactId) return false
          return c.alongMiles >= Math.min(cursorAlong - 5, windowLo)
            && c.alongMiles <= hi
            && c.alongMiles >= bandLo - soft * 1.5
        })
      }
    }

    if (isLast) {
      poolForDay = [...remaining.values()].filter((c) => (
        c.alongMiles >= Math.min(cursorAlong - 5, windowLo)
      ))
    }

    poolForDay.sort((a, b) => a.alongMiles - b.alongMiles || a.detourMiles - b.detourMiles)

    if (!poolForDay.length) {
      if (!isLast) {
        // Still advance the cursor so we don't stall in PA forever.
        cursorAlong = Math.max(cursorAlong, bandHi)
        continue
      }
      break
    }

    let picked = selectBandCluster(poolForDay, cursorPoint, stopsPerDay, targetAlong)

    // Last day: arrive at the destination shop.
    if (isLast && req.end.contactId) {
      const dest = remaining.get(req.end.contactId)
        ?? located.find((c) => c.contact.id === req.end.contactId)
      if (dest) {
        const without = picked.filter((p) => p.contact.id !== dest.contact.id)
        while (without.length >= stopsPerDay) {
          // Drop the shop least along / furthest from dest area.
          without.sort((a, b) => a.alongMiles - b.alongMiles)
          without.shift()
        }
        without.push(dest)
        picked = orderLocatedTowardEnd(cursorPoint, without)
        const destIdx = picked.findIndex((p) => p.contact.id === dest.contact.id)
        if (destIdx >= 0 && destIdx !== picked.length - 1) {
          const [dStop] = picked.splice(destIdx, 1)
          picked.push(dStop)
        }
      }
    }

    if (!picked.length) {
      cursorAlong = Math.max(cursorAlong, bandHi)
      if (!isLast) continue
      break
    }

    for (const p of picked) remaining.delete(p.contact.id)

    const lastStop = picked[picked.length - 1]
    const endLabel = isLast
      ? req.end.label
      : (lastStop.contact.company || lastStop.contact.name || lastStop.contact.city || `Day ${d + 1} end`)

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

    // Tomorrow starts further along A→B — never teleport, never drift backward.
    cursorAlong = Math.max(lastStop.alongMiles, bandHi * 0.85, cursorAlong)
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

export interface ReplaceJourneyStopRequest {
  itinerary: TripItinerary
  dayIndex: number
  removeContactId: string
  contacts: Contact[]
  /** Keep filling until the day has this many shops (usually itinerary.stopsPerDay). */
  targetStopsPerDay: number
  maxNearbyMiles: number
  priority: TripPriority
  /**
   * Shops the user already dismissed this trip — never put them back as
   * replacements (includes the shop being removed).
   */
  bannedIds?: Set<string>
  signal?: AbortSignal
}

export interface ReplaceJourneyStopResult {
  itinerary: TripItinerary
  removedName: string
  addedNames: string[]
}

/**
 * Remove a shop from a day and backfill with nearby unused shops so the
 * day's quota stays full (remove 2 of 10 → add 2 *different* nearby shops).
 * The removed shop is never put back.
 */
export async function replaceJourneyStop(
  req: ReplaceJourneyStopRequest,
): Promise<ReplaceJourneyStopResult> {
  throwIfAborted(req.signal)

  const day = req.itinerary.days.find((d) => d.dayIndex === req.dayIndex)
  if (!day) throw new Error('That day is not on this trip.')

  const removeIdx = day.stops.findIndex((s) => s.contactId === req.removeContactId)
  if (removeIdx < 0) throw new Error('That shop is not on this day.')

  const removed = day.stops[removeIdx]
  const removedName = removed.company || removed.name || 'Shop'

  // Already on the trip OR previously dismissed — never re-use as a refill.
  const blocked = new Set<string>(req.bannedIds)
  blocked.add(req.removeContactId)
  for (const d of req.itinerary.days) {
    for (const s of d.stops) blocked.add(s.contactId)
  }

  // Anchor near the removed shop (or a neighbor) so the replacement stays local.
  const removedContact = req.contacts.find((c) => c.id === req.removeContactId)
  let anchor = removedContact ? await locateCheap(removedContact) : null
  if (!anchor) {
    const neighbor = day.stops[removeIdx - 1] || day.stops[removeIdx + 1]
    const nc = neighbor && req.contacts.find((c) => c.id === neighbor.contactId)
    if (nc) anchor = await locateCheap(nc)
  }
  if (!anchor) {
    const nextStops = day.stops.filter((s) => s.contactId !== req.removeContactId)
    return {
      itinerary: patchDayStops(req.itinerary, req.dayIndex, nextStops),
      removedName,
      addedNames: [],
    }
  }

  const need = Math.max(0, req.targetStopsPerDay - (day.stops.length - 1))
  const added: TripStopSnapshot[] = []
  const addedNames: string[] = []

  if (need > 0) {
    const candidates: Array<{ contact: Contact; point: GeoPoint; miles: number; score: number }> = []
    for (const c of req.contacts) {
      throwIfAborted(req.signal)
      if (blocked.has(c.id)) continue
      if (!matchesAudience(c, req.priority)) continue
      const point = await locateCheap(c)
      if (!point) continue
      const miles = distanceBetween(anchor, point)
      if (miles > req.maxNearbyMiles) continue
      candidates.push({
        contact: c,
        point,
        miles,
        score: priorityScore(c, req.priority),
      })
    }

    // Closest first, then audience score — user wants exposure nearby, not the same shop.
    candidates.sort((a, b) => a.miles - b.miles || b.score - a.score)

    for (const cand of candidates) {
      if (added.length >= need) break
      if (blocked.has(cand.contact.id)) continue
      blocked.add(cand.contact.id)
      const snap = snapshot(cand.contact)
      added.push(snap)
      addedNames.push(snap.company || snap.name || 'Shop')
    }
  }

  const nextStops = [...day.stops]
  nextStops.splice(removeIdx, 1, ...added)

  return {
    itinerary: patchDayStops(req.itinerary, req.dayIndex, nextStops),
    removedName,
    addedNames,
  }
}

/** Reorder stops within a day (drag / move up-down). */
export function reorderDayStops(
  itinerary: TripItinerary,
  dayIndex: number,
  fromIndex: number,
  toIndex: number,
): TripItinerary {
  const day = itinerary.days.find((d) => d.dayIndex === dayIndex)
  if (!day) return itinerary
  if (
    fromIndex < 0 || toIndex < 0
    || fromIndex >= day.stops.length
    || toIndex >= day.stops.length
    || fromIndex === toIndex
  ) {
    return itinerary
  }
  const stops = [...day.stops]
  const [moved] = stops.splice(fromIndex, 1)
  stops.splice(toIndex, 0, moved)
  return patchDayStops(itinerary, dayIndex, stops)
}

export interface InsertStopResult {
  itinerary: TripItinerary
  dayIndex: number
  /** 0-based position in that day's list. */
  insertedAt: number
  shopName: string
}

/**
 * Add a shop to an existing itinerary: pick the day whose trail is closest,
 * then cheapest-insert into that day's order (live reroute, no full rebuild).
 */
export async function insertStopIntoItinerary(req: {
  itinerary: TripItinerary
  contact: Contact
  point: GeoPoint
  contacts: Contact[]
}): Promise<InsertStopResult> {
  const { itinerary, contact, point, contacts } = req
  const shopName = contact.company || contact.name || 'Shop'

  for (const d of itinerary.days) {
    if (d.stops.some((s) => s.contactId === contact.id)) {
      throw new Error(`${shopName} is already on Day ${d.dayIndex}.`)
    }
  }

  // Resolve coords for every stop already on the trip (map pin cache first).
  const pointById = new Map<string, GeoPoint>()
  pointById.set(contact.id, point)
  for (const d of itinerary.days) {
    for (const s of d.stops) {
      if (pointById.has(s.contactId)) continue
      const c = contacts.find((x) => x.id === s.contactId)
      if (!c) continue
      const pt = await locateCheap(c)
      if (pt) pointById.set(s.contactId, pt)
    }
  }

  // Closest day = min distance from the new pin to any stop (or day polyline).
  let bestDay = itinerary.days[0]?.dayIndex ?? 1
  let bestDist = Infinity
  for (const d of itinerary.days) {
    const pts = d.stops
      .map((s) => pointById.get(s.contactId))
      .filter((p): p is GeoPoint => Boolean(p))
    if (!pts.length) {
      // Empty day — treat as far unless it's the only option.
      continue
    }
    let dayDist = Infinity
    for (const p of pts) {
      dayDist = Math.min(dayDist, distanceBetween(point, p))
    }
    // Also score against segments of the day's trail.
    for (let i = 0; i < pts.length - 1; i++) {
      const { miles } = distanceToPolyline(point, [pts[i], pts[i + 1]])
      dayDist = Math.min(dayDist, miles)
    }
    if (dayDist < bestDist) {
      bestDist = dayDist
      bestDay = d.dayIndex
    }
  }

  const day = itinerary.days.find((d) => d.dayIndex === bestDay)
  if (!day) throw new Error('No day to add that stop to.')

  const dayPts = day.stops
    .map((s) => pointById.get(s.contactId))
    .filter((p): p is GeoPoint => Boolean(p))

  const insertAt = cheapestInsertIndex(dayPts, point)
  const nextStops = [...day.stops]
  nextStops.splice(insertAt, 0, snapshot(contact))

  return {
    itinerary: patchDayStops(itinerary, bestDay, nextStops),
    dayIndex: bestDay,
    insertedAt: insertAt,
    shopName,
  }
}

/** Remove a shop from whichever day it sits on (no auto-refill — used by map toggle). */
export function removeStopFromItinerary(
  itinerary: TripItinerary,
  contactId: string,
): TripItinerary {
  const day = itinerary.days.find((d) => d.stops.some((s) => s.contactId === contactId))
  if (!day) return itinerary
  const next = day.stops.filter((s) => s.contactId !== contactId)
  return patchDayStops(itinerary, day.dayIndex, next)
}

/** Index that minimizes added trail length when inserting `newPoint` into an ordered day. */
function cheapestInsertIndex(dayPts: GeoPoint[], newPoint: GeoPoint): number {
  if (!dayPts.length) return 0
  if (dayPts.length === 1) {
    // Closer to sitting after vs before the single stop — either is fine; after keeps progress.
    return 1
  }

  let bestIdx = dayPts.length
  let bestDelta = distanceBetween(dayPts[dayPts.length - 1], newPoint)

  // Insert before first.
  const before = distanceBetween(newPoint, dayPts[0])
  if (before < bestDelta) {
    bestDelta = before
    bestIdx = 0
  }

  for (let i = 0; i < dayPts.length - 1; i++) {
    const was = distanceBetween(dayPts[i], dayPts[i + 1])
    const now = distanceBetween(dayPts[i], newPoint) + distanceBetween(newPoint, dayPts[i + 1])
    const delta = now - was
    if (delta < bestDelta) {
      bestDelta = delta
      bestIdx = i + 1
    }
  }

  return bestIdx
}

export interface ManualJourneyPick {
  contactId: string
  label: string
  point: GeoPoint
  address?: string
}

export interface PlanJourneyFromPicksRequest {
  start: TripOrigin
  end: { label: string; point: GeoPoint; contactId?: string }
  dayCount: number
  stopsPerDay: number
  minutesPerStop: number
  picks: ManualJourneyPick[]
  contacts: Contact[]
  filterState: string
  filterCity: string
  filterArea: string
  onProgress?: (label: string) => void
  signal?: AbortSignal
}

/**
 * User picked the shops on the map. Split them into an efficient N-day
 * corridor itinerary from start → end (respecting shops/day).
 */
export async function planJourneyFromPicks(
  req: PlanJourneyFromPicksRequest,
): Promise<TripItinerary> {
  const dayCount = Math.max(1, Math.min(21, Math.round(req.dayCount)))
  const stopsPerDay = Math.max(1, Math.min(30, Math.round(req.stopsPerDay)))

  throwIfAborted(req.signal)
  if (!req.picks.length) {
    throw new Error('Tap shops on the map (Add stop) before building from your picks.')
  }

  req.onProgress?.('Routing start → destination…')
  const route = await fetchDrivingRoute(req.start.point, req.end.point, req.signal)
  const path = route?.geometry?.length
    ? route.geometry
    : straightCorridor(req.start.point, req.end.point)
  const totalMiles = route?.miles ?? pathLengthMiles(path) * 1.05

  const byId = new Map(req.contacts.map((c) => [c.id, c]))
  type Ranked = { pick: ManualJourneyPick; contact: Contact | null; alongMiles: number; point: GeoPoint }
  const ranked: Ranked[] = []

  for (const pick of req.picks) {
    throwIfAborted(req.signal)
    if (req.end.contactId && pick.contactId === req.end.contactId) continue
    const { alongMiles } = distanceToPolyline(pick.point, path)
    ranked.push({
      pick,
      contact: byId.get(pick.contactId) ?? null,
      alongMiles,
      point: pick.point,
    })
  }

  ranked.sort((a, b) => a.alongMiles - b.alongMiles)
  // User chose these shops deliberately — use all of them.
  const use = ranked

  req.onProgress?.(`Ordering ${use.length} shops across ${dayCount} days…`)

  // Slice the corridor into day bands by along-miles, then pack ≤ stopsPerDay each.
  const band = Math.max(1, totalMiles / dayCount)
  const buckets: Ranked[][] = Array.from({ length: dayCount }, () => [])

  for (const item of use) {
    let day = Math.min(dayCount - 1, Math.max(0, Math.floor(item.alongMiles / band)))
    // Prefer an earlier day if this band is full.
    while (day < dayCount - 1 && buckets[day].length >= stopsPerDay) day++
    // If last day is full too, still append (user selected these shops).
    if (buckets[day].length >= stopsPerDay && day > 0) {
      // Try previous days with space.
      let placed = false
      for (let d = 0; d < dayCount; d++) {
        if (buckets[d].length < stopsPerDay) {
          buckets[d].push(item)
          placed = true
          break
        }
      }
      if (!placed) buckets[day].push(item)
    } else {
      buckets[day].push(item)
    }
  }

  // Fold empty early days forward so we don't emit blank days in the middle.
  const nonEmpty = buckets.filter((b) => b.length > 0)
  if (!nonEmpty.length && !req.end.contactId) {
    throw new Error('Could not place your picks on this route.')
  }
  while (nonEmpty.length < dayCount && req.end.contactId) {
    // Keep day count if end shop will land on the last day alone.
    break
  }

  const days: TripItinerary['days'] = []
  let cursorPoint = req.start.point
  let cursorLabel = req.start.label

  const daySlices = nonEmpty.length ? nonEmpty : [[]]
  // Ensure we have at least `min(dayCount, picks)` day slots; pad last with end.
  const finalDayCount = Math.min(dayCount, Math.max(1, daySlices.length))

  for (let d = 0; d < finalDayCount; d++) {
    throwIfAborted(req.signal)
    const isLast = d === finalDayCount - 1
    let items = [...(daySlices[d] || [])]

    if (isLast && req.end.contactId) {
      const endContact = byId.get(req.end.contactId)
      if (endContact && !items.some((i) => i.pick.contactId === req.end.contactId)) {
        items = items.filter((i) => i.pick.contactId !== req.end.contactId)
        items.push({
          pick: {
            contactId: req.end.contactId,
            label: req.end.label,
            point: req.end.point,
          },
          contact: endContact,
          alongMiles: totalMiles,
          point: req.end.point,
        })
      }
    }

    // Efficient visit order within the day (straight-line TSP heuristic).
    const ordered = orderDayStops(cursorPoint, items, isLast && req.end.contactId ? req.end.point : null)

    let dayMiles = 0
    let prev = cursorPoint
    for (const item of ordered) {
      dayMiles += distanceBetween(prev, item.point) * 1.25
      prev = item.point
    }

    const stops: TripStopSnapshot[] = ordered.map((item) => (
      item.contact
        ? snapshot(item.contact)
        : {
            contactId: item.pick.contactId,
            name: item.pick.label,
            company: item.pick.label,
            city: '',
            state: '',
            address: item.pick.address || '',
          }
    ))

    const last = ordered[ordered.length - 1]
    const endLabel = isLast
      ? req.end.label
      : (last?.contact?.company || last?.contact?.name || last?.pick.label || `Day ${d + 1} end`)

    const dayIndex = days.length + 1
    days.push({
      dayIndex,
      kind: 'travel',
      title: isLast
        ? `Day ${dayIndex} · arrive ${shortLabel(req.end.label)}`
        : `Day ${dayIndex} · from ${shortLabel(cursorLabel)}`,
      originLabel: cursorLabel,
      endLabel,
      stops,
      totalMiles: dayMiles,
      driveMinutes: estimateDriveMinutes(dayMiles / 1.25),
      visitMinutes: stops.length * Math.max(0, req.minutesPerStop),
    })

    if (last) {
      cursorPoint = last.point
      cursorLabel = last.contact?.company || last.contact?.name || last.pick.label || endLabel
    }
  }

  if (!days.length) {
    throw new Error('Could not build a trip from your picks.')
  }

  return {
    id: newTripId('journey-picks'),
    created_at: new Date().toISOString(),
    label: `${shortLabel(req.start.label)} → ${shortLabel(req.end.label)} · ${days.length} day${days.length === 1 ? '' : 's'} (your picks)`,
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

type RankedPick = {
  pick: ManualJourneyPick
  contact: Contact | null
  alongMiles: number
  point: GeoPoint
}

function orderDayStops(
  origin: GeoPoint,
  items: RankedPick[],
  endPoint: GeoPoint | null,
): RankedPick[] {
  if (items.length <= 1) return items

  // Matrix: 0 = day start, 1..n = stops, optionally n+1 = end (not visited as stop).
  const n = items.length
  const hasEnd = Boolean(endPoint)
  const size = n + 1 + (hasEnd ? 1 : 0)
  const pts: GeoPoint[] = [origin, ...items.map((i) => i.point)]
  if (hasEnd && endPoint) pts.push(endPoint)

  const matrix: CostMatrix = Array.from({ length: size }, () => Array(size).fill(0))
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      if (i === j) continue
      matrix[i][j] = distanceBetween(pts[i], pts[j])
    }
  }

  const endIndex = hasEnd ? size - 1 : null
  const candidates = items.map((_, i) => i + 1)
  const { order } = planRoute(matrix, {
    candidates,
    limit: n,
    endIndex,
  })

  // order is [0, stopIdx…]; drop origin
  return order.slice(1).map((idx) => items[idx - 1]).filter(Boolean)
}

function patchDayStops(
  itinerary: TripItinerary,
  dayIndex: number,
  stops: TripStopSnapshot[],
): TripItinerary {
  return {
    ...itinerary,
    days: itinerary.days.map((d) => {
      if (d.dayIndex !== dayIndex) return d
      const perStop = d.stops.length
        ? Math.round(d.visitMinutes / Math.max(1, d.stops.length))
        : 30
      return {
        ...d,
        stops,
        visitMinutes: stops.length * perStop,
        endLabel: stops.length
          ? (stops[stops.length - 1].company || stops[stops.length - 1].name || d.endLabel)
          : d.endLabel,
      }
    }),
  }
}
