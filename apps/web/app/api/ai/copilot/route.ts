import { generateText } from 'ai'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

const DEFAULT_MODEL = 'gpt-4o-mini'
const ALLOWED_MODELS = new Set([DEFAULT_MODEL, 'gpt-4.1-mini'])

interface CopilotStreamEvent {
  completion?: string
  delta?: string
  type: 'delta' | 'done' | 'error' | 'start'
}

export const encodeCopilotStreamEvent = (event: CopilotStreamEvent) => `${JSON.stringify(event)}\n`

/** Parse OpenAI SSE streaming chunks — re-exported for use by other routes. */
export function parseOpenAiSseChunk(
  chunk: string,
  remainder: string,
): { deltas: string[]; done: boolean; remainder: string } {
  const combined = remainder + chunk
  const lines = combined.split('\n')
  const nextRemainder = lines.pop() ?? ''
  const deltas: string[] = []
  let done = false

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || !line.startsWith('data:')) continue
    const data = line.slice('data:'.length).trim()
    if (data === '[DONE]') {
      done = true
      break
    }
    try {
      const parsed = JSON.parse(data)
      const delta = parsed?.choices?.[0]?.delta?.content
      if (typeof delta === 'string' && delta.length > 0) {
        deltas.push(delta)
      }
    } catch {
      // Ignore malformed SSE lines.
    }
  }

  return { deltas, done, remainder: nextRemainder }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const key = typeof body?.apiKey === 'string' ? body.apiKey : undefined
    const model = typeof body?.model === 'string' ? body.model : DEFAULT_MODEL
    const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''
    const system = typeof body?.system === 'string' ? body.system : undefined
    const streamNdjson = req.headers.get('x-copilot-stream') === '1'

    if (!ALLOWED_MODELS.has(model)) {
      return NextResponse.json({ error: 'Unsupported model.' }, { status: 400 })
    }
    if (!prompt) {
      return NextResponse.json({ error: 'prompt must be a non-empty string.' }, { status: 400 })
    }

    const apiKey = key || process.env.AI_GATEWAY_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'Missing ai gateway API key.' }, { status: 401 })
    }

    const result = await generateText({
      abortSignal: req.signal,
      maxOutputTokens: 50,
      model: `openai/${model}`,
      prompt,
      system,
      temperature: 0.7,
    })

    if (streamNdjson) {
      const completion = typeof result.text === 'string' ? result.text : ''
      const events = `${encodeCopilotStreamEvent({ type: 'start' })}${encodeCopilotStreamEvent({
        completion,
        type: 'done',
      })}`

      return new NextResponse(events, {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/x-ndjson; charset=utf-8',
        },
        status: 200,
      })
    }

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json(null, { status: 408 })
    }

    return NextResponse.json({ error: 'Failed to process AI request' }, { status: 500 })
  }
}
