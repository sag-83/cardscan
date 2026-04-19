import {
  applyRateLimit,
  callGeminiOnServer,
  getBearerToken,
  getClientIp,
  sendJson,
  verifySupabaseToken,
} from './_shared.js'

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
const MAX_IMAGE_BASE64_LENGTH = 12 * 1024 * 1024

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '12mb',
    },
  },
}

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
      key: `scan:${user.id}:${ip}`,
      limit: 15,
      windowMs: 15 * 60 * 1000,
    })

    res.setHeader('X-RateLimit-Remaining', String(rateLimit.remaining))
    res.setHeader('X-RateLimit-Reset', String(rateLimit.resetAt))

    if (!rateLimit.allowed) {
      return sendJson(res, 429, { error: 'Scan rate limit reached. Please wait before trying again.' })
    }

    const { imageBase64, mimeType } = req.body || {}
    if (typeof imageBase64 !== 'string' || typeof mimeType !== 'string') {
      return sendJson(res, 400, { error: 'Invalid scan payload' })
    }

    if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
      return sendJson(res, 400, { error: 'Unsupported image type' })
    }

    if (imageBase64.length > MAX_IMAGE_BASE64_LENGTH) {
      return sendJson(res, 413, { error: 'Image is too large' })
    }

    const contacts = await callGeminiOnServer(imageBase64, mimeType)
    return sendJson(res, 200, { contacts })
  } catch (error) {
    return sendJson(res, 500, { error: error instanceof Error ? error.message : 'Scan failed' })
  }
}
