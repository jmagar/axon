/**
 * Tests for stats command
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeStats } from '../../commands/stats';
import type { IContainer, IQdrantService } from '../../container/types';
import { createTestContainer } from '../utils/test-container';

describe('executeStats', () => {
  let container: IContainer;
  let mockQdrantService: IQdrantService;

  beforeEach(() => {
    mockQdrantService = {
      ensureCollection: vi.fn(),
      deleteByUrl: vi.fn(),
      deleteByDomain: vi.fn(),
      countByDomain: vi.fn(),
      countByUrl: vi.fn(),
      upsertPoints: vi.fn(),
      queryPoints: vi.fn(),
      scrollByUrl: vi.fn(),
      scrollAll: vi.fn().mockResolvedValue([]),
      getCollectionInfo: vi.fn().mockResolvedValue({
        status: 'green',
        vectorsCount: 1000,
        pointsCount: 500,
        segmentsCount: 3,
        config: { dimension: 768, distance: 'Cosine' },
      }),
      countPoints: vi.fn().mockResolvedValue(1000),
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

  it('should return collection stats', async () => {
    vi.mocked(mockQdrantService.scrollAll).mockResolvedValue([
      {
        id: 'p1',
        payload: {
          domain: 'example.com',
          source_command: 'crawl',
          url: 'https://a.com',
        },
      },
      {
        id: 'p2',
        payload: {
          domain: 'example.com',
          source_command: 'crawl',
          url: 'https://a.com',
        },
      },
      {
        id: 'p3',
        payload: {
          domain: 'other.com',
          source_command: 'scrape',
          url: 'https://b.com',
        },
      },
    ]);

    const result = await executeStats(container, {});

    expect(result.success).toBe(true);
    expect(result.data?.collection).toBe('test_col');
    expect(result.data?.status).toBe('green');
    expect(result.data?.dimension).toBe(768);
    expect(result.data?.byDomain).toHaveLength(2);
    expect(result.data?.bySourceCommand).toHaveLength(2);
  });

  it('should fail when QDRANT_URL not configured', async () => {
    const badContainer = createTestContainer(undefined, {
      qdrantUrl: undefined,
    });

    const result = await executeStats(badContainer, {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('QDRANT_URL');
  });

  it('should aggregate by domain correctly', async () => {
    vi.mocked(mockQdrantService.scrollAll).mockResolvedValue([
      {
        id: 'p1',
        payload: {
          domain: 'a.com',
          source_command: 'crawl',
          url: 'https://a.com/1',
        },
      },
      {
        id: 'p2',
        payload: {
          domain: 'a.com',
          source_command: 'crawl',
          url: 'https://a.com/2',
        },
      },
      {
        id: 'p3',
        payload: {
          domain: 'b.com',
          source_command: 'scrape',
          url: 'https://b.com/1',
        },
      },
    ]);

    const result = await executeStats(container, {});

    const aDomain = result.data?.byDomain.find((d) => d.domain === 'a.com');
    expect(aDomain?.vectorCount).toBe(2);
    expect(aDomain?.sourceCount).toBe(2);
  });
});
