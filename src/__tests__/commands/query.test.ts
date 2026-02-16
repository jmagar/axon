/**
 * Tests for query command
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  executeQuery,
  getMeaningfulSnippet,
  selectBestPreviewItem,
} from '../../commands/query';
import type {
  IContainer,
  IQdrantService,
  ITeiService,
} from '../../container/types';
import { createTestContainer } from '../utils/test-container';

describe('executeQuery', () => {
  let container: IContainer;
  let mockTeiService: ITeiService;
  let mockQdrantService: IQdrantService;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock TEI service
    mockTeiService = {
      getTeiInfo: vi.fn().mockResolvedValue({
        modelId: 'test',
        dimension: 1024,
        maxInput: 32768,
      }),
      embedBatch: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
      embedChunks: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
    };

    // Create mock Qdrant service
    mockQdrantService = {
      ensureCollection: vi.fn().mockResolvedValue(undefined),
      deleteByUrl: vi.fn().mockResolvedValue(undefined),
      deleteByUrlAndSourceCommand: vi.fn().mockResolvedValue(undefined),
      deleteByDomain: vi.fn().mockResolvedValue(undefined),
      countByDomain: vi.fn().mockResolvedValue(0),
      upsertPoints: vi.fn().mockResolvedValue(undefined),
      queryPoints: vi.fn().mockResolvedValue([]),
      scrollByUrl: vi.fn().mockResolvedValue([]),
      getCollectionInfo: vi.fn().mockResolvedValue({
        status: 'green',
        vectorsCount: 0,
        pointsCount: 0,
        segmentsCount: 1,
        config: { dimension: 1024, distance: 'Cosine' },
      }),
      scrollAll: vi.fn().mockResolvedValue([]),
      countPoints: vi.fn().mockResolvedValue(0),
      countByUrl: vi.fn().mockResolvedValue(0),
      deleteAll: vi.fn().mockResolvedValue(undefined),
    };

    container = createTestContainer(undefined, {
      teiUrl: 'http://localhost:52000',
      qdrantUrl: 'http://localhost:53333',
      qdrantCollection: 'test_col',
    });

    // Override service methods to return our mocks
    vi.spyOn(container, 'getTeiService').mockReturnValue(mockTeiService);
    vi.spyOn(container, 'getQdrantService').mockReturnValue(mockQdrantService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should embed query and search Qdrant', async () => {
    vi.mocked(mockTeiService.embedBatch).mockResolvedValue([[0.1, 0.2, 0.3]]);
    vi.mocked(mockQdrantService.queryPoints).mockResolvedValue([
      {
        id: 'uuid-1',
        vector: [0.1, 0.2, 0.3],
        score: 0.92,
        payload: {
          url: 'https://example.com/auth',
          title: 'Auth Docs',
          chunk_header: '## Authentication',
          chunk_text: 'Set environment variables...',
          chunk_index: 0,
          total_chunks: 3,
          domain: 'example.com',
          source_command: 'scrape',
        },
      },
    ]);

    const result = await executeQuery(container, {
      query: 'how to authenticate',
    });

    expect(mockTeiService.embedBatch).toHaveBeenCalledWith([
      'how to authenticate',
    ]);
    expect(mockQdrantService.queryPoints).toHaveBeenCalledWith(
      'test_col',
      [0.1, 0.2, 0.3],
      100, // Fetches 10x default limit (10) for deduplication
      undefined
    );
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0].score).toBe(0.92);
    expect(result.data?.[0].url).toBe('https://example.com/auth');
  });

  it('should pass domain filter to Qdrant', async () => {
    vi.mocked(mockTeiService.embedBatch).mockResolvedValue([[0.1]]);
    vi.mocked(mockQdrantService.queryPoints).mockResolvedValue([]);

    await executeQuery(container, {
      query: 'test',
      domain: 'example.com',
      limit: 10,
    });

    expect(mockQdrantService.queryPoints).toHaveBeenCalledWith(
      'test_col',
      [0.1],
      100, // Fetches 10x requested limit (10) for deduplication
      { domain: 'example.com' }
    );
  });

  it('should not deduplicate in full mode', async () => {
    vi.mocked(mockTeiService.embedBatch).mockResolvedValue([[0.1]]);
    vi.mocked(mockQdrantService.queryPoints).mockResolvedValue([
      {
        id: 'uuid-1',
        vector: [0.1, 0.2, 0.3],
        score: 0.9,
        payload: {
          url: 'https://example.com/docs/?utm_source=test#intro',
          title: 'Docs Intro',
          chunk_text: 'Chunk A',
          chunk_index: 0,
          total_chunks: 2,
          domain: 'example.com',
          source_command: 'crawl',
        },
      },
      {
        id: 'uuid-2',
        vector: [0.1, 0.2, 0.3],
        score: 0.88,
        payload: {
          url: 'https://example.com/docs',
          title: 'Docs Intro',
          chunk_text: 'Chunk B',
          chunk_index: 1,
          total_chunks: 2,
          domain: 'example.com',
          source_command: 'crawl',
        },
      },
    ]);

    const result = await executeQuery(container, {
      query: 'docs intro',
      full: true,
      limit: 2,
    });

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(mockQdrantService.queryPoints).toHaveBeenCalledWith(
      'test_col',
      [0.1],
      2,
      undefined
    );
  });

  it('should fail when TEI_URL not configured', async () => {
    const badContainer = createTestContainer(undefined, {
      teiUrl: undefined,
      qdrantUrl: undefined,
    });

    const result = await executeQuery(badContainer, { query: 'test' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('TEI_URL');
  });

  it('should handle empty results', async () => {
    vi.mocked(mockTeiService.embedBatch).mockResolvedValue([[0.1]]);
    vi.mocked(mockQdrantService.queryPoints).mockResolvedValue([]);

    const result = await executeQuery(container, { query: 'nonexistent' });
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(0);
  });

  it('should return failure when embedding service has network error', async () => {
    vi.mocked(mockTeiService.embedBatch).mockRejectedValue(
      new Error('connect ECONNREFUSED 127.0.0.1:52000')
    );

    const result = await executeQuery(container, { query: 'test' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('ECONNREFUSED');
  });

  it('should return failure when vector query times out', async () => {
    vi.mocked(mockTeiService.embedBatch).mockResolvedValue([[0.1]]);
    vi.mocked(mockQdrantService.queryPoints).mockRejectedValue(
      new Error('Request timeout after 5000ms')
    );

    const result = await executeQuery(container, { query: 'test timeout' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('timeout');
  });

  it('should enforce limit after dedupe when canonical URL variants collapse', async () => {
    vi.mocked(mockTeiService.embedBatch).mockResolvedValue([[0.1]]);
    vi.mocked(mockQdrantService.queryPoints).mockResolvedValue([
      {
        id: 'uuid-1',
        vector: [0.1, 0.2, 0.3],
        score: 0.9,
        payload: {
          url: 'https://example.com/docs/?utm_source=test#intro',
          title: 'Docs Intro',
          chunk_text: 'Chunk A',
          chunk_index: 0,
          total_chunks: 2,
          domain: 'example.com',
          source_command: 'crawl',
        },
      },
      {
        id: 'uuid-2',
        vector: [0.1, 0.2, 0.3],
        score: 0.88,
        payload: {
          url: 'https://example.com/docs',
          title: 'Docs Intro',
          chunk_text: 'Chunk B',
          chunk_index: 1,
          total_chunks: 2,
          domain: 'example.com',
          source_command: 'crawl',
        },
      },
      {
        id: 'uuid-3',
        vector: [0.1, 0.2, 0.3],
        score: 0.87,
        payload: {
          url: 'https://other.com/page',
          title: 'Other',
          chunk_text: 'Other chunk',
          chunk_index: 0,
          total_chunks: 1,
          domain: 'other.com',
          source_command: 'crawl',
        },
      },
    ]);

    const result = await executeQuery(container, {
      query: 'docs intro',
      limit: 1,
    });

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(new URL(result.data?.[0].url ?? '').hostname).toBe('example.com');
  });

  it('should cap deduplicated results to requested limit', async () => {
    vi.mocked(mockTeiService.embedBatch).mockResolvedValue([[0.1]]);
    vi.mocked(mockQdrantService.queryPoints).mockResolvedValue([
      {
        id: 'uuid-1',
        vector: [0.1, 0.2, 0.3],
        score: 0.95,
        payload: {
          url: 'https://example.com/docs',
          title: 'Docs',
          chunk_text: 'Chunk A',
          chunk_index: 0,
          total_chunks: 4,
          domain: 'example.com',
          source_command: 'crawl',
        },
      },
      {
        id: 'uuid-2',
        vector: [0.1, 0.2, 0.3],
        score: 0.94,
        payload: {
          url: 'https://example.com/docs',
          title: 'Docs',
          chunk_text: 'Chunk B',
          chunk_index: 1,
          total_chunks: 4,
          domain: 'example.com',
          source_command: 'crawl',
        },
      },
      {
        id: 'uuid-3',
        vector: [0.1, 0.2, 0.3],
        score: 0.93,
        payload: {
          url: 'https://other.com/page',
          title: 'Other',
          chunk_text: 'Other chunk',
          chunk_index: 0,
          total_chunks: 1,
          domain: 'other.com',
          source_command: 'crawl',
        },
      },
    ]);

    const result = await executeQuery(container, {
      query: 'docs',
      limit: 1,
    });

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
  });

  it('should rerank URL groups using lexical relevance', async () => {
    vi.mocked(mockTeiService.embedBatch).mockResolvedValue([[0.1]]);
    vi.mocked(mockQdrantService.queryPoints).mockResolvedValue([
      {
        id: 'uuid-1',
        vector: [0.1, 0.2, 0.3],
        score: 0.81,
        payload: {
          url: 'https://example.com/weak',
          title: 'General docs',
          chunk_text: 'This page is broadly about product updates.',
          chunk_index: 0,
          total_chunks: 1,
          domain: 'example.com',
          source_command: 'crawl',
        },
      },
      {
        id: 'uuid-2',
        vector: [0.1, 0.2, 0.3],
        score: 0.79,
        payload: {
          url: 'https://example.com/subagents',
          title: 'Claude subagents guide',
          chunk_text:
            'This guide explains how Claude subagents are configured and used.',
          chunk_index: 0,
          total_chunks: 1,
          domain: 'example.com',
          source_command: 'crawl',
        },
      },
    ]);

    const result = await executeQuery(container, {
      query: 'claude subagents',
      limit: 1,
    });

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0].url).toBe('https://example.com/subagents');
  });

  it('should reject negative limit values', async () => {
    const result = await executeQuery(container, {
      query: 'test',
      limit: -5,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Limit must be a positive integer');
    expect(result.error).toContain('-5');
  });

  it('should reject zero limit values', async () => {
    const result = await executeQuery(container, {
      query: 'test',
      limit: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Limit must be a positive integer');
    expect(result.error).toContain('0');
  });

  it('should reject NaN limit values', async () => {
    const result = await executeQuery(container, {
      query: 'test',
      limit: Number.NaN,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Limit must be a positive integer');
  });

  it('should reject non-integer limit values', async () => {
    const result = await executeQuery(container, {
      query: 'test',
      limit: 3.5,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Limit must be a positive integer');
    expect(result.error).toContain('3.5');
  });

  it('should reject Infinity limit values', async () => {
    const result = await executeQuery(container, {
      query: 'test',
      limit: Number.POSITIVE_INFINITY,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Limit must be a positive integer');
  });
});

describe('getMeaningfulSnippet', () => {
  it('returns multiple relevant sentences and skips nav/link noise', () => {
    const text = `
*   ![@claude](https://github.com/claude)
Prev
Next
Claude Code helps developers work directly in their codebase from the terminal.
It can read files, run commands, and propose focused edits with context.
Teams use it to reduce debugging time and speed up iteration cycles.
Developer docs
`;

    const snippet = getMeaningfulSnippet(text);

    expect(snippet).toContain('Claude Code helps developers');
    expect(snippet).toContain('run commands');
    expect(snippet).toContain('speed up iteration cycles');
    expect(snippet).not.toContain('[@claude]');
    expect(snippet).not.toContain('Prev');
    expect(snippet).not.toContain('Next');
  });

  it('caps snippet to at most five sentences', () => {
    const text = `
Sentence one explains what the plugin system is and why it matters for extension workflows.
Sentence two describes how agent teams coordinate work across specialized tasks.
Sentence three covers how subagents are configured and invoked in practice.
Sentence four explains best practices for safe command execution and review.
Sentence five discusses debugging signals and operational visibility.
Sentence six should not appear in the final snippet output.
`;

    const snippet = getMeaningfulSnippet(text);
    const sentenceCount = (snippet.match(/[.!?](\s|$)/g) || []).length;

    expect(sentenceCount).toBeLessThanOrEqual(5);
    expect(snippet).not.toContain('Sentence six');
  });

  it('prioritizes sentences matching query terms', () => {
    const text = `
This section introduces the broader platform and product background.
The plugins reference explains how to configure plugin manifests and capabilities.
It also details plugin hooks, command wiring, and lifecycle behavior.
Additional examples cover agent teams and subagent handoff patterns.
`;

    const snippet = getMeaningfulSnippet(text, 'plugin hooks lifecycle');

    expect(snippet).toContain('plugin hooks');
    expect(snippet).toContain('lifecycle behavior');
  });

  it('returns rich multi-sentence text instead of heading-only chunk', () => {
    const shortHeadingChunk = 'Work with subagents';
    const richChunk = `
Subagents let you delegate focused tasks to specialized agents in your session.
You can configure custom subagents for areas like testing, refactoring, or documentation.
When a task starts, the subagent runs independently and reports back concise results.
Use this to keep the main context clean while still exploring complex work.
`;

    const headingSnippet = getMeaningfulSnippet(
      shortHeadingChunk,
      'claude subagents'
    );
    const richSnippet = getMeaningfulSnippet(richChunk, 'claude subagents');

    expect(richSnippet.split(/[.!?]\s+/).length).toBeGreaterThan(2);
    expect(richSnippet.length).toBeGreaterThan(headingSnippet.length);
    expect(richSnippet).toContain('delegate focused tasks');
  });
});

describe('selectBestPreviewItem', () => {
  it('chooses richer relevant chunk over short heading-only chunk', () => {
    const candidates = [
      {
        score: 0.9,
        url: 'https://example.com/docs',
        title: 'Docs',
        chunkHeader: null,
        chunkText: 'Work with subagents',
        chunkIndex: 1,
        totalChunks: 3,
        domain: 'example.com',
        sourceCommand: 'crawl',
      },
      {
        score: 0.82,
        url: 'https://example.com/docs',
        title: 'Docs',
        chunkHeader: null,
        chunkText:
          'Subagents let you delegate focused tasks to specialized agents in your session. You can configure custom subagents for testing and refactoring. They report results back so your main context stays clean.',
        chunkIndex: 2,
        totalChunks: 3,
        domain: 'example.com',
        sourceCommand: 'crawl',
      },
    ];

    const selection = selectBestPreviewItem(candidates, 'claude subagents');
    expect(selection.selected.chunkIndex).toBe(2);
    expect(selection.candidates).toHaveLength(2);
    expect(selection.selectedPreviewScore).toBeGreaterThan(0);
  });

  it('throws error when candidates array is empty', () => {
    expect(() => selectBestPreviewItem([], 'test query')).toThrow(
      'Cannot select preview item from empty candidates list'
    );
  });
});
