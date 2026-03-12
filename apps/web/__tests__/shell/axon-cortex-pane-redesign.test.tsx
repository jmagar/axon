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
        queue: { running: 0, pending: 0, failed: 0, completed: 0, total: 0 },
        corpus: {
          collection: 'cortex',
          status: 'green',
          vectors: 0,
          points: 0,
          domains: 0,
          sources: 0,
          topDomains: [],
          topSources: [],
        },
        jobs: [],
      },
    }),
  })),
}))

import { AxonCortexPane } from '@/components/shell/axon-cortex-pane'

describe('AxonCortexPane redesign', () => {
  it('renders mission control and no legacy tab bar', async () => {
    render(<AxonCortexPane />)
    expect(screen.getByText(/Mission Control/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Status/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Doctor/i })).toBeNull()
  })
})
