import type { VisualPresetConfig } from '@/lib/pulse/neural-canvas-presets'
import { COLORS, drawSprite, mixColor, rgba } from './color-utils'
import type { Neuron } from './neuron'
import type { AxonSegment, ConnectionBuckets, RenderAssets, SynapticConnectionRef } from './types'
import { CONNECTION_MAX_DIST } from './types'

// ---------------------------------------------------------------------------
// SynapticConnection — fiber between axon terminal and dendrite tip
// ---------------------------------------------------------------------------

export class SynapticConnection implements SynapticConnectionRef {
  preNeuron: Neuron
  postNeuron: Neuron
  preTerminal: { x: number; y: number }
  dendriteTip: { x: number; y: number }
  strength: number
  baseAlpha: number
  bucket: 0 | 1 | 2

  constructor(
    preNeuron: Neuron,
    postNeuron: Neuron,
    preTerminal: { x: number; y: number },
    dendriteTip: { x: number; y: number },
  ) {
    this.preNeuron = preNeuron
    this.postNeuron = postNeuron
    this.preTerminal = preTerminal
    this.dendriteTip = dendriteTip
    this.strength = 0.3 + Math.random() * 0.7

    const dx = dendriteTip.x - preTerminal.x
    const dy = dendriteTip.y - preTerminal.y
    const distNorm = Math.min(1, Math.sqrt(dx * dx + dy * dy) / CONNECTION_MAX_DIST)
    this.baseAlpha = (1 - distNorm) * 0.18 * this.strength
    this.bucket = this.baseAlpha > 0.12 ? 0 : this.baseAlpha > 0.06 ? 1 : 2
  }
}

// ---------------------------------------------------------------------------
// ActionPotential — traveling signal dot with glow
// ---------------------------------------------------------------------------

export class ActionPotential {
  neuron: Neuron
  connection: SynapticConnection
  segments: AxonSegment[]
  phase: 'axon' | 'synapse' | 'dendrite'
  progress: number
  currentSegment: number
  active: boolean
  synapseTimer: number
  baseSpeed: number

  constructor(neuron: Neuron, connection: SynapticConnection) {
    this.neuron = neuron
    this.connection = connection
    this.segments = neuron.axon.segments
    this.phase = 'axon'
    this.progress = 0
    this.currentSegment = 0
    this.active = true
    this.synapseTimer = 0
    this.baseSpeed = 0.02 + Math.random() * 0.015
  }

  update(_dt: number) {
    if (this.phase === 'axon') {
      const seg = this.segments[this.currentSegment]
      this.progress += seg.isMyelin ? this.baseSpeed * 3 : this.baseSpeed
      if (this.progress >= 1) {
        this.currentSegment++
        this.progress = 0
        if (this.currentSegment >= this.segments.length) {
          this.phase = 'synapse'
          this.synapseTimer = 0
        }
      }
    } else if (this.phase === 'synapse') {
      this.synapseTimer += 0.04
      if (this.synapseTimer >= 1) {
        this.connection.postNeuron.receiveSignal(10 * this.connection.strength)
        this.phase = 'dendrite'
        this.progress = 0
      }
    } else if (this.phase === 'dendrite') {
      this.progress += this.baseSpeed * 1.5
      if (this.progress >= 1) this.active = false
    }
  }

  draw(ctx: CanvasRenderingContext2D, assets: RenderAssets, withGlow = true) {
    if (!this.active) return

    let x: number | undefined
    let y: number | undefined

    if (this.phase === 'axon') {
      const seg = this.segments[this.currentSegment]
      const t = Math.min(this.progress, 1)
      x = seg.startX + (seg.endX - seg.startX) * t
      y = seg.startY + (seg.endY - seg.startY) * t
    } else if (this.phase === 'synapse') {
      const pre = this.connection.preTerminal
      const post = this.connection.dendriteTip
      x = pre.x + (post.x - pre.x) * this.synapseTimer
      y = pre.y + (post.y - pre.y) * this.synapseTimer
    } else if (this.phase === 'dendrite') {
      const start = this.connection.dendriteTip
      const end = this.connection.postNeuron
      x = start.x + (end.x - start.x) * this.progress
      y = start.y + (end.y - start.y) * this.progress
    }

    if (x === undefined || y === undefined) return

    // Glow halo
    if (withGlow) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      drawSprite(ctx, assets.actionPotentialGlow, x, y, 10, 0.85)
      ctx.restore()
    }

    // Core dot
    ctx.beginPath()
    ctx.arc(x, y, 2.5, 0, Math.PI * 2)
    ctx.fillStyle = rgba(COLORS.core, 0.95)
    ctx.fill()
  }
}

// ---------------------------------------------------------------------------
// Batched connection renderer
// ---------------------------------------------------------------------------

export function buildConnectionBuckets(conns: SynapticConnectionRef[]): ConnectionBuckets {
  const strong: SynapticConnectionRef[] = []
  const medium: SynapticConnectionRef[] = []
  const faint: SynapticConnectionRef[] = []
  for (let i = 0; i < conns.length; i++) {
    const c = conns[i]
    if (c.bucket === 0) strong.push(c)
    else if (c.bucket === 1) medium.push(c)
    else faint.push(c)
  }
  return { strong, medium, faint }
}

export function drawConnections(
  ctx: CanvasRenderingContext2D,
  buckets: ConnectionBuckets,
  neuralIntensity: number,
  time: number,
  preset: VisualPresetConfig,
  stride = 1,
) {
  const grouped = [buckets.strong, buckets.medium, buckets.faint]

  const alphas = [0.12, 0.06, 0.03]
  const widths = [0.6, 0.4, 0.3]
  const glowWidths = [3, 2, 1.5]
  const pulse = 0.9 + 0.1 * Math.sin(time * 0.004 * preset.pulse)
  const boost = (1 + neuralIntensity * 2) * pulse
  const glowColor = mixColor(
    COLORS.dim,
    COLORS.mid,
    Math.min(1, neuralIntensity * 0.75 * preset.glow),
  )
  const fiberColor = mixColor(
    COLORS.mid,
    COLORS.core,
    Math.min(1, neuralIntensity * 0.5 * preset.brightness),
  )

  // Glow pass (additive)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (let b = 0; b < 3; b++) {
    if (grouped[b].length === 0) continue
    ctx.strokeStyle = rgba(glowColor, Math.min(alphas[b] * boost * 0.5 * preset.brightness, 0.2))
    ctx.lineWidth = glowWidths[b]
    ctx.beginPath()
    for (let i = 0; i < grouped[b].length; i++) {
      if (stride > 1 && i % stride !== 0) continue
      const c = grouped[b][i]
      ctx.moveTo(c.preTerminal.x, c.preTerminal.y)
      ctx.lineTo(c.dendriteTip.x, c.dendriteTip.y)
    }
    ctx.stroke()
  }
  ctx.restore()

  // Crisp fiber pass
  for (let b = 0; b < 3; b++) {
    if (grouped[b].length === 0) continue
    ctx.strokeStyle = rgba(fiberColor, Math.min(alphas[b] * boost * preset.brightness, 0.32))
    ctx.lineWidth = widths[b]
    ctx.beginPath()
    for (let i = 0; i < grouped[b].length; i++) {
      if (stride > 1 && i % stride !== 0) continue
      const c = grouped[b][i]
      ctx.moveTo(c.preTerminal.x, c.preTerminal.y)
      ctx.lineTo(c.dendriteTip.x, c.dendriteTip.y)
    }
    ctx.stroke()
  }
}
