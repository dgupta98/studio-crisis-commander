import { useEffect, useRef } from 'react'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { tokens } from '../theme/tokens'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  color: string
  size: number
  alpha: number
  life: number
  maxLife: number
}

const FAMILY_COLORS: string[] = [
  tokens.signal.box_office.hex,
  tokens.signal.social.hex,
  tokens.signal.reviews.hex,
  tokens.signal.streaming.hex,
]

const FAMILY_GLOWS: string[] = [
  tokens.signal.box_office.glow,
  tokens.signal.social.glow,
  tokens.signal.reviews.glow,
  tokens.signal.streaming.glow,
]

export function ParticleCascade() {
  const reduced = useReducedMotion()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (reduced) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    let running = true
    const dpr = window.devicePixelRatio || 1
    const resize = () => {
      canvas.width = canvas.offsetWidth * dpr
      canvas.height = canvas.offsetHeight * dpr
    }
    resize()
    window.addEventListener('resize', resize)

    const particles: Particle[] = []

    const spawn = () => {
      const idx = Math.floor(Math.random() * FAMILY_COLORS.length)
      const maxLife = 240 + Math.random() * 180
      particles.push({
        x: Math.random() * canvas.width,
        y: -10,
        vx: (Math.random() - 0.5) * 0.6 * dpr,
        vy: (0.6 + Math.random() * 1.6) * dpr,
        color: FAMILY_COLORS[idx],
        size: (1 + Math.random() * 2.5) * dpr,
        alpha: 0.5 + Math.random() * 0.4,
        life: 0,
        maxLife,
      })
      // occasional bright bokeh particle
      if (Math.random() < 0.08) {
        particles.push({
          x: Math.random() * canvas.width,
          y: -10,
          vx: (Math.random() - 0.5) * 0.3 * dpr,
          vy: (0.2 + Math.random() * 0.6) * dpr,
          color: FAMILY_COLORS[idx],
          size: (4 + Math.random() * 6) * dpr,
          alpha: 0.15 + Math.random() * 0.2,
          life: 0,
          maxLife: maxLife * 1.5,
        })
      }
    }

    let lastSpawn = 0
    const frame = (t: number) => {
      if (!running) return
      // trail effect: dim previous frame slightly instead of clearing
      ctx.fillStyle = 'rgba(8, 8, 12, 0.18)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      if (t - lastSpawn > 22) {
        for (let i = 0; i < 6; i++) spawn()
        lastSpawn = t
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.x += p.vx
        p.y += p.vy
        p.life += 1
        const lifeAlpha = p.life < 30 ? p.life / 30 : p.life > p.maxLife - 60 ? Math.max(0, (p.maxLife - p.life) / 60) : 1
        const alpha = p.alpha * lifeAlpha

        // outer glow
        const glowIdx = FAMILY_COLORS.indexOf(p.color)
        if (glowIdx >= 0 && p.size > 3) {
          ctx.globalAlpha = alpha * 0.35
          ctx.fillStyle = FAMILY_GLOWS[glowIdx]
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2)
          ctx.fill()
        }

        // core dot
        ctx.globalAlpha = alpha
        ctx.fillStyle = p.color
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fill()

        if (p.y > canvas.height + 20 || p.life > p.maxLife) {
          particles.splice(i, 1)
        }
      }
      // Cap population; drop the oldest first.
      if (particles.length > 600) particles.splice(0, particles.length - 600)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      running = false
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [reduced])

  if (reduced) {
    return (
      <div
        data-fallback="reduced-motion"
        className="absolute inset-0 -z-10"
        style={{
          background: `radial-gradient(ellipse at 20% 20%, ${tokens.signal.box_office.hex}18 0%, transparent 60%),
                       radial-gradient(ellipse at 80% 30%, ${tokens.signal.social.hex}18 0%, transparent 60%),
                       radial-gradient(ellipse at 30% 80%, ${tokens.signal.reviews.hex}18 0%, transparent 60%),
                       radial-gradient(ellipse at 80% 80%, ${tokens.signal.streaming.hex}18 0%, transparent 60%),
                       linear-gradient(180deg, #0a0a12 0%, #08080c 100%)`,
        }}
      />
    )
  }

  return (
    <>
      <canvas ref={canvasRef} className="absolute inset-0 -z-10 h-full w-full" aria-hidden />
      {/* Vignette overlay — pulls attention to center. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 20%, rgba(8,8,12,0.65) 75%, rgba(8,8,12,0.95) 100%)',
        }}
      />
    </>
  )
}
