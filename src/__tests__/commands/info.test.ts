/**
 * Tests for info command
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeInfo } from '../../commands/info';
import type { IContainer, IQdrantService } from '../../container/types';
import { createTestContainer } from '../utils/test-container';

describe('executeInfo', () => {
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
      scrollAll: vi.fn(),
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

  it('should return detailed info for a URL with chunks', async () => {
    const testUrl = 'https://example.com/page';
    const mockPoints = [
      {
        id: '1',
        vector: [],
        payload: {
          url: testUrl,
          domain: 'example.com',
          title: 'Test Page',
          source_command: 'scrape',
          content_type: 'text/html',
          scraped_at: '2026-02-03T12:00:00Z',
          chunk_index: 0,
          chunk_header: 'Introduction',
          chunk_text: 'This is the first chunk of content',
        },
      },
      {
        id: '2',
        vector: [],
        payload: {
          url: testUrl,
          domain: 'example.com',
          title: 'Test Page',
          source_command: 'scrape',
          content_type: 'text/html',
          scraped_at: '2026-02-03T12:00:00Z',
          chunk_index: 1,
          chunk_header: 'Main Content',
          chunk_text:
            'This is the second chunk with more details about the topic',
        },
      },
    ];

    vi.mocked(mockQdrantService.scrollByUrl).mockResolvedValue(mockPoints);

    const result = await executeInfo(container, {
      url: testUrl,
      collection: 'test_col',
    });

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.url).toBe(testUrl);
    expect(result.data?.domain).toBe('example.com');
    expect(result.data?.title).toBe('Test Page');
    expect(result.data?.totalChunks).toBe(2);
    expect(result.data?.sourceCommand).toBe('scrape');
    expect(result.data?.contentType).toBe('text/html');
    expect(result.data?.chunks).toHaveLength(2);
    expect(result.data?.chunks[0].index).toBe(0);
    expect(result.data?.chunks[0].header).toBe('Introduction');
    expect(result.data?.chunks[0].textPreview).toBe(
      'This is the first chunk of content'
    );
    expect(mockQdrantService.scrollByUrl).toHaveBeenCalledWith(
      'test_col',
      testUrl
    );
  });

  it('should return error when URL not found', async () => {
    const testUrl = 'https://example.com/notfound';
    vi.mocked(mockQdrantService.scrollByUrl).mockResolvedValue([]);

    const result = await executeInfo(container, {
      url: testUrl,
      collection: 'test_col',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('URL not found in vector database');
    expect(mockQdrantService.scrollByUrl).toHaveBeenCalledWith(
      'test_col',
      testUrl
    );
  });

  it('should truncate text preview to 100 chars by default', async () => {
    const testUrl = 'https://example.com/long';
    const longText = 'a'.repeat(200);
    const mockPoints = [
      {
        id: '1',
        vector: [],
        payload: {
          url: testUrl,
          domain: 'example.com',
          title: 'Long Page',
          source_command: 'scrape',
          content_type: 'text/html',
          scraped_at: '2026-02-03T12:00:00Z',
          chunk_index: 0,
          chunk_header: null,
          chunk_text: longText,
        },
      },
    ];

    vi.mocked(mockQdrantService.scrollByUrl).mockResolvedValue(mockPoints);

    const result = await executeInfo(container, {
      url: testUrl,
      collection: 'test_col',
      full: false,
    });

    expect(result.success).toBe(true);
    expect(result.data?.chunks[0].textPreview.length).toBeLessThanOrEqual(103); // 100 + "..."
    expect(result.data?.chunks[0].textPreview).toContain('...');
  });

  it('should fail when QDRANT_URL not configured', async () => {
    const badContainer = createTestContainer(undefined, {
      qdrantUrl: undefined,
    });

    const result = await executeInfo(badContainer, {
      url: 'https://example.com',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('QDRANT_URL');
  });

  it('should return full text when full option is true', async () => {
    const longText = 'a'.repeat(200); // Text longer than 100 char preview

    vi.mocked(mockQdrantService.scrollByUrl).mockResolvedValue([
      {
        id: 'p1',
        vector: [],
        payload: {
          url: 'https://example.com/docs',
          domain: 'example.com',
          title: 'Documentation',
          total_chunks: 1,
          source_command: 'crawl',
          content_type: 'markdown',
          scraped_at: '2025-01-15T10:00:00Z',
          chunk_index: 0,
          chunk_header: 'Test',
          chunk_text: longText,
        },
      },
    ]);

    const result = await executeInfo(container, {
      url: 'https://example.com/docs',
      full: true,
    });

    expect(result.success).toBe(true);
    expect(result.data?.chunks[0].textPreview).toBe(longText);
    expect(result.data?.chunks[0].textPreview).not.toContain('...');
  });

  it('should sort chunks by index', async () => {
    vi.mocked(mockQdrantService.scrollByUrl).mockResolvedValue([
      {
        id: 'p3',
        vector: [],
        payload: {
          url: 'https://example.com/docs',
          domain: 'example.com',
          title: 'Documentation',
          total_chunks: 3,
          source_command: 'crawl',
          content_type: 'markdown',
          scraped_at: '2025-01-15T10:00:00Z',
          chunk_index: 2,
          chunk_header: 'Third',
          chunk_text: 'Third chunk',
        },
      },
      {
        id: 'p1',
        vector: [],
        payload: {
          url: 'https://example.com/docs',
          domain: 'example.com',
          title: 'Documentation',
          total_chunks: 3,
          source_command: 'crawl',
          content_type: 'markdown',
          scraped_at: '2025-01-15T10:00:00Z',
          chunk_index: 0,
          chunk_header: 'First',
          chunk_text: 'First chunk',
        },
      },
      {
        id: 'p2',
        vector: [],
        payload: {
          url: 'https://example.com/docs',
          domain: 'example.com',
          title: 'Documentation',
          total_chunks: 3,
          source_command: 'crawl',
          content_type: 'markdown',
          scraped_at: '2025-01-15T10:00:00Z',
          chunk_index: 1,
          chunk_header: 'Second',
          chunk_text: 'Second chunk',
        },
      },
    ]);

    const result = await executeInfo(container, {
      url: 'https://example.com/docs',
    });

    expect(result.success).toBe(true);
    expect(result.data?.chunks[0].index).toBe(0);
    expect(result.data?.chunks[1].index).toBe(1);
    expect(result.data?.chunks[2].index).toBe(2);
    expect(result.data?.chunks[0].header).toBe('First');
    expect(result.data?.chunks[1].header).toBe('Second');
    expect(result.data?.chunks[2].header).toBe('Third');
  });

  it('should handle null chunk headers', async () => {
    vi.mocked(mockQdrantService.scrollByUrl).mockResolvedValue([
      {
        id: 'p1',
        vector: [],
        payload: {
          url: 'https://example.com/docs',
          domain: 'example.com',
          title: 'Documentation',
          total_chunks: 1,
          source_command: 'crawl',
          content_type: 'markdown',
          scraped_at: '2025-01-15T10:00:00Z',
          chunk_index: 0,
          chunk_header: null,
          chunk_text: 'Some text without header',
        },
      },
    ]);

    const result = await executeInfo(container, {
      url: 'https://example.com/docs',
    });

    expect(result.success).toBe(true);
    expect(result.data?.chunks[0].header).toBeNull();
  });
});
