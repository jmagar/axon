import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SessionFile } from './session-scanner'
import { mapWithConcurrency, SKIP_PATTERNS, sessionId } from './session-utils'

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

/**
 * Build a SHA256-hash → projectName lookup from ~/.gemini/projects.json.
 * Format: { [hash: string]: string } (hash → absolute path).
 * Never throws — returns empty map on any error.
 */
async function buildGeminiProjectMap(): Promise<Map<string, string>> {
  const projectsPath = path.join(os.homedir(), '.gemini', 'projects.json')
  try {
    const raw = await fs.readFile(projectsPath, 'utf-8')
    const obj = JSON.parse(raw) as Record<string, string>
    const map = new Map<string, string>()
    for (const [hash, absPath] of Object.entries(obj)) {
      if (typeof absPath === 'string') {
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
 * Never throws — returns [] on any filesystem error.
 */
export async function scanGeminiSessions(): Promise<SessionFile[]> {
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

      const projectName = projectMap.get(hashDir) ?? hashDir.slice(0, 8)

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

          // Extract first user message as preview
          let preview: string | undefined
          for (const msg of data.messages ?? []) {
            if (msg.type !== 'user') continue
            const text = (msg.content ?? '').trim().replace(/\n+/g, ' ')
            if (!text) continue
            if (SKIP_PATTERNS.some((re) => re.test(text))) continue
            if (text.length > 500 && !/[.?!]/.test(text.slice(0, 200))) continue
            preview = text.length > 80 ? `${text.slice(0, 80)}…` : text
            break
          }

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
