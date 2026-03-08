/**
 * Tests for lib/pulse/chat-api.ts
 *
 * chat-api.ts exports two async functions:
 *   - runChatPrompt(opts): sends POST /api/pulse/chat, handles NDJSON streaming and JSON responses
 *   - runSourcePrompt(urls, signal): sends POST /api/pulse/source
 *
 * Both delegate to apiFetch (which injects x-api-key when NEXT_PUBLIC_AXON_API_TOKEN is set).
 * We stub globalThis.fetch to control all responses.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunChatPromptOptions } from '@/lib/pulse/chat-api'
import { runChatPrompt, runSourcePrompt } from '@/lib/pulse/chat-api'
import { encodePulseChatStreamEvent } from '@/lib/pulse/chat-stream'
import type { PulseChatResponse, PulseSourceResponse } from '@/lib/pulse/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDoneResponse(text = 'Done'): PulseChatResponse {
  return {
    text,
    sessionId: 'sess-abc',
    citations: [],
    operations: [],
    toolUses: [],
    blocks: [],
  }
}

/** Build a minimal ReadableStream that emits NDJSON events then closes. */
function makeNdjsonStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line))
      }
      controller.close()
    },
  })
}

/** Construct a Response whose body is an NDJSON stream. */
function makeStreamingResponse(lines: string[], status = 200): Response {
  return new Response(makeNdjsonStream(lines), {
    status,
    headers: { 'Content-Type': 'application/x-ndjson' },
  })
}

/** Construct a Response whose body is plain JSON. */
function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Base options for runChatPrompt — caller may override individual fields. */
function makeOpts(overrides: Partial<RunChatPromptOptions> = {}): RunChatPromptOptions {
  return {
    prompt: 'Hello',
    conversationHistory: [],
    signal: new AbortController().signal,
    chatSessionId: null,
    documentMarkdown: '',
    activeThreadSources: [],
    scrapedContext: null,
    permissionLevel: 'accept-edits',
    agent: 'claude',
    model: 'sonnet',
    ...overrides,
  }
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  // Ensure NEXT_PUBLIC_AXON_API_TOKEN is absent so apiFetch falls through to fetch() directly
  // (apiFetch reads it at module load time from process.env; tests run without it set)
})

afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
})

// ── runChatPrompt — request construction ─────────────────────────────────────

