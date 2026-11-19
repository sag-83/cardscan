import { useEffect, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { X, ZoomIn } from 'lucide-react'

type Props = {
  src: string
  alt?: string
  onClose: () => void
}

/** Full-size business-card photo viewer — centered overlay, Escape / backdrop / X to close. */
export function CardPhotoLightbox({ src, alt = 'Business card', onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const stop = (e: MouseEvent) => e.stopPropagation()

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 600,
        background: 'rgba(0,0,0,0.82)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'min(24px, 4vw)',
        animation: 'fadeIn 0.18s ease',
        cursor: 'zoom-out',
      }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        style={{
          position: 'fixed',
          top: 16,
          right: 16,
          zIndex: 1,
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
          backdropFilter: 'blur(8px)',
        }}
      >
        <X size={22} strokeWidth={2.25} />
      </button>

      <img
        src={src}
        alt={alt}
        onClick={stop}
        draggable={false}
        style={{
          maxWidth: 'min(960px, 94vw)',
          maxHeight: 'min(88vh, 920px)',
          width: 'auto',
          height: 'auto',
          objectFit: 'contain',
          borderRadius: 12,
          boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
          background: 'var(--bg3, #1a1a1a)',
          cursor: 'default',
          userSelect: 'none',
        }}
      />
    </div>,
    document.body,
  )
}

/** Hint chip for clickable card thumbs — keeps affordance clear on laptop. */
export function CardPhotoZoomHint() {
  return (
    <span
      style={{
        position: 'absolute',
        right: 8,
        bottom: 8,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 8px',
        borderRadius: 999,
        background: 'rgba(0,0,0,0.55)',
        color: '#fff',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.02,
        pointerEvents: 'none',
        backdropFilter: 'blur(6px)',
      }}
    >
      <ZoomIn size={12} strokeWidth={2.5} aria-hidden />
      Enlarge
    </span>
  )
}
