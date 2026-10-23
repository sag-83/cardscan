/**
 * Keeps the last planned route when the Trips screen unmounts.
 *
 * Screens are mounted only while visible so a 700-card Contacts list is not
 * sitting in the DOM during a call. Without this, switching to Contacts and
 * back would wipe a plan he just spent a minute computing.
 */

import type { TripEnd, TripOrigin, TripPlan } from './tripPlanner'

export interface TripSession {
  plan: TripPlan | null
  excluded: string[]
  lastRun: { origin: TripOrigin; end: TripEnd | null } | null
  startPlaceLabel: string
  filterState: string
  filterCity: string
  filterArea: string
  filterType: string
  minStars: number
  setupOpen: boolean
  error: string
}

let session: TripSession | null = null

export function readTripSession(): TripSession | null {
  return session
}

export function writeTripSession(next: TripSession): void {
  session = next
}
