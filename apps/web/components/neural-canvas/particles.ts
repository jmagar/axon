import { COLORS, drawSprite, rgba } from './color-utils'
import { SimplexDrift } from './simplex-drift'
import type { RenderAssets } from './types'

// ---------------------------------------------------------------------------
// BackgroundParticle — bokeh field
// ---------------------------------------------------------------------------

export class BackgroundParticle {
  x: number
  y: number
  z: number
  baseSize: number
  brightness: number
  drift: SimplexDrift
  pulseOffset: number
  pulseSpeed: number

  constructor(width: number, height: number) {
    this.x = Math.random() * width
    this.y = Math.random() * height
    this.z = Math.random()
    this.baseSize = 0.4 + Math.random() * 1.8
    this.brightness = 0.08 + this.z * 0.4 + Math.random() * 0.15
    this.drift = new SimplexDrift()
    this.pulseOffset = Math.random() * Math.PI * 2
    this.pulseSpeed = 0.0008 + Math.random() * 0.0015
  }

  update(time: number, width: number, height: number, driftScale = 1) {
    const d = this.drift.get(time)
    this.x += d.x * 0.2 * driftScale
    this.y += d.y * 0.2 * driftScale
    if (this.x < -20) this.x = width + 20
    if (this.x > width + 20) this.x = -20
    if (this.y < -20) this.y = height + 20
    if (this.y > height + 20) this.y = -20
  }

  draw(
    ctx: CanvasRenderingContext2D,
    time: number,
    assets: RenderAssets,
    withGlow = true,
    snap = false,
  ) {
    const pulse = Math.sin(time * this.pulseSpeed + this.pulseOffset) * 0.2 + 0.8
    const alpha = this.brightness * pulse
    const sz = this.baseSize * (0.5 + this.z * 0.5) * pulse
    const x = snap ? Math.round(this.x) : this.x
    const y = snap ? Math.round(this.y) : this.y

    if (withGlow && this.brightness > 0.2) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      drawSprite(ctx, assets.particleGlow, x, y, sz * 6, alpha * 0.9)
      ctx.restore()
    }

    ctx.beginPath()
    ctx.arc(x, y, sz, 0, Math.PI * 2)
    ctx.fillStyle = rgba(COLORS.core, alpha * 0.7)
    ctx.fill()
  }
}