describe('runChatPrompt — request construction', () => {
  it('calls POST /api/pulse/chat', async () => {
    const done = makeDoneResponse()
    fetchMock.mockResolvedValueOnce(makeJsonResponse(done))

    await runChatPrompt(makeOpts())

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/pulse/chat')
    expect(init.method).toBe('POST')
  })

  it('sets Content-Type: application/json header', async () => {
    fetchMock.mockResolvedValueOnce(makeJsonResponse(makeDoneResponse()))

    await runChatPrompt(makeOpts())

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = new Headers(init.headers as HeadersInit)
    expect(headers.get('content-type')).toBe('application/json')
  })

  it('includes prompt and core fields in request body', async () => {
    fetchMock.mockResolvedValueOnce(makeJsonResponse(makeDoneResponse()))

    await runChatPrompt(makeOpts({ prompt: 'What is Qdrant?' }))

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.prompt).toBe('What is Qdrant?')
    expect(body.selectedCollections).toEqual(['cortex'])
    expect(body.conversationHistory).toEqual([])
  })

  it('includes conversationHistory in request body', async () => {
    const history = [
      { role: 'user' as const, content: 'hi' },
      { role: 'assistant' as const, content: 'hello' },
    ]
    fetchMock.mockResolvedValueOnce(makeJsonResponse(makeDoneResponse()))

    await runChatPrompt(makeOpts({ conversationHistory: history }))

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.conversationHistory).toEqual(history)
  })

  it('sends chatSessionId as sessionId in body (non-null case)', async () => {
    fetchMock.mockResolvedValueOnce(makeJsonResponse(makeDoneResponse()))

    await runChatPrompt(makeOpts({ chatSessionId: 'ses-123' }))

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.sessionId).toBe('ses-123')
  })

  it('omits sessionId from body when chatSessionId is null', async () => {
    fetchMock.mockResolvedValueOnce(makeJsonResponse(makeDoneResponse()))

    await runChatPrompt(makeOpts({ chatSessionId: null }))

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    // null → undefined → JSON.stringify omits the key
    expect(body.sessionId).toBeUndefined()
  })

  it('includes optional fields when provided', async () => {
    fetchMock.mockResolvedValueOnce(makeJsonResponse(makeDoneResponse()))

    await runChatPrompt(
      makeOpts({
        effort: 'high',
        maxTurns: 5,
        maxBudgetUsd: 1.5,
        appendSystemPrompt: 'Be terse.',
        disableSlashCommands: true,
        noSessionPersistence: true,
        fallbackModel: 'haiku',
        allowedTools: 'Bash,Read',
        disallowedTools: 'Write',
        addDir: '/tmp/docs',
        betas: 'interleaved-thinking',
        toolsRestrict: 'Bash,Read',
      }),
    )

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.effort).toBe('high')
    expect(body.maxTurns).toBe(5)
    expect(body.maxBudgetUsd).toBe(1.5)
    expect(body.appendSystemPrompt).toBe('Be terse.')
    expect(body.disableSlashCommands).toBe(true)
    expect(body.noSessionPersistence).toBe(true)
    expect(body.fallbackModel).toBe('haiku')
    expect(body.allowedTools).toBe('Bash,Read')
    expect(body.disallowedTools).toBe('Write')
    expect(body.addDir).toBe('/tmp/docs')
    expect(body.betas).toBe('interleaved-thinking')
    expect(body.toolsRestrict).toBe('Bash,Read')
  })

  it('includes scrapedContext when provided', async () => {
    fetchMock.mockResolvedValueOnce(makeJsonResponse(makeDoneResponse()))

    const scrapedContext = { url: 'https://example.com', markdown: '# Example' }
    await runChatPrompt(makeOpts({ scrapedContext }))

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.scrapedContext).toEqual(scrapedContext)
  })

  it('omits scrapedContext from body when null', async () => {
    fetchMock.mockResolvedValueOnce(makeJsonResponse(makeDoneResponse()))

    await runChatPrompt(makeOpts({ scrapedContext: null }))

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.scrapedContext).toBeUndefined()
  })

  it('includes activeThreadSources as threadSources in body', async () => {
    fetchMock.mockResolvedValueOnce(makeJsonResponse(makeDoneResponse()))

    const activeThreadSources = ['https://a.com', 'https://b.com']
    await runChatPrompt(makeOpts({ activeThreadSources }))

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.threadSources).toEqual(activeThreadSources)
  })

  it('forwards the AbortSignal to fetch', async () => {
    fetchMock.mockResolvedValueOnce(makeJsonResponse(makeDoneResponse()))

    const controller = new AbortController()
    await runChatPrompt(makeOpts({ signal: controller.signal }))

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.signal).toBe(controller.signal)
  })
})

// ── runChatPrompt — JSON response path ────────────────────────────────────────

describe('runChatPrompt — JSON response path', () => {
  it('returns the parsed JSON response when content-type is not ndjson', async () => {
    const done = makeDoneResponse('The answer is 42')
    fetchMock.mockResolvedValueOnce(makeJsonResponse(done))

    const result = await runChatPrompt(makeOpts())

    expect(result.text).toBe('The answer is 42')
    expect(result.citations).toEqual([])
  })

  it('returns response with all fields intact', async () => {
    const done: PulseChatResponse = {
      text: 'Hello world',
      sessionId: 'sess-xyz',
      citations: [
        { url: 'https://a.com', title: 'A', snippet: 's', collection: 'cortex', score: 0.9 },
      ],
      operations: [],
      toolUses: [],
      blocks: [{ type: 'text', content: 'Hello world' }],
    }
    fetchMock.mockResolvedValueOnce(makeJsonResponse(done))

    const result = await runChatPrompt(makeOpts())
    expect(result.sessionId).toBe('sess-xyz')
    expect(result.citations).toHaveLength(1)
    expect(result.blocks).toHaveLength(1)
  })
})

// ── runChatPrompt — NDJSON streaming path ─────────────────────────────────────

