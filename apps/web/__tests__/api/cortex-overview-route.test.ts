import { beforeEach, describe, expect, it, vi } from 'vitest'

const wsMock = vi.fn()
const queryMock = vi.fn()

describe('GET /api/cortex/overview', () => {
  beforeEach(() => {
    vi.resetModules()
    wsMock.mockReset()
    queryMock.mockReset()

    vi.doMock('@/lib/axon-ws-exec', () => ({
      runAxonCommandWs: wsMock,
    }))

    vi.doMock('@/lib/server/pg-pool', () => ({
      getJobsPgPool: () => ({ query: queryMock }),
    }))
  })

  it('returns unified payload with health, queue, corpus, and jobs slices', async () => {
    wsMock.mockImplementation(async (mode: string) => {
      if (mode === 'status') {
        return {
          local_crawl_jobs: [{ id: 'c1', status: 'running' }],
          local_extract_jobs: [],
          local_embed_jobs: [],
          local_ingest_jobs: [],
        }
      }
      if (mode === 'doctor') {
        return {
          services: { qdrant: { ok: true } },
          pipelines: { crawl: true },
          queue_names: {},
          stale_jobs: 0,
          pending_jobs: 1,
          all_ok: true,
        }
      }
      if (mode === 'stats') {
        return {
          collection: 'cortex',
          status: 'green',
          indexed_vectors_count: 100,
          points_count: 100,
          dimension: 384,
          distance: 'Cosine',
          segments_count: 1,
          docs_embedded_estimate: 10,
          avg_chunks_per_doc: 10,
          payload_fields: ['url'],
          counts: {},
        }
      }
      if (mode === 'domains') {
        return { domains: [{ domain: 'docs.rs', vectors: 33, urls: 7 }], limit: 100, offset: 0 }
      }
      return { count: 1, limit: 100, offset: 0, urls: [{ url: 'https://docs.rs', chunks: 33 }] }
    })

    queryMock.mockResolvedValue({
      rows: [
        {
          id: 'j1',
          type: 'crawl',
          target: 'https://docs.rs',
          status: 'running',
          created_at: new Date('2026-03-12T12:00:00.000Z'),
          started_at: null,
          finished_at: null,
        },
      ],
    })

    const mod = await import('@/app/api/cortex/overview/route')
    const res = await mod.GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data).toHaveProperty('health')
    expect(body.data).toHaveProperty('queue')
    expect(body.data).toHaveProperty('corpus')
    expect(body.data).toHaveProperty('jobs')
  })
})
