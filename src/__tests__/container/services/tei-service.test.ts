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
          // Dynamic timeout for 2 texts: 30 + 2 = 32s
          timeoutMs: 32000,
          maxRetries: 3,
        })
      );
    });

    it('should throw on non-ok response', async () => {
      vi.useFakeTimers();

      // Mock all batch retry attempts to fail
      vi.mocked(mockHttpClient.fetchWithRetry).mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      } as Response);

      const promise = service.embedBatch(['test']);

      // Advance through batch retries (30s each)
      const advanceTimers = async () => {
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(30000); // Retry 1
        await vi.advanceTimersByTimeAsync(30000); // Retry 2
      };

      await Promise.all([
        expect(promise).rejects.toThrow('TEI /embed failed: 400 Bad Request'),
        advanceTimers(),
      ]);

      // Should have tried 3 times (1 initial + 2 batch retries)
      expect(mockHttpClient.fetchWithRetry).toHaveBeenCalledTimes(3);

      vi.useRealTimers();
    }, 70000); // Increase timeout for fake timers
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
      vi.useFakeTimers();

      vi.mocked(mockHttpClient.fetchWithRetry).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response);

      const promise = service.embedChunks(['test']);

      // Advance through batch retries
      const advanceTimers = async () => {
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(30000); // Retry 1
        await vi.advanceTimersByTimeAsync(30000); // Retry 2
      };

      await Promise.all([
        expect(promise).rejects.toThrow(
          'TEI /embed failed: 500 Internal Server Error'
        ),
        advanceTimers(),
      ]);

      vi.useRealTimers();
    }, 70000);
  });

  describe('embedBatch with dynamic timeout', () => {
    it('should use calculated timeout for small batch (3 texts)', async () => {
      let capturedTimeout: number | undefined;
      vi.mocked(mockHttpClient.fetchWithRetry).mockImplementation(
        async (_url, _init, options) => {
          capturedTimeout = options?.timeoutMs;
          return {
            ok: true,
            json: () => Promise.resolve([[0.1, 0.2]]),
          } as Response;
        }
      );

      const texts = Array.from({ length: 3 }, (_, i) => `text ${i}`);
      await service.embedBatch(texts);

      // Formula: 30s + 3 = 33s = 33000ms
      expect(capturedTimeout).toBe(33000);
    });

    it('should use calculated timeout for full batch (24 texts)', async () => {
      let capturedTimeout: number | undefined;
      vi.mocked(mockHttpClient.fetchWithRetry).mockImplementation(
        async (_url, _init, options) => {
          capturedTimeout = options?.timeoutMs;
          return {
            ok: true,
            json: () => Promise.resolve(Array(24).fill([0.1])),
          } as Response;
        }
      );

      const texts = Array.from({ length: 24 }, (_, i) => `text ${i}`);
      await service.embedBatch(texts);

      // Formula: 30s + 24 = 54s = 54000ms
      expect(capturedTimeout).toBe(54000);
    });

    it('should never return timeout less than base for empty batch', async () => {
      let capturedTimeout: number | undefined;
      vi.mocked(mockHttpClient.fetchWithRetry).mockImplementation(
        async (_url, _init, options) => {
          capturedTimeout = options?.timeoutMs;
          return {
            ok: true,
            json: () => Promise.resolve([]),
          } as Response;
        }
      );

      await service.embedBatch([]);

      // Formula: 30s + 0 = 30s = 30000ms
      expect(capturedTimeout).toBeGreaterThanOrEqual(30000);
    });

    it('should not timeout on large batches processed slowly', async () => {
      vi.useFakeTimers();

      vi.mocked(mockHttpClient.fetchWithRetry).mockImplementation(
        async (_url, _init, _options) => {
          // Simulate slow TEI response (60s)
          await new Promise((resolve) => setTimeout(resolve, 60000));
          return {
            ok: true,
            json: () => Promise.resolve(Array(24).fill([0.1])),
          } as Response;
        }
      );

      const texts = Array.from({ length: 24 }, (_, i) => `text ${i}`);
      const promise = service.embedBatch(texts);

      // Fast-forward time to simulate 60s processing
      await vi.advanceTimersByTimeAsync(60000);

      // Should NOT timeout (87s timeout > 60s processing time)
      await expect(promise).resolves.toBeDefined();

      vi.useRealTimers();
    });
  });

  describe('Batch-Level Retry', () => {
    it('should retry batch after all HTTP retries exhausted', async () => {
      vi.useFakeTimers();

      // HTTP retries fail twice, then succeed on 3rd batch attempt
      vi.mocked(mockHttpClient.fetchWithRetry)
        .mockRejectedValueOnce(new Error('All HTTP retries exhausted'))
        .mockRejectedValueOnce(new Error('All HTTP retries exhausted'))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([[0.1]]),
        } as Response);

      const promise = service.embedBatch(['test']);

      // First attempt fails immediately
      await vi.advanceTimersByTimeAsync(0);

      // Wait 30s for batch retry
      await vi.advanceTimersByTimeAsync(30000);

      // Second attempt fails
      await vi.advanceTimersByTimeAsync(30000);

      // Third attempt succeeds
      const result = await promise;

      expect(result).toEqual([[0.1]]);
      expect(mockHttpClient.fetchWithRetry).toHaveBeenCalledTimes(3);

      vi.useRealTimers();
    });

    it('should fail after all batch retries exhausted', async () => {
      vi.useFakeTimers();

      // All attempts fail
      vi.mocked(mockHttpClient.fetchWithRetry).mockRejectedValue(
        new Error('Persistent failure')
      );

      const promise = service.embedBatch(['test']);

      // Advance through batch retries
      const advanceTimers = async () => {
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(30000); // Retry 1
        await vi.advanceTimersByTimeAsync(30000); // Retry 2
      };

      await Promise.all([
        expect(promise).rejects.toThrow('Persistent failure'),
        advanceTimers(),
      ]);

      // 1 initial + 2 batch retries = 3 total attempts
      expect(mockHttpClient.fetchWithRetry).toHaveBeenCalledTimes(3);

      vi.useRealTimers();
    }, 70000);

    it('should log batch retry attempts', async () => {
      vi.useFakeTimers();
      const consoleSpy = vi.spyOn(console, 'error');

      vi.mocked(mockHttpClient.fetchWithRetry)
        .mockRejectedValueOnce(new Error('Fail'))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([[0.1]]),
        } as Response);

      const promise = service.embedBatch(['test']);

      // Advance through first retry
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(30000);

      await promise;

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Batch retry 1\/2/)
      );

      consoleSpy.mockRestore();
      vi.useRealTimers();
    }, 70000);
  });
});
