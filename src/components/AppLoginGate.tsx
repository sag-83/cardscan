import { useEffect, useState, type FormEvent } from 'react'
import { ScanFace } from 'lucide-react'
import {
  isAppLoginRequired,
  isAppPasswordRequired,
  unlockApp,
  usesAuthenticatorForAppLogin,
} from '../lib/appAuth'
import { applyDocumentTheme } from '../lib/theme'
import { hasPlatformCredential } from '../lib/webAuthnPlatform'
import { NeuralBackground } from './NeuralBackground'
import './AppLoginGate.css'

type Props = {
  onUnlock: () => void
}

export function AppLoginGate({ onUnlock }: Props) {
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const usesTotp = usesAuthenticatorForAppLogin()
  const usesPassword = isAppPasswordRequired()
  const faceReady = hasPlatformCredential('app')

  useEffect(() => {
    applyDocumentTheme('dark')
    const meta = document.getElementById('metaTheme')
    if (meta) meta.setAttribute('content', '#08080c')
    document.documentElement.style.backgroundColor = '#08080c'
    return () => {
      document.documentElement.style.backgroundColor = ''
    }
  }, [])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')

    if (usesPassword && !password.trim()) {
      setError('Enter your access password.')
      return
    }
    if (usesTotp && totpCode.length !== 6) {
      setError('Enter the 6-digit code from Microsoft Authenticator.')
      return
    }

    setLoading(true)
    const result = await unlockApp(password, totpCode)
    setLoading(false)

    if (result.ok) onUnlock()
    else setError(result.message || 'Could not unlock.')
  }

  if (!isAppLoginRequired()) {
    return (
      <div className="login-gate__config">
        Login is not configured. Add <strong>VITE_APP_TOTP_SECRET</strong> in Vercel and redeploy.
      </div>
    )
  }

  return (
    <div className="login-gate">
      <NeuralBackground className="login-gate__bg" color="#a5b4fc" trailOpacity={0.14} />
      <div className="login-gate__veil" aria-hidden />
      <form className="login-gate__panel" onSubmit={(e) => void handleSubmit(e)}>
        <div className="login-gate__brand">
          <img src="/apple-touch-icon.png" alt="" className="login-gate__logo" width={72} height={72} />
          <p className="login-gate__eyebrow">Delta Diamonds Inc.</p>
          <h1 className="login-gate__title">Secure sign-in</h1>
          <p className="login-gate__subtitle">
            {usesTotp
              ? 'Enter your Microsoft Authenticator code, then verify with Face ID on this device.'
              : 'Enter your access credentials, then verify with Face ID on this device.'}
          </p>
        </div>

        {usesPassword && (
          <label className="login-gate__label">
            <span className="login-gate__label-text">Access password</span>
            <input
              type="password"
              className="login-gate__input"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                setError('')
              }}
              placeholder="Password"
              autoFocus={!usesTotp}
              disabled={loading}
              autoComplete="current-password"
            />
          </label>
        )}

        {usesTotp && (
          <label className="login-gate__label">
            <span className="login-gate__label-text">Authenticator code</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="login-gate__input login-gate__input--code"
              value={totpCode}
              disabled={loading}
              onChange={(e) => {
                setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                setError('')
              }}
              placeholder="000000"
              aria-label="Authenticator code"
              autoFocus
            />
            <span className="login-gate__hint">6-digit code from Microsoft Authenticator</span>
          </label>
        )}

        {error && <p className="login-gate__error" role="alert">{error}</p>}

        <button type="submit" className="login-gate__submit" disabled={loading}>
          <ScanFace size={20} strokeWidth={2} aria-hidden />
          {loading ? 'Verifying…' : faceReady ? 'Continue with Face ID' : 'Set up Face ID'}
        </button>

        <p className="login-gate__footer">
          For Face ID, open from your iPhone home screen shortcut (not the Safari tab).
        </p>
      </form>
    </div>
  )
}