describe('runChatPrompt — NDJSON streaming', () => {
  it('reads NDJSON stream and returns the done response', async () => {
    const done = makeDoneResponse('streamed answer')
    const doneEvent = encodePulseChatStreamEvent({ type: 'done', response: done })

    fetchMock.mockResolvedValueOnce(makeStreamingResponse([doneEvent]))

    const result = await runChatPrompt(makeOpts())
    expect(result.text).toBe('streamed answer')
  })

  it('calls onEvent for status events', async () => {
    const done = makeDoneResponse()
    const statusEvent = encodePulseChatStreamEvent({ type: 'status', phase: 'thinking' })
    const doneEvent = encodePulseChatStreamEvent({ type: 'done', response: done })

    fetchMock.mockResolvedValueOnce(makeStreamingResponse([statusEvent, doneEvent]))

    const events: Array<{ type: string }> = []
    await runChatPrompt(makeOpts({ onEvent: (e) => events.push(e) }))

    const status = events.find((e) => e.type === 'status')
    expect(status).toBeDefined()
    expect((status as { phase?: string }).phase).toBe('thinking')
  })

  it('calls onEvent for assistant_delta events', async () => {
    const done = makeDoneResponse()
    const deltaEvent = encodePulseChatStreamEvent({ type: 'assistant_delta', delta: 'Hello, ' })
    const deltaEvent2 = encodePulseChatStreamEvent({ type: 'assistant_delta', delta: 'world!' })
    const doneEvent = encodePulseChatStreamEvent({ type: 'done', response: done })

    fetchMock.mockResolvedValueOnce(makeStreamingResponse([deltaEvent, deltaEvent2, doneEvent]))

    const deltas: string[] = []
    await runChatPrompt(
      makeOpts({
        onEvent: (e) => {
          if (e.type === 'assistant_delta' && e.delta) deltas.push(e.delta)
        },
      }),
    )

    expect(deltas).toEqual(['Hello, ', 'world!'])
  })

  it('calls onEvent for thinking_content events', async () => {
    const done = makeDoneResponse()
    const thinkingEvent = encodePulseChatStreamEvent({
      type: 'thinking_content',
      content: 'Let me think...',
    })
    const doneEvent = encodePulseChatStreamEvent({ type: 'done', response: done })

    fetchMock.mockResolvedValueOnce(makeStreamingResponse([thinkingEvent, doneEvent]))

    const events: Array<{ type: string; content?: string }> = []
    await runChatPrompt(makeOpts({ onEvent: (e) => events.push(e) }))

    const thinking = events.find((e) => e.type === 'thinking_content')
    expect(thinking?.content).toBe('Let me think...')
  })

  it('calls onEvent for tool_use events', async () => {
    const done = makeDoneResponse()
    const tool = { name: 'Bash', input: { command: 'ls' }, toolCallId: 'tc-1' }
    const toolEvent = encodePulseChatStreamEvent({ type: 'tool_use', tool })
    const doneEvent = encodePulseChatStreamEvent({ type: 'done', response: done })

    fetchMock.mockResolvedValueOnce(makeStreamingResponse([toolEvent, doneEvent]))

    const events: Array<{ type: string }> = []
    await runChatPrompt(makeOpts({ onEvent: (e) => events.push(e) }))

    const tu = events.find((e) => e.type === 'tool_use') as { type: string; tool?: typeof tool }
    expect(tu?.tool?.name).toBe('Bash')
  })

  it('calls onEvent for tool_use_update events', async () => {
    const done = makeDoneResponse()
    const updateEvent = encodePulseChatStreamEvent({
      type: 'tool_use_update',
      toolCallId: 'tc-1',
      status: 'completed',
      content: 'output',
      toolName: 'Bash',
    })
    const doneEvent = encodePulseChatStreamEvent({ type: 'done', response: done })

    fetchMock.mockResolvedValueOnce(makeStreamingResponse([updateEvent, doneEvent]))

    const events: Array<{ type: string; toolCallId?: string }> = []
    await runChatPrompt(makeOpts({ onEvent: (e) => events.push(e) }))

    const update = events.find((e) => e.type === 'tool_use_update')
    expect((update as { toolCallId?: string })?.toolCallId).toBe('tc-1')
  })

  it('calls onEvent for config_options_update events', async () => {
    const done = makeDoneResponse()
    const configOption = {
      id: 'cfg-1',
      name: 'Model',
      currentValue: 'sonnet',
      options: [{ value: 'sonnet', name: 'Sonnet' }],
    }
    const configEvent = encodePulseChatStreamEvent({
      type: 'config_options_update',
      configOptions: [configOption],
    })
    const doneEvent = encodePulseChatStreamEvent({ type: 'done', response: done })

    fetchMock.mockResolvedValueOnce(makeStreamingResponse([configEvent, doneEvent]))

    const events: Array<{ type: string }> = []
    await runChatPrompt(makeOpts({ onEvent: (e) => events.push(e) }))

    const configUpdate = events.find((e) => e.type === 'config_options_update')
    expect(configUpdate).toBeDefined()
    expect(
      (configUpdate as { configOptions?: (typeof configOption)[] })?.configOptions,
    ).toHaveLength(1)
  })

  it('calls onEvent for permission_request events', async () => {
    const done = makeDoneResponse()
    const permEvent = encodePulseChatStreamEvent({
      type: 'permission_request',
      sessionId: 'ses-1',
      toolCallId: 'tc-2',
      options: ['option-allow-once', 'option-reject-always'],
    })
    const doneEvent = encodePulseChatStreamEvent({ type: 'done', response: done })

    fetchMock.mockResolvedValueOnce(makeStreamingResponse([permEvent, doneEvent]))

    const events: Array<{ type: string }> = []
    await runChatPrompt(makeOpts({ onEvent: (e) => events.push(e) }))

    const perm = events.find((e) => e.type === 'permission_request') as {
      type: string
      sessionId?: string
      permissionOptions?: string[]
    }
    expect(perm?.sessionId).toBe('ses-1')
    expect(perm?.permissionOptions).toEqual(['option-allow-once', 'option-reject-always'])
  })

  it('calls onEvent for session_fallback events', async () => {
    const done = makeDoneResponse()
    const fallbackEvent = encodePulseChatStreamEvent({
      type: 'session_fallback',
      newSessionId: 'new-sess-999',
    })
    const doneEvent = encodePulseChatStreamEvent({ type: 'done', response: done })

    fetchMock.mockResolvedValueOnce(makeStreamingResponse([fallbackEvent, doneEvent]))

    const events: Array<{ type: string; newSessionId?: string }> = []
    await runChatPrompt(makeOpts({ onEvent: (e) => events.push(e) }))

    const fb = events.find((e) => e.type === 'session_fallback')
    expect((fb as { newSessionId?: string })?.newSessionId).toBe('new-sess-999')
  })

  it('throws when stream ends with an error event', async () => {
    const errorEvent = encodePulseChatStreamEvent({ type: 'error', error: 'model overloaded' })

    fetchMock.mockResolvedValueOnce(makeStreamingResponse([errorEvent]))

    await expect(runChatPrompt(makeOpts())).rejects.toThrow('model overloaded')
  })

  it('throws when stream ends without a done event', async () => {
    const deltaEvent = encodePulseChatStreamEvent({ type: 'assistant_delta', delta: 'partial' })

    fetchMock.mockResolvedValueOnce(makeStreamingResponse([deltaEvent]))

    await expect(runChatPrompt(makeOpts())).rejects.toThrow(
      'Pulse stream ended without a final response',
    )
  })

  it('deduplicates events with the same event_id', async () => {
    const done = makeDoneResponse()
    // Manually create an event with a known event_id and repeat it
    const eventId = 'dup-event-id'
    const event1 = JSON.stringify({
      type: 'assistant_delta',
      delta: 'once',
      protocol_version: 1,
      event_id: eventId,
    })
    const event2 = JSON.stringify({
      type: 'assistant_delta',
      delta: 'once',
      protocol_version: 1,
      event_id: eventId,
    })
    const doneEvent = encodePulseChatStreamEvent({ type: 'done', response: done })

    fetchMock.mockResolvedValueOnce(
      makeStreamingResponse([`${event1}\n`, `${event2}\n`, doneEvent]),
    )

    const deltas: string[] = []
    await runChatPrompt(
      makeOpts({
        onEvent: (e) => {
          if (e.type === 'assistant_delta' && e.delta) deltas.push(e.delta)
        },
      }),
    )

    // Duplicate event_id must be suppressed — only one delta emitted
    expect(deltas).toHaveLength(1)
    expect(deltas[0]).toBe('once')
  })

  it('falls back to JSON parse when body is null (throws on invalid body)', async () => {
    // When Response is created with null body, response.body is null.
    // The source guards: `if (isNdjson && response.body)` — null body skips
    // readNdjsonStream and falls through to response.json(), which throws on an
    // empty/null body since there is no valid JSON to parse.
    const response = new Response(null, {
      status: 200,
      headers: { 'Content-Type': 'application/x-ndjson' },
    })
    fetchMock.mockResolvedValueOnce(response)

    await expect(runChatPrompt(makeOpts())).rejects.toThrow()
  })
})

