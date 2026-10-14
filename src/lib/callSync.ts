/**
 * Keeps the call log in step with Supabase.
 *
 * Calls get logged in the middle of a conversation, often on a phone with a
 * patchy signal, so a write that fails must never cost the note. Every log is
 * written locally first and carries a `synced` flag; anything still unsent is
 * pushed again on the next sync. Because rows are append-only, re-pushing is
 * safe and merging is a union by id.
 */

import type { CallLog } from '../types/call'
import { IS_DEMO_MODE } from './demo'
import { saveCallLogToDB, syncCallLogsFromDB } from './supabase'

export interface CallSyncHandles {
  merge: (logs: CallLog[]) => void
  markSynced: (id: string) => void
}

/** Pushes one log and records whether it landed. Never throws. */
export async function pushCallLog(log: CallLog, handles: CallSyncHandles): Promise<boolean> {
  if (IS_DEMO_MODE) {
    handles.markSynced(log.id)
    return true
  }
  try {
    const ok = await saveCallLogToDB(log)
    if (ok) handles.markSynced(log.id)
    return ok
  } catch {
    return false
  }
}

export interface CallSyncResult {
  pushed: number
  failed: number
  pulled: number
}

/**
 * Retries unsent logs, then pulls the cloud copy.
 *
 * Pushing first means a log made seconds ago on this device is in the cloud
 * before the pull, so the merge can't look like the row never existed.
 */
export async function syncCallLogs(
  local: CallLog[],
  handles: CallSyncHandles,
): Promise<CallSyncResult> {
  const result: CallSyncResult = { pushed: 0, failed: 0, pulled: 0 }
  if (IS_DEMO_MODE) {
    local.filter((log) => !log.synced).forEach((log) => handles.markSynced(log.id))
    return result
  }

  for (const log of local) {
    if (log.synced) continue
    const ok = await pushCallLog(log, handles)
    if (ok) result.pushed++
    else result.failed++
  }

  try {
    const cloud = await syncCallLogsFromDB()
    if (cloud.length > 0) {
      handles.merge(cloud)
      result.pulled = cloud.length
    }
  } catch {
    /* offline — the local copy is already authoritative until next time */
  }

  return result
}
