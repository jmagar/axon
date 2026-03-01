import { spawn } from 'node:child_process'
import type { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

const ALLOWED_SERVICES = new Set([
  'axon-postgres',
  'axon-redis',
  'axon-rabbitmq',
  'axon-qdrant',
  'axon-chrome',
  'axon-workers',
  'axon-web',
])

export async function GET(req: NextRequest) {
  const service = req.nextUrl.searchParams.get('service') ?? 'axon-workers'
  const tail = Math.min(Number(req.nextUrl.searchParams.get('tail') ?? '200'), 1000)

  if (!ALLOWED_SERVICES.has(service)) {
    return new Response('Invalid service', { status: 400 })
  }

  if (!Number.isFinite(tail) || tail < 1) {
    return new Response('Invalid tail value', { status: 400 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      const proc = spawn('docker', ['logs', '--follow', `--tail=${tail}`, service], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      function sendLine(line: string) {
        const payload = JSON.stringify({ line, ts: Date.now() })
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`))
      }

      proc.stdout?.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString().split('\n')) {
          if (line.trim()) sendLine(line)
        }
      })

      proc.stderr?.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString().split('\n')) {
          if (line.trim()) sendLine(line)
        }
      })

      proc.on('close', () => {
        try {
          controller.close()
        } catch {
          // already closed
        }
      })

      proc.on('error', (err) => {
        sendLine(`[stream error] ${err.message}`)
        try {
          controller.close()
        } catch {
          // already closed
        }
      })

      req.signal.addEventListener('abort', () => {
        proc.kill()
        try {
          controller.close()
        } catch {
          // already closed
        }
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