// ── runChatPrompt — error handling ───────────────────────────────────────────

describe('runChatPrompt — error handling', () => {
  it('throws with status code on non-OK response with empty body', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('', { status: 500, headers: { 'Content-Type': 'application/json' } }),
    )

    await expect(runChatPrompt(makeOpts())).rejects.toThrow('Pulse chat failed (500)')
  })

  it('extracts error field from JSON error body', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await expect(runChatPrompt(makeOpts())).rejects.toThrow(
      'Pulse chat failed (429): Rate limit exceeded',
    )
  })

  it('extracts message field from JSON error body when error is absent', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Service unavailable' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await expect(runChatPrompt(makeOpts())).rejects.toThrow(
      'Pulse chat failed (503): Service unavailable',
    )
  })

  it('uses raw body as detail when JSON parsing fails', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('Internal Server Error', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      }),
    )

    await expect(runChatPrompt(makeOpts())).rejects.toThrow(
      'Pulse chat failed (500): Internal Server Error',
    )
  })

  it('throws without detail suffix when error body is empty', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }))

    await expect(runChatPrompt(makeOpts())).rejects.toThrow('Pulse chat failed (401)')
  })

  it('propagates network errors thrown by fetch', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    await expect(runChatPrompt(makeOpts())).rejects.toThrow('Failed to fetch')
  })
})

