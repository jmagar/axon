// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-fetch', () => ({
  apiFetch: vi.fn(async () => ({
    json: async () => ({
      ok: true,
      data: {
        health: {
          allOk: true,
          unhealthyServices: 0,
          staleJobs: 0,
          pendingJobs: 0,
          services: {},
          pipelines: {},
        },
        queue: { running: 2, pending: 1, failed: 0, completed: 10, total: 13 },
        corpus: {
          collection: 'cortex',
          status: 'green',
          vectors: 500,
          points: 500,
          domains: 1,
          sources: 1,
          topDomains: [{ domain: 'docs.rs', vectors: 220, urls: 20 }],
          topSources: [{ url: 'https://docs.rs', chunks: 220 }],
        },
        jobs: [],
      },
    }),
  })),
}))

import { MissionControlPane } from '@/components/cortex/mission-control-pane'

describe('MissionControlPane data wiring', () => {
  it('renders live kpis from overview payload', async () => {
    render(<MissionControlPane />)
    expect(await screen.findByText(/docs.rs/i)).toBeTruthy()
    expect(await screen.findByText(/^500$/i)).toBeTruthy()
  })
})
