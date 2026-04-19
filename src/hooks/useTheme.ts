import { useEffect } from 'react'
import { useStore } from '../store/useStore'

export function useTheme() {
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    const meta = document.getElementById('metaTheme')
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#000' : '#fff')
  }, [theme])

  const toggle = () => setTheme(theme === 'dark' ? 'light' : 'dark')

  return { theme, setTheme, toggle }
}
