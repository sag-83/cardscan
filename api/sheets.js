import {
  applyRateLimit,
  fetchJsonWithTimeout,
  getBearerToken,
  getClientIp,
  getServerConfig,
  sendJson,
  verifySupabaseToken,
} from './_shared.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' })
  }

  try {
    const accessToken = getBearerToken(req)
    const user = await verifySupabaseToken(accessToken)
    if (!user) {
      return sendJson(res, 401, { error: 'Authentication required' })
    }

    const ip = getClientIp(req)
    const rateLimit = applyRateLimit({
      key: `sheets:${user.id}:${ip}`,
      limit: 10,
      windowMs: 15 * 60 * 1000,
    })

    if (!rateLimit.allowed) {
      return sendJson(res, 429, { error: 'Sheets export rate limit reached' })
    }

    const { sheetsWebhookUrl } = getServerConfig()
    if (!sheetsWebhookUrl) {
      return sendJson(res, 500, { error: 'Sheets server env is not configured' })
    }

    const contacts = req.body?.contacts
    if (!Array.isArray(contacts) || contacts.length === 0) {
      return sendJson(res, 400, { error: 'No contacts provided for export' })
    }

    const { response } = await fetchJsonWithTimeout(
      sheetsWebhookUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(contacts),
      },
      15_000
    )

    if (!response.ok) {
      return sendJson(res, 502, { error: `Sheets webhook returned ${response.status}` })
    }

    return sendJson(res, 200, { ok: true })
  } catch (error) {
    return sendJson(res, 500, { error: error instanceof Error ? error.message : 'Sheets export failed' })
  }
}
