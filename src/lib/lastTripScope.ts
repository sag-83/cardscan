/**
 * Remembers the last area a trip was planned for, so the calling screen can
 * offer "call Pennsylvania first" instead of dumping 600 names in one pile.
 *
 * This is a hint, not a filter: the user still has to tap it, because a
 * calling session is often a different day from the drive.
 */

import { isUsStateCode, normalizeStateValue } from './usStates'

export interface LastTripScope {
  state: string
  city: string
  originLabel: string
}

const KEY = 'cs_last_trip_scope_v1'
export const LAST_TRIP_SCOPE_EVENT = 'cs_last_trip_scope'

export function saveLastTripScope(scope: LastTripScope): void {
  const state = normalizeStateValue(scope.state)
  const next: LastTripScope = {
    state: isUsStateCode(state) ? state : stateFromLabel(scope.originLabel),
    city: scope.city.trim(),
    originLabel: scope.originLabel.trim(),
  }
  if (!next.state && !next.city && !next.originLabel) return
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(LAST_TRIP_SCOPE_EVENT))
  }
}

export function loadLastTripScope(): LastTripScope | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<LastTripScope>
    const parsedState = normalizeStateValue(parsed.state ?? '')
    const state = isUsStateCode(parsedState) ? parsedState : stateFromLabel(parsed.originLabel ?? '')
    const city = (parsed.city ?? '').trim()
    const originLabel = (parsed.originLabel ?? '').trim()
    if (!state && !city && !originLabel) return null
    return { state, city, originLabel }
  } catch {
    return null
  }
}

export function scopeLabel(scope: LastTripScope): string {
  const area = [scope.city, scope.state].filter(Boolean).join(', ')
  if (area) return area
  return scope.originLabel
}

/** Pulls a US state code out of a freeform origin like "Lancaster, PA". */
export function stateFromLabel(label: string): string {
  for (const part of label.split(',')) {
    const withoutZip = part.replace(/\d+/g, ' ').replace(/\s+/g, ' ').trim()
    if (!withoutZip) continue
    const asWhole = normalizeStateValue(withoutZip)
    if (isUsStateCode(asWhole)) return asWhole
    for (const token of withoutZip.split(' ')) {
      const code = normalizeStateValue(token)
      if (isUsStateCode(code)) return code
    }
  }
  return ''
}
