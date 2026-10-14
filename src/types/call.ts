/**
 * Cold-call activity.
 *
 * Stored as an append-only log rather than a "called" flag on the contact, so
 * the third attempt at a shop that never picks up is distinguishable from the
 * first, and so "nobody has touched New Jersey since March" is answerable.
 * Immutable rows also make syncing trivial: two devices merge by union on id
 * with nothing to reconcile.
 */

export type CallOutcome =
  | 'interested'
  | 'callback'
  | 'no-answer'
  | 'not-interested'
  | 'bad-number'
  | 'do-not-call'

export interface CallLog {
  id: string
  contact_id: string
  /** When the call was made. */
  called_at: string
  outcome: CallOutcome
  note: string
  /** Day to try again, set when the outcome is `callback`. */
  callback_at?: string
  created_at: string
  /** Local-only flag; absent or false means it still has to reach the cloud. */
  synced?: boolean
}

export interface OutcomeMeta {
  label: string
  /** Terse form for history rows and chips. */
  short: string
  tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral'
  /** Someone picked up, so the call counts as a real conversation. */
  reached: boolean
  /** Takes the contact out of the calling queue for good. */
  closes: boolean
  /** Worth dialling again once it's had time to cool off. */
  retry: boolean
}

export const CALL_OUTCOMES: Record<CallOutcome, OutcomeMeta> = {
  interested: {
    label: 'Interested',
    short: 'Interested',
    tone: 'success',
    reached: true,
    closes: true,
    retry: false,
  },
  callback: {
    label: 'Call back later',
    short: 'Call back',
    tone: 'info',
    reached: true,
    closes: false,
    retry: false,
  },
  'no-answer': {
    label: 'No answer',
    short: 'No answer',
    tone: 'neutral',
    reached: false,
    closes: false,
    retry: true,
  },
  'not-interested': {
    label: 'Not interested',
    short: 'Not interested',
    tone: 'warning',
    reached: true,
    closes: true,
    retry: false,
  },
  'bad-number': {
    label: 'Wrong number',
    short: 'Wrong number',
    tone: 'warning',
    reached: false,
    closes: true,
    retry: false,
  },
  'do-not-call': {
    label: 'Do not call',
    short: 'Do not call',
    tone: 'danger',
    reached: true,
    closes: true,
    retry: false,
  },
}

export const CALL_OUTCOME_ORDER: CallOutcome[] = [
  'interested',
  'callback',
  'no-answer',
  'not-interested',
  'bad-number',
  'do-not-call',
]
