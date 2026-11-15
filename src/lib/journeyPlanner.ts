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
 * Density of shops within `radiusMiles` of a seed — used to prefer jewelry
 * clusters over lonely highway exits.
 */
function clusterDensity(seed: Located, pool: Located[], radiusMiles: number): number {
  let n = 0
  for (const o of pool) {
    if (distanceBetween(seed.point, o.point) <= radiusMiles) n++
  }
  return n
}

/**
 * Grow a tight cluster up to `limit` shops: seed the densest pocket near the
 * corridor, then repeatedly add the shop that adds the least travel to the
 * cluster (cheapest insertion into the set). Maximizes stops / mile.
 */
function selectDenseCluster(
  candidates: Located[],
  origin: GeoPoint,
  limit: number,
): Located[] {
  if (!candidates.length || limit <= 0) return []
  if (candidates.length <= limit) return orderLocatedStops(origin, candidates)

  const RADIUS = 14
  let bestSeed = candidates[0]
  let bestScore = -Infinity
  for (const seed of candidates) {
    const dens = clusterDensity(seed, candidates, RADIUS)
    // Density first, then priority, then stay close to the highway and to today.
    const score = dens * 12
      + seed.score * 2
      - seed.detourMiles * 0.4
      - distanceBetween(origin, seed.point) * 0.08
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
      // Prefer near-cluster adds; lightly punish far detours off the corridor.
      const cost = near * 0.65 + toCentroid * 0.35 + c.detourMiles * 0.25 - c.score * 0.4
      if (cost < bestCost) {
        bestCost = cost
        bestIdx = i
      }
    }
    picked.push(remaining.splice(bestIdx, 1)[0])
  }

  return orderLocatedStops(origin, picked)
}

/** TSP order for a day's located stops (origin → stops). */
function orderLocatedStops(origin: GeoPoint, items: Located[]): Located[] {
  if (items.length <= 1) return items

  const n = items.length
  const size = n + 1
  const pts: GeoPoint[] = [origin, ...items.map((i) => i.point)]
  const matrix: CostMatrix = Array.from({ length: size }, () => Array(size).fill(0))
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      if (i === j) continue
      matrix[i][j] = distanceBetween(pts[i], pts[j])
    }
  }

  const { order } = planRoute(matrix, {
    candidates: items.map((_, i) => i + 1),
    limit: n,
    endIndex: null,
  })
  return order.slice(1).map((idx) => items[idx - 1]).filter(Boolean)
}

/**
 * Build an N-day itinerary that progresses from start toward end along the road.
 *
 * Algorithm (max shops, min travel):
 *  1. Shortlist shops near the A→B driving corridor
 *  2. Each day: expand a window ahead of the cursor until ≥ shops/day candidates
 *     exist (so later days still fill the quota when the corridor has shops)
 *  3. Inside the window, grow the densest geographic cluster (set cover / cheapest
 *     insertion) up to shops/day — prefer packs of stores over lonely exits
 *  4. Order that day's stops with cheapest-insertion + 2-opt TSP
 *  5. Chain: tomorrow starts where today ended
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
    // Allow shops near the start (was skipping first 5 mi and starving day 1 density).
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

  const band = Math.max(1, totalMiles / dayCount)
  const days: TripItinerary['days'] = []
  const remaining = new Map(located.map((c) => [c.contact.id, c]))

  let cursorAlong = 0
  let cursorPoint = req.start.point
  let cursorLabel = req.start.label

  for (let d = 0; d < dayCount; d++) {
    throwIfAborted(req.signal)
    const isLast = d === dayCount - 1
    const daysLeft = dayCount - d
    req.onProgress?.(`Planning day ${d + 1} of ${dayCount} · filling ${stopsPerDay} shops…`)

    const available = [...remaining.values()].filter((c) => {
      if (c.contact.id === req.end.contactId && !isLast) return false
      return c.alongMiles >= cursorAlong - 8
    }).sort((a, b) => a.alongMiles - b.alongMiles || a.detourMiles - b.detourMiles)

    if (!available.length) {
      if (!isLast) continue
      break
    }

    // Expand the along-corridor window until we can fill the day's quota
    // (or we hit the end / must leave stock for later days).
    let windowHi = cursorAlong + band * (isLast ? 99 : 1.35)
    let window = available.filter((c) => c.alongMiles <= windowHi)

    const reserveForLater = isLast ? 0 : Math.max(0, (daysLeft - 1) * Math.min(3, stopsPerDay))
    while (
      window.length < stopsPerDay + reserveForLater
      && windowHi < totalMiles + 1
      && !isLast
    ) {
      windowHi += band * 0.45
      window = available.filter((c) => c.alongMiles <= windowHi)
    }

    // Don't hoard: if the window is huge but we need shops, take the densest
    // slice — still leave a fair share for remaining days when possible.
    let poolForDay = window
    if (!isLast && window.length > stopsPerDay) {
      const keepForLater = Math.min(
        window.length - stopsPerDay,
        Math.max(0, (daysLeft - 1) * stopsPerDay),
      )
      // Prefer shops closer to the cursor for today; leave farther ones for later.
      if (keepForLater > 0 && window.length - keepForLater >= Math.min(stopsPerDay, window.length)) {
        poolForDay = window.slice(0, window.length - keepForLater)
        // But never leave today under-quota if shops exist in the window.
        if (poolForDay.length < stopsPerDay) {
          poolForDay = window.slice(0, Math.max(stopsPerDay, window.length - keepForLater))
        }
      }
    }

    if (isLast) poolForDay = available

    let picked = selectDenseCluster(poolForDay, cursorPoint, stopsPerDay)

    // Still short? Pull any remaining ahead shops (ignore reserve) to hit quota.
    if (picked.length < stopsPerDay) {
      const pickedIds = new Set(picked.map((p) => p.contact.id))
      const extra = available.filter((c) => !pickedIds.has(c.contact.id))
      const filled = selectDenseCluster(
        [...picked, ...extra],
        cursorPoint,
        stopsPerDay,
      )
      picked = filled
    }

    // Last day: force destination shop as final stop.
    if (isLast && req.end.contactId) {
      const dest = remaining.get(req.end.contactId)
        ?? located.find((c) => c.contact.id === req.end.contactId)
      if (dest) {
        const without = picked.filter((p) => p.contact.id !== dest.contact.id)
        while (without.length >= stopsPerDay) without.shift()
        without.push(dest)
        picked = orderLocatedStops(cursorPoint, without)
        // Keep dest last even after TSP.
        const destIdx = picked.findIndex((p) => p.contact.id === dest.contact.id)
        if (destIdx >= 0 && destIdx !== picked.length - 1) {
          const [dStop] = picked.splice(destIdx, 1)
          picked.push(dStop)
        }
      }
    }

    if (!picked.length) {
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

    cursorAlong = Math.max(cursorAlong, lastStop.alongMiles)
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
