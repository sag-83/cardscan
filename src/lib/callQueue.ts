/**
 * Builds the cold-calling worklist.
 *
 * The point of this is that 600-odd prospects is not a list anyone works
 * through by scrolling. Given the call history, this decides who is worth
 * dialling right now and in what order, so the screen can just hand over the
 * next card.
 *
 * Priority runs: promised callbacks that are due, then numbers that rang out
 * and have had time to cool off, then everyone never tried — best prospects
 * first. Anything settled (not interested, wrong number, do not call) and
 * anyone already interested drops out, because re-calling them is at best
 * wasted time and at worst how a prospect becomes a complaint.
 */

import type { Contact } from '../types/contact'
import { CALL_OUTCOMES, type CallLog, type CallOutcome } from '../types/call'
import { normalizeStateValue } from './usStates'

/** A number that rang out is worth another try, but not the same afternoon. */
const NO_ANSWER_COOLDOWN_DAYS = 3
/** After this many rings with nobody home, stop cycling it to the front. */
const MAX_NO_ANSWER_ATTEMPTS = 4

const DAY_MS = 24 * 60 * 60 * 1000

export interface CallHistory {
  /** Newest first. */
  logs: CallLog[]
  attempts: number
  lastOutcome?: CallOutcome
  lastCalledAt?: string
  /** Latest promised callback date, if one is outstanding. */
  callbackAt?: string
}

const EMPTY_HISTORY: CallHistory = { logs: [], attempts: 0 }

export function buildHistories(logs: CallLog[]): Map<string, CallHistory> {
  const byContact = new Map<string, CallLog[]>()
  for (const log of logs) {
    const list = byContact.get(log.contact_id)
    if (list) list.push(log)
    else byContact.set(log.contact_id, [log])
  }

  const histories = new Map<string, CallHistory>()
  for (const [contactId, list] of byContact) {
    const sorted = [...list].sort((a, b) => b.called_at.localeCompare(a.called_at))
    const latest = sorted[0]
    const callback = sorted.find((log) => log.outcome === 'callback' && log.callback_at)
    histories.set(contactId, {
      logs: sorted,
      attempts: sorted.length,
      lastOutcome: latest?.outcome,
      lastCalledAt: latest?.called_at,
      // A later outcome supersedes an earlier promise — if he called back and
      // they said no, the callback is spent.
      callbackAt: callback && callback.id === latest?.id ? callback.callback_at : undefined,
    })
  }

  return histories
}

export type QueueReason =
  /** Promised callback, due today or overdue. */
  | 'callback-due'
  /** Rang out, cooled off, still has attempts left. */
  | 'retry'
  /** Never dialled. */
  | 'fresh'

export type ParkedReason =
  /** Callback promised for a future date. */
  | 'callback-later'
  /** Settled: not interested, wrong number, do not call, or already interested. */
  | 'closed'
  /** Rang out, but too recently to try again. */
  | 'resting'
  /** Rang out too many times. */
  | 'exhausted'
  /** Nothing to dial. */
  | 'no-phone'

export interface QueueEntry {
  contact: Contact
  history: CallHistory
  reason: QueueReason
  score: number
  /** Days past the promised callback; 0 when due today. */
  overdueDays: number
}

export interface ParkedEntry {
  contact: Contact
  history: CallHistory
  reason: ParkedReason
}

export interface CallFilters {
  /** 'prospects' hides anyone already marked a customer. */
  audience: 'prospects' | 'everyone'
  state: string
  city: string
  minStars: number
}

export const DEFAULT_CALL_FILTERS: CallFilters = {
  audience: 'prospects',
  state: '',
  city: '',
  minStars: 0,
}

export interface CallStats {
  /** Contacts matching the filters that have a number to dial. */
  callable: number
  /** How many of those have been dialled at least once. */
  called: number
  neverCalled: number
  /** Ready to dial right now. */
  dueNow: number
  interested: number
  callbacksLater: number
  noPhone: number
  /** Today's tally, across all contacts rather than just the filtered scope. */
  calledToday: number
  reachedToday: number
  interestedToday: number
}

export function contactPhone(contact: Contact): string {
  const extra = (contact.extra_phones ?? []).find((phone) => (phone ?? '').trim())
  return (
    (contact.phone_mobile ?? '').trim() ||
    (contact.phone_work ?? '').trim() ||
    (extra ?? '').trim()
  )
}

/**
 * How promising an untouched prospect looks, so the first hour of calling goes
 * to the best names rather than whatever sorted first.
 *
 * Lapsed customers lead by a distance: they already bought once, so the call
 * is a win-back rather than a true cold call.
 */
function freshScore(contact: Contact): number {
  let score = 0
  if (contact.is_old_customer) score += 60
  if (contact.visited) score += 20

  const stars = Math.max(0, Math.min(4, contact.stars ?? 0))
  score += stars * 10

  if ((contact.phone_mobile ?? '').trim()) score += 6
  else if ((contact.phone_work ?? '').trim()) score += 4
  if ((contact.email ?? '').trim()) score += 2
  if ((contact.company ?? '').trim()) score += 3
  if ((contact.address ?? '').trim()) score += 2

  return score
}

function startOfToday(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
}

function daysBetween(fromMs: number, toMs: number): number {
  return Math.floor((toMs - fromMs) / DAY_MS)
}

export interface CallQueue {
  /** Ready to dial, best first. */
  due: QueueEntry[]
  /** Deliberately held back, with the reason. */
  parked: ParkedEntry[]
  stats: CallStats
}

