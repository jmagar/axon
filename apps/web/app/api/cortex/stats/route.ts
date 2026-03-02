import { NextResponse } from 'next/server'
import { runAxonCommandWs } from '@/lib/axon-ws-exec'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const data = await runAxonCommandWs('stats', 30_000)
    return NextResponse.json({ ok: true, data })
  } catch (err) {
    console.error('[cortex/stats] failed to fetch stats', err)
    return NextResponse.json({ ok: false, error: 'Failed to fetch Cortex stats' }, { status: 500 })
  }
}
