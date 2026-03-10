import type { ParsedMessage } from './claude-jsonl-parser'

const MAX_LINE_BYTES = 512_000

/**
 * Parse Codex JSONL session content into structured messages.
 * Codex uses type:'response_item' lines with payload.role + payload.content[].
 * Pure function — no I/O.
 */
export function parseCodexJsonl(raw: string): ParsedMessage[] {
  const messages: ParsedMessage[] = []

  const sanitized = raw.replace(/\0/g, '')
  for (const line of sanitized.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (Buffer.byteLength(trimmed, 'utf8') > MAX_LINE_BYTES) continue

    let val: Record<string, unknown>
    try {
      val = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      continue
    }

    if (val.type !== 'response_item') continue
    const payload = val.payload as Record<string, unknown> | undefined
    if (!payload) continue

    const role = payload.role
    if (role !== 'user' && role !== 'assistant') continue

    const contentBlocks = payload.content
    if (!Array.isArray(contentBlocks)) continue

    let text = ''
    for (const block of contentBlocks) {
      if (!block || typeof block !== 'object') continue
      const b = block as Record<string, unknown>
      if (b.type === 'input_text' || b.type === 'text') {
        if (typeof b.text === 'string') text += `${b.text}\n`
      }
    }

    if (text.trim()) {
      messages.push({ role: role as 'user' | 'assistant', content: text.trim() })
    }
  }

  return messages
}
