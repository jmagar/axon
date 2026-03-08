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
 * Decode ~/.claude/projects/ folder name back to a filesystem path candidate.
 * Claude CLI encodes the absolute path by replacing each '/' with '-'.
 * e.g. "-home-jmagar-workspace-axon_rust" → "/home/jmagar/workspace/axon_rust"
 * Note: hyphens in directory names are indistinguishable from path separators.
 * Use findGitRoot() after this to locate the actual git root.
 */
export function decodeProjectPath(folderName: string): string {
  return '/' + folderName.slice(1).replace(/-/g, '/')
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
    if (sshMatch) return sshMatch[1]

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
 */
export async function enrichWithGit(projectPath: string): Promise<GitMeta> {
  if (cache.has(projectPath)) return cache.get(projectPath)!

  const meta: GitMeta = {}

  try {
    await fs.promises.access(projectPath)

    const gitRoot = await findGitRoot(projectPath)
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
          branch.length > MAX_BRANCH_LENGTH ? branch.slice(0, MAX_BRANCH_LENGTH - 1) + '…' : branch
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
