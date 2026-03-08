import { NextResponse } from 'next/server'
import { scanSessions } from '@/lib/sessions/session-scanner'

export async function GET() {
  const sessions = await scanSessions(20)
  const payload = sessions.map(
    ({ id, project, filename, mtimeMs, sizeBytes, preview, repo, branch }) => ({
      id,
      project,
      filename,
      mtimeMs,
      sizeBytes,
      preview,
      repo,
      branch,
    }),
  )
  return NextResponse.json(payload)
}
