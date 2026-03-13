import { Globe2 } from 'lucide-react'
import type { MissionControlModel } from '@/lib/cortex/mission-control-model'

export function CorpusMap({ model }: { model: MissionControlModel | null }) {
  const domains = model?.sections.corpus.topDomains ?? []

  return (
    <section className="axon-mission-card" aria-label="Corpus Map">
      <div className="flex items-center gap-3">
        <Globe2 className="size-4 text-[var(--mc-accent-cyan)]" />
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Corpus Map</h2>
      </div>
      <div className="mt-3 space-y-2">
        {domains.length === 0 ? (
          <p className="text-xs text-[var(--text-dim)]">No domain data yet.</p>
        ) : (
          domains.map((domain) => (
            <div
              key={domain.domain}
              className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-float)] px-2 py-1.5"
            >
              <span className="flex-1 truncate font-mono text-xs text-[var(--text-secondary)]">
                {domain.domain}
              </span>
              <span className="rounded bg-[rgba(102,217,255,0.12)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--mc-accent-cyan)]">
                {domain.vectors}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  )
}
