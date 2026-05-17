import { getSupabaseAdmin } from './_lib/supabaseAdmin.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const sb = getSupabaseAdmin()
  if (!sb) {
    return res.status(500).json({
      error: 'Server not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel',
    })
  }

  const sub = req.body?.subscription || req.body
  const endpoint = sub?.endpoint
  const p256dh = sub?.keys?.p256dh
  const auth = sub?.keys?.auth

  if (!endpoint || !p256dh || !auth) {
    return res.status(400).json({ error: 'Invalid push subscription' })
  }

  const { error } = await sb.from('push_subscriptions').upsert(
    {
      endpoint,
      p256dh,
      auth,
      user_agent: String(req.headers['user-agent'] || '').slice(0, 500),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' },
  )

  if (error) {
    console.error('push-subscribe error:', error)
    return res.status(500).json({ error: error.message })
  }

  return res.status(200).json({ ok: true })
}
