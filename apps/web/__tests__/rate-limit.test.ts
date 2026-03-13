/**
 * Security tests for the in-process rate limiter.
 *
 * The rate limiter is a security control. Every branch — IP resolution, counter
 * accumulation, window expiry, and the MAX_COUNTER_KEYS cap — has observable
 * effects that must be tested. A regression here can mean either DOS (bad
 * actors bypass the cap) or lockout (legitimate users rejected).
 *
 * Design notes from reading rate-limit.ts:
 *
 * 1. `counters` and `lastEvictAt` are module-level state — they persist across
 *    tests within the same vitest worker. `vi.useFakeTimers()` controls
 *    `Date.now()` but does NOT reset module variables.
 *
 * 2. `getClientIp()` falls back to `'unknown'` (not a socket IP) when neither
 *    `x-forwarded-for` nor `x-real-ip` is present. The Web API `Request` has
 *    no socket/connection concept.
 *
 * 3. MAX_COUNTER_KEYS cap: when the map is full and a *new* key arrives,
 *    `increment()` returns `{ count: limit.max + 1 }` without inserting —
 *    blocking the new IP immediately (spoofed-IP flood defense).
 *
 * Fake-timer strategy:
 * - `vi.useFakeTimers()` is called ONCE in `beforeAll` and `vi.useRealTimers()`
 *   in `afterAll`. This keeps a single, monotonically advancing fake clock
 *   across all tests in this file.
 * - Each test's `afterEach` drain advances time by DRAIN_ADVANCE_MS. Because
 *   time is never reset, each drain runs at a strictly higher timestamp than
 *   the previous drain. The `evictExpired` guard (`now - lastEvictAt >= 60 000`)
 *   is always satisfied as long as DRAIN_ADVANCE_MS > EVICT_INTERVAL_MS (60 s).
 * - We use DRAIN_ADVANCE_MS = 120 000 (2 min), which also exceeds the maximum
 *   windowMs used in any test (120 000 ms), ensuring all counters expire.
 * - All tests use unique `scope` strings to avoid cross-test counter pollution.
 * - `window`-expiry tests advance time explicitly within the test body; the
 *   final drain accumulates on top.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { enforceRateLimit } from '@/lib/server/rate-limit'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * How far to advance fake time in each afterEach drain.
 * Must be > EVICT_INTERVAL_MS (60 000) so eviction fires on every drain.
 * Must be >= the largest windowMs used in any test (120 000).
 */
const DRAIN_ADVANCE_MS = 120_001

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Web API Request with the given headers. */
function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/', { headers })
}

/**
 * Drain the module-level `counters` Map.
 *
 * Advances fake `Date.now()` by DRAIN_ADVANCE_MS — always more than
 * EVICT_INTERVAL_MS (60 s) and more than the maximum windowMs in any test
 * (120 000 ms). The subsequent `enforceRateLimit` call triggers `evictExpired`,
 * deleting all counters whose window has passed.
 */
