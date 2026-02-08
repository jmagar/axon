/**
 * Tests for retrieve command
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeRetrieve } from '../../commands/retrieve';
import type { IContainer, IQdrantService } from '../../container/types';
import { createTestContainer } from '../utils/test-container';

describe('executeRetrieve', () => {
  let container: IContainer;
  let mockQdrantService: IQdrantService;

  beforeEach(() => {
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
      qdrantUrl: 'http://localhost:53333',
      qdrantCollection: 'test_col',
    });

    // Override service method to return our mock
    vi.spyOn(container, 'getQdrantService').mockReturnValue(mockQdrantService);

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should retrieve and reassemble document from Qdrant', async () => {
    vi.mocked(mockQdrantService.scrollByUrl).mockResolvedValue([
      {
        id: '1',
        vector: [],
        payload: {
          chunk_index: 0,
          chunk_text: 'Intro.',
          chunk_header: 'Title',
        },
      },
      {
        id: '2',
        vector: [],
        payload: {
          chunk_index: 1,
          chunk_text: 'Content.',
          chunk_header: 'Section',
        },
      },
    ]);

    const result = await executeRetrieve(container, {
      url: 'https://example.com',
    });

    expect(mockQdrantService.scrollByUrl).toHaveBeenCalledWith(
      'test_col',
      'https://example.com'
    );
    expect(result.success).toBe(true);
    expect(result.data?.totalChunks).toBe(2);
    expect(result.data?.content).toContain('# Title');
    expect(result.data?.content).toContain('# Section');
  });

  it('should return error when no chunks found', async () => {
    vi.mocked(mockQdrantService.scrollByUrl).mockResolvedValue([]);

    const result = await executeRetrieve(container, {
      url: 'https://notfound.com',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No content found');
  });

  it('should fail when QDRANT_URL not configured', async () => {
    const badContainer = createTestContainer(undefined, {
      qdrantUrl: undefined,
    });

    const result = await executeRetrieve(badContainer, {
      url: 'https://example.com',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('QDRANT_URL');
  });
});
