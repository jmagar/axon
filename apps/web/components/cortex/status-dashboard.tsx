'use client'

import { Activity, AlertCircle, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAdaptivePolling } from '@/hooks/use-adaptive-polling'
import { apiFetch } from '@/lib/api-fetch'
import type { JobEntry, StatusResult } from '@/lib/result-types'

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  running:
    'bg-[var(--status-running-bg)] text-[var(--status-running)] border border-[var(--status-running-border)]',
  pending:
    'bg-[rgba(135,175,255,0.12)] text-[var(--axon-primary)] border border-[rgba(135,175,255,0.25)]',
  completed:
    'bg-[var(--status-completed-bg)] text-[var(--status-completed)] border border-[var(--status-completed-border)]',
  failed:
    'bg-[var(--status-failed-bg)] text-[var(--status-failed)] border border-[var(--status-failed-border)]',
  canceled:
    'bg-[rgba(156,163,175,0.12)] text-[var(--text-dim)] border border-[rgba(156,163,175,0.2)]',
}

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_BADGE[status] ?? STATUS_BADGE.canceled
  return (
    <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${cls}`}>
      {status}
    </span>
  )
}

// ── Job table ─────────────────────────────────────────────────────────────────

function JobTable({ jobs }: { jobs: JobEntry[] }) {
  if (jobs.length === 0) {
    return <p className="px-3 py-4 text-center text-[11px] text-[var(--text-dim)]">No jobs</p>
  }
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-[var(--border-subtle)]">
          <th className="px-3 py-1.5 text-left font-semibold text-[var(--text-dim)] uppercase tracking-wider text-[9px]">
            ID
          </th>
          <th className="px-3 py-1.5 text-left font-semibold text-[var(--text-dim)] uppercase tracking-wider text-[9px]">
            Target
          </th>
          <th className="px-3 py-1.5 text-left font-semibold text-[var(--text-dim)] uppercase tracking-wider text-[9px]">
            Status
          </th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((job) => (
          <tr
            key={job.id}
            className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--surface-float)]"
          >
            <td className="px-3 py-1.5 font-mono text-[10px] text-[var(--text-dim)]">
              {job.id.slice(0, 8)}…
            </td>
            <td className="max-w-xs truncate px-3 py-1.5 text-[var(--text-secondary)]">
              {String(job.url ?? job.target ?? '—')}
            </td>
            <td className="px-3 py-1.5">
              <StatusBadge status={job.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── Collapsible card ──────────────────────────────────────────────────────────

function JobCard({ title, jobs, color }: { title: string; jobs: JobEntry[]; color: string }) {
  const [open, setOpen] = useState(true)
  const runningCount = jobs.filter((j) => j.status === 'running').length
  const pendingCount = jobs.filter((j) => j.status === 'pending').length

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-base)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-[var(--surface-float)] transition-colors"
      >
        <span className={`size-2 rounded-full ${color}`} />
        <span className="flex-1 text-[13px] font-semibold text-[var(--text-primary)]">{title}</span>
        <span className="rounded-full bg-[rgba(135,175,255,0.1)] px-2 py-0.5 text-[10px] font-semibold text-[var(--axon-primary)]">
          {jobs.length}
        </span>
        {runningCount > 0 && (
          <span className="rounded-full bg-[var(--status-running-bg)] px-2 py-0.5 text-[10px] text-[var(--status-running)]">
            {runningCount} running
          </span>
        )}
        {pendingCount > 0 && (
          <span className="rounded-full bg-[rgba(135,175,255,0.1)] px-2 py-0.5 text-[10px] text-[var(--axon-primary)]">
            {pendingCount} pending
          </span>
        )}
        {open ? (
          <ChevronDown className="size-3.5 text-[var(--text-dim)]" />
        ) : (
          <ChevronRight className="size-3.5 text-[var(--text-dim)]" />
        )}
      </button>
      {open && <JobTable jobs={jobs} />}
    </div>
  )
}

// ── Summary row ───────────────────────────────────────────────────────────────

function SummaryBar({ data }: { data: StatusResult }) {
  const all = [
    ...(data.local_crawl_jobs ?? []),
    ...(data.local_extract_jobs ?? []),
    ...(data.local_embed_jobs ?? []),
    ...(data.local_ingest_jobs ?? []),
  ]
  const counts = all.reduce(
    (acc, j) => {
      if (j.status === 'running') acc.running++
      else if (j.status === 'pending') acc.pending++
      else if (j.status === 'completed') acc.completed++
      else if (j.status === 'failed' || j.status === 'canceled') acc.failed++
      return acc
    },
    { running: 0, pending: 0, completed: 0, failed: 0 },
  )

  return (
    <div className="flex flex-wrap gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-base)] px-4 py-3">
      {[
        {
          label: 'Running',
          count: counts.running,
          color: 'text-[var(--status-running)]',
          bg: 'bg-[var(--status-running-bg)]',
        },
        {
          label: 'Pending',
          count: counts.pending,
          color: 'text-[var(--axon-primary)]',
          bg: 'bg-[rgba(135,175,255,0.1)]',
        },
        {
          label: 'Done',
          count: counts.completed,
          color: 'text-[var(--status-completed)]',
          bg: 'bg-[var(--status-completed-bg)]',
        },
        {
          label: 'Failed',
          count: counts.failed,
          color: 'text-[var(--status-failed)]',
          bg: 'bg-[var(--status-failed-bg)]',
        },
      ].map(({ label, count, color, bg }) => (
        <div key={label} className={`flex items-center gap-2 rounded-lg px-3 py-1.5 ${bg}`}>
          <span className={`text-[18px] font-bold tabular-nums ${color}`}>{count}</span>
          <span className="text-[11px] text-[var(--text-dim)]">{label}</span>
        </div>
      ))}
    </div>
  )
}

// ── Main dashboard ────────────────────────────────────────────────────────────

interface ApiResponse {
  ok: boolean
  data?: StatusResult
  error?: string
}

export function StatusDashboard() {
  const [data, setData] = useState<StatusResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [spinning, setSpinning] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async (isManual = false) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    if (isManual) setSpinning(true)
    setError(null)
    try {
      const res = await apiFetch('/api/cortex/status', { signal: controller.signal })
      const json = (await res.json()) as ApiResponse
      if (!json.ok) throw new Error(json.error ?? 'Unknown error')
      if (abortRef.current !== controller) return
      setData(json.data ?? null)
      setUpdatedAt(new Date())
    } catch (err) {
      if (abortRef.current !== controller) return
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
        setLoading(false)
        setSpinning(false)
      }
    }
  }, [])

  useEffect(() => {
    void load()
    return () => {
      abortRef.current?.abort()
    }
  }, [load])
  useAdaptivePolling(() => load(), 5_000, {
    enabled: true,
    pauseWhenHidden: true,
    jitterRatio: 0.15,
  })

  return (
    <div className="animate-fade-in space-y-4">
      <div className="flex items-center gap-3">
        <Activity className="size-4 text-[var(--axon-primary)]" />
        <h1 className="text-[18px] font-bold tracking-tight text-[var(--text-primary)]">Status</h1>
        <div className="flex-1" />
        {updatedAt && (
          <span className="text-[10px] text-[var(--text-dim)]">
            Updated {updatedAt.toLocaleTimeString()}
          </span>
        )}
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={loading || spinning}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-dim)] transition-colors hover:bg-[var(--surface-float)] hover:text-[var(--axon-primary)] disabled:opacity-40"
        >
          <RefreshCw className={`size-3.5 ${spinning ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-base)]"
            />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="flex items-start gap-3 rounded-xl border border-[var(--status-failed-border)] bg-[var(--status-failed-bg)] px-4 py-3 text-[12px] text-[var(--status-failed)]">
          <AlertCircle className="mt-0.5 size-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && data && (
        <>
          <SummaryBar data={data} />
          <div className="space-y-3">
            <JobCard
              title="Crawl"
              jobs={data.local_crawl_jobs ?? []}
              color="bg-[var(--status-running)]"
            />
            <JobCard title="Extract" jobs={data.local_extract_jobs ?? []} color="bg-[#a78bfa]" />
            <JobCard title="Embed" jobs={data.local_embed_jobs ?? []} color="bg-[#fbbf24]" />
            <JobCard
              title="Ingest"
              jobs={data.local_ingest_jobs ?? []}
              color="bg-[var(--status-failed)]"
            />
          </div>
        </>
      )}

      {!loading && !error && !data && (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-base)] px-4 py-3 text-[12px] text-[var(--text-dim)]">
          Waiting for status payload. Try Refresh if this persists.
        </div>
      )}
    </div>
  )
}
