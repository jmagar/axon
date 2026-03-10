import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { decodeProjectPath, enrichWithGit } from './git-metadata'
import {
  cleanProjectName,
  mapWithConcurrency as mapWithConcurrencyRaw,
  SKIP_PATTERNS,
  sessionId,
} from './session-utils'

export type AgentKind = 'claude' | 'codex' | 'gemini'

/**
 * Validated wrapper around `mapWithConcurrency` that throws if `concurrency <= 0`.
 * All internal call sites and the re-export use this to prevent silent no-ops.
 */
function mapWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  if (concurrency <= 0) {
    throw new RangeError(`mapWithConcurrency: concurrency must be >= 1, got ${concurrency}`)
  }
  return mapWithConcurrencyRaw(items, fn, concurrency)
}

// Re-export shared helpers so existing imports still work
export { cleanProjectName, mapWithConcurrency, sessionId, SKIP_PATTERNS }

export interface SessionFile {
  id: string
  absolutePath: string
  project: string
  filename: string
  mtimeMs: number
  sizeBytes: number
  preview?: string
  repo?: string
  branch?: string
  agent: AgentKind
}

function selectPreferredSession(current: SessionFile, next: SessionFile): SessionFile {
  if (next.mtimeMs !== current.mtimeMs) {
    return next.mtimeMs > current.mtimeMs ? next : current
  }
  if (current.project === 'tmp' && next.project !== 'tmp') return next
  if (next.project === 'tmp' && current.project !== 'tmp') return current
  if (next.sizeBytes !== current.sizeBytes) {
    return next.sizeBytes > current.sizeBytes ? next : current
  }
  return current
}

const PREVIEW_TRUNCATE_PATTERNS = [
  /\s+Respond as JSON only with this exact shape:.*/i,
  /\s+Respond as JSON only with this shape:.*/i,
]

const normalizePreviewText = (text: string): string => {
  let out = text.trim().replace(/\n+/g, ' ')
  for (const pattern of PREVIEW_TRUNCATE_PATTERNS) {
    out = out.replace(pattern, '').trim()
  }
  return out
}

/**
 * Read up to the first 4KB of a JSONL session file and extract the first
 * meaningful user message as a short preview string (≤80 chars).
 * Never throws — returns undefined on any error or if no good message is found.
 */
async function extractPreview(absolutePath: string): Promise<string | undefined> {
  try {
    const fd = await fs.open(absolutePath, 'r')
    try {
      const buf = Buffer.allocUnsafe(4096)
      const { bytesRead } = await fd.read(buf, 0, 4096, 0)
      const chunk = buf.subarray(0, bytesRead).toString('utf8')

      // Work line-by-line; take at most the first 20 lines to stay fast.
      const lines = chunk.split('\n').slice(0, 20)

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        let val: Record<string, unknown>
        try {
          val = JSON.parse(trimmed) as Record<string, unknown>
        } catch {
          continue
        }

        if (val.type !== 'user') continue

        const msg = val.message as Record<string, unknown> | undefined
        const msgContent = msg?.content

        let text = ''
        if (typeof msgContent === 'string') {
          text = msgContent
        } else if (Array.isArray(msgContent)) {
          for (const block of msgContent) {
            const blockText = (block as Record<string, unknown>).text
            if (typeof blockText === 'string') text += `${blockText}\n`
          }
        }

        text = normalizePreviewText(text)
        if (!text) continue

        // Skip system-like / handoff messages.
        if (SKIP_PATTERNS.some((re) => re.test(text))) continue

        // Skip very long unstructured blobs (likely injected context, not real questions).
        if (text.length > 500 && !/[.?!]/.test(text.slice(0, 200))) continue

        // We have a good candidate — trim to 80 chars.
        return text.length > 80 ? `${text.slice(0, 80)}…` : text
      }

      return undefined
    } finally {
      await fd.close()
    }
  } catch {
    return undefined
  }
}

async function readDirEntries(dirPath: string): Promise<string[]> {
  try {
    return await fs.readdir(dirPath)
  } catch {
    return []
  }
}

async function isDirEntry(entryPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(entryPath)
    return stat.isDirectory()
  } catch {
    return false
  }
}

/**
 * Scan all agent session stores (Claude + Codex + Gemini), return up to `limit` sessions
 * sorted by mtime desc. Guarantees representation from each agent by pre-sampling up to
 * `perAgentLimit` sessions per agent before the global merge+sort.
 *
 * This function invokes `scanCodexSessions` and `scanGeminiSessions` internally.
 * **Do not** call those scanners alongside this function — doing so causes duplicate
 * processing and inflated results. Use this function as the single entry point for
 * multi-agent session listing.
 *
 * Never throws — returns [] on any filesystem error.
 */
