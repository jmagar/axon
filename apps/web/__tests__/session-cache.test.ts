import { beforeEach, describe, expect, it, vi } from 'vitest'

const scanSessionsMock = vi.fn()

vi.mock('@/lib/sessions/session-scanner', () => ({
  scanSessions: (...args: unknown[]) => scanSessionsMock(...args),
}))

describe('getCachedSessions', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('reuses cached scan results within ttl', async () => {
    scanSessionsMock.mockResolvedValue([{ id: 'a' }])
    const { getCachedSessions } = await import('@/lib/server/session-cache')

    const first = await getCachedSessions({
      assistantMode: false,
      limit: 20,
      perAgentLimit: 30,
      ttlMs: 10_000,
    })
    const second = await getCachedSessions({
      assistantMode: false,
      limit: 20,
      perAgentLimit: 30,
      ttlMs: 10_000,
    })

    expect(first).toEqual([{ id: 'a' }])
    expect(second).toEqual([{ id: 'a' }])
    expect(scanSessionsMock).toHaveBeenCalledTimes(1)
  })

  it('refreshes cache after ttl elapses', async () => {
    vi.useFakeTimers()
    scanSessionsMock.mockResolvedValueOnce([{ id: 'a' }]).mockResolvedValueOnce([{ id: 'b' }])
    const { getCachedSessions } = await import('@/lib/server/session-cache')

    const first = await getCachedSessions({
      assistantMode: true,
      limit: 20,
      perAgentLimit: 30,
      ttlMs: 100,
    })

    vi.advanceTimersByTime(101)

    const second = await getCachedSessions({
      assistantMode: true,
      limit: 20,
      perAgentLimit: 30,
      ttlMs: 100,
    })

    expect(first).toEqual([{ id: 'a' }])
    expect(second).toEqual([{ id: 'b' }])
    expect(scanSessionsMock).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})
