export type AppTheme = 'light' | 'dark'

const STORE_KEYS = ['cs_store_v2', 'cs_store_demo_v2'] as const

/** Keep `data-theme` (app CSS vars) and `.dark` (Tailwind / shadcn) in sync. */
export function applyDocumentTheme(theme: AppTheme): void {
  const root = document.documentElement
  root.setAttribute('data-theme', theme)
  root.classList.toggle('dark', theme === 'dark')
}

export function readPersistedTheme(): AppTheme {
  for (const key of STORE_KEYS) {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw) as { state?: { theme?: string } }
      if (parsed?.state?.theme === 'dark') return 'dark'
      if (parsed?.state?.theme === 'light') return 'light'
    } catch {
      // try next key
    }
  }
  return 'light'
}
