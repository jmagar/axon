import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { NextResponse } from 'next/server'

type McpServerConfig = {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}

type McpConfig = {
  mcpServers: Record<string, McpServerConfig>
}

const MCP_JSON_PATH = path.join(os.homedir(), '.claude', 'mcp.json')

async function readMcpConfig(): Promise<McpConfig> {
  try {
    const raw = await fs.readFile(MCP_JSON_PATH, 'utf8')
    const parsed = JSON.parse(raw) as McpConfig
    if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object') {
      return { mcpServers: {} }
    }
    return parsed
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { mcpServers: {} }
    }
    throw err
  }
}

async function writeMcpConfig(config: McpConfig): Promise<void> {
  const dir = path.dirname(MCP_JSON_PATH)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(MCP_JSON_PATH, JSON.stringify(config, null, 2), 'utf8')
}

export async function GET() {
  try {
    const config = await readMcpConfig()
    return NextResponse.json(config)
  } catch (err) {
    console.error('[MCP] GET failed:', err)
    return NextResponse.json({ error: 'Failed to read mcp.json' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as unknown
    if (
      !body ||
      typeof body !== 'object' ||
      !('mcpServers' in body) ||
      typeof (body as McpConfig).mcpServers !== 'object'
    ) {
      return NextResponse.json(
        { error: 'Body must have mcpServers: Record<string, McpServerConfig>' },
        { status: 400 },
      )
    }
    const config = body as McpConfig
    await writeMcpConfig(config)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[MCP] PUT failed:', err)
    return NextResponse.json({ error: 'Failed to write mcp.json' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as unknown
    if (
      !body ||
      typeof body !== 'object' ||
      !('name' in body) ||
      typeof (body as { name: unknown }).name !== 'string'
    ) {
      return NextResponse.json({ error: 'Body must have name: string' }, { status: 400 })
    }
    const { name } = body as { name: string }
    const config = await readMcpConfig()
    const updated: McpConfig = {
      mcpServers: Object.fromEntries(Object.entries(config.mcpServers).filter(([k]) => k !== name)),
    }
    await writeMcpConfig(updated)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[MCP] DELETE failed:', err)
    return NextResponse.json({ error: 'Failed to delete server from mcp.json' }, { status: 500 })
  }
}
