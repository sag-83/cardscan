/**
 * Multi-day area itinerary — progressive geographic sweep, not onion peeling.
 *
 * Peeling “nearest cluster each day from the same base” zigzagged (day 1 north,
 * day 2 south, day 4 next to day 1…). Instead:
 *
 *   1. Locate shops inside the radius once.
 *   2. Project them onto the principal axis of the territory (from the start
 *      through the cloud) so travel advances in one direction.
 *   3. Slice that ordered list into contiguous day bands.
 *   4. Within each day, cheapest-insertion + 2-opt on road times (same engine
 *      as a single-day plan / TSP heuristic — Dijkstra/A* sit under OSRM for
 *      the road matrix).
 *   5. Chain days: tomorrow starts where today ended — no teleporting.
 */

import type { Contact } from '../types/contact'
import type { TripItinerary } from '../types/trip'
import { distanceBetween } from './geoMath'
import {
  itineraryLabel,
  newTripId,
  snapshotFromPlan,
} from './tripHistory'
import {
  buildPlanFromLocated,
  locateTripCandidates,
  TripPlanError,
  type LocatedContact,
  type TripEnd,
  type TripOptions,
  type TripOrigin,
  type TripProgress,
} from './tripPlanner'

export interface ItineraryRequest {
  contacts: Contact[]
  /** Contact ids to never put on any day (already logged visits, etc.). */
  omitIds: Set<string>
  origin: TripOrigin
  end: TripEnd | null
  dayCount: number
  stopsPerDay: number
  options: Omit<TripOptions, 'maxStops'>
  filterState: string
  filterCity: string
  filterArea: string
  onProgress?: (dayIndex: number, dayCount: number, progress: TripProgress) => void
  signal?: AbortSignal
}

type XY = { x: number; y: number }

function toXY(point: { lat: number; lng: number }, origin: { lat: number; lng: number }): XY {
  const milesPerDegLat = 69.0
  const milesPerDegLng = Math.cos((origin.lat * Math.PI) / 180) * 69.0
  return {
    x: (point.lng - origin.lng) * milesPerDegLng,
    y: (point.lat - origin.lat) * milesPerDegLat,
  }
}

/** Unit vector along the territory’s long axis, pointing into the shop cloud. */
function progressiveAxis(
  origin: { lat: number; lng: number },
  located: LocatedContact[],
): { ux: number; uy: number } {
  const pts = located.map((l) => toXY(l.point, origin))
  if (pts.length === 1) {
    const len = Math.hypot(pts[0].x, pts[0].y) || 1
    return { ux: pts[0].x / len, uy: pts[0].y / len }
  }

  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length

  // 2D covariance → principal eigenvector (power iteration).
  let cxx = 0
  let cyy = 0
  let cxy = 0
  for (const p of pts) {
    const dx = p.x - cx
    const dy = p.y - cy
    cxx += dx * dx
    cyy += dy * dy
    cxy += dx * dy
  }
  let ux = 1
  let uy = 0
  for (let i = 0; i < 12; i++) {
    const nx = cxx * ux + cxy * uy
    const ny = cxy * ux + cyy * uy
    const len = Math.hypot(nx, ny) || 1
    ux = nx / len
    uy = ny / len
  }

  // Face into the cloud from the start (not back toward empty space).
  if (cx * ux + cy * uy < 0) {
    ux = -ux
    uy = -uy
  }
  return { ux, uy }
}

function alongAxis(
  origin: { lat: number; lng: number },
  point: { lat: number; lng: number },
  axis: { ux: number; uy: number },
): number {
  const p = toXY(point, origin)
  return p.x * axis.ux + p.y * axis.uy
}

/**
 * Split an axis-sorted list into `dayCount` contiguous bands.
 * Extra shops beyond stopsPerDay stay in-band as candidates; routing caps them.
 */
function partitionProgressive(
  sorted: LocatedContact[],
  dayCount: number,
  stopsPerDay: number,
): LocatedContact[][] {
  if (!sorted.length) return []
  const bands: LocatedContact[][] = Array.from({ length: dayCount }, () => [])
  const n = sorted.length
  for (let i = 0; i < n; i++) {
    const day = Math.min(dayCount - 1, Math.floor((i * dayCount) / n))
    bands[day].push(sorted[i])
  }

  // Soft balance: if a band is empty, borrow from a neighbour.
  for (let d = 0; d < dayCount; d++) {
    if (bands[d].length > 0) continue
    const donor = bands.find((b) => b.length > stopsPerDay)
    if (!donor) continue
    const move = donor.splice(Math.floor(donor.length / 2), 1)
    bands[d].push(...move)
  }

  return bands.filter((b) => b.length > 0)
}

