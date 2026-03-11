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
