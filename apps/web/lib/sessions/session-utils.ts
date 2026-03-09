import crypto from 'node:crypto'

/** Patterns that indicate a message is a system/handoff prompt, not real user input. */
export const SKIP_PATTERNS = [/^Respond as JSON/, /^I'm loading a previous/, /^## Context/]

// Words that indicate a suffix rather than the project name itself.
const SUFFIX_WORDS = new Set(['rust', 'rs', 'git', 'main', 'master', 'src'])

/**
 * Port of clean_claude_project_name from crates/ingest/sessions/claude.rs.
 * Converts a directory name like "-home-jmagar-workspace-axon-rust" to
 * a human-readable project name like "axon-rust".
 */
export function cleanProjectName(dirName: string): string {
  if (!dirName.includes('-')) return dirName
  const parts = dirName.replace(/^-+/, '').split('-').filter(Boolean)
  if (parts.length === 0) return dirName
  if (parts.length === 1) return parts[0] ?? dirName

  const last = parts[parts.length - 1] ?? ''
  const prev = parts[parts.length - 2] ?? ''

  return SUFFIX_WORDS.has(last) ? prev : `${prev}-${last}`
}

export function sessionId(absolutePath: string): string {
  return crypto.createHash('sha256').update(absolutePath).digest('hex').slice(0, 12)
}

/**
 * Run `fn` over each item with at most `concurrency` tasks in flight at once.
 * Preserves order of results relative to the input array.
 */
export async function mapWithConcurrency<T, R>(
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
