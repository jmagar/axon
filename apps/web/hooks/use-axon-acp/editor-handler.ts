import { z } from 'zod'

// Zod schema for the editor_update wire message.  Any change to this shape
// requires updating both this schema and the Rust EditorOperation enum in
// crates/services/events.rs — they are the single canonical definition.
export const EditorUpdateSchema = z.object({
  type: z.literal('editor_update'),
  content: z.string(),
  operation: z.enum(['replace', 'append']).default('replace'),
})

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
