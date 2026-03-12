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

function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  const real = request.headers.get('x-real-ip')?.trim()
  if (real) return real
  return 'unknown'
}

function getKey(scope: string, request: Request): string {
  return `${scope}:${getClientIp(request)}`
}

function increment(scope: string, request: Request, limit: WindowLimit, now: number): Counter {
  // Evict proactively when nearing capacity to avoid rejecting legitimate new keys.
  // Force eviction regardless of EVICT_INTERVAL_MS when at capacity.
  if (counters.size >= MAX_COUNTER_KEYS) {
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
