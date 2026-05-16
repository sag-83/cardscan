import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import * as THREE from 'three'

/** Stock textures — business / conference vibes (Unsplash) */
const defaultCardImages = [
  'https://images.unsplash.com/photo-1542744173-8e7e53415bb0?w=800&q=80',
  'https://images.unsplash.com/photo-1552664730-d307ca884978?w=800&q=80',
  'https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=800&q=80',
  'https://images.unsplash.com/photo-1520607162513-77705c0f7d4a?w=800&q=80',
  'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=800&q=80',
]

const ASCII_CHARS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789(){}[]<>;:,._-+=!@#$%^&*|\\/\\"\'`~?'

const generateCode = (width: number, height: number): string => {
  let text = ''
  for (let i = 0; i < width * height; i++) {
    text += ASCII_CHARS[Math.floor(Math.random() * ASCII_CHARS.length)]
  }
  let out = ''
  for (let i = 0; i < height; i++) {
    out += text.substring(i * width, (i + 1) * width) + '\n'
  }
  return out
}

export type ScannerCardStreamProps = {
  className?: string
  showControls?: boolean
  showSpeed?: boolean
  initialSpeed?: number
  direction?: -1 | 1
  cardImages?: string[]
  repeat?: number
  cardGap?: number
  friction?: number
  scanEffect?: 'clip' | 'scramble'
}

