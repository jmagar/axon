import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { NextResponse } from 'next/server'

const execFileAsync = promisify(execFile)

export interface Agent {
  name: string
  description: string
  source: string
}

interface AgentsResponse {
  agents: Agent[]
  groups: string[]
  error?: string
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

export async function GET(): Promise<NextResponse<AgentsResponse>> {
  try {
    const { stdout } = await execFileAsync('claude', ['agents'], { timeout: 10000 })
    const { agents, groups } = parseAgentsOutput(stdout)
    return NextResponse.json({ agents, groups })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ agents: [], groups: [], error: message })
  }
}
