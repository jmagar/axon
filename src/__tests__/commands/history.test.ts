/**
 * History command tests
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeHistory } from '../../commands/history';
import type { IContainer } from '../../container/types';
import type { HistoryOptions } from '../../types/history';

describe('History Command', () => {
  let mockContainer: IContainer;
  let mockScrollAll: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockScrollAll = vi.fn();

    mockContainer = {
      config: {
        qdrantUrl: 'http://localhost:53333',
        qdrantCollection: 'firecrawl_collection',
      },
      getQdrantService: () => ({
        scrollAll: mockScrollAll,
        ensureCollection: vi.fn(),
        upsertPoints: vi.fn(),
        deleteByUrl: vi.fn(),
        queryPoints: vi.fn(),
        scrollByUrl: vi.fn(),
        deleteByDomain: vi.fn(),
        countByDomain: vi.fn(),
        getCollectionInfo: vi.fn(),
        countPoints: vi.fn(),
        countByUrl: vi.fn(),
        deleteAll: vi.fn(),
      }),
    } as unknown as IContainer;
  });

  it('should list history entries sorted by date descending', async () => {
    // Mock data: 3 URLs with different dates
    mockScrollAll.mockResolvedValue([
      {
        id: '1',
        payload: {
          url: 'https://example.com/page1',
          domain: 'example.com',
          source_command: 'scrape',
          total_chunks: 2,
          chunk_index: 0,
          scraped_at: '2026-02-01T10:00:00Z',
        },
      },
      {
        id: '2',
        payload: {
          url: 'https://example.com/page1',
          domain: 'example.com',
          source_command: 'scrape',
          total_chunks: 2,
          chunk_index: 1,
          scraped_at: '2026-02-01T10:00:00Z',
        },
      },
      {
        id: '3',
        payload: {
          url: 'https://example.com/page2',
          domain: 'example.com',
          source_command: 'crawl',
          total_chunks: 1,
          chunk_index: 0,
          scraped_at: '2026-02-03T12:00:00Z',
        },
      },
      {
        id: '4',
        payload: {
          url: 'https://test.com/page3',
          domain: 'test.com',
          source_command: 'embed',
          total_chunks: 1,
          chunk_index: 0,
          scraped_at: '2026-02-02T08:00:00Z',
        },
      },
    ]);

    const options: HistoryOptions = {};
    const result = await executeHistory(mockContainer, options);

    expect(result.success).toBe(true);
    expect(result.data?.entries).toHaveLength(3);

    // Verify sorted by date descending (newest first)
    expect(result.data?.entries[0].date).toBe('2026-02-03T12:00:00Z');
    expect(result.data?.entries[0].url).toBe('https://example.com/page2');
    expect(result.data?.entries[1].date).toBe('2026-02-02T08:00:00Z');
    expect(result.data?.entries[2].date).toBe('2026-02-01T10:00:00Z');

    // Verify date range
    expect(result.data?.dateRange.from).toBe('2026-02-01T10:00:00Z');
    expect(result.data?.dateRange.to).toBe('2026-02-03T12:00:00Z');

    // Verify totalEntries
    expect(result.data?.totalEntries).toBe(3);

    // Verify only first chunk per URL was processed
    expect(mockScrollAll).toHaveBeenCalledWith(
      'firecrawl_collection',
      undefined
    );
  });

  it('should filter history by domain', async () => {
    // Mock returns only filtered results (as Qdrant would do)
    mockScrollAll.mockResolvedValue([
      {
        id: '1',
        payload: {
          url: 'https://example.com/page1',
          domain: 'example.com',
          source_command: 'scrape',
          total_chunks: 1,
          chunk_index: 0,
          scraped_at: '2026-02-01T10:00:00Z',
        },
      },
    ]);

    const options: HistoryOptions = { domain: 'example.com' };
    const result = await executeHistory(mockContainer, options);

    expect(result.success).toBe(true);
    expect(result.data?.entries).toHaveLength(1);
    expect(result.data?.entries[0].domain).toBe('example.com');

    // Verify filter was passed to scrollAll
    expect(mockScrollAll).toHaveBeenCalledWith('firecrawl_collection', {
      domain: 'example.com',
    });
  });

  it('should filter history by source command', async () => {
    // Mock returns only filtered results (as Qdrant would do)
    mockScrollAll.mockResolvedValue([
      {
        id: '1',
        payload: {
          url: 'https://example.com/page1',
          domain: 'example.com',
          source_command: 'scrape',
          total_chunks: 1,
          chunk_index: 0,
          scraped_at: '2026-02-01T10:00:00Z',
        },
      },
    ]);

    const options: HistoryOptions = { source: 'scrape' };
    const result = await executeHistory(mockContainer, options);

    expect(result.success).toBe(true);
    expect(result.data?.entries).toHaveLength(1);
    expect(result.data?.entries[0].sourceCommand).toBe('scrape');

    // Verify filter was passed to scrollAll
    expect(mockScrollAll).toHaveBeenCalledWith('firecrawl_collection', {
      source_command: 'scrape',
    });
  });

  it('should respect limit option', async () => {
    mockScrollAll.mockResolvedValue([
      {
        id: '1',
        payload: {
          url: 'https://example.com/page1',
          domain: 'example.com',
          source_command: 'scrape',
          total_chunks: 1,
          chunk_index: 0,
          scraped_at: '2026-02-01T10:00:00Z',
        },
      },
      {
        id: '2',
        payload: {
          url: 'https://example.com/page2',
          domain: 'example.com',
          source_command: 'crawl',
          total_chunks: 1,
          chunk_index: 0,
          scraped_at: '2026-02-02T12:00:00Z',
        },
      },
      {
        id: '3',
        payload: {
          url: 'https://example.com/page3',
          domain: 'example.com',
          source_command: 'embed',
          total_chunks: 1,
          chunk_index: 0,
          scraped_at: '2026-02-03T14:00:00Z',
        },
      },
    ]);

    const options: HistoryOptions = { limit: 2 };
    const result = await executeHistory(mockContainer, options);

    expect(result.success).toBe(true);
    expect(result.data?.entries).toHaveLength(2);

    // Verify limit was applied AFTER sorting (most recent first)
    expect(result.data?.entries[0].date).toBe('2026-02-03T14:00:00Z');
    expect(result.data?.entries[1].date).toBe('2026-02-02T12:00:00Z');
  });

  it('should fail when QDRANT_URL not configured', async () => {
    const container = {
      config: {},
      getQdrantService: () => mockContainer.getQdrantService(),
    } as IContainer;

    const options: HistoryOptions = {};
    const result = await executeHistory(container, options);

    expect(result.success).toBe(false);
    expect(result.error).toContain('QDRANT_URL must be set');
  });

  it('should filter by days option', async () => {
    // Mock current time: 2026-02-03T00:00:00Z
    const mockNow = new Date('2026-02-03T00:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(mockNow);

    mockScrollAll.mockResolvedValue([
      {
        id: '1',
        payload: {
          url: 'https://example.com/page1',
          domain: 'example.com',
          source_command: 'scrape',
          total_chunks: 1,
          chunk_index: 0,
          scraped_at: '2026-02-01T10:00:00Z', // 2 days ago
        },
      },
      {
        id: '2',
        payload: {
          url: 'https://example.com/page2',
          domain: 'example.com',
          source_command: 'crawl',
          total_chunks: 1,
          chunk_index: 0,
          scraped_at: '2026-02-03T08:00:00Z', // Today
        },
      },
      {
        id: '3',
        payload: {
          url: 'https://example.com/page3',
          domain: 'example.com',
          source_command: 'embed',
          total_chunks: 1,
          chunk_index: 0,
          scraped_at: '2026-01-20T10:00:00Z', // 14 days ago
        },
      },
    ]);

    const options: HistoryOptions = { days: 7 };
    const result = await executeHistory(mockContainer, options);

    expect(result.success).toBe(true);
    expect(result.data?.entries).toHaveLength(2);

    // Verify only entries within 7 days are included
    expect(result.data?.entries[0].date).toBe('2026-02-03T08:00:00Z');
    expect(result.data?.entries[1].date).toBe('2026-02-01T10:00:00Z');

    vi.useRealTimers();
  });
});
