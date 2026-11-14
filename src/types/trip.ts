/**
 * Logged field trips — the memory that keeps day 2 from re-suggesting day 1.
 *
 * A "trip log" is one planned day. Confirming visits at the end of the day
 * records who was actually seen; those contact ids are omitted from later
 * plans in the same territory until the user clears history.
 */

export interface TripStopSnapshot {
  contactId: string
  name: string
  company: string
  city: string
  state: string
  address: string
}

export interface TripLog {
  id: string
  /** ISO timestamp when the route was saved / confirmed. */
  logged_at: string
  /** Day the visits happened (YYYY-MM-DD, local). */
  day: string
  originLabel: string
  endLabel: string
  filterState: string
  filterCity: string
  filterArea: string
  /** Stops that were on the plan, in order. */
  planned: TripStopSnapshot[]
  /** Subset of planned that the rep confirmed they visited. */
  visitedIds: string[]
  /** Planned but not visited (left for another day). */
  skippedIds: string[]
  /** Multi-day itinerary this day belongs to, if any. */
  itineraryId?: string
  dayIndex?: number
  dayCount?: number
  synced?: boolean
}

export interface TripItinerary {
  id: string
  created_at: string
  label: string
  dayCount: number
  stopsPerDay: number
  originLabel: string
  endLabel: string
  filterState: string
  filterCity: string
  filterArea: string
  /** One planned day each — visits confirmed later via TripLog. */
  days: Array<{
    dayIndex: number
    /** travel = corridor drive day; explore = radius day at a stopover base */
    kind?: 'travel' | 'explore' | 'area'
    title?: string
    originLabel: string
    endLabel: string
    stops: TripStopSnapshot[]
    totalMiles: number
    driveMinutes: number
    visitMinutes: number
  }>
}

export interface TerritoryProgress {
  state: string
  city: string
  /** Contacts in the current filter scope. */
  inScope: number
  /** Confirmed visited on any logged trip (matching scope). */
  loggedVisited: number
  /** Still never confirmed on a trip. */
  remaining: number
  /** Distinct trip days logged for this scope. */
  tripDays: number
}
