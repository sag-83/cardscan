type Props = {
  value: string
  onChange: (value: string) => void
  label?: string
  disabled?: boolean
}

const inputStyle = {
  display: 'block',
  width: '100%',
  marginTop: 6,
  padding: '12px 14px',
  borderRadius: 10,
  border: '1.5px solid var(--border)',
  background: 'var(--bg3)',
  color: 'var(--text)',
  fontSize: 22,
  letterSpacing: '0.35em',
  textAlign: 'center' as const,
  fontVariantNumeric: 'tabular-nums',
}

export function AuthenticatorCodeInput({
  value,
  onChange,
  label = 'Authenticator code',
  disabled,
}: Props) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase' }}>
        {label}
      </span>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        placeholder="000000"
        aria-label={label}
        style={inputStyle}
      />
      <span style={{ display: 'block', fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>
        6-digit code from Microsoft Authenticator
      </span>
    </label>
  )
}
