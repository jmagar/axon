import type { PulseToolUse } from '@/lib/pulse/types'

type ParsedToolName = {
  title: string
  description?: string
  namespace?: string
  server?: string
  action?: string
}

function toLabel(value: string): string {
  return value.trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
}

function parseToolName(rawName: string): ParsedToolName {
  const name = rawName.trim()
  if (!name) return { title: 'tool' }

  if (name.startsWith('mcp__')) {
    const parts = name.split('__').filter(Boolean)
    const server = parts[1]
    const action = parts.slice(2).join('.')
    return {
      title: action || name,
      description: server ? `MCP ${toLabel(server)}` : 'MCP tool',
      namespace: 'mcp',
      server,
      action,
    }
  }

  if (name.includes(':')) {
    const [scope, action] = name.split(':', 2)
    return {
      title: action || name,
      description: scope ? `Skill ${toLabel(scope)}` : 'Skill',
      namespace: 'skill',
      server: scope,
      action,
    }
  }

  if (name.includes('.')) {
    const [scope, action] = name.split('.', 2)
    return {
      title: action || name,
      description: scope ? toLabel(scope) : undefined,
      namespace: scope?.toLowerCase(),
      server: scope,
      action,
    }
  }

  return { title: name }
}

export function toolStatusText(status?: string): string {
  if (status === 'completed' || status === 'success') return 'Completed'
  if (status === 'failed' || status === 'error') return 'Error'
  return 'Running'
}

export function buildToolHeader(tool: PulseToolUse): {
  title: string
  description?: string
  badges: string[]
  meta?: string
} {
  const parsed = parseToolName(tool.name)
  const badges: string[] = []

  if (parsed.server) badges.push(toLabel(parsed.server))
  if (parsed.action && parsed.action !== tool.name) badges.push(toLabel(parsed.action))
  if (typeof tool.sequence === 'number') badges.push(`#${tool.sequence}`)
  if (typeof tool.durationMs === 'number')
    badges.push(`${Math.max(0, Math.round(tool.durationMs))} ms`)

  let meta: string | undefined
  if (typeof tool.startedAtMs === 'number') {
    meta = new Date(tool.startedAtMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return {
    title: parsed.title,
    description: parsed.description,
    badges,
    meta,
  }
}
