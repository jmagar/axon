import { NextResponse } from 'next/server'
import { scanAssistantSessions } from '@/lib/sessions/assistant-scanner'

export async function GET() {
  const sessions = await scanAssistantSessions().catch(() => [])
  return NextResponse.json(sessions)
}
