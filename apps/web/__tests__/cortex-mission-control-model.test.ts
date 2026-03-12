import { describe, expect, it } from 'vitest'
import { buildMissionControlModel } from '@/lib/cortex/mission-control-model'

describe('buildMissionControlModel', () => {
  it('derives top KPIs and queue pressure correctly', () => {
    const model = buildMissionControlModel({
      health: {
        allOk: false,
        unhealthyServices: 2,
        staleJobs: 0,
        pendingJobs: 0,
        services: {},
        pipelines: {},
      },
      queue: { running: 4, pending: 11, failed: 3, completed: 97, total: 115 },
      corpus: {
        collection: 'cortex',
        status: 'green',
        points: 1000,
        vectors: 1000,
        domains: 12,
        sources: 50,
        topDomains: [],
        topSources: [],
      },
      jobs: [],
    })

    expect(model.kpis.queuePressure).toBe('high')
    expect(model.kpis.reliability).toBe('degraded')
  })
})
