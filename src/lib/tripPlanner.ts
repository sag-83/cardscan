/**
 * Turns stored contacts into a drivable day plan.
 *
 * The expensive part isn't the routing maths, it's turning scanned addresses
 * into coordinates — every lookup is a rate-limited request to a public
 * geocoder. So the work happens in two stages:
 *
 *   1. Coarse pass. Group contacts by city (or ZIP) and geocode each *group*
 *      once to get a centroid. Hundreds of contacts collapse into a few dozen
 *      lookups, nearly all of them already cached from a previous plan, and
 *      anything outside the radius drops out before costing a second request.
 *   2. Fine pass. Only the surviving shortlist gets a street-level lookup, so
 *      stops inside the same town are ordered by their real position instead of
 *      all sharing one city centre.
 *
 * Stops are then selected and ordered by `routeOptimizer`, and the ordering is
 * redone on real OSRM driving times when that service answers.
 */

import type { Contact } from '../types/contact'
import {
  geocodeCityCoords,
  geocodeContactLocation,
  geocodePostalCode,
  getCachedCityCoords,
  type GeoPoint,
} from './geocode'
import {
  distanceBetween,
  estimateDriveMinutes,
  estimateRoadMiles,
  formatDuration,
  formatMiles,
} from './geoMath'
import { fetchDrivingMatrix } from './osrm'
import { ORIGIN_INDEX, planRoute, type CostMatrix } from './routeOptimizer'
import { isStateOutOfRange } from './stateBounds'

export type TripPriority = 'none' | 'customers' | 'top-rated'

export interface TripOptions {
  /** Only consider contacts within this many miles of the start. */
  radiusMiles: number
  maxStops: number
  /** Whether the last stop should route back to the start. */
  roundTrip: boolean
  /** Time spent at each stop, used for the day-length total. */
  minutesPerStop: number
  priority: TripPriority
}

export const DEFAULT_TRIP_OPTIONS: TripOptions = {
  radiusMiles: 50,
  maxStops: 8,
  roundTrip: true,
  minutesPerStop: 30,
  priority: 'none',
}

export interface TripOrigin {
  label: string
  point: GeoPoint
}

export interface TripStop {
  contact: Contact
  point: GeoPoint
  /** True when only the city or ZIP resolved, so this pin isn't the storefront. */
  approximate: boolean
  /** Travel from the previous stop (the start, for the first stop). */
  legMiles: number
  legMinutes: number
  cumulativeMiles: number
  /** Minutes from leaving the start until arriving here, including earlier visits. */
  arriveAfterMinutes: number
}

export interface TripSkipped {
  /** No address, city or ZIP on the card. */
  noAddress: number
  /** Outside the radius. */
  outOfRadius: number
  /** Had an address but the geocoder couldn't place it. */
  unresolved: number
  /** In range, but beyond the max-stops cap. */
  overCap: number
}

export interface TripPlan {
  origin: TripOrigin
  stops: TripStop[]
  roundTrip: boolean
  returnMiles: number
  returnMinutes: number
  totalMiles: number
  /** Total time driving, including the return leg. */
  driveMinutes: number
  /** Total time spent at stops. */
  visitMinutes: number
  /** 'road' when real driving times were used, 'estimate' when calculated locally. */
  costSource: 'road' | 'estimate'
  /** Contacts in range and located, before the max-stops cap. */
  candidateCount: number
  skipped: TripSkipped
}

export type TripPhase = 'scanning' | 'locating' | 'routing'

export interface TripProgress {
  phase: TripPhase
  done: number
  total: number
  label: string
}

export class TripCancelledError extends Error {
  constructor() {
    super('Trip planning cancelled')
    this.name = 'TripCancelledError'
  }
}

export class TripPlanError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TripPlanError'
  }
}

// Street-level lookups are the slow part, so the shortlist is capped. A few
// times the stop limit is plenty of slack for the optimiser to choose a tight
// cluster from, without making the user wait on lookups that can't be used.
const SHORTLIST_MULTIPLIER = 3
const MIN_SHORTLIST = 24
const MAX_SHORTLIST = 45

// Slack on the coarse city-centroid filter. A town can be wide enough that its
// centre falls outside the radius while its near edge doesn't.
const COARSE_RADIUS_BUFFER_MILES = 15

function throwIfCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new TripCancelledError()
}

function hasAnyLocation(contact: Contact): boolean {
  return Boolean(
    (contact.address ?? '').trim() ||
    (contact.city ?? '').trim() ||
    (contact.zip ?? '').trim(),
  )
}

/**
 * Ranks a contact for breaking ties between stops that cost the same to visit.
 * A whole building of tenants shares one coordinate, so without this the cap
 * would just take whoever sorted first alphabetically. Known customers come
 * first, then star rating, then anyone already shown goods.
 */
