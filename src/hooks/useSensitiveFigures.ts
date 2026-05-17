import { useCallback, useState } from 'react'

const STORAGE_KEY = 'revenue_figures_visible_v1'

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/** Sensitive dollar amounts hidden by default; toggle with eye control. */
export function useSensitiveFigures() {
  const [visible, setVisible] = useState(readStored)

  const toggle = useCallback(() => {
    setVisible((prev) => {
      const next = !prev
      try {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  const mask = useCallback(
    (formatted: string) => (visible ? formatted : '••••••'),
    [visible],
  )

  return { visible, toggle, mask }
}
