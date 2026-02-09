/**
 * Qdrant Vector Database Service
 * Handles collection management, upsert, delete, query, and scroll operations
 */

import { LRUCache } from 'lru-cache';
import type {
  CollectionInfo,
  IHttpClient,
  IQdrantService,
  QdrantDistance,
  QdrantPoint,
  QdrantScrollPoint,
} from '../types';

const QDRANT_DISTANCE_VALUES: QdrantDistance[] = [
  'Cosine',
  'Dot',
  'Euclid',
  'Manhattan',
  'unknown',
];

const isQdrantDistance = (value: unknown): value is QdrantDistance =>
  typeof value === 'string' &&
  QDRANT_DISTANCE_VALUES.includes(value as QdrantDistance);

/** Scroll page size for pagination */
const SCROLL_PAGE_SIZE = 100;

/** HTTP timeout for Qdrant requests (60 seconds - longer for large operations) */
const QDRANT_TIMEOUT_MS = 60000;

/** Number of retries for Qdrant requests */
const QDRANT_MAX_RETRIES = 3;

/** Maximum number of collections to cache (LRU eviction) */
const COLLECTION_CACHE_MAX = 100;

/**
 * QdrantService implementation
 * Provides vector database operations with instance-level LRU caching
 */
export class QdrantService implements IQdrantService {
  private collectionCache = new LRUCache<string, true>({
    max: COLLECTION_CACHE_MAX,
  });

  constructor(
    private readonly qdrantUrl: string,
    private readonly httpClient: IHttpClient
  ) {}

  private async formatError(
    response: Response,
    baseMessage: string
  ): Promise<string> {
    try {
      const body = await response.text();
      return body
        ? `${baseMessage}: ${response.status} - ${body}`
        : `${baseMessage}: ${response.status}`;
    } catch {
      return `${baseMessage}: ${response.status}`;
    }
  }

