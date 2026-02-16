/**
 * Tests for ask command
 */

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock child_process before importing the module under test
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

// Mock query command
vi.mock('../../commands/query', () => ({
  executeQuery: vi.fn(),
}));
vi.mock('../../commands/retrieve', () => ({
  executeRetrieve: vi.fn(),
}));

import { spawn } from 'node:child_process';
import { executeAsk, handleAskCommand } from '../../commands/ask';
import { executeQuery } from '../../commands/query';
import { executeRetrieve } from '../../commands/retrieve';
import type { IContainer } from '../../container/types';
import type { QueryResultItem } from '../../types/query';
import type { RetrieveResult } from '../../types/retrieve';
import { createTestContainer } from '../utils/test-container';

/**
 * Helper to create a mock child process with EventEmitter semantics
 */
function createMockProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stdin: EventEmitter & {
      write: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
    };
  };
  proc.stdout = new EventEmitter();
  proc.stdin = Object.assign(new EventEmitter(), {
    write: vi.fn(),
    end: vi.fn(),
  });
  return proc;
}

/**
 * Helper to create properly typed mock query result items
 */
function createMockQueryResult(
  url: string,
  score: number = 0.9,
  chunkText: string = 'content',
  metadata?: {
    fileModifiedAt?: string;
    scrapedAt?: string;
    sourcePathRel?: string;
  }
): QueryResultItem {
  return {
    url,
    title: 'Doc',
    score,
    chunkHeader: null,
    chunkText,
    chunkIndex: 0,
    totalChunks: 1,
    domain: 'example.com',
    sourceCommand: 'crawl',
    fileModifiedAt: metadata?.fileModifiedAt,
    scrapedAt: metadata?.scrapedAt,
    sourcePathRel: metadata?.sourcePathRel,
  };
}

function createMockRetrieveResult(url: string): RetrieveResult {
  return {
    success: true,
    data: {
      url,
      totalChunks: 1,
      content: 'Document content',
    },
  };
}

