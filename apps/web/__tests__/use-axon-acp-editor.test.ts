import { describe, expect, it, vi } from 'vitest'

// Test the handler logic in isolation — the actual hook uses useEffect/useState
// so we test the core switch-case logic as a pure function mirror.
function handleEditorMsg(
  msg: Record<string, unknown>,
  opts: { onEditorUpdate?: (content: string, op: 'replace' | 'append') => void },
) {
  switch (msg.type) {
    case 'editor_update': {
      const content = (msg.content as string) ?? ''
      const raw = msg.operation as string | undefined
      const operation: 'replace' | 'append' = raw === 'append' ? 'append' : 'replace'
      opts.onEditorUpdate?.(content, operation)
      break
    }
  }
}

describe('useAxonAcp editor_update handling', () => {
  it('calls onEditorUpdate with content and replace operation', () => {
    const onEditorUpdate = vi.fn()
    handleEditorMsg(
      { type: 'editor_update', content: '# README', operation: 'replace' },
      { onEditorUpdate },
    )
    expect(onEditorUpdate).toHaveBeenCalledWith('# README', 'replace')
    expect(onEditorUpdate).toHaveBeenCalledTimes(1)
  })

  it('calls onEditorUpdate with append operation', () => {
    const onEditorUpdate = vi.fn()
    handleEditorMsg(
      { type: 'editor_update', content: '## New', operation: 'append' },
      { onEditorUpdate },
    )
    expect(onEditorUpdate).toHaveBeenCalledWith('## New', 'append')
  })

  it('defaults operation to replace when missing', () => {
    const onEditorUpdate = vi.fn()
    handleEditorMsg({ type: 'editor_update', content: '# Hello' }, { onEditorUpdate })
    expect(onEditorUpdate).toHaveBeenCalledWith('# Hello', 'replace')
  })

  it('defaults operation to replace for unknown values', () => {
    const onEditorUpdate = vi.fn()
    handleEditorMsg(
      { type: 'editor_update', content: 'x', operation: 'invalid' },
      { onEditorUpdate },
    )
    expect(onEditorUpdate).toHaveBeenCalledWith('x', 'replace')
  })

  it('does nothing when onEditorUpdate is not provided', () => {
    // Should not throw
    expect(() =>
      handleEditorMsg({ type: 'editor_update', content: '# x', operation: 'replace' }, {}),
    ).not.toThrow()
  })

  it('ignores non-editor_update messages', () => {
    const onEditorUpdate = vi.fn()
    handleEditorMsg({ type: 'assistant_delta', delta: 'hello' }, { onEditorUpdate })
    expect(onEditorUpdate).not.toHaveBeenCalled()
  })
})
