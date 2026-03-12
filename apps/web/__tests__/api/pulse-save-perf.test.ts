import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetEnsuredCollections } from '@/app/api/pulse/save/route'

let afterPromise: Promise<void> | null = null

// Mock next/server to intercept after()
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return {
    ...actual,
    after: vi.fn((fn) => {
      afterPromise = Promise.resolve(fn())
    }),
  }
})

// Mock the storage layer to avoid FS ops
vi.mock('@/lib/pulse/storage', () => ({
  savePulseDoc: vi.fn().mockResolvedValue({
    filename: 'test-doc.md',
    path: '/fake/path',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tags: [],
    collections: ['cortex'],
  }),
  updatePulseDoc: vi.fn(),
}))

// Mock rate limiting and env loading
vi.mock('@/lib/server/rate-limit', () => ({
  enforceRateLimit: vi.fn().mockReturnValue(null),
}))
vi.mock('@/lib/pulse/server-env', () => ({
  ensureRepoRootEnvLoaded: vi.fn(),
}))

describe('POST /api/pulse/save performance and density infrastructure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetEnsuredCollections()
    // Default env for testing
    process.env.TEI_URL = 'http://tei:52000'
    process.env.QDRANT_URL = 'http://qdrant:6333'
    process.env.AXON_COLLECTION = 'cortex'
  })

  afterEach(() => {
    delete process.env.TEI_URL
    delete process.env.QDRANT_URL
  })

  it('caches ensured collections to avoid redundant Qdrant checks', async () => {
    const { POST } = await import('@/app/api/pulse/save/route')

    // Mock fetch for Qdrant collection check
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    // 1st call:
    // 1. TEI embed
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify([[0.1]]), { status: 200 }))
    // 2. Qdrant GET check (exists)
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
    // 3. Qdrant upsert
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ result: { status: 'acknowledged' } }), { status: 200 }),
    )

    const body = JSON.stringify({ title: 'Test', markdown: 'content', embed: true })
    const req1 = new Request('http://localhost/api/pulse/save', { method: 'POST', body })
    await POST(req1)
    await afterPromise

    // Verify GET was called
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/collections/cortex'),
      expect.anything(),
    )
    const firstCallCount = fetchSpy.mock.calls.length

    // 2nd call: Should SKIP the GET check for collection
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify([[0.2]]), { status: 200 })) // TEI embed
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ result: { status: 'acknowledged' } }), { status: 200 }),
    ) // Qdrant upsert

    const req2 = new Request('http://localhost/api/pulse/save', { method: 'POST', body })
    await POST(req2)
    await afterPromise

    // fetch count should only increase by 2 (embed + upsert), not 3 (no GET check)
    expect(fetchSpy.mock.calls.length).toBe(firstCallCount + 2)

    // Explicitly verify no new GET/PUT calls to collection root (ensureCollection)
    const collectionChecks = fetchSpy.mock.calls.filter((call) => {
      const url = typeof call[0] === 'string' ? call[0] : ''
      return (
        url.includes('/collections/cortex') && !url.includes('/points') && !url.includes('/delete')
      )
    })
    expect(collectionChecks).toHaveLength(1)
  })

  it('offloads embedding to after() allowing immediate response', async () => {
    const { after } = await import('next/server')
    const { POST } = await import('@/app/api/pulse/save/route')

    const body = JSON.stringify({ title: 'Test', markdown: 'content', embed: true })
    const req = new Request('http://localhost/api/pulse/save', { method: 'POST', body })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(after).toHaveBeenCalled()
  })
})
