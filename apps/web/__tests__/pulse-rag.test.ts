import { describe, expect, it } from 'vitest'
import { buildPulseSystemPrompt } from '@/lib/pulse/rag'

const BASE_REQUEST = {
  prompt: 'summarize' as string,
  documentMarkdown: '# Doc' as string,
  selectedCollections: ['pulse'] as string[],
  threadSources: [] as string[],
  conversationHistory: [] as Array<{ role: 'user' | 'assistant'; content: string }>,
  agent: 'claude' as const,
}

describe('pulse rag prompt builder', () => {
  it('includes permission level', () => {
    const prompt = buildPulseSystemPrompt(
      { ...BASE_REQUEST, permissionLevel: 'accept-edits', model: 'sonnet' },
      [],
    )
    expect(prompt).toContain('Permission level: accept-edits')
  })

  it('includes citation snippets when provided', () => {
    const prompt = buildPulseSystemPrompt(
      { ...BASE_REQUEST, permissionLevel: 'plan', model: 'sonnet' },
      [
        {
          url: 'https://example.com',
          title: 'Example',
          snippet: 'Evidence text',
          collection: 'pulse',
          score: 0.9,
        },
      ],
    )
    expect(prompt).toContain('Evidence text')
  })

  it('includes prior conversation turns in the system prompt', () => {
    const prompt = buildPulseSystemPrompt(
      {
        ...BASE_REQUEST,
        conversationHistory: [
          { role: 'user', content: 'First user turn' },
          { role: 'assistant', content: 'First assistant turn' },
        ],
        permissionLevel: 'accept-edits',
        model: 'sonnet',
      },
      [],
    )
    expect(prompt).toContain(
      'Conversation history (oldest to newest, excluding the latest user message):',
    )
    expect(prompt).toContain('User: First user turn')
    expect(prompt).toContain('Assistant: First assistant turn')
  })

  it('bounds conversation history to recent turns', () => {
    const history = Array.from({ length: 30 }, (_, index) => ({
      role: (index % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `turn-${index}`,
    }))
    const prompt = buildPulseSystemPrompt(
      {
        ...BASE_REQUEST,
        conversationHistory: history,
        permissionLevel: 'accept-edits',
        model: 'sonnet',
      },
      [],
    )

    expect(prompt).not.toContain('turn-0')
    expect(prompt).toContain('turn-29')
  })

  it('truncates oversized document context', () => {
    const prompt = buildPulseSystemPrompt(
      {
        ...BASE_REQUEST,
        documentMarkdown: 'A'.repeat(5000),
        permissionLevel: 'bypass-permissions',
        model: 'sonnet',
      },
      [],
    )
    expect(prompt.length).toBeLessThan(8000)
  })
})
