import type { VisualPresetConfig } from '@/lib/pulse/neural-canvas-presets'
import { COLORS, createRenderAssets, rgba } from './color-utils'
import { Neuron } from './neuron'
import { BackgroundParticle } from './particles'
import { buildConnectionBuckets, SynapticConnection } from './synapse'
import type { AnimState, ConnectionBuckets, RenderAssets } from './types'
import { CONNECTION_MAX_DIST_SQ } from './types'

// ---------------------------------------------------------------------------
// Initialization helpers — creates neurons, connections, particles
// ---------------------------------------------------------------------------

export function createDensityLayer(
  width: number,
  height: number,
  reducedMotion: boolean,
  preset: VisualPresetConfig,
): HTMLCanvasElement {
  const layer = document.createElement('canvas')
  layer.width = width
  layer.height = height
  const layerCtx = layer.getContext('2d')
  if (!layerCtx) return layer

  const area = width * height
  const baseCount = (reducedMotion ? 0.12 : 0.2) * preset.density
  const dotCount = Math.max(120, Math.round((area / 10000) * baseCount * 100))

  for (let i = 0; i < dotCount; i++) {
    const x = Math.random() * width
    const y = Math.random() * height
    const r = Math.random() < 0.85 ? 0.35 + Math.random() * 0.9 : 0.8 + Math.random() * 1.2
    const alpha = (0.02 + Math.random() * 0.055) * preset.brightness
    layerCtx.beginPath()
    layerCtx.arc(x, y, r, 0, Math.PI * 2)
    layerCtx.fillStyle = rgba(COLORS.faint, alpha)
    layerCtx.fill()
  }

  return layer
}

export function createBackgroundLayer(width: number, height: number): HTMLCanvasElement {
  const layer = document.createElement('canvas')
  layer.width = width
  layer.height = height
  return layer
}

export function createAnimState(
  width: number,
  height: number,
  options: {
    neuronCount: number
    particleCount: number
    targetFrameMs: number
    reducedMotion: boolean
    visual: VisualPresetConfig
  },
): AnimState {
  const { neuronCount, particleCount, targetFrameMs, reducedMotion, visual } = options

  const particles: BackgroundParticle[] = []
  for (let i = 0; i < particleCount; i++) {
    particles.push(new BackgroundParticle(width, height))
  }

  const neurons: Neuron[] = []
  for (let i = 0; i < neuronCount; i++) {
    neurons.push(new Neuron(width, height))
  }

  // Build synaptic web
  const connections: SynapticConnection[] = []
  neurons.forEach((neuron, i) => {
    const terminal = neuron.axon.getTerminal()
    const endpoints = [terminal, ...neuron.axon.boutons.map((b) => ({ x: b.x, y: b.y }))]

    neurons.forEach((target, j) => {
      if (i === j) return
      endpoints.forEach((ep) => {
        target.dendrites.forEach((dendrite) => {
          const tip = dendrite.getTip()
          const dx = ep.x - tip.x
          const dy = ep.y - tip.y
          const distSq = dx * dx + dy * dy

          if (distSq < CONNECTION_MAX_DIST_SQ && Math.random() > 0.45) {
            const conn = new SynapticConnection(neuron, target, ep, tip)
            connections.push(conn)
            neuron.outgoingConnections.push(conn)
          }
        })
      })
    })
  })

  // Sort by depth for painter's algorithm (back to front)
  neurons.sort((a, b) => a.depth - b.depth)

  const connectionBuckets: ConnectionBuckets = buildConnectionBuckets(connections)

  return {
    neurons,
    connections,
    connectionBuckets,
    signals: [],
    particles,
    densityLayer: createDensityLayer(width, height, reducedMotion, visual),
    backgroundLayer: createBackgroundLayer(width, height),
    backgroundNeedsRefresh: true,
    backgroundInterval: Math.max(
      1,
      reducedMotion ? visual.backgroundInterval + 1 : visual.backgroundInterval,
    ),
    visual,
    renderAssets: createRenderAssets(visual) as RenderAssets,
    intensity: 0,
    targetIntensity: 0,
    burstCooldown: 0,
    frameId: 0,
    lastTime: 0,
    lastRenderTime: 0,
    fpsEma: 60,
    frameCount: 0,
    width,
    height,
    targetFrameMs,
    isVisible: true,
  }
}
