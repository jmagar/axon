/**
 * Qdrant vector database client
 * Handles collection management, upsert, delete, query, and scroll operations
 */

import { fetchWithRetry } from './http';

const SCROLL_PAGE_SIZE = 100;

/** HTTP timeout for Qdrant requests (60 seconds - longer for large operations) */
const QDRANT_TIMEOUT_MS = 60000;

/** Number of retries for Qdrant requests */
const QDRANT_MAX_RETRIES = 3;

const collectionCache = new Set<string>();

/**
 * Reset collection cache (for testing)
 * @deprecated Use test containers instead - each container has its own cache
 * This function will be removed in Phase 4 after all tests are migrated.
 */
export function resetQdrantCache(): void {
  collectionCache.clear();
}

/**
 * Ensure collection exists, create if not
 * Creates payload indexes on url, domain, source_command after creation
 */
export async function ensureCollection(
  qdrantUrl: string,
  collection: string,
  dimension: number
): Promise<void> {
  if (collectionCache.has(collection)) return;

  const checkResponse = await fetchWithRetry(
    `${qdrantUrl}/collections/${collection}`,
    undefined,
    { timeoutMs: QDRANT_TIMEOUT_MS, maxRetries: QDRANT_MAX_RETRIES }
  );

  if (checkResponse.ok) {
    collectionCache.add(collection);
    return;
  }

  if (checkResponse.status !== 404) {
    throw new Error(
      `Failed to check Qdrant collection: ${checkResponse.status} ${checkResponse.statusText}`
    );
  }

  // Create collection
  const createResponse = await fetchWithRetry(
    `${qdrantUrl}/collections/${collection}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vectors: {
          size: dimension,
          distance: 'Cosine',
        },
      }),
    },
    { timeoutMs: QDRANT_TIMEOUT_MS, maxRetries: QDRANT_MAX_RETRIES }
  );

  if (!createResponse.ok) {
    throw new Error(
      `Failed to create Qdrant collection: ${createResponse.status}`
    );
  }

  // Create payload indexes for fast filtering (in parallel)
  const indexFields = ['url', 'domain', 'source_command'];
  await Promise.all(
    indexFields.map((field) =>
      fetchWithRetry(
        `${qdrantUrl}/collections/${collection}/index`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            field_name: field,
            field_schema: 'keyword',
          }),
        },
        { timeoutMs: QDRANT_TIMEOUT_MS, maxRetries: QDRANT_MAX_RETRIES }
      )
    )
  );

  collectionCache.add(collection);
}

export interface QdrantPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

/**
 * Upsert points into collection
 */
export async function upsertPoints(
  qdrantUrl: string,
  collection: string,
  points: QdrantPoint[]
): Promise<void> {
  const response = await fetchWithRetry(
    `${qdrantUrl}/collections/${collection}/points`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points }),
    },
    { timeoutMs: QDRANT_TIMEOUT_MS, maxRetries: QDRANT_MAX_RETRIES }
  );

  if (!response.ok) {
    throw new Error(`Qdrant upsert failed: ${response.status}`);
  }
}

/**
 * Delete all points matching a URL
 */
export async function deleteByUrl(
  qdrantUrl: string,
  collection: string,
  url: string
): Promise<void> {
  const response = await fetchWithRetry(
    `${qdrantUrl}/collections/${collection}/points/delete`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filter: {
          must: [{ key: 'url', match: { value: url } }],
        },
      }),
    },
    { timeoutMs: QDRANT_TIMEOUT_MS, maxRetries: QDRANT_MAX_RETRIES }
  );

  if (!response.ok) {
    throw new Error(`Qdrant delete failed: ${response.status}`);
  }
}

export interface QueryOptions {
  limit: number;
  domain?: string;
}

export interface QueryResult {
  id: string;
  score: number;
  payload: Record<string, unknown>;
}

/**
 * Query collection with vector similarity
 */
export async function queryPoints(
  qdrantUrl: string,
  collection: string,
  vector: number[],
  options: QueryOptions
): Promise<QueryResult[]> {
  const body: Record<string, unknown> = {
    query: vector,
    limit: options.limit,
    with_payload: true,
  };

  if (options.domain) {
    body.filter = {
      must: [{ key: 'domain', match: { value: options.domain } }],
    };
  }

  const response = await fetchWithRetry(
    `${qdrantUrl}/collections/${collection}/points/query`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    { timeoutMs: QDRANT_TIMEOUT_MS, maxRetries: QDRANT_MAX_RETRIES }
  );

  if (!response.ok) {
    throw new Error(`Qdrant query failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    result?: {
      points?: Array<{
        id: string;
        score?: number;
        payload?: Record<string, unknown>;
      }>;
    };
  };
  return (data.result?.points || []).map((p) => ({
    id: p.id,
    score: p.score ?? 0,
    payload: p.payload ?? {},
  }));
}

export interface ScrollResult {
  id: string;
  payload: Record<string, unknown>;
}

/**
 * Scroll all points for a URL, paginating through results
 * Returns points sorted by chunk_index
 */
export async function scrollByUrl(
  qdrantUrl: string,
  collection: string,
  url: string
): Promise<ScrollResult[]> {
  const allPoints: ScrollResult[] = [];
  let offset: string | number | null = null;
  let isFirstPage = true;

  while (isFirstPage || offset !== null) {
    isFirstPage = false;

    const body: Record<string, unknown> = {
      filter: {
        must: [{ key: 'url', match: { value: url } }],
      },
      limit: SCROLL_PAGE_SIZE,
      with_payload: true,
    };

    if (offset !== null) {
      body.offset = offset;
    }

    const response = await fetchWithRetry(
      `${qdrantUrl}/collections/${collection}/points/scroll`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      { timeoutMs: QDRANT_TIMEOUT_MS, maxRetries: QDRANT_MAX_RETRIES }
    );

    if (!response.ok) {
      throw new Error(`Qdrant scroll failed: ${response.status}`);
    }

    const data = (await response.json()) as {
      result?: {
        points?: Array<{ id: string; payload?: Record<string, unknown> }>;
        next_page_offset?: string | number | null;
      };
    };
    const points = data.result?.points || [];

    for (const p of points) {
      allPoints.push({ id: p.id, payload: p.payload ?? {} });
    }

    offset = data.result?.next_page_offset ?? null;
  }

  // Sort by chunk_index
  allPoints.sort(
    (a, b) =>
      ((a.payload.chunk_index as number) ?? 0) -
      ((b.payload.chunk_index as number) ?? 0)
  );

  return allPoints;
}
