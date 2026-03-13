import { describe, expect, it } from 'vitest'
import { createStreamParserState, extractToolResultText } from '@/app/api/pulse/chat/stream-parser'

describe('createStreamParserState', () => {
  it('returns a fresh state', () => {
    const state = createStreamParserState()
    expect(state.blocks).toEqual([])
    expect(state.toolUseIdToIdx.size).toBe(0)
    expect(state.toolUses).toEqual([])
    expect(state.nextToolSequence).toBe(1)
    expect(state.result).toBe('')
    expect(state.sessionId).toBeNull()
    expect(state.firstDeltaMs).toBeNull()
    expect(state.deltaCount).toBe(0)
  })
})

describe('extractToolResultText', () => {
  it('returns string input directly', () => {
    expect(extractToolResultText('hello')).toBe('hello')
  })

  it('returns empty string for null/undefined', () => {
    expect(extractToolResultText(null)).toBe('')
    expect(extractToolResultText(undefined)).toBe('')
  })

  it('returns empty string for non-array objects', () => {
    expect(extractToolResultText({ text: 'nope' })).toBe('')
  })

  it('extracts text from array of {text} objects', () => {
    const input = [{ text: 'line 1' }, { text: 'line 2' }]
    expect(extractToolResultText(input)).toBe('line 1\nline 2')
  })

  it('extracts nested content arrays', () => {
    const input = [{ content: [{ text: 'inner' }] }]
    expect(extractToolResultText(input)).toBe('inner')
  })

  it('skips non-object entries in the array', () => {
    const input = ['bare string', null, 42, { text: 'valid' }]
    expect(extractToolResultText(input)).toBe('valid')
  })

  it('handles empty array', () => {
    expect(extractToolResultText([])).toBe('')
  })

  it('ignores entries without text or content', () => {
    expect(extractToolResultText([{ other: 'field' }])).toBe('')
  })
})
