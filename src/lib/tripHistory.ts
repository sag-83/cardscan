import type { Contact } from '../types/contact'
import type { TerritoryProgress, TripItinerary, TripLog, TripStopSnapshot } from '../types/trip'
import type { TripPlan } from './tripPlanner'
import { normalizeStateValue } from './usStates'

export function localDayKey(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function newTripId(prefix = 'trip'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function snapshotFromPlan(plan: TripPlan): TripStopSnapshot[] {
  return plan.stops.map((stop) => ({
    contactId: stop.contact.id,
    name: stop.contact.name || '',
    company: stop.contact.company || '',
    city: stop.contact.city || '',
    state: stop.contact.state || '',
    address: stop.contact.address || '',
  }))
}

export function buildTripLog(input: {
  plan: TripPlan
  visitedIds: string[]
  filterState: string
  filterCity: string
  filterArea: string
  itineraryId?: string
  dayIndex?: number
  dayCount?: number
}): TripLog {
  const planned = snapshotFromPlan(input.plan)
  const visitedSet = new Set(input.visitedIds)
  const visitedIds = planned.map((s) => s.contactId).filter((id) => visitedSet.has(id))
  const skippedIds = planned.map((s) => s.contactId).filter((id) => !visitedSet.has(id))

  return {
    id: newTripId(),
    logged_at: new Date().toISOString(),
    day: localDayKey(),
    originLabel: input.plan.origin.label,
    endLabel: input.plan.end?.label ?? '',
    filterState: input.filterState,
    filterCity: input.filterCity,
    filterArea: input.filterArea,
    planned,
    visitedIds,
    skippedIds,
    itineraryId: input.itineraryId,
    dayIndex: input.dayIndex,
    dayCount: input.dayCount,
    synced: false,
  }
}

/** Contact ids confirmed visited on any trip log (optionally scoped). */
export function loggedVisitedIds(
  logs: TripLog[],
  scope?: { state?: string; city?: string; area?: string },
): Set<string> {
  const state = scope?.state ? normalizeStateValue(scope.state) : ''
  const city = (scope?.city ?? '').trim()
  const area = (scope?.area ?? '').trim()
  const ids = new Set<string>()

  for (const log of logs) {
    for (const id of log.visitedIds) {
      const stop = log.planned.find((s) => s.contactId === id)
      if (state) {
        const stopState = normalizeStateValue(stop?.state || '')
        const logState = normalizeStateValue(log.filterState)
        const match = (stopState && stopState === state) || (!stopState && logState === state)
        if (!match) continue
      }
      if (city) {
        const stopCity = (stop?.city || '').trim()
        if (stopCity !== city && log.filterCity !== city) continue
      }
      if (area && log.filterArea && log.filterArea !== area) continue
      ids.add(id)
    }
  }

  return ids
}

/**
 * Simpler: every confirmed visit, everywhere. Used when the user wants
 * "never suggest anyone I've already logged on a trip."
 */
export function allLoggedVisitedIds(logs: TripLog[]): Set<string> {
  const ids = new Set<string>()
  for (const log of logs) {
    for (const id of log.visitedIds) ids.add(id)
  }
  return ids
}

export function territoryProgress(
  contacts: Contact[],
  logs: TripLog[],
  scope: { state: string; city: string; area: string },
): TerritoryProgress | null {
  const state = normalizeStateValue(scope.state)
  if (!state && !scope.city && !scope.area) return null

  const inScopeContacts = contacts.filter((c) => {
    if (state && normalizeStateValue(c.state) !== state) return false
    if (scope.city && c.city !== scope.city) return false
    if (scope.area && c.area !== scope.area) return false
    return Boolean(c.address || c.city || c.zip)
  })

  const visited = loggedVisitedIds(logs, scope)
  let loggedVisited = 0
  for (const c of inScopeContacts) {
    if (visited.has(c.id) || c.visited) loggedVisited++
  }

  const tripDays = new Set(
    logs
      .filter((log) => {
        if (state) {
          const ls = normalizeStateValue(log.filterState)
          if (ls && ls !== state) return false
          if (!ls && !log.planned.some((s) => normalizeStateValue(s.state) === state)) return false
        }
        if (scope.city && log.filterCity && log.filterCity !== scope.city) return false
        return true
      })
      .map((log) => log.day),
  ).size

  return {
    state,
    city: scope.city,
    inScope: inScopeContacts.length,
    loggedVisited,
    remaining: Math.max(0, inScopeContacts.length - loggedVisited),
    tripDays,
  }
}

export function mergeTripLogs(local: TripLog[], incoming: TripLog[]): TripLog[] {
  const map = new Map(local.map((log) => [log.id, log]))
  for (const log of incoming) {
    const prev = map.get(log.id)
    if (!prev || log.logged_at >= prev.logged_at) map.set(log.id, log)
  }
  return [...map.values()].sort((a, b) => b.logged_at.localeCompare(a.logged_at))
}

export function itineraryLabel(input: {
  state: string
  city: string
  dayCount: number
  originLabel: string
}): string {
  const area = [input.city, input.state].filter(Boolean).join(', ')
    || input.originLabel
    || 'Territory'
  return `${area} · ${input.dayCount}-day itinerary`
}

export function emptyItineraryHint(progress: TerritoryProgress | null, stopsPerDay: number, dayCount: number): string {
  if (!progress) return ''
  const needed = stopsPerDay * dayCount
  if (progress.remaining >= needed) {
    return `${progress.remaining} stops still open in this area — enough for ${dayCount} day${dayCount === 1 ? '' : 's'} of ${stopsPerDay}.`
  }
  if (progress.remaining === 0) {
    return 'Every contact in this area is already logged as visited. Widen the filter or clear trip history.'
  }
  return `Only ${progress.remaining} stops left here — the itinerary will fill what it can.`
}
