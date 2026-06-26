import { isAuthenticatorEnabled } from './authenticatorPreference'
import { isPlatformAuthenticatorAvailable, ensurePlatformAuth } from './webAuthnPlatform'
import { isTotpRequired, verifyTotp } from './totp'

const APP_PASSWORD = ((import.meta.env.VITE_APP_PASSWORD as string) ?? '').trim()
const APP_PIN = ((import.meta.env.VITE_APP_PIN as string) ?? '').trim()
export const APP_SESSION_KEY = 'cardscan_app_session_v1'

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let out = 0
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return out === 0
}

/** True when legacy env password is set and TOTP is not used for app login. */
export function isAppPasswordRequired(): boolean {
  return APP_PASSWORD.length > 0 && !isTotpRequired('app')
}

export function isAppPinConfigured(): boolean {
  return APP_PIN.length > 0
}

export function isAppPinRequired(): boolean {
  return isAppPinConfigured() && isTotpRequired('app') && !isAuthenticatorEnabled()
}

/** App needs a login screen (Authenticator, PIN, and/or legacy password). */
export function isAppLoginRequired(): boolean {
  return isTotpRequired('app') || isAppPasswordRequired()
}

export function usesAuthenticatorForAppLogin(): boolean {
  return isTotpRequired('app') && isAuthenticatorEnabled()
}

export function canToggleAuthenticator(): boolean {
  return isTotpRequired('app')
}

export function verifyAppPin(pin: string): boolean {
  if (!isAppPinRequired()) return true
  return safeEqual(pin.trim(), APP_PIN)
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
 * App login: Microsoft Authenticator + Face ID when TOTP is configured.
 * Legacy password-only login only if VITE_APP_TOTP_SECRET is not set.
 */
export async function unlockApp(
  password: string,
  totpCode: string,
): Promise<{ ok: boolean; message?: string }> {
  if (usesAuthenticatorForAppLogin()) {
    if (!verifyTotp('app', totpCode)) {
      return { ok: false, message: 'Invalid authenticator code. Open Microsoft Authenticator and try again.' }
    }
  } else if (isAppPinRequired()) {
    if (!verifyAppPin(password)) {
      return { ok: false, message: 'Incorrect PIN.' }
    }
  } else if (isAppPasswordRequired()) {
    if (password.trim() !== APP_PASSWORD) {
      return { ok: false, message: 'Incorrect password.' }
    }
  } else {
    return { ok: false, message: 'App login is not configured. Add VITE_APP_TOTP_SECRET in Vercel.' }
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

  if (usesAuthenticatorForAppLogin() || isAppPinRequired()) {
    markAppSessionUnlocked()
    return { ok: true }
  }

  return {
    ok: false,
    message: 'Face ID is not available. Add this app to your iPhone home screen, then open it from there.',
  }
}
