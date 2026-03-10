import { describe, expect, it, vi } from 'vitest'
import { handleEditorMsg } from '@/hooks/use-axon-acp'

describe('useAxonAcp editor_update handling', () => {
  it('calls onEditorUpdate with content and replace operation', () => {
    const onEditorUpdate = vi.fn()
    handleEditorMsg(
      { type: 'editor_update', content: '# README', operation: 'replace' },
      onEditorUpdate,
      undefined,
    )
    expect(onEditorUpdate).toHaveBeenCalledWith('# README', 'replace')
    expect(onEditorUpdate).toHaveBeenCalledTimes(1)
  })

  it('calls onEditorUpdate with append operation', () => {
    const onEditorUpdate = vi.fn()
    handleEditorMsg(
      { type: 'editor_update', content: '## New', operation: 'append' },
      onEditorUpdate,
      undefined,
    )
    expect(onEditorUpdate).toHaveBeenCalledWith('## New', 'append')
  })

  it('defaults operation to replace when missing', () => {
    const onEditorUpdate = vi.fn()
    handleEditorMsg({ type: 'editor_update', content: '# Hello' }, onEditorUpdate, undefined)
    expect(onEditorUpdate).toHaveBeenCalledWith('# Hello', 'replace')
  })

  it('defaults operation to replace for unknown values', () => {
    const onEditorUpdate = vi.fn()
    handleEditorMsg(
      { type: 'editor_update', content: 'x', operation: 'invalid' },
      onEditorUpdate,
      undefined,
    )
    // Zod rejects 'invalid' — safeParse fails, so onEditorUpdate is not called.
    expect(onEditorUpdate).not.toHaveBeenCalled()
  })

  it('does nothing when onEditorUpdate is not provided', () => {
    // Should not throw
    expect(() =>
      handleEditorMsg(
        { type: 'editor_update', content: '# x', operation: 'replace' },
        undefined,
        undefined,
      ),
    ).not.toThrow()
  })

  it('ignores non-editor_update messages', () => {
    const onEditorUpdate = vi.fn()
    handleEditorMsg({ type: 'assistant_delta', delta: 'hello' }, onEditorUpdate, undefined)
    // Zod validation fails for non-editor_update type — onEditorUpdate not called.
    expect(onEditorUpdate).not.toHaveBeenCalled()
  })

  it('calls onShowEditor when an editor_update is received', () => {
    const onEditorUpdate = vi.fn()
    const onShowEditor = vi.fn()
    handleEditorMsg(
      { type: 'editor_update', content: '# Doc', operation: 'replace' },
      onEditorUpdate,
      onShowEditor,
    )
    expect(onShowEditor).toHaveBeenCalledTimes(1)
  })

  it('does not call onShowEditor when validation fails', () => {
    const onShowEditor = vi.fn()
    handleEditorMsg({ type: 'other_type' }, undefined, onShowEditor)
    expect(onShowEditor).not.toHaveBeenCalled()
  })
})
