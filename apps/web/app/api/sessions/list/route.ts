import { NextResponse } from 'next/server'
import { scanCodexSessions } from '@/lib/sessions/codex-scanner'
import { scanGeminiSessions } from '@/lib/sessions/gemini-scanner'
import type { AgentKind, SessionFile } from '@/lib/sessions/session-scanner'
import { scanSessions } from '@/lib/sessions/session-scanner'

const LIMIT = 20
const PER_AGENT_LIMIT = 30
const MIN_PER_AGENT = 3

function selectPreferred(current: SessionFile, next: SessionFile): SessionFile {
  if (next.mtimeMs !== current.mtimeMs) return next.mtimeMs > current.mtimeMs ? next : current
  if (current.project === 'tmp' && next.project !== 'tmp') return next
  if (next.project === 'tmp' && current.project !== 'tmp') return current
  if (next.sizeBytes !== current.sizeBytes)
    return next.sizeBytes > current.sizeBytes ? next : current
  return current
}

export async function GET() {
  // Scan all three agents in parallel
  const [claudeAll, codexAll, geminiAll] = await Promise.all([
    scanSessions(PER_AGENT_LIMIT, PER_AGENT_LIMIT).catch(() => [] as SessionFile[]),
    scanCodexSessions().catch(() => [] as SessionFile[]),
    scanGeminiSessions().catch(() => [] as SessionFile[]),
  ])

  const claudeResults = claudeAll.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, PER_AGENT_LIMIT)
  const codexResults = codexAll.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, PER_AGENT_LIMIT)
  const geminiResults = geminiAll.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, PER_AGENT_LIMIT)

  // Deduplicate across all agents
  const deduped = new Map<string, SessionFile>()
  for (const s of [...claudeResults, ...codexResults, ...geminiResults]) {
    const key = `${s.agent}:${s.filename}`
    const existing = deduped.get(key)
    deduped.set(key, existing ? selectPreferred(existing, s) : s)
  }

  // Sort by mtime desc
  const allSorted = Array.from(deduped.values()).sort((a, b) => b.mtimeMs - a.mtimeMs)

  // Guarantee MIN_PER_AGENT from each agent type that has sessions
  const agentCounts = new Map<AgentKind, number>()
  const guaranteed: SessionFile[] = []
  const guaranteedKeys = new Set<string>()

  for (const s of allSorted) {
    const count = agentCounts.get(s.agent) ?? 0
    if (count < MIN_PER_AGENT) {
      agentCounts.set(s.agent, count + 1)
      guaranteed.push(s)
      guaranteedKeys.add(`${s.agent}:${s.filename}`)
    }
  }

  // Fill remaining slots with the most recent sessions not already guaranteed,
  // then sort the combined list so recency order is preserved in the final output.
  const filler = allSorted
    .filter((s) => !guaranteedKeys.has(`${s.agent}:${s.filename}`))
    .slice(0, LIMIT - guaranteed.length)
  const sessions = [...guaranteed, ...filler].sort((a, b) => b.mtimeMs - a.mtimeMs)

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
