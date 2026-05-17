import webpush from 'web-push'
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js'

function isAuthorized(req) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.authorization || ''
    if (auth === `Bearer ${secret}`) return true
  }
  return req.headers['x-vercel-cron'] === '1'
}

function configureWebPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT || 'mailto:info@deltadiamondsinc.com'
  if (!publicKey || !privateKey) return false
  webpush.setVapidDetails(subject, publicKey, privateKey)
  return true
}

/** Match client: only notify when due time is recent, not entire overdue backlog. */
const DUE_WINDOW_MS = 20 * 60 * 1000

function isDue(contact, now = Date.now()) {
  if (!contact.followup_at) return false
  const at = new Date(contact.followup_at).getTime()
  if (Number.isNaN(at) || at > now) return false
  if (now - at > DUE_WINDOW_MS) return false
  if (!contact.followup_notified_at) return true
  return new Date(contact.followup_notified_at).getTime() < at
}

async function markStaleFollowupsSkipped(sb, contacts, nowIso) {
  const now = Date.now()
  const stale = (contacts || []).filter((c) => {
    if (!c.followup_at || c.followup_notified_at) return false
    const at = new Date(c.followup_at).getTime()
    return !Number.isNaN(at) && at < now - DUE_WINDOW_MS
  })
  for (const c of stale) {
    await sb.from('contacts').update({ followup_notified_at: nowIso }).eq('id', c.id)
  }
  return stale.length
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' })

  const sb = getSupabaseAdmin()
  if (!sb) {
    return res.status(500).json({ error: 'Supabase admin not configured' })
  }
  if (!configureWebPush()) {
    return res.status(500).json({ error: 'VAPID keys not configured' })
  }

  const nowIso = new Date().toISOString()

  const { data: contacts, error: contactsError } = await sb
    .from('contacts')
    .select('id, name, company, followup_at, followup_note, followup_notified_at')
    .not('followup_at', 'is', null)
    .lte('followup_at', nowIso)

  if (contactsError) {
    console.error(contactsError)
    return res.status(500).json({ error: contactsError.message })
  }

  const skippedStale = await markStaleFollowupsSkipped(sb, contacts, nowIso)
  const due = (contacts || []).filter((c) => isDue(c))
  if (!due.length) {
    return res.status(200).json({ ok: true, due: 0, sent: 0 })
  }

  const { data: subs, error: subsError } = await sb.from('push_subscriptions').select('endpoint, p256dh, auth')
  if (subsError) {
    console.error(subsError)
    return res.status(500).json({ error: subsError.message })
  }

  if (!subs?.length) {
    return res.status(200).json({ ok: true, due: due.length, sent: 0, warning: 'No devices subscribed' })
  }

  let sent = 0
  const errors = []

  for (const contact of due) {
    const name = contact.name || contact.company || 'Contact'
    const payload = JSON.stringify({
      title: `Follow-up: ${name}`,
      body: (contact.followup_note || '').trim() || 'Tap to open CardHolder',
      contactId: contact.id,
    })

    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload,
        )
        sent += 1
      } catch (e) {
        const status = e?.statusCode
        if (status === 404 || status === 410) {
          await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        } else {
          errors.push(String(e?.message || e))
        }
      }
    }

    await sb
      .from('contacts')
      .update({ followup_notified_at: nowIso })
      .eq('id', contact.id)
  }

  return res.status(200).json({
    ok: true,
    due: due.length,
    sent,
    skippedStale,
    devices: subs.length,
    errors: errors.slice(0, 5),
  })
}
