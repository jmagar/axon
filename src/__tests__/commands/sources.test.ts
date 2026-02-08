/**
 * Tests for sources command
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeSources } from '../../commands/sources';
import type { IContainer, IQdrantService } from '../../container/types';
import { createTestContainer } from '../utils/test-container';

describe('executeSources', () => {
  let container: IContainer;
  let mockQdrantService: IQdrantService;

  beforeEach(() => {
    mockQdrantService = {
      ensureCollection: vi.fn(),
      deleteByUrl: vi.fn(),
      deleteByDomain: vi.fn(),
      countByDomain: vi.fn(),
      countByUrl: vi.fn().mockResolvedValue(0),
      upsertPoints: vi.fn(),
      queryPoints: vi.fn(),
      scrollByUrl: vi.fn(),
      scrollAll: vi.fn().mockResolvedValue([]),
      getCollectionInfo: vi.fn(),
      countPoints: vi.fn(),
      deleteAll: vi.fn(),
    };

    container = createTestContainer(undefined, {
      qdrantUrl: 'http://localhost:53333',
      qdrantCollection: 'test_col',
    });

    vi.spyOn(container, 'getQdrantService').mockReturnValue(mockQdrantService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should list all sources', async () => {
    vi.mocked(mockQdrantService.scrollAll).mockResolvedValue([
      {
        id: 'p1',
        payload: {
          url: 'https://example.com/docs',
          domain: 'example.com',
          title: 'Docs',
          total_chunks: 5,
          source_command: 'crawl',
          scraped_at: '2025-01-15T10:00:00Z',
          chunk_index: 0,
        },
      },
      {
        id: 'p2',
        payload: {
          url: 'https://example.com/docs',
          domain: 'example.com',
          title: 'Docs',
          total_chunks: 5,
          source_command: 'crawl',
          scraped_at: '2025-01-15T10:00:00Z',
          chunk_index: 1,
        },
      },
      {
        id: 'p3',
        payload: {
          url: 'https://other.com/api',
          domain: 'other.com',
          title: 'API',
          total_chunks: 3,
          source_command: 'scrape',
          scraped_at: '2025-01-14T09:00:00Z',
          chunk_index: 0,
        },
      },
    ]);

    const result = await executeSources(container, {});

    expect(result.success).toBe(true);
    expect(result.data?.sources).toHaveLength(2);
    expect(result.data?.totalSources).toBe(2);
    expect(result.data?.totalChunks).toBe(3);
    expect(result.data?.uniqueDomains).toBe(2);
  });

  it('should filter by domain', async () => {
    vi.mocked(mockQdrantService.scrollAll).mockResolvedValue([]);

    await executeSources(container, { domain: 'example.com' });

    expect(mockQdrantService.scrollAll).toHaveBeenCalledWith('test_col', {
      domain: 'example.com',
    });
  });

  it('should filter by source command', async () => {
    vi.mocked(mockQdrantService.scrollAll).mockResolvedValue([]);

    await executeSources(container, { source: 'crawl' });

    expect(mockQdrantService.scrollAll).toHaveBeenCalledWith('test_col', {
      source_command: 'crawl',
    });
  });

  it('should fail when QDRANT_URL not configured', async () => {
    const badContainer = createTestContainer(undefined, {
      qdrantUrl: undefined,
    });

    const result = await executeSources(badContainer, {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('QDRANT_URL');
  });

  it('should respect limit option', async () => {
    vi.mocked(mockQdrantService.scrollAll).mockResolvedValue([
      {
        id: 'p1',
        payload: { url: 'https://a.com', domain: 'a.com', chunk_index: 0 },
      },
      {
        id: 'p2',
        payload: { url: 'https://b.com', domain: 'b.com', chunk_index: 0 },
      },
      {
        id: 'p3',
        payload: { url: 'https://c.com', domain: 'c.com', chunk_index: 0 },
      },
    ]);

    const result = await executeSources(container, { limit: 2 });

    expect(result.data?.sources).toHaveLength(2);
  });
});
