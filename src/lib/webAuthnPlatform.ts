/** Platform WebAuthn (Face ID / Touch ID) — separate credential per scope. */

export type WebAuthnScope = 'app' | 'revenue'

const CREDENTIAL_KEYS: Record<WebAuthnScope, string> = {
  app: 'app_webauthn_cred_v1',
  revenue: 'revenue_webauthn_cred_v1',
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

function randomChallenge(): Uint8Array {
  const challenge = new Uint8Array(32)
  crypto.getRandomValues(challenge)
  return challenge
}

/**
 * Stable per-scope user handle. Authenticators replace a credential when
 * (rpId, user.id) repeats, so re-enrolling overwrites the old passkey instead
 * of leaving a pile of dead entries in the Windows Hello / iCloud picker.
 */
function scopeUserId(scope: WebAuthnScope): Uint8Array {
  const bytes = new Uint8Array(32)
  bytes.set(new TextEncoder().encode(`cardscan:${scope}`).subarray(0, 32))
  return bytes
}

export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return false
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}

export function hasPlatformCredential(scope: WebAuthnScope): boolean {
  try {
    return !!localStorage.getItem(CREDENTIAL_KEYS[scope])
  } catch {
    return false
  }
}

/**
 * Forgets the saved credential so the next sign-in registers a fresh one.
 *
 * Needed because we only hold the credential *id*; the key itself lives with
 * the operating system. Anything that wipes those keys — resetting a Windows
 * Hello PIN, enrolling a new fingerprint set, clearing browser passkeys —
 * leaves us pointing at a credential the device no longer has, and every
 * verification then fails no matter how good the fingerprint read is.
 *
 * Safe to expose: the PIN or authenticator code is still required, and
 * registering again demands a successful device unlock.
 */
export function clearPlatformCredential(scope: WebAuthnScope): void {
  try {
    localStorage.removeItem(CREDENTIAL_KEYS[scope])
  } catch {
    /* ignore */
  }
}

/** What this device actually calls its biometric unlock, for use in copy. */
export function platformAuthLabel(): string {
  if (typeof navigator === 'undefined') return 'device unlock'
  const ua = navigator.userAgent
  // iPadOS reports itself as a Mac, so touch support disambiguates.
  if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    return 'Face ID'
  }
  if (/Windows/.test(ua)) return 'Windows Hello'
  if (/Macintosh|Mac OS X/.test(ua)) return 'Touch ID'
  if (/Android/.test(ua)) return 'fingerprint unlock'
  return 'device unlock'
}

export async function registerPlatformCredential(
  scope: WebAuthnScope,
  displayName: string,
): Promise<void> {
  const create = (residentKey: ResidentKeyRequirement) =>
    navigator.credentials.create({
      publicKey: {
        challenge: randomChallenge() as BufferSource,
        rp: { name: 'AK Gems Inc', id: window.location.hostname || 'localhost' },
        user: {
          id: scopeUserId(scope) as BufferSource,
          name: scope,
          displayName,
        },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey,
        },
        timeout: 60_000,
      },
    }) as Promise<PublicKeyCredential | null>

  // Discoverable, so verification can find it without a saved id. Degrade
  // rather than refuse to enrol if the authenticator can't store one.
  let cred: PublicKeyCredential | null
  try {
    cred = await create('required')
  } catch {
    cred = await create('preferred')
  }

  if (!cred) throw new Error(`${platformAuthLabel()} setup was cancelled.`)
  localStorage.setItem(CREDENTIAL_KEYS[scope], bufferToBase64(cred.rawId))
}

async function requestAssertion(allowId: string | null): Promise<PublicKeyCredential | null> {
  return (await navigator.credentials.get({
    publicKey: {
      challenge: randomChallenge() as BufferSource,
      ...(allowId ? { allowCredentials: [{ id: base64ToBuffer(allowId), type: 'public-key' as const }] } : {}),
      userVerification: 'required',
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null
}

/**
 * Accepts any device credential registered for this origin rather than one
 * specific saved id.
 *
 * Pinning the id meant a credential the OS had since discarded — after a
 * Windows Hello PIN reset, say — could never be satisfied, locking the user
 * out even though their device unlock worked fine. Letting the platform pick
 * also means whichever method they have enrolled counts: a Hello PIN gets
 * them in when the fingerprint reader is unenrolled or unsupported.
 *
 * This is a local device-unlock gate with no server-side assertion check, and
 * the PIN or authenticator code is still required, so trusting any credential
 * on the device costs nothing we were actually relying on.
 */
export async function verifyPlatformCredential(scope: WebAuthnScope): Promise<void> {
  const stored = localStorage.getItem(CREDENTIAL_KEYS[scope])
  let assertion: PublicKeyCredential | null = null

  try {
    assertion = await requestAssertion(null)
  } catch (discoverableError) {
    // Credentials registered before residentKey became required are not
    // discoverable, so fall back to asking for the saved id directly.
    if (!stored) throw discoverableError
    assertion = await requestAssertion(stored)
  }

  if (!assertion) throw new Error(`${platformAuthLabel()} verification was cancelled.`)

  // Keep the saved id in step with whatever the device actually used.
  const usedId = bufferToBase64(assertion.rawId)
  if (usedId !== stored) {
    try {
      localStorage.setItem(CREDENTIAL_KEYS[scope], usedId)
    } catch {
      /* ignore */
    }
  }
}

export async function ensurePlatformAuth(scope: WebAuthnScope, displayName: string): Promise<void> {
  if (!hasPlatformCredential(scope)) {
    await registerPlatformCredential(scope, displayName)
  }
  await verifyPlatformCredential(scope)
}
