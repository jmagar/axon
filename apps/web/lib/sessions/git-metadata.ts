import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const MAX_BRANCH_LENGTH = 40

export interface GitMeta {
  repo?: string
  branch?: string
}

// Module-level cache: project path → enriched metadata
const cache = new Map<string, GitMeta>()

/**
 * Decode ~/.claude/projects/ folder name back to filesystem path candidates.
 * Claude CLI encodes the absolute path by replacing each '/' with '-'.
 * e.g. "-home-jmagar-workspace-axon_rust" → "/home/jmagar/workspace/axon_rust"
 *
 * Because hyphens in directory names are encoded identically to path separators,
 * a single lossless decode is not possible. This function returns the naively
 * decoded path (all '-' treated as '/') which works for the common case.
 * For paths containing real hyphens, callers should iterate over `decodedProjectPathCandidates`
 * and try each candidate with `findGitRoot` until one resolves.
 */
export function decodeProjectPath(folderName: string): string {
  // Strip the leading '-' that represents the root '/', then replace remaining
  // '-' with '/'. This is the naive decode that works when directory names
  // contain no hyphens.
  const encoded = folderName.startsWith('-') ? folderName.slice(1) : folderName
  return `/${encoded.replace(/-/g, '/')}`
}

/**
 * Generate path candidates for a Claude projects folder name by trying different
 * interpretations of '-' as either '/' (path separator) or '-' (literal hyphen).
 * Returns candidates sorted from most-specific (fewest slashes) to least.
 * Use with `findGitRoot` to find the actual git root.
 *
 * For performance, only generates candidates up to MAX_CANDIDATES to avoid
 * exponential blowup on paths with many hyphens.
 */
const MAX_CANDIDATES = 16

export function decodedProjectPathCandidates(folderName: string): string[] {
  const encoded = folderName.startsWith('-') ? folderName.slice(1) : folderName
  const parts = encoded.split('-')
  const candidates = new Set<string>()

  // Always include the naive full-split (all hyphens are path separators)
  candidates.add(`/${parts.join('/')}`)

  // Generate variants by merging adjacent parts with a literal '-'
  // Limit to a reasonable number of candidates to avoid exponential growth
  const queue: string[][] = [parts]
  while (queue.length > 0 && candidates.size < MAX_CANDIDATES) {
    const current = queue.shift()!
    for (let i = 0; i < current.length - 1; i++) {
      const merged = [
        ...current.slice(0, i),
        `${current[i]}-${current[i + 1]}`,
        ...current.slice(i + 2),
      ]
      const candidate = `/${merged.join('/')}`
      if (!candidates.has(candidate)) {
        candidates.add(candidate)
        if (candidates.size < MAX_CANDIDATES) {
          queue.push(merged)
        }
      }
    }
  }

  return Array.from(candidates)
}

/**
 * Walk up from startPath looking for a .git directory.
 * Returns the repo root path, or null if not found.
 */
export async function findGitRoot(startPath: string): Promise<string | null> {
  let current = startPath
  const root = path.parse(current).root

  while (current !== root) {
    try {
      await fs.promises.access(path.join(current, '.git'))
      return current
    } catch {
      current = path.dirname(current)
    }
  }
  return null
}

/**
 * Parse a git remote URL (HTTPS or SSH) into "owner/repo" format.
 */
export function parseRemoteUrl(url: string): string | null {
  try {
    // SSH: git@github.com:owner/repo.git
    const sshMatch = url.match(/^git@[^:]+:(.+?)(?:\.git)?$/)
    // sshMatch[1] is always defined when the match succeeds (capture group 1)
    if (sshMatch) return sshMatch[1]!

    // HTTPS: https://github.com/owner/repo.git
    const parsed = new URL(url)
    const parts = parsed.pathname.replace(/^\//, '').replace(/\.git$/, '')
    if (parts.includes('/')) return parts
    return null
  } catch {
    return null
  }
}

/**
 * Enrich a session with git metadata derived from its project filesystem path.
 * Results are cached per projectPath for the process lifetime.
 * Never throws — returns {} on any error.
 *
 * When `projectPath` does not exist on disk (which can happen when the decoded
 * path contains hyphenated directory names that were conflated with path
 * separators), the function falls back to trying alternative path candidates
 * from `decodedProjectPathCandidates` if a `folderName` is provided.
 */
export async function enrichWithGit(projectPath: string, folderName?: string): Promise<GitMeta> {
  if (cache.has(projectPath)) return cache.get(projectPath)!

  const meta: GitMeta = {}

  // Try the primary path; if it does not exist, fall back to alternative
  // candidates derived from the folder name (when provided).  This handles
  // hyphenated directory names that are otherwise indistinguishable from path
  // separators in the Claude CLI encoding.
  let resolvedPath = projectPath
  try {
    await fs.promises.access(projectPath)
  } catch {
    if (folderName) {
      const candidates = decodedProjectPathCandidates(folderName)
      for (const candidate of candidates) {
        if (candidate === projectPath) continue
        try {
          await fs.promises.access(candidate)
          resolvedPath = candidate
          break
        } catch {
          /* try next candidate */
        }
      }
    }
  }

  try {
    await fs.promises.access(resolvedPath)

    const gitRoot = await findGitRoot(resolvedPath)
    if (!gitRoot) {
      cache.set(projectPath, meta)
      return meta
    }

    const opts = { cwd: gitRoot, timeout: 3000 }

    try {
      const { stdout: branchOut } = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], opts)
      const branch = branchOut.trim()
      if (branch && branch !== 'HEAD') {
        meta.branch =
          branch.length > MAX_BRANCH_LENGTH ? `${branch.slice(0, MAX_BRANCH_LENGTH - 1)}…` : branch
      }
    } catch {
      /* detached HEAD or no commits */
    }

    try {
      const { stdout: remoteOut } = await exec('git', ['remote', 'get-url', 'origin'], opts)
      const parsed = parseRemoteUrl(remoteOut.trim())
      if (parsed) meta.repo = parsed
    } catch {
      /* no remote */
    }
  } catch {
    /* path doesn't exist or git not available */
  }

  cache.set(projectPath, meta)
  return meta
}
