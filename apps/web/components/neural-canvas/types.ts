import type { VisualPresetConfig } from '@/lib/pulse/neural-canvas-presets'
import type { ContainerStats } from '@/lib/ws-protocol'

export interface NeuralCanvasHandle {
  setIntensity: (target: number) => void
  stimulate: (containers: Record<string, ContainerStats>) => void
}

export interface NeuralCanvasProps {
  profile?: import('@/lib/pulse/neural-canvas-presets').NeuralCanvasProfile
}

export interface RGB {
  r: number
  g: number
  b: number
}

export interface RenderAssets {
  neuronOuterGlow: HTMLCanvasElement
  neuronMidGlow: HTMLCanvasElement
  neuronInnerGlow: HTMLCanvasElement
  neuronFlashGlow: HTMLCanvasElement
  actionPotentialGlow: HTMLCanvasElement
  particleGlow: HTMLCanvasElement
  spineGlow: HTMLCanvasElement
}

export interface Spine {
  t: number
  angle: number
  length: number
}

export interface AxonSegment {
  startX: number
  startY: number
  endX: number
  endY: number
  isMyelin: boolean
}

export interface Bouton {
  x: number
  y: number
  radius: number
}

export interface ConnectionBuckets {
  strong: SynapticConnectionRef[]
  medium: SynapticConnectionRef[]
  faint: SynapticConnectionRef[]
}

/** Lightweight reference type to avoid circular dependency with full class */
export interface SynapticConnectionRef {
  preTerminal: { x: number; y: number }
  dendriteTip: { x: number; y: number }
  bucket: 0 | 1 | 2
  strength: number
  postNeuron: { receiveSignal: (strength: number) => void }
}

export interface AnimState {
  neurons: NeuronRef[]
  connections: SynapticConnectionRef[]
  connectionBuckets: ConnectionBuckets
  signals: ActionPotentialRef[]
  particles: ParticleRef[]
  densityLayer: HTMLCanvasElement
  backgroundLayer: HTMLCanvasElement
  backgroundNeedsRefresh: boolean
  backgroundInterval: number
  visual: VisualPresetConfig
  renderAssets: RenderAssets
  intensity: number
  targetIntensity: number
  burstCooldown: number
  frameId: number
  lastTime: number
  lastRenderTime: number
  fpsEma: number
  frameCount: number
  width: number
  height: number
  targetFrameMs: number
  isVisible: boolean
}

/** Minimal neuron shape for AnimState without importing the class */
export interface NeuronRef {
  x: number
  y: number
  depth: number
  isFiring: boolean
  firePhase: number
  fireTimer: number
  refractoryTime: number
  epsp: number
  outgoingConnections: SynapticConnectionRef[]
  receiveSignal: (strength: number) => void
  update: (time: number, dt: number, width: number, height: number, driftScale: number) => void
  draw: (
    ctx: CanvasRenderingContext2D,
    time: number,
    options: {
      fineDetail: boolean
      allowSpines: boolean
      assets: RenderAssets
      visual: VisualPresetConfig
    },
  ) => void
}

/** Minimal action potential shape */
export interface ActionPotentialRef {
  active: boolean
  update: (dt: number) => void
  draw: (ctx: CanvasRenderingContext2D, assets: RenderAssets, withGlow: boolean) => void
}

/** Minimal particle shape */
export interface ParticleRef {
  z: number
  update: (time: number, width: number, height: number, driftScale: number) => void
  draw: (
    ctx: CanvasRenderingContext2D,
    time: number,
    assets: RenderAssets,
    withGlow: boolean,
    snap: boolean,
  ) => void
}

export const CONNECTION_MAX_DIST = 280
export const CONNECTION_MAX_DIST_SQ = CONNECTION_MAX_DIST * CONNECTION_MAX_DIST
