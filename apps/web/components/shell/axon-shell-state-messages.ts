'use client'

import { useCallback, useEffect, useState } from 'react'
import type { AxonMessage } from '@/hooks/use-axon-session'
import { LIVE_MESSAGES_STORAGE_KEY } from './axon-shell-state-helpers'

export function useAxonShellMessages() {
  const [liveMessages, setLiveMessages] = useState<AxonMessage[]>([])
  const [liveMessagesHydrated, setLiveMessagesHydrated] = useState(false)

  const onMessagesChange = useCallback((updater: (prev: AxonMessage[]) => AxonMessage[]) => {
    setLiveMessages(updater)
  }, [])

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
  }, [])

  const persistMessages = useCallback(
    (connected: boolean, chatSessionId: string | null, messages: AxonMessage[]) => {
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
      const payload = { messages: messages.slice(-200) }
      try {
        window.sessionStorage.setItem(LIVE_MESSAGES_STORAGE_KEY, JSON.stringify(payload))
      } catch {
        // Ignore
      }
    },
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
