import { useEffect } from 'react'
import { applyDocumentTheme } from '../lib/theme'
import { useStore } from '../store/useStore'

export function useTheme() {
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)

  useEffect(() => {
    applyDocumentTheme(theme)
    const meta = document.getElementById('metaTheme')
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#000' : '#fff')
  }, [theme])

  const toggle = () => setTheme(theme === 'dark' ? 'light' : 'dark')

  return { theme, setTheme, toggle }
}
