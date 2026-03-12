import { describe, expect, it } from 'vitest'
import { parseGeminiJson } from '@/lib/sessions/gemini-json-parser'

describe('parseGeminiJson', () => {
  it('parses plain string content', () => {
    const raw = JSON.stringify({ messages: [{ type: 'user', content: 'Hello Gemini' }] })
    const result = parseGeminiJson(raw)
    expect(result).toEqual([{ role: 'user', content: 'Hello Gemini' }])
  })

  it('parses structured array content', () => {
    const raw = JSON.stringify({
      messages: [
        {
          role: 'assistant',
          content: [{ text: 'First' }, { text: 'Second' }],
        },
      ],
    })
    const result = parseGeminiJson(raw)
    expect(result).toEqual([{ role: 'assistant', content: 'First\nSecond' }])
  })

  it('preserves source message id when available', () => {
    const raw = JSON.stringify({
      messages: [{ id: 'gem-1', type: 'assistant', content: 'Done' }],
    })
    const result = parseGeminiJson(raw)
    expect(result[0]).toMatchObject({ sourceMessageId: 'gem-1' })
  })
})
