'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import type { AxonMessage } from './use-axon-session'
import { useAxonWs } from './use-axon-ws'

// Zod schema for the editor_update wire message.  Any change to this shape
// requires updating both this schema and the Rust EditorOperation enum in
// crates/services/events.rs — they are the single canonical definition.
const EditorUpdateSchema = z.object({
  type: z.literal('editor_update'),
  content: z.string(),
  operation: z.enum(['replace', 'append']).default('replace'),
})

const STREAMING_TIMEOUT_MS = 300_000

/**
 * Handle an `editor_update` wire message.
 * Validates the message shape with Zod, invokes the editor content callback,
 * and calls `onShowEditor` so callers can reveal the editor pane on mobile.
 *
 * Exported for testing — callers should use the `useAxonAcp` hook instead of
 * calling this directly.
 */
export function handleEditorMsg(
  msg: Record<string, unknown>,
  onEditorUpdate: ((content: string, operation: 'replace' | 'append') => void) | undefined,
  onShowEditor: (() => void) | undefined,
): void {
  const result = EditorUpdateSchema.safeParse(msg)
  if (!result.success) {
    console.warn('[acp] editor_update validation failed:', result.error.issues)
    return
  }
  onEditorUpdate?.(result.data.content, result.data.operation)
  onShowEditor?.()
}

interface UseAxonAcpOptions {
  activeSessionId: string | null
  agent?: string
  /** When true, sends assistant_mode:true so backend uses assistant CWD. */
  assistantMode?: boolean
  onSessionIdChange: (newId: string) => void
  onSessionFallback?: (oldId: string, newId: string) => void
  onMessagesChange: (updater: (prev: AxonMessage[]) => AxonMessage[]) => void
  onTurnComplete?: () => void
  onEditorUpdate?: (content: string, operation: 'replace' | 'append') => void
  /** Called when an `editor_update` message is received. Use this to make the editor
   * pane visible on mobile viewports when the agent writes to the document. */
  onShowEditor?: () => void
}

export function useAxonAcp({
  activeSessionId,
  agent = 'claude',
  assistantMode = false,
  onSessionIdChange,
  onSessionFallback,
  onMessagesChange,
  onTurnComplete,
  onEditorUpdate,
  onShowEditor,
}: UseAxonAcpOptions) {
  const [isStreaming, setIsStreaming] = useState(false)
  const streamingIdRef = useRef<string | null>(null)
  const streamingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { send, subscribe, status } = useAxonWs()
  const connected = status === 'connected'

  useEffect(() => {
    const unsubscribe = subscribe((rawMsg) => {
      let msg = rawMsg as unknown as Record<string, unknown>

      // Rust backend wraps all ACP events in command.output.json.
      // Unwrap the inner payload so the switch below can match ACP event types.
      if (msg.type === 'command.output.json' && msg.data !== null && typeof msg.data === 'object') {
        const outer = msg.data as Record<string, unknown>
        const ctx = outer.ctx as Record<string, unknown> | undefined
        if (ctx?.mode === 'pulse_chat' && outer.data !== null && typeof outer.data === 'object') {
          msg = outer.data as Record<string, unknown>
        }
      }

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
          // Check BEFORE clearing — if already null the turn timed out; skip
          // onTurnComplete/onSessionIdChange to prevent a late result from a
          // slow agent (e.g. Gemini) polluting the next turn's session state.
          const wasActiveTurn = streamingIdRef.current !== null
          const newSessionId = msg.session_id as string | undefined
          if (streamingTimeoutRef.current) clearTimeout(streamingTimeoutRef.current)
          setIsStreaming(false)
          streamingIdRef.current = null
          if (wasActiveTurn) {
            onTurnComplete?.()
            // With the persistent adapter, session data is written incrementally —
            // trigger session fetch immediately without waiting for a polling event.
            if (newSessionId) {
              onSessionIdChange(newSessionId)
            }
          }
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

        case 'tool_use': {
          const toolCallId = (msg.tool_call_id as string) ?? ''
          const toolName = (msg.tool_name as string) ?? 'unknown'
          const toolInput = (msg.tool_input as Record<string, unknown>) ?? {}
          const sid = streamingIdRef.current
          if (!sid) return
          onMessagesChange((prev) =>
            prev.map((m) =>
              m.id === sid
                ? {
                    ...m,
                    toolUses: [
                      ...(m.toolUses ?? []),
                      { name: toolName, input: toolInput, toolCallId, status: 'running' },
                    ],
                  }
                : m,
            ),
          )
          break
        }

        case 'tool_use_update': {
          const toolCallId = (msg.tool_call_id as string) ?? ''
          const toolStatus = (msg.tool_status as string) ?? ''
          const toolContent = (msg.tool_content as string) ?? ''
          const sid = streamingIdRef.current
          if (!sid) return
          onMessagesChange((prev) =>
            prev.map((m) =>
              m.id === sid
                ? {
                    ...m,
                    toolUses: (m.toolUses ?? []).map((tu) =>
                      tu.toolCallId === toolCallId
                        ? {
                            ...tu,
                            status: toolStatus || tu.status,
                            content: toolContent
                              ? tu.content
                                ? `${tu.content}${toolContent}`
                                : toolContent
                              : tu.content,
                          }
                        : tu,
                    ),
                  }
                : m,
            ),
          )
          break
        }

        case 'editor_update': {
          handleEditorMsg(msg, onEditorUpdate, onShowEditor)
          break
        }
      }
    })
    return () => {
      // Clear pending timeout to prevent setState/onMessagesChange calls
      // after the hook is unmounted.
      if (streamingTimeoutRef.current) {
        clearTimeout(streamingTimeoutRef.current)
        streamingTimeoutRef.current = null
      }
      unsubscribe()
    }
  }, [
    subscribe,
    onMessagesChange,
    onSessionIdChange,
    onSessionFallback,
    onTurnComplete,
    onEditorUpdate,
    onShowEditor,
  ])

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
          ...(assistantMode ? { assistant_mode: true } : {}),
        },
      })
    },
    [connected, isStreaming, activeSessionId, agent, assistantMode, send, onMessagesChange],
  )

  return { submitPrompt, isStreaming, connected }
}
