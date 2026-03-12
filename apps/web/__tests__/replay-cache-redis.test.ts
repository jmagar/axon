import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const redisSetMock = vi.fn(async () => 'OK')
const redisGetMock = vi.fn(async () => null)

vi.mock('@/lib/server/redis-client', () => ({
  getRedisClient: () => ({
    set: redisSetMock,
    get: redisGetMock,
  }),
}))

describe('replay-cache redis persistence', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces redis writes and persists latest payload', async () => {
    const module = await import('@/app/api/pulse/chat/replay-cache')

    module.upsertReplayEntry('k1', [{ type: 'status', phase: 'started', event_id: '1' }], 10)
    module.upsertReplayEntry('k1', [{ type: 'status', phase: 'thinking', event_id: '2' }], 11)

    vi.advanceTimersByTime(200)
    await Promise.resolve()

    expect(redisSetMock).toHaveBeenCalledTimes(1)
    const [key, value] = redisSetMock.mock.calls[0] as [string, string]
    expect(key).toContain('axon:web:replay:k1')
    expect(value).toContain('thinking')
  })

  it('loads replay entry from redis when memory miss occurs', async () => {
    redisGetMock.mockResolvedValueOnce(
      JSON.stringify({
        events: [{ type: 'status', phase: 'started', event_id: 'x' }],
        sizeBytes: 12,
        updatedAt: Date.now(),
      }),
    )

    const module = await import('@/app/api/pulse/chat/replay-cache')
    const entry = await module.getReplayEntry('k2')

    expect(entry?.events).toHaveLength(1)
    expect(entry?.events[0]).toMatchObject({ type: 'status', phase: 'started' })
    expect(redisGetMock).toHaveBeenCalledTimes(1)
  })
})
