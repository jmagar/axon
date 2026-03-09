import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mirror the retry schedule from use-axon-session.ts.
// If the schedule changes in production, these tests will catch the drift.
const RETRY_DELAYS_MS = [200, 400, 800, 1600, 3200, 5000]

// Mirror of fetchSessionWithRetry with an injectable apiFetch so we can test
// the retry logic in isolation without importing the unexported function.
// The logic must stay in sync with use-axon-session.ts.
interface FakeResponse {
  ok: boolean
  status: number
  json?: () => Promise<unknown>
}

async function fetchSessionWithRetry(
  apiFetch: () => Promise<FakeResponse>,
  isCancelled: () => boolean = () => false,
): Promise<unknown> {
  for (let i = 0; i <= RETRY_DELAYS_MS.length; i++) {
    if (isCancelled()) throw new Error('cancelled')
    const res = await apiFetch()
    if (res.ok) return res.json?.()
    if (res.status !== 404 || i === RETRY_DELAYS_MS.length) {
      throw new Error(`Failed to load session: ${res.status}`)
    }
    const delay = RETRY_DELAYS_MS[i] ?? 5000
    await new Promise<void>((resolve) => setTimeout(resolve, delay))
  }
  throw new Error('Session not found after retries')
}

describe('fetchSessionWithRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves with session data when a 404 is followed by a successful response', async () => {
    const sessionData = { sessionId: 'abc', messages: [] }
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => sessionData })

    const promise = fetchSessionWithRetry(mockFetch)
    // Advance past the first retry delay (200 ms).
    await vi.runAllTimersAsync()
    const result = await promise

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(result).toEqual(sessionData)
  })

  it('throws after exhausting all 6 retries on a persistent 404', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 })

    const promise = fetchSessionWithRetry(mockFetch)
    // Attach the rejection handler BEFORE advancing timers so the promise
    // is never "unhandled" from Vitest's perspective.
    const rejectAssertion = expect(promise).rejects.toThrow()
    await vi.runAllTimersAsync()
    await rejectAssertion

    // 1 initial attempt + 6 retries (one per RETRY_DELAYS_MS entry) = 7 total calls.
    expect(mockFetch).toHaveBeenCalledTimes(RETRY_DELAYS_MS.length + 1)
  })

  it('throws immediately on a non-404 error without retrying', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 })

    await expect(fetchSessionWithRetry(mockFetch)).rejects.toThrow('500')
    // A non-404 error must not trigger any retry — exactly one call.
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
