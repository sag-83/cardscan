/** Face ID / Touch ID gate for the mobile Revenue tab (WebAuthn platform authenticator). */

const CREDENTIAL_KEY = 'revenue_webauthn_cred_v1'
const SESSION_KEY = 'revenue_tab_unlocked_v1'

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

export function hasRevenueLockConfigured(): boolean {
  try {
    return !!localStorage.getItem(CREDENTIAL_KEY)
  } catch {
    return false
  }
}

export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return false
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}

async function registerPlatformCredential(): Promise<void> {
  const challenge = randomChallenge()
  const userId = new Uint8Array(16)
  crypto.getRandomValues(userId)

  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: challenge as BufferSource,
      rp: { name: 'Delta Diamonds', id: window.location.hostname || 'localhost' },
      user: {
        id: userId,
        name: 'revenue',
        displayName: 'Revenue access',
      },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null

  if (!cred) throw new Error('Face ID setup was cancelled.')
  localStorage.setItem(CREDENTIAL_KEY, bufferToBase64(cred.rawId))
}

async function verifyPlatformCredential(): Promise<void> {
  const stored = localStorage.getItem(CREDENTIAL_KEY)
  if (!stored) throw new Error('Face ID is not set up yet.')

  const challenge = randomChallenge()
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: challenge as BufferSource,
      allowCredentials: [{ id: base64ToBuffer(stored), type: 'public-key' }],
      userVerification: 'required',
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null

  if (!assertion) throw new Error('Face ID verification was cancelled.')
  sessionStorage.setItem(SESSION_KEY, '1')
}

/** Unlock Revenue tab — registers on first use, then verifies Face ID / Touch ID. */
export async function unlockRevenueTab(): Promise<{ ok: boolean; message?: string }> {
  const available = await isPlatformAuthenticatorAvailable()
  if (!available) {
    return {
      ok: false,
      message: 'Face ID is not available in this browser. Open the app from your iPhone home screen in Safari.',
    }
  }

  try {
    if (!hasRevenueLockConfigured()) {
      await registerPlatformCredential()
    }
    await verifyPlatformCredential()
    return { ok: true }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not verify Face ID.'
    return { ok: false, message }
  }
}
