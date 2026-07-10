import { Camera, LineChart, Send, Settings, Users } from 'lucide-react'
import { useStore } from '../store/useStore'
import { Screen } from '../types/contact'

export interface NavTab {
  id: Screen
  label: string
  Icon: typeof Camera
}

export const NAV_TABS: NavTab[] = [
  { id: 'scan', label: 'Scan', Icon: Camera },
  { id: 'contacts', label: 'Contacts', Icon: Users },
  { id: 'dashboard', label: 'Stats', Icon: LineChart },
  { id: 'bulk', label: 'Bulk', Icon: Send },
  { id: 'settings', label: 'Settings', Icon: Settings },
]

export function NavBar() {
  const activeScreen = useStore((s) => s.activeScreen)
  const setActiveScreen = useStore((s) => s.setActiveScreen)

  return (
    <nav
      style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        display: 'flex', background: 'var(--bg2)',
        borderTop: '1px solid var(--border2)',
        zIndex: 50, padding: '8px 0 22px',
      }}
    >
      {NAV_TABS.map(({ id, label, Icon }) => {
        const active = activeScreen === id
        return (
          <button
            key={id}
            onClick={() => setActiveScreen(id)}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: 2, padding: '4px 0', border: 'none', background: 'none',
              color: active ? 'var(--accent)' : 'var(--text3)',
              fontSize: 10, fontWeight: 600, cursor: 'pointer', transition: 'color 0.18s',
            }}
          >
            <Icon
              size={22}
              strokeWidth={active ? 2.25 : 1.85}
              aria-hidden
            />
            {label}
          </button>
        )
      })}
    </nav>
  )
}
