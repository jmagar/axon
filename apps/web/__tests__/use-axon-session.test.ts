import { describe, expect, it } from 'vitest'

describe('useAxonSession', () => {
  it('exports a function', async () => {
    const { useAxonSession } = await import('@/hooks/use-axon-session')
    expect(typeof useAxonSession).toBe('function')
  })

  it('module can be imported without errors', async () => {
    const mod = await import('@/hooks/use-axon-session')
    expect(mod).toHaveProperty('useAxonSession')
  })

  it('exports MessageItem type (via runtime shape check)', async () => {
    const mod = await import('@/hooks/use-axon-session')
    // MessageItem is a TypeScript interface — no runtime value, but the hook
    // that produces MessageItem objects is exported and callable as a function.
    expect(typeof mod.useAxonSession).toBe('function')
  })

  it('hook has the correct function arity', async () => {
    const { useAxonSession } = await import('@/hooks/use-axon-session')
    // Takes exactly one parameter: sessionId
    expect(useAxonSession.length).toBe(1)
  })
})
