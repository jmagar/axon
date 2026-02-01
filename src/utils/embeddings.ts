/**
 * TEI (Text Embeddings Inference) client
 * Handles batched embedding generation with concurrency control
 */

import { fetchWithRetry } from './http';

const BATCH_SIZE = 24;
const MAX_CONCURRENT = 4;

/** HTTP timeout for TEI requests (30 seconds) */
const TEI_TIMEOUT_MS = 30000;

/** Number of retries for TEI requests */
const TEI_MAX_RETRIES = 3;

interface TeiInfo {
  modelId: string;
  dimension: number;
  maxInput: number;
}

let cachedTeiInfo: TeiInfo | null = null;

/**
 * Reset cached TEI info (for testing)
 * @deprecated Use test containers instead - each container has its own cache
 * This function will be removed in Phase 4 after all tests are migrated.
 */
export function resetTeiCache(): void {
  cachedTeiInfo = null;
}

/**
 * Fetch TEI server info and extract vector dimension
 */
export async function getTeiInfo(teiUrl: string): Promise<TeiInfo> {
  if (cachedTeiInfo) return cachedTeiInfo;

  const response = await fetchWithRetry(`${teiUrl}/info`, undefined, {
    timeoutMs: TEI_TIMEOUT_MS,
    maxRetries: TEI_MAX_RETRIES,
  });
  if (!response.ok) {
    throw new Error(
      `TEI /info failed: ${response.status} ${response.statusText}`
    );
  }

  const info = await response.json();

  // Extract dimension from model_type.embedding.dim
  const dimension =
    info.model_type?.embedding?.dim ?? info.model_type?.Embedding?.dim ?? 1024;

  cachedTeiInfo = {
    modelId: info.model_id || 'unknown',
    dimension,
    maxInput: info.max_input_length || 32768,
  };

  return cachedTeiInfo;
}

/**
 * Embed a single batch of texts via TEI
 */
export async function embedBatch(
  teiUrl: string,
  inputs: string[]
): Promise<number[][]> {
  const response = await fetchWithRetry(
    `${teiUrl}/embed`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs }),
    },
    {
      timeoutMs: TEI_TIMEOUT_MS,
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
 * Embed all chunks with batching and concurrency control
 * Splits into batches of BATCH_SIZE, runs up to MAX_CONCURRENT in parallel
 */
export async function embedChunks(
  teiUrl: string,
  texts: string[]
): Promise<number[][]> {
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
      results[i] = await embedBatch(teiUrl, batch);
    } finally {
      semaphore.release();
    }
  });

  await Promise.all(promises);

  // Flatten batched results in order
  return results.flat();
}
