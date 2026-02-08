/**
 * TEI (Text Embeddings Inference) Service
 * Handles batched embedding generation with concurrency control
 */

import { sleep } from '../../utils/http';
import {
  assertTeiOk,
  parseTeiInfo,
  requestTeiEmbeddings,
  runConcurrentBatches,
} from '../../utils/tei-helpers';
import { fmt } from '../../utils/theme';
import type { IHttpClient, ITeiService, TeiInfo } from '../types';

/** Batch size for embedding requests */
const BATCH_SIZE = 24;

/** Maximum concurrent batch requests */
const MAX_CONCURRENT = 4;

/** HTTP timeout for TEI /info endpoint (30 seconds) */
const TEI_INFO_TIMEOUT_MS = 30000;

/** Number of retries for TEI requests */
const TEI_MAX_RETRIES = 3;

/** Number of batch-level retries (in addition to HTTP retries) */
const BATCH_RETRY_ATTEMPTS = 2;

/** Delay before batch retry (30 seconds) */
const BATCH_RETRY_DELAY_MS = 30000;

/**
 * Calculate dynamic timeout based on batch size
 *
 * Formula: (BASE + size × PER_TEXT) × BUFFER
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
  const safeBatchSize = Math.max(0, batchSize);

  return Math.ceil(
    (BASE_TIMEOUT_MS + safeBatchSize * PER_TEXT_MS) * BUFFER_MULTIPLIER
  );
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
        timeoutMs: TEI_INFO_TIMEOUT_MS,
        maxRetries: TEI_MAX_RETRIES,
      }
    );

    assertTeiOk(response, '/info');

    const info = await response.json();
    this.cachedInfo = parseTeiInfo(info);

    return this.cachedInfo;
  }

  /**
   * Embed a single batch with batch-level retry
   *
   * Total attempts: (3 HTTP retries + 1) × (2 batch retries + 1) = up to 12 attempts
   *
   * @param inputs Array of text strings to embed (up to BATCH_SIZE)
   * @returns Array of embedding vectors
   */
  async embedBatch(inputs: string[]): Promise<number[][]> {
    const timeoutMs = calculateBatchTimeout(inputs.length);
    let lastError: Error | null = null;

    console.error(
      fmt.dim(
        `[TEI] Embedding ${inputs.length} texts (timeout: ${timeoutMs}ms)`
      )
    );

    for (
      let batchAttempt = 0;
      batchAttempt <= BATCH_RETRY_ATTEMPTS;
      batchAttempt++
    ) {
      try {
        const result = await requestTeiEmbeddings(
          this.httpClient.fetchWithRetry.bind(this.httpClient),
          this.teiUrl,
          inputs,
          {
            timeoutMs,
            maxRetries: TEI_MAX_RETRIES,
          }
        );

        if (batchAttempt > 0) {
          const retriesText = batchAttempt === 1 ? 'retry' : 'retries';
          console.error(
            fmt.success(
              `[TEI] Batch succeeded after ${batchAttempt} ${retriesText}`
            )
          );
        }

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (batchAttempt < BATCH_RETRY_ATTEMPTS) {
          console.error(
            fmt.warning(
              `[TEI] Batch retry ${batchAttempt + 1}/${BATCH_RETRY_ATTEMPTS} ` +
                `after error: ${lastError.message}`
            )
          );
          await sleep(BATCH_RETRY_DELAY_MS);
          continue;
        }

        // Log final failure
        console.error(
          fmt.error(
            `[TEI] Batch failed after ${BATCH_RETRY_ATTEMPTS + 1} attempts: ${lastError.message}`
          )
        );
        throw lastError;
      }
    }

    // Unreachable: loop always returns or throws
    throw new Error('Batch embedding failed after all retries');
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
    return runConcurrentBatches(texts, BATCH_SIZE, MAX_CONCURRENT, (batch) =>
      this.embedBatch(batch)
    );
  }
}
