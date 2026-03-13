import crypto from 'node:crypto'

/** Patterns that indicate a message is a system/handoff prompt, not real user input. */
export const SKIP_PATTERNS = [/^Respond as JSON/, /^I'm loading a previous/, /^## Context/]

const GENERIC_PROMPT_PATTERNS = [
  /^rollout session$/i,
  /^local command caveat$/i,
  /^axon$/i,
  /^assistant$/i,
  /^ok$/i,
  /^hi$/i,
  /^hello$/i,
]

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
 * Normalize user message content for session title/preview generation.
 * Returns `undefined` when the text is empty, generic, or looks like
 * system/handoff boilerplate rather than a substantive user prompt.
 */
export function normalizePromptPreview(raw: string): string | undefined {
  let text = raw.trim()
  if (!text) return undefined

  // Extract the actual user prompt when a system wrapper is prepended.
  const wrappedUser = text.match(/\[User message\]\s*([\s\S]*)$/i)
  if (wrappedUser?.[1]) {
    text = wrappedUser[1]
  }

  // Drop known handoff envelope blocks.
  text = text.replace(/^<system-handoff>[\s\S]*?<\/system-handoff>\s*/i, '')
  text = text.replace(/^\[System context[^\]]*\]\s*/i, '')
  text = text.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!text) return undefined

  if (SKIP_PATTERNS.some((re) => re.test(text))) return undefined
  if (GENERIC_PROMPT_PATTERNS.some((re) => re.test(text))) return undefined
  if (text.length > 500 && !/[.?!]/.test(text.slice(0, 200))) return undefined

  return text.length > 120 ? `${text.slice(0, 120)}…` : text
}

/**
 * Adaptive title/preview selector:
 * - Short chats: first substantive user prompt is usually the best title anchor.
 * - Longer chats: latest substantive prompt better reflects current topic.
 */
export function chooseAdaptivePromptPreview(candidates: string[]): string | undefined {
  if (candidates.length === 0) return undefined
  const unique = Array.from(new Set(candidates))
  if (unique.length === 0) return undefined
  const SHORT_CHAT_PROMPT_THRESHOLD = 3
  if (unique.length <= SHORT_CHAT_PROMPT_THRESHOLD) {
    return unique[0]
  }
  return unique[unique.length - 1]
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
  concurrency = Math.max(1, Math.floor(concurrency))
  if (!Number.isFinite(concurrency)) concurrency = 1
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
