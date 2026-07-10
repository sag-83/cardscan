import { useStore } from '../store/useStore'
import { NAV_TABS } from './NavBar'

export const SIDEBAR_WIDTH = 240

export function Sidebar() {
  const activeScreen = useStore((s) => s.activeScreen)
  const setActiveScreen = useStore((s) => s.setActiveScreen)

  return (
    <nav
      style={{
        position: 'fixed', top: 0, left: 0, bottom: 0, width: SIDEBAR_WIDTH,
        display: 'flex', flexDirection: 'column', gap: 4,
        background: 'var(--bg2)', borderRight: '1px solid var(--border2)',
        padding: '16px 10px', zIndex: 50,
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', padding: '6px 10px 18px' }}>
        CardHolder
      </div>
      {NAV_TABS.map(({ id, label, Icon }) => {
        const active = activeScreen === id
        return (
          <button
            key={id}
            onClick={() => setActiveScreen(id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 12px', borderRadius: 10, border: 'none',
              background: active ? 'var(--chip-accent-bg)' : 'transparent',
              color: active ? 'var(--accent)' : 'var(--text2)',
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
              textAlign: 'left', transition: 'background 0.15s, color 0.15s',
            }}
          >
            <Icon size={19} strokeWidth={active ? 2.25 : 1.85} aria-hidden />
            {label}
          </button>
        )
      })}
    </nav>
  )
}
