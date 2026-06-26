import { useEffect, useState, type FormEvent } from 'react'
import { KeyRound, ScanFace, Shield } from 'lucide-react'
import {
  isAppLoginRequired,
  isAppPasswordRequired,
  isAppPinConfigured,
  isAppPinRequired,
  unlockApp,
  usesAuthenticatorForAppLogin,
} from '../lib/appAuth'
import { isAuthenticatorEnabled, setAuthenticatorEnabled } from '../lib/authenticatorPreference'
import { applyDocumentTheme } from '../lib/theme'
import { hasPlatformCredential } from '../lib/webAuthnPlatform'
import { Waves } from './Waves'
import './AppLoginGate.css'

type Props = {
  onUnlock: () => void
}

export function AppLoginGate({ onUnlock }: Props) {
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [authMode, setAuthMode] = useState<'authenticator' | 'pin'>(() =>
    isAuthenticatorEnabled() ? 'authenticator' : 'pin',
  )
  const usesPassword = isAppPasswordRequired()
  const usesTotp = usesAuthenticatorForAppLogin()
  const usesPin = isAppPinRequired()
  const showAuthToggle = !usesPassword
  const faceReady = hasPlatformCredential('app')

  const switchAuthMode = (mode: 'authenticator' | 'pin') => {
    if (mode === authMode) return
    if (mode === 'pin' && !isAppPinConfigured()) {
      setError('PIN is not set up yet. Add VITE_APP_PIN in Vercel and redeploy.')
      return
    }
    setAuthenticatorEnabled(mode === 'authenticator')
    setAuthMode(mode)
    setError('')
    setPassword('')
    setTotpCode('')
  }

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
    if (usesPin && !password.trim()) {
      setError('Enter your PIN.')
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
      <Waves className="login-gate__bg" strokeColor="rgba(165,180,252,0.35)" backgroundColor="#08080c" />
      <div className="login-gate__veil" aria-hidden />
      <form className="login-gate__panel" onSubmit={(e) => void handleSubmit(e)}>
        <div className="login-gate__brand">
          <img src="/apple-touch-icon.png" alt="" className="login-gate__logo" width={72} height={72} />
          <p className="login-gate__eyebrow">Delta Diamonds Inc.</p>
          <h1 className="login-gate__title">Secure sign-in</h1>
          <p className="login-gate__subtitle">
            {usesTotp
              ? 'Enter your Microsoft Authenticator code, then verify with Face ID on this device.'
              : usesPin
                ? 'Enter your PIN, then verify with Face ID on this device.'
                : 'Enter your access credentials, then verify with Face ID on this device.'}
          </p>
        </div>

        {showAuthToggle && (
          <div className="login-gate__mode" role="group" aria-label="Sign-in method">
            <button
              type="button"
              className={`login-gate__mode-btn${authMode === 'authenticator' ? ' login-gate__mode-btn--active' : ''}`}
              onClick={() => switchAuthMode('authenticator')}
              disabled={loading}
              aria-pressed={authMode === 'authenticator'}
            >
              <Shield size={15} strokeWidth={2} aria-hidden />
              Authenticator
            </button>
            <button
              type="button"
              className={`login-gate__mode-btn${authMode === 'pin' ? ' login-gate__mode-btn--active' : ''}`}
              onClick={() => switchAuthMode('pin')}
              disabled={loading}
              aria-pressed={authMode === 'pin'}
            >
              <KeyRound size={15} strokeWidth={2} aria-hidden />
              PIN
            </button>
          </div>
        )}

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
              autoFocus={!usesTotp && !usesPin}
              disabled={loading}
              autoComplete="current-password"
            />
          </label>
        )}

        {usesPin && (
          <label className="login-gate__label">
            <span className="login-gate__label-text">PIN</span>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              className="login-gate__input"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                setError('')
              }}
              placeholder="Enter PIN"
              autoFocus
              disabled={loading}
            />
            <span className="login-gate__hint">Your app access PIN</span>
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
