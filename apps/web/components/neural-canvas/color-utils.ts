import type { VisualPresetConfig } from '@/lib/pulse/neural-canvas-presets'
import type { RenderAssets, RGB } from './types'

// ---------------------------------------------------------------------------
// Color palette — bioluminescent blue (matches neural.js)
// ---------------------------------------------------------------------------

export let COLORS: Record<string, RGB> = {
  core: { r: 210, g: 235, b: 255 },
  bright: { r: 50, g: 160, b: 255 },
  mid: { r: 15, g: 90, b: 210 },
  dim: { r: 8, g: 45, b: 140 },
  faint: { r: 4, g: 20, b: 70 },
}

export function applyPalette(preset: VisualPresetConfig) {
  const p = preset.palette
  COLORS = {
    core: p.core,
    bright: p.bright,
    mid: p.mid,
    dim: p.dim,
    faint: p.faint,
  }
}

export function rgba(c: RGB, a: number): string {
  return `rgba(${c.r},${c.g},${c.b},${a})`
}

export function mixColor(a: RGB, b: RGB, t: number): RGB {
  const v = Math.max(0, Math.min(1, t))
  return {
    r: Math.round(a.r + (b.r - a.r) * v),
    g: Math.round(a.g + (b.g - a.g) * v),
    b: Math.round(a.b + (b.b - a.b) * v),
  }
}

export function createGlowSprite(
  size: number,
  colorStops: Array<{ offset: number; color: string }>,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const c = size / 2
  const g = ctx.createRadialGradient(c, c, 0, c, c, c)
  colorStops.forEach((stop) => g.addColorStop(stop.offset, stop.color))
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  return canvas
}

export function createRenderAssets(preset: VisualPresetConfig): RenderAssets {
  const b = preset.brightness
  const g = preset.glow
  return {
    neuronOuterGlow: createGlowSprite(256, [
      { offset: 0, color: rgba(COLORS.bright, 0.25 * b * g) },
      { offset: 0.3, color: rgba(COLORS.mid, 0.11 * b * g) },
      { offset: 0.65, color: rgba(COLORS.dim, 0.05 * b * g) },
      { offset: 1, color: 'rgba(0,0,0,0)' },
    ]),
    neuronMidGlow: createGlowSprite(192, [
      { offset: 0, color: rgba(COLORS.core, 0.32 * b * g) },
      { offset: 0.35, color: rgba(COLORS.bright, 0.17 * b * g) },
      { offset: 0.75, color: rgba(COLORS.mid, 0.05 * b * g) },
      { offset: 1, color: 'rgba(0,0,0,0)' },
    ]),
    neuronInnerGlow: createGlowSprite(128, [
      { offset: 0, color: rgba(COLORS.core, 0.42 * b * g) },
      { offset: 0.45, color: rgba(COLORS.bright, 0.22 * b * g) },
      { offset: 1, color: 'rgba(0,0,0,0)' },
    ]),
    neuronFlashGlow: createGlowSprite(320, [
      { offset: 0, color: rgba(COLORS.core, 0.36 * b * g) },
      { offset: 0.2, color: rgba(COLORS.bright, 0.2 * b * g) },
      { offset: 0.5, color: rgba(COLORS.mid, 0.08 * b * g) },
      { offset: 1, color: 'rgba(0,0,0,0)' },
    ]),
    actionPotentialGlow: createGlowSprite(48, [
      { offset: 0, color: rgba(COLORS.core, 0.35 * b * g) },
      { offset: 0.35, color: rgba(COLORS.bright, 0.12 * b * g) },
      { offset: 1, color: 'rgba(0,0,0,0)' },
    ]),
    particleGlow: createGlowSprite(64, [
      { offset: 0, color: rgba(COLORS.bright, 0.12 * b * g) },
      { offset: 0.5, color: rgba(COLORS.mid, 0.04 * b * g) },
      { offset: 1, color: 'rgba(0,0,0,0)' },
    ]),
    spineGlow: createGlowSprite(32, [
      { offset: 0, color: rgba(COLORS.bright, 0.24 * b * g) },
      { offset: 1, color: 'rgba(0,0,0,0)' },
    ]),
  }
}

export function drawSprite(
  ctx: CanvasRenderingContext2D,
  sprite: HTMLCanvasElement,
  x: number,
  y: number,
  radius: number,
  alpha: number,
) {
  if (alpha <= 0 || radius <= 0) return
  const d = radius * 2
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.drawImage(sprite, x - radius, y - radius, d, d)
  ctx.restore()
}