function drainCounters(): void {
  vi.advanceTimersByTime(DRAIN_ADVANCE_MS)
  enforceRateLimit(
    `_drain_${Date.now()}`,
    makeRequest({ 'x-forwarded-for': `drain-${Math.random()}` }),
    { max: 1, windowMs: 1_000 },
  )
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(() => {
  vi.useFakeTimers()
})

afterAll(() => {
  vi.useRealTimers()
})

afterEach(() => {
  drainCounters()
})

// ---------------------------------------------------------------------------
// Core behavior — pass / block / reset
// ---------------------------------------------------------------------------

describe('enforceRateLimit — core behavior', () => {
  it('returns null (pass) when count is under the limit', () => {
    const req = makeRequest({ 'x-forwarded-for': '10.0.0.1' })
    const result = enforceRateLimit('core-1', req, { max: 5, windowMs: 10_000 })
    expect(result).toBeNull()
  })

  it('returns null on the exact limit boundary (count === max)', () => {
    const ip = '10.0.1.1'
    const limit = { max: 3, windowMs: 10_000 }
    const req = () => makeRequest({ 'x-forwarded-for': ip })

    enforceRateLimit('core-2', req(), limit) // count 1
    enforceRateLimit('core-2', req(), limit) // count 2
    const result = enforceRateLimit('core-2', req(), limit) // count 3 === max
    expect(result).toBeNull()
  })

  it('returns a NextResponse with status 429 when limit is exceeded', () => {
    const ip = '10.0.2.1'
    const limit = { max: 2, windowMs: 10_000 }
    const req = () => makeRequest({ 'x-forwarded-for': ip })

    enforceRateLimit('core-3', req(), limit) // 1
    enforceRateLimit('core-3', req(), limit) // 2 — at limit
    const result = enforceRateLimit('core-3', req(), limit) // 3 — over limit

    expect(result).not.toBeNull()
    expect(result!.status).toBe(429)
  })

  it('429 response body contains expected error fields', async () => {
    const ip = '10.0.3.1'
    const limit = { max: 1, windowMs: 10_000 }
    const req = () => makeRequest({ 'x-forwarded-for': ip })

    enforceRateLimit('core-4', req(), limit) // at limit
    const response = enforceRateLimit('core-4', req(), limit) // over limit

    expect(response).not.toBeNull()
    const body = await response!.json()
    expect(body.error).toBe('Rate limit exceeded')
    expect(body.code).toBe('RATE_LIMIT_EXCEEDED')
    expect(typeof body.detail).toBe('string')
    expect(body.detail).toMatch(/Retry in \d+s/)
  })

  it('429 response includes Retry-After header with a positive integer', () => {
    const ip = '10.0.4.1'
    const limit = { max: 1, windowMs: 30_000 }
    const req = () => makeRequest({ 'x-forwarded-for': ip })

    enforceRateLimit('core-5', req(), limit) // at limit
    const response = enforceRateLimit('core-5', req(), limit) // over

    const retryAfter = response!.headers.get('Retry-After')
    expect(retryAfter).not.toBeNull()
    const seconds = Number(retryAfter)
    expect(Number.isInteger(seconds)).toBe(true)
    expect(seconds).toBeGreaterThanOrEqual(1)
  })

  it('counter resets after the window expires, allowing requests again', () => {
    const ip = '10.0.5.1'
    const windowMs = 5_000
    const limit = { max: 1, windowMs }
    const req = () => makeRequest({ 'x-forwarded-for': ip })

    enforceRateLimit('core-6', req(), limit) // count 1 — at limit
    const blocked = enforceRateLimit('core-6', req(), limit) // count 2 — blocked
    expect(blocked).not.toBeNull()
    expect(blocked!.status).toBe(429)

    // Advance past the window — counter should reset.
    vi.advanceTimersByTime(windowMs + 1)

    const afterReset = enforceRateLimit('core-6', req(), limit) // new window, count 1
    expect(afterReset).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// IP resolution
// ---------------------------------------------------------------------------

describe('enforceRateLimit — IP resolution', () => {
  it('uses x-forwarded-for header when present', () => {
    const limit = { max: 1, windowMs: 10_000 }

    // First request exhausts the limit for this IP.
    enforceRateLimit('ip-1', makeRequest({ 'x-forwarded-for': '1.2.3.4' }), limit)
    // Second from the same IP is blocked.
    const blocked = enforceRateLimit('ip-1', makeRequest({ 'x-forwarded-for': '1.2.3.4' }), limit)
    expect(blocked).not.toBeNull()
    expect(blocked!.status).toBe(429)

    // Different IP via x-forwarded-for is unaffected.
    const other = enforceRateLimit('ip-1', makeRequest({ 'x-forwarded-for': '5.6.7.8' }), limit)
    expect(other).toBeNull()
  })

  it('uses only the first IP in a comma-separated x-forwarded-for list', () => {
    const limit = { max: 1, windowMs: 10_000 }

    enforceRateLimit('ip-2', makeRequest({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3' }), limit)
    // Second call with the same leading IP should be blocked.
    const blocked = enforceRateLimit(
      'ip-2',
      makeRequest({ 'x-forwarded-for': '1.1.1.1, 9.9.9.9' }),
      limit,
    )
    expect(blocked).not.toBeNull()
    expect(blocked!.status).toBe(429)
  })

  it('uses x-real-ip when x-forwarded-for is absent', () => {
    const limit = { max: 1, windowMs: 10_000 }

    enforceRateLimit('ip-3', makeRequest({ 'x-real-ip': '9.9.9.9' }), limit)
    const blocked = enforceRateLimit('ip-3', makeRequest({ 'x-real-ip': '9.9.9.9' }), limit)
    expect(blocked).not.toBeNull()
    expect(blocked!.status).toBe(429)
  })

  it('x-forwarded-for takes precedence over x-real-ip', () => {
    const limit = { max: 1, windowMs: 10_000 }

    // Exhaust the limit keyed to the x-forwarded-for IP.
    enforceRateLimit(
      'ip-4',
      makeRequest({ 'x-forwarded-for': 'xff-ip', 'x-real-ip': 'real-ip' }),
      limit,
    )
    // Same x-forwarded-for IP → blocked.
    const blocked = enforceRateLimit(
      'ip-4',
      makeRequest({ 'x-forwarded-for': 'xff-ip', 'x-real-ip': 'different-real-ip' }),
      limit,
    )
    expect(blocked).not.toBeNull()

    // Same x-real-ip but different x-forwarded-for → NOT blocked (separate counter).
    const notBlocked = enforceRateLimit(
      'ip-4',
      makeRequest({ 'x-forwarded-for': 'other-xff-ip', 'x-real-ip': 'real-ip' }),
      limit,
    )
    expect(notBlocked).toBeNull()
  })

  it('falls back to "unknown" key when no IP headers are present', () => {
    const limit = { max: 1, windowMs: 10_000 }
    // Two requests with no IP headers — both map to key `scope:unknown`.
    enforceRateLimit('ip-5', makeRequest(), limit)
    const blocked = enforceRateLimit('ip-5', makeRequest(), limit)
    expect(blocked).not.toBeNull()
    expect(blocked!.status).toBe(429)
  })

  it('different IPs get independent counters', () => {
    const limit = { max: 1, windowMs: 10_000 }

    enforceRateLimit('ip-6', makeRequest({ 'x-forwarded-for': 'ip-alpha' }), limit)
    enforceRateLimit('ip-6', makeRequest({ 'x-forwarded-for': 'ip-beta' }), limit)
    enforceRateLimit('ip-6', makeRequest({ 'x-forwarded-for': 'ip-gamma' }), limit)

    // All three used one slot each — none are blocked yet.
    const alphaBlocked = enforceRateLimit(
      'ip-6',
      makeRequest({ 'x-forwarded-for': 'ip-alpha' }),
      limit,
    )
    const betaBlocked = enforceRateLimit(
      'ip-6',
      makeRequest({ 'x-forwarded-for': 'ip-beta' }),
      limit,
    )
    const gammaPass = enforceRateLimit(
      'ip-6',
      makeRequest({ 'x-forwarded-for': 'ip-delta' }), // fresh IP — not seen before
      limit,
    )

    expect(alphaBlocked!.status).toBe(429)
    expect(betaBlocked!.status).toBe(429)
    expect(gammaPass).toBeNull()
  })

  it('scope prefix isolates counters — same IP, different scope = separate limits', () => {
    const limit = { max: 1, windowMs: 10_000 }
    const req = makeRequest({ 'x-forwarded-for': '4.4.4.4' })

    enforceRateLimit('ip-7a', req, limit)
    const blockedA = enforceRateLimit('ip-7a', req, limit) // over in scope-a
    const passB = enforceRateLimit('ip-7b', req, limit) // fresh in scope-b

    expect(blockedA!.status).toBe(429)
    expect(passB).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Window behavior
// ---------------------------------------------------------------------------

describe('enforceRateLimit — window behavior', () => {
  it('requests within the same window accumulate toward the limit', () => {
    const ip = '20.0.0.1'
    const limit = { max: 4, windowMs: 10_000 }
    const req = () => makeRequest({ 'x-forwarded-for': ip })

    expect(enforceRateLimit('win-1', req(), limit)).toBeNull() // 1
    expect(enforceRateLimit('win-1', req(), limit)).toBeNull() // 2
    expect(enforceRateLimit('win-1', req(), limit)).toBeNull() // 3
    expect(enforceRateLimit('win-1', req(), limit)).toBeNull() // 4 — at limit
    expect(enforceRateLimit('win-1', req(), limit)!.status).toBe(429) // 5 — over
  })

  it('time advancing mid-window does not reset the counter before expiry', () => {
    const ip = '20.0.1.1'
    const windowMs = 10_000
    const limit = { max: 2, windowMs }
    const req = () => makeRequest({ 'x-forwarded-for': ip })

    enforceRateLimit('win-2', req(), limit) // count 1
    vi.advanceTimersByTime(windowMs - 1) // just before expiry — still same window
    enforceRateLimit('win-2', req(), limit) // count 2 — still same window
    const blocked = enforceRateLimit('win-2', req(), limit) // count 3 — blocked
    expect(blocked!.status).toBe(429)
  })

  it('counter for each IP resets independently after its own window', () => {
    const windowMs = 5_000
    const limit = { max: 1, windowMs }

    const req1 = () => makeRequest({ 'x-forwarded-for': '20.0.2.1' })
    const req2 = () => makeRequest({ 'x-forwarded-for': '20.0.2.2' })

    // Both IPs exhaust their first window.
    enforceRateLimit('win-3', req1(), limit)
    vi.advanceTimersByTime(3_000)
    enforceRateLimit('win-3', req2(), limit) // req2 window starts 3 s after req1

    // Advance past req1's window (total: 6s > 5s) but not req2's (req2 at 3s of 5s).
    vi.advanceTimersByTime(3_000)

    const req1Reset = enforceRateLimit('win-3', req1(), limit) // req1 window expired
    expect(req1Reset).toBeNull()

    const req2Blocked = enforceRateLimit('win-3', req2(), limit) // req2 still in window
    expect(req2Blocked!.status).toBe(429)
  })
})

// ---------------------------------------------------------------------------
// MAX_COUNTER_KEYS cap — counter exhaustion / IP flood defense
//
// These tests fill the module-level `counters` Map to its 10 000-entry limit.
// Because `beforeAll`/`afterAll` manage the fake timer lifecycle (not
// beforeEach/afterEach), the monotonically advancing fake clock guarantees
// that each afterEach drain sees `now - lastEvictAt >= DRAIN_ADVANCE_MS > 60 000`
// and successfully evicts all expired entries.
//
// windowMs: 120 000 ensures fill entries outlast the test body but expire on
// the next drain (drain advances by DRAIN_ADVANCE_MS = 120 001 > 120 000).
// ---------------------------------------------------------------------------

describe('enforceRateLimit — MAX_COUNTER_KEYS cap', () => {
  const MAX_COUNTER_KEYS = 10_000

  it('new IP beyond MAX_COUNTER_KEYS limit is immediately rate-limited', () => {
    const windowMs = 120_000
    const limit = { max: 100, windowMs }
    const scope = 'cap-1'

    for (let i = 0; i < MAX_COUNTER_KEYS; i++) {
      enforceRateLimit(scope, makeRequest({ 'x-forwarded-for': `c1-fill-${i}` }), limit)
    }

    const result = enforceRateLimit(scope, makeRequest({ 'x-forwarded-for': 'c1-new-ip' }), limit)
    expect(result).not.toBeNull()
    expect(result!.status).toBe(429)
  })

  it('existing IP is still tracked correctly when map is at capacity', () => {
    /**
     * Proof of correctness:
     * - `knownIp` is seeded first, when the map has room. It gets a slot.
     * - The fill loop brings the map to capacity. Additional fill IPs beyond
     *   capacity are rejected without insertion.
     * - Because `knownIp` already has an `existing` entry in the map, the
     *   capacity check (`!existing && size >= MAX_COUNTER_KEYS`) is bypassed
     *   on subsequent calls — it increments normally.
     */
    const windowMs = 120_000
    const knownIp = 'c2-known-ip'
    const limit = { max: 5, windowMs }
    const scope = 'cap-2'

    // Seed the known IP first — it gets a slot in the map.
    const seedResult = enforceRateLimit(scope, makeRequest({ 'x-forwarded-for': knownIp }), limit)
    expect(seedResult).toBeNull() // count=1, under limit

    // Fill remaining capacity. The map will reach MAX_COUNTER_KEYS; subsequent
    // fill IPs are rejected without insertion.
    for (let i = 0; i < MAX_COUNTER_KEYS - 1; i++) {
      enforceRateLimit(scope, makeRequest({ 'x-forwarded-for': `c2-fill-${i}` }), limit)
    }

    // The known IP has an existing entry — increments should continue normally.
    for (let count = 2; count <= limit.max; count++) {
      const res = enforceRateLimit(scope, makeRequest({ 'x-forwarded-for': knownIp }), limit)
      expect(res).toBeNull() // count is still within max=5
    }

    // One more request from the known IP exceeds the limit.
    const blocked = enforceRateLimit(scope, makeRequest({ 'x-forwarded-for': knownIp }), limit)
    expect(blocked).not.toBeNull()
    expect(blocked!.status).toBe(429)
  })

  it('new IP is rejected without being inserted when map is at capacity', () => {
    /**
     * Behavioral proof that the new key is NOT inserted:
     * If insertion happened (count=1), a max:50 limit would return null.
     * Instead the implementation returns { count: limit.max + 1 } — the call
     * is blocked on the very first request. Getting 429 with max=50 proves
     * no insertion occurred.
     */
    const windowMs = 120_000
    const limit = { max: 50, windowMs }
    const scope = 'cap-3'

    for (let i = 0; i < MAX_COUNTER_KEYS; i++) {
      enforceRateLimit(scope, makeRequest({ 'x-forwarded-for': `c3-fill-${i}` }), limit)
    }

    const result = enforceRateLimit(
      scope,
      makeRequest({ 'x-forwarded-for': 'c3-not-inserted-ip' }),
      limit,
    )
    expect(result).not.toBeNull()
    expect(result!.status).toBe(429)
  })
})
