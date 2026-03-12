/**
 * Standalone WebSocket PTY shell server.
 * Runs inside the axon-web container so the terminal lands in the right environment.
 * Proxied from Next.js via the /ws/shell rewrite → http://localhost:49011
 *
 * Protocol (mirrors use-shell-session.ts expectations):
 *   client → server: { type: "input",  data: string }
 *   client → server: { type: "resize", cols: number, rows: number }
 *   server → client: { type: "output", data: string }
 */

// Auto-load env vars from .env.local (Next.js convention) and root .env as fallback.
// process.loadEnvFile() is available since Node 21.7 / 20.12 — safe on Node 24.
// CWD is apps/web when launched via `just dev`.
try {
  process.loadEnvFile('.env.local')
} catch {
  /* file absent — ok */
}
try {
  process.loadEnvFile('../../.env')
} catch {
  /* file absent — ok */
}

import { createServer } from 'node:http'
import pty from 'node-pty'
import { WebSocketServer } from 'ws'
import {
  isAllowedOrigin as _isAllowedOrigin,
  isAuthorized as _isAuthorized,
  buildShellEnv,
} from './lib/server/shell-auth.mjs'

const PORT = Number(process.env.SHELL_SERVER_PORT ?? 49011)
const SHELL = process.env.SHELL ?? '/bin/bash'
const TOKEN = process.env.AXON_SHELL_WS_TOKEN ?? process.env.AXON_WEB_API_TOKEN ?? ''
const ALLOWED_ORIGINS = (
  process.env.AXON_SHELL_ALLOWED_ORIGINS ??
  process.env.AXON_WEB_ALLOWED_ORIGINS ??
  ''
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
const ALLOW_INSECURE_LOCAL_DEV = process.env.AXON_WEB_ALLOW_INSECURE_DEV === 'true'

// Bind module-level config into the pure functions from shell-auth.mjs
function isAllowedOrigin(req) {
  return _isAllowedOrigin(req, ALLOWED_ORIGINS, ALLOW_INSECURE_LOCAL_DEV)
}
function isAuthorized(req) {
  return _isAuthorized(req, TOKEN, ALLOW_INSECURE_LOCAL_DEV)
}

const server = createServer((_req, res) => {
  res.writeHead(200).end('axon shell-server ok')
})

const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  if (!isAllowedOrigin(req)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
    socket.destroy()
    return
  }
  if (!isAuthorized(req)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
    socket.destroy()
    return
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req)
  })
})

wss.on('connection', (ws) => {
  const term = pty.spawn(SHELL, [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: process.env.HOME ?? '/home/node',
    env: buildShellEnv(),
  })

  term.onData((data) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'output', data }))
    }
  })

  term.onExit(() => {
    if (ws.readyState === ws.OPEN) ws.close()
  })

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw))
      if (msg.type === 'input' && typeof msg.data === 'string') {
        term.write(msg.data)
      } else if (msg.type === 'resize' && msg.cols && msg.rows) {
        term.resize(Number(msg.cols), Number(msg.rows))
      }
    } catch {
      /* ignore malformed messages */
    }
  })

  ws.on('close', () => term.kill())
  ws.on('error', () => term.kill())
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[shell-server] listening on 127.0.0.1:${PORT}`)
})
