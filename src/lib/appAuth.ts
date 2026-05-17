import { isPlatformAuthenticatorAvailable, ensurePlatformAuth } from './webAuthnPlatform'
import { isTotpRequired, verifyTotp } from './totp'

const APP_PASSWORD = ((import.meta.env.VITE_APP_PASSWORD as string) ?? '').trim()
export const APP_SESSION_KEY = 'cardscan_app_session_v1'

export function isAppPasswordRequired(): boolean {
  return APP_PASSWORD.length > 0
}

export function isAppSessionUnlocked(): boolean {
  try {
    return sessionStorage.getItem(APP_SESSION_KEY) === '1'
  } catch {
    return false
  }
}

export function markAppSessionUnlocked(): void {
  try {
    sessionStorage.setItem(APP_SESSION_KEY, '1')
  } catch {
    /* ignore */
  }
}

export function lockAppSession(): void {
  try {
    sessionStorage.removeItem(APP_SESSION_KEY)
    localStorage.removeItem('cardscan_app_unlocked')
  } catch {
    /* ignore */
  }
}

/**
 * Full app login: password + Microsoft Authenticator code (if configured) + Face ID.
 */
export async function unlockApp(
  password: string,
  totpCode: string,
): Promise<{ ok: boolean; message?: string }> {
  if (isAppPasswordRequired() && password.trim() !== APP_PASSWORD) {
    return { ok: false, message: 'Incorrect password.' }
  }

  if (isTotpRequired('app') && !verifyTotp('app', totpCode)) {
    return { ok: false, message: 'Invalid authenticator code. Open Microsoft Authenticator and try again.' }
  }

  const faceAvailable = await isPlatformAuthenticatorAvailable()
  if (faceAvailable) {
    try {
      await ensurePlatformAuth('app', 'CardHolder login')
      markAppSessionUnlocked()
      return { ok: true }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Face ID verification failed.'
      return { ok: false, message }
    }
  }

  if (isTotpRequired('app')) {
    markAppSessionUnlocked()
    return { ok: true }
  }

  return {
    ok: false,
    message: 'Face ID is not available. Add this app to your iPhone home screen, then open it from there.',
  }
}
