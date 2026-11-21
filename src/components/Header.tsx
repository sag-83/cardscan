import { Moon, Sun, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTheme } from '../hooks/useTheme'
import { useStore } from '../store/useStore'
import { IS_DEMO_MODE } from '../lib/demo'
import { useIsDesktop } from '../hooks/useIsDesktop'

export function Header() {
  const [showQr, setShowQr] = useState(false)
  const [qrPressed, setQrPressed] = useState(false)
  const { theme, toggle } = useTheme()
  const contactCount = useStore((s) => s.contacts.length)
  const activeScreen = useStore((s) => s.activeScreen)
  const isDesktop = useIsDesktop()

  // Trips on phone: no header at all — theme lives in the map toolbar.
  const tripsCompact = activeScreen === 'trips' && !isDesktop
  const showQrButton = activeScreen === 'contacts'

  // Leave Contacts → hide QR (button is gone there anyway).
  useEffect(() => {
    if (!showQrButton) setShowQr(false)
  }, [showQrButton])

  useEffect(() => {
    if (!showQr) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowQr(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [showQr])

  if (tripsCompact) return null

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
      <button
        onClick={toggle}
        style={{
          width: 32, height: 32, borderRadius: '50%', border: 'none',
          background: 'var(--bg3)', color: 'var(--text2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', fontSize: 15, flexShrink: 0, transition: '0.15s',
        }}
        aria-label="Toggle theme"
      >
        {theme === 'dark' ? <Sun size={18} strokeWidth={2.25} /> : <Moon size={18} strokeWidth={2.25} />}
      </button>

      <h1
        style={{
          fontSize: 17, fontWeight: 700, flex: 1,
          textAlign: 'center', color: 'var(--text)',
        }}
      >
        CardHolder {IS_DEMO_MODE ? 'Demo' : ''}
      </h1>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: showQrButton ? undefined : 32 }}>
        {showQrButton && (
          <button
            type="button"
            onClick={() => setShowQr(true)}
            onPointerDown={() => setQrPressed(true)}
            onPointerUp={() => setQrPressed(false)}
            onPointerCancel={() => setQrPressed(false)}
            style={{
              width: 32, height: 32, borderRadius: '50%', border: 'none',
              background: 'var(--bg3)', color: 'var(--text2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', fontSize: 14, fontWeight: 700, flexShrink: 0,
              transition: '0.12s',
              transform: qrPressed ? 'scale(0.93)' : 'scale(1)',
              boxShadow: qrPressed ? 'inset 0 0 0 2px rgba(0,122,255,0.35)' : 'none',
            }}
            aria-label="Show my QR code"
            title="Show my QR code"
          >
            QR
          </button>
        )}
        {contactCount > 0 && (
          <span
            style={{
              background: 'var(--accent)', color: '#fff',
              borderRadius: 99, padding: '2px 9px', fontSize: 12, fontWeight: 700,
            }}
          >
            {contactCount}
          </span>
        )}
      </div>

      {showQr && showQrButton && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="My contact QR code"
          onClick={() => setShowQr(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            background: 'rgba(0,0,0,0.92)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left))',
            boxSizing: 'border-box',
            animation: 'fadeIn 0.18s ease',
            cursor: 'pointer',
          }}
        >
          <button
            type="button"
            onClick={() => setShowQr(false)}
            aria-label="Close QR"
            style={{
              position: 'fixed',
              top: 'max(16px, env(safe-area-inset-top))',
              right: 'max(16px, env(safe-area-inset-right))',
              width: 44,
              height: 44,
              borderRadius: '50%',
              border: 'none',
              background: 'rgba(255,255,255,0.14)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              zIndex: 1,
            }}
          >
            <X size={22} strokeWidth={2.25} />
          </button>
          <img
            src="/my-contact-qr.png"
            alt="My contact QR code"
            onClick={(e) => e.stopPropagation()}
            draggable={false}
            style={{
              display: 'block',
              width: 'min(88vw, 420px)',
              height: 'auto',
              maxHeight: 'min(80dvh, 420px)',
              aspectRatio: '1 / 1',
              objectFit: 'contain',
              borderRadius: 16,
              background: '#fff',
              padding: 12,
              boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
              cursor: 'default',
              userSelect: 'none',
            }}
          />
        </div>,
        document.body,
      )}
    </header>
  )
}
