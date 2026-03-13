import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const CLAUDE_TIMEOUT_MS = 300_000 // 5 min — agentic research tasks need room to breathe

// The `claude` CLI always injects ~/.claude/CLAUDE.md (global instructions) into every subprocess
// regardless of cwd. Cache the size once at module load so we can include it in context accounting.
let _globalClaudeMdChars = 0
try {
  _globalClaudeMdChars = fs.statSync(path.join(os.homedir(), '.claude', 'CLAUDE.md')).size
} catch {
  // File absent or unreadable — treat as 0.
}
export const GLOBAL_CLAUDE_MD_CHARS = _globalClaudeMdChars

// Context budget in chars: 200k token window × ~4 chars/token = 800k chars.
// We measure everything we actually send to the ACP adapter in chars (system prompt,
// CLAUDE.md, user content) and express it as a fraction of this budget.
export const MODEL_CONTEXT_BUDGET_CHARS = 800_000

export const HEARTBEAT_INTERVAL_MS = 5_000

export function computeContextCharsTotal(params: {
  globalClaudeMdChars: number
  systemPromptChars: number
  promptLength: number
  documentMarkdownLength: number
  citationSnippets: string[]
  threadSources: string[]
  conversationHistory: Array<{ content: string }>
}): number {
  const citationChars = params.citationSnippets.reduce(
    (total, snippet) => total + snippet.length,
    0,
  )
  const threadSourceChars = params.threadSources.reduce((total, source) => total + source.length, 0)
  const conversationChars = params.conversationHistory.reduce(
    (total, entry) => total + entry.content.length,
    0,
  )
  return (
    params.globalClaudeMdChars +
    params.systemPromptChars +
    params.promptLength +
    params.documentMarkdownLength +
    conversationChars +
    citationChars +
    threadSourceChars
  )
}
