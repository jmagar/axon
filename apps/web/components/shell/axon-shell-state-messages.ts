'use client'

import { useCallback, useEffect, useRef } from 'react'
import type { AxonMessage } from '@/hooks/use-axon-session'
import { useShellStore } from '@/lib/shell-store'
import { LIVE_MESSAGES_STORAGE_KEY } from './axon-shell-state-helpers'

export function useAxonShellMessages() {
  const liveMessages = useShellStore((s) => s.liveMessages)
  const liveMessagesHydrated = useShellStore((s) => s.liveMessagesHydrated)
  const setLiveMessages = useShellStore((s) => s.setLiveMessages)
  const setLiveMessagesHydrated = useShellStore((s) => s.setLiveMessagesHydrated)

  const persistDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onMessagesChange = useCallback(
    (updater: (prev: AxonMessage[]) => AxonMessage[]) => {
      setLiveMessages(updater)
    },
    [setLiveMessages],
  )

  useEffect(() => {
    let timer: number | null = null
    try {
      const raw = window.sessionStorage.getItem(LIVE_MESSAGES_STORAGE_KEY)
      if (!raw) {
        setLiveMessagesHydrated(true)
        return
      }
      const parsed = JSON.parse(raw) as { messages?: AxonMessage[] }
      if (Array.isArray(parsed.messages)) {
        setLiveMessages(parsed.messages)
      }
    } catch {
      // Ignore
    }
    timer = window.setTimeout(() => setLiveMessagesHydrated(true), 0)
    return () => {
      if (timer !== null) window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setLiveMessages, setLiveMessagesHydrated])

  const persistMessages = useCallback(
    (
      connected: boolean,
      chatSessionId: string | null,
      messages: AxonMessage[],
      immediate = false,
    ) => {
      if (!connected && chatSessionId === null && messages.length === 0) return
      if (chatSessionId === null && messages.length === 0) {
        try {
          const existingRaw = window.sessionStorage.getItem(LIVE_MESSAGES_STORAGE_KEY)
          if (existingRaw) {
            const existing = JSON.parse(existingRaw) as { messages?: AxonMessage[] }
            if (Array.isArray(existing.messages) && existing.messages.length > 0) return
          }
        } catch {
          // Ignore
        }
      }

      const write = () => {
        const payload = { messages: messages.slice(-200) }
        try {
          window.sessionStorage.setItem(LIVE_MESSAGES_STORAGE_KEY, JSON.stringify(payload))
        } catch {
          // Ignore
        }
      }

      if (immediate) {
        // Flush immediately (unmount / cleanup path)
        if (persistDebounceRef.current !== null) {
          clearTimeout(persistDebounceRef.current)
          persistDebounceRef.current = null
        }
        write()
      } else {
        // Debounce: at most one write per second during streaming
        if (persistDebounceRef.current !== null) clearTimeout(persistDebounceRef.current)
        persistDebounceRef.current = setTimeout(() => {
          persistDebounceRef.current = null
          write()
        }, 1000)
      }
    },
    // persistDebounceRef is stable (useRef); no need to list it
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  return {
    liveMessages,
    setLiveMessages,
    liveMessagesHydrated,
    onMessagesChange,
    persistMessages,
  }
}
