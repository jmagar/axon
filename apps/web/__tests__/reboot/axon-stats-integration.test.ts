import { describe, expect, it } from 'vitest'
import { computeCanvasIntensity } from '../../lib/pulse/stats-utils'

describe('computeCanvasIntensity', () => {
  it('returns 1 when processing', () => {
    expect(computeCanvasIntensity(50, 4, true)).toBe(1)
  })

  it('computes normalized intensity from CPU', () => {
    const result = computeCanvasIntensity(200, 4, false)
    expect(result).toBeCloseTo(0.02 + 0.5 * 0.83, 2)
  })

  it('clamps to max intensity', () => {
    const result = computeCanvasIntensity(500, 4, false)
    expect(result).toBeCloseTo(0.02 + 1.0 * 0.83, 2)
  })

  it('returns baseline with zero CPU', () => {
    const result = computeCanvasIntensity(0, 4, false)
    expect(result).toBeCloseTo(0.02, 2)
  })

  it('guards against container_count === 0', () => {
    const result = computeCanvasIntensity(50, 0, false)
    expect(result).toBeCloseTo(0.02, 2)
  })
})
