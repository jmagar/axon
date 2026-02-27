import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NextResponse } from 'next/server'
import {
  createPulseChatStreamEvent,
  encodePulseChatStreamEvent,
  type PulseChatStreamEvent,
} from '@/lib/pulse/chat-stream'
import { fallbackAssistantText, parseClaudeAssistantPayload } from '@/lib/pulse/claude-response'
import { resolveConversationMemoryAnswer } from '@/lib/pulse/conversation-memory'
import { checkPermission } from '@/lib/pulse/permissions'
import { buildPulseSystemPrompt, retrieveFromCollections } from '@/lib/pulse/rag'
import { ensureRepoRootEnvLoaded } from '@/lib/pulse/server-env'
import {
  DocOperationSchema,
  PulseChatRequestSchema,
  type PulseChatResponse,
  type PulseMessageBlock,
  type PulseModel,
  type PulseToolUse,
} from '@/lib/pulse/types'

const CLAUDE_TIMEOUT_MS = 300_000 // 5 min — agentic research tasks need room to breathe

// The `claude` CLI always injects ~/.claude/CLAUDE.md (global instructions) into every subprocess
// regardless of cwd. Cache the size once at module load so we can include it in context accounting.
let _globalClaudeMdChars = 0
try {
  _globalClaudeMdChars = fs.statSync(path.join(os.homedir(), '.claude', 'CLAUDE.md')).size
} catch {
  // File absent or unreadable — treat as 0.
}
const GLOBAL_CLAUDE_MD_CHARS = _globalClaudeMdChars
const CLAUDE_MODEL_ARG: Record<PulseModel, string> = {
  sonnet: 'sonnet',
  opus: 'opus',
  haiku: 'haiku',
}
// Context budget in chars: 200k token window × ~4 chars/token = 800k chars.
// We measure everything we actually send to the claude subprocess in chars (system prompt,
// CLAUDE.md, user content) and express it as a fraction of this budget.
const MODEL_CONTEXT_BUDGET_CHARS = 800_000
const HEARTBEAT_INTERVAL_MS = 5_000
const REPLAY_BUFFER_LIMIT = 512
const REPLAY_CACHE_TTL_MS = 2 * 60_000

type ReplayCacheEntry = {
  events: PulseChatStreamEvent[]
  updatedAt: number
}

const replayCache = new Map<string, ReplayCacheEntry>()

function pruneReplayCache(now: number): void {
  for (const [key, entry] of replayCache.entries()) {
    if (now - entry.updatedAt > REPLAY_CACHE_TTL_MS) {
      replayCache.delete(key)
    }
  }
}

// Stream-json event shapes (NDJSON, one event per line)
interface ClaudeStreamAssistantContent {
  type: 'text' | 'tool_use' | 'thinking'
  text?: string
  thinking?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
}
interface ClaudeStreamEvent {
  type: 'system' | 'assistant' | 'tool_result' | 'result'
  message?: { content?: ClaudeStreamAssistantContent[] }
  result?: string
  session_id?: string
  subtype?: string
  is_error?: boolean
  // tool_result fields
  tool_use_id?: string
  content?: unknown
  // usage reported in the result event
  usage?: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
}

