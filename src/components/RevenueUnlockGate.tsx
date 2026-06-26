import { useState } from 'react'
import { ScanFace } from 'lucide-react'
import {
  hasRevenueLockConfigured,
  isRevenuePinRequired,
  isRevenueSecondFactorVerifiedThisSession,
  unlockRevenueTab,
  usesAuthenticatorForRevenue,
} from '../lib/revenueLock'
import { AuthenticatorCodeInput } from './AuthenticatorCodeInput'

type Props = {
  onUnlocked: () => void
  onCancel: () => void
}

export function RevenueUnlockGate({ onUnlocked, onCancel }: Props) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const needsTotp = usesAuthenticatorForRevenue()
  const needsPin = isRevenuePinRequired() && !isRevenueSecondFactorVerifiedThisSession()
  const faceReady = hasRevenueLockConfigured()

  const handleUnlock = async () => {
    setError('')
    if (needsTotp && code.length !== 6) {
      setError('Enter the 6-digit code from Microsoft Authenticator.')
      return
    }
    if (needsPin && !code.trim()) {
      setError('Enter the revenue access code.')
      return
    }
    setLoading(true)
    const result = await unlockRevenueTab(code)
    setLoading(false)
    if (result.ok) onUnlocked()
    else setError(result.message || 'Could not unlock Revenue.')
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 400,
        background: 'var(--modal-bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="revenue-gate-title"
    >
      <div
        style={{
          width: '100%',
          maxWidth: 360,
          background: 'var(--bg2)',
          borderRadius: 16,
          padding: '22px 20px',
          border: '1px solid var(--border2)',
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
          <ScanFace size={26} strokeWidth={2} color="var(--accent)" aria-hidden />
        </div>
        <h2 id="revenue-gate-title" style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>
          Revenue is protected
        </h2>
        <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.45, marginBottom: 16 }}>
          {needsTotp
            ? 'Enter your Microsoft Authenticator code and Face ID. The app password alone is not enough.'
            : 'Revenue needs a separate access code and Face ID on this phone.'}
        </p>

        {needsTotp && (
          <AuthenticatorCodeInput
            value={code}
            onChange={setCode}
            label="Revenue authenticator code"
            disabled={loading}
          />
        )}

        {needsPin && !needsTotp && (
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase' }}>
              Revenue access code
            </span>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Owner only"
              disabled={loading}
              style={{
                display: 'block',
                width: '100%',
                marginTop: 6,
                padding: '12px 14px',
                borderRadius: 10,
                border: '1.5px solid var(--border)',
                background: 'var(--bg3)',
                color: 'var(--text)',
                fontSize: 16,
              }}
            />
          </label>
        )}

        {error && (
          <p style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 12, fontWeight: 600 }}>{error}</p>
        )}

        <button
          type="button"
          disabled={loading}
          onClick={() => void handleUnlock()}
          style={{
            width: '100%',
            padding: '13px 16px',
            borderRadius: 10,
            border: 'none',
            background: 'var(--accent)',
            color: '#fff',
            fontWeight: 800,
            fontSize: 15,
            cursor: loading ? 'wait' : 'pointer',
            opacity: loading ? 0.7 : 1,
            marginBottom: 8,
          }}
        >
          {loading ? 'Verifying…' : faceReady ? 'Unlock with Face ID' : 'Set up Face ID'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            width: '100%',
            padding: '11px 16px',
            borderRadius: 10,
            border: '1.5px solid var(--border)',
            background: 'transparent',
            color: 'var(--text2)',
            fontWeight: 700,
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
