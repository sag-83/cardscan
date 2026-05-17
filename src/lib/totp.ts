/** TOTP codes — works with Microsoft Authenticator, Google Authenticator, etc. */

import { TOTP } from 'otpauth'

export type TotpScope = 'app' | 'revenue'

const SECRETS: Record<TotpScope, string> = {
  app: ((import.meta.env.VITE_APP_TOTP_SECRET as string) ?? '').trim(),
  revenue: ((import.meta.env.VITE_REVENUE_TOTP_SECRET as string) ?? '').trim(),
}

const LABELS: Record<TotpScope, string> = {
  app: 'CardHolder',
  revenue: 'Revenue',
}

export function isTotpRequired(scope: TotpScope): boolean {
  return SECRETS[scope].length > 0
}

export function verifyTotp(scope: TotpScope, code: string): boolean {
  const secret = SECRETS[scope]
  if (!secret) return true

  const token = code.replace(/\D/g, '')
  if (token.length !== 6) return false

  try {
    const totp = new TOTP({ secret, digits: 6, period: 30 })
    return totp.validate({ token, window: 1 }) !== null
  } catch {
    return false
  }
}

/** otpauth:// URI — scan in Microsoft Authenticator → Add account → Scan QR (paste link if needed). */
export function getTotpSetupUri(scope: TotpScope): string | null {
  const secret = SECRETS[scope]
  if (!secret) return null
  try {
    const totp = new TOTP({
      issuer: 'Delta Diamonds',
      label: LABELS[scope],
      secret,
      digits: 6,
      period: 30,
    })
    return totp.toString()
  } catch {
    return null
  }
}
