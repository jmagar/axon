/**
 * Shared TEI embedding utilities.
 */

/**
 * Parsed TEI model information used by embedding services.
 */
export interface ParsedTeiInfo {
  modelId: string;
  dimension: number;
  maxInput: number;
}

interface RetryOptions {
  timeoutMs: number;
  maxRetries: number;
}

interface TeiModelType {
  embedding?: { dim?: number };
  Embedding?: { dim?: number };
}

interface TeiInfoResponse {
  model_id?: string;
  model_type?: TeiModelType;
  max_input_length?: number;
}

/**
 * Parse TEI /info response into normalized model metadata.
 */
export function parseTeiInfo(info: TeiInfoResponse): ParsedTeiInfo {
  const dimension =
    info.model_type?.embedding?.dim ?? info.model_type?.Embedding?.dim ?? 1024;

  return {
    modelId: info.model_id || 'unknown',
    dimension,
    maxInput: info.max_input_length || 32768,
  };
}

/**
 * Split an array into fixed-size batches.
 */
export function splitIntoBatches<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

/**
 * Simple semaphore for concurrency control.
 */
export class Semaphore {
  private current = 0;
  private queue: (() => void)[] = [];

  constructor(private readonly max: number) {}

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
    if (next) {
      next();
    }
  }
}

/**
 * Throw a standardized TEI endpoint error for non-OK responses.
 */
export function assertTeiOk(
  response: Response,
  endpoint: '/info' | '/embed'
): void {
  if (!response.ok) {
    throw new Error(
      `TEI ${endpoint} failed: ${response.status} ${response.statusText}`
    );
  }
}

/**
 * Request embeddings from TEI for a single batch.
 */
export async function requestTeiEmbeddings(
  fetcher: (
    url: string,
    init?: RequestInit,
    options?: RetryOptions
  ) => Promise<Response>,
  teiUrl: string,
  inputs: string[],
  options: RetryOptions
): Promise<number[][]> {
  const response = await fetcher(
    `${teiUrl}/embed`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs }),
    },
    options
  );

  assertTeiOk(response, '/embed');
  return response.json();
}

/**
 * Execute batched work with bounded concurrency while preserving order.
 */
export async function runConcurrentBatches<T, R>(
  items: T[],
  batchSize: number,
  maxConcurrent: number,
  runBatch: (batch: T[]) => Promise<R[]>
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const batches = splitIntoBatches(items, batchSize);
  const semaphore = new Semaphore(maxConcurrent);
  const results: R[][] = new Array(batches.length);

  const promises = batches.map(async (batch, i) => {
    await semaphore.acquire();
    try {
      results[i] = await runBatch(batch);
    } finally {
      semaphore.release();
    }
  });

  await Promise.all(promises);
  return results.flat();
}
