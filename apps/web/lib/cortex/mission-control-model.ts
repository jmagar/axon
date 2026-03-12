import type { CortexOverview } from '@/lib/cortex/overview-normalize'

export type QueuePressure = 'low' | 'medium' | 'high'
export type Reliability = 'healthy' | 'degraded'

export interface MissionControlModel {
  kpis: {
    queuePressure: QueuePressure
    reliability: Reliability
    activeWork: number
    completed: number
    failed: number
    vectors: number
    domains: number
  }
  sections: CortexOverview
}

export function buildMissionControlModel(input: CortexOverview): MissionControlModel {
  const pending = Number(input?.queue?.pending ?? 0)
  const running = Number(input?.queue?.running ?? 0)
  const unhealthy = Number(input?.health?.unhealthyServices ?? 0)

  const queuePressure: QueuePressure = pending > 10 ? 'high' : pending > 3 ? 'medium' : 'low'
  const reliability: Reliability = unhealthy > 0 ? 'degraded' : 'healthy'

  return {
    kpis: {
      queuePressure,
      reliability,
      activeWork: pending + running,
      completed: Number(input?.queue?.completed ?? 0),
      failed: Number(input?.queue?.failed ?? 0),
      vectors: Number(input?.corpus?.vectors ?? 0),
      domains: Number(input?.corpus?.domains ?? 0),
    },
    sections: input,
  }
}
