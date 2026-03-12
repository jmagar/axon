import type { ParsedMessage } from './claude-jsonl-parser'

const MAX_LINE_BYTES = 512_000

type MutableParsedMessage = ParsedMessage & {
  blocks: NonNullable<ParsedMessage['blocks']>
  toolUses: NonNullable<ParsedMessage['toolUses']>
  chainOfThought: NonNullable<ParsedMessage['chainOfThought']>
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function extractTextFromContent(contentBlocks: unknown[]): string {
  let text = ''
  for (const block of contentBlocks) {
    const b = asObject(block)
    if (!b) continue
    const type = typeof b.type === 'string' ? b.type : ''
    if (type === 'input_text' || type === 'output_text' || type === 'text') {
      if (typeof b.text === 'string') text += `${b.text}\n`
    }
  }
  return text.trim()
}

function ensureAssistantMessage(messages: ParsedMessage[]): MutableParsedMessage {
  const last = messages[messages.length - 1]
  if (last && last.role === 'assistant') {
    return {
      ...last,
      blocks: [...(last.blocks ?? [])],
      toolUses: [...(last.toolUses ?? [])],
      chainOfThought: [...(last.chainOfThought ?? [])],
    }
  }
  return {
    role: 'assistant',
    content: '',
    blocks: [],
    toolUses: [],
    chainOfThought: [],
  }
}

function upsertAssistantMessage(messages: ParsedMessage[], next: MutableParsedMessage): void {
  const normalized: ParsedMessage = {
    role: 'assistant',
    content: next.content.trim(),
    ...(next.blocks.length > 0 ? { blocks: next.blocks } : {}),
    ...(next.toolUses.length > 0 ? { toolUses: next.toolUses } : {}),
    ...(next.chainOfThought.length > 0 ? { chainOfThought: next.chainOfThought } : {}),
  }
  const last = messages[messages.length - 1]
  if (last && last.role === 'assistant') {
    messages[messages.length - 1] = normalized
  } else {
    messages.push(normalized)
  }
}

function parseLegacyRootMessage(val: Record<string, unknown>): ParsedMessage | null {
  if (val.type !== 'message') return null
  const role = val.role
  if (role !== 'user' && role !== 'assistant') return null
  const contentBlocks = val.content
  if (!Array.isArray(contentBlocks)) return null
  const text = extractTextFromContent(contentBlocks)
  if (!text) return null
  const sourceMessageId = typeof val.id === 'string' ? val.id : undefined
  return { role, content: text, ...(sourceMessageId ? { sourceMessageId } : {}) }
}

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

    const legacy = parseLegacyRootMessage(val)
    if (legacy) {
      messages.push(legacy)
      continue
    }

    if (val.type !== 'response_item') continue
    const payload = asObject(val.payload)
    if (!payload) continue

    const payloadType = typeof payload.type === 'string' ? payload.type : ''

    if (payloadType === 'function_call') {
      const toolName = typeof payload.name === 'string' ? payload.name : 'tool'
      const toolCallId = typeof payload.call_id === 'string' ? payload.call_id : undefined
      const toolInputRaw =
        typeof payload.arguments === 'string'
          ? (() => {
              try {
                const parsed = JSON.parse(payload.arguments) as unknown
                return asObject(parsed)
              } catch {
                return null
              }
            })()
          : null
      const toolInput = toolInputRaw ?? {}
      const assistant = ensureAssistantMessage(messages)
      assistant.toolUses.push({ name: toolName, input: toolInput, toolCallId, status: 'running' })
      assistant.blocks.push({
        type: 'tool_use',
        name: toolName,
        input: toolInput,
        toolCallId,
        status: 'running',
      })
      upsertAssistantMessage(messages, assistant)
      continue
    }

    if (payloadType === 'function_call_output') {
      const toolCallId = typeof payload.call_id === 'string' ? payload.call_id : undefined
      const output = typeof payload.output === 'string' ? payload.output : ''
      const assistant = ensureAssistantMessage(messages)
      const idx = assistant.toolUses.findLastIndex((tool) => tool.toolCallId === toolCallId)
      if (idx >= 0) {
        const existing = assistant.toolUses[idx]
        assistant.toolUses[idx] = {
          ...existing,
          status: 'completed',
          content: output
            ? existing.content
              ? `${existing.content}${output}`
              : output
            : existing.content,
        }
      }
      const blockIdx = assistant.blocks.findLastIndex(
        (block) => block.type === 'tool_use' && block.toolCallId === toolCallId,
      )
      if (blockIdx >= 0) {
        const block = assistant.blocks[blockIdx]
        if (block.type === 'tool_use') {
          assistant.blocks[blockIdx] = {
            ...block,
            status: 'completed',
            content: output
              ? block.content
                ? `${block.content}${output}`
                : output
              : block.content,
          }
        }
      }
      upsertAssistantMessage(messages, assistant)
      continue
    }

    if (payloadType === 'reasoning') {
      const summary = Array.isArray(payload.summary)
        ? payload.summary
            .filter((entry): entry is Record<string, unknown> => Boolean(asObject(entry)))
            .map((entry) => (typeof entry.text === 'string' ? entry.text : ''))
            .filter((text) => text.length > 0)
        : []
      if (summary.length > 0) {
        const assistant = ensureAssistantMessage(messages)
        assistant.chainOfThought.push(...summary)
        for (const step of summary) {
          assistant.blocks.push({ type: 'thinking', content: step })
        }
        upsertAssistantMessage(messages, assistant)
      }
      continue
    }

    const role = payload.role
    if (role !== 'user' && role !== 'assistant') continue

    const contentBlocks = payload.content
    if (!Array.isArray(contentBlocks)) continue

    const text = extractTextFromContent(contentBlocks)

    if (text) {
      const sourceMessageId =
        typeof val.id === 'string'
          ? val.id
          : typeof payload.id === 'string'
            ? payload.id
            : undefined
      messages.push({
        role: role as 'user' | 'assistant',
        content: text,
        ...(sourceMessageId ? { sourceMessageId } : {}),
      })
    }
  }

  return messages
}
