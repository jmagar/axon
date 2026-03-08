'use client'

import { useEffect, useRef } from 'react'

interface Star {
  x: number
  y: number
  radius: number
  baseRadius: number
  brightness: number
  twinkleSpeed: number
  twinklePhase: number
  color: 'cyan' | 'blue' | 'white' | 'pink'
}

interface Connection {
  from: number
  to: number
}

export function NeuralBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationId: number
    let stars: Star[] = []
    let connections: Connection[] = []
    let time = 0

    // Color palette matching your screenshot
    const colors = {
      cyan: { r: 100, g: 210, b: 255 },      // Bright cyan stars
      blue: { r: 80, g: 150, b: 255 },       // Blue stars
      white: { r: 200, g: 220, b: 255 },     // White-ish stars
      pink: { r: 255, g: 130, b: 200 },      // Pink accent stars
    }

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
      canvas.style.width = `${window.innerWidth}px`
      canvas.style.height = `${window.innerHeight}px`
      ctx.scale(dpr, dpr)
      initStars()
    }

    const initStars = () => {
      const width = window.innerWidth
      const height = window.innerHeight
      // More stars for denser starfield
      const starCount = Math.floor((width * height) / 8000)
      stars = []
      connections = []

      for (let i = 0; i < starCount; i++) {
        const colorRoll = Math.random()
        let color: Star['color']
        if (colorRoll < 0.45) color = 'cyan'
        else if (colorRoll < 0.75) color = 'blue'
        else if (colorRoll < 0.92) color = 'white'
        else color = 'pink'

        const baseRadius = Math.random() * 1.8 + 0.3
        stars.push({
          x: Math.random() * width,
          y: Math.random() * height,
          radius: baseRadius,
          baseRadius,
          brightness: Math.random() * 0.5 + 0.5,
          twinkleSpeed: Math.random() * 0.02 + 0.005,
          twinklePhase: Math.random() * Math.PI * 2,
          color,
        })
      }

      // Create constellation connections (less dense than before)
      for (let i = 0; i < stars.length; i++) {
        for (let j = i + 1; j < stars.length; j++) {
          const dx = stars[i].x - stars[j].x
          const dy = stars[i].y - stars[j].y
          const distance = Math.sqrt(dx * dx + dy * dy)
          // Only connect nearby bright stars
          if (distance < 120 && stars[i].baseRadius > 0.8 && stars[j].baseRadius > 0.8 && Math.random() > 0.7) {
            connections.push({ from: i, to: j })
          }
        }
      }
    }

    const drawStar = (star: Star, twinkleFactor: number) => {
      const { x, y, baseRadius, color } = star
      const colorVal = colors[color]
      const currentBrightness = star.brightness * twinkleFactor
      const currentRadius = baseRadius * (0.8 + twinkleFactor * 0.4)

      // Outer glow
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, currentRadius * 8)
      gradient.addColorStop(0, `rgba(${colorVal.r}, ${colorVal.g}, ${colorVal.b}, ${currentBrightness * 0.4})`)
      gradient.addColorStop(0.3, `rgba(${colorVal.r}, ${colorVal.g}, ${colorVal.b}, ${currentBrightness * 0.15})`)
      gradient.addColorStop(1, 'transparent')
      ctx.fillStyle = gradient
      ctx.beginPath()
      ctx.arc(x, y, currentRadius * 8, 0, Math.PI * 2)
      ctx.fill()

      // Inner bright core
      const coreGradient = ctx.createRadialGradient(x, y, 0, x, y, currentRadius * 2)
      coreGradient.addColorStop(0, `rgba(255, 255, 255, ${currentBrightness * 0.9})`)
      coreGradient.addColorStop(0.5, `rgba(${colorVal.r}, ${colorVal.g}, ${colorVal.b}, ${currentBrightness * 0.7})`)
      coreGradient.addColorStop(1, 'transparent')
      ctx.fillStyle = coreGradient
      ctx.beginPath()
      ctx.arc(x, y, currentRadius * 2, 0, Math.PI * 2)
      ctx.fill()

      // Crisp center point for bright stars
      if (baseRadius > 1) {
        ctx.fillStyle = `rgba(255, 255, 255, ${currentBrightness})`
        ctx.beginPath()
        ctx.arc(x, y, currentRadius * 0.5, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    const animate = () => {
      time += 0.016 // ~60fps
      const width = window.innerWidth
      const height = window.innerHeight

      // Clear with deep navy background
      ctx.fillStyle = 'rgb(12, 18, 35)'
      ctx.fillRect(0, 0, width, height)

      // Add subtle gradient overlay for depth
      const bgGradient = ctx.createRadialGradient(
        width * 0.3, height * 0.3, 0,
        width * 0.5, height * 0.5, width * 0.8
      )
      bgGradient.addColorStop(0, 'rgba(60, 100, 180, 0.08)')
      bgGradient.addColorStop(0.5, 'rgba(40, 60, 120, 0.05)')
      bgGradient.addColorStop(1, 'transparent')
      ctx.fillStyle = bgGradient
      ctx.fillRect(0, 0, width, height)

      // Second gradient for pink accent in corner
      const pinkGradient = ctx.createRadialGradient(
        width * 0.85, height * 0.75, 0,
        width * 0.85, height * 0.75, width * 0.5
      )
      pinkGradient.addColorStop(0, 'rgba(180, 80, 160, 0.04)')
      pinkGradient.addColorStop(1, 'transparent')
      ctx.fillStyle = pinkGradient
      ctx.fillRect(0, 0, width, height)

      // Draw constellation connections first (behind stars)
      ctx.lineWidth = 0.5
      connections.forEach(({ from, to }) => {
        const starA = stars[from]
        const starB = stars[to]
        const avgBrightness = (starA.brightness + starB.brightness) / 2
        const twinkleA = (Math.sin(time * starA.twinkleSpeed * 60 + starA.twinklePhase) + 1) / 2
        const twinkleB = (Math.sin(time * starB.twinkleSpeed * 60 + starB.twinklePhase) + 1) / 2
        const connectionAlpha = avgBrightness * ((twinkleA + twinkleB) / 2) * 0.15

        const gradient = ctx.createLinearGradient(starA.x, starA.y, starB.x, starB.y)
        const colorA = colors[starA.color]
        const colorB = colors[starB.color]
        gradient.addColorStop(0, `rgba(${colorA.r}, ${colorA.g}, ${colorA.b}, ${connectionAlpha})`)
        gradient.addColorStop(1, `rgba(${colorB.r}, ${colorB.g}, ${colorB.b}, ${connectionAlpha})`)

        ctx.strokeStyle = gradient
        ctx.beginPath()
        ctx.moveTo(starA.x, starA.y)
        ctx.lineTo(starB.x, starB.y)
        ctx.stroke()
      })

      // Draw all stars with twinkle effect
      stars.forEach((star) => {
        const twinkle = (Math.sin(time * star.twinkleSpeed * 60 + star.twinklePhase) + 1) / 2
        const twinkleFactor = 0.6 + twinkle * 0.4
        drawStar(star, twinkleFactor)
      })

      animationId = requestAnimationFrame(animate)
    }

    resize()
    window.addEventListener('resize', resize)
    animate()

    return () => {
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(animationId)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 0 }}
    />
  )
}
