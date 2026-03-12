import type { AxonMessage } from '@/hooks/use-axon-session'

export function shouldSyncHistoricalMessages(args: {
  isStreaming: boolean
  sessionLoading: boolean
  sessionError: string | null
  sessionChanged: boolean
  historicalCount: number
  liveCount: number
}): boolean {
  const { isStreaming, sessionLoading, sessionError, sessionChanged, historicalCount, liveCount } =
    args

  if (isStreaming) return false
  if (sessionLoading) return false
  if (sessionError) return false

  // Prevent stale/empty JSONL reads from wiping optimistic live turns.
  if (historicalCount === 0 && liveCount > 0) return false
  if (historicalCount < liveCount) return false

  // Changing sessions can replace live state once stale overwrite checks pass.
  if (sessionChanged) return true

  return true
}

/**
 * Merge historical session messages with richer live message metadata.
 * Historical reads from JSONL only contain role/content/timestamp, while live
 * messages may include streamed chain-of-thought/tool metadata not persisted
 * in session files yet.
 */
export function mergeHistoricalMessages(
  historical: AxonMessage[],
  live: AxonMessage[],
): AxonMessage[] {
  const usedLiveIndexes = new Set<number>()

  // Build lookup maps — O(n) construction, O(1) lookup per historical message
  const liveBySourceId = new Map<string, number>()
  for (let i = 0; i < live.length; i++) {
    // i is always a valid index — loop bounds ensure it
    const m = live[i]!
    if (m.sourceMessageId && !liveBySourceId.has(m.sourceMessageId)) {
      liveBySourceId.set(m.sourceMessageId, i)
    }
  }

  return historical.map((h, idx) => {
    if (h.sourceMessageId) {
      const bySourceIdx = liveBySourceId.get(h.sourceMessageId)
      if (bySourceIdx !== undefined && !usedLiveIndexes.has(bySourceIdx)) {
        usedLiveIndexes.add(bySourceIdx)
        // bySourceIdx was stored from a valid live[] iteration — always defined
        const matched = live[bySourceIdx]!
        return {
          ...h,
          chainOfThought: h.chainOfThought ?? matched.chainOfThought,
          blocks: h.blocks ?? matched.blocks,
          toolUses: h.toolUses ?? matched.toolUses,
          steps: h.steps ?? matched.steps,
        }
      }
    }

    const preferred = live[idx]
    if (
      preferred &&
      !usedLiveIndexes.has(idx) &&
      preferred.role === h.role &&
      preferred.content === h.content
    ) {
      usedLiveIndexes.add(idx)
      return {
        ...h,
        chainOfThought: h.chainOfThought ?? preferred.chainOfThought,
        blocks: h.blocks ?? preferred.blocks,
        toolUses: h.toolUses ?? preferred.toolUses,
        steps: h.steps ?? preferred.steps,
      }
    }

    return h
  })
}
