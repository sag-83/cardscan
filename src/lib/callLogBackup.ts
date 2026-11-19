/**
 * Dedicated durable copy of call logs.
 *
 * The main Zustand blob is large (contacts + invoices) and debounced. Call
 * history must not disappear if that write fails or is delayed — otherwise
 * yesterday’s dials come back as “never called.” This key is written
 * synchronously on every call-log change and restored on boot if needed.
 */

import type { CallLog } from '../types/call'

const BACKUP_KEY = 'cs_call_logs_backup_v1'
const STORE_KEYS = ['cs_store_v2', 'cs_store_demo_v2'] as const

export function writeCallLogBackup(logs: CallLog[]): void {
  try {
    localStorage.setItem(
      BACKUP_KEY,
      JSON.stringify({
        saved_at: new Date().toISOString(),
        logs,
      }),
    )
  } catch {
    /* quota / private mode — in-memory + cloud sync still apply */
  }
}

export function readCallLogBackup(): CallLog[] {
  try {
    const raw = localStorage.getItem(BACKUP_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as { logs?: CallLog[] }
    return Array.isArray(parsed.logs) ? parsed.logs.filter((l) => l?.id) : []
  } catch {
    return []
  }
}

/** Last-resort: pull callLogs out of the main Zustand persist blob. */
export function readCallLogsFromZustandBlob(): CallLog[] {
  for (const key of STORE_KEYS) {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw) as { state?: { callLogs?: CallLog[] } }
      const logs = parsed?.state?.callLogs
      if (Array.isArray(logs) && logs.length) {
        return logs.filter((l) => l?.id)
      }
    } catch {
      /* try next key */
    }
  }
  return []
}

/**
 * Union current logs with every local source we can find.
 * Returns null when nothing new was recovered.
 */
export function recoverLocalCallLogs(current: CallLog[]): CallLog[] | null {
  const sources = [...readCallLogBackup(), ...readCallLogsFromZustandBlob()]
  if (!sources.length) return null

  const merged = new Map(current.map((log) => [log.id, log]))
  let added = 0
  for (const log of sources) {
    if (!log?.id) continue
    const prev = merged.get(log.id)
    if (!prev) {
      merged.set(log.id, log)
      added++
      continue
    }
    // Prefer a version that still needs cloud push if ids collide oddly.
    if (prev.synced && !log.synced) {
      merged.set(log.id, log)
      added++
    }
  }
  if (!added) return null
  return [...merged.values()].sort((a, b) => b.called_at.localeCompare(a.called_at))
}