export async function POST(request: Request) {
  ensureRepoRootEnvLoaded()
  const startedAt = Date.now()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 })
  }

  try {
    const parsed = PulseChatRequestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid request payload' },
        { status: 400 },
      )
    }

    const req = parsed.data
    const bodyObject =
      typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
    const lastEventId =
      typeof bodyObject.last_event_id === 'string'
        ? bodyObject.last_event_id
        : typeof bodyObject.lastEventId === 'string'
          ? bodyObject.lastEventId
          : undefined
    const replayKey = createHash('sha256')
      .update(
        JSON.stringify({
          prompt: req.prompt,
          documentMarkdown: req.documentMarkdown,
          selectedCollections: req.selectedCollections,
          threadSources: req.threadSources,
          scrapedContext: req.scrapedContext,
          conversationHistory: req.conversationHistory,
          permissionLevel: req.permissionLevel,
          model: req.model,
        }),
      )
      .digest('hex')

    pruneReplayCache(Date.now())

    const citations = await retrieveFromCollections(req.prompt, req.selectedCollections, 4)
    const systemPrompt = buildPulseSystemPrompt(req, citations)
    const prompt = [
      req.prompt,
      '',
      'Respond as JSON only with this exact shape:',
      '{"text":"...","operations":[...]}',
      'Allowed operation types and their required fields:',
      '  replace_document: {"type":"replace_document","markdown":"<full doc content>"}',
      '  append_markdown:  {"type":"append_markdown","markdown":"<content to append>"}',
      '  insert_section:   {"type":"insert_section","heading":"<title>","markdown":"<content>","position":"top"|"bottom"}',
      'IMPORTANT: use "markdown" (not "content") for the document text field.',
      'If no operations are needed, return operations as an empty array.',
    ].join('\n')

    const systemPromptChars = systemPrompt.length

    const computeContextCharsTotal = (): number => {
      const citationChars = citations.reduce(
        (total, citation) => total + citation.snippet.length,
        0,
      )
      const threadSourceChars = req.threadSources.reduce(
        (total, source) => total + source.length,
        0,
      )
      const conversationChars = req.conversationHistory.reduce(
        (total, entry) => total + entry.content.length,
        0,
      )
      return (
        GLOBAL_CLAUDE_MD_CHARS +
        systemPromptChars +
        req.prompt.length +
        req.documentMarkdown.length +
        conversationChars +
        citationChars +
        threadSourceChars
      )
    }

    const args = [
      '-p',
      prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      '--system-prompt',
      systemPrompt,
      // Disable all MCP servers — the subprocess runs in a container where
      // none of the globally-configured MCPs are reachable. Without this flag
      // the CLI hangs trying to connect to all servers before answering.
      '--strict-mcp-config',
    ]
    const modelArg = CLAUDE_MODEL_ARG[req.model]
    if (modelArg) {
      args.push('--model', modelArg)
    }
    // Do NOT --resume a Claude Code session. Resuming a session started in a
    // project directory would load that project's CLAUDE.md into Pulse's
    // context (e.g. "you are a Rust coding assistant"). The system prompt
    // built above is the complete context; each request must be fresh.

    const encoder = new TextEncoder()
    const cachedReplay = replayCache.get(replayKey)

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const replayBuffer = cachedReplay?.events ? [...cachedReplay.events] : []
        let lastEmitAt = Date.now()
        let firstDeltaMs: number | null = null
        let deltaCount = 0
        let aborted = request.signal.aborted

        const enqueueEvent = (event: PulseChatStreamEvent) => {
          lastEmitAt = Date.now()
          controller.enqueue(encoder.encode(encodePulseChatStreamEvent(event)))
        }

        const persistReplay = () => {
          replayCache.set(replayKey, { events: replayBuffer, updatedAt: Date.now() })
        }

        const emit = (event: Parameters<typeof createPulseChatStreamEvent>[0]) => {
          const normalized = createPulseChatStreamEvent(event)
          replayBuffer.push(normalized)
          if (replayBuffer.length > REPLAY_BUFFER_LIMIT) {
            replayBuffer.shift()
          }
          persistReplay()
          enqueueEvent(normalized)
        }

        const emitErrorAndClose = (error: string, code?: string) => {
          emit({ type: 'error', error, code })
          controller.close()
        }

        const contextCharsTotal = computeContextCharsTotal()
        const buildTelemetry = () => {
          const elapsed = Date.now() - startedAt
          return {
            elapsedMs: elapsed,
            contextCharsTotal,
            contextBudgetChars: MODEL_CONTEXT_BUDGET_CHARS,
            first_delta_ms: firstDeltaMs,
            time_to_done_ms: elapsed,
            delta_count: deltaCount,
            aborted,
          }
        }

        const replayFromLastEventId = (): boolean => {
          if (!lastEventId || replayBuffer.length === 0) return false
          const idx = replayBuffer.findIndex((event) => event.event_id === lastEventId)
          if (idx < 0) return false
          const tail = replayBuffer.slice(idx + 1)
          for (const event of tail) {
            enqueueEvent(event)
          }
          return tail.some((event) => event.type === 'done' || event.type === 'error')
        }

        if (replayFromLastEventId()) {
          controller.close()
          return
        }

        emit({ type: 'status', phase: 'started' })

        // Strip CLAUDECODE so the spawned claude CLI doesn't refuse to launch
        // inside an existing Claude Code session.
        const { CLAUDECODE: _cc, ...childEnv } = process.env
        // Use a neutral cwd (not the repo root) so Claude Code doesn't load the
        // axon_rust CLAUDE.md and override the Pulse persona with "I'm a Rust
        // coding assistant."
        const child = spawn('claude', args, {
          cwd: os.tmpdir(),
          env: childEnv,
          stdio: ['ignore', 'pipe', 'pipe'],
        })

        let stderr = ''
        let stdoutRemainder = ''
        const toolUses: PulseToolUse[] = []
        const blocks: PulseMessageBlock[] = []
        const toolUseIdToIdx = new Map<string, number>()
        let result = ''
        let closed = false

        const abortHandler = () => {
          aborted = true
          if (!closed) {
            child.kill('SIGTERM')
          }
        }

        request.signal.addEventListener('abort', abortHandler, { once: true })

        const cleanup = () => {
          clearTimeout(timer)
          clearInterval(heartbeatInterval)
          request.signal.removeEventListener('abort', abortHandler)
          persistReplay()
        }

        const timer = setTimeout(() => {
          child.kill('SIGTERM')
        }, CLAUDE_TIMEOUT_MS)

        const heartbeatInterval = setInterval(() => {
          if (closed) return
          if (Date.now() - lastEmitAt < HEARTBEAT_INTERVAL_MS) return
          emit({ type: 'heartbeat', elapsed_ms: Date.now() - startedAt })
        }, HEARTBEAT_INTERVAL_MS)

        child.stdout.on('data', (chunk: Buffer) => {
          const chunkText = chunk.toString()
          const combined = stdoutRemainder + chunkText
          const lines = combined.split('\n')
          stdoutRemainder = lines.pop() ?? ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue
            let event: ClaudeStreamEvent
            try {
              event = JSON.parse(trimmed) as ClaudeStreamEvent
            } catch {
              continue
            }

            if (event.type === 'assistant' && event.message?.content) {
              emit({ type: 'status', phase: 'thinking' })
              for (const block of event.message.content) {
                if (block.type === 'text' && block.text) {
                  blocks.push({ type: 'text', content: block.text })
                  deltaCount += 1
                  if (firstDeltaMs === null) {
                    firstDeltaMs = Date.now() - startedAt
                  }
                  emit({ type: 'assistant_delta', delta: block.text })
                }
                if (block.type === 'tool_use' && block.name) {
                  const tool: PulseToolUse = {
                    name: block.name,
                    input: block.input ?? {},
                  }
                  const idx = blocks.length
                  blocks.push({
                    type: 'tool_use',
                    name: block.name,
                    input: block.input ?? {},
                  })
                  if (block.id) toolUseIdToIdx.set(block.id, idx)
                  toolUses.push(tool)
                  emit({ type: 'tool_use', tool })
                }
                if (block.type === 'thinking' && block.thinking) {
                  blocks.push({ type: 'thinking', content: block.thinking })
                  emit({ type: 'thinking_content', content: block.thinking })
                }
              }
            }

            if (event.type === 'tool_result') {
              const id = event.tool_use_id
              const raw = event.content
              let resultText = ''
              if (typeof raw === 'string') {
                resultText = raw
              } else if (Array.isArray(raw)) {
                resultText = (raw as Array<unknown>)
                  .map((entry) => {
                    if (typeof entry !== 'object' || entry === null) return ''
                    const obj = entry as Record<string, unknown>
                    if (typeof obj.text === 'string') return obj.text
                    if (Array.isArray(obj.content)) {
                      return (obj.content as Array<unknown>)
                        .map((inner) => {
                          if (typeof inner !== 'object' || inner === null) return ''
                          const i = inner as Record<string, unknown>
                          return typeof i.text === 'string' ? i.text : ''
                        })
                        .filter(Boolean)
                        .join('\n')
                    }
                    return ''
                  })
                  .filter(Boolean)
                  .join('\n')
              }
              if (id && resultText) {
                const idx = toolUseIdToIdx.get(id)
                if (idx !== undefined) {
                  const b = blocks[idx]
                  if (b?.type === 'tool_use') {
                    ;(
                      b as {
                        type: 'tool_use'
                        name: string
                        input: Record<string, unknown>
                        result?: string
                      }
                    ).result = resultText.slice(0, 600)
                  }
                }
              }
            }

            if (event.type === 'result') {
              result = event.result ?? ''
            }
          }
        })

        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString()
        })

        child.on('error', (error: Error) => {
          if (closed) return
          closed = true
          cleanup()
          emitErrorAndClose(`Failed to start Claude CLI: ${error.message}`, 'pulse_chat_spawn')
        })

        child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
          if (closed) return
          closed = true
          cleanup()

          if (signal && !aborted) {
            emitErrorAndClose(
              `Claude CLI terminated by signal ${signal}`,
              'pulse_chat_terminated_signal',
            )
            return
          }

          if (aborted) {
            emit({
              type: 'done',
              response: {
                text: fallbackAssistantText(result),
                sessionId: undefined,
                citations,
                operations: [],
                toolUses,
                blocks,
                metadata: {
                  model: req.model,
                  ...buildTelemetry(),
                },
              },
            })
            controller.close()
            return
          }

          if (code !== 0) {
            const memoryFallbackText = resolveConversationMemoryAnswer(
              req.prompt,
              req.conversationHistory,
            )
            if (memoryFallbackText) {
              emit({
                type: 'done',
                response: {
                  text: memoryFallbackText,
                  sessionId: undefined,
                  citations,
                  operations: [],
                  toolUses: [],
                  blocks: [],
                  metadata: {
                    model: req.model,
                    ...buildTelemetry(),
                  },
                },
              })
              controller.close()
              return
            }
            emitErrorAndClose(
              `Claude CLI exited ${code}: ${truncateForLog(stderr || stdoutRemainder)}`,
              'pulse_chat_exit_nonzero',
            )
            return
          }

          emit({ type: 'status', phase: 'finalizing' })

          let text = ''
          let operations: PulseChatResponse['operations'] = []
          const parsedPayload = parseClaudeAssistantPayload(result)
          if (parsedPayload) {
            text = parsedPayload.text
            if (parsedPayload.operations.length > 0) {
              const parsedOps: PulseChatResponse['operations'] = []
              for (const op of parsedPayload.operations) {
                const parsedOp = DocOperationSchema.safeParse(op)
                if (parsedOp.success) {
                  parsedOps.push(parsedOp.data)
                }
              }
              operations = parsedOps
            }
          } else {
            text = fallbackAssistantText(result)
          }

          const permission = checkPermission(req.permissionLevel, operations, {
            isCurrentDoc: true,
            currentDocMarkdown: req.documentMarkdown,
          })

          if (!permission.allowed) {
            operations = []
            text = text || 'Operation blocked by permission policy.'
          }

          emit({
            type: 'done',
            response: {
              text,
              sessionId: undefined, // session resumption disabled — see --resume comment above
              citations,
              operations,
              toolUses,
              blocks,
              metadata: {
                model: req.model,
                ...buildTelemetry(),
              },
            },
          })
          controller.close()
        })
      },
    })

    return new Response(stream, {
      headers: {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      },
    })
  } catch (error: unknown) {
    const errorId = globalThis.crypto?.randomUUID?.() ?? `pulse-chat-${Date.now()}`
    const message = error instanceof Error ? error.message : String(error)
    console.error('[pulse/chat] unhandled error', { errorId, message, error })
    return NextResponse.json(
      { error: 'Chat request failed', code: 'pulse_chat_internal', errorId },
      { status: 500 },
    )
  }
}

function truncateForLog(input: string, max = 400): string {
  if (input.length <= max) return input
  return `${input.slice(0, max)}...`
}