export function ScannerCardStream({
  className = '',
  showControls = false,
  showSpeed = false,
  initialSpeed = 150,
  direction = -1,
  cardImages = defaultCardImages,
  repeat = 6,
  cardGap = 60,
  friction = 0.95,
  scanEffect = 'scramble',
}: ScannerCardStreamProps) {
  const [speed, setSpeed] = useState(initialSpeed)
  const [isPaused, setIsPaused] = useState(false)
  /** Violet scan line — updated only on edge to avoid React thrash */
  const [scannerBeamVisible, setScannerBeamVisible] = useState(false)
  const scannerBeamVisibleRef = useRef(false)

  const cards = useMemo(() => {
    const totalCards = cardImages.length * repeat
    return Array.from({ length: totalCards }, (_, i) => ({
      id: i,
      image: cardImages[i % cardImages.length],
      ascii: generateCode(Math.floor(400 / 6.5), Math.floor(250 / 13)),
    }))
  }, [cardImages, repeat])

  const cardLineRef = useRef<HTMLDivElement>(null)
  const particleCanvasRef = useRef<HTMLCanvasElement>(null)
  const scannerCanvasRef = useRef<HTMLCanvasElement>(null)
  const originalAscii = useRef(new Map<number, string>())

  const cardStreamState = useRef({
    position: 0,
    velocity: initialSpeed,
    direction,
    isDragging: false,
    lastMouseX: 0,
    lastTime: performance.now(),
    cardLineWidth: (400 + cardGap) * cards.length,
    friction,
    minVelocity: 30,
  })

  const scannerState = useRef({ isScanning: false })

  const isPausedRef = useRef(isPaused)
  useEffect(() => {
    isPausedRef.current = isPaused
  }, [isPaused])

  const toggleAnimation = useCallback(() => setIsPaused((p) => !p), [])
  const resetPosition = useCallback(() => {
    if (cardLineRef.current) {
      cardStreamState.current.position = cardLineRef.current.parentElement?.offsetWidth || 0
      cardStreamState.current.velocity = initialSpeed
      cardStreamState.current.direction = direction
      setIsPaused(false)
    }
  }, [initialSpeed, direction])
  const changeDirection = useCallback(() => {
    cardStreamState.current.direction *= -1
  }, [])

  useEffect(() => {
    cardStreamState.current.cardLineWidth = (400 + cardGap) * cards.length
    cardStreamState.current.friction = friction
  }, [cards.length, cardGap, friction])

  useEffect(() => {
    const cardLine = cardLineRef.current
    const particleCanvas = particleCanvasRef.current
    const scannerCanvas = scannerCanvasRef.current

    if (!cardLine || !particleCanvas || !scannerCanvas) return

    cards.forEach((card) => originalAscii.current.set(card.id, card.ascii))

    const w = window.innerWidth
    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-w / 2, w / 2, 125, -125, 1, 1000)
    camera.position.z = 100

    const renderer = new THREE.WebGLRenderer({ canvas: particleCanvas, alpha: true, antialias: true })
    renderer.setSize(w, 250)
    renderer.setClearColor(0x000000, 0)

    const particleCount = 400
    const geometry = new THREE.BufferGeometry()
    const positions = new Float32Array(particleCount * 3)
    const velocities = new Float32Array(particleCount)
    const alphas = new Float32Array(particleCount)

    const texCanvas = document.createElement('canvas')
    texCanvas.width = 100
    texCanvas.height = 100
    const texCtx = texCanvas.getContext('2d')!
    const half = 50
    const gradient = texCtx.createRadialGradient(half, half, 0, half, half, half)
    gradient.addColorStop(0.025, '#fff')
    gradient.addColorStop(0.1, 'hsl(217, 61%, 33%)')
    gradient.addColorStop(0.25, 'hsl(217, 64%, 6%)')
    gradient.addColorStop(1, 'transparent')
    texCtx.fillStyle = gradient
    texCtx.beginPath()
    texCtx.arc(half, half, half, 0, Math.PI * 2)
    texCtx.fill()
    const texture = new THREE.CanvasTexture(texCanvas)

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * w * 2
      positions[i * 3 + 1] = (Math.random() - 0.5) * 250
      velocities[i] = Math.random() * 60 + 30
      alphas[i] = (Math.random() * 8 + 2) / 10
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1))

    const material = new THREE.ShaderMaterial({
      uniforms: { pointTexture: { value: texture } },
      vertexShader: `attribute float alpha;
varying float vAlpha;
void main() {
  vAlpha = alpha;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = 15.0;
  gl_Position = projectionMatrix * mvPosition;
}`,
      fragmentShader: `uniform sampler2D pointTexture;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(1.0, 1.0, 1.0, vAlpha) * texture2D(pointTexture, gl_PointCoord);
}`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })

    const particles = new THREE.Points(geometry, material)
    scene.add(particles)

    const ctx = scannerCanvas.getContext('2d')!
    scannerCanvas.width = w
    scannerCanvas.height = 300

    type Particle = {
      x: number
      y: number
      vx: number
      vy: number
      radius: number
      alpha: number
      life: number
      decay: number
    }

    const baseMaxParticles = 800
    let currentMaxParticles = baseMaxParticles
    const scanTargetMaxParticles = 2500

    const createScannerParticle = (): Particle => ({
      x: w / 2 + (Math.random() - 0.5) * 3,
      y: Math.random() * 300,
      vx: Math.random() * 0.8 + 0.2,
      vy: (Math.random() - 0.5) * 0.3,
      radius: Math.random() * 0.6 + 0.4,
      alpha: Math.random() * 0.4 + 0.6,
      life: 1,
      decay: Math.random() * 0.02 + 0.005,
    })

    const scannerParticles: Particle[] = []
    for (let i = 0; i < baseMaxParticles; i++) scannerParticles.push(createScannerParticle())

    const runScrambleEffect = (element: HTMLElement, cardId: number) => {
      if (element.dataset.scrambling === 'true') return
      element.dataset.scrambling = 'true'
      const originalText = originalAscii.current.get(cardId) || ''
      let scrambleCount = 0
      const maxScrambles = 10
      const interval = window.setInterval(() => {
        element.textContent = generateCode(Math.floor(400 / 6.5), Math.floor(250 / 13))
        scrambleCount++
        if (scrambleCount >= maxScrambles) {
          clearInterval(interval)
          element.textContent = originalText
          delete element.dataset.scrambling
        }
      }, 30)
    }

    const setScannerBeam = (on: boolean) => {
      if (on === scannerBeamVisibleRef.current) return
      scannerBeamVisibleRef.current = on
      setScannerBeamVisible(on)
    }

    const updateCardEffects = () => {
      const scannerX = window.innerWidth / 2
      const scannerWidth = 8
      const scannerLeft = scannerX - scannerWidth / 2
      const scannerRight = scannerX + scannerWidth / 2
      let anyCardIsScanning = false

      cardLine.querySelectorAll<HTMLElement>('.card-wrapper').forEach((wrapper) => {
        const rect = wrapper.getBoundingClientRect()
        const normalCard = wrapper.querySelector<HTMLElement>('.card-normal')
        const asciiCard = wrapper.querySelector<HTMLElement>('.card-ascii')
        const asciiContent = asciiCard?.querySelector<HTMLElement>('pre')
        if (!normalCard || !asciiCard || !asciiContent) return

        if (rect.left < scannerRight && rect.right > scannerLeft) {
          anyCardIsScanning = true
          const cardId = Number(wrapper.dataset.cardId)
          if (
            scanEffect === 'scramble' &&
            wrapper.dataset.scanned !== 'true' &&
            Number.isFinite(cardId)
          ) {
            runScrambleEffect(asciiContent, cardId)
          }
          wrapper.dataset.scanned = 'true'
          const intersectLeft = Math.max(scannerLeft - rect.left, 0)
          const intersectRight = Math.min(scannerRight - rect.left, rect.width)
          normalCard.style.setProperty('--clip-right', `${(intersectLeft / rect.width) * 100}%`)
          asciiCard.style.setProperty('--clip-left', `${(intersectRight / rect.width) * 100}%`)
        } else {
          delete wrapper.dataset.scanned
          if (rect.right < scannerLeft) {
            normalCard.style.setProperty('--clip-right', '100%')
            asciiCard.style.setProperty('--clip-left', '100%')
          } else {
            normalCard.style.setProperty('--clip-right', '0%')
            asciiCard.style.setProperty('--clip-left', '0%')
          }
        }
      })

      setScannerBeam(anyCardIsScanning)
      scannerState.current.isScanning = anyCardIsScanning
    }

    const handleMouseDown = (e: MouseEvent | TouchEvent) => {
      cardStreamState.current.isDragging = true
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
      cardStreamState.current.lastMouseX = clientX
      cardStreamState.current.lastTime = performance.now()
    }

    const handleMouseMove = (e: MouseEvent | TouchEvent) => {
      if (!cardStreamState.current.isDragging) return
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
      const dx = clientX - cardStreamState.current.lastMouseX
      cardStreamState.current.lastMouseX = clientX
      const now = performance.now()
      const dt = (now - cardStreamState.current.lastTime) / 1000 || 0.016
      cardStreamState.current.lastTime = now
      cardStreamState.current.position += dx
      cardStreamState.current.velocity = dx / dt
    }

    const handleMouseUp = () => {
      cardStreamState.current.isDragging = false
    }

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      cardStreamState.current.velocity += e.deltaY * 0.25
    }

    cardLine.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    cardLine.addEventListener('touchstart', handleMouseDown, { passive: true })
    window.addEventListener('touchmove', handleMouseMove, { passive: true })
    window.addEventListener('touchend', handleMouseUp)
    cardLine.addEventListener('wheel', handleWheel, { passive: false })

    let raf = 0
    const animate = (currentTime: number) => {
      const innerW = window.innerWidth
      const deltaTime = (currentTime - cardStreamState.current.lastTime) / 1000
      cardStreamState.current.lastTime = currentTime

      if (!isPausedRef.current && !cardStreamState.current.isDragging) {
        if (cardStreamState.current.velocity > cardStreamState.current.minVelocity) {
          cardStreamState.current.velocity *= cardStreamState.current.friction
        }
        cardStreamState.current.position +=
          cardStreamState.current.velocity * cardStreamState.current.direction * deltaTime
        setSpeed(Math.round(cardStreamState.current.velocity))
      }

      const { position, cardLineWidth } = cardStreamState.current
      const containerWidth = cardLine.parentElement?.offsetWidth || 0
      if (position < -cardLineWidth) cardStreamState.current.position = containerWidth
      else if (position > containerWidth) cardStreamState.current.position = -cardLineWidth

      cardLine.style.transform = `translateX(${cardStreamState.current.position}px)`
      updateCardEffects()

      const time = currentTime * 0.001
      for (let i = 0; i < particleCount; i++) {
        positions[i * 3] += velocities[i] * 0.016
        if (positions[i * 3] > innerW / 2 + 100) positions[i * 3] = -innerW / 2 - 100
        positions[i * 3 + 1] += Math.sin(time + i * 0.1) * 0.5
        alphas[i] = Math.max(0.1, Math.min(1, alphas[i] + (Math.random() - 0.5) * 0.05))
      }
      geometry.attributes.position.needsUpdate = true
      geometry.attributes.alpha.needsUpdate = true
      renderer.render(scene, camera)

      ctx.clearRect(0, 0, innerW, 300)
      const targetCount = scannerState.current.isScanning ? scanTargetMaxParticles : baseMaxParticles
      currentMaxParticles += (targetCount - currentMaxParticles) * 0.05
      while (scannerParticles.length < currentMaxParticles) scannerParticles.push(createScannerParticle())
      while (scannerParticles.length > currentMaxParticles) scannerParticles.pop()

      scannerParticles.forEach((p) => {
        p.x += p.vx
        p.y += p.vy
        p.life -= p.decay
        if (p.life <= 0 || p.x > innerW) Object.assign(p, createScannerParticle())
        ctx.globalAlpha = p.alpha * p.life
        ctx.fillStyle = 'white'
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2)
        ctx.fill()
      })

      raf = requestAnimationFrame(animate)
    }

    raf = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(raf)
      cardLine.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      cardLine.removeEventListener('touchstart', handleMouseDown)
      cardLine.removeEventListener('wheel', handleWheel)
      window.removeEventListener('touchmove', handleMouseMove)
      window.removeEventListener('touchend', handleMouseUp)
      geometry.dispose()
      material.dispose()
      texture.dispose()
      renderer.dispose()
      originalAscii.current.clear()
    }
  }, [cards, cardGap, friction, scanEffect, initialSpeed, direction])

  return (
    <main
      className={`relative flex h-full min-h-0 w-full flex-1 items-center justify-center overflow-hidden bg-[#050508] ${className}`}
    >
      {(showControls || showSpeed) && (
        <div className="absolute left-4 top-4 z-30 flex flex-wrap gap-2 rounded-lg bg-black/60 p-3 text-xs text-white backdrop-blur-sm">
          {showSpeed && <span className="self-center px-2 font-mono">speed: {speed}</span>}
          {showControls && (
            <>
              <button
                type="button"
                className="rounded bg-white/10 px-2 py-1 hover:bg-white/20"
                onClick={toggleAnimation}
              >
                {isPaused ? 'Play' : 'Pause'}
              </button>
              <button type="button" className="rounded bg-white/10 px-2 py-1 hover:bg-white/20" onClick={resetPosition}>
                Reset
              </button>
              <button
                type="button"
                className="rounded bg-white/10 px-2 py-1 hover:bg-white/20"
                onClick={changeDirection}
              >
                Reverse
              </button>
            </>
          )}
        </div>
      )}

      <canvas
        ref={particleCanvasRef}
        className="pointer-events-none absolute left-0 top-1/2 z-0 h-[250px] w-screen -translate-y-1/2"
      />
      <canvas
        ref={scannerCanvasRef}
        className="pointer-events-none absolute left-0 top-1/2 z-10 h-[300px] w-screen -translate-y-1/2"
      />

      <div
        className={`scanner-line pointer-events-none absolute left-1/2 top-1/2 z-20 h-[280px] w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full
          bg-gradient-to-b from-transparent via-violet-500 to-transparent
          transition-opacity duration-300 animate-scanner-scan-pulse
          ${scannerBeamVisible ? 'opacity-100' : 'opacity-0'}`}
        style={{
          boxShadow: '0 0 10px #a78bfa, 0 0 20px #a78bfa, 0 0 30px #8b5cf6, 0 0 50px #6366f1',
        }}
      />

      <div className="absolute flex h-[250px] w-screen items-center">
        <div
          ref={cardLineRef}
          className="flex cursor-grab select-none items-center whitespace-nowrap will-change-transform active:cursor-grabbing"
          style={{ gap: `${cardGap}px` }}
        >
          {cards.map((card) => (
            <div
              key={card.id}
              data-card-id={card.id}
              className="card-wrapper relative h-[250px] w-[400px] shrink-0"
            >
              <div className="card-normal card absolute left-0 top-0 z-[2] h-full w-full overflow-hidden rounded-[15px] bg-transparent shadow-[0_15px_40px_rgba(0,0,0,0.4)] [clip-path:inset(0_0_0_var(--clip-right,0%))]">
                <img
                  src={card.image}
                  alt=""
                  className="h-full w-full rounded-[15px] object-cover brightness-110 contrast-110 shadow-[inset_0_0_20px_rgba(0,0,0,0.1)] transition-all duration-300 ease-in-out hover:brightness-125 hover:contrast-125"
                  draggable={false}
                />
              </div>
              <div className="card-ascii card absolute left-0 top-0 z-[1] h-full w-full overflow-hidden rounded-[15px] bg-transparent [clip-path:inset(0_calc(100%-var(--clip-left,0%))_0_0)]">
                <pre
                  className="ascii-content animate-scanner-glitch absolute left-0 top-0 m-0 box-border h-full w-full
                    overflow-hidden whitespace-pre p-0 text-left align-top font-mono text-[11px] leading-[13px]
                    text-[rgba(220,210,255,0.6)]
                    [mask-image:linear-gradient(to_right,rgba(0,0,0,1)_0%,rgba(0,0,0,0.8)_30%,rgba(0,0,0,0.6)_50%,rgba(0,0,0,0.4)_80%,rgba(0,0,0,0.2)_100%)]"
                >
                  {card.ascii}
                </pre>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
