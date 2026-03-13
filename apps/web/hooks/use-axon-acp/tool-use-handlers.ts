import type { AxonMessage } from '../use-axon-session'

export interface ToolUseEvent {
  tool_call_id: string
  tool_name: string
  tool_input: Record<string, unknown>
}

export interface ToolUseUpdateEvent {
  tool_call_id: string
  tool_status: string
  tool_content: string
}

/**
 * Apply a `tool_use` event to the message list, appending a new tool-use entry
 * to the streaming message identified by `sid`.
 */
export function applyToolUse(
  sid: string,
  msg: ToolUseEvent,
  onMessagesChange: (updater: (prev: AxonMessage[]) => AxonMessage[]) => void,
): void {
  const toolCallId = msg.tool_call_id
  const toolName = msg.tool_name
  const toolInput = msg.tool_input
  const now = Date.now()
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
}

/**
 * Apply a `tool_use_update` event to the message list, patching the matching
 * tool-use entry with the latest status, content, and timing.
 */
export function applyToolUseUpdate(
  sid: string,
  msg: ToolUseUpdateEvent,
  onMessagesChange: (updater: (prev: AxonMessage[]) => AxonMessage[]) => void,
): void {
  const toolCallId = msg.tool_call_id
  const toolStatus = msg.tool_status
  const toolContent = msg.tool_content
  const now = Date.now()
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
}
