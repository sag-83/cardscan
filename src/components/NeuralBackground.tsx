import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

const LOGIN_BG = { r: 8, g: 8, b: 12 }

export type NeuralBackgroundProps = {
  className?: string
  /** Particle color. Default indigo-violet for login. */
  color?: string
  /** Trail fade strength (0–1). Lower = longer trails. */
  trailOpacity?: number
  particleCount?: number
  speed?: number
  /** RGB base used for trail fade (matches page background). */
  fadeRgb?: { r: number; g: number; b: number }
}

export function NeuralBackground({
  className,
  color = '#818cf8',
  trailOpacity = 0.12,
  particleCount,
  speed = 1,
  fadeRgb = LOGIN_BG,
}: NeuralBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const isNarrow = window.matchMedia('(max-width: 640px)').matches
    const count =
      particleCount ?? (reducedMotion ? 0 : isNarrow ? 380 : 600)

    if (reducedMotion || count === 0) {
      ctx.fillStyle = `rgb(${fadeRgb.r}, ${fadeRgb.g}, ${fadeRgb.b})`
      const resize = () => {
        const dpr = window.devicePixelRatio || 1
        const w = container.clientWidth
        const h = container.clientHeight
        canvas.width = w * dpr
        canvas.height = h * dpr
        canvas.style.width = `${w}px`
        canvas.style.height = `${h}px`
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.scale(dpr, dpr)
        ctx.fillRect(0, 0, w, h)
      }
      resize()
      window.addEventListener('resize', resize)
      return () => window.removeEventListener('resize', resize)
    }

    let width = container.clientWidth
    let height = container.clientHeight
    let particles: Particle[] = []
    let animationFrameId = 0
    let mouse = { x: -1000, y: -1000 }

    class Particle {
      x: number
      y: number
      vx: number
      vy: number
      age: number
      life: number

      constructor() {
        this.x = Math.random() * width
        this.y = Math.random() * height
        this.vx = 0
        this.vy = 0
        this.age = 0
        this.life = Math.random() * 200 + 100
      }

      update() {
        const angle = (Math.cos(this.x * 0.005) + Math.sin(this.y * 0.005)) * Math.PI
        this.vx += Math.cos(angle) * 0.2 * speed
        this.vy += Math.sin(angle) * 0.2 * speed

        const dx = mouse.x - this.x
        const dy = mouse.y - this.y
        const distance = Math.sqrt(dx * dx + dy * dy)
        const interactionRadius = 150

        if (distance < interactionRadius) {
          const force = (interactionRadius - distance) / interactionRadius
          this.vx -= dx * force * 0.05
          this.vy -= dy * force * 0.05
        }

        this.x += this.vx
        this.y += this.vy
        this.vx *= 0.95
        this.vy *= 0.95

        this.age++
        if (this.age > this.life) this.reset()

        if (this.x < 0) this.x = width
        if (this.x > width) this.x = 0
        if (this.y < 0) this.y = height
        if (this.y > height) this.y = 0
      }

      reset() {
        this.x = Math.random() * width
        this.y = Math.random() * height
        this.vx = 0
        this.vy = 0
        this.age = 0
        this.life = Math.random() * 200 + 100
      }

      draw(context: CanvasRenderingContext2D) {
        context.fillStyle = color
        const alpha = 1 - Math.abs(this.age / this.life - 0.5) * 2
        context.globalAlpha = alpha
        context.fillRect(this.x, this.y, 1.5, 1.5)
      }
    }

    const init = () => {
      const dpr = window.devicePixelRatio || 1
      width = container.clientWidth
      height = container.clientHeight
      canvas.width = width * dpr
      canvas.height = height * dpr
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.scale(dpr, dpr)

      particles = []
      for (let i = 0; i < count; i++) particles.push(new Particle())
    }

    const fadeFill = `rgba(${fadeRgb.r}, ${fadeRgb.g}, ${fadeRgb.b}, ${trailOpacity})`

    const animate = () => {
      ctx.globalAlpha = 1
      ctx.fillStyle = fadeFill
      ctx.fillRect(0, 0, width, height)

      particles.forEach((p) => {
        p.update()
        p.draw(ctx)
      })

      animationFrameId = requestAnimationFrame(animate)
    }

    const setPointer = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect()
      mouse.x = clientX - rect.left
      mouse.y = clientY - rect.top
    }

    const handleResize = () => init()

    const handleMouseMove = (e: MouseEvent) => setPointer(e.clientX, e.clientY)
    const handleMouseLeave = () => {
      mouse.x = -1000
      mouse.y = -1000
    }
    const handleTouch = (e: TouchEvent) => {
      if (e.touches[0]) setPointer(e.touches[0].clientX, e.touches[0].clientY)
    }
    const handleTouchEnd = () => {
      mouse.x = -1000
      mouse.y = -1000
    }

    init()
    animate()

    window.addEventListener('resize', handleResize)
    container.addEventListener('mousemove', handleMouseMove)
    container.addEventListener('mouseleave', handleMouseLeave)
    container.addEventListener('touchmove', handleTouch, { passive: true })
    container.addEventListener('touchend', handleTouchEnd)

    return () => {
      window.removeEventListener('resize', handleResize)
      container.removeEventListener('mousemove', handleMouseMove)
      container.removeEventListener('mouseleave', handleMouseLeave)
      container.removeEventListener('touchmove', handleTouch)
      container.removeEventListener('touchend', handleTouchEnd)
      cancelAnimationFrame(animationFrameId)
    }
  }, [color, trailOpacity, particleCount, speed, fadeRgb.r, fadeRgb.g, fadeRgb.b])

  return (
    <div
      ref={containerRef}
      className={cn('relative h-full w-full overflow-hidden bg-[#08080c]', className)}
      aria-hidden
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  )
}
