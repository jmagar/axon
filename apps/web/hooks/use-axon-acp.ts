'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import type { AcpConfigOption } from '@/lib/pulse/types'
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

function createFallbackClientId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}

/**
 * Generate client-side IDs in both secure and insecure contexts.
 * `crypto.randomUUID()` is unavailable on non-secure origins (for example
 * http://10.x.x.x on mobile LAN), so we must gracefully fall back.
 */
export function createClientMessageId(prefix: string): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}-${crypto.randomUUID()}`
    }
  } catch {
    // Fall through to non-crypto fallback.
  }
  return createFallbackClientId(prefix)
}

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
  model?: string
  sessionMode?: string
  enabledMcpServers?: string[]
  blockedMcpTools?: string[]
  /** When true, sends assistant_mode:true so backend uses assistant CWD. */
  assistantMode?: boolean
  handoffContext?: string | null
  onSessionIdChange: (newId: string) => void
  onSessionFallback?: (oldId: string, newId: string) => void
  onMessagesChange: (updater: (prev: AxonMessage[]) => AxonMessage[]) => void
  onAcpConfigOptionsUpdate?: (options: AcpConfigOption[]) => void
  onCommandsUpdate?: (commands: Array<{ name: string; description?: string }>) => void
  onHandoffConsumed?: () => void
  onTurnComplete?: () => void
  onEditorUpdate?: (content: string, operation: 'replace' | 'append') => void
  /** Called when an `editor_update` message is received. Use this to make the editor
   * pane visible on mobile viewports when the agent writes to the document. */
  onShowEditor?: () => void
}

export function useAxonAcp({
  activeSessionId,
  agent = 'claude',
  model,
  sessionMode,
  enabledMcpServers = [],
  blockedMcpTools = [],
  assistantMode = false,
  handoffContext = null,
  onSessionIdChange,
  onSessionFallback,
  onMessagesChange,
  onAcpConfigOptionsUpdate,
  onCommandsUpdate,
  onHandoffConsumed,
  onTurnComplete,
  onEditorUpdate,
  onShowEditor,
}: UseAxonAcpOptions) {
  const [isStreaming, setIsStreaming] = useState(false)
  const streamingIdRef = useRef<string | null>(null)
  const streamingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingDeltaRef = useRef('')
  const pendingThinkingRef = useRef<string[]>([])
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const turnStartAtRef = useRef<number | null>(null)
  const firstDeltaAtRef = useRef<number | null>(null)
  const streamedCharsRef = useRef(0)
  const { send, subscribe, status } = useAxonWs()
  const connected = status === 'connected'

  const flushBufferedStream = useCallback(() => {
    flushTimerRef.current = null
    const sid = streamingIdRef.current
    if (!sid) {
      pendingDeltaRef.current = ''
      pendingThinkingRef.current = []
      return
    }
    const delta = pendingDeltaRef.current
    const thoughts = pendingThinkingRef.current
    pendingDeltaRef.current = ''
    pendingThinkingRef.current = []
    if (!delta && thoughts.length === 0) return
    onMessagesChange((prev) =>
      prev.map((m) =>
        m.id === sid
          ? {
              ...m,
              content: delta ? m.content + delta : m.content,
              chainOfThought:
                thoughts.length > 0
                  ? (() => {
                      const thoughtDelta = thoughts.join('')
                      if (!thoughtDelta) return m.chainOfThought
                      if (!m.chainOfThought || m.chainOfThought.length === 0) return [thoughtDelta]
                      const next = [...m.chainOfThought]
                      next[next.length - 1] = `${next[next.length - 1] ?? ''}${thoughtDelta}`
                      return next
                    })()
                  : m.chainOfThought,
            }
          : m,
      ),
    )
  }, [onMessagesChange])

  const scheduleFlushBufferedStream = useCallback(() => {
    if (flushTimerRef.current) return
    flushTimerRef.current = setTimeout(() => {
      flushBufferedStream()
    }, 32)
  }, [flushBufferedStream])

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
          if (!sid || !delta) return
          if (firstDeltaAtRef.current === null) firstDeltaAtRef.current = Date.now()
          streamedCharsRef.current += delta.length
          pendingDeltaRef.current += delta
          scheduleFlushBufferedStream()
          break
        }

        case 'thinking_content': {
          const content = (msg.content as string) ?? ''
          const sid = streamingIdRef.current
          if (!sid || !content) return
          pendingThinkingRef.current.push(content)
          scheduleFlushBufferedStream()
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
          flushBufferedStream()
          // Check BEFORE clearing — if already null the turn timed out; skip
          // onTurnComplete/onSessionIdChange to prevent a late result from a
          // slow agent (e.g. Gemini) polluting the next turn's session state.
          const wasActiveTurn = streamingIdRef.current !== null
          const newSessionId = msg.session_id as string | undefined
          if (streamingTimeoutRef.current) clearTimeout(streamingTimeoutRef.current)
          if (process.env.NODE_ENV !== 'production' && turnStartAtRef.current !== null) {
            const end = Date.now()
            const durationMs = end - turnStartAtRef.current
            const firstDeltaMs =
              firstDeltaAtRef.current === null
                ? null
                : firstDeltaAtRef.current - turnStartAtRef.current
            const charsPerSec =
              durationMs > 0
                ? Number(((streamedCharsRef.current * 1000) / durationMs).toFixed(1))
                : 0
            console.debug('[acp-stream-telemetry]', {
              agent,
              model: model ?? 'default',
              sessionMode: sessionMode ?? 'default',
              durationMs,
              firstDeltaMs,
              streamedChars: streamedCharsRef.current,
              charsPerSec,
            })
          }
          setIsStreaming(false)
          streamingIdRef.current = null
          turnStartAtRef.current = null
          firstDeltaAtRef.current = null
          streamedCharsRef.current = 0
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
          flushBufferedStream()
          const errSid = streamingIdRef.current
          const errMsg = (msg.message as string) || (msg.error as string) || 'Agent error'
          if (streamingTimeoutRef.current) clearTimeout(streamingTimeoutRef.current)
          setIsStreaming(false)
          streamingIdRef.current = null
          turnStartAtRef.current = null
          firstDeltaAtRef.current = null
          streamedCharsRef.current = 0
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
          const now = Date.now()
          const sid = streamingIdRef.current
          if (!sid) return
          onMessagesChange((prev) =>
            prev.map((m) =>
              m.id === sid
                ? {
                    ...m,
                    toolUses: [
                      ...(m.toolUses ?? []),
                      {
                        name: toolName,
                        input: toolInput,
                        toolCallId,
                        status: 'running',
                        sequence: (m.toolUses?.length ?? 0) + 1,
                        startedAtMs: now,
                        updatedAtMs: now,
                      },
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
          const now = Date.now()
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
                            updatedAtMs: now,
                            ...(toolStatus === 'completed' || toolStatus === 'success'
                              ? {
                                  completedAtMs: now,
                                  durationMs: tu.startedAtMs
                                    ? Math.max(0, now - tu.startedAtMs)
                                    : undefined,
                                }
                              : {}),
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

        case 'config_options_update':
        case 'config_option_update': {
          const raw = msg.configOptions
          if (!Array.isArray(raw)) return
          const parsed = z.array(z.unknown()).safeParse(raw)
          if (!parsed.success) return
          onAcpConfigOptionsUpdate?.(raw as AcpConfigOption[])
          break
        }

        case 'commands_update': {
          const raw = msg.commands
          if (!Array.isArray(raw)) return
          const parsed = z
            .array(
              z.object({
                name: z.string(),
                description: z.string().optional(),
              }),
            )
            .safeParse(raw)
          if (!parsed.success) return
          onCommandsUpdate?.(parsed.data)
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
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current)
        flushTimerRef.current = null
      }
      unsubscribe()
    }
  }, [
    subscribe,
    onMessagesChange,
    onSessionIdChange,
    onSessionFallback,
    onAcpConfigOptionsUpdate,
    onCommandsUpdate,
    onTurnComplete,
    onEditorUpdate,
    onShowEditor,
    flushBufferedStream,
    scheduleFlushBufferedStream,
    agent,
    model,
    sessionMode,
  ])

  const submitPrompt = useCallback(
    (prompt: string) => {
      if (!connected || isStreaming) {
        return
      }

      const userId = createClientMessageId('user')
      const assistantId = createClientMessageId('assistant')
      streamingIdRef.current = assistantId
      turnStartAtRef.current = Date.now()
      firstDeltaAtRef.current = null
      streamedCharsRef.current = 0

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

      const handoffPrefix = handoffContext
        ? `<system-handoff>\n${handoffContext}\n</system-handoff>\n\n`
        : ''
      const wirePrompt = `${handoffPrefix}${prompt}`

      send({
        type: 'execute',
        mode: 'pulse_chat',
        input: wirePrompt,
        flags: {
          ...(activeSessionId ? { session_id: activeSessionId } : {}),
          agent,
          ...(model && model !== 'default' ? { model } : {}),
          ...(sessionMode ? { session_mode: sessionMode } : {}),
          ...(enabledMcpServers.length > 0 ? { mcp_servers: enabledMcpServers } : {}),
          ...(blockedMcpTools.length > 0 ? { blocked_mcp_tools: blockedMcpTools } : {}),
          ...(assistantMode ? { assistant_mode: true } : {}),
        },
      })
      if (handoffContext) onHandoffConsumed?.()
    },
    [
      connected,
      isStreaming,
      activeSessionId,
      agent,
      model,
      sessionMode,
      enabledMcpServers,
      blockedMcpTools,
      assistantMode,
      handoffContext,
      onHandoffConsumed,
      send,
      onMessagesChange,
    ],
  )

  return { submitPrompt, isStreaming, connected }
}
