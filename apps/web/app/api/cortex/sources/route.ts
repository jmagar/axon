import { NextResponse } from 'next/server'
import { runAxonCommandWs } from '@/lib/axon-ws-exec'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const data = await runAxonCommandWs('sources', 60_000)
    return NextResponse.json({ ok: true, data })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
