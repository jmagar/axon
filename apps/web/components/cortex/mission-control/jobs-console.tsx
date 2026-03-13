import type { RefObject } from 'react'
import type { MissionControlModel } from '@/lib/cortex/mission-control-model'

const STATUS_TONE: Record<string, string> = {
  completed: 'text-[var(--status-completed)]',
  running: 'text-[var(--status-running)]',
  pending: 'text-[var(--axon-primary)]',
  failed: 'text-[var(--status-failed)]',
}

function statusClass(status: string): string {
  return STATUS_TONE[status] ?? 'text-[var(--text-secondary)]'
}

export function JobsConsole({
  model,
  panelRef,
}: {
  model: MissionControlModel | null
  panelRef: RefObject<HTMLElement | null>
}) {
  const jobs = model?.sections.jobs ?? []

  return (
    <section
      ref={panelRef}
      className="axon-mission-card"
      aria-label="Jobs Console"
      data-testid="jobs-console"
    >
      <h2 className="text-sm font-semibold text-[var(--text-primary)]">Jobs Console</h2>
      {jobs.length === 0 ? (
        <p className="mt-3 text-xs text-[var(--text-dim)]">No recent jobs available.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {jobs.map((job) => (
            <div
              key={job.id}
              className="grid grid-cols-[72px_1fr_70px] items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-float)] px-2 py-1.5 text-xs"
            >
              <span className="font-mono uppercase text-[var(--text-secondary)]">{job.type}</span>
              <span className="truncate text-[var(--text-primary)]">{job.target}</span>
              <span className={`text-right font-mono ${statusClass(job.status)}`}>
                {job.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
