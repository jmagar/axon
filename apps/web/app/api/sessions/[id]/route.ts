import fs from 'node:fs/promises'
import { NextResponse } from 'next/server'
import { makeErrorId } from '@/lib/server/api-error'
import { parseClaudeJsonl } from '@/lib/sessions/claude-jsonl-parser'
import { parseCodexJsonl } from '@/lib/sessions/codex-jsonl-parser'
import { parseGeminiJson } from '@/lib/sessions/gemini-json-parser'
import { scanSessions } from '@/lib/sessions/session-scanner'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sessions = await scanSessions(200)
  // Match by hash-based id (from list endpoint) or by filename (Claude ACP session UUID)
  const session = sessions.find((s) => s.id === id || s.filename === id)
  if (!session) {
    return NextResponse.json(
      {
        error: 'not found',
        code: 'SESSION_NOT_FOUND',
        errorId: makeErrorId('session'),
        detail: 'Session with provided id was not found',
      },
      { status: 404, headers: { 'X-Retry-After': '1' } },
    )
  }

  try {
    const raw = await fs.readFile(session.absolutePath, 'utf-8')
    const messages =
      session.agent === 'codex'
        ? parseCodexJsonl(raw)
        : session.agent === 'gemini'
          ? parseGeminiJson(raw)
          : parseClaudeJsonl(raw)
    return NextResponse.json({
      project: session.project,
      filename: session.filename,
      sessionId: session.filename,
      messages,
    })
  } catch {
    return NextResponse.json({ error: 'read failed' }, { status: 500 })
  }
}
