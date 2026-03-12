import { createHash } from 'node:crypto'
import type { PulseChatStreamEvent } from '@/lib/pulse/chat-stream'
import { logError, logWarn } from '@/lib/server/logger'
import { getRedisClient } from '@/lib/server/redis-client'

type ReplayCacheEntry = {
  events: PulseChatStreamEvent[]
  sizeBytes: number
  updatedAt: number
}

export const REPLAY_BUFFER_LIMIT = 512
export const REPLAY_CACHE_TTL_MS = 2 * 60_000
export const REPLAY_CACHE_MAX_ENTRIES = 64
export const REPLAY_CACHE_MAX_TOTAL_BYTES = 8 * 1024 * 1024

const REDIS_REPLAY_KEY_PREFIX = 'axon:web:replay:'
const REPLAY_PERSIST_DEBOUNCE_MS = 150
const MAX_PENDING_PERSIST = 100

// In-process cache remains as hot local cache + fallback when Redis is unavailable.
export const replayCache = new Map<string, ReplayCacheEntry>()
let runningTotalBytes = 0

const pendingPersist = new Map<string, ReplayCacheEntry>()
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function estimateEventBytes(event: PulseChatStreamEvent): number {
  try {
    return Buffer.byteLength(JSON.stringify(event), 'utf8')
  } catch {
    return 0
  }
}

function redisKey(key: string): string {
  return `${REDIS_REPLAY_KEY_PREFIX}${key}`
}

function upsertMemoryEntry(key: string, entry: ReplayCacheEntry): void {
  const existing = replayCache.get(key)
  if (existing) {
    runningTotalBytes -= existing.sizeBytes
    replayCache.delete(key)
  }
  runningTotalBytes += entry.sizeBytes
  replayCache.set(key, entry)
  evictOldestEntries()
}

async function persistToRedis(key: string, entry: ReplayCacheEntry): Promise<void> {
  const client = getRedisClient()
  if (!client) return

  try {
    await client.set(redisKey(key), JSON.stringify(entry), {
      PX: REPLAY_CACHE_TTL_MS,
    })
  } catch (error) {
    logError('replay_cache.redis_persist_failed', {
      key,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

function schedulePersist(key: string): void {
  if (persistTimers.has(key)) return

  if (pendingPersist.size >= MAX_PENDING_PERSIST && !pendingPersist.has(key)) {
    logWarn('replay_cache.persist_queue_full', { size: pendingPersist.size })
    return
  }

  const timer = setTimeout(() => {
    persistTimers.delete(key)
    const entry = pendingPersist.get(key)
    if (!entry) return
    pendingPersist.delete(key)
    void persistToRedis(key, entry)
  }, REPLAY_PERSIST_DEBOUNCE_MS)

  persistTimers.set(key, timer)
}

/**
 * Evict oldest entries when the cache exceeds MAX_ENTRIES or MAX_TOTAL_BYTES.
 * Map iteration order is insertion order, so the first keys are the oldest.
 */
export function evictOldestEntries(): void {
  while (
    replayCache.size > REPLAY_CACHE_MAX_ENTRIES ||
    runningTotalBytes > REPLAY_CACHE_MAX_TOTAL_BYTES
  ) {
    const oldest = replayCache.keys().next()
    if (oldest.done) break
    const entry = replayCache.get(oldest.value)
    if (entry) runningTotalBytes -= entry.sizeBytes
    replayCache.delete(oldest.value)
  }
}

export function pruneReplayCache(now: number): void {
  for (const [key, entry] of replayCache.entries()) {
    if (now - entry.updatedAt > REPLAY_CACHE_TTL_MS) {
      runningTotalBytes -= entry.sizeBytes
      replayCache.delete(key)
    }
  }
}

export function upsertReplayEntry(
  key: string,
  events: PulseChatStreamEvent[],
  sizeBytes: number,
  now = Date.now(),
): void {
  const entry: ReplayCacheEntry = { events, sizeBytes, updatedAt: now }
  upsertMemoryEntry(key, entry)
  pendingPersist.set(key, entry)
  schedulePersist(key)
}

export async function getReplayEntry(key: string): Promise<ReplayCacheEntry | null> {
  const cached = replayCache.get(key)
  if (cached && Date.now() - cached.updatedAt <= REPLAY_CACHE_TTL_MS) {
    return cached
  }

  const client = getRedisClient()
  if (!client) return cached ?? null

  try {
    const raw = await client.get(redisKey(key))
    if (!raw) return cached ?? null
    const parsed = JSON.parse(raw) as ReplayCacheEntry
    if (!Array.isArray(parsed.events) || typeof parsed.sizeBytes !== 'number') {
      return cached ?? null
    }
    upsertMemoryEntry(key, parsed)
    return parsed
  } catch (error) {
    logError('replay_cache.redis_read_failed', {
      key,
      message: error instanceof Error ? error.message : String(error),
    })
    return cached ?? null
  }
}

// Periodic TTL eviction — runs once per module load on the server side only.
if (typeof window === 'undefined') {
  setInterval(() => pruneReplayCache(Date.now()), 60_000)
}

export function computeReplayKey(data: {
  prompt: string
  documentMarkdown: string
  selectedCollections: string[]
  threadSources: string[]
  scrapedContext: unknown
  conversationHistory: unknown[]
  permissionLevel: string
  agent: string
  model: string
}): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex')
}
