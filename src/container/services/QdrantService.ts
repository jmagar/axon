/**
 * Qdrant Vector Database Service
 * Handles collection management, upsert, delete, query, and scroll operations
 */

import type { IHttpClient, IQdrantService, QdrantPoint } from '../types';

/** Scroll page size for pagination */
const SCROLL_PAGE_SIZE = 100;

/** HTTP timeout for Qdrant requests (60 seconds - longer for large operations) */
const QDRANT_TIMEOUT_MS = 60000;

/** Number of retries for Qdrant requests */
const QDRANT_MAX_RETRIES = 3;

/**
 * QdrantService implementation
 * Provides vector database operations with instance-level caching
 */
export class QdrantService implements IQdrantService {
  private collectionCache = new Set<string>();

  constructor(
    private readonly qdrantUrl: string,
    private readonly defaultCollection: string,
    private readonly httpClient: IHttpClient
  ) {}

  /**
   * Ensure collection exists, create if not
   * Creates payload indexes on url, domain, source_command after creation
   *
   * @param collection Collection name
   * @param dimension Vector dimension
   */
  async ensureCollection(collection: string, dimension: number): Promise<void> {
    if (this.collectionCache.has(collection)) {
      return;
    }

    const checkResponse = await this.httpClient.fetchWithRetry(
      `${this.qdrantUrl}/collections/${collection}`,
      undefined,
      { timeoutMs: QDRANT_TIMEOUT_MS, maxRetries: QDRANT_MAX_RETRIES }
    );

    if (checkResponse.ok) {
      this.collectionCache.add(collection);
      return;
    }

    if (checkResponse.status !== 404) {
      throw new Error(
        `Failed to check Qdrant collection: ${checkResponse.status} ${checkResponse.statusText}`
      );
    }

    // Create collection
    const createResponse = await this.httpClient.fetchWithRetry(
      `${this.qdrantUrl}/collections/${collection}`,
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
    const indexResponses = await Promise.all(
      indexFields.map((field) =>
        this.httpClient.fetchWithRetry(
          `${this.qdrantUrl}/collections/${collection}/index`,
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

    // Verify all indexes were created successfully
    for (let i = 0; i < indexResponses.length; i++) {
      const response = indexResponses[i];
      if (!response.ok) {
        throw new Error(
          `Failed to create index for field '${indexFields[i]}': ${response.status}`
        );
      }
    }

    this.collectionCache.add(collection);
  }

  /**
   * Upsert points into collection
   *
   * @param collection Collection name
   * @param points Points to upsert
   */
  async upsertPoints(collection: string, points: QdrantPoint[]): Promise<void> {
    const response = await this.httpClient.fetchWithRetry(
      `${this.qdrantUrl}/collections/${collection}/points`,
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
   * Delete all points for a URL
   *
   * @param collection Collection name
   * @param url URL to delete points for
   */
  async deleteByUrl(collection: string, url: string): Promise<void> {
    const response = await this.httpClient.fetchWithRetry(
      `${this.qdrantUrl}/collections/${collection}/points/delete`,
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

  /**
   * Query points by vector similarity
   *
   * @param collection Collection name
   * @param vector Query vector
   * @param limit Max results (default: 10)
   * @param filter Optional payload filter (e.g., { domain: 'example.com' })
   * @returns Array of matching points with vectors
   */
  async queryPoints(
    collection: string,
    vector: number[],
    limit: number = 10,
    filter?: Record<string, unknown>
  ): Promise<QdrantPoint[]> {
    const body: Record<string, unknown> = {
      query: vector,
      limit,
      with_payload: true,
      with_vector: true,
    };

    if (filter) {
      body.filter = {
        must: Object.entries(filter).map(([key, value]) => ({
          key,
          match: { value },
        })),
      };
    }

    const response = await this.httpClient.fetchWithRetry(
      `${this.qdrantUrl}/collections/${collection}/points/query`,
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
          vector?: number[];
          payload?: Record<string, unknown>;
        }>;
      };
    };

    return (data.result?.points || []).map((p) => ({
      id: p.id,
      vector: p.vector || [],
      payload: p.payload || {},
    }));
  }

  /**
   * Scroll all points for a URL, paginating through results
   * Returns points sorted by chunk_index
   *
   * @param collection Collection name
   * @param url URL to scroll points for
   * @returns Array of all points for the URL, sorted by chunk_index
   */
  async scrollByUrl(collection: string, url: string): Promise<QdrantPoint[]> {
    const allPoints: QdrantPoint[] = [];
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
        with_vector: true,
      };

      if (offset !== null) {
        body.offset = offset;
      }

      const response = await this.httpClient.fetchWithRetry(
        `${this.qdrantUrl}/collections/${collection}/points/scroll`,
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
          points?: Array<{
            id: string;
            vector?: number[];
            payload?: Record<string, unknown>;
          }>;
          next_page_offset?: string | number | null;
        };
      };

      const points = data.result?.points || [];

      for (const p of points) {
        allPoints.push({
          id: p.id,
          vector: p.vector || [],
          payload: p.payload || {},
        });
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
}
