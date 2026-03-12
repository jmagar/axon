import { describe, expect, it } from 'vitest'
import { stripEditorBlocks } from '@/components/shell/axon-editor-artifact'

describe('stripEditorBlocks', () => {
  it('strips a basic editor block leaving an empty string', () => {
    expect(stripEditorBlocks('<axon:editor>replace</axon:editor>')).toBe('')
  })

  it('strips a block with attributes', () => {
    expect(stripEditorBlocks('<axon:editor op="replace">content</axon:editor>')).toBe('')
  })

  it('strips a block embedded in surrounding text preserving that text', () => {
    const input = 'before <axon:editor>block</axon:editor> after'
    // trim() removes no leading/trailing whitespace here; two spaces remain in middle
    expect(stripEditorBlocks(input)).toBe('before  after')
  })

  it('strips multiple editor blocks in one string', () => {
    const input =
      'A <axon:editor>first</axon:editor> B <axon:editor op="append">second</axon:editor> C'
    expect(stripEditorBlocks(input)).toBe('A  B  C')
  })

  it('strips a block with multiline content (\\n in body)', () => {
    const input = '<axon:editor op="replace">\n# Title\n\nParagraph\n</axon:editor>'
    expect(stripEditorBlocks(input)).toBe('')
  })

  it('does not strip non-axon XML tags', () => {
    const input = '<other:tag>content</other:tag>'
    expect(stripEditorBlocks(input)).toBe('<other:tag>content</other:tag>')
  })

  it('does not strip an unclosed axon:editor tag (no closing tag present)', () => {
    // The closing </axon:editor> is required for the regex to match.
    const input = '<axon:editor>no closing tag'
    expect(stripEditorBlocks(input)).toBe('<axon:editor>no closing tag')
  })

  it('returns empty string for empty input', () => {
    expect(stripEditorBlocks('')).toBe('')
  })

  it('returns the original string unchanged when no editor blocks are present', () => {
    expect(stripEditorBlocks('just plain text')).toBe('just plain text')
  })
})
