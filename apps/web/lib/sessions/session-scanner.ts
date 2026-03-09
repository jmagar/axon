import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { decodeProjectPath, enrichWithGit } from './git-metadata'

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

/** Patterns that indicate a message is a system/handoff prompt, not real user input. */
const SKIP_PATTERNS = [/^Respond as JSON/, /^I'm loading a previous/, /^## Context/]
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

/**
 * Port of clean_claude_project_name from crates/ingest/sessions/claude.rs.
 * Converts a directory name like "-home-jmagar-workspace-axon-rust" to
 * a human-readable project name like "axon-rust".
 */
// Words that indicate a suffix rather than the project name itself.
const SUFFIX_WORDS = new Set(['rust', 'rs', 'git', 'main', 'master', 'src'])

export function cleanProjectName(dirName: string): string {
  if (!dirName.includes('-')) return dirName
  const parts = dirName.replace(/^-+/, '').split('-').filter(Boolean)
  if (parts.length === 0) return dirName
  if (parts.length === 1) return parts[0] ?? dirName

  const last = parts[parts.length - 1] ?? ''
  const prev = parts[parts.length - 2] ?? ''

  // If the last segment is a known suffix, drop it and return just prev.
  // Otherwise show the last two path segments for context (e.g., "my-project").
  return SUFFIX_WORDS.has(last) ? prev : `${prev}-${last}`
}

function sessionId(absolutePath: string): string {
  return crypto.createHash('sha256').update(absolutePath).digest('hex').slice(0, 12)
}

/**
 * Run `fn` over each item with at most `concurrency` tasks in flight at once.
 * Preserves order of results relative to the input array.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
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
 * Scan ~/.claude/projects/**\/*.jsonl, return metadata sorted by mtime desc.
 * Never throws — returns [] on any filesystem error.
 */
export async function scanSessions(limit = 20): Promise<SessionFile[]> {
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
      return fileResults.filter((f): f is SessionFile => f !== null)
    },
    8, // max 8 concurrent project scans (each may spawn a git subprocess)
  )

  const results = perProjectResults.flat()

  const deduped = new Map<string, SessionFile>()
  for (const session of results) {
    const key = session.filename
    const existing = deduped.get(key)
    deduped.set(key, existing ? selectPreferredSession(existing, session) : session)
  }

  return Array.from(deduped.values())
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
}
