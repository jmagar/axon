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

  it('parses modern response_item message payloads', () => {
    const raw = JSON.stringify({
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'output_text', text: 'Step one.' },
          { type: 'output_text', text: 'Step two.' },
        ],
      },
    })

    const result = parseCodexJsonl(raw)
    expect(result).toHaveLength(1)
    expect(result[0]?.role).toBe('assistant')
    expect(result[0]?.content).toContain('Step one.')
    expect(result[0]?.content).toContain('Step two.')
  })

  it('parses legacy root message records', () => {
    const raw = JSON.stringify({
      type: 'message',
      role: 'assistant',
      content: [{ type: 'input_text', text: 'Legacy assistant output' }],
    })

    const result = parseCodexJsonl(raw)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ role: 'assistant', content: 'Legacy assistant output' })
  })

  it('captures function calls and outputs into toolUses/blocks', () => {
    const raw = [
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Working on it...' }],
        },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call',
          call_id: 'call_1',
          name: 'exec_command',
          arguments: '{"cmd":"pwd"}',
        },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: 'call_1',
          output: '/home/jmagar/workspace/axon_rust',
        },
      }),
    ].join('\n')

    const result = parseCodexJsonl(raw)
    expect(result).toHaveLength(1)
    expect(result[0]?.toolUses?.[0]).toMatchObject({
      name: 'exec_command',
      toolCallId: 'call_1',
      status: 'completed',
    })
    expect(result[0]?.toolUses?.[0]?.content).toContain('/home/jmagar/workspace/axon_rust')
    expect(result[0]?.blocks?.some((b) => b.type === 'tool_use')).toBe(true)
  })
})
