/** User preference: Microsoft Authenticator vs PIN for app + revenue unlock. */

const PREF_KEY = 'cardscan_use_authenticator_v1'
export const AUTH_PREF_CHANGED_EVENT = 'cardscan:auth-pref-changed'

export function isAuthenticatorEnabled(): boolean {
  try {
    const stored = localStorage.getItem(PREF_KEY)
    if (stored === '0') return false
    if (stored === '1') return true
  } catch {
    /* ignore */
  }
  return true
}

export function setAuthenticatorEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, enabled ? '1' : '0')
    window.dispatchEvent(new CustomEvent(AUTH_PREF_CHANGED_EVENT))
  } catch {
    /* ignore */
  }
}
