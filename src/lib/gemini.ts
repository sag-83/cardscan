const GEMINI_PROMPT = `You are a business card OCR extractor. Extract ALL contact info from this image.
Carefully read phone labels: if a number is labelled Cell/Mobile put in phone_mobile; if Tel/Work/Office put in phone_work; if Fax put in phone_fax. If no label, use phone_mobile.
Return ONLY a valid JSON array, no markdown. Example:
[{"name":"Full Name","title":"Job Title","company":"Company","email":"name@co.com","phone_mobile":"+1 917 555 0100","phone_work":"+1 718 555 0200","phone_fax":"","website":"co.com","address":"123 Main St","city":"New York","state":"NY","zip":"10001","country":"USA","notes":"LinkedIn: linkedin.com/in/name"}]
Empty string for missing fields. Return ONLY the JSON array.`

const OCR_TIMEOUT_MS = 45_000

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
    const err = new Error('API error ' + res.status) as Error & { status: number }
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

export async function callGemini(
  b64: string,
  mime: string,
  keys: string[]
): Promise<Record<string, string>[]> {
  const validKeys = keys.filter(Boolean)
  if (!validKeys.length) throw new Error('No Gemini API key configured')
  let lastErr: unknown
  for (let i = 0; i < validKeys.length; i++) {
    try {
      return await callWithKey(b64, mime, validKeys[i])
    } catch (err) {
      lastErr = err
      if (isQuotaError(err) && i < validKeys.length - 1) {
        console.warn(`Gemini key ${i + 1} hit quota, trying key ${i + 2}`)
        continue
      }
      throw err
    }
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
