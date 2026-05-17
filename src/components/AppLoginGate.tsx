import { useState, type FormEvent } from 'react'
import { ScanFace, Shield } from 'lucide-react'
import { unlockApp } from '../lib/appAuth'
import { isTotpRequired } from '../lib/totp'
import { hasPlatformCredential } from '../lib/webAuthnPlatform'
import { AuthenticatorCodeInput } from './AuthenticatorCodeInput'

type Props = {
  onUnlock: () => void
}

export function AppLoginGate({ onUnlock }: Props) {
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const needsTotp = isTotpRequired('app')
  const faceReady = hasPlatformCredential('app')

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')

    if (!password.trim()) {
      setError('Enter your access password.')
      return
    }
    if (needsTotp && totpCode.length !== 6) {
      setError('Enter the 6-digit code from Microsoft Authenticator.')
      return
    }

    setLoading(true)
    const result = await unlockApp(password, totpCode)
    setLoading(false)

    if (result.ok) onUnlock()
    else setError(result.message || 'Could not unlock.')
  }

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: 20,
        background:
          'radial-gradient(circle at top, rgba(0,122,255,0.18), transparent 34%), var(--bg)',
      }}
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        style={{
          width: '100%',
          maxWidth: 390,
          background: 'var(--bg2)',
          border: '1px solid var(--border2)',
          borderRadius: 22,
          padding: 24,
          boxShadow: '0 18px 50px rgba(0,0,0,0.12)',
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: 'rgba(10, 132, 255, 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 14,
          }}
        >
          <Shield size={24} strokeWidth={2} color="var(--accent)" aria-hidden />
        </div>
        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--accent)', marginBottom: 8 }}>Private Access</div>
        <h1 style={{ fontSize: 28, lineHeight: 1.1, marginBottom: 10 }}>CardHolder</h1>
        <p style={{ color: 'var(--text3)', fontSize: 14, lineHeight: 1.5, marginBottom: 18 }}>
          Password{needsTotp ? ', authenticator code' : ''}, and Face ID on this phone.
        </p>

        <label style={{ display: 'block', marginBottom: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase' }}>
            Access password
          </span>
          <input
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setError('')
            }}
            placeholder="Access password"
            autoFocus
            disabled={loading}
            style={{
              display: 'block',
              width: '100%',
              marginTop: 6,
              padding: '14px 15px',
              borderRadius: 12,
              border: '1.5px solid var(--border)',
              background: 'var(--bg3)',
              fontSize: 16,
            }}
          />
        </label>

        {needsTotp && (
          <AuthenticatorCodeInput
            value={totpCode}
            onChange={(v) => {
              setTotpCode(v)
              setError('')
            }}
            disabled={loading}
          />
        )}

        {error && (
          <div style={{ color: 'var(--danger)', fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{error}</div>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%',
            border: 'none',
            borderRadius: 12,
            padding: '14px 18px',
            background: 'var(--accent)',
            color: '#fff',
            fontSize: 16,
            fontWeight: 800,
            cursor: loading ? 'wait' : 'pointer',
            opacity: loading ? 0.7 : 1,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <ScanFace size={20} strokeWidth={2} aria-hidden />
          {loading ? 'Verifying…' : faceReady ? 'Unlock with Face ID' : 'Set up Face ID'}
        </button>

        <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 14, lineHeight: 1.45 }}>
          Add this site to your iPhone home screen for Face ID. Use Microsoft Authenticator with the setup secrets from
          Vercel.
        </p>
      </form>
    </div>
  )
}
