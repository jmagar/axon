import type { ParsedMessage } from './claude-jsonl-parser'

interface GeminiRawMessage {
  type?: string
  role?: string
  id?: string
  content?: string | Array<Record<string, unknown>>
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

  if (!data || typeof data !== 'object' || !Array.isArray(data.messages)) return messages

  for (const msg of data.messages) {
    const role = (msg.type ?? msg.role ?? '') as string
    if (role !== 'user' && role !== 'assistant') continue
    const content =
      typeof msg.content === 'string'
        ? msg.content.trim()
        : Array.isArray(msg.content)
          ? msg.content
              .map((part) => (typeof part?.text === 'string' ? part.text : ''))
              .filter((part) => part.length > 0)
              .join('\n')
              .trim()
          : ''
    if (content) {
      messages.push({
        role: role as 'user' | 'assistant',
        content,
        ...(typeof msg.id === 'string' && msg.id ? { sourceMessageId: msg.id } : {}),
      })
    }
  }

  return messages
}
