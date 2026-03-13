import { Activity, AlertTriangle, CheckCircle2 } from 'lucide-react'
import type { MissionControlModel } from '@/lib/cortex/mission-control-model'

export function HealthStrip({ model }: { model: MissionControlModel | null }) {
  const allOk = model?.sections.health.allOk ?? false
  const unhealthy = model?.sections.health.unhealthyServices ?? 0

  return (
    <section className="axon-mission-card" aria-label="System Health">
      <div className="flex items-center gap-3">
        <Activity className="size-4 text-[var(--mc-accent-cyan)]" />
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">System Health</h2>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {allOk ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--status-completed-border)] bg-[var(--status-completed-bg)] px-2 py-1 text-xs text-[var(--status-completed)]">
            <CheckCircle2 className="size-3" /> All services healthy
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--status-failed-border)] bg-[var(--status-failed-bg)] px-2 py-1 text-xs text-[var(--status-failed)]">
            <AlertTriangle className="size-3" /> {unhealthy} unhealthy services
          </span>
        )}
        <span className="text-xs text-[var(--text-secondary)]">
          Pending jobs: {model?.sections.health.pendingJobs ?? 0}
        </span>
        <span className="text-xs text-[var(--text-secondary)]">
          Stale jobs: {model?.sections.health.staleJobs ?? 0}
        </span>
      </div>
    </section>
  )
}