function tieBreakRank(contact: Contact): number {
  let rank = 0
  if (contact.is_customer) rank += 100
  else if (contact.is_old_customer) rank += 50
  rank += Math.max(0, Math.min(4, contact.stars)) * 5
  if (contact.visited) rank += 1
  return rank
}

function priorityWeight(contact: Contact, priority: TripPriority): number {
  if (priority === 'customers') {
    if (contact.is_customer) return 0.65
    if (contact.is_old_customer) return 0.8
    return 1
  }
  if (priority === 'top-rated') {
    if (contact.stars >= 4) return 0.65
    if (contact.stars === 3) return 0.8
    return 1
  }
  return 1
}

interface CoarseGroup {
  kind: 'city' | 'zip'
  city: string
  state: string
  zip: string
  contacts: Contact[]
}

function groupByCoarseLocation(contacts: Contact[]): Map<string, CoarseGroup> {
  const groups = new Map<string, CoarseGroup>()

  for (const contact of contacts) {
    const city = (contact.city ?? '').trim()
    const state = (contact.state ?? '').trim()
    const zip = (contact.zip ?? '').trim()

    const kind: 'city' | 'zip' = city ? 'city' : 'zip'
    if (kind === 'zip' && !zip) continue

    const key = kind === 'city'
      ? `city:${city.toUpperCase()}|${state.toUpperCase()}`
      : `zip:${zip.toUpperCase()}`

    const existing = groups.get(key)
    if (existing) existing.contacts.push(contact)
    else groups.set(key, { kind, city, state, zip, contacts: [contact] })
  }

  return groups
}

function resolveCoarseGroup(group: CoarseGroup): Promise<GeoPoint | null> {
  return group.kind === 'city'
    ? geocodeCityCoords(group.city, group.state)
    : geocodePostalCode(group.zip)
}

interface LocatedContact {
  contact: Contact
  point: GeoPoint
  approximate: boolean
}

function buildEstimateMatrices(points: GeoPoint[]): { minutes: CostMatrix; miles: CostMatrix } {
  const minutes: CostMatrix = []
  const miles: CostMatrix = []

  for (let i = 0; i < points.length; i++) {
    minutes.push([])
    miles.push([])
    for (let j = 0; j < points.length; j++) {
      if (i === j) {
        minutes[i].push(0)
        miles[i].push(0)
        continue
      }
      const straight = distanceBetween(points[i], points[j])
      minutes[i].push(estimateDriveMinutes(straight))
      miles[i].push(estimateRoadMiles(straight))
    }
  }

  return { minutes, miles }
}