export function buildCallQueue(
  contacts: Contact[],
  logs: CallLog[],
  filters: CallFilters,
  now: Date = new Date(),
): CallQueue {
  const histories = buildHistories(logs)
  const todayStart = startOfToday(now)
  const nowMs = now.getTime()

  const due: QueueEntry[] = []
  const parked: ParkedEntry[] = []
  const stats: CallStats = {
    callable: 0,
    called: 0,
    neverCalled: 0,
    dueNow: 0,
    interested: 0,
    callbacksLater: 0,
    noPhone: 0,
    calledToday: 0,
    reachedToday: 0,
    interestedToday: 0,
  }

  // Today's tally counts every call made today, not just the filtered slice —
  // it's a measure of the day's work, so narrowing to one state shouldn't
  // make the morning's calls disappear.
  for (const log of logs) {
    const at = Date.parse(log.called_at)
    if (!Number.isFinite(at) || at < todayStart) continue
    stats.calledToday++
    if (CALL_OUTCOMES[log.outcome]?.reached) stats.reachedToday++
    if (log.outcome === 'interested') stats.interestedToday++
  }

  for (const contact of contacts) {
    if (filters.audience === 'prospects' && contact.is_customer) continue
    if (filters.state && normalizeStateValue(contact.state) !== filters.state) continue
    if (filters.city && contact.city !== filters.city) continue
    if (filters.minStars > 0 && (contact.stars ?? 0) < filters.minStars) continue

    const history = histories.get(contact.id) ?? EMPTY_HISTORY

    if (!contactPhone(contact)) {
      stats.noPhone++
      parked.push({ contact, history, reason: 'no-phone' })
      continue
    }

    stats.callable++
    if (history.attempts > 0) stats.called++
    else stats.neverCalled++
    if (history.lastOutcome === 'interested') stats.interested++

    // An outstanding promise outranks everything, overdue ones most of all.
    if (history.callbackAt) {
      const dueMs = Date.parse(history.callbackAt)
      if (Number.isFinite(dueMs)) {
        const dueDayStart = new Date(dueMs)
        const dueStart = new Date(
          dueDayStart.getFullYear(), dueDayStart.getMonth(), dueDayStart.getDate(),
        ).getTime()
        if (dueStart <= todayStart) {
          const overdueDays = Math.max(0, daysBetween(dueStart, todayStart))
          due.push({
            contact,
            history,
            reason: 'callback-due',
            score: 100_000 + overdueDays * 100,
            overdueDays,
          })
          continue
        }
        stats.callbacksLater++
        parked.push({ contact, history, reason: 'callback-later' })
        continue
      }
    }

    const meta = history.lastOutcome ? CALL_OUTCOMES[history.lastOutcome] : undefined

    if (meta?.closes) {
      parked.push({ contact, history, reason: 'closed' })
      continue
    }

    if (meta?.retry) {
      const noAnswers = history.logs.filter((log) => log.outcome === 'no-answer').length
      if (noAnswers >= MAX_NO_ANSWER_ATTEMPTS) {
        parked.push({ contact, history, reason: 'exhausted' })
        continue
      }
      const lastMs = Date.parse(history.lastCalledAt ?? '')
      const restedDays = Number.isFinite(lastMs) ? (nowMs - lastMs) / DAY_MS : Infinity
      if (restedDays < NO_ANSWER_COOLDOWN_DAYS) {
        parked.push({ contact, history, reason: 'resting' })
        continue
      }
      due.push({
        contact,
        history,
        // Above fresh names: he has already paid the cost of finding the
        // number, and a rung-out line usually just means bad timing.
        reason: 'retry',
        score: 50_000 - noAnswers * 100 + freshScore(contact),
        overdueDays: 0,
      })
      continue
    }

    due.push({
      contact,
      history,
      reason: 'fresh',
      score: freshScore(contact),
      overdueDays: 0,
    })
  }

  due.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    // Stable, readable fallback so the deck doesn't reshuffle between renders.
    const nameA = a.contact.company || a.contact.name || ''
    const nameB = b.contact.company || b.contact.name || ''
    return nameA.localeCompare(nameB)
  })

  stats.dueNow = due.length
  return { due, parked, stats }
}

/** Human explanation of why a card is at the front of the queue. */
export function reasonLabel(entry: QueueEntry): string {
  if (entry.reason === 'callback-due') {
    if (entry.overdueDays === 0) return 'Callback due today'
    return `Callback ${entry.overdueDays} day${entry.overdueDays === 1 ? '' : 's'} overdue`
  }
  if (entry.reason === 'retry') {
    const tries = entry.history.logs.filter((log) => log.outcome === 'no-answer').length
    return `Rang out ${tries} time${tries === 1 ? '' : 's'} — try again`
  }
  if (entry.history.attempts > 0) return 'Not settled yet'
  return 'Never called'
}

export function parkedReasonLabel(reason: ParkedReason): string {
  if (reason === 'callback-later') return 'Callback booked for later'
  if (reason === 'closed') return 'Settled'
  if (reason === 'resting') return 'Resting before the next try'
  if (reason === 'exhausted') return 'Rang out too many times'
  return 'No phone number'
}

/** Formats a date for the "last called" line without pulling in a date library. */
export function describeWhen(iso: string | undefined, now: Date = new Date()): string {
  if (!iso) return ''
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  const days = daysBetween(startOfToday(new Date(ms)), startOfToday(now))
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 14) return 'last week'
  if (days < 60) return `${Math.round(days / 7)} weeks ago`
  return `${Math.round(days / 30)} months ago`
}
