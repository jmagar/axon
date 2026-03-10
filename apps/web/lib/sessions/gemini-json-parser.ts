import type { ParsedMessage } from './claude-jsonl-parser'

interface GeminiRawMessage {
  type?: string
  role?: string
  content?: string
}

/**
 * Parse a Gemini session JSON file into structured messages.
 * Gemini session format: { messages: [{ type: 'user'|'assistant', content: string }] }
 * Pure function — no I/O.
 */
export function parseGeminiJson(raw: string): ParsedMessage[] {
  const messages: ParsedMessage[] = []

  let data: { messages?: GeminiRawMessage[] }
  try {
    data = JSON.parse(raw) as { messages?: GeminiRawMessage[] }
  } catch {
    return messages
  }

  for (const msg of data.messages ?? []) {
    const role = (msg.type ?? msg.role ?? '') as string
    if (role !== 'user' && role !== 'assistant') continue
    if (typeof msg.content !== 'string') continue
    const content = msg.content.trim()
    if (content) {
      messages.push({ role: role as 'user' | 'assistant', content })
    }
  }

  return messages
}