// ── runSourcePrompt — request construction ────────────────────────────────────

describe('runSourcePrompt — request construction', () => {
  it('calls POST /api/pulse/source', async () => {
    const sourceResp: PulseSourceResponse = { indexed: [], command: '', output: '' }
    fetchMock.mockResolvedValueOnce(makeJsonResponse(sourceResp))

    const signal = new AbortController().signal
    await runSourcePrompt(['https://example.com'], signal)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/pulse/source')
    expect(init.method).toBe('POST')
  })

  it('sets Content-Type: application/json header', async () => {
    fetchMock.mockResolvedValueOnce(makeJsonResponse({ indexed: [], command: '', output: '' }))

    await runSourcePrompt(['https://example.com'], new AbortController().signal)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = new Headers(init.headers as HeadersInit)
    expect(headers.get('content-type')).toBe('application/json')
  })

  it('serialises urls array into request body', async () => {
    fetchMock.mockResolvedValueOnce(makeJsonResponse({ indexed: [], command: '', output: '' }))

    const urls = ['https://a.com', 'https://b.com']
    await runSourcePrompt(urls, new AbortController().signal)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.urls).toEqual(urls)
  })

  it('forwards AbortSignal to fetch', async () => {
    fetchMock.mockResolvedValueOnce(makeJsonResponse({ indexed: [], command: '', output: '' }))

    const controller = new AbortController()
    await runSourcePrompt(['https://example.com'], controller.signal)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.signal).toBe(controller.signal)
  })
})

// ── runSourcePrompt — response handling ───────────────────────────────────────

describe('runSourcePrompt — response handling', () => {
  it('returns parsed JSON response on success', async () => {
    const resp: PulseSourceResponse = {
      indexed: ['https://example.com'],
      command: 'axon scrape',
      output: 'ok',
      markdownBySrc: { 'https://example.com': '# Hello' },
    }
    fetchMock.mockResolvedValueOnce(makeJsonResponse(resp))

    const result = await runSourcePrompt(['https://example.com'], new AbortController().signal)
    expect(result.indexed).toEqual(['https://example.com'])
    expect(result.markdownBySrc?.['https://example.com']).toBe('# Hello')
  })

  it('throws with body text on non-OK response', async () => {
    fetchMock.mockResolvedValueOnce(new Response('SSRF blocked', { status: 403 }))

    await expect(
      runSourcePrompt(['https://example.com'], new AbortController().signal),
    ).rejects.toThrow('SSRF blocked')
  })

  it('throws with status-based message when body is empty', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 502 }))

    await expect(
      runSourcePrompt(['https://example.com'], new AbortController().signal),
    ).rejects.toThrow('Source ingest failed (502)')
  })

  it('propagates network errors', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network error'))

    await expect(
      runSourcePrompt(['https://example.com'], new AbortController().signal),
    ).rejects.toThrow('Network error')
  })
})
