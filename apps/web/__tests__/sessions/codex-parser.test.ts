import { describe, expect, it } from 'vitest'
import { parseCodexJsonl } from '@/lib/sessions/codex-jsonl-parser'

function responseLine(role: string, texts: string[]): string {
  return JSON.stringify({
    type: 'response_item',
    payload: {
      role,
      content: texts.map((text) => ({ type: 'input_text', text })),
    },
  })
}

function sessionMetaLine(cwd: string): string {
  return JSON.stringify({ type: 'session_meta', payload: { cwd, id: 'abc-123' } })
}

function eventMsgLine(msg: string): string {
  return JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: msg } })
}

describe('parseCodexJsonl', () => {
  it('returns [] for empty string', () => {
    expect(parseCodexJsonl('')).toEqual([])
  })

  it('extracts user message from response_item', () => {
    const raw = responseLine('user', ['Hello from user'])
    const result = parseCodexJsonl(raw)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ role: 'user', content: 'Hello from user' })
  })

  it('extracts assistant message from response_item', () => {
    const raw = responseLine('assistant', ['Here is my answer'])
    const result = parseCodexJsonl(raw)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ role: 'assistant', content: 'Here is my answer' })
  })

  it('concatenates multiple content blocks', () => {
    const raw = responseLine('user', ['First part', 'Second part'])
    const result = parseCodexJsonl(raw)
    expect(result).toHaveLength(1)
    expect(result[0]?.content).toContain('First part')
    expect(result[0]?.content).toContain('Second part')
  })

  it('skips session_meta lines', () => {
    const raw = [
      sessionMetaLine('/home/user/project'),
      responseLine('user', ['Real message']),
    ].join('\n')
    const result = parseCodexJsonl(raw)
    expect(result).toHaveLength(1)
    expect(result[0]?.content).toBe('Real message')
  })

  it('skips event_msg lines', () => {
    const raw = [eventMsgLine('user input'), responseLine('assistant', ['Response'])].join('\n')
    const result = parseCodexJsonl(raw)
    expect(result).toHaveLength(1)
    expect(result[0]?.role).toBe('assistant')
  })

  it('skips lines with unknown role', () => {
    const raw = JSON.stringify({ type: 'response_item', payload: { role: 'system', content: [] } })
    expect(parseCodexJsonl(raw)).toEqual([])
  })

  it('skips lines with empty content', () => {
    const raw = JSON.stringify({
      type: 'response_item',
      payload: { role: 'user', content: [{ type: 'input_text', text: '   ' }] },
    })
    expect(parseCodexJsonl(raw)).toEqual([])
  })

  it('handles multiple messages in sequence', () => {
    const raw = [
      responseLine('user', ['Question?']),
      responseLine('assistant', ['Answer.']),
      responseLine('user', ['Follow up?']),
    ].join('\n')
    const result = parseCodexJsonl(raw)
    expect(result).toHaveLength(3)
    expect(result[0]?.role).toBe('user')
    expect(result[1]?.role).toBe('assistant')
    expect(result[2]?.role).toBe('user')
  })
})
