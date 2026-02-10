/**
 * Tests for query command
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeQuery } from '../../commands/query';
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
});
