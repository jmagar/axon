import { type NextRequest, NextResponse } from 'next/server'
import { apiError } from '@/lib/server/api-error'
import { type JobStatus, type JobType, safeStatus } from '@/lib/server/job-types'
import { getJobsPgPool } from '@/lib/server/pg-pool'

// ── Types ──────────────────────────────────────────────────────────────────────

export type { JobType, JobStatus }

export interface Job {
  id: string
  type: JobType
  status: JobStatus
  target: string
  collection: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  errorText: string | null
}

async function queryRefresh(statusFilter: StatusFilter, limit: number, offset: number) {
  const { clause, params } = statusClause(statusFilter, 1)
  const n = params.length
  const rows = await getJobsPgPool().query(
    `SELECT id, urls_json, status, created_at, started_at, finished_at, error_text,
            config_json->>'collection' AS collection,
            COUNT(*) OVER() AS total
     FROM axon_refresh_jobs
     WHERE ${clause}
     ORDER BY created_at DESC
     LIMIT $${n + 1} OFFSET $${n + 2}`,
    [...params, limit, offset],
  )
  return {
    jobs: rows.rows.map((r) => {
      const urls = Array.isArray(r.urls_json) ? (r.urls_json as string[]) : []
      const first = urls[0] ?? '—'
      const label = urls.length > 1 ? `${first} (+${urls.length - 1})` : first
      return {
        id: r.id as string,
        type: 'refresh' as JobType,
        status: safeStatus(r.status as string),
        target: truncate(label),
        collection: r.collection as string | null,
        createdAt: (r.created_at as Date).toISOString(),
        startedAt: r.started_at ? (r.started_at as Date).toISOString() : null,
        finishedAt: r.finished_at ? (r.finished_at as Date).toISOString() : null,
        errorText: r.error_text as string | null,
      }
    }),
    total: Number((rows.rows[0] as { total?: string } | undefined)?.total ?? 0),
  }
}

export interface StatusCounts {
  running: number
  pending: number
  completed: number
  failed: number
}

