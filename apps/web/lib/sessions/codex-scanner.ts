import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SessionFile } from './session-scanner'
import {
  chooseAdaptivePromptPreview,
  cleanProjectName,
  mapWithConcurrency,
  normalizePromptPreview,
  sessionId,
} from './session-utils'

/**
 * Extract a preview from a Codex JSONL file.
 * Looks for lines with type:'event_msg' + payload.type:'user_message' → payload.message.
 * Never throws.
 */
function extractCodexCandidates(lines: string[]): string[] {
  const candidates: string[] = []
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
    if (typeof message !== 'string') continue

    const normalized = normalizePromptPreview(message)
    if (!normalized) continue
    candidates.push(normalized)
  }
  return candidates
}

async function extractCodexPreview(absolutePath: string): Promise<string | undefined> {
  try {
    const fd = await fs.open(absolutePath, 'r')
    try {
      const stat = await fd.stat()
      const headSize = 8 * 1024
      const tailSize = 128 * 1024
      const size = stat.size

      const headBuf = Buffer.allocUnsafe(Math.min(headSize, size))
      const headRead = await fd.read(headBuf, 0, headBuf.length, 0)
      const headLines = headBuf.subarray(0, headRead.bytesRead).toString('utf8').split('\n')
      const headCandidates = extractCodexCandidates(headLines.slice(0, 200))

      const tailStart = size > tailSize ? size - tailSize : 0
      const tailBuf = Buffer.allocUnsafe(size - tailStart)
      const tailRead = await fd.read(tailBuf, 0, tailBuf.length, tailStart)
      const tailLines = tailBuf.subarray(0, tailRead.bytesRead).toString('utf8').split('\n')
      const tailCandidates = extractCodexCandidates(tailLines.slice(-1200))

      const best =
        chooseAdaptivePromptPreview(tailCandidates) ?? chooseAdaptivePromptPreview(headCandidates)
      return best ? (best.length > 80 ? `${best.slice(0, 80)}…` : best) : undefined
    } finally {
      await fd.close()
    }
  } catch {
    return undefined
  }
}

/**
 * Scan ~/.codex/sessions/{year}/{month}/{day}/*.jsonl and return SessionFile[] with agent:'codex'.
 * Pass `limit` to cap the number of results returned (default: unlimited).
 * Never throws — returns [] on any filesystem error.
 */
export async function scanCodexSessions(limit = Number.MAX_SAFE_INTEGER): Promise<SessionFile[]> {
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
    if (results.length >= limit) break
    const yearPath = path.join(root, year)
    if (!(await isDir(yearPath))) continue
    const months = await safeReaddir(yearPath)
    for (const month of months) {
      if (results.length >= limit) break
      const monthPath = path.join(yearPath, month)
      if (!(await isDir(monthPath))) continue
      const days = await safeReaddir(monthPath)
      for (const day of days) {
        if (results.length >= limit) break
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
          if (r !== null) {
            results.push(r)
            if (results.length >= limit) break
          }
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
      const chunkSize = 4096
      const maxBytes = 1024 * 1024
      const parts: string[] = []
      let offset = 0

      while (offset < maxBytes) {
        const toRead = Math.min(chunkSize, maxBytes - offset)
        const buf = Buffer.allocUnsafe(toRead)
        const { bytesRead } = await fd.read(buf, 0, toRead, offset)
        if (bytesRead <= 0) break

        const chunk = buf.subarray(0, bytesRead).toString('utf8')
        const nl = chunk.indexOf('\n')
        if (nl !== -1) {
          parts.push(chunk.slice(0, nl))
          return parts.join('').trim()
        }

        parts.push(chunk)
        offset += bytesRead
      }

      const line = parts.join('').trim()
      return line.length > 0 ? line : null
    } finally {
      await fd.close()
    }
  } catch {
    return null
  }
}
