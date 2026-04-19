import { createClient } from '@supabase/supabase-js'

const GEMINI_PROMPT = `You are a business card OCR extractor. Extract ALL contact info from this image.
Carefully read phone labels: if a number is labelled Cell/Mobile put in phone_mobile; if Tel/Work/Office put in phone_work; if Fax put in phone_fax. If no label, use phone_mobile.
Return ONLY a valid JSON array, no markdown. Example:
[{"name":"Full Name","title":"Job Title","company":"Company","email":"name@co.com","phone_mobile":"+1 917 555 0100","phone_work":"+1 718 555 0200","phone_fax":"","website":"co.com","address":"123 Main St","city":"New York","state":"NY","zip":"10001","country":"USA","notes":"LinkedIn: linkedin.com/in/name"}]
Empty string for missing fields. Return ONLY the JSON array.`

const RATE_STORE = globalThis.__cardscanRateStore ?? new Map()
globalThis.__cardscanRateStore = RATE_STORE

function getEnv(name, fallback = '') {
  return process.env[name] || fallback
}

export function getServerConfig() {
  return {
    supabaseUrl: getEnv('SUPABASE_URL', getEnv('VITE_SUPABASE_URL')),
    supabaseAnonKey: getEnv('SUPABASE_ANON_KEY', getEnv('VITE_SUPABASE_ANON_KEY')),
    geminiKeys: [
      getEnv('GEMINI_API_KEY'),
      getEnv('GEMINI_API_KEY2'),
      getEnv('GEMINI_API_KEY3'),
    ].filter(Boolean),
    sheetsWebhookUrl: getEnv('SHEETS_WEBHOOK_URL'),
  }
}

export function getBearerToken(req) {
  const authHeader = req.headers.authorization || ''
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  return match?.[1] || null
}

export async function verifySupabaseToken(accessToken) {
  const { supabaseUrl, supabaseAnonKey } = getServerConfig()
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Supabase server env is not configured')
  if (!accessToken) return null

  const client = createClient(supabaseUrl, supabaseAnonKey)
  const { data, error } = await client.auth.getUser(accessToken)
  if (error) return null
  return data.user ?? null
}

export function applyRateLimit({ key, limit, windowMs }) {
  const now = Date.now()
  const bucket = RATE_STORE.get(key)

  if (!bucket || bucket.resetAt <= now) {
    const nextBucket = { count: 1, resetAt: now + windowMs }
    RATE_STORE.set(key, nextBucket)
    return { allowed: true, remaining: limit - 1, resetAt: nextBucket.resetAt }
  }

  if (bucket.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: bucket.resetAt }
  }

  bucket.count += 1
  return { allowed: true, remaining: limit - bucket.count, resetAt: bucket.resetAt }
}

export function getClientIp(req) {
  const forwardedFor = req.headers['x-forwarded-for']
  if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
    return forwardedFor.split(',')[0].trim()
  }
  return 'unknown'
}

export async function fetchJsonWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    const json = await response.json().catch(() => null)
    return { response, json }
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function callGeminiOnServer(imageBase64, mimeType) {
  const { geminiKeys } = getServerConfig()
  if (!geminiKeys.length) throw new Error('Gemini server env is not configured')

  let lastError = null

  for (const apiKey of geminiKeys) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { response, json } = await fetchJsonWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: GEMINI_PROMPT },
                  { inline_data: { mime_type: mimeType, data: imageBase64 } },
                ],
              },
            ],
            generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
          }),
        },
        20_000
      )

      if (response.ok) {
        const text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
        const match = text.match(/\[[\s\S]*\]/)
        if (!match) throw new Error('No JSON array in OCR response')
        return JSON.parse(match[0])
      }

      lastError = new Error(json?.error?.message || `Gemini returned ${response.status}`)
      const shouldRetrySameKey = response.status >= 500 || response.status === 429
      if (!shouldRetrySameKey) break
    }
  }

  throw lastError ?? new Error('Gemini call failed')
}

export function sendJson(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}
