import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { scanCodexSessions } from './codex-scanner'
import { scanGeminiSessions } from './gemini-scanner'
import type { SessionFile } from './session-scanner'
import {
  chooseAdaptivePromptPreview,
  mapWithConcurrency,
  normalizePromptPreview,
  sessionId,
} from './session-utils'

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

function extractAssistantCandidates(lines: string[]): string[] {
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

    const normalized = normalizePromptPreview(text)
    if (!normalized) continue
    candidates.push(normalized)
  }
  return candidates
}

async function extractPreviewLine(filePath: string): Promise<string | undefined> {
  try {
    const fd = await fs.open(filePath, 'r')
    try {
      const stat = await fd.stat()
      const headSize = 8 * 1024
      const tailSize = 128 * 1024
      const size = stat.size

      const headBuf = Buffer.allocUnsafe(Math.min(headSize, size))
      const headRead = await fd.read(headBuf, 0, headBuf.length, 0)
      const headLines = headBuf.subarray(0, headRead.bytesRead).toString('utf8').split('\n')
      const headCandidates = extractAssistantCandidates(headLines.slice(0, 200))

      const tailStart = size > tailSize ? size - tailSize : 0
      const tailBuf = Buffer.allocUnsafe(size - tailStart)
      const tailRead = await fd.read(tailBuf, 0, tailBuf.length, tailStart)
      const tailLines = tailBuf.subarray(0, tailRead.bytesRead).toString('utf8').split('\n')
      const tailCandidates = extractAssistantCandidates(tailLines.slice(-1200))

      const selected =
        chooseAdaptivePromptPreview(tailCandidates) ?? chooseAdaptivePromptPreview(headCandidates)
      return selected ? (selected.length > 80 ? `${selected.slice(0, 80)}…` : selected) : undefined
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
  const assistantProject = path.basename(assistantCwd)
  const projectName = encodePathToProjectName(assistantCwd)
  const projectRoot = path.join(os.homedir(), '.claude', 'projects')
  const primaryProjectPath = path.join(projectRoot, projectName)
  const projectPaths = new Set<string>([primaryProjectPath])

  try {
    const entries = await fs.readdir(projectRoot, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const name = entry.name
      if (name === projectName || name.endsWith('-assistant')) {
        projectPaths.add(path.join(projectRoot, name))
      }
    }
  } catch {
    // Project root may not exist yet; continue with explicit primary path.
  }

  const claudeResultsNested = await mapWithConcurrency(
    Array.from(projectPaths),
    async (projectPath) => {
      let fileNames: string[] = []
      try {
        await fs.access(projectPath)
        fileNames = await fs.readdir(projectPath)
      } catch {
        return [] as SessionFile[]
      }

      const jsonlFiles = fileNames.filter((name) => name.endsWith('.jsonl'))
      const scanned = await mapWithConcurrency<string, SessionFile | null>(
        jsonlFiles,
        async (fileName) => {
          const absolutePath = path.join(projectPath, fileName)
          try {
            const [stat, preview] = await Promise.all([
              fs.stat(absolutePath),
              extractPreviewLine(absolutePath),
            ])
            if (!stat.isFile()) return null
            return {
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
            } satisfies SessionFile
          } catch {
            return null
          }
        },
        8,
      )

      return scanned.filter((r): r is SessionFile => r !== null)
    },
    4,
  )
  const claudeResults = claudeResultsNested.flat()

  const [codexSessions, geminiSessions] = await Promise.all([
    scanCodexSessions(limit * 4),
    scanGeminiSessions(limit * 4),
  ])

  const filteredCodex = codexSessions.filter((s) => s.project === assistantProject)
  const filteredGemini = geminiSessions.filter((s) => s.project === assistantProject)

  const merged = [...claudeResults, ...filteredCodex, ...filteredGemini]

  const deduped = new Map<string, SessionFile>()
  for (const session of merged) {
    const key = `${session.agent}:${session.absolutePath}`
    const existing = deduped.get(key)
    if (!existing || session.mtimeMs > existing.mtimeMs) {
      deduped.set(key, session)
    }
  }

  return Array.from(deduped.values())
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
}
