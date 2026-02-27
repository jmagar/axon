export interface ParsedMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Parse Claude Code JSONL session content into structured messages.
 * Port of the Rust logic in crates/ingest/sessions/claude.rs.
 * Pure function — no I/O.
 */
export function parseClaudeJsonl(raw: string): ParsedMessage[] {
  const messages: ParsedMessage[] = []

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue

    let val: Record<string, unknown>
    try {
      val = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      continue
    }

    const type = val.type
    if (type !== 'user' && type !== 'assistant') continue
    const role = type as 'user' | 'assistant'

    const msg = val.message as Record<string, unknown> | undefined
    const msgContent = msg?.content

    let text = ''
    if (typeof msgContent === 'string') {
      text = msgContent
    } else if (Array.isArray(msgContent)) {
      for (const block of msgContent) {
        const blockText = (block as Record<string, unknown>).text
        if (typeof blockText === 'string') text += `${blockText}\n`
      }
    } else {
      continue
    }

    if (text.trim()) {
      messages.push({ role, content: text.trim() })
    }
  }

  return messages
}