describe('executeAsk', () => {
  let container: IContainer;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = global.fetch;
    // Suppress console.error output from the command
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    process.env.ASK_CLI = 'haiku';
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;

    container = createTestContainer(undefined, {
      teiUrl: 'http://localhost:52000',
      qdrantUrl: 'http://localhost:53333',
      qdrantCollection: 'test_col',
    });

    vi.mocked(executeRetrieve).mockImplementation(async (_container, options) =>
      createMockRetrieveResult(options.url)
    );
  });

  afterEach(() => {
    delete process.env.ASK_CLI;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('should fail when TEI_URL not configured', async () => {
    const badContainer = createTestContainer(undefined, {
      teiUrl: undefined,
      qdrantUrl: undefined,
    });

    const result = await executeAsk(badContainer, { query: 'test' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('TEI_URL');
  });

  it('should fail when query returns no results', async () => {
    vi.mocked(executeQuery).mockResolvedValue({
      success: true,
      data: [],
    });

    const result = await executeAsk(container, { query: 'nonexistent' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('No relevant documents found');
  });

  it('should fail early on invalid maxContext before query', async () => {
    const result = await executeAsk(container, {
      query: 'test',
      maxContext: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid --max-context value');
    expect(executeQuery).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('should fail when no ask backend is configured', async () => {
    delete process.env.ASK_CLI;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;

    const result = await executeAsk(container, { query: 'test' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No ask backend configured');
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it('should fail when query fails', async () => {
    vi.mocked(executeQuery).mockResolvedValue({
      success: false,
      error: 'Query error',
    });

    const result = await executeAsk(container, { query: 'test' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Query error');
  });

  it('should surface query timeout errors', async () => {
    vi.mocked(executeQuery).mockRejectedValue(
      new Error('Query timeout after 10000ms')
    );

    const result = await executeAsk(container, { query: 'test timeout' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('timeout');
  });

  it('should pass -p flag to claude CLI for non-interactive mode', async () => {
    const mockProc = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mockProc as never);

    vi.mocked(executeQuery).mockResolvedValue({
      success: true,
      data: [createMockQueryResult('https://example.com/doc')],
    });

    // Simulate process completing after spawn
    const resultPromise = executeAsk(container, { query: 'what is this?' });

    // Wait for spawn to be called
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());

    // Verify -p flag is passed for claude
    expect(spawn).toHaveBeenCalledWith(
      'claude',
      ['-p', '--model', 'haiku'],
      expect.any(Object)
    );

    // Emit response and close
    mockProc.stdout.emit('data', Buffer.from('AI response'));
    mockProc.emit('close', 0);

    const result = await resultPromise;
    expect(result.success).toBe(true);
    expect(result.data?.answer).toBe('AI response');
  });

  it('should use non-interactive prompt mode for gemini CLI', async () => {
    const mockProc = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mockProc as never);

    vi.mocked(executeQuery).mockResolvedValue({
      success: true,
      data: [createMockQueryResult('https://example.com/doc')],
    });

    const resultPromise = executeAsk(container, {
      query: 'what is this?',
      model: 'gemini-2.5-pro',
    });

    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());

    // Gemini should use explicit prompt mode for non-interactive execution
    expect(spawn).toHaveBeenCalledWith(
      'gemini',
      [
        '--model',
        'gemini-2.5-pro',
        '--prompt',
        'Answer only from stdin context. Do not use tools.',
      ],
      expect.any(Object)
    );

    mockProc.stdout.emit('data', Buffer.from('Gemini response'));
    mockProc.emit('close', 0);

    const result = await resultPromise;
    expect(result.success).toBe(true);
  });

  it('should use OpenAI-compatible fallback when ASK_CLI is not set', async () => {
    delete process.env.ASK_CLI;
    process.env.OPENAI_BASE_URL = 'https://cli-api.tootie.tv/v1';
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.OPENAI_MODEL = 'gemini-3-flash-preview';

    const sseChunks = [
      'data: {"choices":[{"delta":{"content":"OpenAI"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" fallback"}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(sseChunks[0]),
        })
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(sseChunks[1]),
        })
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(sseChunks[2]),
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {
        get: vi.fn().mockReturnValue('text/event-stream'),
      },
      body: {
        getReader: vi.fn().mockReturnValue(reader),
      },
    } as unknown as Response);

    vi.mocked(executeQuery).mockResolvedValue({
      success: true,
      data: [createMockQueryResult('https://example.com/doc')],
    });

    const result = await executeAsk(container, {
      query: 'test openai fallback',
    });

    expect(result.success).toBe(true);
    expect(result.data?.answer).toBe('OpenAI fallback');
    expect(spawn).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith(
      'https://cli-api.tootie.tv/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
      })
    );
  });

  it('should handle null exit code (process killed by signal)', async () => {
    const mockProc = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mockProc as never);

    vi.mocked(executeQuery).mockResolvedValue({
      success: true,
      data: [createMockQueryResult('https://example.com/doc')],
    });

    const resultPromise = executeAsk(container, { query: 'test' });

    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());

    // Emit null code (killed by signal)
    mockProc.emit('close', null);

    const result = await resultPromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('killed by a signal');
  });

  it('should handle non-zero exit code', async () => {
    const mockProc = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mockProc as never);

    vi.mocked(executeQuery).mockResolvedValue({
      success: true,
      data: [createMockQueryResult('https://example.com/doc')],
    });

    const resultPromise = executeAsk(container, { query: 'test' });

    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());

    mockProc.emit('close', 1);

    const result = await resultPromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('exited with code 1');
  });

  it('should handle stdin write errors gracefully', async () => {
    const mockProc = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mockProc as never);

    vi.mocked(executeQuery).mockResolvedValue({
      success: true,
      data: [createMockQueryResult('https://example.com/doc')],
    });

    const resultPromise = executeAsk(container, { query: 'test' });

    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());

    // Emit stdin error (child exited before stdin flushed)
    mockProc.stdin.emit('error', new Error('write EPIPE'));

    // Then close with error code
    mockProc.emit('close', 1);

    const result = await resultPromise;
    // Should not crash - the close handler reports the real error
    expect(result.success).toBe(false);
    expect(result.error).toContain('exited with code 1');
  });

  it('should handle spawn errors', async () => {
    const mockProc = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mockProc as never);

    vi.mocked(executeQuery).mockResolvedValue({
      success: true,
      data: [createMockQueryResult('https://example.com/doc')],
    });

    const resultPromise = executeAsk(container, { query: 'test' });

    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());

    // Emit spawn error (CLI not found)
    mockProc.emit('error', new Error('ENOENT'));

    const result = await resultPromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to spawn claude CLI');
  });

  it('should return sources and document count on success', async () => {
    const mockProc = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mockProc as never);

    vi.mocked(executeQuery).mockResolvedValue({
      success: true,
      data: [
        createMockQueryResult('https://example.com/doc1', 0.95),
        createMockQueryResult('https://example.com/doc2', 0.85),
      ],
    });

    const resultPromise = executeAsk(container, { query: 'what is this?' });

    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());

    mockProc.stdout.emit('data', Buffer.from('Answer text'));
    mockProc.emit('close', 0);

    const result = await resultPromise;
    expect(result.success).toBe(true);
    expect(result.data?.sources).toHaveLength(2);
    expect(result.data?.sources[0].score).toBe(0.95);
    expect(result.data?.fullDocumentsUsed).toBe(2);
    expect(result.data?.chunksUsed).toBe(0);
    expect(result.data?.responseDurationSeconds).toBeGreaterThanOrEqual(0);
    expect(result.data?.answer).toBe('Answer text');
  });

  it('should backfill up to 3 supplemental chunks from non-full-document URLs', async () => {
    const mockProc = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mockProc as never);

    vi.mocked(executeQuery).mockResolvedValue({
      success: true,
      data: [
        createMockQueryResult('https://example.com/doc1', 0.99, 'chunk1'),
        createMockQueryResult('https://example.com/doc2', 0.98, 'chunk2'),
        createMockQueryResult('https://example.com/doc3', 0.97, 'chunk3'),
        createMockQueryResult('https://example.com/doc4', 0.96, 'chunk4'),
        createMockQueryResult('https://example.com/doc5', 0.95, 'chunk5'),
        createMockQueryResult('https://example.com/doc6', 0.94, 'chunk6'),
        createMockQueryResult('https://example.com/doc7', 0.93, 'chunk7'),
        createMockQueryResult('https://example.com/doc8', 0.92, 'chunk8'),
      ],
    });

    const resultPromise = executeAsk(container, { query: 'test backfill' });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());

    const writes = vi
      .mocked(mockProc.stdin.write)
      .mock.calls.map((call) => String(call[0]));
    const combined = writes.join('');
    expect(combined).toContain(
      'Source Document 1 [S1]: https://example.com/doc1'
    );
    expect(combined).toContain(
      'Source Document 5 [S5]: https://example.com/doc5'
    );
    expect(combined).toContain(
      'Supplemental Chunk 1 [S6]: https://example.com/doc6'
    );
    expect(combined).toContain(
      'Supplemental Chunk 2 [S7]: https://example.com/doc7'
    );
    expect(combined).toContain(
      'Supplemental Chunk 3 [S8]: https://example.com/doc8'
    );
    expect(combined).not.toContain(
      'Supplemental Chunk 1 [S6]: https://example.com/doc1'
    );

    mockProc.stdout.emit('data', Buffer.from('Answer'));
    mockProc.emit('close', 0);

    const result = await resultPromise;
    expect(result.success).toBe(true);
    expect(result.data?.fullDocumentsUsed).toBe(5);
    expect(result.data?.chunksUsed).toBe(3);
    expect(result.data?.sources).toHaveLength(8);
  });

  it('should enforce context size limit and truncate full documents', async () => {
    const mockProc = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mockProc as never);

    const largeContent = 'x'.repeat(60000); // 60k chars per document
    vi.mocked(executeQuery).mockResolvedValue({
      success: true,
      data: [
        createMockQueryResult('https://example.com/doc1', 0.95, largeContent),
        createMockQueryResult('https://example.com/doc2', 0.85, largeContent),
      ],
    });

    vi.mocked(executeRetrieve).mockImplementation(
      async (_container, options) => ({
        success: true,
        data: {
          url: options.url,
          totalChunks: 1,
          content: largeContent,
        },
      })
    );

    // Set maxContext to 80k - should include first full document but not second
    const resultPromise = executeAsk(container, {
      query: 'test',
      maxContext: 80000,
    });

    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());

    // Verify only 1 full document was included (check stdin write)
    expect(mockProc.stdin.write).toHaveBeenCalledWith(
      expect.stringContaining('https://example.com/doc1')
    );
    const allWriteCalls = vi
      .mocked(mockProc.stdin.write)
      .mock.calls.map((call) => String(call[0]));
    expect(allWriteCalls.join('')).not.toContain('https://example.com/doc2');

    mockProc.stdout.emit('data', Buffer.from('Answer'));
    mockProc.emit('close', 0);

    const result = await resultPromise;
    expect(result.success).toBe(true);
  });

  it('should fail when maxContext is too small for any full document', async () => {
    const hugeContent = 'x'.repeat(2000);
    vi.mocked(executeQuery).mockResolvedValue({
      success: true,
      data: [
        createMockQueryResult('https://example.com/doc1', 0.95, hugeContent),
      ],
    });
    vi.mocked(executeRetrieve).mockImplementation(
      async (_container, options) => ({
        success: true,
        data: {
          url: options.url,
          totalChunks: 1,
          content: hugeContent,
        },
      })
    );

    // Set maxContext to 100 - too small for any doc (no spawn expected)
    const result = await executeAsk(container, {
      query: 'test',
      maxContext: 100,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Context size limit');
    expect(result.error).toContain('100');
    expect(result.error).toContain('too small to include any full documents');
    // Verify spawn was NOT called since we failed early
    expect(spawn).not.toHaveBeenCalled();
  });

  it('should render sources in title/summary format after response streaming', async () => {
    const mockProc = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mockProc as never);

    vi.mocked(executeQuery).mockResolvedValue({
      success: true,
      data: [createMockQueryResult('https://example.com/doc1', 0.91)],
    });

    const commandPromise = handleAskCommand(container, {
      query: 'summarize this',
    });

    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    mockProc.stdout.emit('data', Buffer.from('Answer'));
    mockProc.emit('close', 0);

    await commandPromise;

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Ask Sources: "summarize this"')
    );
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Docs: 1')
    );
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Chunks: 0')
    );
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Sources: 1')
    );
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('URLs: 1')
    );
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Candidates: 1')
    );
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Response Time:')
    );
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Ordering:')
    );
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Reranked')
    );
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Raw:'));
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Vector Similarity')
    );
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Rank'));
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('https://example.com/doc1')
    );
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(
        'Inspect a source document with: axon retrieve <url>'
      )
    );
  });

  it('should auto-scope "today" queries by metadata timestamp', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-16T12:00:00Z'));

    const mockProc = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mockProc as never);

    vi.mocked(executeQuery).mockResolvedValue({
      success: true,
      data: [
        createMockQueryResult('https://example.com/today', 0.9, 'today chunk', {
          fileModifiedAt: '2026-02-16T09:00:00Z',
        }),
        createMockQueryResult(
          'https://example.com/yesterday',
          0.8,
          'old chunk',
          { fileModifiedAt: '2026-02-15T09:00:00Z' }
        ),
      ],
    });

    const resultPromise = executeAsk(container, {
      query: 'what have we accomplished today?',
    });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    mockProc.stdout.emit('data', Buffer.from('Answer'));
    mockProc.emit('close', 0);

    const result = await resultPromise;
    expect(result.success).toBe(true);
    expect(result.data?.sources.map((s) => s.url)).toEqual([
      'https://example.com/today',
    ]);
    expect(result.data?.appliedScope).toContain('today (2026-02-16)');
    expect(result.data?.scopeFallback).toBeUndefined();

    vi.useRealTimers();
  });

  it('should fail strict "today" queries when scoped results are empty', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-16T12:00:00Z'));

    vi.mocked(executeQuery).mockResolvedValue({
      success: true,
      data: [
        createMockQueryResult('https://example.com/old', 0.9, 'old chunk', {
          fileModifiedAt: '2026-01-10T09:00:00Z',
        }),
      ],
    });

    const result = await executeAsk(container, {
      query: 'what changed today?',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('No today (2026-02-16) matches found');
    expect(spawn).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('should fallback to unscoped retrieval for non-strict temporal scopes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-16T12:00:00Z'));

    const mockProc = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mockProc as never);

    vi.mocked(executeQuery).mockResolvedValue({
      success: true,
      data: [
        createMockQueryResult('https://example.com/old', 0.9, 'old chunk', {
          fileModifiedAt: '2026-01-10T09:00:00Z',
        }),
      ],
    });

    const resultPromise = executeAsk(container, {
      query: 'what changed this week?',
    });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    mockProc.stdout.emit('data', Buffer.from('Answer'));
    mockProc.emit('close', 0);

    const result = await resultPromise;
    expect(result.success).toBe(true);
    expect(result.data?.scopeFallback).toBe(true);
    expect(result.data?.scopeStrict).toBe(false);
    expect(result.data?.rawCandidateChunks).toBe(1);
    expect(result.data?.candidateChunks).toBe(1);
    expect(result.data?.uniqueSourceUrls).toBe(1);

    vi.useRealTimers();
  });

  it('should prioritize same-day session paths for temporal queries', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-16T12:00:00Z'));

    const mockProc = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mockProc as never);

    vi.mocked(executeQuery).mockResolvedValue({
      success: true,
      data: [
        createMockQueryResult('axon/docs/notes/summary.md', 0.8, 'summary', {
          fileModifiedAt: '2026-02-16T10:00:00Z',
          sourcePathRel: 'docs/notes/summary.md',
        }),
        createMockQueryResult(
          'axon/docs/sessions/2026-02-16-focus.md',
          0.75,
          'session',
          {
            fileModifiedAt: '2026-02-16T10:30:00Z',
            sourcePathRel: 'docs/sessions/2026-02-16-focus.md',
          }
        ),
      ],
    });

    const resultPromise = executeAsk(container, {
      query: 'what did we do today?',
      fullDocs: 1,
      backfillChunks: 0,
      limit: 1,
    });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    mockProc.stdout.emit('data', Buffer.from('Answer'));
    mockProc.emit('close', 0);

    const result = await resultPromise;
    expect(result.success).toBe(true);
    expect(result.data?.sources[0]?.url).toContain('/docs/sessions/2026-02-16');

    vi.useRealTimers();
  });
});
