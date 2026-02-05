/**
 * TeiService tests
 * Verifies TEI embedding generation with batching and concurrency control
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeiService } from '../../../container/services/TeiService';
import type { IHttpClient } from '../../../container/types';

describe('TeiService', () => {
  let service: TeiService;
  let mockHttpClient: IHttpClient;
  const teiUrl = 'http://localhost:53010';

  beforeEach(() => {
    mockHttpClient = {
      fetchWithRetry: vi.fn(),
      fetchWithTimeout: vi.fn(),
    };
    service = new TeiService(teiUrl, mockHttpClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getTeiInfo', () => {
    it('should return TEI server info', async () => {
      vi.mocked(mockHttpClient.fetchWithRetry).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            model_id: 'BAAI/bge-base-en-v1.5',
            model_type: {
              embedding: {
                dim: 768,
              },
            },
            max_input_length: 512,
          }),
      } as Response);

      const info = await service.getTeiInfo();

      expect(info.modelId).toBe('BAAI/bge-base-en-v1.5');
      expect(info.dimension).toBe(768);
      expect(info.maxInput).toBe(512);
      expect(mockHttpClient.fetchWithRetry).toHaveBeenCalledWith(
        `${teiUrl}/info`,
        undefined,
        expect.objectContaining({
          timeoutMs: 30000,
          maxRetries: 3,
        })
      );
    });

    it('should cache TEI info after first call', async () => {
      vi.mocked(mockHttpClient.fetchWithRetry).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            model_id: 'test-model',
            model_type: { embedding: { dim: 1024 } },
            max_input_length: 32768,
          }),
      } as Response);

      const info1 = await service.getTeiInfo();
      const info2 = await service.getTeiInfo();

      expect(info1).toEqual(info2);
      expect(mockHttpClient.fetchWithRetry).toHaveBeenCalledTimes(1);
    });

    it('should handle Embedding (capitalized) model type', async () => {
      vi.mocked(mockHttpClient.fetchWithRetry).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            model_id: 'test-model',
            model_type: { Embedding: { dim: 384 } },
            max_input_length: 256,
          }),
      } as Response);

      const info = await service.getTeiInfo();

      expect(info.dimension).toBe(384);
    });

    it('should use defaults when model_type is missing', async () => {
      vi.mocked(mockHttpClient.fetchWithRetry).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            model_id: 'unknown-model',
          }),
      } as Response);

      const info = await service.getTeiInfo();

      expect(info.modelId).toBe('unknown-model');
      expect(info.dimension).toBe(1024); // Default
      expect(info.maxInput).toBe(32768); // Default
    });

    it('should throw on non-ok response', async () => {
      vi.mocked(mockHttpClient.fetchWithRetry).mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      } as Response);

      await expect(service.getTeiInfo()).rejects.toThrow(
        'TEI /info failed: 503 Service Unavailable'
      );
    });
  });

  describe('embedBatch', () => {
    it('should embed a batch of texts', async () => {
      const mockEmbeddings = [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ];
      vi.mocked(mockHttpClient.fetchWithRetry).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockEmbeddings),
      } as Response);

      const inputs = ['text 1', 'text 2'];
      const result = await service.embedBatch(inputs);

      expect(result).toEqual(mockEmbeddings);
      expect(mockHttpClient.fetchWithRetry).toHaveBeenCalledWith(
        `${teiUrl}/embed`,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ inputs }),
        }),
        expect.objectContaining({
          timeoutMs: 30000,
          maxRetries: 3,
        })
      );
    });

    it('should throw on non-ok response', async () => {
      vi.mocked(mockHttpClient.fetchWithRetry).mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      } as Response);

      await expect(service.embedBatch(['test'])).rejects.toThrow(
        'TEI /embed failed: 400 Bad Request'
      );
    });
  });

  describe('embedChunks', () => {
    it('should return empty array for empty input', async () => {
      const result = await service.embedChunks([]);

      expect(result).toEqual([]);
      expect(mockHttpClient.fetchWithRetry).not.toHaveBeenCalled();
    });

    it('should embed single batch without splitting', async () => {
      const mockEmbeddings = [
        [0.1, 0.2],
        [0.3, 0.4],
        [0.5, 0.6],
      ];
      vi.mocked(mockHttpClient.fetchWithRetry).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockEmbeddings),
      } as Response);

      const texts = ['chunk 1', 'chunk 2', 'chunk 3'];
      const result = await service.embedChunks(texts);

      expect(result).toEqual(mockEmbeddings);
      expect(mockHttpClient.fetchWithRetry).toHaveBeenCalledTimes(1);
    });

    it('should split large inputs into batches of 24', async () => {
      // Create 50 texts to test batching (should split into 3 batches: 24, 24, 2)
      const texts = Array.from({ length: 50 }, (_, i) => `chunk ${i}`);

      vi.mocked(mockHttpClient.fetchWithRetry).mockImplementation(
        (_url, init) => {
          const body = JSON.parse((init as RequestInit).body as string);
          const batchSize = body.inputs.length;
          const embeddings = Array.from({ length: batchSize }, () => [
            0.1, 0.2,
          ]);
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(embeddings),
          } as Response);
        }
      );

      const result = await service.embedChunks(texts);

      expect(result).toHaveLength(50);
      expect(mockHttpClient.fetchWithRetry).toHaveBeenCalledTimes(3);
    });

    it('should maintain order of results across batches', async () => {
      // Create 30 texts to test ordering
      const texts = Array.from({ length: 30 }, (_, i) => `chunk ${i}`);

      let callCount = 0;
      vi.mocked(mockHttpClient.fetchWithRetry).mockImplementation(
        (_url, init) => {
          callCount++;
          const body = JSON.parse((init as RequestInit).body as string);
          // Return embeddings with batch identifier
          const embeddings = body.inputs.map((_: string, i: number) => [
            callCount,
            i,
          ]);
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(embeddings),
          } as Response);
        }
      );

      const result = await service.embedChunks(texts);

      expect(result).toHaveLength(30);
      // First 24 should be from batch 1
      expect(result[0]).toEqual([1, 0]);
      expect(result[23]).toEqual([1, 23]);
      // Next 6 should be from batch 2
      expect(result[24]).toEqual([2, 0]);
      expect(result[29]).toEqual([2, 5]);
    });

    it('should respect concurrency limit of 4', async () => {
      // Create 100 texts (5 batches of 24, need concurrency control)
      const texts = Array.from({ length: 100 }, (_, i) => `chunk ${i}`);

      let concurrentCalls = 0;
      let maxConcurrent = 0;

      vi.mocked(mockHttpClient.fetchWithRetry).mockImplementation(
        async (_url, init) => {
          concurrentCalls++;
          maxConcurrent = Math.max(maxConcurrent, concurrentCalls);

          // Simulate some processing time
          await new Promise((resolve) => setTimeout(resolve, 10));

          concurrentCalls--;

          const body = JSON.parse((init as RequestInit).body as string);
          const embeddings = body.inputs.map(() => [0.1]);
          return {
            ok: true,
            json: () => Promise.resolve(embeddings),
          } as Response;
        }
      );

      await service.embedChunks(texts);

      // Should never exceed 4 concurrent requests
      expect(maxConcurrent).toBeLessThanOrEqual(4);
    });

    it('should propagate errors from embedBatch', async () => {
      vi.mocked(mockHttpClient.fetchWithRetry).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response);

      await expect(service.embedChunks(['test'])).rejects.toThrow(
        'TEI /embed failed: 500 Internal Server Error'
      );
    });
  });
});
