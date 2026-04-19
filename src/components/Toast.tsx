import { useStore } from '../store/useStore'

export function Toast() {
  const toastMessage = useStore((s) => s.toastMessage)
  const toastVisible = useStore((s) => s.toastVisible)

  return (
    <div
      style={{
        position: 'fixed',
        top: 64,
        left: '50%',
        transform: `translateX(-50%) translateY(${toastVisible ? 0 : -8}px)`,
        background: 'rgba(30,30,40,0.95)',
        color: '#fff',
        padding: '10px 20px',
        borderRadius: 10,
        fontSize: 14,
        fontWeight: 600,
        zIndex: 500,
        opacity: toastVisible ? 1 : 0,
        pointerEvents: 'none',
        transition: '0.25s',
        maxWidth: '90%',
        textAlign: 'center',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {toastMessage}
    </div>
  )
}
