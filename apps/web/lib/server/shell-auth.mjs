/**
 * Pure security functions for the PTY shell server — plain JS module.
 *
 * This file is the single source of truth for shell auth logic. It is:
 *   - imported by shell-server.mjs at runtime (can't import TypeScript)
 *   - re-exported by shell-auth.ts with full type annotations for TypeScript consumers
 *   - tested via shell-server.test.ts through the shell-auth.ts re-export
 *
 * Keep this file in sync with shell-auth.ts type signatures. Any logic change
 * here must have a corresponding test in __tests__/shell-server.test.ts.
 */

import { timingSafeEqual } from 'node:crypto'

// Only pass these env vars to the PTY subprocess — never expose DB creds,
// API tokens, or any secret loaded from .env into the shell child process.
export const SAFE_ENV_KEYS = [
  'HOME',
  'PATH',
  'SHELL',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'TMPDIR',
  'PWD',
  'USER',
  'USERNAME',
]

export function isLoopbackHost(host) {
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]' ||
    host === '0.0.0.0'
  )
}

export function parseOrigin(originHeader) {
  if (!originHeader) return null
  try {
    return new URL(originHeader)
  } catch {
    return null
  }
}

export function isAllowedOrigin(req, allowedOrigins, allowInsecureLocalDev) {
  const parsedOrigin = parseOrigin(req.headers.origin)
  if (!parsedOrigin) return true

  const normalizedOrigin = parsedOrigin.origin.toLowerCase()
  if (allowedOrigins.length > 0) {
    return allowedOrigins.some((allowed) => allowed.toLowerCase() === normalizedOrigin)
  }

  if (allowInsecureLocalDev) {
    return isLoopbackHost(parsedOrigin.hostname)
  }

  const forwardedHostRaw = String(req.headers['x-forwarded-host'] ?? '')
    .split(',')[0]
    .trim()
  const forwardedHost = forwardedHostRaw.split(':')[0].toLowerCase()
  const directHost = String(req.headers.host ?? '')
    .split(':')[0]
    .toLowerCase()
  const requestHost = forwardedHost || directHost
  return parsedOrigin.hostname.toLowerCase() === requestHost
}

export function getAuthToken(req) {
  const authHeader = req.headers.authorization
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim()
  }

  const apiKey = req.headers['x-api-key']
  if (typeof apiKey === 'string' && apiKey.trim()) {
    return apiKey.trim()
  }

  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    return url.searchParams.get('token')?.trim() ?? ''
  } catch {
    return ''
  }
}

/**
 * Constant-time token comparison. Prevents timing oracle attacks on the PTY
 * auth gate where a successful guess grants full shell access.
 *
 * Length check short-circuits before constant-time compare — this is safe
 * because length is not a secret (the attacker can observe it via other means).
 */
export function tokenMatches(provided, expected) {
  if (provided.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}

export function isAuthorized(req, token, allowInsecureLocalDev) {
  if (token) {
    return tokenMatches(getAuthToken(req), token)
  }
  if (!allowInsecureLocalDev) return false

  const host = (req.headers.host ?? '').split(':')[0] ?? ''
  return isLoopbackHost(host)
}

export function buildShellEnv(sourceEnv) {
  const env = {}
  for (const key of SAFE_ENV_KEYS) {
    const value = sourceEnv[key]
    if (typeof value === 'string' && value.length > 0) {
      env[key] = value
    }
  }
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  return env
}
