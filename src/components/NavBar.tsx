import { useStore } from '../store/useStore'
import { Screen } from '../types/contact'

interface Tab {
  id: Screen
  label: string
  iconPath: string
}

const TABS: Tab[] = [
  {
    id: 'scan',
    label: 'Scan',
    iconPath:
      'M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z M12 17a4 4 0 100-8 4 4 0 000 8z',
  },
  {
    id: 'contacts',
    label: 'Contacts',
    iconPath:
      'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2 M9 11a4 4 0 100-8 4 4 0 000 8z M23 21v-2a4 4 0 00-3-3.87 M16 3.13a4 4 0 010 7.75',
  },
  {
    id: 'dashboard',
    label: 'Stats',
    iconPath:
      'M3 3v18h18 M7 15l3-3 2 2 5-5',
  },
  {
    id: 'bulk',
    label: 'Bulk',
    iconPath: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z',
  },
  {
    id: 'settings',
    label: 'Settings',
    iconPath:
      'M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z',
  },
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
      {TABS.map((tab) => {
        const active = activeScreen === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => setActiveScreen(tab.id)}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: 2, padding: '4px 0', border: 'none', background: 'none',
              color: active ? 'var(--accent)' : 'var(--text3)',
              fontSize: 10, fontWeight: 600, cursor: 'pointer', transition: 'color 0.18s',
            }}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {tab.iconPath.split('M').filter(Boolean).map((d, i) => (
                <path key={i} d={'M' + d} />
              ))}
            </svg>
            {tab.label}
          </button>
        )
      })}
    </nav>
  )
}
