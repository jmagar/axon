import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { closeConnection, runAxonCommandWsStream } from '@/lib/axon-ws-exec'

type MessageListener = (event: { data: unknown }) => void
type CloseListener = (event: { code: number }) => void
type OpenListener = () => void
type ErrorListener = () => void

class FakeWebSocket {
  static instances: FakeWebSocket[] = []

  private openListeners: OpenListener[] = []
  private messageListeners: MessageListener[] = []
  private errorListeners: ErrorListener[] = []
  private closeListeners: CloseListener[] = []

  sent: string[] = []
  readyState = 1 // OPEN

  constructor(_url: string) {
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: 'open', listener: OpenListener): void
  addEventListener(type: 'message', listener: MessageListener): void
  addEventListener(type: 'error', listener: ErrorListener): void
  addEventListener(type: 'close', listener: CloseListener): void
  addEventListener(
    type: 'open' | 'message' | 'error' | 'close',
    listener: OpenListener | MessageListener | ErrorListener | CloseListener,
  ): void {
    if (type === 'open') {
      this.openListeners.push(listener as OpenListener)
      return
    }
    if (type === 'message') {
      this.messageListeners.push(listener as MessageListener)
      return
    }
    if (type === 'error') {
      this.errorListeners.push(listener as ErrorListener)
      return
    }
    this.closeListeners.push(listener as CloseListener)
  }

  close(): void {
    this.readyState = 3 // CLOSED
  }

  send(data: string): void {
    this.sent.push(data)
  }

  emitOpen(): void {
    for (const listener of this.openListeners) {
      listener()
    }
  }

  emitMessage(data: unknown): void {
    for (const listener of this.messageListeners) {
      listener({ data })
    }
  }

  emitError(): void {
    for (const listener of this.errorListeners) {
      listener()
    }
  }

  emitClose(code = 1000): void {
    this.readyState = 3 // CLOSED
    for (const listener of this.closeListeners) {
      listener({ code })
    }
  }
}

/**
 * Get the singleton fake socket, waiting up to 10 microtask ticks for it to be created.
 */
async function currentSocket(): Promise<FakeWebSocket> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const socket = FakeWebSocket.instances.at(-1)
    if (socket) {
      return socket
    }
    await Promise.resolve()
  }
  throw new Error('expected FakeWebSocket instance to be created')
}

/**
 * Wait for ws.sent to have at least `count` entries, yielding microtasks between polls.
 * The singleton connection's .then() callback fires asynchronously after emitOpen(),
 * so callers must await this before reading sent messages.
 */
async function waitForSent(ws: FakeWebSocket, count = 1): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (ws.sent.length >= count) return
    await Promise.resolve()
  }
  throw new Error(`expected ${count} sent message(s) on socket, got ${ws.sent.length}`)
}

/**
 * Parse the exec_id from the nth `send()` call on the socket.
 * The singleton sends `{ type: 'execute', mode, input, flags, exec_id }`.
 * Pass index=-1 to read the last sent message.
 */
function execIdFromSent(ws: FakeWebSocket, index = -1): string {
  const entry = index === -1 ? ws.sent.at(-1) : ws.sent[index]
  if (!entry) throw new Error(`no sent message at index ${index} (sent.length=${ws.sent.length})`)
  const parsed = JSON.parse(entry) as { exec_id?: string }
  if (!parsed.exec_id) throw new Error(`exec_id missing from sent message: ${entry}`)
  return parsed.exec_id
}

/**
 * Build a command.output.json frame with the given exec_id.
 */
function makeOutputJsonFrame(execId: string, data: unknown): string {
  return JSON.stringify({
    type: 'command.output.json',
    data: {
      ctx: { exec_id: execId, mode: 'test', input: '' },
      data,
    },
  })
}

/**
 * Build a command.done frame with the given exec_id.
 */
function makeDoneFrame(execId: string, exitCode = 0, elapsedMs = 12): string {
  return JSON.stringify({
    type: 'command.done',
    data: {
      ctx: { exec_id: execId, mode: 'test', input: '' },
      payload: { exit_code: exitCode, elapsed_ms: elapsedMs },
    },
  })
}

/**
 * Build a command.error frame with the given exec_id.
 */
function makeErrorFrame(execId: string, message: string, elapsedMs = 88): string {
  return JSON.stringify({
    type: 'command.error',
    data: {
      ctx: { exec_id: execId, mode: 'test', input: '' },
      payload: { message, elapsed_ms: elapsedMs },
    },
  })
}

const originalWebSocket = globalThis.WebSocket

