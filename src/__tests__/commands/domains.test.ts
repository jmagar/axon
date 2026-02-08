/**
 * Tests for domains command
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeDomains } from '../../commands/domains';
import type { IContainer, IQdrantService } from '../../container/types';
import { createTestContainer } from '../utils/test-container';

describe('executeDomains', () => {
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

  it('should list domains with aggregates', async () => {
    vi.mocked(mockQdrantService.scrollAll).mockResolvedValue([
      {
        id: 'p1',
        payload: {
          domain: 'a.com',
          url: 'https://a.com/1',
          scraped_at: '2025-01-15T10:00:00Z',
        },
      },
      {
        id: 'p2',
        payload: {
          domain: 'a.com',
          url: 'https://a.com/2',
          scraped_at: '2025-01-16T10:00:00Z',
        },
      },
      {
        id: 'p3',
        payload: {
          domain: 'b.com',
          url: 'https://b.com/1',
          scraped_at: '2025-01-14T10:00:00Z',
        },
      },
    ]);

    const result = await executeDomains(container, {});

    expect(result.success).toBe(true);
    expect(result.data?.domains).toHaveLength(2);
    expect(result.data?.totalDomains).toBe(2);
    expect(result.data?.totalUrls).toBe(3);
    expect(result.data?.totalVectors).toBe(3);

    const aDomain = result.data?.domains.find((d) => d.domain === 'a.com');
    expect(aDomain?.urlCount).toBe(2);
    expect(aDomain?.vectorCount).toBe(2);
  });

  it('should respect limit option', async () => {
    vi.mocked(mockQdrantService.scrollAll).mockResolvedValue([
      { id: 'p1', payload: { domain: 'a.com', url: 'https://a.com/1' } },
      { id: 'p2', payload: { domain: 'b.com', url: 'https://b.com/1' } },
      { id: 'p3', payload: { domain: 'c.com', url: 'https://c.com/1' } },
    ]);

    const result = await executeDomains(container, { limit: 2 });

    expect(result.data?.domains).toHaveLength(2);
  });

  it('should fail when QDRANT_URL not configured', async () => {
    const badContainer = createTestContainer(undefined, {
      qdrantUrl: undefined,
    });

    const result = await executeDomains(badContainer, {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('QDRANT_URL');
  });
});
