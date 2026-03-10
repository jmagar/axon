import { NextResponse } from 'next/server'
import type { SessionFile } from '@/lib/sessions/session-scanner'
import { scanSessions } from '@/lib/sessions/session-scanner'

const LIMIT = 20
const PER_AGENT_LIMIT = 30

export async function GET() {
  // scanSessions already aggregates Claude + Codex + Gemini with per-agent
  // guarantees and deduplication internally — call it once only.
  const sessions = await scanSessions(LIMIT, PER_AGENT_LIMIT).catch(() => [] as SessionFile[])

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