describe('runAxonCommandWsStream raw frame handling (singleton connection)', () => {
  beforeEach(() => {
    // Reset singleton state and fake socket registry before each test.
    closeConnection()
    FakeWebSocket.instances = []
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      writable: true,
      value: FakeWebSocket,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    closeConnection()
    if (originalWebSocket) {
      Object.defineProperty(globalThis, 'WebSocket', {
        configurable: true,
        writable: true,
        value: originalWebSocket,
      })
      return
    }
    // Keep global clean in runtimes without a native WebSocket.
    Reflect.deleteProperty(globalThis, 'WebSocket')
  })

  it('command.output.json callback receives payload from raw frame', async () => {
    const onJson = vi.fn()

    const stream = runAxonCommandWsStream('query', { timeoutMs: 1_000, onJson })
    const ws = await currentSocket()
    ws.emitOpen()

    // Wait for the .then() callback to fire and call ws.send() with the execute message.
    await waitForSent(ws)
    const execId = execIdFromSent(ws)

    ws.emitMessage(makeOutputJsonFrame(execId, { answer: 'ok', count: 2 }))
    ws.emitMessage(makeDoneFrame(execId))

    await expect(stream).resolves.toBeUndefined()
    expect(onJson).toHaveBeenCalledWith({ answer: 'ok', count: 2 })
  })

  it('command.done callback receives exit_code/elapsed_ms and resolves stream', async () => {
    const onDone = vi.fn()

    const stream = runAxonCommandWsStream('crawl', { timeoutMs: 1_000, onDone })
    const ws = await currentSocket()
    ws.emitOpen()

    await waitForSent(ws)
    const execId = execIdFromSent(ws)

    ws.emitMessage(
      JSON.stringify({
        type: 'command.done',
        data: {
          ctx: { exec_id: execId, mode: 'crawl', input: '' },
          payload: { exit_code: 0, elapsed_ms: 345 },
        },
      }),
    )

    await expect(stream).resolves.toBeUndefined()
    expect(onDone).toHaveBeenCalledWith({ exit_code: 0, elapsed_ms: 345 })
  })

  it('command.error callback receives message and resolves stream', async () => {
    const onError = vi.fn()

    const stream = runAxonCommandWsStream('extract', { timeoutMs: 1_000, onError })
    const ws = await currentSocket()
    ws.emitOpen()

    await waitForSent(ws)
    const execId = execIdFromSent(ws)

    ws.emitMessage(makeErrorFrame(execId, 'bad things happened'))

    await expect(stream).resolves.toBeUndefined()
    expect(onError).toHaveBeenCalledWith({ message: 'bad things happened', elapsed_ms: 88 })
  })

  it('malformed/non-JSON WS frames are ignored without throwing', async () => {
    const onJson = vi.fn()

    const stream = runAxonCommandWsStream('query', { timeoutMs: 1_000, onJson })
    const ws = await currentSocket()
    ws.emitOpen()

    await waitForSent(ws)
    const execId = execIdFromSent(ws)

    ws.emitMessage('not-json')
    ws.emitMessage({ impossible: 'to parse as json string' })
    ws.emitMessage('{"missing_type":true}')
    ws.emitMessage(makeDoneFrame(execId, 0, 5))

    await expect(stream).resolves.toBeUndefined()
    expect(onJson).not.toHaveBeenCalled()
  })

  it('command.done with non-zero exit_code is surfaced to callback', async () => {
    const onDone = vi.fn()

    const stream = runAxonCommandWsStream('embed', { timeoutMs: 1_000, onDone })
    const ws = await currentSocket()
    ws.emitOpen()

    await waitForSent(ws)
    const execId = execIdFromSent(ws)

    ws.emitMessage(makeDoneFrame(execId, 17, 901))

    await expect(stream).resolves.toBeUndefined()
    expect(onDone).toHaveBeenCalledWith({ exit_code: 17, elapsed_ms: 901 })
  })

  it('two concurrent streams are multiplexed on a single connection', async () => {
    const onJson1 = vi.fn()
    const onJson2 = vi.fn()

    const stream1 = runAxonCommandWsStream('query', { timeoutMs: 1_000, onJson: onJson1 })
    const stream2 = runAxonCommandWsStream('sources', { timeoutMs: 1_000, onJson: onJson2 })

    const ws = await currentSocket()
    ws.emitOpen()

    // Wait for both execute messages to arrive after the open resolves.
    await waitForSent(ws, 2)

    // Only one WS instance should exist (singleton).
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(ws.sent).toHaveLength(2)

    const execId1 = execIdFromSent(ws, 0)
    const execId2 = execIdFromSent(ws, 1)
    expect(execId1).not.toBe(execId2)

    // Reply to stream2 first, then stream1 — verifies independent routing.
    ws.emitMessage(makeOutputJsonFrame(execId2, { sources: [] }))
    ws.emitMessage(makeDoneFrame(execId2))
    ws.emitMessage(makeOutputJsonFrame(execId1, { result: 'found' }))
    ws.emitMessage(makeDoneFrame(execId1))

    await expect(stream1).resolves.toBeUndefined()
    await expect(stream2).resolves.toBeUndefined()

    expect(onJson1).toHaveBeenCalledWith({ result: 'found' })
    expect(onJson2).toHaveBeenCalledWith({ sources: [] })
  })

  it('second call reuses the open singleton without creating a new socket', async () => {
    // First stream.
    const stream1 = runAxonCommandWsStream('stats', { timeoutMs: 1_000 })
    const ws = await currentSocket()
    ws.emitOpen()
    await waitForSent(ws)
    const execId1 = execIdFromSent(ws)
    ws.emitMessage(makeDoneFrame(execId1))
    await stream1

    // Second stream — getConnection() returns Promise.resolve(_ws) synchronously
    // when readyState === 1, so the send fires after a single microtask tick.
    const stream2 = runAxonCommandWsStream('status', { timeoutMs: 1_000 })
    await waitForSent(ws, 2)
    const execId2 = execIdFromSent(ws, 1)
    ws.emitMessage(makeDoneFrame(execId2))
    await stream2

    expect(FakeWebSocket.instances).toHaveLength(1)
  })
})
