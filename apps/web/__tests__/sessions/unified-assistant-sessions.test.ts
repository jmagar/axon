import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scanSessions } from '@/lib/sessions/session-scanner'

function makeUserLine(content: string): string {
  return JSON.stringify({
    type: 'user',
    message: { content },
  })
}

describe('scanSessions assistantMode', () => {
  let tmpRoot: string
  let origHome: string
  let origDataDir: string | undefined

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'axon-assistant-scan-test-'))
    origHome = process.env.HOME ?? ''
    origDataDir = process.env.AXON_DATA_DIR
    process.env.HOME = tmpRoot
    process.env.AXON_DATA_DIR = path.join(tmpRoot, 'data')
  })

  afterEach(async () => {
    process.env.HOME = origHome
    if (origDataDir === undefined) {
      delete process.env.AXON_DATA_DIR
    } else {
      process.env.AXON_DATA_DIR = origDataDir
    }
    await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('extracts user prompt from system wrapper text', async () => {
    const assistantCwd = path.join(process.env.AXON_DATA_DIR!, 'axon', 'assistant')
    const projectName = assistantCwd.replace(/\//g, '-')
    const projectPath = path.join(tmpRoot, '.claude', 'projects', projectName)
    await fs.mkdir(projectPath, { recursive: true })
    const sessionFile = path.join(projectPath, 'abc123.jsonl')
    await fs.writeFile(
      sessionFile,
      `${makeUserLine('[System context — Axon editor integration] prep [User message] Hello world')}\n`,
      'utf8',
    )

    const sessions = await scanSessions(20, 30, { assistantMode: true })
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.preview).toBe('Hello world')
  })

  it('includes assistant sessions from claude, codex, and gemini stores', async () => {
    const assistantCwd = path.join(process.env.AXON_DATA_DIR!, 'axon', 'assistant')
    const projectName = assistantCwd.replace(/\//g, '-')

    // Claude-style assistant session
    const claudeProjectPath = path.join(tmpRoot, '.claude', 'projects', projectName)
    await fs.mkdir(claudeProjectPath, { recursive: true })
    await fs.writeFile(
      path.join(claudeProjectPath, 'claude-1.jsonl'),
      `${makeUserLine('Claude assistant prompt')}\n`,
      'utf8',
    )

    // Codex-style assistant session
    const codexDayPath = path.join(tmpRoot, '.codex', 'sessions', '2026', '03', '11')
    await fs.mkdir(codexDayPath, { recursive: true })
    const codexLines = [
      JSON.stringify({ type: 'session_meta', payload: { cwd: assistantCwd } }),
      JSON.stringify({
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Codex assistant prompt' },
      }),
    ].join('\n')
    await fs.writeFile(path.join(codexDayPath, 'codex-1.jsonl'), `${codexLines}\n`, 'utf8')

    // Gemini-style assistant session
    const geminiHash = 'aaaaaaaa'
    const geminiTmpChats = path.join(tmpRoot, '.gemini', 'tmp', geminiHash, 'chats')
    await fs.mkdir(geminiTmpChats, { recursive: true })
    await fs.mkdir(path.join(tmpRoot, '.gemini'), { recursive: true })
    await fs.writeFile(
      path.join(tmpRoot, '.gemini', 'projects.json'),
      JSON.stringify({ [geminiHash]: assistantCwd }),
      'utf8',
    )
    await fs.writeFile(
      path.join(geminiTmpChats, 'session-gemini-1.json'),
      JSON.stringify({
        sessionId: 'session-gemini-1',
        messages: [{ type: 'user', content: 'Gemini assistant prompt' }],
      }),
      'utf8',
    )

    const sessions = await scanSessions(20, 30, { assistantMode: true })
    const agents = new Set(sessions.map((s) => s.agent))
    expect(agents.has('claude')).toBe(true)
    expect(agents.has('codex')).toBe(true)
    expect(agents.has('gemini')).toBe(true)
  })

  it('returns codex/gemini assistant sessions even when claude assistant dir is missing', async () => {
    const assistantCwd = path.join(process.env.AXON_DATA_DIR!, 'axon', 'assistant')

    // Codex-only
    const codexDayPath = path.join(tmpRoot, '.codex', 'sessions', '2026', '03', '12')
    await fs.mkdir(codexDayPath, { recursive: true })
    const codexLines = [
      JSON.stringify({ type: 'session_meta', payload: { cwd: assistantCwd } }),
      JSON.stringify({
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Codex-only assistant prompt' },
      }),
    ].join('\n')
    await fs.writeFile(path.join(codexDayPath, 'codex-only.jsonl'), `${codexLines}\n`, 'utf8')

    // Gemini-only
    const geminiHash = 'bbbbbbbb'
    const geminiTmpChats = path.join(tmpRoot, '.gemini', 'tmp', geminiHash, 'chats')
    await fs.mkdir(geminiTmpChats, { recursive: true })
    await fs.mkdir(path.join(tmpRoot, '.gemini'), { recursive: true })
    await fs.writeFile(
      path.join(tmpRoot, '.gemini', 'projects.json'),
      JSON.stringify({ [geminiHash]: assistantCwd }),
      'utf8',
    )
    await fs.writeFile(
      path.join(geminiTmpChats, 'session-gemini-only.json'),
      JSON.stringify({
        sessionId: 'session-gemini-only',
        messages: [{ type: 'user', content: 'Gemini-only assistant prompt' }],
      }),
      'utf8',
    )

    const sessions = await scanSessions(20, 30, { assistantMode: true })
    const agents = new Set(sessions.map((s) => s.agent))
    expect(agents.has('codex')).toBe(true)
    expect(agents.has('gemini')).toBe(true)
  })

  it('includes Gemini assistant sessions when tmp folder is non-hash and projects.json uses current schema', async () => {
    const assistantCwd = path.join(process.env.AXON_DATA_DIR!, 'axon', 'assistant')

    const geminiTmpChats = path.join(tmpRoot, '.gemini', 'tmp', 'assistant', 'chats')
    await fs.mkdir(geminiTmpChats, { recursive: true })
    await fs.mkdir(path.join(tmpRoot, '.gemini'), { recursive: true })
    await fs.writeFile(
      path.join(tmpRoot, '.gemini', 'projects.json'),
      JSON.stringify({
        projects: {
          [assistantCwd]: 'assistant',
        },
      }),
      'utf8',
    )
    await fs.writeFile(
      path.join(geminiTmpChats, 'session-gemini-current-schema.json'),
      JSON.stringify({
        sessionId: 'session-gemini-current-schema',
        messages: [{ type: 'user', content: 'Gemini current schema prompt' }],
      }),
      'utf8',
    )

    const sessions = await scanSessions(20, 30, { assistantMode: true })
    const gemini = sessions.find((s) => s.agent === 'gemini')
    expect(gemini).toBeDefined()
    expect(gemini?.project).toBe('assistant')
  })

  it('includes Gemini assistant sessions when tmp folder name is assistant and projects.json is absent', async () => {
    const geminiTmpChats = path.join(tmpRoot, '.gemini', 'tmp', 'assistant', 'chats')
    await fs.mkdir(geminiTmpChats, { recursive: true })
    await fs.writeFile(
      path.join(geminiTmpChats, 'session-gemini-no-project-map.json'),
      JSON.stringify({
        sessionId: 'session-gemini-no-project-map',
        messages: [{ type: 'user', content: 'Gemini no project map prompt' }],
      }),
      'utf8',
    )

    const sessions = await scanSessions(20, 30, { assistantMode: true })
    const gemini = sessions.find((s) => s.agent === 'gemini')
    expect(gemini).toBeDefined()
    expect(gemini?.project).toBe('assistant')
  })

  it('includes Codex assistant sessions when session_meta line exceeds 1KB', async () => {
    const assistantCwd = path.join(process.env.AXON_DATA_DIR!, 'axon', 'assistant')
    const codexDayPath = path.join(tmpRoot, '.codex', 'sessions', '2026', '03', '13')
    await fs.mkdir(codexDayPath, { recursive: true })

    const longBaseInstructions = 'x'.repeat(4000)
    const codexLines = [
      JSON.stringify({
        type: 'session_meta',
        payload: { cwd: assistantCwd, base_instructions: longBaseInstructions },
      }),
      JSON.stringify({
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Codex long meta assistant prompt' },
      }),
    ].join('\n')
    await fs.writeFile(path.join(codexDayPath, 'codex-long-meta.jsonl'), `${codexLines}\n`, 'utf8')

    const sessions = await scanSessions(20, 30, { assistantMode: true })
    const codex = sessions.find((s) => s.agent === 'codex')
    expect(codex).toBeDefined()
    expect(codex?.project).toBe('assistant')
  })
})