export async function scanSessions(limit = 20, perAgentLimit = 30): Promise<SessionFile[]> {
  const root = path.join(os.homedir(), '.claude', 'projects')

  try {
    await fs.access(root)
  } catch {
    return []
  }

  const projectNames = await readDirEntries(root)

  // Process projects with bounded parallelism — each spawns git subprocesses and
  // opens file descriptors.  Unbounded Promise.all over large project lists can
  // exhaust subprocess / FD limits and silently drop sessions under load.
  const perProjectResults = await mapWithConcurrency(
    projectNames,
    async (projectName) => {
      const projectPath = path.join(root, projectName)
      if (!projectPath.startsWith(root + path.sep)) return []
      if (!(await isDirEntry(projectPath))) return []

      const decoded = decodeProjectPath(projectName)
      const [git, fileNames] = await Promise.all([
        enrichWithGit(decoded),
        readDirEntries(projectPath),
      ])

      const jsonlFiles = fileNames.filter((f) => f.endsWith('.jsonl'))
      const fileResults = await mapWithConcurrency(
        jsonlFiles,
        async (fileName) => {
          const absolutePath = path.join(projectPath, fileName)
          if (!absolutePath.startsWith(root + path.sep)) return null
          try {
            const [stat, preview] = await Promise.all([
              fs.stat(absolutePath),
              extractPreview(absolutePath),
            ])
            if (!stat.isFile()) return null
            return {
              id: sessionId(absolutePath),
              absolutePath,
              project: cleanProjectName(projectName),
              filename: fileName.slice(0, -'.jsonl'.length),
              mtimeMs: stat.mtimeMs,
              sizeBytes: stat.size,
              preview,
              repo: git.repo,
              branch: git.branch,
              agent: 'claude' as AgentKind,
            } satisfies SessionFile
          } catch (err) {
            console.warn('[session-scanner] Failed to read session file', {
              absolutePath,
              sessionFilename: fileName,
              error: err instanceof Error ? err.message : String(err),
            })
            return null
          }
        },
        16, // max 16 concurrent file reads per project
      )
      return (fileResults as (SessionFile | null)[]).filter((f): f is SessionFile => f !== null)
    },
    8, // max 8 concurrent project scans (each may spawn a git subprocess)
  )

  // Take top perAgentLimit Claude sessions by mtime before merging
  const claudeResults = perProjectResults
    .flat()
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, perAgentLimit)

  // Fetch Codex and Gemini scanners in parallel via dynamic import to bypass
  // static module resolution cache (avoids Turbopack negative-cache stale state)
  const [{ scanCodexSessions }, { scanGeminiSessions }] = await Promise.all([
    import('./codex-scanner'),
    import('./gemini-scanner'),
  ])
  const [codexAll, geminiAll] = await Promise.all([scanCodexSessions(), scanGeminiSessions()])
  const codexResults = codexAll.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, perAgentLimit)
  const geminiResults = geminiAll.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, perAgentLimit)

  const results = [...claudeResults, ...codexResults, ...geminiResults]

  const deduped = new Map<string, SessionFile>()
  for (const session of results) {
    const key = `${session.agent}:${session.filename}`
    const existing = deduped.get(key)
    deduped.set(key, existing ? selectPreferredSession(existing, session) : session)
  }

  // Sort all deduplicated sessions by mtime desc
  const allSorted = Array.from(deduped.values()).sort((a, b) => b.mtimeMs - a.mtimeMs)

  // Guarantee at least `minPerAgent` sessions from each agent that has results,
  // picking the most recent of each. Never exceeds `limit` total.
  // Remaining slots filled by global recency.
  const minPerAgent = 3
  const agentCounts = new Map<AgentKind, number>()
  const guaranteed: SessionFile[] = []
  const guaranteedKeys = new Set<string>()

  for (const s of allSorted) {
    if (guaranteed.length >= limit) break
    const count = agentCounts.get(s.agent) ?? 0
    if (count < minPerAgent) {
      agentCounts.set(s.agent, count + 1)
      guaranteed.push(s)
      guaranteedKeys.add(`${s.agent}:${s.filename}`)
    }
  }

  // Fill remaining slots with the most recent not already guaranteed, then sort.
  const remaining = limit - guaranteed.length
  const filler =
    remaining > 0
      ? allSorted.filter((s) => !guaranteedKeys.has(`${s.agent}:${s.filename}`)).slice(0, remaining)
      : []
  return [...guaranteed, ...filler].sort((a, b) => b.mtimeMs - a.mtimeMs)
}
