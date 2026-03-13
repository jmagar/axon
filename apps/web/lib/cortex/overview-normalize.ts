import type {
  DoctorResult,
  DomainsPagedResult,
  DomainsResult,
  SourcesPagedResult,
  SourcesResult,
  StatsResult,
  StatusResult,
} from '@/lib/result-types'
import { type JobStatus, type JobType, safeStatus } from '@/lib/server/job-types'

export interface OverviewJob {
  id: string
  type: JobType
  status: JobStatus
  target: string
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

export interface CortexOverview {
  health: {
    allOk: boolean
    unhealthyServices: number
    staleJobs: number
    pendingJobs: number
    services: DoctorResult['services']
    pipelines: DoctorResult['pipelines']
  }
  queue: {
    running: number
    pending: number
    completed: number
    failed: number
    total: number
  }
  corpus: {
    collection: string
    status: string
    vectors: number
    points: number
    domains: number
    sources: number
    topDomains: Array<{ domain: string; vectors: number; urls: number }>
    topSources: Array<{ url: string; chunks: number }>
  }
  jobs: OverviewJob[]
}

interface OverviewInput {
  status: StatusResult
  doctor: DoctorResult
  stats: StatsResult
  domains: DomainsResult
  sources: SourcesResult
  jobsRows: Array<{
    id: string
    type: string
    status: string
    target: string
    created_at: Date
    started_at: Date | null
    finished_at: Date | null
  }>
}

function isDomainsPagedResult(data: DomainsResult): data is DomainsPagedResult {
  if (!('domains' in data)) return false
  if (!Array.isArray(data.domains)) return false
  return data.domains.every(
    (row) =>
      !!row &&
      typeof row === 'object' &&
      'domain' in row &&
      typeof row.domain === 'string' &&
      'vectors' in row,
  )
}

function isSourcesPagedResult(data: SourcesResult): data is SourcesPagedResult {
  if (!('urls' in data)) return false
  if (!Array.isArray(data.urls)) return false
  return data.urls.every(
    (row) =>
      !!row &&
      typeof row === 'object' &&
      'url' in row &&
      typeof row.url === 'string' &&
      'chunks' in row,
  )
}

function normalizeDomainRows(
  domains: DomainsResult,
): Array<{ domain: string; vectors: number; urls: number }> {
  if (isDomainsPagedResult(domains)) {
    return domains.domains
      .map((row) => ({
        domain: row.domain,
        vectors: Number(row.vectors) || 0,
        urls: Number(row.urls ?? 0) || 0,
      }))
      .sort((a, b) => b.vectors - a.vectors)
  }

  return Object.entries(domains)
    .map(([domain, value]) => {
      if (Array.isArray(value)) {
        return {
          domain,
          urls: Number(value[0]) || 0,
          vectors: Number(value[1]) || 0,
        }
      }
      return {
        domain,
        urls: 0,
        vectors: Number(value) || 0,
      }
    })
    .sort((a, b) => b.vectors - a.vectors)
}

function normalizeSourceRows(sources: SourcesResult): Array<{ url: string; chunks: number }> {
  if (isSourcesPagedResult(sources)) {
    return sources.urls
      .map((row) => ({
        url: row.url,
        chunks: Number(row.chunks) || 0,
      }))
      .sort((a, b) => b.chunks - a.chunks)
  }

  return Object.entries(sources)
    .map(([url, chunks]) => ({
      url,
      chunks: Number(chunks) || 0,
    }))
    .sort((a, b) => b.chunks - a.chunks)
}

function queueCounts(status: StatusResult) {
  const all = [
    ...(status.local_crawl_jobs ?? []),
    ...(status.local_extract_jobs ?? []),
    ...(status.local_embed_jobs ?? []),
    ...(status.local_ingest_jobs ?? []),
  ]

  const counts = all.reduce(
    (acc, job) => {
      if (job.status === 'running') acc.running += 1
      else if (job.status === 'pending') acc.pending += 1
      else if (job.status === 'completed') acc.completed += 1
      else if (job.status === 'failed' || job.status === 'canceled') acc.failed += 1
      return acc
    },
    { running: 0, pending: 0, completed: 0, failed: 0 },
  )

  return {
    ...counts,
    total: all.length,
  }
}

export function toCortexOverview(input: OverviewInput): CortexOverview {
  const domainRows = normalizeDomainRows(input.domains)
  const sourceRows = normalizeSourceRows(input.sources)
  const unhealthyServices = Object.values(input.doctor.services ?? {}).filter(
    (svc) => !svc.ok,
  ).length

  return {
    health: {
      allOk: Boolean(input.doctor.all_ok),
      unhealthyServices,
      staleJobs: Number(input.doctor.stale_jobs ?? 0),
      pendingJobs: Number(input.doctor.pending_jobs ?? 0),
      services: input.doctor.services ?? {},
      pipelines: input.doctor.pipelines ?? {},
    },
    queue: queueCounts(input.status),
    corpus: {
      collection: String(input.stats.collection ?? 'cortex'),
      status: String(input.stats.status ?? 'unknown'),
      vectors: Number(input.stats.indexed_vectors_count ?? 0),
      points: Number(input.stats.points_count ?? 0),
      domains: domainRows.length,
      sources: sourceRows.length,
      topDomains: domainRows.slice(0, 8),
      topSources: sourceRows.slice(0, 8),
    },
    jobs: input.jobsRows.map((row) => ({
      id: row.id,
      type: row.type as JobType,
      status: safeStatus(row.status),
      target: row.target,
      createdAt: row.created_at.toISOString(),
      startedAt: row.started_at ? row.started_at.toISOString() : null,
      finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
    })),
  }
}
