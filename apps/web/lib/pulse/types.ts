import { z } from 'zod'

const ReplaceDocumentSchema = z.object({
  type: z.literal('replace_document'),
  markdown: z.string().min(1).max(100_000),
})

const AppendMarkdownSchema = z.object({
  type: z.literal('append_markdown'),
  markdown: z.string().min(1).max(100_000),
})

const InsertSectionSchema = z.object({
  type: z.literal('insert_section'),
  heading: z.string().min(1),
  markdown: z.string().max(100_000),
  position: z.enum(['top', 'bottom']),
})

export const DocOperationSchema = z.discriminatedUnion('type', [
  ReplaceDocumentSchema,
  AppendMarkdownSchema,
  InsertSectionSchema,
])

export type DocOperation = z.infer<typeof DocOperationSchema>

export const PulsePermissionLevel = z.enum(['plan', 'accept-edits', 'bypass-permissions'])
export type PulsePermissionLevel = z.infer<typeof PulsePermissionLevel>

export const AcpConfigSelectValue = z.object({
  value: z.string(),
  name: z.string(),
  description: z.string().optional(),
})
export type AcpConfigSelectValue = z.infer<typeof AcpConfigSelectValue>

export const AcpConfigOption = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  category: z.string().optional(),
  currentValue: z.string(),
  options: z.array(AcpConfigSelectValue),
})
export type AcpConfigOption = z.infer<typeof AcpConfigOption>

export const PulseModel = z.string().optional()
export type PulseModel = z.infer<typeof PulseModel>
export const PulseAgent = z.enum(['claude', 'codex', 'gemini'])
export type PulseAgent = z.infer<typeof PulseAgent>

export const PulseChatRequestSchema = z.object({
  prompt: z.string().min(1).max(8000),
  sessionId: z
    .string()
    .regex(/^[0-9a-f-]{8,64}$/i)
    .optional(),
  documentMarkdown: z.string().max(100_000).default(''),
  selectedCollections: z.array(z.string().min(1).max(100)).max(10).default(['cortex']),
  threadSources: z.array(z.string().url()).max(25).default([]),
  /** Markdown from the most recent scrape — injected directly into the system prompt. */
  scrapedContext: z.object({ url: z.string(), markdown: z.string().max(40_000) }).optional(),
  conversationHistory: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(8_000),
      }),
    )
    .max(50)
    .default([]),
  permissionLevel: PulsePermissionLevel.default('accept-edits'),
  agent: PulseAgent.default('claude'),
  model: PulseModel,
  /** Stream replay: resume from this event ID. */
  lastEventId: z.string().max(128).optional(),
  /** @deprecated Use `lastEventId` instead. Kept for backward compatibility with existing callers. */
  last_event_id: z.string().max(128).optional(),
})

export type PulseChatRequest = z.infer<typeof PulseChatRequestSchema>

/** ACP permission request received from the Rust backend during tool execution. */
export interface AcpPermissionRequest {
  sessionId: string
  toolCallId: string
  /** Available permission option IDs (e.g. 'option-allow-once', 'option-reject-always'). */
  options: string[]
  /** Tool name resolved from the most recent tool_use event, if available. */
  toolName?: string
}

export interface PulseCitation {
  url: string
  title: string
  snippet: string
  collection: string
  score: number
}

export interface PulseToolUse {
  name: string
  input: Record<string, unknown>
  toolCallId?: string
  sequence?: number
  status?: string
  content?: string
  locations?: string[]
  startedAtMs?: number
  updatedAtMs?: number
  completedAtMs?: number
  durationMs?: number
}

export type PulseMessageBlock =
  | { type: 'text'; content: string }
  | {
      type: 'tool_use'
      name: string
      input: Record<string, unknown>
      result?: string
      toolCallId?: string
      sequence?: number
      status?: string
      content?: string
      locations?: string[]
      startedAtMs?: number
      updatedAtMs?: number
      completedAtMs?: number
      durationMs?: number
    }
  | { type: 'thinking'; content: string }

export interface PulseChatResponse {
  text: string
  sessionId?: string
  citations: PulseCitation[]
  operations: DocOperation[]
  toolUses: PulseToolUse[]
  blocks: PulseMessageBlock[]
  metadata?: {
    model: PulseModel
    agent?: PulseAgent
    elapsedMs: number
    contextCharsTotal: number
    contextBudgetChars: number
    first_delta_ms?: number | null
    time_to_done_ms?: number
    delta_count?: number
    aborted?: boolean
    fallback_source?: 'conversation_memory'
  }
}

export const PulseSourceRequestSchema = z.object({
  urls: z.array(z.string().url()).min(1).max(10),
})

export type PulseSourceRequest = z.infer<typeof PulseSourceRequestSchema>

export interface PulseSourceResponse {
  indexed: string[]
  command: string
  /** @deprecated Raw subprocess output is no longer returned to avoid leaking internals. */
  output?: string
  /** Scraped markdown keyed by URL — available when a single URL is indexed. */
  markdownBySrc?: Record<string, string>
}

export interface PulseDocument {
  id: string
  title: string
  markdown: string
  createdAt: string
  updatedAt: string
  selectedCollections: string[]
  tags: string[]
}

export type RightPanelId = 'editor' | 'terminal' | 'logs' | 'mcp' | 'settings' | 'cortex'
