import type { PulseMessageBlock, PulseToolUse } from '@/lib/pulse/types'

export interface ParsedMessage {
  role: 'user' | 'assistant'
  content: string
  sourceMessageId?: string
  blocks?: PulseMessageBlock[]
  toolUses?: PulseToolUse[]
  chainOfThought?: string[]
}

/** Maximum byte length of a single JSONL line we are willing to parse. */
const MAX_LINE_BYTES = 512_000 // 512 KB

/**
 * Parse Claude Code JSONL session content into structured messages.
 * Port of the Rust logic in crates/ingest/sessions/claude.rs.
 * Pure function — no I/O.
 */
export function parseClaudeJsonl(raw: string): ParsedMessage[] {
  const messages: ParsedMessage[] = []

  // Strip null bytes before any further processing.
  const sanitized = raw.replace(/\0/g, '')
  for (const line of sanitized.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // Reject lines that exceed the per-line size cap.
    // Buffer.byteLength counts UTF-8 bytes, not UTF-16 code units, so multi-byte
    // characters are correctly accounted for (trimmed.length would undercount them).
    if (Buffer.byteLength(trimmed, 'utf8') > MAX_LINE_BYTES) continue

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
    const blocks: PulseMessageBlock[] = []
    const toolUses: PulseToolUse[] = []
    const chainOfThought: string[] = []
    if (typeof msgContent === 'string') {
      text = msgContent
    } else if (Array.isArray(msgContent)) {
      for (const block of msgContent) {
        const blockObj = block as Record<string, unknown>
        const blockType = typeof blockObj.type === 'string' ? blockObj.type : ''
        const blockText = blockObj.text
        if (typeof blockText === 'string') text += `${blockText}\n`
        if (blockType === 'thinking' && typeof blockText === 'string' && blockText.trim()) {
          chainOfThought.push(blockText)
          blocks.push({ type: 'thinking', content: blockText })
        }
        if (blockType === 'tool_use') {
          const name = typeof blockObj.name === 'string' ? blockObj.name : 'tool'
          const toolCallId = typeof blockObj.id === 'string' ? blockObj.id : undefined
          const input =
            blockObj.input && typeof blockObj.input === 'object' && !Array.isArray(blockObj.input)
              ? (blockObj.input as Record<string, unknown>)
              : {}
          toolUses.push({ name, input, toolCallId, status: 'running' })
          blocks.push({ type: 'tool_use', name, input, toolCallId, status: 'running' })
        }
      }
    } else {
      continue
    }

    if (text.trim()) {
      const sourceMessageId =
        typeof val.id === 'string' ? val.id : typeof val.uuid === 'string' ? val.uuid : undefined
      messages.push({
        role,
        content: text.trim(),
        ...(sourceMessageId ? { sourceMessageId } : {}),
        ...(blocks.length > 0 ? { blocks } : {}),
        ...(toolUses.length > 0 ? { toolUses } : {}),
        ...(chainOfThought.length > 0 ? { chainOfThought } : {}),
      })
    }
  }

  return messages
}
