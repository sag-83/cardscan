/**
 * Multi-day itinerary: peel the territory like an onion.
 *
 * Day 1 = the best single-day route from the start (same engine as Plan my
 * route). Day 2 = the same planner again with day-1 stops removed. And so on.
 * That keeps each day drivable and naturally works the nearest clusters first
 * — which is what a month in Pennsylvania actually looks like.
 */

import type { Contact } from '../types/contact'
import type { TripItinerary } from '../types/trip'
import {
  itineraryLabel,
  newTripId,
  snapshotFromPlan,
} from './tripHistory'
import {
  planTrip,
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

export async function planItinerary(req: ItineraryRequest): Promise<TripItinerary> {
  const dayCount = Math.max(1, Math.min(14, Math.round(req.dayCount)))
  const stopsPerDay = Math.max(2, Math.min(30, Math.round(req.stopsPerDay)))
  const omit = new Set(req.omitIds)
  const days: TripItinerary['days'] = []

  for (let i = 0; i < dayCount; i++) {
    if (req.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    const pool = req.contacts.filter((c) => !omit.has(c.id))
    if (pool.length === 0) break

    const dayOrigin = i === 0 || !days.length
      ? req.origin
      : {
          // Next day starts where yesterday ended when returning home/start;
          // otherwise keep the same base (hotel / NJ) the user chose.
          label: req.origin.label,
          point: req.origin.point,
        }

    const plan = await planTrip(
      pool,
      dayOrigin,
      req.end,
      { ...req.options, maxStops: stopsPerDay },
      (progress) => req.onProgress?.(i + 1, dayCount, progress),
      req.signal,
    )

    if (plan.stops.length === 0) break

    for (const stop of plan.stops) omit.add(stop.contact.id)

    days.push({
      dayIndex: i + 1,
      originLabel: plan.origin.label,
      endLabel: plan.end?.label ?? '',
      stops: snapshotFromPlan(plan),
      totalMiles: plan.totalMiles,
      driveMinutes: plan.driveMinutes,
      visitMinutes: plan.visitMinutes,
    })
  }

  if (days.length === 0) {
    throw new Error('Could not build an itinerary — no contacts left in range after skipping logged visits.')
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
