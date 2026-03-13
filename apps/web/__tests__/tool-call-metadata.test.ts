import { describe, expect, it } from 'vitest'
import { buildToolHeader, toolStatusText } from '@/components/shell/tool-call-metadata'

describe('tool-call-metadata', () => {
  it('builds dense metadata for MCP tool names', () => {
    const header = buildToolHeader({
      name: 'mcp__chrome-dev-tools__click',
      input: {},
      sequence: 4,
      durationMs: 187.2,
      startedAtMs: 1_700_000_000_000,
    })

    expect(header.title).toBe('click')
    expect(header.description).toBe('MCP chrome dev tools')
    expect(header.badges).toContain('chrome dev tools')
    expect(header.badges).toContain('#4')
    expect(header.badges).toContain('187 ms')
    expect(header.meta).toBeTruthy()
  })

  it('maps raw status to normalized labels', () => {
    expect(toolStatusText('success')).toBe('Completed')
    expect(toolStatusText('error')).toBe('Error')
    expect(toolStatusText(undefined)).toBe('Running')
  })
})
