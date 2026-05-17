/* Follow-up reminder service worker — schedules local notifications while the app is installed. */
const timers = new Map()
const MAX_DELAY_MS = 7 * 24 * 60 * 60 * 1000

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let data = { title: 'CardHolder reminder', body: 'You have a follow-up due.' }
  try {
    if (event.data) data = { ...data, ...event.data.json() }
  } catch {
    /* ignore */
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.contactId ? `followup-${data.contactId}` : 'cardscan-followup',
      icon: '/delta-logo.png',
      badge: '/delta-logo.png',
      data: { contactId: data.contactId || '' },
      requireInteraction: true,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      if (clients.length > 0) return clients[0].focus()
      return self.clients.openWindow('/')
    })
  )
})

self.addEventListener('message', (event) => {
  const data = event.data
  if (!data || data.type !== 'SYNC_REMINDERS') return

  for (const handle of timers.values()) clearTimeout(handle)
  timers.clear()

  for (const reminder of data.reminders || []) {
    const delay = new Date(reminder.at).getTime() - Date.now()
    if (delay <= 0 || delay > MAX_DELAY_MS) continue

    timers.set(
      reminder.id,
      setTimeout(() => {
        timers.delete(reminder.id)
        self.registration.showNotification(reminder.title, {
          body: reminder.body,
          tag: `followup-${reminder.id}`,
          icon: '/delta-logo.png',
          badge: '/delta-logo.png',
          data: { contactId: reminder.id },
          requireInteraction: true,
        })
      }, delay)
    )
  }
})
