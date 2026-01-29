import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  embedBatch,
  embedChunks,
  getTeiInfo,
  resetTeiCache,
} from '../../utils/embeddings';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('TEI embeddings client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTeiCache();
  });

  afterEach(() => {
    vi.clearAllMocks();
    resetTeiCache();
  });

  describe('getTeiInfo', () => {
    it('should fetch and return TEI info', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model_id: 'Qwen/Qwen3-Embedding-0.6B',
          model_sha: 'abc123',
          model_dtype: 'float16',
          model_type: { embedding: { dim: 1024 } },
          max_concurrent_requests: 192,
          max_input_length: 32768,
          max_batch_tokens: 16384,
          max_batch_requests: 48,
          max_client_batch_size: 192,
        }),
      });

      const info = await getTeiInfo('http://localhost:52000');
      expect(info.dimension).toBe(1024);
      // Note: fetchWithRetry adds signal for timeout, so check URL separately
      expect(mockFetch).toHaveBeenCalled();
      expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:52000/info');
    });

    it('should cache TEI info after first call', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          model_id: 'test-model',
          model_type: { embedding: { dim: 768 } },
        }),
      });

      await getTeiInfo('http://localhost:52000');
      await getTeiInfo('http://localhost:52000');

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should throw on non-ok response', async () => {
      // Use 400 error (not retryable) to avoid retry delays in tests
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      });

      await expect(getTeiInfo('http://localhost:52000')).rejects.toThrow(
        'TEI /info failed: 400 Bad Request'
      );
    });
  });

  describe('embedBatch', () => {
    it('should call TEI /embed endpoint with inputs', async () => {
      const vectors = [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => vectors,
      });

      const result = await embedBatch('http://localhost:52000', [
        'hello',
        'world',
      ]);
      expect(result).toEqual(vectors);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:52000/embed',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ inputs: ['hello', 'world'] }),
        })
      );
    });

    it('should throw on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 413,
        statusText: 'Payload Too Large',
      });

      await expect(
        embedBatch('http://localhost:52000', ['text'])
      ).rejects.toThrow();
    });
  });

  describe('embedChunks', () => {
    it('should batch chunks into groups of 24 and return all vectors', async () => {
      // 30 chunks should result in 2 batches (24 + 6)
      const chunks = Array.from({ length: 30 }, (_, i) => `chunk ${i}`);
      const makeMockVectors = (n: number) =>
        Array.from({ length: n }, () => [0.1, 0.2]);

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => makeMockVectors(24),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => makeMockVectors(6),
        });

      const result = await embedChunks('http://localhost:52000', chunks);
      expect(result).toHaveLength(30);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should return empty array for empty input', async () => {
      const result = await embedChunks('http://localhost:52000', []);
      expect(result).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should respect concurrency limit', async () => {
      // 100 chunks = 5 batches of 24,24,24,24,4
      // With concurrency 4, first 4 go in parallel, then 1 more
      const chunks = Array.from({ length: 100 }, (_, i) => `chunk ${i}`);
      let concurrent = 0;
      let maxConcurrent = 0;

      mockFetch.mockImplementation(async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 10));
        concurrent--;
        const batchSize = 24; // approximate
        return {
          ok: true,
          json: async () => Array.from({ length: batchSize }, () => [0.1]),
        };
      });

      await embedChunks('http://localhost:52000', chunks);
      expect(maxConcurrent).toBeLessThanOrEqual(4);
    });
  });
});