  /**
   * Ensure collection exists, create if not
   * Creates payload indexes on url, domain, source_command after creation
   *
   * @param collection Collection name
   * @param dimension Vector dimension
   */
  async ensureCollection(collection: string, dimension: number): Promise<void> {
    if (this.collectionCache.get(collection)) {
      return;
    }

    const checkResponse = await this.httpClient.fetchWithRetry(
      `${this.qdrantUrl}/collections/${collection}`,
      undefined,
      { timeoutMs: QDRANT_TIMEOUT_MS, maxRetries: QDRANT_MAX_RETRIES }
    );

    if (checkResponse.ok) {
      this.collectionCache.set(collection, true);
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
        await this.formatError(
          createResponse,
          'Failed to create Qdrant collection'
        )
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
          await this.formatError(
            response,
            `Failed to create index for field '${indexFields[i]}'`
          )
        );
      }
    }

    this.collectionCache.set(collection, true);
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
      throw new Error(await this.formatError(response, 'Qdrant upsert failed'));
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
      throw new Error(await this.formatError(response, 'Qdrant delete failed'));
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
    filter?: Record<string, string | number | boolean>
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
      throw new Error(await this.formatError(response, 'Qdrant query failed'));
    }

    const data = (await response.json()) as {
      result?: {
        points?: Array<{
          id: string;
          score?: number;
          vector?: number[];
          payload?: Record<string, unknown>;
        }>;
      };
    };

    return (data.result?.points || []).map((p) => ({
      id: p.id,
      vector: p.vector || [],
      payload: p.payload || {},
      score: p.score,
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
        throw new Error(
          await this.formatError(response, 'Qdrant scroll failed')
        );
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

  /**
   * Delete all points for a domain
   *
   * @param collection Collection name
   * @param domain Domain to delete points for
   */
  async deleteByDomain(collection: string, domain: string): Promise<void> {
    const response = await this.httpClient.fetchWithRetry(
      `${this.qdrantUrl}/collections/${collection}/points/delete`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filter: {
            must: [{ key: 'domain', match: { value: domain } }],
          },
        }),
      },
      { timeoutMs: QDRANT_TIMEOUT_MS, maxRetries: QDRANT_MAX_RETRIES }
    );

    if (!response.ok) {
      throw new Error(await this.formatError(response, 'Qdrant delete failed'));
    }
  }

  /**
   * Count points matching a domain filter
   *
   * @param collection Collection name
   * @param domain Domain to count points for
   */
  async countByDomain(collection: string, domain: string): Promise<number> {
    const response = await this.httpClient.fetchWithRetry(
      `${this.qdrantUrl}/collections/${collection}/points/count`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filter: {
            must: [{ key: 'domain', match: { value: domain } }],
          },
          exact: true,
        }),
      },
      { timeoutMs: QDRANT_TIMEOUT_MS, maxRetries: QDRANT_MAX_RETRIES }
    );

    if (!response.ok) {
      throw new Error(await this.formatError(response, 'Qdrant count failed'));
    }

    const data = (await response.json()) as { result?: { count?: number } };
    return data.result?.count ?? 0;
  }

  /**
   * Get collection information
   *
   * @param collection Collection name
   * @returns Collection info including vector count and config
   */
  async getCollectionInfo(collection: string): Promise<CollectionInfo> {
    const response = await this.httpClient.fetchWithRetry(
      `${this.qdrantUrl}/collections/${collection}`,
      undefined,
      { timeoutMs: QDRANT_TIMEOUT_MS, maxRetries: QDRANT_MAX_RETRIES }
    );

    if (!response.ok) {
      throw new Error(
        await this.formatError(response, 'Qdrant getCollectionInfo failed')
      );
    }

    const data = (await response.json()) as {
      result?: {
        status?: string;
        vectors_count?: number;
        points_count?: number;
        segments_count?: number;
        config?: {
          params?: {
            vectors?: {
              size?: number;
              distance?: string;
            };
          };
        };
      };
    };

    const result = data.result;
    const distance = result?.config?.params?.vectors?.distance;
    return {
      status: result?.status ?? 'unknown',
      vectorsCount: result?.vectors_count ?? 0,
      pointsCount: result?.points_count ?? 0,
      segmentsCount: result?.segments_count ?? 0,
      config: {
        dimension: result?.config?.params?.vectors?.size ?? 0,
        distance: isQdrantDistance(distance) ? distance : 'unknown',
      },
    };
  }

  /**
   * Scroll all points with optional filter
   *
   * @param collection Collection name
   * @param filter Optional payload filter
   * @returns Array of all matching points (without vectors)
   */
  async scrollAll(
    collection: string,
    filter?: Record<string, string | number | boolean>
  ): Promise<QdrantScrollPoint[]> {
    const allPoints: QdrantScrollPoint[] = [];
    let offset: string | number | null = null;
    let isFirstPage = true;

    while (isFirstPage || offset !== null) {
      isFirstPage = false;

      const body: Record<string, unknown> = {
        limit: SCROLL_PAGE_SIZE,
        with_payload: true,
        with_vector: false,
      };

      if (filter && Object.keys(filter).length > 0) {
        body.filter = {
          must: Object.entries(filter).map(([key, value]) => ({
            key,
            match: { value },
          })),
        };
      }

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
        throw new Error(
          await this.formatError(response, 'Qdrant scroll failed')
        );
      }

      const data = (await response.json()) as {
        result?: {
          points?: Array<{
            id: string;
            payload?: Record<string, unknown>;
          }>;
          next_page_offset?: string | number | null;
        };
      };

      const points = data.result?.points || [];

      for (const p of points) {
        allPoints.push({
          id: p.id,
          payload: p.payload || {},
        });
      }

      offset = data.result?.next_page_offset ?? null;
    }

    return allPoints;
  }

  /**
   * Count total points in collection
   *
   * @param collection Collection name
   * @returns Total point count
   */
  async countPoints(collection: string): Promise<number> {
    const response = await this.httpClient.fetchWithRetry(
      `${this.qdrantUrl}/collections/${collection}/points/count`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exact: true }),
      },
      { timeoutMs: QDRANT_TIMEOUT_MS, maxRetries: QDRANT_MAX_RETRIES }
    );

    if (!response.ok) {
      throw new Error(await this.formatError(response, 'Qdrant count failed'));
    }

    const data = (await response.json()) as { result?: { count?: number } };
    return data.result?.count ?? 0;
  }

  /**
   * Count points matching a URL filter
   *
   * @param collection Collection name
   * @param url URL to count
   * @returns Point count for URL
   */
  async countByUrl(collection: string, url: string): Promise<number> {
    const response = await this.httpClient.fetchWithRetry(
      `${this.qdrantUrl}/collections/${collection}/points/count`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filter: {
            must: [{ key: 'url', match: { value: url } }],
          },
          exact: true,
        }),
      },
      { timeoutMs: QDRANT_TIMEOUT_MS, maxRetries: QDRANT_MAX_RETRIES }
    );

    if (!response.ok) {
      throw new Error(await this.formatError(response, 'Qdrant count failed'));
    }

    const data = (await response.json()) as { result?: { count?: number } };
    return data.result?.count ?? 0;
  }

  /**
   * Delete all points in collection
   *
   * @param collection Collection name
   */
  async deleteAll(collection: string): Promise<void> {
    const response = await this.httpClient.fetchWithRetry(
      `${this.qdrantUrl}/collections/${collection}/points/delete`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filter: {
            must: [],
          },
        }),
      },
      { timeoutMs: QDRANT_TIMEOUT_MS, maxRetries: QDRANT_MAX_RETRIES }
    );

    if (!response.ok) {
      throw new Error(await this.formatError(response, 'Qdrant delete failed'));
    }
  }
}
