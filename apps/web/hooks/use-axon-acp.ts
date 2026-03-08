'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { MessageItem } from './use-axon-session'
import { useAxonWs } from './use-axon-ws'

interface UseAxonAcpOptions {
  activeSessionId: string | null
  onSessionIdChange: (newId: string) => void
  onSessionFallback?: (oldId: string, newId: string) => void
  onMessagesChange: (updater: (prev: MessageItem[]) => MessageItem[]) => void
  onTurnComplete?: () => void
}

export function useAxonAcp({
  activeSessionId,
  onSessionIdChange,
  onSessionFallback,
  onMessagesChange,
  onTurnComplete,
}: UseAxonAcpOptions) {
  const [isStreaming, setIsStreaming] = useState(false)
  const streamingIdRef = useRef<string | null>(null)
  const { send, subscribe, status } = useAxonWs()
  const connected = status === 'connected'

  useEffect(() => {
    return subscribe((rawMsg) => {
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
          setIsStreaming(false)
          streamingIdRef.current = null
          onTurnComplete?.()
          break
        }

        case 'error': {
          const errSid = streamingIdRef.current
          setIsStreaming(false)
          streamingIdRef.current = null
          if (errSid) {
            onMessagesChange((prev) => prev.filter((m) => m.id !== errSid))
          }
          break
        }
      }
    })
  }, [subscribe, onMessagesChange, onSessionIdChange, onSessionFallback, onTurnComplete])

  const submitPrompt = useCallback(
    (prompt: string) => {
      if (!connected || isStreaming) return

      const userId = `user-${Date.now()}`
      const assistantId = `assistant-${Date.now()}`
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

      send({
        type: 'execute',
        mode: 'pulse_chat',
        input: prompt,
        flags: {
          ...(activeSessionId ? { session_id: activeSessionId } : {}),
          agent: 'claude',
        },
      })
    },
    [connected, isStreaming, activeSessionId, send, onMessagesChange],
  )

  return { submitPrompt, isStreaming, connected }
}
