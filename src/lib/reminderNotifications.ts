import type { Contact } from '../types/contact'
import type { SavedInvoice } from '../types/invoice'
import { resetFollowupNotification } from './supabase'
import { money } from './invoiceFormUtils'
import {
  formatDueDate,
  invoiceDueAt,
  isAwaitingPayment,
  PRE_DUE_DAYS,
  termsLabel,
} from './invoiceTerms'
import { isStandalonePwa } from './pwa'

export { isStandalonePwa } from './pwa'

const ENABLED_KEY = 'cardscan_reminders_push_enabled'
const NOTIFIED_KEY = 'cardscan_followup_notified'
const SW_URL = '/sw.js'
const MAX_DELAY_MS = 7 * 24 * 60 * 60 * 1000
const POLL_MS = 30_000
/** Only alert for follow-ups that became due within this window (avoids blasting old overdue). */
const DUE_WINDOW_MS = 20 * 60 * 1000

const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string)?.trim() ?? ''

export type FollowupReminder = {
  id: string
  at: string
  title: string
  body: string
}

export type ReminderPushStatus = {
  supported: boolean
  enabled: boolean
  permission: NotificationPermission | 'unsupported'
  scheduledCount: number
  isStandalone: boolean
  serverPushConfigured: boolean
}

function reminderKey(contactId: string, at: string): string {
  return `${contactId}:${at}`
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export function isReminderPushEnabled(): boolean {
  return localStorage.getItem(ENABLED_KEY) === 'true'
}

export function setReminderPushEnabled(enabled: boolean): void {
  localStorage.setItem(ENABLED_KEY, enabled ? 'true' : 'false')
  if (!enabled) clearAllSchedules()
}

export function clearNotifiedFollowup(contactId: string): void {
  const prefix = `${contactId}:`
  const ids = loadNotifiedKeys().filter((k) => !k.startsWith(prefix))
  localStorage.setItem(NOTIFIED_KEY, JSON.stringify(ids))
}

function loadNotifiedKeys(): string[] {
  try {
    const raw = localStorage.getItem(NOTIFIED_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

function markNotified(contactId: string, at: string): void {
  const key = reminderKey(contactId, at)
  const ids = new Set(loadNotifiedKeys())
  ids.add(key)
  localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...ids]))
}

function wasNotified(contactId: string, at: string): boolean {
  return loadNotifiedKeys().includes(reminderKey(contactId, at))
}

function isFollowupDueNow(at: string, now = Date.now()): boolean {
  const dueAt = new Date(at).getTime()
  if (Number.isNaN(dueAt) || dueAt > now) return false
  return now - dueAt <= DUE_WINDOW_MS
}

/** Skip old overdue items so enabling reminders does not notify every past due date. */
function skipStaleNotifications(reminders: FollowupReminder[]): void {
  const now = Date.now()
  for (const reminder of reminders) {
    const dueAt = new Date(reminder.at).getTime()
    if (Number.isNaN(dueAt) || dueAt > now) continue
    if (now - dueAt > DUE_WINDOW_MS && !wasNotified(reminder.id, reminder.at)) {
      markNotified(reminder.id, reminder.at)
    }
  }
}

export function remindersFromContacts(contacts: Contact[]): FollowupReminder[] {
  return contacts
    .filter((c) => c.followup_at)
    .map((c) => {
      const name = c.company || c.name || 'Contact'
      const note = c.followup_note?.trim()
      return {
        id: c.id,
        at: c.followup_at!,
        title: `Follow-up: ${name}`,
        body: note || 'Tap to open CardHolder',
      }
    })
}

/**
 * Payment chasers for unpaid invoices sold on terms: one a few days out and one
 * on the due date. Keyed by invoice so several open invoices for the same
 * customer each alert independently of that customer's follow-up reminder.
 */
export function remindersFromInvoices(invoices: SavedInvoice[]): FollowupReminder[] {
  const out: FollowupReminder[] = []

  for (const inv of invoices) {
    if (!isAwaitingPayment(inv)) continue
    const dueAt = invoiceDueAt(inv)
    if (!dueAt) continue

    const who = inv.company || inv.contactName || 'Customer'
    const amount = money(inv.total)
    const dueLabel = formatDueDate(dueAt)
    const terms = termsLabel(inv.termsDays ?? 0)

    out.push({
      id: `inv:${inv.id}:pre`,
      at: new Date(dueAt.getTime() - PRE_DUE_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      title: `Payment due in ${PRE_DUE_DAYS} days: ${who}`,
      body: `${amount} · ${terms} · due ${dueLabel}`,
    })
    out.push({
      id: `inv:${inv.id}:due`,
      at: dueAt.toISOString(),
      title: `Payment due today: ${who}`,
      body: `${amount} · ${terms} invoice dated ${formatUsDate(inv.date)}`,
    })
  }

  return out
}

function formatUsDate(isoDate: string): string {
  const parsed = new Date(`${isoDate}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? isoDate : parsed.toLocaleDateString('en-US')
}

export function allReminders(contacts: Contact[], invoices: SavedInvoice[]): FollowupReminder[] {
  return [...remindersFromContacts(contacts), ...remindersFromInvoices(invoices)]
}

export function supportsReminderPush(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator
}

export function isServerPushConfigured(): boolean {
  return VAPID_PUBLIC_KEY.length > 0
}

export function getReminderPushStatus(contacts: Contact[], invoices: SavedInvoice[]): ReminderPushStatus {
  const supported = supportsReminderPush()
  const permission = supported ? Notification.permission : 'unsupported'
  const future = allReminders(contacts, invoices).filter((r) => new Date(r.at).getTime() > Date.now())
  return {
    supported,
    enabled: isReminderPushEnabled(),
    permission,
    scheduledCount: future.length,
    isStandalone: isStandalonePwa(),
    serverPushConfigured: isServerPushConfigured(),
  }
}

export async function registerReminderServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    const reg = await navigator.serviceWorker.register(SW_URL, { scope: '/' })
    await navigator.serviceWorker.ready
    return reg
  } catch (err) {
    console.warn('Service worker registration failed:', err)
    return null
  }
}

export async function requestReminderPermission(): Promise<NotificationPermission> {
  if (!supportsReminderPush()) return 'denied'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  return Notification.requestPermission()
}

const mainTimers = new Map<string, number>()

function clearAllSchedules(): void {
  for (const handle of mainTimers.values()) clearTimeout(handle)
  mainTimers.clear()
}

/** Register device for server-sent push (works when app is closed). */
export async function registerPushSubscription(): Promise<boolean> {
  if (!VAPID_PUBLIC_KEY) return false
  if (!('PushManager' in window)) return false

  const reg = await registerReminderServiceWorker()
  if (!reg?.pushManager) return false

  try {
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      })
    }

    const res = await fetch('/api/push-subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub.toJSON()),
    })
    return res.ok
  } catch (err) {
    console.warn('Push subscription failed:', err)
    return false
  }
}

async function postRemindersToWorker(reminders: FollowupReminder[]): Promise<void> {
  if (!isReminderPushEnabled() || !supportsReminderPush()) return
  if (Notification.permission !== 'granted') return

  const reg = await registerReminderServiceWorker()
  const worker = reg?.active
  if (!worker) return

  const future = reminders.filter((r) => {
    const delay = new Date(r.at).getTime() - Date.now()
    return delay > 0 && delay <= MAX_DELAY_MS
  })

  worker.postMessage({ type: 'SYNC_REMINDERS', reminders: future })
}

function scheduleMainThreadReminders(reminders: FollowupReminder[]): void {
  clearAllSchedules()
  if (!isReminderPushEnabled() || Notification.permission !== 'granted') return

  for (const reminder of reminders) {
    const delay = new Date(reminder.at).getTime() - Date.now()
    if (delay <= 0 || delay > MAX_DELAY_MS) continue

    mainTimers.set(
      reminderKey(reminder.id, reminder.at),
      window.setTimeout(() => {
        mainTimers.delete(reminderKey(reminder.id, reminder.at))
        void showFollowupNotification(reminder)
      }, delay),
    )
  }
}

async function showFollowupNotification(reminder: FollowupReminder): Promise<boolean> {
  if (!isReminderPushEnabled() || Notification.permission !== 'granted') return false
  if (wasNotified(reminder.id, reminder.at)) return false

  const options: NotificationOptions = {
    body: reminder.body,
    tag: `followup-${reminder.id}-${reminder.at}`,
    icon: '/delta-logo.png',
    badge: '/delta-logo.png',
    requireInteraction: true,
  }

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready
      await reg.showNotification(reminder.title, options)
    } else {
      new Notification(reminder.title, options)
    }
    markNotified(reminder.id, reminder.at)
    return true
  } catch (err) {
    console.warn('Could not show reminder notification:', err)
    return false
  }
}

/** Notify only if a reminder just became due (while app is open). */
export async function checkDueFollowupReminders(
  contacts: Contact[],
  invoices: SavedInvoice[],
): Promise<number> {
  if (!isReminderPushEnabled() || !supportsReminderPush()) return 0
  if (Notification.permission !== 'granted') return 0

  const now = Date.now()
  let shown = 0
  for (const reminder of allReminders(contacts, invoices)) {
    if (!isFollowupDueNow(reminder.at, now)) continue
    if (await showFollowupNotification(reminder)) shown += 1
  }
  return shown
}

export async function syncFollowupReminders(
  contacts: Contact[],
  invoices: SavedInvoice[],
): Promise<void> {
  if (!isReminderPushEnabled() || !supportsReminderPush()) return
  if (Notification.permission !== 'granted') return

  const reminders = allReminders(contacts, invoices)
  scheduleMainThreadReminders(reminders)
  await postRemindersToWorker(reminders)
  await registerPushSubscription()
}

export async function onFollowupScheduleChanged(
  contactId: string,
  contacts: Contact[],
  invoices: SavedInvoice[],
): Promise<void> {
  clearNotifiedFollowup(contactId)
  await resetFollowupNotification(contactId)
  await syncFollowupReminders(contacts, invoices)
}

export async function sendTestReminderNotification(): Promise<'ok' | 'denied' | 'unsupported' | 'error'> {
  if (!supportsReminderPush()) return 'unsupported'
  if (Notification.permission !== 'granted') return 'denied'

  try {
    await registerReminderServiceWorker()
    await registerPushSubscription()
    const reg = await navigator.serviceWorker.ready
    await reg.showNotification('CardHolder test reminder', {
      body: 'If you see this, follow-up alerts are working on this device.',
      tag: 'cardscan-test',
      icon: '/delta-logo.png',
      requireInteraction: true,
    })
    return 'ok'
  } catch {
    return 'error'
  }
}

let pollTimer: number | null = null

export function startFollowupReminderPolling(
  getContacts: () => Contact[],
  getInvoices: () => SavedInvoice[],
): () => void {
  const tick = () => {
    void checkDueFollowupReminders(getContacts(), getInvoices())
  }

  void tick()
  pollTimer = window.setInterval(tick, POLL_MS)
  const onVisible = () => {
    if (document.visibilityState === 'visible') void tick()
  }
  document.addEventListener('visibilitychange', onVisible)

  return () => {
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = null
    document.removeEventListener('visibilitychange', onVisible)
  }
}

export async function enableReminderPush(
  contacts: Contact[],
  invoices: SavedInvoice[],
): Promise<'granted' | 'denied' | 'unsupported'> {
  if (!supportsReminderPush()) return 'unsupported'
  const permission = await requestReminderPermission()
  if (permission !== 'granted') return 'denied'
  setReminderPushEnabled(true)
  skipStaleNotifications(allReminders(contacts, invoices))
  await registerReminderServiceWorker()
  await registerPushSubscription()
  await syncFollowupReminders(contacts, invoices)
  return 'granted'
}
