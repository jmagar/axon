import { COLORS, rgba } from './color-utils'
import type { AxonSegment, Bouton } from './types'

// ---------------------------------------------------------------------------
// Axon — myelin sheaths with Nodes of Ranvier
// ---------------------------------------------------------------------------

export class Axon {
  startX: number
  startY: number
  segments: AxonSegment[]
  terminalX: number
  terminalY: number
  boutons: Bouton[]

  constructor(x: number, y: number) {
    this.startX = x
    this.startY = y

    const baseAngle = Math.random() * Math.PI * 2
    const length = 80 + Math.random() * 120

    this.segments = []
    let currentX = x
    let currentY = y
    let currentAngle = baseAngle

    const segmentCount = 4 + Math.floor(Math.random() * 3)
    const segmentLength = length / segmentCount

    for (let i = 0; i < segmentCount; i++) {
      currentAngle += (Math.random() - 0.5) * 0.35
      const nextX = currentX + Math.cos(currentAngle) * segmentLength
      const nextY = currentY + Math.sin(currentAngle) * segmentLength

      this.segments.push({
        startX: currentX,
        startY: currentY,
        endX: nextX,
        endY: nextY,
        isMyelin: i > 0 && i < segmentCount - 1,
      })

      currentX = nextX
      currentY = nextY
    }

    this.terminalX = currentX
    this.terminalY = currentY

    this.boutons = []
    const boutonCount = 2 + Math.floor(Math.random() * 3)
    for (let i = 0; i < boutonCount; i++) {
      const bAngle = currentAngle + ((Math.random() - 0.5) * Math.PI) / 2
      const bLength = 8 + Math.random() * 15
      this.boutons.push({
        x: currentX + Math.cos(bAngle) * bLength,
        y: currentY + Math.sin(bAngle) * bLength,
        radius: 2.5 + Math.random() * 2,
      })
    }
  }

  draw(ctx: CanvasRenderingContext2D, opacity: number, depthScale = 1) {
    // Glow pass
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    this.segments.forEach((segment) => {
      ctx.beginPath()
      ctx.moveTo(segment.startX, segment.startY)
      ctx.lineTo(segment.endX, segment.endY)
      ctx.strokeStyle = rgba(COLORS.mid, opacity * 0.06)
      ctx.lineWidth = (segment.isMyelin ? 12 : 8) * depthScale
      ctx.stroke()
    })
    ctx.restore()

    this.segments.forEach((segment) => {
      if (segment.isMyelin) {
        // Myelin sheath
        ctx.beginPath()
        ctx.moveTo(segment.startX, segment.startY)
        ctx.lineTo(segment.endX, segment.endY)
        ctx.strokeStyle = rgba(COLORS.dim, opacity * 0.35)
        ctx.lineWidth = 4.5 * depthScale
        ctx.stroke()

        // Inner fiber
        ctx.beginPath()
        ctx.moveTo(segment.startX, segment.startY)
        ctx.lineTo(segment.endX, segment.endY)
        ctx.strokeStyle = rgba(COLORS.bright, opacity * 0.45)
        ctx.lineWidth = 1.5 * depthScale
        ctx.stroke()

        // Node of Ranvier
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        const nrg = ctx.createRadialGradient(
          segment.endX,
          segment.endY,
          0,
          segment.endX,
          segment.endY,
          8 * depthScale,
        )
        nrg.addColorStop(0, rgba(COLORS.bright, opacity * 0.3))
        nrg.addColorStop(1, rgba(COLORS.bright, 0))
        ctx.beginPath()
        ctx.arc(segment.endX, segment.endY, 8 * depthScale, 0, Math.PI * 2)
        ctx.fillStyle = nrg
        ctx.fill()
        ctx.restore()

        ctx.beginPath()
        ctx.arc(segment.endX, segment.endY, 3 * depthScale, 0, Math.PI * 2)
        ctx.strokeStyle = rgba(COLORS.core, opacity * 0.5)
        ctx.lineWidth = 1
        ctx.stroke()
      } else {
        ctx.beginPath()
        ctx.moveTo(segment.startX, segment.startY)
        ctx.lineTo(segment.endX, segment.endY)
        ctx.strokeStyle = rgba(COLORS.bright, opacity * 0.5)
        ctx.lineWidth = 2 * depthScale
        ctx.stroke()
      }
    })

    // Boutons with glow
    this.boutons.forEach((bouton) => {
      const r = bouton.radius * depthScale
      ctx.beginPath()
      ctx.moveTo(this.terminalX, this.terminalY)
      ctx.lineTo(bouton.x, bouton.y)
      ctx.strokeStyle = rgba(COLORS.bright, opacity * 0.35)
      ctx.lineWidth = 1 * depthScale
      ctx.stroke()

      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      const bg = ctx.createRadialGradient(bouton.x, bouton.y, 0, bouton.x, bouton.y, r * 5)
      bg.addColorStop(0, rgba(COLORS.bright, opacity * 0.2))
      bg.addColorStop(0.4, rgba(COLORS.mid, opacity * 0.08))
      bg.addColorStop(1, rgba(COLORS.dim, 0))
      ctx.beginPath()
      ctx.arc(bouton.x, bouton.y, r * 5, 0, Math.PI * 2)
      ctx.fillStyle = bg
      ctx.fill()
      ctx.restore()

      ctx.beginPath()
      ctx.arc(bouton.x, bouton.y, r, 0, Math.PI * 2)
      ctx.fillStyle = rgba(COLORS.core, opacity * 0.6)
      ctx.fill()
    })
  }

  updatePosition(newStartX: number, newStartY: number) {
    const dx = newStartX - this.startX
    const dy = newStartY - this.startY
    this.startX = newStartX
    this.startY = newStartY
    this.segments.forEach((s) => {
      s.startX += dx
      s.startY += dy
      s.endX += dx
      s.endY += dy
    })
    this.terminalX += dx
    this.terminalY += dy
    this.boutons.forEach((b) => {
      b.x += dx
      b.y += dy
    })
  }

  getTerminal(): { x: number; y: number } {
    return { x: this.terminalX, y: this.terminalY }
  }
}
