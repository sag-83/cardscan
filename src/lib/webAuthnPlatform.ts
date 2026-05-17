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

export async function registerPlatformCredential(
  scope: WebAuthnScope,
  displayName: string,
): Promise<void> {
  const challenge = randomChallenge()
  const userId = new Uint8Array(16)
  crypto.getRandomValues(userId)

  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: challenge as BufferSource,
      rp: { name: 'Delta Diamonds', id: window.location.hostname || 'localhost' },
      user: {
        id: userId,
        name: scope,
        displayName,
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
  localStorage.setItem(CREDENTIAL_KEYS[scope], bufferToBase64(cred.rawId))
}

export async function verifyPlatformCredential(scope: WebAuthnScope): Promise<void> {
  const stored = localStorage.getItem(CREDENTIAL_KEYS[scope])
  if (!stored) throw new Error('Face ID is not set up yet on this device.')

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
}

export async function ensurePlatformAuth(scope: WebAuthnScope, displayName: string): Promise<void> {
  if (!hasPlatformCredential(scope)) {
    await registerPlatformCredential(scope, displayName)
  }
  await verifyPlatformCredential(scope)
}
