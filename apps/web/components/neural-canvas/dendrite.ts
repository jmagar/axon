import { COLORS, drawSprite, rgba } from './color-utils'
import type { RenderAssets, Spine } from './types'

// ---------------------------------------------------------------------------
// Dendrite — curved, recursively branching structures with spines
// ---------------------------------------------------------------------------

export class Dendrite {
  baseAngle: number
  baseLength: number
  depth: number
  branches: Dendrite[]
  waveOffset: number
  waveSpeed: number
  curvature: number
  startX: number
  startY: number
  endX: number
  endY: number
  cpX: number
  cpY: number
  spines: Spine[]

  constructor(x: number, y: number, angle: number, length: number, depth = 0) {
    this.baseAngle = angle
    this.baseLength = length
    this.depth = depth
    this.branches = []
    this.waveOffset = Math.random() * Math.PI * 2
    this.waveSpeed = 0.0008 + Math.random() * 0.0005
    this.curvature = (Math.random() - 0.5) * length * 0.4

    this.startX = x
    this.startY = y
    this.endX = x + Math.cos(angle) * length
    this.endY = y + Math.sin(angle) * length

    const perpAngle = angle + Math.PI / 2
    this.cpX = (this.startX + this.endX) / 2 + Math.cos(perpAngle) * this.curvature
    this.cpY = (this.startY + this.endY) / 2 + Math.sin(perpAngle) * this.curvature

    // Dendritic spines — LOD: skip for shallow-depth neurons
    this.spines = []
    if (depth < 3) {
      const spineCount = Math.floor(Math.random() * 3) + 1
      for (let i = 0; i < spineCount; i++) {
        this.spines.push({
          t: 0.2 + Math.random() * 0.6,
          angle: (Math.random() - 0.5) * Math.PI,
          length: 3 + Math.random() * 5,
        })
      }
    }

    // Branch deeper with tapering probability
    if (depth < 3 && Math.random() > 0.3 + depth * 0.15) {
      const branchCount = depth < 2 ? Math.floor(Math.random() * 2) + 1 : 1
      for (let i = 0; i < branchCount; i++) {
        const branchAngle = angle + ((Math.random() - 0.5) * Math.PI) / 2.5
        const branchLength = length * (0.45 + Math.random() * 0.25)
        this.branches.push(new Dendrite(this.endX, this.endY, branchAngle, branchLength, depth + 1))
      }
    }
  }

  draw(
    ctx: CanvasRenderingContext2D,
    opacity: number,
    time: number,
    depthScale = 1,
    skipSpines = false,
    assets?: RenderAssets,
  ) {
    const alpha = opacity * (1 - this.depth * 0.18)
    const sway = Math.sin(time * this.waveSpeed + this.waveOffset) * 2
    const cpxs = this.cpX + sway
    const cpys = this.cpY + sway
    const baseWidth = Math.max(0.5, 3.0 - this.depth * 0.7) * depthScale

    // Glow pass — additive
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.beginPath()
    ctx.moveTo(this.startX, this.startY)
    ctx.quadraticCurveTo(cpxs, cpys, this.endX, this.endY)
    ctx.strokeStyle = rgba(COLORS.mid, alpha * 0.12)
    ctx.lineWidth = baseWidth * 5
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(this.startX, this.startY)
    ctx.quadraticCurveTo(cpxs, cpys, this.endX, this.endY)
    ctx.strokeStyle = rgba(COLORS.bright, alpha * 0.08)
    ctx.lineWidth = baseWidth * 10
    ctx.stroke()
    ctx.restore()

    // Core dendrite line
    ctx.beginPath()
    ctx.moveTo(this.startX, this.startY)
    ctx.quadraticCurveTo(cpxs, cpys, this.endX, this.endY)
    ctx.strokeStyle = rgba(COLORS.bright, alpha * 0.6)
    ctx.lineWidth = baseWidth
    ctx.stroke()

    // Dendritic spines with glow (LOD: skip for depth < 0.3)
    if (!skipSpines) {
      for (const spine of this.spines) {
        const t = spine.t
        const px = (1 - t) * (1 - t) * this.startX + 2 * (1 - t) * t * cpxs + t * t * this.endX
        const py = (1 - t) * (1 - t) * this.startY + 2 * (1 - t) * t * cpys + t * t * this.endY
        const sx = px + Math.cos(spine.angle) * spine.length * depthScale
        const sy = py + Math.sin(spine.angle) * spine.length * depthScale

        ctx.beginPath()
        ctx.moveTo(px, py)
        ctx.lineTo(sx, sy)
        ctx.strokeStyle = rgba(COLORS.bright, alpha * 0.35)
        ctx.lineWidth = 0.8 * depthScale
        ctx.stroke()

        // Spine head glow
        const headR = 1.5 * depthScale
        if (assets) {
          ctx.save()
          ctx.globalCompositeOperation = 'lighter'
          drawSprite(ctx, assets.spineGlow, sx, sy, headR * 4, alpha * 0.7)
          ctx.restore()
        } else {
          ctx.save()
          ctx.globalCompositeOperation = 'lighter'
          const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, headR * 4)
          sg.addColorStop(0, rgba(COLORS.bright, alpha * 0.2))
          sg.addColorStop(1, rgba(COLORS.bright, 0))
          ctx.beginPath()
          ctx.arc(sx, sy, headR * 4, 0, Math.PI * 2)
          ctx.fillStyle = sg
          ctx.fill()
          ctx.restore()
        }

        ctx.beginPath()
        ctx.arc(sx, sy, headR, 0, Math.PI * 2)
        ctx.fillStyle = rgba(COLORS.core, alpha * 0.5)
        ctx.fill()
      }
    }

    this.branches.forEach((branch) =>
      branch.draw(ctx, opacity, time, depthScale, skipSpines, assets),
    )
  }

  getTip(): { x: number; y: number } {
    if (this.branches.length === 0) {
      return { x: this.endX, y: this.endY }
    }
    // branches.length > 0 is checked above — this index is always valid
    return this.branches[Math.floor(Math.random() * this.branches.length)]!.getTip()
  }

  updatePosition(newStartX: number, newStartY: number) {
    const dx = newStartX - this.startX
    const dy = newStartY - this.startY
    this.startX = newStartX
    this.startY = newStartY
    this.endX += dx
    this.endY += dy
    this.cpX += dx
    this.cpY += dy
    this.branches.forEach((branch) => branch.updatePosition(this.endX, this.endY))
  }
}
