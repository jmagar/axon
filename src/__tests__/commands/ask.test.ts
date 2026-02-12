/**
 * Tests for ask command
 */

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock child_process before importing the module under test
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

// Mock query and retrieve commands
vi.mock('../../commands/query', () => ({
  executeQuery: vi.fn(),
}));

vi.mock('../../commands/retrieve', () => ({
  executeRetrieve: vi.fn(),
}));

import { spawn } from 'node:child_process';
import { executeAsk } from '../../commands/ask';
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
  score: number = 0.9
): QueryResultItem {
  return {
    url,
    title: 'Doc',
    score,
    chunkHeader: null,
    chunkText: 'content',
    chunkIndex: 0,
    totalChunks: 1,
    domain: 'example.com',
    sourceCommand: 'crawl',
  };
}

/**
 * Helper to create properly typed mock retrieve result
 */
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

  beforeEach(() => {
    vi.clearAllMocks();
    // Suppress console.error output from the command
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    container = createTestContainer(undefined, {
      teiUrl: 'http://localhost:52000',
      qdrantUrl: 'http://localhost:53333',
      qdrantCollection: 'test_col',
    });
  });

  afterEach(() => {
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

  it('should fail early on invalid maxContext before query/retrieve', async () => {
    const result = await executeAsk(container, {
      query: 'test',
      maxContext: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid --max-context value');
    expect(executeQuery).not.toHaveBeenCalled();
    expect(executeRetrieve).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
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

  it('should fail when all retrieves fail', async () => {
    vi.mocked(executeQuery).mockResolvedValue({
      success: true,
      data: [createMockQueryResult('https://example.com/doc')],
    });
    vi.mocked(executeRetrieve).mockResolvedValue({
      success: false,
      error: 'Retrieve failed',
    });

    const result = await executeAsk(container, { query: 'test' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to retrieve any documents');
  });

  it('should surface retrieve network failures', async () => {
    vi.mocked(executeQuery).mockResolvedValue({
      success: true,
      data: [createMockQueryResult('https://example.com/doc')],
    });
    vi.mocked(executeRetrieve).mockRejectedValue(
      new Error('ECONNRESET while retrieving document')
    );

    const result = await executeAsk(container, { query: 'network issue' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('ECONNRESET');
  });

  it('should pass -p flag to claude CLI for non-interactive mode', async () => {
    const mockProc = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mockProc as never);

    vi.mocked(executeQuery).mockResolvedValue({
      success: true,
      data: [createMockQueryResult('https://example.com/doc')],
    });
    vi.mocked(executeRetrieve).mockResolvedValue(
      createMockRetrieveResult('https://example.com/doc')
    );

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

  it('should NOT pass -p flag to gemini CLI', async () => {
    const mockProc = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mockProc as never);

    vi.mocked(executeQuery).mockResolvedValue({
      success: true,
      data: [createMockQueryResult('https://example.com/doc')],
    });
    vi.mocked(executeRetrieve).mockResolvedValue(
      createMockRetrieveResult('https://example.com/doc')
    );

    const resultPromise = executeAsk(container, {
      query: 'what is this?',
      model: 'gemini-2.5-pro',
    });

    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());

    // Gemini should NOT have -p flag
    expect(spawn).toHaveBeenCalledWith(
      'gemini',
      ['--model', 'gemini-2.5-pro'],
      expect.any(Object)
    );

    mockProc.stdout.emit('data', Buffer.from('Gemini response'));
    mockProc.emit('close', 0);

    const result = await resultPromise;
    expect(result.success).toBe(true);
  });

  it('should handle null exit code (process killed by signal)', async () => {
    const mockProc = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mockProc as never);

    vi.mocked(executeQuery).mockResolvedValue({
      success: true,
      data: [createMockQueryResult('https://example.com/doc')],
    });
    vi.mocked(executeRetrieve).mockResolvedValue(
      createMockRetrieveResult('https://example.com/doc')
    );

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
    vi.mocked(executeRetrieve).mockResolvedValue(
      createMockRetrieveResult('https://example.com/doc')
    );

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
    vi.mocked(executeRetrieve).mockResolvedValue(
      createMockRetrieveResult('https://example.com/doc')
    );

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
    vi.mocked(executeRetrieve).mockResolvedValue(
      createMockRetrieveResult('https://example.com/doc')
    );

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
    vi.mocked(executeRetrieve)
      .mockResolvedValueOnce(
        createMockRetrieveResult('https://example.com/doc1')
      )
      .mockResolvedValueOnce(
        createMockRetrieveResult('https://example.com/doc2')
      );

    const resultPromise = executeAsk(container, { query: 'what is this?' });

    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());

    mockProc.stdout.emit('data', Buffer.from('Answer text'));
    mockProc.emit('close', 0);

    const result = await resultPromise;
    expect(result.success).toBe(true);
    expect(result.data?.sources).toHaveLength(2);
    expect(result.data?.sources[0].score).toBe(0.95);
    expect(result.data?.documentsRetrieved).toBe(2);
    expect(result.data?.answer).toBe('Answer text');
  });

  it('should enforce context size limit and truncate documents', async () => {
    const mockProc = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mockProc as never);

    const largeContent = 'x'.repeat(60000); // 60k chars per doc
    vi.mocked(executeQuery).mockResolvedValue({
      success: true,
      data: [
        createMockQueryResult('https://example.com/doc1', 0.95),
        createMockQueryResult('https://example.com/doc2', 0.85),
      ],
    });
    vi.mocked(executeRetrieve)
      .mockResolvedValueOnce({
        success: true,
        data: {
          url: 'https://example.com/doc1',
          totalChunks: 1,
          content: largeContent,
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          url: 'https://example.com/doc2',
          totalChunks: 1,
          content: largeContent,
        },
      });

    // Set maxContext to 80k - should include first doc but not second
    const resultPromise = executeAsk(container, {
      query: 'test',
      maxContext: 80000,
    });

    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());

    // Verify only 1 document was included (check stdin write)
    expect(mockProc.stdin.write).toHaveBeenCalledWith(
      expect.stringContaining('https://example.com/doc1')
    );
    expect(mockProc.stdin.write).toHaveBeenCalledWith(
      expect.not.stringContaining('https://example.com/doc2')
    );

    mockProc.stdout.emit('data', Buffer.from('Answer'));
    mockProc.emit('close', 0);

    const result = await resultPromise;
    expect(result.success).toBe(true);
  });

  it('should fail when maxContext is too small for any document', async () => {
    vi.mocked(executeQuery).mockResolvedValue({
      success: true,
      data: [createMockQueryResult('https://example.com/doc1', 0.95)],
    });
    vi.mocked(executeRetrieve).mockResolvedValueOnce({
      success: true,
      data: {
        url: 'https://example.com/doc1',
        totalChunks: 1,
        content: 'x'.repeat(1000),
      },
    });

    // Set maxContext to 100 - too small for any doc (no spawn expected)
    const result = await executeAsk(container, {
      query: 'test',
      maxContext: 100,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Context size limit');
    expect(result.error).toContain('100');
    expect(result.error).toContain('too small to include any documents');
    // Verify spawn was NOT called since we failed early
    expect(spawn).not.toHaveBeenCalled();
  });
});
