'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { MessageItem } from './use-axon-session'
import { useAxonWs } from './use-axon-ws'

const STREAMING_TIMEOUT_MS = 60_000

interface UseAxonAcpOptions {
  activeSessionId: string | null
  agent?: string
  onSessionIdChange: (newId: string) => void
  onSessionFallback?: (oldId: string, newId: string) => void
  onMessagesChange: (updater: (prev: MessageItem[]) => MessageItem[]) => void
  onTurnComplete?: () => void
}

export function useAxonAcp({
  activeSessionId,
  agent = 'claude',
  onSessionIdChange,
  onSessionFallback,
  onMessagesChange,
  onTurnComplete,
}: UseAxonAcpOptions) {
  const [isStreaming, setIsStreaming] = useState(false)
  const streamingIdRef = useRef<string | null>(null)
  const streamingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { send, subscribe, status } = useAxonWs()
  const connected = status === 'connected'

  useEffect(() => {
    const unsubscribe = subscribe((rawMsg) => {
      const msg = rawMsg as unknown as Record<string, unknown>

      switch (msg.type) {
        case 'assistant_delta': {
          const delta = (msg.delta as string) ?? ''
          const sid = streamingIdRef.current
          if (!sid) return
          onMessagesChange((prev) =>
            prev.map((m) => (m.id === sid ? { ...m, content: m.content + delta } : m)),
          )
          break
        }

        case 'thinking_content': {
          const content = (msg.content as string) ?? ''
          const sid = streamingIdRef.current
          if (!sid) return
          onMessagesChange((prev) =>
            prev.map((m) =>
              m.id === sid ? { ...m, chainOfThought: [...(m.chainOfThought ?? []), content] } : m,
            ),
          )
          break
        }

        case 'session_fallback': {
          const oldId = (msg.old_session_id as string) ?? ''
          const newId = (msg.new_session_id as string) ?? ''
          if (newId) {
            onSessionIdChange(newId)
            onSessionFallback?.(oldId, newId)
          }
          break
        }

        case 'result': {
          const newSessionId = msg.session_id as string | undefined
          if (newSessionId) onSessionIdChange(newSessionId)
          if (streamingTimeoutRef.current) clearTimeout(streamingTimeoutRef.current)
          setIsStreaming(false)
          streamingIdRef.current = null
          onTurnComplete?.()
          break
        }

        case 'error': {
          const errSid = streamingIdRef.current
          const errMsg = (msg.message as string) || (msg.error as string) || 'Agent error'
          if (streamingTimeoutRef.current) clearTimeout(streamingTimeoutRef.current)
          setIsStreaming(false)
          streamingIdRef.current = null
          if (errSid) {
            onMessagesChange((prev) =>
              prev.map((m) =>
                m.id === errSid ? { ...m, content: `⚠ ${errMsg}`, streaming: false } : m,
              ),
            )
          }
          break
        }
      }
    })
    return () => {
      // Clear any pending streaming timeout to prevent setState/onMessagesChange
      // calls after the hook is unmounted.
      if (streamingTimeoutRef.current) {
        clearTimeout(streamingTimeoutRef.current)
        streamingTimeoutRef.current = null
      }
      unsubscribe()
    }
  }, [subscribe, onMessagesChange, onSessionIdChange, onSessionFallback, onTurnComplete])

  const submitPrompt = useCallback(
    (prompt: string) => {
      if (!connected || isStreaming) return

      const userId = `user-${crypto.randomUUID()}`
      const assistantId = `assistant-${crypto.randomUUID()}`
      streamingIdRef.current = assistantId

      onMessagesChange((prev) => [
        ...prev,
        { id: userId, role: 'user' as const, content: prompt, timestamp: Date.now() },
        {
          id: assistantId,
          role: 'assistant' as const,
          content: '',
          timestamp: Date.now(),
          streaming: true,
        },
      ])

      setIsStreaming(true)

      // Fallback: clear stuck streaming state after timeout
      if (streamingTimeoutRef.current) clearTimeout(streamingTimeoutRef.current)
      streamingTimeoutRef.current = setTimeout(() => {
        const sid = streamingIdRef.current
        setIsStreaming(false)
        streamingIdRef.current = null
        if (sid) {
          onMessagesChange((prev) =>
            prev.map((m) =>
              m.id === sid
                ? {
                    ...m,
                    content: m.content || '⚠ No response received — check agent configuration',
                    streaming: false,
                  }
                : m,
            ),
          )
        }
      }, STREAMING_TIMEOUT_MS)

      send({
        type: 'execute',
        mode: 'pulse_chat',
        input: prompt,
        flags: {
          ...(activeSessionId ? { session_id: activeSessionId } : {}),
          agent,
        },
      })
    },
    [connected, isStreaming, activeSessionId, agent, send, onMessagesChange],
  )

  return { submitPrompt, isStreaming, connected }
}
