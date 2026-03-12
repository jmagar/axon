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

  function normalize(text: string): string {
    return text.replace(/\s+/g, ' ').trim()
  }

  function isSemanticallySameContent(a: string, b: string): boolean {
    if (a === b) return true
    return normalize(a) === normalize(b)
  }

  return historical.map((h, idx) => {
    if (h.sourceMessageId) {
      const bySourceId = live.findIndex(
        (candidate, liveIdx) =>
          !usedLiveIndexes.has(liveIdx) && candidate.sourceMessageId === h.sourceMessageId,
      )
      if (bySourceId >= 0) {
        usedLiveIndexes.add(bySourceId)
        const matched = live[bySourceId]
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
      isSemanticallySameContent(preferred.content, h.content)
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

    const fallbackIdx = live.findIndex(
      (candidate, liveIdx) =>
        !usedLiveIndexes.has(liveIdx) &&
        candidate.role === h.role &&
        isSemanticallySameContent(candidate.content, h.content),
    )
    if (fallbackIdx === -1) return h
    usedLiveIndexes.add(fallbackIdx)
    const fallback = live[fallbackIdx]
    return {
      ...h,
      chainOfThought: h.chainOfThought ?? fallback.chainOfThought,
      blocks: h.blocks ?? fallback.blocks,
      toolUses: h.toolUses ?? fallback.toolUses,
      steps: h.steps ?? fallback.steps,
    }
  })
}
