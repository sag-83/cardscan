const GEMINI_PROMPT = `You are a business card OCR extractor. Extract ALL contact info from this image.
Carefully read phone labels: if a number is labelled Cell/Mobile put in phone_mobile; if Tel/Work/Office put in phone_work; if Fax put in phone_fax. If no label, use phone_mobile.
Return ONLY a valid JSON array, no markdown. Example:
[{"name":"Full Name","title":"Job Title","company":"Company","email":"name@co.com","phone_mobile":"+1 917 555 0100","phone_work":"+1 718 555 0200","phone_fax":"","website":"co.com","address":"123 Main St","city":"New York","state":"NY","zip":"10001","country":"USA","notes":"LinkedIn: linkedin.com/in/name"}]
Empty string for missing fields. Return ONLY the JSON array.`

const OCR_TIMEOUT_MS = 45_000
const GEMINI_KEY_CURSOR = 'cardscan_gemini_key_cursor'

async function callWithKey(
  b64: string,
  mime: string,
  apiKey: string
): Promise<Record<string, string>[]> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), OCR_TIMEOUT_MS)

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: GEMINI_PROMPT }, { inline_data: { mime_type: mime, data: b64 } }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
      }),
    }
  ).finally(() => window.clearTimeout(timeout))

  if (!res.ok) {
    let message = `Gemini API error ${res.status}`
    try {
      const data = await res.json()
      message = data?.error?.message || message
    } catch {
      // Keep the status-only message if Google does not return JSON.
    }

    if (res.status === 429) {
      message = 'Gemini quota/rate limit reached. Try again later, use another Gemini key, or use a smaller image instead of a PDF scan.'
    }

    const err = new Error(message) as Error & { status: number }
    err.status = res.status
    throw err
  }
  const data = await res.json()
  const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) throw new Error('No JSON array in response')
  return JSON.parse(match[0]) as Record<string, string>[]
}

function isQuotaError(err: unknown): boolean {
  return err instanceof Error && 'status' in err && (err as { status: number }).status === 429
}

function getKeyCursor(totalKeys: number): number {
  const saved = Number(window.localStorage.getItem(GEMINI_KEY_CURSOR) ?? 0)
  return Number.isFinite(saved) && totalKeys > 0 ? saved % totalKeys : 0
}

function setKeyCursor(nextIndex: number, totalKeys: number): void {
  if (totalKeys <= 0) return
  window.localStorage.setItem(GEMINI_KEY_CURSOR, String(nextIndex % totalKeys))
}

function rotateKeys(keys: string[]): Array<{ key: string; originalIndex: number }> {
  const cursor = getKeyCursor(keys.length)
  return keys.map((_, offset) => {
    const originalIndex = (cursor + offset) % keys.length
    return { key: keys[originalIndex], originalIndex }
  })
}

export async function callGemini(
  b64: string,
  mime: string,
  keys: string[]
): Promise<Record<string, string>[]> {
  const validKeys = keys.filter(Boolean)
  if (!validKeys.length) throw new Error('No Gemini API key configured')

  const orderedKeys = rotateKeys(validKeys)
  let lastErr: unknown

  for (let i = 0; i < orderedKeys.length; i++) {
    const { key, originalIndex } = orderedKeys[i]
    try {
      const result = await callWithKey(b64, mime, key)
      setKeyCursor(originalIndex + 1, validKeys.length)
      return result
    } catch (err) {
      lastErr = err

      if (isQuotaError(err)) {
        setKeyCursor(originalIndex + 1, validKeys.length)
        console.warn(`Gemini key ${originalIndex + 1} hit quota, trying next configured key`)
        continue
      }

      throw err
    }
  }

  if (isQuotaError(lastErr)) {
    throw new Error(`All ${validKeys.length} Gemini keys hit quota/rate limits. Try again later, add a fresh Gemini key, or use a smaller image instead of a PDF scan.`)
  }

  throw lastErr
}

export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

export async function resizeImage(b64: string, mime: string, maxWidth: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.78).split(',')[1])
    }
    img.onerror = () => resolve(b64) // fallback: send original if resize fails
    img.src = `data:${mime};base64,${b64}`
  })
}