export async function planTrip(
  contacts: Contact[],
  origin: TripOrigin,
  options: TripOptions,
  onProgress?: (progress: TripProgress) => void,
  signal?: AbortSignal,
): Promise<TripPlan> {
  const skipped: TripSkipped = { noAddress: 0, outOfRadius: 0, unresolved: 0, overCap: 0 }

  const addressable = contacts.filter((contact) => {
    if (hasAnyLocation(contact)) return true
    skipped.noAddress++
    return false
  })

  if (addressable.length === 0) {
    throw new TripPlanError('None of these contacts have an address saved.')
  }

  // ─── Free pass: drop states that can't reach the radius, before any lookup ─
  // Without this, a library spread over thirty states would geocode every one
  // of its cities just to learn that most are a thousand miles away.
  const nearby = addressable.filter((contact) => {
    if (!isStateOutOfRange(contact.state ?? '', origin.point, options.radiusMiles)) return true
    skipped.outOfRadius++
    return false
  })

  if (nearby.length === 0) {
    throw new TripPlanError(
      `No contacts within ${Math.round(options.radiusMiles)} miles of ${origin.label}. Try a wider radius.`,
    )
  }

  // ─── Coarse pass: one lookup per city, then drop anything out of range ────
  const groups = groupByCoarseLocation(nearby)
  const pending = [...groups.values()].filter(
    (group) => !(group.kind === 'city' && getCachedCityCoords(group.city, group.state)),
  )

  const coarsePoints = new Map<CoarseGroup, GeoPoint>()
  for (const group of groups.values()) {
    const cached = group.kind === 'city' ? getCachedCityCoords(group.city, group.state) : null
    if (cached) coarsePoints.set(group, cached)
  }

  let scanned = 0
  for (const group of pending) {
    throwIfCancelled(signal)
    onProgress?.({
      phase: 'scanning',
      done: scanned,
      total: pending.length,
      label: group.kind === 'city' ? [group.city, group.state].filter(Boolean).join(', ') : group.zip,
    })
    const point = await resolveCoarseGroup(group)
    if (point) coarsePoints.set(group, point)
    scanned++
  }

  const inRange: { contact: Contact; coarseMiles: number }[] = []
  for (const group of groups.values()) {
    const point = coarsePoints.get(group)
    if (!point) {
      skipped.unresolved += group.contacts.length
      continue
    }
    const coarseMiles = distanceBetween(origin.point, point)
    // A city centroid can sit outside the radius while a shop on the near edge
    // of town sits inside it, so this cut is deliberately loose. The real check
    // happens below, once street coordinates are known.
    if (coarseMiles > options.radiusMiles + COARSE_RADIUS_BUFFER_MILES) {
      skipped.outOfRadius += group.contacts.length
      continue
    }
    group.contacts.forEach((contact) => inRange.push({ contact, coarseMiles }))
  }

  if (inRange.length === 0) {
    throw new TripPlanError(
      `No contacts within ${Math.round(options.radiusMiles)} miles of ${origin.label}. Try a wider radius.`,
    )
  }

  // ─── Fine pass: street-level coordinates for the shortlist only ───────────
  const shortlistSize = Math.min(
    MAX_SHORTLIST,
    Math.max(MIN_SHORTLIST, options.maxStops * SHORTLIST_MULTIPLIER),
  )
  const shortlist = [...inRange]
    .sort((a, b) => a.coarseMiles - b.coarseMiles)
    .slice(0, shortlistSize)

  const located: LocatedContact[] = []
  let locatedCount = 0
  let droppedFromShortlist = 0
  for (const { contact } of shortlist) {
    throwIfCancelled(signal)
    onProgress?.({
      phase: 'locating',
      done: locatedCount,
      total: shortlist.length,
      label: contact.company || contact.name || 'Contact',
    })
    locatedCount++

    const resolved = await geocodeContactLocation(contact)
    if (!resolved) {
      skipped.unresolved++
      droppedFromShortlist++
      continue
    }

    // Now that the real position is known, enforce the radius the user asked
    // for. The coarse pass intentionally let near-misses through.
    if (distanceBetween(origin.point, resolved.point) > options.radiusMiles) {
      skipped.outOfRadius++
      droppedFromShortlist++
      continue
    }

    located.push({ contact, point: resolved.point, approximate: resolved.approximate })
  }

  if (located.length === 0) {
    throw new TripPlanError('Could not pin any of these addresses on the map.')
  }

  throwIfCancelled(signal)
  onProgress?.({ phase: 'routing', done: 0, total: 1, label: 'Working out the order' })

  // ─── Cost the whole shortlist once, on real roads where possible ──────────
  // Asking OSRM for the full shortlist rather than just the chosen stops costs
  // the same single request, and it means the *selection* is made on driving
  // time too. Straight-line distance would happily pick a shop three miles
  // away across a river over one eight miles away down a highway.
  const points = [origin.point, ...located.map((entry) => entry.point)]
  const road = await fetchDrivingMatrix(points, signal)
  throwIfCancelled(signal)

  const fallback = buildEstimateMatrices(points)
  const minutesMatrix = road
    ? road.durations.map((row) => row.map((seconds) => seconds / 60))
    : fallback.minutes
  const milesMatrix = road ? road.miles : fallback.miles

  const weights = new Map<number, number>()
  const tieBreak = new Map<number, number>()
  located.forEach((entry, index) => {
    const weight = priorityWeight(entry.contact, options.priority)
    if (weight !== 1) weights.set(index + 1, weight)
    tieBreak.set(index + 1, tieBreakRank(entry.contact))
  })

  const route = planRoute(minutesMatrix, {
    candidates: located.map((_, index) => index + 1),
    limit: options.maxStops,
    roundTrip: options.roundTrip,
    weights,
    tieBreak,
  })

  skipped.overCap = Math.max(0, inRange.length - (route.order.length - 1) - droppedFromShortlist)

  // ─── Assemble the plan ────────────────────────────────────────────────────
  const stops: TripStop[] = []
  let cumulativeMiles = 0
  let driveMinutes = 0

  for (let step = 1; step < route.order.length; step++) {
    const from = route.order[step - 1]
    const to = route.order[step]
    const legMinutes = minutesMatrix[from][to]
    const legMiles = milesMatrix[from][to]

    driveMinutes += legMinutes
    cumulativeMiles += legMiles

    const entry = located[to - 1]
    stops.push({
      contact: entry.contact,
      point: entry.point,
      approximate: entry.approximate,
      legMiles,
      legMinutes,
      cumulativeMiles,
      arriveAfterMinutes: driveMinutes + options.minutesPerStop * (step - 1),
    })
  }

  let returnMiles = 0
  let returnMinutes = 0
  if (options.roundTrip && stops.length > 0) {
    const last = route.order[route.order.length - 1]
    returnMinutes = minutesMatrix[last][ORIGIN_INDEX]
    returnMiles = milesMatrix[last][ORIGIN_INDEX]
    driveMinutes += returnMinutes
  }

  return {
    origin,
    stops,
    roundTrip: options.roundTrip,
    returnMiles,
    returnMinutes,
    totalMiles: cumulativeMiles + returnMiles,
    driveMinutes,
    visitMinutes: stops.length * options.minutesPerStop,
    costSource: road ? 'road' : 'estimate',
    candidateCount: inRange.length,
    skipped,
  }
}

