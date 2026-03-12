import type { MutableRefObject } from 'react'
import { useCallback } from 'react'
import type { WsUsageStats } from '@/lib/ws-protocol'
import type { AxonMessage } from '../use-axon-session'

export interface StreamFlushRefs {
  streamingIdRef: MutableRefObject<string | null>
  pendingDeltaRef: MutableRefObject<string>
  pendingThinkingRef: MutableRefObject<string[]>
  pendingUsageRef: MutableRefObject<WsUsageStats | null>
  pendingLocationsRef: MutableRefObject<{
    toolCallId: string | undefined
    locations: string[]
  } | null>
  flushTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>
}

/**
 * Returns a stable `flushBufferedStream` callback that drains the accumulated
 * delta/thinking/usage/locations refs into the message list in a single
 * `prev.map()` pass, avoiding extra React state updates per streaming event.
 */
export function useFlushBufferedStream(
  refs: StreamFlushRefs,
  onMessagesChange: (updater: (prev: AxonMessage[]) => AxonMessage[]) => void,
) {
  return useCallback(() => {
    refs.flushTimerRef.current = null
    const sid = refs.streamingIdRef.current
    if (!sid) {
      refs.pendingDeltaRef.current = ''
      refs.pendingThinkingRef.current = []
      refs.pendingUsageRef.current = null
      refs.pendingLocationsRef.current = null
      return
    }
    const delta = refs.pendingDeltaRef.current
    const thoughts = refs.pendingThinkingRef.current
    const usage = refs.pendingUsageRef.current
    const locationsPatch = refs.pendingLocationsRef.current
    refs.pendingDeltaRef.current = ''
    refs.pendingThinkingRef.current = []
    refs.pendingUsageRef.current = null
    refs.pendingLocationsRef.current = null
    if (!delta && thoughts.length === 0 && !usage && !locationsPatch) return
    onMessagesChange((prev) =>
      prev.map((m) => {
        if (m.id !== sid) return m
        // Build the merged update in a single pass — no separate map() calls.
        const nextContent = delta ? m.content + delta : m.content
        const nextChainOfThought =
          thoughts.length > 0
            ? (() => {
                const thoughtDelta = thoughts.join('')
                if (!thoughtDelta) return m.chainOfThought
                if (!m.chainOfThought || m.chainOfThought.length === 0) return [thoughtDelta]
                const next = [...m.chainOfThought]
                next[next.length - 1] = `${next[next.length - 1] ?? ''}${thoughtDelta}`
                return next
              })()
            : m.chainOfThought
        const nextUsage = usage ? ({ ...(m.usage ?? {}), ...usage } as WsUsageStats) : m.usage
        const nextToolUses = locationsPatch
          ? (m.toolUses ?? []).map((tu, idx, arr) =>
              tu.toolCallId === locationsPatch.toolCallId ||
              (!locationsPatch.toolCallId && idx === arr.length - 1)
                ? { ...tu, locations: locationsPatch.locations }
                : tu,
            )
          : m.toolUses
        return {
          ...m,
          content: nextContent,
          chainOfThought: nextChainOfThought,
          ...(nextUsage !== m.usage ? { usage: nextUsage } : {}),
          ...(nextToolUses !== m.toolUses ? { toolUses: nextToolUses } : {}),
        }
      }),
    )
  }, [refs, onMessagesChange])
}

/**
 * Returns a `scheduleFlushBufferedStream` callback that arms a 32 ms debounce
 * timer — only one timer is live at a time.
 */
export function useScheduleFlush(
  flushTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>,
  flushBufferedStream: () => void,
) {
  return useCallback(() => {
    if (flushTimerRef.current) return
    flushTimerRef.current = setTimeout(() => {
      flushBufferedStream()
    }, 32)
  }, [flushTimerRef, flushBufferedStream])
}
