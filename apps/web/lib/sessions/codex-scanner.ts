import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SessionFile } from './session-scanner'
import { cleanProjectName, mapWithConcurrency, SKIP_PATTERNS, sessionId } from './session-utils'

/**
 * Extract a preview from a Codex JSONL file.
 * Looks for lines with type:'event_msg' + payload.type:'user_message' → payload.message.
 * Never throws.
 */
async function extractCodexPreview(absolutePath: string): Promise<string | undefined> {
  try {
    const fd = await fs.open(absolutePath, 'r')
    try {
      const buf = Buffer.allocUnsafe(4096)
      const { bytesRead } = await fd.read(buf, 0, 4096, 0)
      const chunk = buf.subarray(0, bytesRead).toString('utf8')
      const lines = chunk.split('\n').slice(0, 30)

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        let val: Record<string, unknown>
        try {
          val = JSON.parse(trimmed) as Record<string, unknown>
        } catch {
          continue
        }

        if (val.type !== 'event_msg') continue
        const payload = val.payload as Record<string, unknown> | undefined
        if (!payload || payload.type !== 'user_message') continue
        const message = payload.message
        if (typeof message !== 'string' || !message.trim()) continue

        const text = message.trim().replace(/\n+/g, ' ')
        if (SKIP_PATTERNS.some((re) => re.test(text))) continue
        if (text.length > 500 && !/[.?!]/.test(text.slice(0, 200))) continue

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
 * Scan ~/.codex/sessions/{year}/{month}/{day}/*.jsonl and return SessionFile[] with agent:'codex'.
 * Never throws — returns [] on any filesystem error.
 */
export async function scanCodexSessions(): Promise<SessionFile[]> {
  const root = path.join(os.homedir(), '.codex', 'sessions')
  try {
    await fs.access(root)
  } catch {
    return []
  }

  const results: SessionFile[] = []

  // Walk 3-level depth: year → month → day
  const years = await safeReaddir(root)
  for (const year of years) {
    const yearPath = path.join(root, year)
    if (!(await isDir(yearPath))) continue
    const months = await safeReaddir(yearPath)
    for (const month of months) {
      const monthPath = path.join(yearPath, month)
      if (!(await isDir(monthPath))) continue
      const days = await safeReaddir(monthPath)
      for (const day of days) {
        const dayPath = path.join(monthPath, day)
        if (!(await isDir(dayPath))) continue
        const files = (await safeReaddir(dayPath)).filter((f) => f.endsWith('.jsonl'))
        const dayResults = await mapWithConcurrency(
          files,
          async (fileName) => {
            const absolutePath = path.join(dayPath, fileName)
            try {
              const [stat, preview] = await Promise.all([
                fs.stat(absolutePath),
                extractCodexPreview(absolutePath),
              ])
              if (!stat.isFile()) return null

              // Read first line for session_meta → cwd
              const firstLine = await readFirstLine(absolutePath)
              let project = fileName.replace(/\.jsonl$/, '')
              if (firstLine) {
                try {
                  const meta = JSON.parse(firstLine) as Record<string, unknown>
                  if (meta.type === 'session_meta') {
                    const payload = meta.payload as Record<string, unknown> | undefined
                    if (typeof payload?.cwd === 'string' && payload.cwd) {
                      project = cleanProjectName(path.basename(payload.cwd))
                    }
                  }
                } catch {
                  /* ignore */
                }
              }

              return {
                id: sessionId(absolutePath),
                absolutePath,
                project,
                filename: fileName.replace(/\.jsonl$/, ''),
                mtimeMs: stat.mtimeMs,
                sizeBytes: stat.size,
                preview,
                agent: 'codex',
              } satisfies SessionFile
            } catch {
              return null
            }
          },
          8,
        )
        for (const r of dayResults) {
          if (r !== null) results.push(r)
        }
      }
    }
  }

  return results
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir)
  } catch {
    return []
  }
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory()
  } catch {
    return false
  }
}

async function readFirstLine(filePath: string): Promise<string | null> {
  try {
    const fd = await fs.open(filePath, 'r')
    try {
      const buf = Buffer.allocUnsafe(1024)
      const { bytesRead } = await fd.read(buf, 0, 1024, 0)
      const chunk = buf.subarray(0, bytesRead).toString('utf8')
      const nl = chunk.indexOf('\n')
      return nl === -1 ? chunk.trim() : chunk.slice(0, nl).trim()
    } finally {
      await fd.close()
    }
  } catch {
    return null
  }
}
