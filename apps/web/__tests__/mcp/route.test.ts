/**
 * Tests for app/api/mcp/route.ts (GET / PUT / DELETE handlers).
 *
 * node:fs/promises and node:os are mocked so tests run without touching disk.
 * next/server is mocked to return a plain object with .json() and .status.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('node:os', () => ({ default: { homedir: () => '/home/testuser' } }))

const fsMock = {
  readFile: vi.fn(),
  writeFile: vi.fn<[string, string, string], Promise<void>>(),
  mkdir: vi.fn<[string, { recursive: boolean }], Promise<void>>(),
}
vi.mock('node:fs/promises', () => ({ default: fsMock }))

vi.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) => ({
      _data: data,
      status: init?.status ?? 200,
      json: async () => data,
    }),
  },
}))

// ── Import after mocks are registered ────────────────────────────────────────

// Dynamic import so that the module picks up the mocked dependencies.
async function loadRoute() {
  // Invalidate module cache between tests by using a fresh import path.
  return import('@/app/api/mcp/route')
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Simulate a Next.js Request with a JSON body. */
function makeRequest(body: unknown): Request {
  return {
    json: async () => body,
  } as unknown as Request
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/mcp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fsMock.writeFile.mockResolvedValue(undefined)
    fsMock.mkdir.mockResolvedValue(undefined)
  })

  it('returns parsed config when file exists with valid JSON', async () => {
    const config = { mcpServers: { 'my-server': { command: 'node', args: ['server.js'] } } }
    fsMock.readFile.mockResolvedValue(JSON.stringify(config))

    const { GET } = await loadRoute()
    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(config)
  })

  it('returns { mcpServers: {} } when file does not exist (ENOENT)', async () => {
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    fsMock.readFile.mockRejectedValue(enoent)

    const { GET } = await loadRoute()
    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ mcpServers: {} })
  })

  it('returns 500 when file contains invalid JSON', async () => {
    fsMock.readFile.mockResolvedValue('not-json{{{')

    const { GET } = await loadRoute()
    const response = await GET()

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toHaveProperty('error')
  })

  it('returns { mcpServers: {} } when parsed JSON lacks mcpServers', async () => {
    fsMock.readFile.mockResolvedValue(JSON.stringify({ something: 'else' }))

    const { GET } = await loadRoute()
    const response = await GET()

    // readMcpConfig normalises a missing/invalid mcpServers to {}
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ mcpServers: {} })
  })
})

describe('PUT /api/mcp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fsMock.writeFile.mockResolvedValue(undefined)
    fsMock.mkdir.mockResolvedValue(undefined)
  })

  it('writes pretty-printed JSON and returns { ok: true } for valid body', async () => {
    const config = { mcpServers: { 'my-server': { command: 'node' } } }
    const req = makeRequest(config)

    const { PUT } = await loadRoute()
    const response = await PUT(req)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })

    // Verify writeFile was called with pretty-printed JSON
    expect(fsMock.writeFile).toHaveBeenCalledOnce()
    const written = fsMock.writeFile.mock.calls[0]?.[1] as string
    expect(written).toBe(JSON.stringify(config, null, 2))
  })

  it('returns 400 when body is missing mcpServers field', async () => {
    const req = makeRequest({ notMcpServers: {} })

    const { PUT } = await loadRoute()
    const response = await PUT(req)

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body).toHaveProperty('error')
  })

  it('returns 400 when body is null', async () => {
    const req = makeRequest(null)

    const { PUT } = await loadRoute()
    const response = await PUT(req)

    expect(response.status).toBe(400)
  })

  it('returns 400 when mcpServers is not an object', async () => {
    const req = makeRequest({ mcpServers: 'not-an-object' })

    const { PUT } = await loadRoute()
    const response = await PUT(req)

    expect(response.status).toBe(400)
  })
})

describe('DELETE /api/mcp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fsMock.writeFile.mockResolvedValue(undefined)
    fsMock.mkdir.mockResolvedValue(undefined)
  })

  it('removes an existing server and returns { ok: true }', async () => {
    const existing = {
      mcpServers: {
        'keep-me': { command: 'node' },
        'delete-me': { command: 'python' },
      },
    }
    fsMock.readFile.mockResolvedValue(JSON.stringify(existing))

    const req = makeRequest({ name: 'delete-me' })
    const { DELETE } = await loadRoute()
    const response = await DELETE(req)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })

    // Verify the written config no longer contains the deleted server
    const written = JSON.parse(fsMock.writeFile.mock.calls[0]?.[1] as string) as {
      mcpServers: Record<string, unknown>
    }
    expect(Object.keys(written.mcpServers)).toEqual(['keep-me'])
    expect(written.mcpServers).not.toHaveProperty('delete-me')
  })

  it('returns { ok: true } even when server name does not exist (filter is a no-op)', async () => {
    // The implementation filters + writes regardless — no 404 is raised.
    const existing = { mcpServers: { 'keep-me': { command: 'node' } } }
    fsMock.readFile.mockResolvedValue(JSON.stringify(existing))

    const req = makeRequest({ name: 'nonexistent' })
    const { DELETE } = await loadRoute()
    const response = await DELETE(req)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })

  it('returns 400 when body is missing name field', async () => {
    const req = makeRequest({ notName: 'something' })

    const { DELETE } = await loadRoute()
    const response = await DELETE(req)

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body).toHaveProperty('error')
  })

  it('returns 400 when name is not a string', async () => {
    const req = makeRequest({ name: 42 })

    const { DELETE } = await loadRoute()
    const response = await DELETE(req)

    expect(response.status).toBe(400)
  })

  it('returns 400 when body is null', async () => {
    const req = makeRequest(null)

    const { DELETE } = await loadRoute()
    const response = await DELETE(req)

    expect(response.status).toBe(400)
  })
})
