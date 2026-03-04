import type { VisualPresetConfig } from '@/lib/pulse/neural-canvas-presets'
import { Axon } from './axon'
import { COLORS, drawSprite, mixColor, rgba } from './color-utils'
import { Dendrite } from './dendrite'
import { SimplexDrift } from './simplex-drift'
import type { RenderAssets, SynapticConnectionRef } from './types'

// ---------------------------------------------------------------------------
// Neuron — Hodgkin-Huxley inspired membrane potential
// ---------------------------------------------------------------------------

export class Neuron {
  x: number
  y: number
  radius: number
  drift: SimplexDrift
  depth: number
  potential: number
  threshold: number
  restingPotential: number
  peakPotential: number
  refractoryTime: number
  refractoryDuration: number
  isFiring: boolean
  firePhase: number
  fireTimer: number
  spontaneousRate: number
  epsp: number
  dendrites: Dendrite[]
  axon: Axon
  outgoingConnections: SynapticConnectionRef[]

  constructor(width: number, height: number) {
    this.x = Math.random() * width
    this.y = Math.random() * height
    this.radius = 8 + Math.random() * 6
    this.drift = new SimplexDrift()
    this.depth = Math.random()

    this.potential = -70
    this.threshold = -55
    this.restingPotential = -70
    this.peakPotential = 40
    this.refractoryTime = 0
    this.refractoryDuration = 80 + Math.random() * 40
    this.isFiring = false
    this.firePhase = 0
    this.fireTimer = 0
    this.spontaneousRate = Math.random() < 0.15 ? 0.001 + Math.random() * 0.002 : 0
    this.epsp = 0

    this.dendrites = []
    const dendriteCount = 4 + Math.floor(Math.random() * 4)
    for (let i = 0; i < dendriteCount; i++) {
      const angle = ((Math.PI * 2) / dendriteCount) * i + (Math.random() - 0.5) * 0.5
      const length = 30 + Math.random() * 50
      this.dendrites.push(new Dendrite(this.x, this.y, angle, length))
    }

    this.axon = new Axon(this.x, this.y)
    this.outgoingConnections = []
  }

  receiveSignal(strength = 15) {
    if (this.refractoryTime > 0) return
    this.epsp += strength
  }

  update(time: number, dt: number, width: number, height: number, driftScale = 1) {
    const d = this.drift.get(time)
    this.x += d.x * driftScale
    this.y += d.y * driftScale

    const margin = 100
    if (this.x < -margin) this.x = width + margin
    if (this.x > width + margin) this.x = -margin
    if (this.y < -margin) this.y = height + margin
    if (this.y > height + margin) this.y = -margin

    this.dendrites.forEach((dd) => dd.updatePosition(this.x, this.y))
    this.axon.updatePosition(this.x, this.y)

    if (this.refractoryTime > 0) {
      this.refractoryTime -= dt
      this.potential += (this.restingPotential - 5 - this.potential) * 0.05
      this.epsp = 0
      return
    }

    if (this.spontaneousRate > 0 && Math.random() < this.spontaneousRate) {
      this.epsp += 20
    }

    this.potential += this.epsp * 0.5
    this.epsp *= 0.85
    this.potential += (this.restingPotential - this.potential) * 0.02

    if (!this.isFiring && this.potential >= this.threshold) {
      this.isFiring = true
      this.firePhase = 1
      this.fireTimer = 0
    }

    if (this.isFiring) {
      this.fireTimer += dt
      if (this.firePhase === 1) {
        this.potential += (this.peakPotential - this.potential) * 0.3
        if (this.potential > this.peakPotential - 5) {
          this.firePhase = 2
        }
      } else if (this.firePhase === 2) {
        this.potential += (this.restingPotential - 10 - this.potential) * 0.15
        if (this.potential < this.restingPotential) {
          this.firePhase = 0
          this.isFiring = false
          this.refractoryTime = this.refractoryDuration
          this.potential = this.restingPotential - 8
        }
      }
    }
  }

