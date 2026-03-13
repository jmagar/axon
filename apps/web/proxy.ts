// NOTE: This file is named proxy.ts intentionally — Next.js 16 deprecated
// middleware.ts in favor of proxy.ts. The exported `proxy` function and
// `config.matcher` are the correct conventions. Do NOT rename to middleware.ts.
import { timingSafeEqual } from 'node:crypto'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { buildCspHeader } from '@/lib/server/csp'

const API_TOKEN = process.env.AXON_WEB_API_TOKEN?.trim() || null
const BROWSER_API_TOKEN = process.env.AXON_WEB_BROWSER_API_TOKEN?.trim() || null
const ALLOWED_ORIGINS = (process.env.AXON_WEB_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean)
const ALLOW_INSECURE_LOCAL_DEV = process.env.AXON_WEB_ALLOW_INSECURE_DEV === 'true'
const IS_DEV = process.env.NODE_ENV !== 'production'

// S-M6: CSP is now built by the shared lib/server/csp.ts module. next.config.ts
// uses the same builder so both layers always emit an identical policy string.
// Previously this file had its own inline CSP that diverged from next.config.ts
// (missing form-action, img-src lacked https:). That silent divergence is now
// impossible — both call buildCspHeader() with the same options shape.
const SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ['X-Frame-Options', 'DENY'],
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['Permissions-Policy', 'camera=(), microphone=(), geolocation=()'],
  [
    'Content-Security-Policy',
    buildCspHeader({
      isDev: IS_DEV,
      backendUrl: process.env.AXON_BACKEND_URL,
    }),
  ],
]

function withSecurityHeaders(response: NextResponse): NextResponse {
  for (const [key, value] of SECURITY_HEADERS) {
    response.headers.set(key, value)
  }
  if (!IS_DEV) {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
  return response
}

function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
}

function isLocalhostRequest(req: NextRequest): boolean {
  const host = req.nextUrl.hostname.toLowerCase()
  return isLoopbackHost(host)
}

function isAllowedOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  if (!origin) {
    // Non-browser clients (curl, scripts) without Origin header:
    // allow if token auth is active (token check happens separately),
    // reject in insecure dev mode where origin is the only guard
    return API_TOKEN !== null || BROWSER_API_TOKEN !== null || !ALLOW_INSECURE_LOCAL_DEV
  }

  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return false
  }

  const normalizedOrigin = parsed.origin.toLowerCase()
  if (ALLOWED_ORIGINS.length > 0) {
    return ALLOWED_ORIGINS.includes(normalizedOrigin)
  }

  if (ALLOW_INSECURE_LOCAL_DEV && isLoopbackHost(parsed.hostname.toLowerCase())) {
    return true
  }

  const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase()
  const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim().toLowerCase()
  // Only use forwarded headers when BOTH are present; mixing them produces an
  // http://external-host origin that never matches the browser's https:// Origin.
  const useForwarded = !!(forwardedProto && forwardedHost)
  const proto = useForwarded ? forwardedProto : req.nextUrl.protocol.replace(':', '')
  const host = useForwarded ? forwardedHost : req.nextUrl.host
  const requestOrigin = `${proto}://${host}`.toLowerCase()
  return normalizedOrigin === requestOrigin
}

function extractToken(req: NextRequest): string {
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim()
  }

  const key = req.headers.get('x-api-key')
  if (key?.trim()) return key.trim()

  const ALLOW_QUERY_TOKEN = process.env.AXON_WEB_ALLOW_QUERY_TOKEN === 'true'
  if (ALLOW_QUERY_TOKEN) {
    return req.nextUrl.searchParams.get('token')?.trim() ?? ''
  }
  return ''
}

function constantTimeEqual(a: string, b: string): boolean {
  // Length check is intentional: timingSafeEqual requires equal-length buffers.
  // Token length is not secret (fixed-length UUID/hex), so this short-circuit
  // introduces no meaningful timing side-channel.
  if (a.length !== b.length) return false
  const bufA = Buffer.from(a, 'utf-8')
  const bufB = Buffer.from(b, 'utf-8')
  return timingSafeEqual(bufA, bufB)
}

function isAuthorized(req: NextRequest): boolean {
  const isLocalhost = isLocalhostRequest(req)
  if (ALLOW_INSECURE_LOCAL_DEV && isLocalhost) return true

  const token = extractToken(req)
  if (token.length === 0) return false

  const apiTokenMatch = API_TOKEN !== null && constantTimeEqual(token, API_TOKEN)
  const browserTokenMatch =
    BROWSER_API_TOKEN !== null && constantTimeEqual(token, BROWSER_API_TOKEN)
  return apiTokenMatch || browserTokenMatch
}

export function proxy(req: NextRequest) {
  if (!isAllowedOrigin(req)) {
    return withSecurityHeaders(NextResponse.json({ error: 'Forbidden origin' }, { status: 403 }))
  }

  if (!isAuthorized(req)) {
    if (!API_TOKEN && !BROWSER_API_TOKEN && !ALLOW_INSECURE_LOCAL_DEV) {
      return withSecurityHeaders(
        NextResponse.json(
          {
            error:
              'API authentication is not configured. Set AXON_WEB_API_TOKEN or AXON_WEB_BROWSER_API_TOKEN, or enable AXON_WEB_ALLOW_INSECURE_DEV=true for localhost development.',
          },
          { status: 503 },
        ),
      )
    }
    return withSecurityHeaders(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
  }

  return withSecurityHeaders(NextResponse.next())
}

export const config = {
  matcher: ['/api/:path*'],
}
