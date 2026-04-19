import { useTheme } from '../hooks/useTheme'
import { useStore } from '../store/useStore'
import { blankContact } from '../lib/utils'

export function Header() {
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
        CardHolder
      </h1>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
    </header>
  )
}