interface JobsResponse {
  jobs: Job[]
  total: number
  hasMore: boolean
  counts: StatusCounts
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function truncate(s: string | null | undefined, max = 120): string {
  if (!s) return '—'
  return s.length > max ? `${s.slice(0, max)}…` : s
}

// ── Query builders ─────────────────────────────────────────────────────────────

type StatusFilter = 'all' | 'active' | 'pending' | 'running' | 'completed' | 'failed' | 'canceled'

/**
 * Returns the list of status values that match the filter, or null for "all".
 * Used to build parameterized WHERE clauses — never interpolate status strings directly.
 */
function statusValues(filter: StatusFilter): string[] | null {
  switch (filter) {
    case 'active':
      return ['pending', 'running']
    case 'pending':
      return ['pending']
    case 'running':
      return ['running']
    case 'completed':
      return ['completed']
    case 'failed':
      return ['failed', 'canceled']
    case 'canceled':
      return ['canceled']
    default:
      return null
  }
}

/**
 * Returns a parameterized WHERE clause fragment and the values array.
 * @param filter  the status filter
 * @param startAt the $N index where the status param should be bound (1-based)
 */
function statusClause(
  filter: StatusFilter,
  startAt: number,
): { clause: string; params: unknown[] } {
  const vals = statusValues(filter)
  if (!vals) return { clause: '1=1', params: [] }
  // Pass the string[] as a single $N binding — pg driver serialises JS arrays
  // to Postgres array literals when the param type is text[].
  return { clause: `status = ANY($${startAt}::text[])`, params: [vals] }
}

async function queryCrawl(statusFilter: StatusFilter, limit: number, offset: number) {
  const { clause, params } = statusClause(statusFilter, 1)
  const n = params.length
  const rows = await getJobsPgPool().query(
    `SELECT id, url, status, created_at, started_at, finished_at, error_text,
            config_json->>'collection' AS collection,
            COUNT(*) OVER() AS total
     FROM axon_crawl_jobs
     WHERE ${clause}
     ORDER BY created_at DESC
     LIMIT $${n + 1} OFFSET $${n + 2}`,
    [...params, limit, offset],
  )
  return {
    jobs: rows.rows.map((r) => ({
      id: r.id as string,
      type: 'crawl' as JobType,
      status: safeStatus(r.status as string),
      target: truncate(r.url as string),
      collection: r.collection as string | null,
      createdAt: (r.created_at as Date).toISOString(),
      startedAt: r.started_at ? (r.started_at as Date).toISOString() : null,
      finishedAt: r.finished_at ? (r.finished_at as Date).toISOString() : null,
      errorText: r.error_text as string | null,
    })),
    total: Number((rows.rows[0] as { total?: string } | undefined)?.total ?? 0),
  }
}

async function queryExtract(statusFilter: StatusFilter, limit: number, offset: number) {
  const { clause, params } = statusClause(statusFilter, 1)
  const n = params.length
  const rows = await getJobsPgPool().query(
    `SELECT id, urls_json, status, created_at, started_at, finished_at, error_text,
            COUNT(*) OVER() AS total
     FROM axon_extract_jobs
     WHERE ${clause}
     ORDER BY created_at DESC
     LIMIT $${n + 1} OFFSET $${n + 2}`,
    [...params, limit, offset],
  )
  return {
    jobs: rows.rows.map((r) => {
      const urls = Array.isArray(r.urls_json) ? (r.urls_json as string[]) : []
      const first = urls[0] ?? '—'
      const label = urls.length > 1 ? `${first} (+${urls.length - 1})` : first
      return {
        id: r.id as string,
        type: 'extract' as JobType,
        status: safeStatus(r.status as string),
        target: truncate(label),
        collection: null,
        createdAt: (r.created_at as Date).toISOString(),
        startedAt: r.started_at ? (r.started_at as Date).toISOString() : null,
        finishedAt: r.finished_at ? (r.finished_at as Date).toISOString() : null,
        errorText: r.error_text as string | null,
      }
    }),
    total: Number((rows.rows[0] as { total?: string } | undefined)?.total ?? 0),
  }
}

async function queryEmbed(statusFilter: StatusFilter, limit: number, offset: number) {
  const { clause, params } = statusClause(statusFilter, 1)
  const n = params.length
  const rows = await getJobsPgPool().query(
    `SELECT id, input_text, status, created_at, started_at, finished_at, error_text,
            config_json->>'collection' AS collection,
            COUNT(*) OVER() AS total
     FROM axon_embed_jobs
     WHERE ${clause}
     ORDER BY created_at DESC
     LIMIT $${n + 1} OFFSET $${n + 2}`,
    [...params, limit, offset],
  )
  return {
    jobs: rows.rows.map((r) => ({
      id: r.id as string,
      type: 'embed' as JobType,
      status: safeStatus(r.status as string),
      target: truncate(r.input_text as string),
      collection: r.collection as string | null,
      createdAt: (r.created_at as Date).toISOString(),
      startedAt: r.started_at ? (r.started_at as Date).toISOString() : null,
      finishedAt: r.finished_at ? (r.finished_at as Date).toISOString() : null,
      errorText: r.error_text as string | null,
    })),
    total: Number((rows.rows[0] as { total?: string } | undefined)?.total ?? 0),
  }
}

async function queryIngest(statusFilter: StatusFilter, limit: number, offset: number) {
  const { clause, params } = statusClause(statusFilter, 1)
  const n = params.length
  const rows = await getJobsPgPool().query(
    `SELECT id, source_type, target, status, created_at, started_at, finished_at, error_text,
            COUNT(*) OVER() AS total
     FROM axon_ingest_jobs
     WHERE ${clause}
     ORDER BY created_at DESC
     LIMIT $${n + 1} OFFSET $${n + 2}`,
    [...params, limit, offset],
  )
  return {
    jobs: rows.rows.map((r) => ({
      id: r.id as string,
      type: 'ingest' as JobType,
      status: safeStatus(r.status as string),
      target: truncate(`${r.source_type as string}: ${r.target as string}`),
      collection: null,
      createdAt: (r.created_at as Date).toISOString(),
      startedAt: r.started_at ? (r.started_at as Date).toISOString() : null,
      finishedAt: r.finished_at ? (r.finished_at as Date).toISOString() : null,
      errorText: r.error_text as string | null,
    })),
    total: Number((rows.rows[0] as { total?: string } | undefined)?.total ?? 0),
  }
}

// ── Status counts (all tables, all statuses, unfiltered) ─────────────────────

// Module-level cache: status counts change infrequently; 5 s TTL avoids
// 5 parallel COUNT(*) queries on every /api/jobs poll.
const STATUS_COUNTS_TTL_MS = 5_000
let statusCountsCache: { data: StatusCounts; expiresAt: number } | null = null

async function fetchStatusCounts(): Promise<StatusCounts> {
  const countSql = (table: string) =>
    getJobsPgPool().query<{ running: string; pending: string; completed: string; failed: string }>(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'running')                    AS running,
        COUNT(*) FILTER (WHERE status = 'pending')                    AS pending,
        COUNT(*) FILTER (WHERE status = 'completed')                  AS completed,
        COUNT(*) FILTER (WHERE status IN ('failed','canceled'))       AS failed
       FROM ${table}`,
    )
  const [crawl, extract, embed, ingest, refresh] = await Promise.all([
    countSql('axon_crawl_jobs'),
    countSql('axon_extract_jobs'),
    countSql('axon_embed_jobs'),
    countSql('axon_ingest_jobs'),
    countSql('axon_refresh_jobs'),
  ])
  const sum = (key: keyof StatusCounts) =>
    [crawl, extract, embed, ingest, refresh].reduce(
      (acc, r) => acc + Number((r.rows[0] as Record<string, string>)[key] ?? 0),
      0,
    )
  return {
    running: sum('running'),
    pending: sum('pending'),
    completed: sum('completed'),
    failed: sum('failed'),
  }
}

async function getStatusCounts(): Promise<StatusCounts> {
  const now = Date.now()
  if (statusCountsCache && statusCountsCache.expiresAt > now) {
    return statusCountsCache.data
  }
  const data = await fetchStatusCounts()
  statusCountsCache = { data, expiresAt: now + STATUS_COUNTS_TTL_MS }
  return data
}

// ── GET /api/jobs ──────────────────────────────────────────────────────────────

const VALID_TYPES = new Set(['all', 'crawl', 'extract', 'embed', 'ingest', 'refresh'])
const VALID_STATUSES = new Set([
  'all',
  'active',
  'pending',
  'running',
  'completed',
  'failed',
  'canceled',
])

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl

  const typeRaw = searchParams.get('type') ?? 'all'
  if (!VALID_TYPES.has(typeRaw)) {
    return apiError(400, `Invalid type filter: ${typeRaw}`, {
      code: 'invalid_type_filter',
      detail: `Allowed values: ${[...VALID_TYPES].join(', ')}`,
    })
  }
  const type = typeRaw as 'all' | JobType

  const statusRaw = searchParams.get('status') ?? 'all'
  if (!VALID_STATUSES.has(statusRaw)) {
    return apiError(400, `Invalid status filter: ${statusRaw}`, {
      code: 'invalid_status_filter',
      detail: `Allowed values: ${[...VALID_STATUSES].join(', ')}`,
    })
  }
  const safeStatusFilter = statusRaw as StatusFilter

  const limit = Math.min(Math.max(Number(searchParams.get('limit') ?? '50'), 1), 200)
  const offset = Math.max(Number(searchParams.get('offset') ?? '0'), 0)

  try {
    let jobs: Job[] = []
    let total = 0
    const counts = await getStatusCounts()

    if (type === 'all') {
      const { clause, params } = statusClause(safeStatusFilter, 1)
      const n = params.length
      // Run the paged result and the total count in parallel.
      // A separate COUNT avoids the COUNT(*) OVER() window function which
      // materialises the full result set before applying LIMIT — this lets
      // Postgres push the LIMIT into each UNION ALL branch instead.
      const [unionResult, countResult] = await Promise.all([
        getJobsPgPool().query(
          `SELECT id, 'crawl' AS type, url AS target, config_json->>'collection' AS collection_val, status, created_at, started_at, finished_at, error_text
             FROM axon_crawl_jobs WHERE ${clause}
           UNION ALL
           SELECT id, 'extract', urls_json::text, NULL, status, created_at, started_at, finished_at, error_text
             FROM axon_extract_jobs WHERE ${clause}
           UNION ALL
           SELECT id, 'embed', input_text, config_json->>'collection', status, created_at, started_at, finished_at, error_text
             FROM axon_embed_jobs WHERE ${clause}
           UNION ALL
           SELECT id, 'ingest', source_type || ': ' || target, NULL, status, created_at, started_at, finished_at, error_text
             FROM axon_ingest_jobs WHERE ${clause}
           UNION ALL
           SELECT id, 'refresh', urls_json::text, config_json->>'collection', status, created_at, started_at, finished_at, error_text
             FROM axon_refresh_jobs WHERE ${clause}
           ORDER BY created_at DESC
           LIMIT $${n + 1} OFFSET $${n + 2}`,
          [...params, limit, offset],
        ),
        getJobsPgPool().query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM (
             SELECT id FROM axon_crawl_jobs WHERE ${clause}
             UNION ALL
             SELECT id FROM axon_extract_jobs WHERE ${clause}
             UNION ALL
             SELECT id FROM axon_embed_jobs WHERE ${clause}
             UNION ALL
             SELECT id FROM axon_ingest_jobs WHERE ${clause}
             UNION ALL
             SELECT id FROM axon_refresh_jobs WHERE ${clause}
           ) t`,
          params,
        ),
      ])
      total = Number((countResult.rows[0] as { count?: string } | undefined)?.count ?? 0)
      jobs = unionResult.rows.map((r) => ({
        id: r.id as string,
        type: r.type as JobType,
        status: safeStatus(r.status as string),
        target: truncate(r.target as string),
        collection: (r.collection_val as string) ?? null,
        createdAt: (r.created_at as Date).toISOString(),
        startedAt: r.started_at ? (r.started_at as Date).toISOString() : null,
        finishedAt: r.finished_at ? (r.finished_at as Date).toISOString() : null,
        errorText: r.error_text as string | null,
      }))
    } else {
      const query =
        type === 'crawl'
          ? queryCrawl
          : type === 'extract'
            ? queryExtract
            : type === 'embed'
              ? queryEmbed
              : type === 'ingest'
                ? queryIngest
                : queryRefresh
      const result = await query(safeStatusFilter, limit, offset)
      jobs = result.jobs
      total = result.total
    }

    const response: JobsResponse = {
      jobs,
      total,
      hasMore: offset + jobs.length < total,
      counts,
    }
    return NextResponse.json(response)
  } catch (err) {
    console.error('[api/jobs] database error', err)
    return apiError(500, 'Failed to query jobs', { code: 'jobs_db_error' })
  }
}

// ── POST /api/jobs/cancel ──────────────────────────────────────────────────────

export async function POST(): Promise<NextResponse> {
  return NextResponse.json(
    { ok: false, message: 'Cancel not yet supported from UI' },
    { status: 200 },
  )
}
