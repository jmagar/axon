'use client'

import { useEffect, useRef } from 'react'

interface UseAdaptivePollingOptions {
  enabled?: boolean
  pauseWhenHidden?: boolean
  hiddenIntervalMultiplier?: number
  jitterRatio?: number
}

export function useAdaptivePolling(
  callback: () => void | Promise<void>,
  intervalMs: number,
  options: UseAdaptivePollingOptions = {},
): void {
  const {
    enabled = true,
    pauseWhenHidden = true,
    hiddenIntervalMultiplier = 3,
    jitterRatio = 0.1,
  } = options
  const callbackRef = useRef(callback)

  callbackRef.current = callback

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return

    let timer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false

    const schedule = () => {
      if (cancelled) return
      const isHidden = pauseWhenHidden && document.visibilityState === 'hidden'
      const baseInterval = isHidden
        ? Math.max(1000, Math.round(intervalMs * hiddenIntervalMultiplier))
        : intervalMs
      const jitter = Math.round(baseInterval * jitterRatio * (Math.random() * 2 - 1))
      const delay = Math.max(250, baseInterval + jitter)
      timer = setTimeout(async () => {
        try {
          await callbackRef.current()
        } catch {
          // Swallow so a throwing callback does not kill the polling loop.
        }
        schedule()
      }, delay)
    }

    const onVisibilityChange = () => {
      if (!pauseWhenHidden) return
      if (document.visibilityState === 'visible') {
        if (timer) clearTimeout(timer)
        timer = null
        void (async () => {
          try {
            await callbackRef.current()
          } catch {
            // Swallow — same rationale as above.
          }
        })()
        schedule()
      }
    }

    schedule()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [enabled, hiddenIntervalMultiplier, intervalMs, jitterRatio, pauseWhenHidden])
}
