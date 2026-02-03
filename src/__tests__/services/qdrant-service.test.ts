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

  describe('scrollAll', () => {
    it('should scroll all points without filter', async () => {
      vi.mocked(mockHttpClient.fetchWithRetry).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            result: {
              points: [
                { id: 'p1', payload: { url: 'https://a.com' } },
                { id: 'p2', payload: { url: 'https://b.com' } },
              ],
              next_page_offset: null,
            },
          }),
      } as Response);

      const points = await service.scrollAll('test_collection');

      expect(points).toHaveLength(2);
      expect(points[0].payload.url).toBe('https://a.com');
    });

    it('should scroll with filter', async () => {
      vi.mocked(mockHttpClient.fetchWithRetry).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            result: {
              points: [{ id: 'p1', payload: { domain: 'example.com' } }],
              next_page_offset: null,
            },
          }),
      } as Response);

      await service.scrollAll('test_collection', { domain: 'example.com' });

      expect(mockHttpClient.fetchWithRetry).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"domain"'),
        }),
        expect.any(Object)
      );
    });

    it('should paginate through multiple pages', async () => {
      vi.mocked(mockHttpClient.fetchWithRetry)
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              result: {
                points: [{ id: 'p1', payload: {} }],
                next_page_offset: 'offset1',
              },
            }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              result: {
                points: [{ id: 'p2', payload: {} }],
                next_page_offset: null,
              },
            }),
        } as Response);

      const points = await service.scrollAll('test_collection');

      expect(points).toHaveLength(2);
      expect(mockHttpClient.fetchWithRetry).toHaveBeenCalledTimes(2);
    });

    it('should throw on non-ok response', async () => {
      vi.mocked(mockHttpClient.fetchWithRetry).mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      await expect(service.scrollAll('test_collection')).rejects.toThrow(
        'Qdrant scroll failed: 500'
      );
    });
  });

  describe('countPoints', () => {
    it('should return total point count', async () => {
      vi.mocked(mockHttpClient.fetchWithRetry).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: { count: 1234 } }),
      } as Response);

      const count = await service.countPoints('test_collection');

      expect(count).toBe(1234);
    });

    it('should throw on non-ok response', async () => {
      vi.mocked(mockHttpClient.fetchWithRetry).mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      await expect(service.countPoints('test_collection')).rejects.toThrow(
        'Qdrant count failed: 500'
      );
    });
  });

  describe('countByUrl', () => {
    it('should return point count for URL', async () => {
      vi.mocked(mockHttpClient.fetchWithRetry).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: { count: 42 } }),
      } as Response);

      const count = await service.countByUrl(
        'test_collection',
        'https://example.com'
      );

      expect(count).toBe(42);
      expect(mockHttpClient.fetchWithRetry).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('https://example.com'),
        }),
        expect.any(Object)
      );
    });

    it('should throw on non-ok response', async () => {
      vi.mocked(mockHttpClient.fetchWithRetry).mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      await expect(
        service.countByUrl('test_collection', 'https://example.com')
      ).rejects.toThrow('Qdrant count failed: 404');
    });
  });

  describe('deleteAll', () => {
    it('should delete all points in collection', async () => {
      vi.mocked(mockHttpClient.fetchWithRetry).mockResolvedValue({
        ok: true,
      } as Response);

      await service.deleteAll('test_collection');

      expect(mockHttpClient.fetchWithRetry).toHaveBeenCalledWith(
        expect.stringContaining('/points/delete'),
        expect.objectContaining({
          method: 'POST',
        }),
        expect.any(Object)
      );
    });

    it('should throw on non-ok response', async () => {
      vi.mocked(mockHttpClient.fetchWithRetry).mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      await expect(service.deleteAll('test_collection')).rejects.toThrow(
        'Qdrant delete failed: 500'
      );
    });
  });
});
