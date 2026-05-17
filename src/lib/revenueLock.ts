/** Revenue tab: authenticator code + Face ID (app password alone is not enough). */

import {
  ensurePlatformAuth,
  hasPlatformCredential,
  isPlatformAuthenticatorAvailable,
} from './webAuthnPlatform'
import { isTotpRequired, verifyTotp } from './totp'

const SESSION_KEY = 'revenue_tab_unlocked_v1'
const TOTP_VERIFIED_KEY = 'revenue_totp_verified_v1'
const PIN_VERIFIED_KEY = 'revenue_pin_verified_v1'

const REVENUE_PIN = (import.meta.env.VITE_REVENUE_PIN as string)?.trim() ?? ''

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let out = 0
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return out === 0
}

export function isRevenuePinRequired(): boolean {
  return REVENUE_PIN.length > 0 && !isTotpRequired('revenue')
}

export function verifyRevenuePin(pin: string): boolean {
  if (!isRevenuePinRequired()) return true
  return safeEqual(pin.trim(), REVENUE_PIN)
}

export function isRevenueSecondFactorRequired(): boolean {
  return isTotpRequired('revenue') || isRevenuePinRequired()
}

export function isRevenueSecondFactorVerifiedThisSession(): boolean {
  if (!isRevenueSecondFactorRequired()) return true
  try {
    if (isTotpRequired('revenue')) return sessionStorage.getItem(TOTP_VERIFIED_KEY) === '1'
    return sessionStorage.getItem(PIN_VERIFIED_KEY) === '1'
  } catch {
    return false
  }
}

function markRevenueSecondFactorVerified(): void {
  try {
    if (isTotpRequired('revenue')) sessionStorage.setItem(TOTP_VERIFIED_KEY, '1')
    else sessionStorage.setItem(PIN_VERIFIED_KEY, '1')
  } catch {
    /* ignore */
  }
}

export function isRevenueSessionUnlocked(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === '1'
  } catch {
    return false
  }
}

export function lockRevenueSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY)
  } catch {
    /* ignore */
  }
}

export function lockAllRevenueAccess(): void {
  lockRevenueSession()
  try {
    sessionStorage.removeItem(TOTP_VERIFIED_KEY)
    sessionStorage.removeItem(PIN_VERIFIED_KEY)
  } catch {
    /* ignore */
  }
}

export function hasRevenueLockConfigured(): boolean {
  return hasPlatformCredential('revenue')
}

export { isPlatformAuthenticatorAvailable }

/**
 * Unlock Revenue: Microsoft Authenticator code (or legacy PIN) + Face ID.
 */
export async function unlockRevenueTab(secondFactor: string): Promise<{ ok: boolean; message?: string }> {
  if (isTotpRequired('revenue')) {
    if (!verifyTotp('revenue', secondFactor)) {
      return { ok: false, message: 'Invalid authenticator code.' }
    }
    markRevenueSecondFactorVerified()
  } else if (isRevenuePinRequired()) {
    if (!verifyRevenuePin(secondFactor)) {
      return { ok: false, message: 'Incorrect revenue access code.' }
    }
    markRevenueSecondFactorVerified()
  }

  const faceAvailable = await isPlatformAuthenticatorAvailable()
  if (!faceAvailable) {
    if (isTotpRequired('revenue') || isRevenuePinRequired()) {
      sessionStorage.setItem(SESSION_KEY, '1')
      return { ok: true }
    }
    return {
      ok: false,
      message: 'Face ID is not available. Open the app from your iPhone home screen.',
    }
  }

  try {
    await ensurePlatformAuth('revenue', 'Revenue access')
    sessionStorage.setItem(SESSION_KEY, '1')
    return { ok: true }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not verify Face ID.'
    return { ok: false, message }
  }
}
