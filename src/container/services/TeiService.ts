/**
 * TEI (Text Embeddings Inference) Service
 * Handles batched embedding generation with concurrency control
 */

import { fmt } from '../../utils/theme';
import type { IHttpClient, ITeiService, TeiInfo } from '../types';

/** Batch size for embedding requests */
const BATCH_SIZE = 24;

/** Maximum concurrent batch requests */
const MAX_CONCURRENT = 4;

/** HTTP timeout for TEI requests (30 seconds) */
const TEI_TIMEOUT_MS = 30000;

/** Number of retries for TEI requests */
const TEI_MAX_RETRIES = 3;

/**
 * Calculate dynamic timeout based on batch size
 *
 * Formula: BASE + (size × PER_TEXT) × BUFFER
 * - BASE: 10s for overhead (network, tokenization)
 * - PER_TEXT: 2s empirical average per text
 * - BUFFER: 1.5x (50% safety margin)
 *
 * Examples:
 * - 3 texts: (10 + 3×2) × 1.5 = 24s
 * - 24 texts: (10 + 24×2) × 1.5 = 87s
 *
 * @param batchSize Number of texts in batch
 * @returns Timeout in milliseconds
 */
function calculateBatchTimeout(batchSize: number): number {
  const BASE_TIMEOUT_MS = 10000;
  const PER_TEXT_MS = 2000;
  const BUFFER_MULTIPLIER = 1.5;

  return Math.ceil(
    (BASE_TIMEOUT_MS + batchSize * PER_TEXT_MS) * BUFFER_MULTIPLIER
  );
}

/**
 * Simple semaphore for concurrency control
 */
class Semaphore {
  private current = 0;
  private queue: (() => void)[] = [];

  constructor(private max: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.current++;
        resolve();
      });
    });
  }

  release(): void {
    this.current--;
    const next = this.queue.shift();
    if (next) next();
  }
}

/**
 * TeiService implementation
 * Provides TEI embedding generation with instance-level caching
 */
export class TeiService implements ITeiService {
  private cachedInfo: TeiInfo | null = null;

  constructor(
    private readonly teiUrl: string,
    private readonly httpClient: IHttpClient
  ) {}

  /**
   * Get TEI server info (cached after first call)
   * Fetches model metadata including dimension and max input length
   */
  async getTeiInfo(): Promise<TeiInfo> {
    if (this.cachedInfo) {
      return this.cachedInfo;
    }

    const response = await this.httpClient.fetchWithRetry(
      `${this.teiUrl}/info`,
      undefined,
      {
        timeoutMs: TEI_TIMEOUT_MS,
        maxRetries: TEI_MAX_RETRIES,
      }
    );

    if (!response.ok) {
      throw new Error(
        `TEI /info failed: ${response.status} ${response.statusText}`
      );
    }

    const info = await response.json();

    // Extract dimension from model_type.embedding.dim
    const dimension =
      info.model_type?.embedding?.dim ??
      info.model_type?.Embedding?.dim ??
      1024;

    this.cachedInfo = {
      modelId: info.model_id || 'unknown',
      dimension,
      maxInput: info.max_input_length || 32768,
    };

    return this.cachedInfo;
  }

  /**
   * Embed a single batch of texts
   * @param inputs Array of text strings to embed (up to BATCH_SIZE)
   * @returns Array of embedding vectors
   */
  async embedBatch(inputs: string[]): Promise<number[][]> {
    const timeoutMs = calculateBatchTimeout(inputs.length);

    // Log timeout for debugging (dim color, won't clutter normal output)
    console.error(
      fmt.dim(
        `[TEI] Embedding ${inputs.length} texts (timeout: ${timeoutMs}ms)`
      )
    );

    const response = await this.httpClient.fetchWithRetry(
      `${this.teiUrl}/embed`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs }),
      },
      {
        timeoutMs,
        maxRetries: TEI_MAX_RETRIES,
      }
    );

    if (!response.ok) {
      throw new Error(
        `TEI /embed failed: ${response.status} ${response.statusText}`
      );
    }

    return response.json();
  }

  /**
   * Embed multiple chunks with automatic batching and concurrency control
   *
   * Features:
   * - Splits into batches of 24 texts
   * - Runs up to 4 batches concurrently
   * - Maintains order of results
   *
   * @param texts Array of text strings to embed
   * @returns Array of embedding vectors in same order as input
   */
  async embedChunks(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    // Split into batches
    const batches: string[][] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      batches.push(texts.slice(i, i + BATCH_SIZE));
    }

    const semaphore = new Semaphore(MAX_CONCURRENT);
    const results: number[][][] = new Array(batches.length);

    const promises = batches.map(async (batch, i) => {
      await semaphore.acquire();
      try {
        results[i] = await this.embedBatch(batch);
      } finally {
        semaphore.release();
      }
    });

    await Promise.all(promises);

    // Flatten batched results in order
    return results.flat();
  }
}
