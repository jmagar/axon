/**
 * Tests for info command
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeInfo } from '../../commands/info';
import type { IContainer, IQdrantService } from '../../container/types';
import { setupTest, teardownTest } from '../utils/mock-client';
import { createTestContainer } from '../utils/test-container';

describe('executeInfo', () => {
  let container: IContainer;
  let mockQdrantService: IQdrantService;

  beforeEach(() => {
    setupTest();

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
    teardownTest();
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
          text: 'This is the first chunk of content',
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
          text: 'This is the second chunk with more details about the topic',
        },
      },
    ];

    vi.mocked(mockQdrantService.scrollByUrl).mockResolvedValue(mockPoints);

    const result = await executeInfo(
      {
        url: testUrl,
        collection: 'test_col',
      },
      container
    );

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

    const result = await executeInfo(
      {
        url: testUrl,
        collection: 'test_col',
      },
      container
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('No data found');
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
          text: longText,
        },
      },
    ];

    vi.mocked(mockQdrantService.scrollByUrl).mockResolvedValue(mockPoints);

    const result = await executeInfo(
      {
        url: testUrl,
        collection: 'test_col',
        full: false,
      },
      container
    );

    expect(result.success).toBe(true);
    expect(result.data?.chunks[0].textPreview.length).toBeLessThanOrEqual(103); // 100 + "..."
    expect(result.data?.chunks[0].textPreview).toContain('...');
  });
});
