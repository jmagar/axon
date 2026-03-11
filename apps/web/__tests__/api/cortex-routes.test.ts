/**
 * Tests for /api/cortex/* route handlers.
 *
 * All six routes delegate to runAxonCommandWs from @/lib/axon-ws-exec.
 * We mock that module so tests are deterministic and require no live WS bridge.
 *
 * Routes covered:
 *   GET /api/cortex/doctor   → runAxonCommandWs('doctor', 30_000)
 *   GET /api/cortex/domains  → runAxonCommandWs('domains', 60_000)
 *   GET /api/cortex/sources  → runAxonCommandWs('sources', 60_000)
 *   GET /api/cortex/stats    → runAxonCommandWs('stats', 30_000)
 *   GET /api/cortex/status   → runAxonCommandWs('status', 30_000)
 *   GET /api/cortex/suggest  → runAxonCommandWs('suggest', 60_000, focus)
 */

import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Shared mock for the WS execution bridge
// ---------------------------------------------------------------------------

const runAxonCommandWsMock = vi.fn<
  (mode: string, timeoutMs: number, focus?: string) => Promise<unknown>
>()

vi.mock('@/lib/axon-ws-exec', () => ({
  runAxonCommandWs: (mode: string, timeoutMs: number, focus?: string) =>
    runAxonCommandWsMock(mode, timeoutMs, focus),
  runAxonCommandWsStream: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(url: string): NextRequest {
  return new NextRequest(url)
}

// Response type helpers
interface OkBody {
  ok: boolean
  data: unknown
}

interface ErrorBody {
  error: string
  code?: string
}

// ---------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------

describe('GET /api/cortex/doctor', () => {
  beforeEach(() => {
    runAxonCommandWsMock.mockReset()
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('returns ok:true with data on success', async () => {
    const payload = {
      postgres: 'ok',
      redis: 'ok',
      qdrant: 'ok',
      tei: 'ok',
      rabbitmq: 'ok',
    }
    runAxonCommandWsMock.mockResolvedValueOnce(payload)

    const { GET } = await import('@/app/api/cortex/doctor/route')
    const res = await GET()

    expect(res.status).toBe(200)
    const body = (await res.json()) as OkBody
    expect(body.ok).toBe(true)
    expect(body.data).toEqual(payload)
  })

  it('calls runAxonCommandWs with correct mode and timeout', async () => {
    runAxonCommandWsMock.mockResolvedValueOnce({ postgres: 'ok' })

    const { GET } = await import('@/app/api/cortex/doctor/route')
    await GET()

    expect(runAxonCommandWsMock).toHaveBeenCalledWith('doctor', 30_000)
  })

  it('returns 500 with error envelope when runAxonCommandWs throws', async () => {
    runAxonCommandWsMock.mockRejectedValueOnce(new Error('connection refused'))

    const { GET } = await import('@/app/api/cortex/doctor/route')
    const res = await GET()

    expect(res.status).toBe(500)
    const body = (await res.json()) as ErrorBody
    expect(body.error).toBeTruthy()
    expect(body.code).toBe('cortex_doctor')
  })

  it('returns 500 when runAxonCommandWs rejects with a timeout error', async () => {
    runAxonCommandWsMock.mockRejectedValueOnce(
      new Error('Timeout waiting for axon doctor (30000ms)'),
    )

    const { GET } = await import('@/app/api/cortex/doctor/route')
    const res = await GET()

    expect(res.status).toBe(500)
    const body = (await res.json()) as ErrorBody
    expect(body.code).toBe('cortex_doctor')
  })
})

// ---------------------------------------------------------------------------
// domains
// ---------------------------------------------------------------------------

describe('GET /api/cortex/domains', () => {
  beforeEach(() => {
    runAxonCommandWsMock.mockReset()
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('returns ok:true with domain list on success', async () => {
    const payload = [
      { domain: 'docs.rust-lang.org', count: 42 },
      { domain: 'vitest.dev', count: 18 },
    ]
    runAxonCommandWsMock.mockResolvedValueOnce(payload)

    const { GET } = await import('@/app/api/cortex/domains/route')
    const res = await GET()

    expect(res.status).toBe(200)
    const body = (await res.json()) as OkBody
    expect(body.ok).toBe(true)
    expect(body.data).toEqual(payload)
  })

  it('calls runAxonCommandWs with correct mode and timeout', async () => {
    runAxonCommandWsMock.mockResolvedValueOnce([])

    const { GET } = await import('@/app/api/cortex/domains/route')
    await GET()

    expect(runAxonCommandWsMock).toHaveBeenCalledWith('domains', 60_000)
  })

  it('returns 500 with error envelope when runAxonCommandWs throws', async () => {
    runAxonCommandWsMock.mockRejectedValueOnce(new Error('WebSocket connection error'))

    const { GET } = await import('@/app/api/cortex/domains/route')
    const res = await GET()

    expect(res.status).toBe(500)
    const body = (await res.json()) as ErrorBody
    expect(body.error).toBeTruthy()
    expect(body.code).toBe('cortex_domains')
  })

  it('propagates empty domain list without error', async () => {
    runAxonCommandWsMock.mockResolvedValueOnce([])

    const { GET } = await import('@/app/api/cortex/domains/route')
    const res = await GET()

    expect(res.status).toBe(200)
    const body = (await res.json()) as OkBody
    expect(body.ok).toBe(true)
    expect(body.data).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// sources
// ---------------------------------------------------------------------------

describe('GET /api/cortex/sources', () => {
  beforeEach(() => {
    runAxonCommandWsMock.mockReset()
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('returns ok:true with sources list on success', async () => {
    const payload = [
      { url: 'https://docs.rust-lang.org/book/', chunks: 312 },
      { url: 'https://vitest.dev/guide/', chunks: 57 },
    ]
    runAxonCommandWsMock.mockResolvedValueOnce(payload)

    const { GET } = await import('@/app/api/cortex/sources/route')
    const res = await GET()

    expect(res.status).toBe(200)
    const body = (await res.json()) as OkBody
    expect(body.ok).toBe(true)
    expect(body.data).toEqual(payload)
  })

  it('calls runAxonCommandWs with correct mode and timeout', async () => {
    runAxonCommandWsMock.mockResolvedValueOnce([])

    const { GET } = await import('@/app/api/cortex/sources/route')
    await GET()

    expect(runAxonCommandWsMock).toHaveBeenCalledWith('sources', 60_000)
  })

  it('returns 500 with error envelope when runAxonCommandWs throws', async () => {
    runAxonCommandWsMock.mockRejectedValueOnce(new Error('axon sources failed'))

    const { GET } = await import('@/app/api/cortex/sources/route')
    const res = await GET()

    expect(res.status).toBe(500)
    const body = (await res.json()) as ErrorBody
    expect(body.error).toBeTruthy()
    expect(body.code).toBe('cortex_sources')
  })

  it('handles null data from upstream without throwing', async () => {
    runAxonCommandWsMock.mockResolvedValueOnce(null)

    const { GET } = await import('@/app/api/cortex/sources/route')
    const res = await GET()

    expect(res.status).toBe(200)
    const body = (await res.json()) as OkBody
    expect(body.ok).toBe(true)
    expect(body.data).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// stats
// ---------------------------------------------------------------------------

describe('GET /api/cortex/stats', () => {
  beforeEach(() => {
    runAxonCommandWsMock.mockReset()
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('returns ok:true with stats payload on success', async () => {
    const payload = {
      collection: 'cortex',
      points: 2_570_000,
      segments: 4,
      postgres_jobs: { crawl: 12, embed: 3 },
    }
    runAxonCommandWsMock.mockResolvedValueOnce(payload)

    const { GET } = await import('@/app/api/cortex/stats/route')
    const res = await GET()

    expect(res.status).toBe(200)
    const body = (await res.json()) as OkBody
    expect(body.ok).toBe(true)
    expect(body.data).toEqual(payload)
  })

  it('calls runAxonCommandWs with correct mode and timeout', async () => {
    runAxonCommandWsMock.mockResolvedValueOnce({ collection: 'cortex', points: 0 })

    const { GET } = await import('@/app/api/cortex/stats/route')
    await GET()

    expect(runAxonCommandWsMock).toHaveBeenCalledWith('stats', 30_000)
  })

  it('returns 500 with error envelope when runAxonCommandWs throws', async () => {
    runAxonCommandWsMock.mockRejectedValueOnce(new Error('Qdrant unreachable'))

    const { GET } = await import('@/app/api/cortex/stats/route')
    const res = await GET()

    expect(res.status).toBe(500)
    const body = (await res.json()) as ErrorBody
    expect(body.error).toBeTruthy()
    expect(body.code).toBe('cortex_stats')
  })

  it('returns 500 when command errors out (non-throw rejection path)', async () => {
    runAxonCommandWsMock.mockRejectedValueOnce(
      new Error('WebSocket closed unexpectedly (code 1006)'),
    )

    const { GET } = await import('@/app/api/cortex/stats/route')
    const res = await GET()

    expect(res.status).toBe(500)
    const body = (await res.json()) as ErrorBody
    expect(body.code).toBe('cortex_stats')
  })
})

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

describe('GET /api/cortex/status', () => {
  beforeEach(() => {
    runAxonCommandWsMock.mockReset()
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('returns ok:true with job queue status on success', async () => {
    const payload = {
      crawl: { pending: 2, running: 1 },
      embed: { pending: 0, running: 0 },
      extract: { pending: 1, running: 0 },
    }
    runAxonCommandWsMock.mockResolvedValueOnce(payload)

    const { GET } = await import('@/app/api/cortex/status/route')
    const res = await GET()

    expect(res.status).toBe(200)
    const body = (await res.json()) as OkBody
    expect(body.ok).toBe(true)
    expect(body.data).toEqual(payload)
  })

  it('calls runAxonCommandWs with correct mode and timeout', async () => {
    runAxonCommandWsMock.mockResolvedValueOnce({ crawl: { pending: 0, running: 0 } })

    const { GET } = await import('@/app/api/cortex/status/route')
    await GET()

    expect(runAxonCommandWsMock).toHaveBeenCalledWith('status', 30_000)
  })

  it('returns 500 with error envelope when runAxonCommandWs throws', async () => {
    runAxonCommandWsMock.mockRejectedValueOnce(new Error('RabbitMQ unavailable'))

    const { GET } = await import('@/app/api/cortex/status/route')
    const res = await GET()

    expect(res.status).toBe(500)
    const body = (await res.json()) as ErrorBody
    expect(body.error).toBeTruthy()
    expect(body.code).toBe('cortex_status')
  })

  it('handles empty status object from upstream', async () => {
    runAxonCommandWsMock.mockResolvedValueOnce({})

    const { GET } = await import('@/app/api/cortex/status/route')
    const res = await GET()

    expect(res.status).toBe(200)
    const body = (await res.json()) as OkBody
    expect(body.ok).toBe(true)
    expect(body.data).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// suggest
// ---------------------------------------------------------------------------

describe('GET /api/cortex/suggest', () => {
  beforeEach(() => {
    runAxonCommandWsMock.mockReset()
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('returns ok:true with suggestions on success (no query param)', async () => {
    const payload = ['https://docs.rust-lang.org/std/', 'https://vitest.dev/advanced/']
    runAxonCommandWsMock.mockResolvedValueOnce(payload)

    const { GET } = await import('@/app/api/cortex/suggest/route')
    const req = makeRequest('http://localhost/api/cortex/suggest')
    const res = await GET(req)

    expect(res.status).toBe(200)
    const body = (await res.json()) as OkBody
    expect(body.ok).toBe(true)
    expect(body.data).toEqual(payload)
  })

  it('passes empty string as focus when no ?q= param is provided', async () => {
    runAxonCommandWsMock.mockResolvedValueOnce([])

    const { GET } = await import('@/app/api/cortex/suggest/route')
    const req = makeRequest('http://localhost/api/cortex/suggest')
    await GET(req)

    expect(runAxonCommandWsMock).toHaveBeenCalledWith('suggest', 60_000, '')
  })

  it('passes trimmed ?q= value as focus when provided', async () => {
    runAxonCommandWsMock.mockResolvedValueOnce(['https://example.com/rust-async'])

    const { GET } = await import('@/app/api/cortex/suggest/route')
    const req = makeRequest('http://localhost/api/cortex/suggest?q=rust+async')
    await GET(req)

    expect(runAxonCommandWsMock).toHaveBeenCalledWith('suggest', 60_000, 'rust async')
  })

  it('trims whitespace from ?q= value before passing to runAxonCommandWs', async () => {
    runAxonCommandWsMock.mockResolvedValueOnce([])

    const { GET } = await import('@/app/api/cortex/suggest/route')
    const req = makeRequest('http://localhost/api/cortex/suggest?q=+tokio+async+')
    await GET(req)

    // URL-decoded '+' → space, then .trim() strips leading/trailing spaces
    const call = runAxonCommandWsMock.mock.calls[0]
    expect(call?.[0]).toBe('suggest')
    expect(call?.[1]).toBe(60_000)
    // The focus should be trimmed
    expect(typeof call?.[2]).toBe('string')
    const focus = call?.[2] as string
    expect(focus).toBe(focus.trim())
  })

  it('calls runAxonCommandWs with correct mode and timeout', async () => {
    runAxonCommandWsMock.mockResolvedValueOnce([])

    const { GET } = await import('@/app/api/cortex/suggest/route')
    const req = makeRequest('http://localhost/api/cortex/suggest')
    await GET(req)

    expect(runAxonCommandWsMock).toHaveBeenCalledWith('suggest', 60_000, '')
  })

  it('returns 500 with error envelope when runAxonCommandWs throws', async () => {
    runAxonCommandWsMock.mockRejectedValueOnce(new Error('suggest command timed out'))

    const { GET } = await import('@/app/api/cortex/suggest/route')
    const req = makeRequest('http://localhost/api/cortex/suggest?q=async')
    const res = await GET(req)

    expect(res.status).toBe(500)
    const body = (await res.json()) as ErrorBody
    expect(body.error).toBeTruthy()
    expect(body.code).toBe('cortex_suggest')
  })

  it('returns suggestions filtered by focus query when ?q= is set', async () => {
    const payload = ['https://tokio.rs/tokio/tutorial/async']
    runAxonCommandWsMock.mockResolvedValueOnce(payload)

    const { GET } = await import('@/app/api/cortex/suggest/route')
    const req = makeRequest('http://localhost/api/cortex/suggest?q=tokio')
    const res = await GET(req)

    expect(res.status).toBe(200)
    const body = (await res.json()) as OkBody
    expect(body.ok).toBe(true)
    expect(body.data).toEqual(payload)
    expect(runAxonCommandWsMock).toHaveBeenCalledWith('suggest', 60_000, 'tokio')
  })
})
