/**
 * Tests for QdrantService inspection methods
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QdrantService } from '../../container/services/QdrantService';
import type { IHttpClient } from '../../container/types';

describe('QdrantService', () => {
  let service: QdrantService;
  let mockHttpClient: IHttpClient;
  const qdrantUrl = 'http://localhost:53333';

  beforeEach(() => {
    mockHttpClient = {
      fetchWithRetry: vi.fn(),
      fetchWithTimeout: vi.fn(),
    };
    service = new QdrantService(qdrantUrl, mockHttpClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getCollectionInfo', () => {
    it('should return collection info', async () => {
      vi.mocked(mockHttpClient.fetchWithRetry).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            result: {
              status: 'green',
              vectors_count: 1000,
              points_count: 500,
              segments_count: 3,
              config: {
                params: {
                  vectors: {
                    size: 768,
                    distance: 'Cosine',
                  },
                },
              },
            },
          }),
      } as Response);

      const info = await service.getCollectionInfo('test_collection');

      expect(info.status).toBe('green');
      expect(info.vectorsCount).toBe(1000);
      expect(info.pointsCount).toBe(500);
      expect(info.segmentsCount).toBe(3);
      expect(info.config.dimension).toBe(768);
      expect(info.config.distance).toBe('Cosine');
    });

    it('should throw on non-ok response', async () => {
      vi.mocked(mockHttpClient.fetchWithRetry).mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      await expect(service.getCollectionInfo('missing')).rejects.toThrow(
        'Qdrant getCollectionInfo failed: 404'
      );
    });
  });
});
