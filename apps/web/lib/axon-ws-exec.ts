/**
 * Execute an axon command via the axon-workers WebSocket bridge.
 *
 * Rather than spawning the axon binary from axon-web (where the binary may
 * not exist), this connects to the WS execution bridge that runs inside the
 * axon-workers container, which always has the binary available.
 */

const WORKERS_WS_URL = process.env.AXON_WORKERS_WS_URL ?? 'ws://axon-workers:49000/ws'

/**
 * Run a synchronous axon command via the axon-workers WS bridge and return
 * the parsed JSON result. Rejects on timeout, connection error, or if the
 * command itself fails.
 */
export async function runAxonCommandWs(mode: string, timeoutMs = 30_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // Node.js 22+ has native WebSocket globally available.
    const ws = new WebSocket(WORKERS_WS_URL)
    let result: unknown
    let settled = false

    const finish = (err?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        ws.close()
      } catch {
        /* ignore */
      }
      if (err) reject(err)
      else resolve(result)
    }

    const timer = setTimeout(
      () => finish(new Error(`Timeout waiting for axon ${mode} (${timeoutMs}ms)`)),
      timeoutMs,
    )

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'execute', mode, input: '', flags: {} }))
    })

    ws.addEventListener('message', (event: MessageEvent) => {
      try {
        const msg = JSON.parse(String(event.data)) as { type: string; data?: unknown }
        if (msg.type === 'command.output.json') {
          // data.data is the parsed JSON payload from the subprocess stdout
          const payload = msg.data as { data?: unknown }
          result = payload?.data ?? payload
        } else if (msg.type === 'command.done') {
          finish()
        } else if (msg.type === 'command.error') {
          const payload = msg.data as { payload?: { message?: string } }
          finish(new Error(payload?.payload?.message ?? `axon ${mode} failed`))
        }
      } catch {
        /* ignore non-JSON messages */
      }
    })

    ws.addEventListener('error', () => {
      finish(new Error(`WebSocket connection error (${WORKERS_WS_URL})`))
    })

    ws.addEventListener('close', (event: CloseEvent) => {
      if (!settled) {
        finish(new Error(`WebSocket closed unexpectedly (code ${event.code})`))
      }
    })
  })
}
