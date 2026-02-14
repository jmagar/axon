/**
 * TEI (Text Embeddings Inference) Service
 * Handles batched embedding generation with concurrency control
 */

import type { EffectiveUserSettings } from '../../schemas/storage';
import { sleep } from '../../utils/http';
import {
  assertTeiOk,
  parseTeiInfo,
  requestTeiEmbeddings,
  runConcurrentBatches,
} from '../../utils/tei-helpers';
import { fmt } from '../../utils/theme';
import type { IHttpClient, ITeiService, TeiInfo } from '../types';

/** HTTP timeout for TEI /info endpoint (30 seconds) */
const TEI_INFO_TIMEOUT_MS = 30000;

/** Number of batch-level retries (in addition to HTTP retries) */
const BATCH_RETRY_ATTEMPTS = 2;

/** Delay before batch retry (30 seconds) */
const BATCH_RETRY_DELAY_MS = 30000;

/**
 * Calculate dynamic timeout based on batch size
 *
 * Formula: BASE + size × PER_TEXT
 * - BASE: 30s for overhead (network, tokenization, queue wait)
 * - PER_TEXT: 1s per text (empirical testing shows ~500ms actual)
 *
 * Examples:
 * - 3 texts: 30 + 3 = 33s
 * - 24 texts: 30 + 24 = 54s
 *
 * @param batchSize Number of texts in batch
 * @returns Timeout in milliseconds
 */
function calculateBatchTimeout(batchSize: number): number {
  const BASE_TIMEOUT_MS = 30000;
  const PER_TEXT_MS = 1000;
  const safeBatchSize = Math.max(0, batchSize);

  return BASE_TIMEOUT_MS + safeBatchSize * PER_TEXT_MS;
}

/**
 * TeiService implementation
 * Provides TEI embedding generation with instance-level caching
 */
export class TeiService implements ITeiService {
  private cachedInfo: TeiInfo | null = null;
  private readonly embeddingSettings: EffectiveUserSettings['embedding'];

  constructor(
    private readonly teiUrl: string,
    private readonly httpClient: IHttpClient,
    settings: EffectiveUserSettings
  ) {
    this.embeddingSettings = settings.embedding;
  }

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
        maxRetries: this.embeddingSettings.maxRetries,
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
            maxRetries: this.embeddingSettings.maxRetries,
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
    return runConcurrentBatches(
      texts,
      this.embeddingSettings.batchSize,
      this.embeddingSettings.maxConcurrentBatches,
      (batch) => this.embedBatch(batch)
    );
  }
}
