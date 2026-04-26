import { useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import { useStore } from '../store/useStore'
import { blankContact } from '../lib/utils'
import { IS_DEMO_MODE } from '../lib/demo'

export function Header() {
  const [showQr, setShowQr] = useState(false)
  const { theme, toggle } = useTheme()
  const contacts = useStore((s) => s.contacts)
  const setEditModal = useStore((s) => s.setEditModal)

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '10px 14px',
        background: 'var(--bg2)',
        borderBottom: '1px solid var(--border2)',
        position: 'sticky',
        top: 0,
        zIndex: 50,
        backdropFilter: 'blur(20px)',
      }}
    >
      {/* Theme toggle */}
      <button
        onClick={toggle}
        style={{
          width: 32, height: 32, borderRadius: '50%', border: 'none',
          background: 'var(--bg3)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', cursor: 'pointer', fontSize: 15, flexShrink: 0,
          transition: '0.15s',
        }}
        aria-label="Toggle theme"
      >
        {theme === 'dark' ? '☀️' : '🌙'}
      </button>

      <h1
        style={{
          fontSize: 17, fontWeight: 700, flex: 1,
          textAlign: 'center', color: 'var(--text)',
        }}
      >
        CardHolder {IS_DEMO_MODE ? 'Demo' : ''}
      </h1>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={() => setShowQr((v) => !v)}
          style={{
            width: 32, height: 32, borderRadius: '50%', border: 'none',
            background: 'var(--bg3)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', cursor: 'pointer', fontSize: 14, flexShrink: 0,
            transition: '0.15s',
          }}
          aria-label="Show my QR code"
          title="Show my QR code"
        >
          QR
        </button>
        {contacts.length > 0 && (
          <span
            style={{
              background: 'var(--accent)', color: '#fff',
              borderRadius: 99, padding: '2px 9px', fontSize: 12, fontWeight: 700,
            }}
          >
            {contacts.length}
          </span>
        )}
        <button
          onClick={() => setEditModal({ contact: blankContact(), isNew: true })}
          style={{
            width: 32, height: 32, borderRadius: '50%', border: 'none',
            background: 'var(--bg3)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', cursor: 'pointer', fontSize: 18, flexShrink: 0,
            transition: '0.15s',
          }}
          aria-label="Add contact"
        >
          ＋
        </button>
      </div>

      {showQr && (
        <div
          onClick={() => setShowQr(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.88)',
            zIndex: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <img
            src="/my-contact-qr.png"
            alt="My contact QR code"
            style={{
              width: '100%',
              maxWidth: 460,
              borderRadius: 14,
              background: '#fff',
            }}
          />
        </div>
      )}
    </header>
  )
}
