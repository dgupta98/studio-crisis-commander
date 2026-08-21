import { useEffect, useRef } from 'react'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { tokens } from '../theme/tokens'

interface Particle {
  x: number
  y: number
  vy: number
  color: string
  size: number
  alpha: number
}

const FAMILY_COLORS = [
  tokens.signal.box_office.hex,
  tokens.signal.social.hex,
  tokens.signal.reviews.hex,
  tokens.signal.streaming.hex,
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
    const resize = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio
      canvas.height = canvas.offsetHeight * window.devicePixelRatio
    }
    resize()
    window.addEventListener('resize', resize)

    const particles: Particle[] = []
    const spawn = () => {
      const color = FAMILY_COLORS[Math.floor(Math.random() * FAMILY_COLORS.length)]
      particles.push({
        x: Math.random() * canvas.width,
        y: -10,
        vy: (1 + Math.random() * 2) * window.devicePixelRatio,
        color,
        size: (1 + Math.random() * 2) * window.devicePixelRatio,
        alpha: 0.4 + Math.random() * 0.5,
      })
    }

    let lastSpawn = 0
    const frame = (t: number) => {
      if (!running) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      if (t - lastSpawn > 30) {
        for (let i = 0; i < 3; i++) spawn()
        lastSpawn = t
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.y += p.vy
        ctx.globalAlpha = p.alpha
        ctx.fillStyle = p.color
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fill()
        if (p.y > canvas.height + 10) particles.splice(i, 1)
      }
      if (particles.length > 400) particles.splice(0, particles.length - 400)
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
          background: `linear-gradient(180deg, ${tokens.signal.box_office.hex}22 0%, ${tokens.signal.social.hex}22 40%, ${tokens.signal.reviews.hex}22 70%, ${tokens.signal.streaming.hex}22 100%)`,
        }}
      />
    )
  }

  return <canvas ref={canvasRef} className="absolute inset-0 -z-10 h-full w-full" aria-hidden />
}
