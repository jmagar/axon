import { type ModeId, NO_INPUT_MODES } from '@/lib/ws-protocol'

export function shouldPreservePulseWorkspaceForMode(
  workspaceMode: string | null,
  execMode: ModeId,
): boolean {
  return (
    workspaceMode === 'pulse' &&
    (execMode === 'scrape' || execMode === 'crawl' || execMode === 'extract')
  )
}

export function isUrlLikeToken(token: string): boolean {
  if (!token) return false
  if (/^https?:\/\//i.test(token)) return true
  if (token.includes('@')) return false
  return /^[a-z0-9.-]+\.[a-z]{2,}(?:[/:?#].*)?$/i.test(token)
}

export function shouldRunCommandForInput(selectedMode: ModeId, rawInput: string): boolean {
  const trimmed = rawInput.trim()
  if (!trimmed) return NO_INPUT_MODES.has(selectedMode)
  const firstToken = trimmed.split(/\s+/)[0] ?? ''
  return isUrlLikeToken(firstToken)
}

export function normalizeUrlInput(rawInput: string): string {
  const trimmed = rawInput.trim()
  const firstToken = trimmed.split(/\s+/)[0] ?? ''
  if (!trimmed || /^https?:\/\//i.test(firstToken)) return trimmed
  if (!isUrlLikeToken(firstToken)) return trimmed
  if (firstToken !== trimmed) return trimmed
  return `https://${trimmed}`
}

export const PLACEHOLDER_TEXTS = [
  '@mention a tool or just start talking',
  'scrape https://docs.example.com',
  'ask what causes high latency in Qdrant',
  'crawl docs.astral.sh/ruff',
  'query semantic search patterns',
  'embed ./data/knowledge-base',
]
