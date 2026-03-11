import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SessionFile } from './session-scanner'
import { mapWithConcurrency, sessionId } from './session-utils'

/**
 * Encode an absolute path into the Claude projects naming convention
 * by replacing `/` with `-`.
 */
function encodePathToProjectName(absPath: string): string {
  return absPath.replace(/\//g, '-')
}

/**
 * Resolve assistant-mode CWD from AXON_DATA_DIR.
 * Falls back to ~/.local/share/axon/axon/assistant when AXON_DATA_DIR is unset.
 */
function resolveAssistantCwd(): string {
  const dataDir = process.env.AXON_DATA_DIR
  if (dataDir) {
    return path.join(dataDir, 'axon', 'assistant')
  }
  return path.join(os.homedir(), '.local', 'share', 'axon', 'axon', 'assistant')
}

async function extractPreviewLine(filePath: string): Promise<string | undefined> {
  try {
    const fd = await fs.open(filePath, 'r')
    try {
      const buf = Buffer.allocUnsafe(4096)
      const { bytesRead } = await fd.read(buf, 0, 4096, 0)
      const chunk = buf.subarray(0, bytesRead).toString('utf8')
      for (const line of chunk.split('\n').slice(0, 20)) {
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
        const content = msg?.content
        let text = ''
        if (typeof content === 'string') {
          text = content
        } else if (Array.isArray(content)) {
          for (const block of content) {
            const blockText = (block as Record<string, unknown>).text
            if (typeof blockText === 'string') text += `${blockText}\n`
          }
        }

        text = text.trim().replace(/\n+/g, ' ')
        if (!text) continue
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
 * Scan assistant sessions from the assistant CWD project directory in ~/.claude/projects.
 * Returns up to `limit` sessions sorted by mtime descending.
 */
export async function scanAssistantSessions(limit = 50): Promise<SessionFile[]> {
  const assistantCwd = resolveAssistantCwd()
  const projectName = encodePathToProjectName(assistantCwd)
  const projectRoot = path.join(os.homedir(), '.claude', 'projects')
  const projectPath = path.join(projectRoot, projectName)

  try {
    await fs.access(projectPath)
  } catch {
    return []
  }

  let fileNames: string[]
  try {
    fileNames = await fs.readdir(projectPath)
  } catch {
    return []
  }

  const jsonlFiles = fileNames.filter((name) => name.endsWith('.jsonl'))

  const results = await mapWithConcurrency<string, SessionFile | null>(
    jsonlFiles,
    async (fileName) => {
      const absolutePath = path.join(projectPath, fileName)
      try {
        const [stat, preview] = await Promise.all([fs.stat(absolutePath), extractPreviewLine(absolutePath)])
        if (!stat.isFile()) return null
        const session: SessionFile = {
          id: sessionId(absolutePath),
          absolutePath,
          project: 'assistant',
          filename: fileName.slice(0, -'.jsonl'.length),
          mtimeMs: stat.mtimeMs,
          sizeBytes: stat.size,
          preview,
          repo: undefined,
          branch: undefined,
          agent: 'claude',
        }
        return session
      } catch {
        return null
      }
    },
    8,
  )

  return results
    .filter((r): r is SessionFile => r !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
}
