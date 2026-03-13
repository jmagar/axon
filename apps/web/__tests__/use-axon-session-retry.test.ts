import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchSessionWithRetry, RETRY_DELAYS_MS } from '@/hooks/use-axon-session'

describe('fetchSessionWithRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('resolves with session data when a 404 is followed by a successful response', async () => {
    const sessionData = { project: 'axon', filename: 'session-abc', sessionId: 'abc', messages: [] }
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 404 } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => sessionData } as Response)

    const promise = fetchSessionWithRetry('abc', () => false)
    // Advance past the first retry delay (200 ms).
    await vi.runAllTimersAsync()
    const result = await promise

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(result).toEqual(sessionData)
  })

  it('throws after exhausting all 6 retries on a persistent 404', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 404 } as Response)

    const promise = fetchSessionWithRetry('abc', () => false)
    // Attach the rejection handler BEFORE advancing timers so the promise
    // is never "unhandled" from Vitest's perspective.
    const rejectAssertion = expect(promise).rejects.toThrow()
    await vi.runAllTimersAsync()
    await rejectAssertion

    // 1 initial attempt + 6 retries (one per RETRY_DELAYS_MS entry) = 7 total calls.
    expect(fetch).toHaveBeenCalledTimes(RETRY_DELAYS_MS.length + 1)
  })

  it('throws immediately on a non-404 error without retrying', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500 } as Response)

    await expect(fetchSessionWithRetry('abc', () => false)).rejects.toThrow('500')
    // A non-404 error must not trigger any retry — exactly one call.
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('adds assistant_mode=1 when assistant mode is requested', async () => {
    const sessionData = {
      project: 'assistant',
      filename: 'session-abc',
      sessionId: 'abc',
      messages: [],
    }
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => sessionData,
    } as Response)

    const result = await fetchSessionWithRetry('abc', () => false, { assistantMode: true })

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('/api/sessions/abc?assistant_mode=1')
    expect(result).toEqual(sessionData)
  })
})
