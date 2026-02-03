import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  countByDomain,
  deleteByDomain,
  deleteByUrl,
  ensureCollection,
  queryPoints,
  resetQdrantCache,
  scrollByUrl,
  upsertPoints,
} from '../../utils/qdrant';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Qdrant client', () => {
  const qdrantUrl = 'http://localhost:53333';
  const collection = 'test_collection';

  beforeEach(() => {
    vi.clearAllMocks();
    resetQdrantCache();
  });

  afterEach(() => {
    vi.clearAllMocks();
    resetQdrantCache();
  });

  describe('ensureCollection', () => {
    it('should not create collection if it already exists', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { status: 'green' } }),
      });

      await ensureCollection(qdrantUrl, collection, 1024);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      // Note: fetchWithRetry adds signal for timeout, so check URL separately
      expect(mockFetch.mock.calls[0][0]).toBe(
        `${qdrantUrl}/collections/${collection}`
      );
    });

    it('should create collection and indexes if it does not exist', async () => {
      // GET collection returns 404
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });
      // PUT create collection
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: true }),
      });
      // PUT index on url
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: true }),
      });
      // PUT index on domain
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: true }),
      });
      // PUT index on source_command
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: true }),
      });

      await ensureCollection(qdrantUrl, collection, 1024);

      // 1 GET + 1 PUT create + 3 PUT indexes = 5 calls
      expect(mockFetch).toHaveBeenCalledTimes(5);
    });

    it('should throw on non-404 errors when checking collection', async () => {
      // Use 403 (not retryable) to avoid retry delays in tests
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      });

      await expect(
        ensureCollection(qdrantUrl, collection, 1024)
      ).rejects.toThrow('Failed to check Qdrant collection');

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should cache collection existence after first check', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { status: 'green' } }),
      });

      await ensureCollection(qdrantUrl, collection, 1024);
      await ensureCollection(qdrantUrl, collection, 1024);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('upsertPoints', () => {
    it('should PUT points to the collection', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { status: 'completed' } }),
      });

      const points = [
        {
          id: 'test-uuid',
          vector: [0.1, 0.2, 0.3],
          payload: { url: 'https://example.com', chunk_text: 'hello' },
        },
      ];

      await upsertPoints(qdrantUrl, collection, points);

      expect(mockFetch).toHaveBeenCalledWith(
        `${qdrantUrl}/collections/${collection}/points`,
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ points }),
        })
      );
    });
  });

  describe('deleteByUrl', () => {
    it('should POST delete with url filter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { status: 'completed' } }),
      });

      await deleteByUrl(qdrantUrl, collection, 'https://example.com');

      expect(mockFetch).toHaveBeenCalledWith(
        `${qdrantUrl}/collections/${collection}/points/delete`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            filter: {
              must: [
                {
                  key: 'url',
                  match: { value: 'https://example.com' },
                },
              ],
            },
          }),
        })
      );
    });
  });

  describe('queryPoints', () => {
    it('should POST query with vector and return results', async () => {
      const mockResults = {
        result: {
          points: [
            {
              id: 'uuid-1',
              score: 0.92,
              payload: { url: 'https://example.com', chunk_text: 'hello' },
            },
          ],
        },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResults,
      });

      const results = await queryPoints(qdrantUrl, collection, [0.1, 0.2], {
        limit: 5,
      });

      expect(results).toHaveLength(1);
      expect(results[0].score).toBe(0.92);
    });

    it('should include domain filter when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { points: [] } }),
      });

      await queryPoints(qdrantUrl, collection, [0.1], {
        limit: 5,
        domain: 'example.com',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.filter.must).toContainEqual({
        key: 'domain',
        match: { value: 'example.com' },
      });
    });
  });

  describe('scrollByUrl', () => {
    it('should scroll all chunks for a URL ordered by chunk_index', async () => {
      // First page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            points: [
              { id: '1', payload: { chunk_index: 0, chunk_text: 'first' } },
              { id: '2', payload: { chunk_index: 1, chunk_text: 'second' } },
            ],
            next_page_offset: null,
          },
        }),
      });

      const points = await scrollByUrl(
        qdrantUrl,
        collection,
        'https://example.com'
      );

      expect(points).toHaveLength(2);
      expect(points[0].payload.chunk_index).toBe(0);
      expect(points[1].payload.chunk_index).toBe(1);
    });

    it('should paginate through multiple pages', async () => {
      // First page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            points: [
              { id: '1', payload: { chunk_index: 0, chunk_text: 'first' } },
            ],
            next_page_offset: 'offset-abc',
          },
        }),
      });
      // Second page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            points: [
              { id: '2', payload: { chunk_index: 1, chunk_text: 'second' } },
            ],
            next_page_offset: null,
          },
        }),
      });

      const points = await scrollByUrl(
        qdrantUrl,
        collection,
        'https://example.com'
      );

      expect(points).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('error messages include response body', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      resetQdrantCache();
    });

    it('upsertPoints includes response body in error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () =>
          JSON.stringify({ status: { error: 'invalid vector dimension' } }),
      });

      await expect(
        upsertPoints('http://qdrant', 'collection', [])
      ).rejects.toThrow(/invalid vector dimension/);
    });

    it('deleteByUrl includes response body in error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () =>
          JSON.stringify({ status: { error: 'collection not found' } }),
      });

      await expect(
        deleteByUrl('http://qdrant', 'collection', 'http://test.com')
      ).rejects.toThrow(/collection not found/);
    });

    it('queryPoints includes response body in error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () =>
          JSON.stringify({ status: { error: 'vector dimension mismatch' } }),
      });

      await expect(
        queryPoints('http://qdrant', 'collection', [0.1], { limit: 10 })
      ).rejects.toThrow(/vector dimension mismatch/);
    });

    it('scrollByUrl includes response body in error', async () => {
      // Use 400 (not retryable) to avoid retry delays
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () =>
          JSON.stringify({ status: { error: 'invalid filter syntax' } }),
      });

      await expect(
        scrollByUrl('http://qdrant', 'collection', 'http://test.com')
      ).rejects.toThrow(/invalid filter syntax/);
    });
  });

  describe('deleteByDomain', () => {
    it('should POST delete with domain filter', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

      await deleteByDomain(qdrantUrl, collection, 'docs.firecrawl.dev');

      expect(mockFetch).toHaveBeenCalledWith(
        `${qdrantUrl}/collections/${collection}/points/delete`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            filter: {
              must: [{ key: 'domain', match: { value: 'docs.firecrawl.dev' } }],
            },
          }),
        })
      );
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () =>
          JSON.stringify({ status: { error: 'delete failed' } }),
      });

      await expect(
        deleteByDomain(qdrantUrl, collection, 'example.com')
      ).rejects.toThrow(/delete failed/);
    });
  });

  describe('countByDomain', () => {
    it('should return count of documents matching domain', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { count: 42 } }),
      });

      const count = await countByDomain(
        qdrantUrl,
        collection,
        'docs.firecrawl.dev'
      );

      expect(count).toBe(42);
      expect(mockFetch).toHaveBeenCalledWith(
        `${qdrantUrl}/collections/${collection}/points/count`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            filter: {
              must: [{ key: 'domain', match: { value: 'docs.firecrawl.dev' } }],
            },
            exact: true,
          }),
        })
      );
    });

    it('should return 0 when no documents match', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { count: 0 } }),
      });

      const count = await countByDomain(
        qdrantUrl,
        collection,
        'nonexistent.com'
      );
      expect(count).toBe(0);
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () =>
          JSON.stringify({ status: { error: 'invalid filter' } }),
      });

      await expect(
        countByDomain(qdrantUrl, collection, 'example.com')
      ).rejects.toThrow(/invalid filter/);
    });
  });
});
