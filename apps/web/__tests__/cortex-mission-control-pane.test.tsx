// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const { mockApiFetch } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(async (input: string | URL | Request) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

    if (url.includes('/api/cortex/doctor')) {
      return {
        json: async () => ({
          ok: true,
          data: {
            services: {},
            pipelines: {},
            queue_names: {},
            stale_jobs: 0,
            pending_jobs: 0,
            all_ok: true,
          },
        }),
      }
    }

    if (url.includes('/api/cortex/sources')) {
      return {
        json: async () => ({
          ok: true,
          data: {
            count: 1,
            limit: 1,
            offset: 0,
            urls: [{ url: 'https://docs.rs', chunks: 1 }],
          },
        }),
      }
    }

    return {
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
          queue: { running: 0, pending: 0, completed: 1, failed: 0, total: 1 },
          corpus: {
            collection: 'cortex',
            status: 'green',
            vectors: 1,
            points: 1,
            domains: 1,
            sources: 1,
            topDomains: [{ domain: 'docs.rs', vectors: 1, urls: 1 }],
            topSources: [{ url: 'https://docs.rs', chunks: 1 }],
          },
          jobs: [],
        },
      }),
    }
  }),
}))

vi.mock('@/lib/api-fetch', () => ({
  apiFetch: mockApiFetch,
}))

import { MissionControlPane } from '@/components/cortex/mission-control-pane'

describe('MissionControlPane', () => {
  it('renders core sections', async () => {
    render(<MissionControlPane />)
    expect(screen.getByText(/Mission Control/i)).toBeTruthy()
    expect(await screen.findByText(/System Health/i)).toBeTruthy()
    expect(screen.getAllByText(/Queue Pressure/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/Corpus Map/i)).toBeTruthy()
  })

  it('matches mission-control desktop shell class contract', async () => {
    const { container } = render(<MissionControlPane />)
    expect(container.querySelector('.axon-mission-control')).toBeTruthy()
    await waitFor(() => {
      expect(container.querySelector('.axon-mission-grid')).toBeTruthy()
    })
  })

  it('wires control rail actions to real behavior', async () => {
    cleanup()
    render(<MissionControlPane />)
    const healthHeadings = await screen.findAllByText(/System Health/i)
    expect(healthHeadings.length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /Run Doctor Sweep/i }))
    expect(await screen.findByText(/Doctor sweep complete/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Inspect Sources/i }))
    expect(await screen.findByText(/Indexed sources discovered: 1\./i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Open Jobs Console/i }))
    expect(await screen.findByTestId('jobs-console')).toBeTruthy()
  })
})
