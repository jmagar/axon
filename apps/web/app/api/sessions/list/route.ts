import { NextResponse } from 'next/server'
import { enforceRateLimit } from '@/lib/server/rate-limit'
import { getCachedSessions } from '@/lib/server/session-cache'
import type { SessionFile } from '@/lib/sessions/session-scanner'

const LIMIT = 20
const PER_AGENT_LIMIT = 30
const SESSION_CACHE_TTL_MS = 30_000

export async function GET(request: Request) {
  const limited = enforceRateLimit('api.sessions.list', request, { max: 30, windowMs: 60_000 })
  if (limited) return limited

  const url = new URL(request.url)
  const assistantMode = url.searchParams.get('assistant_mode') === '1'
  const sessions = await getCachedSessions({
    assistantMode,
    limit: LIMIT,
    perAgentLimit: PER_AGENT_LIMIT,
    ttlMs: SESSION_CACHE_TTL_MS,
  }).catch(() => [] as SessionFile[])

  const payload = sessions.map(
    ({ id, project, filename, mtimeMs, sizeBytes, preview, repo, branch, agent }) => ({
      id,
      project,
      filename,
      mtimeMs,
      sizeBytes,
      preview,
      repo,
      branch,
      agent,
    }),
  )

  return NextResponse.json(payload)
}
