/**
 * Strip mass-created follow-ups (Bulk → "Set 30-Day Follow-up" on every contact)
 * while keeping intentional ones: custom notes, call-back promises, etc.
 */

import type { Contact } from '../types/contact'

const CLEANUP_FLAG = 'cs_cleared_generic_followups_v1'

/** Default note stamped by the bulk 30-day action. */
const GENERIC_NOTE = /^(follow[\s\-]?ups?|)$/i

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
  const clearIds = new Set(findGenericFollowupIds(contacts))
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
