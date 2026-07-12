import { useEffect, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { useIsDesktop } from '../hooks/useIsDesktop'

const SHOW_AFTER_PX = 400

// Desktop-only: on mobile, tapping the status bar already scrolls to top
// natively, so a floating button there is redundant. On desktop there's no
// such gesture, so this sits in the free space to the right of the content
// column (next to the sidebar's mirror image) instead of floating over content.
export function ScrollToTopButton() {
  const isDesktop = useIsDesktop()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!isDesktop) return
    const onScroll = () => setVisible(window.scrollY > SHOW_AFTER_PX)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [isDesktop])

  if (!isDesktop || !visible) return null

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="Scroll to top"
      title="Scroll to top"
      style={{
        position: 'fixed', right: 32, bottom: 32, zIndex: 60,
        width: 46, height: 46, borderRadius: '50%', border: 'none',
        background: 'var(--accent)', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
        animation: 'fadeIn 0.18s ease',
      }}
    >
      <ArrowUp size={20} strokeWidth={2.5} />
    </button>
  )
}
