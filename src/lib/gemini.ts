import { getAccessToken } from './supabase'

const SCAN_TIMEOUT_MS = 25_000

export async function scanBusinessCard(
  b64: string,
  mime: string
): Promise<Record<string, string>[]> {
  const accessToken = await getAccessToken()
  if (!accessToken) throw new Error('Sign in required before scanning')

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS)

  try {
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        imageBase64: b64,
        mimeType: mime,
      }),
      signal: controller.signal,
    })

    const payload = (await res.json().catch(() => null)) as
      | { error?: string; contacts?: Record<string, string>[] }
      | null

    if (!res.ok) {
      throw new Error(payload?.error || `Scan failed with status ${res.status}`)
    }

    return payload?.contacts ?? []
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Scan timed out. Please try again.')
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
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
    img.onerror = () => resolve(b64)
    img.src = `data:${mime};base64,${b64}`
  })
}
