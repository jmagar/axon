// ---------------------------------------------------------------------------
// Simplex-like drift (multi-octave sine)
// ---------------------------------------------------------------------------

export class SimplexDrift {
  private offsetX: number
  private offsetY: number
  private speed: number

  constructor() {
    this.offsetX = Math.random() * 1000
    this.offsetY = Math.random() * 1000
    this.speed = 0.0003 + Math.random() * 0.0004
  }

  get(time: number): { x: number; y: number } {
    const t = time * this.speed
    const x =
      Math.sin(t + this.offsetX) * 0.3 +
      Math.sin(t * 2.3 + this.offsetX * 1.7) * 0.15 +
      Math.sin(t * 4.1 + this.offsetX * 0.3) * 0.05
    const y =
      Math.sin(t * 0.9 + this.offsetY) * 0.3 +
      Math.sin(t * 1.8 + this.offsetY * 1.3) * 0.15 +
      Math.sin(t * 3.7 + this.offsetY * 0.7) * 0.05
    return { x, y }
  }
}
