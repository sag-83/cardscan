import type { Contact } from '../types/contact'

const ENABLED_KEY = 'cardscan_reminders_push_enabled'
const NOTIFIED_KEY = 'cardscan_followup_notified'
const SW_URL = '/sw.js'

export type FollowupReminder = {
  id: string
  at: string
  title: string
  body: string
}

export function isReminderPushEnabled(): boolean {
  return localStorage.getItem(ENABLED_KEY) !== 'false'
}

export function setReminderPushEnabled(enabled: boolean): void {
  localStorage.setItem(ENABLED_KEY, enabled ? 'true' : 'false')
}

export function clearNotifiedFollowup(contactId: string): void {
  const ids = loadNotifiedIds().filter((id) => id !== contactId)
  localStorage.setItem(NOTIFIED_KEY, JSON.stringify(ids))
}

function loadNotifiedIds(): string[] {
  try {
    const raw = localStorage.getItem(NOTIFIED_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

function markNotified(contactId: string): void {
  const ids = new Set(loadNotifiedIds())
  ids.add(contactId)
  localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...ids]))
}

export function remindersFromContacts(contacts: Contact[]): FollowupReminder[] {
  return contacts
    .filter((c) => c.followup_at)
    .map((c) => {
      const name = c.name || c.company || 'Contact'
      const note = c.followup_note?.trim()
      return {
        id: c.id,
        at: c.followup_at!,
        title: `Follow-up: ${name}`,
        body: note || 'Tap to open CardScan',
      }
    })
}

export function supportsReminderPush(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator
}

export async function registerReminderServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    return await navigator.serviceWorker.register(SW_URL, { scope: '/' })
  } catch {
    return null
  }
}

export async function requestReminderPermission(): Promise<NotificationPermission> {
  if (!supportsReminderPush()) return 'denied'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  return Notification.requestPermission()
}

async function postRemindersToWorker(reminders: FollowupReminder[]): Promise<void> {
  if (!isReminderPushEnabled() || !supportsReminderPush()) return
  if (Notification.permission !== 'granted') return

  const reg = await registerReminderServiceWorker()
  const worker = reg?.active ?? (await navigator.serviceWorker.ready).active
  if (!worker) return

  const future = reminders.filter((r) => new Date(r.at).getTime() > Date.now())
  worker.postMessage({ type: 'SYNC_REMINDERS', reminders: future })
}

function showFollowupNotification(reminder: FollowupReminder): void {
  if (!isReminderPushEnabled() || Notification.permission !== 'granted') return
  if (loadNotifiedIds().includes(reminder.id)) return

  const options: NotificationOptions = {
    body: reminder.body,
    tag: `followup-${reminder.id}`,
    icon: '/delta-logo.png',
    badge: '/delta-logo.png',
    requireInteraction: true,
  }

  if ('serviceWorker' in navigator) {
    void navigator.serviceWorker.ready.then((reg) => {
      reg.showNotification(reminder.title, options)
    })
  } else {
    new Notification(reminder.title, options)
  }
  markNotified(reminder.id)
}

/** Fire notifications for reminders whose time has passed (e.g. app reopened). */
export function checkDueFollowupReminders(contacts: Contact[]): void {
  if (!isReminderPushEnabled() || !supportsReminderPush()) return
  if (Notification.permission !== 'granted') return

  const now = Date.now()
  for (const reminder of remindersFromContacts(contacts)) {
    if (new Date(reminder.at).getTime() <= now) {
      showFollowupNotification(reminder)
    }
  }
}

export async function syncFollowupReminders(contacts: Contact[]): Promise<void> {
  if (!isReminderPushEnabled() || !supportsReminderPush()) return

  checkDueFollowupReminders(contacts)
  await postRemindersToWorker(remindersFromContacts(contacts))
}

let pollTimer: number | null = null

export function startFollowupReminderPolling(getContacts: () => Contact[]): () => void {
  const tick = () => {
    checkDueFollowupReminders(getContacts())
  }

  tick()
  pollTimer = window.setInterval(tick, 60_000)
  const onVisible = () => {
    if (document.visibilityState === 'visible') tick()
  }
  document.addEventListener('visibilitychange', onVisible)

  return () => {
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = null
    document.removeEventListener('visibilitychange', onVisible)
  }
}

export async function enableReminderPush(contacts: Contact[]): Promise<'granted' | 'denied' | 'unsupported'> {
  if (!supportsReminderPush()) return 'unsupported'
  const permission = await requestReminderPermission()
  if (permission !== 'granted') return 'denied'
  setReminderPushEnabled(true)
  await syncFollowupReminders(contacts)
  return 'granted'
}
