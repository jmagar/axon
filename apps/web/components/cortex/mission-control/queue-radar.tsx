import { Radar } from 'lucide-react'
import type { MissionControlModel } from '@/lib/cortex/mission-control-model'

const BAR_COLORS = {
  running: 'bg-[var(--status-running)]',
  pending: 'bg-[var(--axon-primary)]',
  completed: 'bg-[var(--status-completed)]',
  failed: 'bg-[var(--status-failed)]',
} as const

export function QueueRadar({ model }: { model: MissionControlModel | null }) {
  const queue = model?.sections.queue
  const total = Math.max(queue?.total ?? 0, 1)
  const bars = [
    { key: 'running', label: 'Running', value: queue?.running ?? 0 },
    { key: 'pending', label: 'Pending', value: queue?.pending ?? 0 },
    { key: 'completed', label: 'Completed', value: queue?.completed ?? 0 },
    { key: 'failed', label: 'Failed', value: queue?.failed ?? 0 },
  ] as const

  return (
    <section className="axon-mission-card" aria-label="Queue Pressure">
      <div className="flex items-center gap-3">
        <Radar className="size-4 text-[var(--mc-accent-gold)]" />
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Queue Pressure</h2>
      </div>
      <div className="mt-4 space-y-2">
        {bars.map((bar) => {
          const pct = Math.round((bar.value / total) * 100)
          const toneClass = BAR_COLORS[bar.key]
          return (
            <div
              key={bar.key}
              className="grid grid-cols-[90px_1fr_50px] items-center gap-2 text-xs"
            >
              <span className="text-[var(--text-secondary)]">{bar.label}</span>
              <div className="h-2 overflow-hidden rounded bg-[var(--surface-float)]">
                <div className={`h-full ${toneClass}`} style={{ width: `${pct}%` }} />
              </div>
              <span className="font-mono text-right text-[var(--text-primary)]">{bar.value}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
