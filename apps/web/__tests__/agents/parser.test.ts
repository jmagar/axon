/**
 * Tests for the agent output parser logic from app/api/agents/route.ts.
 *
 * parseAgentsOutput is not exported from the route, so the logic is replicated
 * here verbatim. If the route implementation changes, update this copy to match.
 *
 * Parser rules (from route.ts):
 *  - Group header: no leading whitespace, ends with ':'
 *  - Agent line: starts with 2 spaces, contains ' \u2014 ' (em-dash with spaces)
 *  - Description: everything after the FIRST occurrence of ' \u2014 '
 */

import { describe, expect, it } from 'vitest'

// ── Local replica of parseAgentsOutput from app/api/agents/route.ts ──────────

interface Agent {
  name: string
  description: string
  source: string
}

function parseAgentsOutput(stdout: string): { agents: Agent[]; groups: string[] } {
  const agents: Agent[] = []
  const groups: string[] = []
  let currentGroup = ''

  for (const raw of stdout.split('\n')) {
    const line = raw.trimEnd()
    if (!line) continue

    // Group header: no leading whitespace, ends with ':'
    if (!line.startsWith(' ') && line.endsWith(':')) {
      currentGroup = line.slice(0, -1).trim()
      if (!groups.includes(currentGroup)) {
        groups.push(currentGroup)
      }
      continue
    }

    // Agent line: starts with 2 spaces and contains ' — '
    if (line.startsWith('  ') && line.includes(' \u2014 ')) {
      const trimmed = line.trim()
      const sepIdx = trimmed.indexOf(' \u2014 ')
      if (sepIdx !== -1) {
        const name = trimmed.slice(0, sepIdx).trim()
        const description = trimmed.slice(sepIdx + 3).trim()
        agents.push({ name, description, source: currentGroup })
      }
    }
  }

  return { agents, groups }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('parseAgentsOutput', () => {
  it('parses a single Built-in group with two agents', () => {
    const stdout =
      'Built-in:\n' + '  researcher \u2014 Does research\n' + '  coder \u2014 Writes code\n'
    const result = parseAgentsOutput(stdout)

    expect(result.groups).toEqual(['Built-in'])
    expect(result.agents).toEqual([
      { name: 'researcher', description: 'Does research', source: 'Built-in' },
      { name: 'coder', description: 'Writes code', source: 'Built-in' },
    ])
  })

  it('parses multiple groups correctly', () => {
    const stdout =
      'Built-in:\n' +
      '  researcher \u2014 Does research\n' +
      'Configured:\n' +
      '  my-agent \u2014 Custom agent\n'
    const result = parseAgentsOutput(stdout)

    expect(result.groups).toEqual(['Built-in', 'Configured'])
    expect(result.agents).toHaveLength(2)
    expect(result.agents[0]).toMatchObject({ name: 'researcher', source: 'Built-in' })
    expect(result.agents[1]).toMatchObject({ name: 'my-agent', source: 'Configured' })
  })

  it('returns empty agents and groups for empty string', () => {
    const result = parseAgentsOutput('')
    expect(result).toEqual({ agents: [], groups: [] })
  })

  it('returns empty agents and groups for whitespace-only input', () => {
    const result = parseAgentsOutput('   \n\n   ')
    expect(result).toEqual({ agents: [], groups: [] })
  })

  it('includes a group in groups even when it has no agent lines', () => {
    const stdout = 'Built-in:\n'
    const result = parseAgentsOutput(stdout)

    expect(result.groups).toEqual(['Built-in'])
    expect(result.agents).toHaveLength(0)
  })

  it('handles description containing an em-dash — uses everything after first separator', () => {
    // ' \u2014 ' separator appears twice; description should be 'Do this \u2014 and that'
    const stdout = 'Built-in:\n' + `  agent \u2014 Do this \u2014 and that\n`
    const result = parseAgentsOutput(stdout)

    expect(result.agents).toHaveLength(1)
    expect(result.agents[0]).toMatchObject({
      name: 'agent',
      description: `Do this \u2014 and that`,
      source: 'Built-in',
    })
  })

  it('ignores lines that start with 2 spaces but have no em-dash separator', () => {
    const stdout = 'Built-in:\n' + '  not-an-agent-line\n'
    const result = parseAgentsOutput(stdout)

    expect(result.groups).toEqual(['Built-in'])
    expect(result.agents).toHaveLength(0)
  })

  it('does not add duplicate group names', () => {
    // Two sections with the same header name
    const stdout =
      'Built-in:\n' + '  agent1 \u2014 First\n' + 'Built-in:\n' + '  agent2 \u2014 Second\n'
    const result = parseAgentsOutput(stdout)

    expect(result.groups).toEqual(['Built-in'])
    expect(result.agents).toHaveLength(2)
  })

  it('trims agent names and descriptions', () => {
    // Extra internal whitespace around the name before the separator
    const stdout = 'Built-in:\n' + '   researcher  \u2014  Does research  \n'
    const result = parseAgentsOutput(stdout)

    // Line starts with 3 spaces — still matches startsWith('  ')
    expect(result.agents[0]?.name).toBe('researcher')
    expect(result.agents[0]?.description).toBe('Does research')
  })

  it('sets source to empty string when an agent line appears before any group header', () => {
    const stdout = '  orphan \u2014 No group\n'
    const result = parseAgentsOutput(stdout)

    // currentGroup starts as '', so source should be ''
    expect(result.agents[0]?.source).toBe('')
  })

  it('handles a group header that has no trailing newline', () => {
    const stdout = 'Built-in:\n  agent \u2014 Works'
    const result = parseAgentsOutput(stdout)

    expect(result.groups).toEqual(['Built-in'])
    expect(result.agents).toHaveLength(1)
  })
})
