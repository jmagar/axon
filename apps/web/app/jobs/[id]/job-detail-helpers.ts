import type { JobDetail } from '@/app/api/jobs/[id]/route'

export function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function fmtDuration(
  ms: number | null,
  startedAt: string | null,
  finishedAt: string | null,
): string {
  if (ms != null) {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
  }
  if (startedAt && finishedAt) {
    const diff = new Date(finishedAt).getTime() - new Date(startedAt).getTime()
    return fmtDuration(diff, null, null)
  }
  if (startedAt) {
    const diff = Date.now() - new Date(startedAt).getTime()
    return `${Math.floor(diff / 60000)}m ${Math.floor((diff % 60000) / 1000)}s (running)`
  }
  return '—'
}

export function shouldRefetchArtifactsOnTerminalTransition(
  previousStatus: JobDetail['status'] | null | undefined,
  nextStatus: JobDetail['status'],
): boolean {
  return previousStatus === 'running' && nextStatus !== 'running'
}

export function buildJobDetailRequestPath(id: string, includeArtifacts: boolean): string {
  const artifacts = includeArtifacts ? '1' : '0'
  return `/api/jobs/${id}?includeArtifacts=${artifacts}`
}

type FlatEntry = { key: string; value: string }

export function flattenJsonEntries(value: unknown, prefix = ''): FlatEntry[] {
  if (value === null || value === undefined) return []
  if (Array.isArray(value)) {
    return [{ key: prefix, value: JSON.stringify(value) }]
  }
  if (typeof value !== 'object') {
    return [{ key: prefix, value: String(value) }]
  }

  const obj = value as Record<string, unknown>
  const entries: FlatEntry[] = []
  for (const [k, v] of Object.entries(obj)) {
    const nextKey = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      entries.push(...flattenJsonEntries(v, nextKey))
    } else if (Array.isArray(v)) {
      entries.push({ key: nextKey, value: JSON.stringify(v) })
    } else if (v === null || v === undefined) {
      entries.push({ key: nextKey, value: 'null' })
    } else {
      entries.push({ key: nextKey, value: String(v) })
    }
  }
  entries.sort((a, b) => a.key.localeCompare(b.key))
  return entries
}

export function getRefreshSummaryRows(
  job: JobDetail,
): Array<{ label: string; value: string | number | null }> {
  return [
    { label: 'Checked', value: job.checked },
    { label: 'Changed', value: job.changed },
    { label: 'Unchanged', value: job.unchanged },
    { label: 'Not Modified', value: job.notModified },
    { label: 'Failed', value: job.failedCount },
    { label: 'Total', value: job.total },
    { label: 'Manifest Path', value: job.manifestPath },
  ]
}