/** Prefer denser local packs inside a band when it overshoots stopsPerDay. */
function trimBandToBudget(
  band: LocatedContact[],
  cursor: { lat: number; lng: number },
  stopsPerDay: number,
): LocatedContact[] {
  if (band.length <= stopsPerDay) return band

  // Greedy: repeatedly take the shop that keeps the growing set compact
  // (nearest to current centroid / cursor), advancing along the band order.
  const remaining = [...band]
  const picked: LocatedContact[] = []
  let anchor = cursor
  while (picked.length < stopsPerDay && remaining.length) {
    let bestIdx = 0
    let bestScore = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const dist = distanceBetween(anchor, remaining[i].point)
      // Slight preference for earlier-along shops so we don't leap to the
      // far end of the band and leave a hole behind.
      const score = dist + i * 0.15
      if (score < bestScore) {
        bestScore = score
        bestIdx = i
      }
    }
    const [next] = remaining.splice(bestIdx, 1)
    picked.push(next)
    anchor = next.point
  }
  return picked
}

export async function planItinerary(req: ItineraryRequest): Promise<TripItinerary> {
  const dayCount = Math.max(1, Math.min(14, Math.round(req.dayCount)))
  const stopsPerDay = Math.max(2, Math.min(30, Math.round(req.stopsPerDay)))
  const omit = new Set(req.omitIds)
  const pool = req.contacts.filter((c) => !omit.has(c.id))

  if (pool.length === 0) {
    throw new TripPlanError(
      'Could not build an itinerary — no contacts left in range after skipping logged visits.',
    )
  }

  const dayOptions: TripOptions = { ...req.options, maxStops: stopsPerDay }

  req.onProgress?.(0, dayCount, {
    phase: 'scanning',
    done: 0,
    total: 1,
    label: 'Mapping the territory…',
  })

  const { located } = await locateTripCandidates(
    pool,
    req.origin,
    dayOptions,
    (progress) => req.onProgress?.(0, dayCount, progress),
    req.signal,
  )

  if (located.length === 0) {
    throw new TripPlanError(
      `No contacts within ${Math.round(req.options.radiusMiles)} miles of ${req.origin.label}. Try a wider radius.`,
    )
  }

  const axis = progressiveAxis(req.origin.point, located)
  const sorted = [...located].sort((a, b) => (
    alongAxis(req.origin.point, a.point, axis)
    - alongAxis(req.origin.point, b.point, axis)
  ))

  const bands = partitionProgressive(sorted, dayCount, stopsPerDay)
  const days: TripItinerary['days'] = []

  let cursor: TripOrigin = req.origin

  for (let i = 0; i < bands.length; i++) {
    if (req.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    const isLast = i === bands.length - 1
    const bandPicks = trimBandToBudget(bands[i], cursor.point, stopsPerDay)
    if (!bandPicks.length) continue

    req.onProgress?.(i + 1, dayCount, {
      phase: 'routing',
      done: i,
      total: bands.length,
      label: `Day ${i + 1}/${dayCount} · efficient route in this stretch…`,
    })

    // Intermediate days end at the last stop (sleep there / hotel). Final day
    // can still return to the chosen finish (home / start) if set.
    const dayEnd: TripEnd | null = isLast ? req.end : null

    const plan = await buildPlanFromLocated(
      bandPicks,
      cursor,
      dayEnd,
      dayOptions,
      { visitAll: true, signal: req.signal },
    )

    if (plan.stops.length === 0) continue

    const last = plan.stops[plan.stops.length - 1]
    days.push({
      dayIndex: days.length + 1,
      kind: 'area',
      title: `Day ${days.length + 1} · ${last.contact.city || last.contact.state || 'area'}`,
      originLabel: plan.origin.label,
      endLabel: plan.end?.label || (last.contact.company || last.contact.name || ''),
      stops: snapshotFromPlan(plan),
      totalMiles: plan.totalMiles,
      driveMinutes: plan.driveMinutes,
      visitMinutes: plan.visitMinutes,
    })

    // Tomorrow starts where today finished — continuous progress, no teleport.
    cursor = {
      label: last.contact.company || last.contact.name || last.contact.city || `Day ${days.length} end`,
      point: last.point,
    }
  }

  if (days.length === 0) {
    throw new TripPlanError(
      'Could not build an itinerary — no contacts left in range after skipping logged visits.',
    )
  }

  return {
    id: newTripId('itin'),
    created_at: new Date().toISOString(),
    label: itineraryLabel({
      state: req.filterState,
      city: req.filterCity,
      dayCount: days.length,
      originLabel: req.origin.label,
    }),
    dayCount: days.length,
    stopsPerDay,
    originLabel: req.origin.label,
    endLabel: req.end?.label ?? '',
    filterState: req.filterState,
    filterCity: req.filterCity,
    filterArea: req.filterArea,
    days,
  }
}
