import { NextResponse } from 'next/server'

interface WindowLimit {
  max: number
  windowMs: number
}

interface Counter {
  count: number
  resetAt: number
}

const counters = new Map<string, Counter>()
const MAX_COUNTER_KEYS = 10_000
const EVICT_INTERVAL_MS = 60_000

let lastEvictAt = 0

function evictExpired(now: number): void {
  if (now - lastEvictAt < EVICT_INTERVAL_MS) return
  lastEvictAt = now
  for (const [key, counter] of counters) {
    if (counter.resetAt <= now) counters.delete(key)
  }
}

/**
 * Resolve the client IP address for rate-limit keying.
 *
 * TRUST MODEL — read before modifying:
 *
 * x-forwarded-for is a client-controlled header. Any client can set it to an
 * arbitrary value, making IP-based rate limiting trivially bypassable if this
 * header is blindly trusted without verifying the request path through a
 * trusted proxy.
 *
 * Deployment scenarios and their security posture:
 *
 *   1. Direct access (no reverse proxy, default self-hosted setup):
 *      x-forwarded-for is fully spoofable. A single attacker can impersonate
 *      thousands of IPs by rotating the header. The MAX_COUNTER_KEYS cap is
 *      the primary DoS defense: once 10 000 keys are tracked, new spoofed IPs
 *      are immediately rate-limited (count > max, synthetic counter returned).
 *
 *   2. Behind a trusted reverse proxy (nginx, Caddy, Traefik):
 *      The proxy overwrites or appends to x-forwarded-for with the real client
 *      IP before forwarding. Set AXON_TRUST_PROXY=true in the environment to
 *      opt into header-based IP extraction. Ensure the proxy strips any
 *      client-supplied x-forwarded-for before adding its own.
 *
 *   3. Socket IP fallback (AXON_TRUST_PROXY unset or falsy):
 *      Falls back to request.socket?.remoteAddress, which reflects the TCP
 *      peer address and cannot be spoofed. In a direct-access deployment this
 *      is the attacker's real IP. In a proxy deployment this would be the
 *      proxy's IP (collapsing all clients to one key) — which is why the env
 *      var opt-in exists.
 *
 * If you add a reverse proxy to this deployment, set AXON_TRUST_PROXY=true
 * and configure the proxy to sanitize x-forwarded-for headers.
 */
function getClientIp(request: Request): string {
  const trustProxy = process.env.AXON_TRUST_PROXY === 'true'

  if (trustProxy) {
    // Proxy is trusted: use the leftmost (client) IP from x-forwarded-for.
    // The proxy must sanitize this header before forwarding.
    const forwarded = request.headers.get('x-forwarded-for')
    if (forwarded) {
      const first = forwarded.split(',')[0]?.trim()
      if (first) return first
    }
    const real = request.headers.get('x-real-ip')?.trim()
    if (real) return real
  }

  // No trusted proxy: use socket remoteAddress (TCP peer, cannot be spoofed).
  // In direct-access deployments this is the true client IP.
  // Cast needed: Next.js Request wraps the Web API Request and exposes socket
  // on the underlying IncomingMessage via the node:http adapter.
  const socketIp = (request as unknown as { socket?: { remoteAddress?: string } }).socket
    ?.remoteAddress
  if (socketIp) return socketIp

  // Last resort: fall back to x-forwarded-for even without proxy trust,
  // so the rate limiter degrades gracefully rather than keying everything
  // on 'unknown'. MAX_COUNTER_KEYS still caps spoofing damage.
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }

  return 'unknown'
}

function getKey(scope: string, request: Request): string {
  return `${scope}:${getClientIp(request)}`
}

function increment(scope: string, request: Request, limit: WindowLimit, now: number): Counter {
  // Evict proactively when nearing capacity to avoid rejecting legitimate new keys.
  // Force eviction at most once per second to prevent full-map sweep on every request.
  if (counters.size >= MAX_COUNTER_KEYS && now - lastEvictAt >= 1_000) {
    lastEvictAt = 0
  }
  evictExpired(now)

  const key = getKey(scope, request)
  const existing = counters.get(key)
  if (!existing || existing.resetAt <= now) {
    // Prevent unbounded growth from spoofed IPs: reject new keys when at capacity
    if (!existing && counters.size >= MAX_COUNTER_KEYS) {
      return { count: limit.max + 1, resetAt: now + limit.windowMs }
    }
    const fresh: Counter = { count: 1, resetAt: now + limit.windowMs }
    counters.set(key, fresh)
    return fresh
  }
  const updated: Counter = { count: existing.count + 1, resetAt: existing.resetAt }
  counters.set(key, updated)
  return updated
}

export function enforceRateLimit(
  scope: string,
  request: Request,
  limit: WindowLimit,
): NextResponse | null {
  const now = Date.now()
  const counter = increment(scope, request, limit, now)
  if (counter.count <= limit.max) return null

  const retryAfterSec = Math.max(1, Math.ceil((counter.resetAt - now) / 1000))
  return NextResponse.json(
    {
      error: 'Rate limit exceeded',
      code: 'RATE_LIMIT_EXCEEDED',
      detail: `Retry in ${retryAfterSec}s`,
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfterSec),
      },
    },
  )
}
