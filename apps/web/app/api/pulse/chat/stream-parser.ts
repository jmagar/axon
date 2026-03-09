import type { PulseMessageBlock, PulseToolUse } from '@/lib/pulse/types'

export type StreamParserState = {
  blocks: PulseMessageBlock[]
  toolUseIdToIdx: Map<string, number>
  toolUses: PulseToolUse[]
  result: string
  sessionId: string | null
  firstDeltaMs: number | null
  deltaCount: number
}

export function createStreamParserState(): StreamParserState {
  return {
    blocks: [],
    toolUseIdToIdx: new Map<string, number>(),
    toolUses: [],
    result: '',
    sessionId: null,
    firstDeltaMs: null,
    deltaCount: 0,
  }
}

// Pure function — never throws. Handles all malformed shapes by returning ''.
export function extractToolResultText(raw: unknown): string {
  try {
    if (typeof raw === 'string') return raw
    if (!Array.isArray(raw)) return ''
    return (raw as Array<unknown>)
      .map((entry) => {
        if (typeof entry !== 'object' || entry === null) return ''
        const obj = entry as Record<string, unknown>
        if (typeof obj.text === 'string') return obj.text
        if (Array.isArray(obj.content)) {
          return (obj.content as Array<unknown>)
            .map((inner) => {
              if (typeof inner !== 'object' || inner === null) return ''
              const i = inner as Record<string, unknown>
              return typeof i.text === 'string' ? i.text : ''
            })
            .filter(Boolean)
            .join('\n')
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  } catch {
    return ''
  }
}
