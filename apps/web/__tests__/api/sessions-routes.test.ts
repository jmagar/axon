import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @/lib/sessions/session-scanner and the agent-specific scanners
// ---------------------------------------------------------------------------
const scanSessionsMock = vi.fn()
vi.mock('@/lib/sessions/session-scanner', () => ({
  scanSessions: scanSessionsMock,
}))

vi.mock('@/lib/sessions/codex-scanner', () => ({
  scanCodexSessions: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/sessions/gemini-scanner', () => ({
  scanGeminiSessions: vi.fn().mockResolvedValue([]),
}))

// ---------------------------------------------------------------------------
// Mock fs/promises used by the [id] route to read the session file
// ---------------------------------------------------------------------------
const readFileMock = vi.fn()
vi.mock('node:fs/promises', () => ({
  default: {
    readFile: readFileMock,
  },
}))

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------
const SESSION_A = {
  id: 'abc123def456',
  absolutePath: '/home/node/.claude/projects/-home-node-projects/session-1.jsonl',
  project: 'projects',
  filename: 'session-1',
  mtimeMs: 1_700_000_000_000,
  sizeBytes: 2048,
  preview: 'What is the capital of France?',
  repo: 'my-org/my-repo',
  branch: 'main',
}

const SESSION_B = {
  id: 'deadbeef9999',
  absolutePath: '/home/node/.claude/projects/-home-node-other/session-2.jsonl',
  project: 'other',
  filename: 'session-2',
  mtimeMs: 1_699_000_000_000,
  sizeBytes: 512,
  preview: undefined,
  repo: undefined,
  branch: undefined,
}

// ---------------------------------------------------------------------------
// GET /api/sessions/list
// ---------------------------------------------------------------------------
describe('GET /api/sessions/list', () => {
  afterEach(() => {
    scanSessionsMock.mockReset()
    vi.resetModules()
  })

  it('returns sessions list with correct shape', async () => {
    scanSessionsMock.mockResolvedValueOnce([SESSION_A, SESSION_B])
    const { GET } = await import('@/app/api/sessions/list/route')

    const _req = new NextRequest('http://localhost/api/sessions/list')
    const res = await GET()
    expect(res.status).toBe(200)

    const json = (await res.json()) as Array<Record<string, unknown>>
    expect(Array.isArray(json)).toBe(true)
    expect(json).toHaveLength(2)

    const first = json[0]
    expect(first).toMatchObject({
      id: 'abc123def456',
      project: 'projects',
      filename: 'session-1',
      mtimeMs: 1_700_000_000_000,
      sizeBytes: 2048,
      preview: 'What is the capital of France?',
      repo: 'my-org/my-repo',
      branch: 'main',
    })

    // absolutePath must NOT be leaked into the response
    expect(first).not.toHaveProperty('absolutePath')
  })

  it('returns empty array when no sessions exist', async () => {
    scanSessionsMock.mockResolvedValueOnce([])
    const { GET } = await import('@/app/api/sessions/list/route')

    const _req = new NextRequest('http://localhost/api/sessions/list')
    const res = await GET()
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json).toEqual([])
  })

  it('omits undefined optional fields cleanly from session without preview/repo/branch', async () => {
    scanSessionsMock.mockResolvedValueOnce([SESSION_B])
    const { GET } = await import('@/app/api/sessions/list/route')

    const _req = new NextRequest('http://localhost/api/sessions/list')
    const res = await GET()
    expect(res.status).toBe(200)

    const json = (await res.json()) as Array<Record<string, unknown>>
    expect(json).toHaveLength(1)
    const item = json[0]
    expect(item?.id).toBe('deadbeef9999')
    // preview, repo, branch are undefined — JSON.stringify omits them entirely
    expect('preview' in item).toBe(false)
    expect('repo' in item).toBe(false)
    expect('branch' in item).toBe(false)
  })

  it('passes perAgentLimit to scanSessions for claude sessions', async () => {
    scanSessionsMock.mockResolvedValueOnce([])
    const { GET } = await import('@/app/api/sessions/list/route')

    await GET()
    expect(scanSessionsMock).toHaveBeenCalledWith(30, 30)
  })
})

