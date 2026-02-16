/**
 * Tests for domains command
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeDomains, handleDomainsCommand } from '../../commands/domains';
import type { IContainer, IQdrantService } from '../../container/types';
import { writeOutput } from '../../utils/output';
import { createTestContainer } from '../utils/test-container';

vi.mock('../../utils/output', () => ({
  writeOutput: vi.fn(),
}));

describe('executeDomains', () => {
  let container: IContainer;
  let mockQdrantService: IQdrantService;

  beforeEach(() => {
    mockQdrantService = {
      ensureCollection: vi.fn(),
      deleteByUrl: vi.fn(),
      deleteByUrlAndSourceCommand: vi.fn().mockResolvedValue(undefined),
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

describe('handleDomainsCommand output', () => {
  it('should render title, summary, filters, and table with canonical empty state', async () => {
    const mockQdrantService: IQdrantService = {
      ensureCollection: vi.fn(),
      deleteByUrl: vi.fn(),
      deleteByUrlAndSourceCommand: vi.fn().mockResolvedValue(undefined),
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

    const container = createTestContainer(undefined, {
      qdrantUrl: 'http://localhost:53333',
      qdrantCollection: 'test_col',
    });
    vi.spyOn(container, 'getQdrantService').mockReturnValue(mockQdrantService);

    await handleDomainsCommand(container, { collection: 'test_col', limit: 5 });

    const output = vi.mocked(writeOutput).mock.calls.at(-1)?.[0] as string;
    expect(output).toContain('Domains');
    expect(output).toContain('Showing 0 of 0 domains');
    expect(output).toContain('Filters: collection=test_col, limit=5');
    expect(output).toContain('No results found.');
    expect(output).not.toContain('Last Updated');
    expect(output).not.toContain('—');
  });
});
