import { useRef, useId, useEffect, type CSSProperties, type ReactNode } from 'react'
import { animate } from 'framer-motion'

export interface AmbientShadowOverlayProps {
  color?: string
  animation?: { scale: number; speed: number }
  noise?: { opacity: number; scale: number }
  style?: CSSProperties
  className?: string
  children?: ReactNode
}

function mapRange(value: number, fromLow: number, fromHigh: number, toLow: number, toHigh: number): number {
  if (fromLow === fromHigh) return toLow
  const percentage = (value - fromLow) / (fromHigh - fromLow)
  return toLow + percentage * (toHigh - toLow)
}

function useOverlayFilterId(): string {
  const rid = useId().replace(/:/g, '')
  return `ambient-shadow-${rid}`
}

/**
 * Soft animated “liquid” backdrop (Framer turbulence-style motion).
 * Omit children for a pure background layer.
 */
export function AmbientShadowOverlay({
  color = 'rgba(0, 122, 255, 0.14)',
  animation = { scale: 45, speed: 55 },
  noise = { opacity: 0.28, scale: 1 },
  style,
  className,
  children,
}: AmbientShadowOverlayProps) {
  const id = useOverlayFilterId()
  const animationEnabled = animation.scale > 0
  const displacementScale = animationEnabled ? mapRange(animation.scale, 1, 100, 18, 72) : 0
  /** Duration factor: higher speed → faster motion */
  const durationSec = animationEnabled ? mapRange(animation.speed, 1, 100, 10, 3) : 1

  const turbRef = useRef<SVGFETurbulenceElement>(null)

  useEffect(() => {
    const el = turbRef.current
    if (!el || !animationEnabled) return

    const controls = animate(0.01, 0.022, {
      duration: durationSec,
      repeat: Infinity,
      repeatType: 'reverse',
      ease: 'easeInOut',
      onUpdate: (latest) => {
        el.setAttribute('baseFrequency', `${latest} ${latest * 0.42}`)
      },
    })

    return () => controls.stop()
  }, [animationEnabled, durationSec])

  return (
    <div
      className={className}
      style={{
        overflow: 'hidden',
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: '100%',
        ...style,
      }}
    >
      {animationEnabled && (
        <svg className="pointer-events-none absolute h-0 w-0" aria-hidden>
          <defs>
            <filter id={id} x="-35%" y="-35%" width="170%" height="170%">
              <feTurbulence
                ref={turbRef}
                type="fractalNoise"
                baseFrequency="0.012 0.005"
                numOctaves="2"
                seed="2"
                result="noise"
              />
              <feDisplacementMap in="SourceGraphic" in2="noise" scale={displacementScale} />
            </filter>
          </defs>
        </svg>
      )}

      <div
        className="pointer-events-none absolute inset-0"
        style={{
          filter: animationEnabled ? `url(#${id}) blur(5px)` : 'none',
          transform: animationEnabled ? `scale(${1 + displacementScale * 0.001})` : undefined,
          transformOrigin: '50% 40%',
        }}
      >
        <div
          className="h-full w-full"
          style={{
            background: `radial-gradient(ellipse 120% 80% at 50% 35%, ${color}, transparent 72%)`,
          }}
        />
      </div>

      {children && (
        <div className="relative z-10 flex h-full w-full flex-col items-center justify-center p-4">{children}</div>
      )}

      {noise && noise.opacity > 0 && (
        <div
          className="pointer-events-none absolute inset-0 mix-blend-soft-light"
          style={{
            backgroundImage: `url("https://framerusercontent.com/images/g0QcWrxr87K0ufOxIUFBakwYA8.png")`,
            backgroundSize: `${noise.scale * 200}px`,
            backgroundRepeat: 'repeat',
            opacity: noise.opacity * 0.5,
          }}
        />
      )}
    </div>
  )
}
