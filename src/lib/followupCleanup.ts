/**
 * Strip mass-created follow-ups (Bulk → "Set 30-Day Follow-up" on every contact)
 * and call-log notes that were wrongly written into Reminders.
 * Manual Follow-up reminders (set on the contact card) are kept.
 */

import type { CallLog } from '../types/call'
import type { Contact } from '../types/contact'

const CLEANUP_FLAG = 'cs_cleared_generic_followups_v1'
const CALL_DERIVED_FLAG = 'cs_cleared_call_derived_followups_v1'

/** Default note stamped by the bulk 30-day action. */
const GENERIC_NOTE = /^(follow[\s\-]?ups?|)$/i

/** Auto note written when Calls used to stamp a reminder for "Call back later". */
const AUTO_CALLBACK_NOTE = /^call back\s*[—–-]/i

/** Same calendar minute → almost certainly one bulk write. */
function minuteBucket(iso: string): string {
  return iso.slice(0, 16)
}

export function isGenericFollowupNote(note: string | undefined): boolean {
  return GENERIC_NOTE.test((note || '').trim())
}

/**
 * A follow-up is "bulk junk" when its note is the generic placeholder (or empty)
 * and either the note is exactly the bulk default, or many contacts share the
 * same scheduled minute (the bulk button writes one timestamp for everyone).
 */
export function findGenericFollowupIds(contacts: Contact[]): string[] {
  const withFollowup = contacts.filter((c) => c.followup_at)
  const byMinute = new Map<string, number>()
  for (const c of withFollowup) {
    const key = minuteBucket(c.followup_at!)
    byMinute.set(key, (byMinute.get(key) ?? 0) + 1)
  }

  const cleared: string[] = []
  for (const c of withFollowup) {
    const note = (c.followup_note || '').trim()
    const genericNote = isGenericFollowupNote(note)
    if (!genericNote) continue

    const shared = (byMinute.get(minuteBucket(c.followup_at!)) ?? 0) >= 5
    const bulkDefaultNote = /^follow[\s\-]?ups?$/i.test(note)
    // Empty note + unique time might be a careful manual set — only clear those
    // when they ride along with a mass timestamp. Bulk's "Follow up" note always goes.
    if (bulkDefaultNote || shared) cleared.push(c.id)
  }
  return cleared
}

export function stripGenericFollowups(contacts: Contact[]): {
  contacts: Contact[]
  clearedIds: string[]
  clearedCount: number
  keptCount: number
} {
  return applyClearIds(contacts, findGenericFollowupIds(contacts))
}

/**
 * Reminders that came from logging a call (callback stamp or the call note
 * copied onto followup_note). Those belong in Calls, not Reminders.
 */
export function findCallDerivedFollowupIds(
  contacts: Contact[],
  callLogs: CallLog[],
): string[] {
  const logsByContact = new Map<string, CallLog[]>()
  for (const log of callLogs) {
    const list = logsByContact.get(log.contact_id)
    if (list) list.push(log)
    else logsByContact.set(log.contact_id, [log])
  }

  const cleared: string[] = []
  for (const c of contacts) {
    if (!c.followup_at) continue
    const note = (c.followup_note || '').trim()
    const logs = logsByContact.get(c.id) ?? []

    if (AUTO_CALLBACK_NOTE.test(note)) {
      cleared.push(c.id)
      continue
    }

    const matched = logs.some((log) => {
      const logNote = (log.note || '').trim()
      if (log.callback_at && minuteBucket(log.callback_at) === minuteBucket(c.followup_at!)) {
        return true
      }
      if (logNote && note && logNote === note) return true
      return false
    })
    if (matched) cleared.push(c.id)
  }
  return cleared
}

export function stripCallDerivedFollowups(
  contacts: Contact[],
  callLogs: CallLog[],
): {
  contacts: Contact[]
  clearedIds: string[]
  clearedCount: number
  keptCount: number
} {
  return applyClearIds(contacts, findCallDerivedFollowupIds(contacts, callLogs))
}

function applyClearIds(contacts: Contact[], ids: string[]) {
  const clearIds = new Set(ids)
  if (!clearIds.size) {
    return {
      contacts,
      clearedIds: [],
      clearedCount: 0,
      keptCount: contacts.filter((c) => c.followup_at).length,
    }
  }

  const next = contacts.map((c) => (
    clearIds.has(c.id)
      ? { ...c, followup_at: '', followup_note: '', updated_at: new Date().toISOString() }
      : c
  ))

  return {
    contacts: next,
    clearedIds: [...clearIds],
    clearedCount: clearIds.size,
    keptCount: next.filter((c) => c.followup_at).length,
  }
}

export function hasRunGenericFollowupCleanup(): boolean {
  try {
    return localStorage.getItem(CLEANUP_FLAG) === '1'
  } catch {
    return false
  }
}

export function markGenericFollowupCleanupDone(): void {
  try {
    localStorage.setItem(CLEANUP_FLAG, '1')
  } catch {
    /* private mode */
  }
}

/** Allow Settings to re-run cleanup after a later bulk accident. */
export function resetGenericFollowupCleanupFlag(): void {
  try {
    localStorage.removeItem(CLEANUP_FLAG)
  } catch {
    /* ignore */
  }
}

export function hasRunCallDerivedFollowupCleanup(): boolean {
  try {
    return localStorage.getItem(CALL_DERIVED_FLAG) === '1'
  } catch {
    return false
  }
}

export function markCallDerivedFollowupCleanupDone(): void {
  try {
    localStorage.setItem(CALL_DERIVED_FLAG, '1')
  } catch {
    /* private mode */
  }
}

export function resetCallDerivedFollowupCleanupFlag(): void {
  try {
    localStorage.removeItem(CALL_DERIVED_FLAG)
  } catch {
    /* ignore */
  }
}
