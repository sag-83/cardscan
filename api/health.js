import {
  getBearerToken,
  getServerConfig,
  sendJson,
  verifySupabaseToken,
} from './_shared.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' })
  }

  try {
    const config = getServerConfig()
    const accessToken = getBearerToken(req)
    const user = accessToken ? await verifySupabaseToken(accessToken) : null

    return sendJson(res, 200, {
      ok: true,
      server: {
        supabaseConfigured: Boolean(config.supabaseUrl && config.supabaseAnonKey),
        geminiConfigured: config.geminiKeys.length > 0,
        sheetsConfigured: Boolean(config.sheetsWebhookUrl),
      },
      auth: {
        authenticated: Boolean(user),
        userId: user?.id ?? null,
      },
    })
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : 'Health check failed',
    })
  }
}
