import type { SessionFile } from '@/lib/sessions/session-scanner'
import { scanSessions } from '@/lib/sessions/session-scanner'

interface CacheEntry {
  expiresAt: number
  sessions: SessionFile[]
}

const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<SessionFile[]>>()

interface SessionCacheOptions {
  assistantMode: boolean
  limit: number
  perAgentLimit: number
  ttlMs?: number
}

function cacheKey(options: SessionCacheOptions): string {
  return `${options.assistantMode ? 'assistant' : 'default'}:${options.limit}:${options.perAgentLimit}`
}

export async function getCachedSessions(options: SessionCacheOptions): Promise<SessionFile[]> {
  const key = cacheKey(options)
  const now = Date.now()
  const ttlMs = options.ttlMs ?? 3000
  const hit = cache.get(key)
  if (hit && hit.expiresAt > now) {
    return hit.sessions
  }

  // Deduplicate concurrent calls for the same key
  const pending = inflight.get(key)
  if (pending) return pending

  const promise = scanSessions(options.limit, options.perAgentLimit, {
    assistantMode: options.assistantMode,
  })
    .then((sessions) => {
      cache.set(key, { sessions, expiresAt: Date.now() + ttlMs })
      inflight.delete(key)
      return sessions
    })
    .catch((err) => {
      inflight.delete(key)
      throw err
    })

  inflight.set(key, promise)
  return promise
}