// ─── Handing the route off to Google Maps ───────────────────────────────────

// Google's directions URL takes an origin, a destination and up to 9 stops in
// between, so a long day has to be split across several links.
const MAX_WAYPOINTS_PER_LINK = 8

export function stopAddressText(stop: TripStop): string {
  const { contact } = stop
  return [contact.address, contact.city, contact.state, contact.zip].filter(Boolean).join(', ')
}

/**
 * What to hand Google for a stop. An exactly-geocoded address is used verbatim
 * because we know it resolves; an approximate one falls back to the business
 * name and town, since its coordinates are only a city centre and would send
 * him to the wrong place.
 */
function mapsQuery(stop: TripStop): string {
  if (!stop.approximate) {
    const address = stopAddressText(stop)
    if (address) return address
    return `${stop.point.lat},${stop.point.lng}`
  }
  const name = stop.contact.company || stop.contact.name
  const place = [stop.contact.city, stop.contact.state].filter(Boolean).join(', ')
  return [name, place].filter(Boolean).join(', ') || `${stop.point.lat},${stop.point.lng}`
}

export interface MapsLink {
  label: string
  url: string
}

export function buildMapsLinks(plan: TripPlan): MapsLink[] {
  if (plan.stops.length === 0) return []

  const originQuery = `${plan.origin.point.lat},${plan.origin.point.lng}`
  const places = [
    { label: plan.origin.label, query: originQuery },
    ...plan.stops.map((stop, index) => ({
      label: `${index + 1}. ${stop.contact.company || stop.contact.name || 'Stop'}`,
      query: mapsQuery(stop),
    })),
  ]
  if (plan.roundTrip) {
    places.push({ label: `Back to ${plan.origin.label}`, query: originQuery })
  }

  const links: MapsLink[] = []
  const chunkSize = MAX_WAYPOINTS_PER_LINK + 2

  // Chunks overlap by one place so each link picks up where the last ended.
  for (let start = 0; start < places.length - 1; start += chunkSize - 1) {
    const chunk = places.slice(start, start + chunkSize)
    if (chunk.length < 2) break

    const params = new URLSearchParams({
      api: '1',
      origin: chunk[0].query,
      destination: chunk[chunk.length - 1].query,
      travelmode: 'driving',
    })
    const waypoints = chunk.slice(1, -1).map((place) => place.query)
    if (waypoints.length > 0) params.set('waypoints', waypoints.join('|'))

    links.push({
      label: `${chunk[0].label} → ${chunk[chunk.length - 1].label}`,
      url: `https://www.google.com/maps/dir/?${params}`,
    })
  }

  return links
}

export function buildTripText(plan: TripPlan): string {
  const lines: string[] = []

  lines.push(`Route from ${plan.origin.label}`)
  lines.push(
    `${plan.stops.length} stops · ${formatMiles(plan.totalMiles)} · ${formatDuration(plan.driveMinutes)} driving`,
  )
  lines.push('')

  plan.stops.forEach((stop, index) => {
    const name = stop.contact.company || stop.contact.name || 'Stop'
    const address = stopAddressText(stop)
    lines.push(`${index + 1}. ${name}`)
    if (address) lines.push(`   ${address}`)
    const phone = stop.contact.phone_mobile || stop.contact.phone_work
    if (phone) lines.push(`   ${phone}`)
    lines.push(`   ${formatMiles(stop.legMiles)} · ${formatDuration(stop.legMinutes)} from previous`)
    if (stop.approximate) lines.push('   (address approximate — verify in Maps)')
    lines.push('')
  })

  if (plan.roundTrip) {
    lines.push(
      `Return to ${plan.origin.label}: ${formatMiles(plan.returnMiles)} · ${formatDuration(plan.returnMinutes)}`,
    )
    lines.push('')
  }

  lines.push(
    `Driving ${formatDuration(plan.driveMinutes)} + ${formatDuration(plan.visitMinutes)} at stops = ${formatDuration(plan.driveMinutes + plan.visitMinutes)} total`,
  )
  if (plan.costSource === 'estimate') {
    lines.push('Times are estimated from straight-line distance.')
  }

  return lines.join('\n')
}
