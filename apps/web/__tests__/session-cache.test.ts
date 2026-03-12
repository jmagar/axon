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

  it('triggers background refresh when ttl elapses (stale-while-revalidate)', async () => {
    // The cache uses SWR: stale data is returned immediately while a background
    // refresh runs. The second call after TTL elapses returns stale data, not
    // fresh data — fresh data is available on the *next* call after the
    // background refresh completes.
    scanSessionsMock.mockResolvedValueOnce([{ id: 'a' }]).mockResolvedValueOnce([{ id: 'b' }])
    const { getCachedSessions } = await import('@/lib/server/session-cache')

    const opts = { assistantMode: true, limit: 20, perAgentLimit: 30, ttlMs: 1 }

    // Cold start — blocks until scan completes
    const first = await getCachedSessions(opts)
    expect(first).toEqual([{ id: 'a' }])
    expect(scanSessionsMock).toHaveBeenCalledTimes(1)

    // Wait for TTL to elapse
    await new Promise<void>((r) => setTimeout(r, 5))

    // Stale call — returns stale data immediately AND kicks off background refresh
    const second = await getCachedSessions(opts)
    expect(second).toEqual([{ id: 'a' }]) // SWR: stale returned immediately

    // Flush the background refresh promise chain (.then().finally())
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    // Background refresh has completed — scanner was called twice
    expect(scanSessionsMock).toHaveBeenCalledTimes(2)

    // Next call with a generous TTL gets the now-fresh cached data
    const third = await getCachedSessions({ ...opts, ttlMs: 60_000 })
    expect(third).toEqual([{ id: 'b' }])
  })
})