  draw(
    ctx: CanvasRenderingContext2D,
    time: number,
    options: {
      fineDetail: boolean
      allowSpines: boolean
      assets: RenderAssets
      visual: VisualPresetConfig
    },
  ) {
    const { fineDetail, allowSpines, assets, visual } = options
    const potentialNorm = Math.max(
      0,
      Math.min(
        1,
        (this.potential - this.restingPotential) / (this.peakPotential - this.restingPotential),
      ),
    )

    const flicker = Math.sin(time * 0.002 + this.x * 0.01) * 0.05 + 0.95
    const baseOpacity = (0.3 + potentialNorm * 0.7) * flicker * visual.brightness

    const ds = 0.4 + this.depth * 0.6
    const da = 0.25 + this.depth * 0.75

    // LOD: skip spines for depth < 0.3
    const skipSpines = this.depth < 0.3 || !allowSpines

    this.axon.draw(ctx, baseOpacity * da, ds)
    this.dendrites.forEach((d) => d.draw(ctx, baseOpacity * da, time, ds, skipSpines, assets))

    const r = this.radius * ds
    const x = this.x
    const y = this.y
    const activatedCore = mixColor(
      COLORS.bright,
      COLORS.core,
      Math.min(1, potentialNorm * 0.8 * visual.glow),
    )

    // Volumetric glow (additive)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'

    // Outermost bloom
    const outerR = r * (10 + potentialNorm * 8)
    const oA = (0.02 + potentialNorm * 0.06) * da
    drawSprite(ctx, assets.neuronOuterGlow, x, y, outerR, oA)

    // Mid bloom
    const midR = r * (5 + potentialNorm * 3)
    const mA = (0.06 + potentialNorm * 0.12) * da
    drawSprite(ctx, assets.neuronMidGlow, x, y, midR, mA)

    // Inner glow
    const innerR = r * (2.5 + potentialNorm * 1.5)
    const iA = (0.12 + potentialNorm * 0.3) * da
    drawSprite(ctx, assets.neuronInnerGlow, x, y, innerR, iA)

    // Firing flash
    if (this.isFiring) {
      const flashR = r * (14 + potentialNorm * 10)
      drawSprite(ctx, assets.neuronFlashGlow, x, y, flashR, 0.32 * potentialNorm * da)
    }

    ctx.restore()

    // Soma body
    const offX = -r * 0.25
    const offY = -r * 0.25

    const somaG = ctx.createRadialGradient(x + offX, y + offY, r * 0.1, x, y, r)
    somaG.addColorStop(0, rgba(activatedCore, (0.3 + potentialNorm * 0.4) * da))
    somaG.addColorStop(0.4, rgba(COLORS.bright, (0.18 + potentialNorm * 0.2) * da))
    somaG.addColorStop(0.8, rgba(COLORS.mid, (0.1 + potentialNorm * 0.1) * da))
    somaG.addColorStop(1, rgba(COLORS.dim, 0.05 * da))
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = somaG
    ctx.fill()

    // Membrane ring
    ctx.beginPath()
    ctx.arc(x, y, r + 0.5, 0, Math.PI * 2)
    ctx.strokeStyle = rgba(COLORS.bright, (0.15 + potentialNorm * 0.3) * da)
    ctx.lineWidth = 1.2 * ds
    ctx.stroke()

    // Internal texture (only foreground neurons)
    if (fineDetail && this.depth > 0.4) {
      ctx.save()
      ctx.globalAlpha = (0.06 + potentialNorm * 0.08) * da
      for (let k = 0; k < 5; k++) {
        const angle1 = (k / 5) * Math.PI * 2 + time * 0.0001
        const angle2 = angle1 + Math.PI * 0.6
        ctx.beginPath()
        ctx.moveTo(x + Math.cos(angle1) * r * 0.7, y + Math.sin(angle1) * r * 0.7)
        ctx.quadraticCurveTo(
          x + Math.cos((angle1 + angle2) / 2) * r * 0.3,
          y + Math.sin((angle1 + angle2) / 2) * r * 0.3,
          x + Math.cos(angle2) * r * 0.7,
          y + Math.sin(angle2) * r * 0.7,
        )
        ctx.strokeStyle = rgba(COLORS.bright, 0.4)
        ctx.lineWidth = 0.5
        ctx.stroke()
      }
      ctx.restore()
    }

    // Nucleus
    const nucR = r * 0.4
    const nucG = ctx.createRadialGradient(x + offX * 0.3, y + offY * 0.3, 0, x, y, nucR)
    nucG.addColorStop(0, rgba(activatedCore, (0.55 + potentialNorm * 0.4) * da))
    nucG.addColorStop(0.5, rgba(COLORS.bright, (0.25 + potentialNorm * 0.2) * da))
    nucG.addColorStop(1, rgba(COLORS.mid, 0))
    ctx.beginPath()
    ctx.arc(x, y, nucR, 0, Math.PI * 2)
    ctx.fillStyle = nucG
    ctx.fill()
  }

  getRandomDendriteTip(): { x: number; y: number } {
    const d = this.dendrites[Math.floor(Math.random() * this.dendrites.length)]
    return d.getTip()
  }
}
