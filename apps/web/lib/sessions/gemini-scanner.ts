import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SessionFile } from './session-scanner'
import {
  chooseAdaptivePromptPreview,
  mapWithConcurrency,
  normalizePromptPreview,
  sessionId,
} from './session-utils'

interface GeminiMessage {
  type: string
  content?: string
}

interface GeminiSessionJson {
  sessionId?: string
  projectHash?: string
  lastUpdated?: string
  messages?: GeminiMessage[]
}

function looksLikeHashedProjectDir(name: string): boolean {
  return /^[a-f0-9]{9,}$/i.test(name)
}

/**
 * Build projectDir → projectName lookup from ~/.gemini/projects.json.
 * Supports both formats:
 * 1) legacy: { [hash: string]: absolutePath }
 * 2) current: { projects: { [absolutePath: string]: projectLabel } }
 * Never throws — returns empty map on any error.
 */
async function buildGeminiProjectMap(): Promise<Map<string, string>> {
  const projectsPath = path.join(os.homedir(), '.gemini', 'projects.json')
  try {
    const raw = await fs.readFile(projectsPath, 'utf-8')
    const map = new Map<string, string>()

    const parsed = JSON.parse(raw) as unknown
    const asRecord = (value: unknown): Record<string, unknown> | null =>
      typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null

    const top = asRecord(parsed)
    if (!top) return map

    // Current format: { projects: { "/abs/path": "project-label" } }
    const projectsObj = asRecord(top.projects)
    if (projectsObj) {
      for (const [absPath, label] of Object.entries(projectsObj)) {
        if (typeof absPath !== 'string' || !absPath) continue
        const dir =
          typeof label === 'string' && label.trim() ? label.trim() : path.basename(absPath)
        if (!dir) continue
        map.set(dir, dir)
      }
      return map
    }

    // Legacy format: { "hash": "/abs/path" }
    for (const [hash, absPath] of Object.entries(top)) {
      if (typeof absPath === 'string' && hash) {
        map.set(hash, path.basename(absPath))
      }
    }

    return map
  } catch {
    return new Map()
  }
}

/**
 * Scan ~/.gemini/tmp/{hash}/chats/session-*.json and return SessionFile[] with agent:'gemini'.
 * Pass `limit` to cap the number of results returned (default: unlimited).
 * Never throws — returns [] on any filesystem error.
 */
export async function scanGeminiSessions(limit = Number.MAX_SAFE_INTEGER): Promise<SessionFile[]> {
  const tmpRoot = path.join(os.homedir(), '.gemini', 'tmp')
  try {
    await fs.access(tmpRoot)
  } catch {
    return []
  }

  const projectMap = await buildGeminiProjectMap()

  const hashDirs = await safeReaddir(tmpRoot)
  const allResults: SessionFile[] = []

  await mapWithConcurrency(
    hashDirs,
    async (hashDir) => {
      const chatsPath = path.join(tmpRoot, hashDir, 'chats')
      const sessionFiles = (await safeReaddir(chatsPath)).filter(
        (f) => f.startsWith('session-') && f.endsWith('.json'),
      )

      const projectName =
        projectMap.get(hashDir) ??
        (looksLikeHashedProjectDir(hashDir) ? hashDir.slice(0, 8) : hashDir)

      for (const fileName of sessionFiles) {
        const absolutePath = path.join(chatsPath, fileName)
        try {
          const [stat, raw] = await Promise.all([
            fs.stat(absolutePath),
            fs.readFile(absolutePath, 'utf-8'),
          ])
          if (!stat.isFile()) continue

          const data = JSON.parse(raw) as GeminiSessionJson
          const sessionFileId = data.sessionId ?? fileName.replace(/\.json$/, '')
          const mtimeMs = data.lastUpdated
            ? new Date(data.lastUpdated).getTime() || stat.mtimeMs
            : stat.mtimeMs

          const promptCandidates: string[] = []
          for (const msg of data.messages ?? []) {
            if (msg.type !== 'user') continue
            // Guard against malformed message objects where content is not a string
            if (typeof msg.content !== 'string') continue
            const normalized = normalizePromptPreview(msg.content)
            if (!normalized) continue
            promptCandidates.push(normalized)
          }
          const selected = chooseAdaptivePromptPreview(promptCandidates)
          const preview =
            selected !== undefined
              ? selected.length > 80
                ? `${selected.slice(0, 80)}…`
                : selected
              : undefined

          if (allResults.length < limit) {
            allResults.push({
              id: sessionId(absolutePath),
              absolutePath,
              project: projectName,
              filename: sessionFileId,
              mtimeMs,
              sizeBytes: stat.size,
              preview,
              agent: 'gemini',
            } satisfies SessionFile)
          }
        } catch {
          /* skip unreadable files */
        }
      }
    },
    8,
  )

  return allResults
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir)
  } catch {
    return []
  }
}