// ---------------------------------------------------------------------------
// GET /api/sessions/[id]
// ---------------------------------------------------------------------------
describe('GET /api/sessions/[id]', () => {
  afterEach(() => {
    scanSessionsMock.mockReset()
    readFileMock.mockReset()
    vi.resetModules()
  })

  it('returns 200 with parsed messages when session is found', async () => {
    scanSessionsMock.mockResolvedValueOnce([SESSION_A, SESSION_B])

    const jsonlContent = [
      JSON.stringify({ type: 'user', message: { content: 'Hello there' } }),
      JSON.stringify({ type: 'assistant', message: { content: 'Hi! How can I help?' } }),
    ].join('\n')
    readFileMock.mockResolvedValueOnce(jsonlContent)

    const { GET } = await import('@/app/api/sessions/[id]/route')
    const params = Promise.resolve({ id: 'abc123def456' })
    const res = await GET(new Request('http://localhost/api/sessions/abc123def456'), { params })

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      project: string
      filename: string
      sessionId: string
      messages: Array<{ role: string; content: string }>
    }

    expect(body.project).toBe('projects')
    expect(body.filename).toBe('session-1')
    expect(body.sessionId).toBe('session-1')
    expect(Array.isArray(body.messages)).toBe(true)
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0]).toEqual({ role: 'user', content: 'Hello there' })
    expect(body.messages[1]).toEqual({ role: 'assistant', content: 'Hi! How can I help?' })
  })

  it('returns 404 when session id is not found', async () => {
    scanSessionsMock.mockResolvedValueOnce([SESSION_A, SESSION_B])

    const { GET } = await import('@/app/api/sessions/[id]/route')
    const params = Promise.resolve({ id: 'nonexistent000' })
    const res = await GET(new Request('http://localhost/api/sessions/nonexistent000'), { params })

    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('not found')
  })

  it('returns 500 when file read fails', async () => {
    scanSessionsMock.mockResolvedValueOnce([SESSION_A])
    readFileMock.mockRejectedValueOnce(new Error('ENOENT: no such file or directory'))

    const { GET } = await import('@/app/api/sessions/[id]/route')
    const params = Promise.resolve({ id: 'abc123def456' })
    const res = await GET(new Request('http://localhost/api/sessions/abc123def456'), { params })

    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('read failed')
  })

  it('passes limit=200 to scanSessions for detail lookup', async () => {
    scanSessionsMock.mockResolvedValueOnce([])

    const { GET } = await import('@/app/api/sessions/[id]/route')
    const params = Promise.resolve({ id: 'anything' })
    await GET(new Request('http://localhost/api/sessions/anything'), { params })

    expect(scanSessionsMock).toHaveBeenCalledWith(200)
  })

  it('returns empty messages array for empty jsonl file', async () => {
    scanSessionsMock.mockResolvedValueOnce([SESSION_A])
    readFileMock.mockResolvedValueOnce('')

    const { GET } = await import('@/app/api/sessions/[id]/route')
    const params = Promise.resolve({ id: 'abc123def456' })
    const res = await GET(new Request('http://localhost/api/sessions/abc123def456'), { params })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { messages: unknown[] }
    expect(body.messages).toEqual([])
  })

  it('filters out non-user/non-assistant message types from jsonl', async () => {
    scanSessionsMock.mockResolvedValueOnce([SESSION_A])

    const jsonlContent = [
      JSON.stringify({ type: 'system', message: { content: 'System message' } }),
      JSON.stringify({ type: 'user', message: { content: 'Actual user question' } }),
      JSON.stringify({ type: 'tool_result', message: { content: 'Tool output' } }),
    ].join('\n')
    readFileMock.mockResolvedValueOnce(jsonlContent)

    const { GET } = await import('@/app/api/sessions/[id]/route')
    const params = Promise.resolve({ id: 'abc123def456' })
    const res = await GET(new Request('http://localhost/api/sessions/abc123def456'), { params })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { messages: Array<{ role: string }> }
    // Only 'user' type passes the parser filter
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0]?.role).toBe('user')
  })
})
