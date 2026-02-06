/**
 * Dependency Injection Container Types
 * Defines interfaces for container-based DI architecture
 */

import type Firecrawl from '@mendable/firecrawl-js';

/**
 * Immutable configuration for a container instance
 * Configuration is frozen after container creation - no mutations allowed
 */
export interface ImmutableConfig {
  // Firecrawl API
  readonly apiKey?: string;
  readonly apiUrl?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly backoffFactor?: number;
  readonly userAgent?: string;

  // Embeddings
  readonly teiUrl?: string;
  readonly qdrantUrl?: string;
  readonly qdrantCollection?: string;

  // Webhook for background embedding
  readonly embedderWebhookUrl?: string;
  readonly embedderWebhookSecret?: string;
  readonly embedderWebhookPort?: number;
  readonly embedderWebhookPath?: string;
}

/**
 * Mutable configuration options for container creation
 * Used to build immutable config during factory resolution
 */
export interface ConfigOptions {
  // Firecrawl API
  apiKey?: string;
  apiUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  backoffFactor?: number;
  userAgent?: string;

  // Embeddings
  teiUrl?: string;
  qdrantUrl?: string;
  qdrantCollection?: string;

  // Webhook for background embedding
  embedderWebhookUrl?: string;
  embedderWebhookSecret?: string;
  embedderWebhookPort?: number;
  embedderWebhookPath?: string;
}

/**
 * TEI server information
 */
export interface TeiInfo {
  modelId: string;
  dimension: number;
  maxInput: number;
}

/**
 * Qdrant point structure (with vector)
 */
export interface QdrantPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
  score?: number; // Similarity score from query operations
}

/**
 * Qdrant scroll point structure (without vector)
 * Used for scroll operations that don't need vector data
 */
export interface QdrantScrollPoint {
  id: string;
  payload: Record<string, unknown>;
}

/**
 * Qdrant collection distance types
 */
export type QdrantDistance =
  | 'Cosine'
  | 'Dot'
  | 'Euclid'
  | 'Manhattan'
  | 'unknown';

/**
 * Qdrant collection information
 */
export interface CollectionInfo {
  status: string;
  vectorsCount: number;
  pointsCount: number;
  segmentsCount: number;
  config: {
    dimension: number;
    distance: QdrantDistance;
  };
}

/**
 * HTTP Client Interface
 * Provides retry and timeout capabilities for HTTP requests
 */
export interface IHttpClient {
  /**
   * Fetch with automatic retry on transient errors
   * @param url URL to fetch
   * @param init Fetch init options
   * @param options Retry options
   */
  fetchWithRetry(
    url: string,
    init?: RequestInit,
    options?: {
      timeoutMs?: number;
      maxRetries?: number;
      baseDelayMs?: number;
      maxDelayMs?: number;
    }
  ): Promise<Response>;

  /**
   * Fetch with timeout but no retry
   * @param url URL to fetch
   * @param init Fetch init options
   * @param timeoutMs Timeout in milliseconds
   */
  fetchWithTimeout(
    url: string,
    init?: RequestInit,
    timeoutMs?: number
  ): Promise<Response>;
}

/**
 * TEI (Text Embeddings Inference) Service Interface
 * Handles embedding generation with batching and concurrency control
 */
export interface ITeiService {
  /**
   * Get TEI server info (cached after first call)
   */
  getTeiInfo(): Promise<TeiInfo>;

  /**
   * Embed a single batch of texts
   * @param inputs Array of text strings to embed
   */
  embedBatch(inputs: string[]): Promise<number[][]>;

  /**
   * Embed multiple chunks with automatic batching and concurrency control
   * @param texts Array of text strings to embed
   */
  embedChunks(texts: string[]): Promise<number[][]>;
}

/**
 * Qdrant Vector Database Service Interface
 * Handles collection management and vector operations
 */
export interface IQdrantService {
  /**
   * Ensure collection exists, create if not
   * @param collection Collection name
   * @param dimension Vector dimension
   */
  ensureCollection(collection: string, dimension: number): Promise<void>;

  /**
   * Upsert points to collection
   * @param collection Collection name
   * @param points Points to upsert
   */
  upsertPoints(collection: string, points: QdrantPoint[]): Promise<void>;

  /**
   * Delete all points for a URL
   * @param collection Collection name
   * @param url URL to delete points for
   */
  deleteByUrl(collection: string, url: string): Promise<void>;

  /**
   * Query points by vector similarity
   * @param collection Collection name
   * @param vector Query vector
   * @param limit Max results
   * @param filter Optional payload filter
   */
  queryPoints(
    collection: string,
    vector: number[],
    limit?: number,
    filter?: Record<string, string | number | boolean>
  ): Promise<QdrantPoint[]>;

  /**
   * Scroll all points for a URL
   * @param collection Collection name
   * @param url URL to scroll points for
   */
  scrollByUrl(collection: string, url: string): Promise<QdrantPoint[]>;

  /**
   * Delete all points for a domain
   * @param collection Collection name
   * @param domain Domain to delete points for
   */
  deleteByDomain(collection: string, domain: string): Promise<void>;

  /**
   * Count points matching a domain filter
   * @param collection Collection name
   * @param domain Domain to count points for
   */
  countByDomain(collection: string, domain: string): Promise<number>;

  /**
   * Get collection information (vector count, config)
   * @param collection Collection name
   */
  getCollectionInfo(collection: string): Promise<CollectionInfo>;

  /**
   * Scroll all points with optional filter, paginating through results
   * @param collection Collection name
   * @param filter Optional payload filter
   */
  scrollAll(
    collection: string,
    filter?: Record<string, string | number | boolean>
  ): Promise<QdrantScrollPoint[]>;

  /**
   * Count total points in collection
   * @param collection Collection name
   */
  countPoints(collection: string): Promise<number>;

  /**
   * Count points matching a URL filter
   * @param collection Collection name
   * @param url URL to count
   */
  countByUrl(collection: string, url: string): Promise<number>;

  /**
   * Delete all points in collection
   * @param collection Collection name
   */
  deleteAll(collection: string): Promise<void>;
}

/**
 * Embedding Pipeline Service Interface
 * Orchestrates chunking, embedding, and storage
 */
export interface IEmbedPipeline {
  /**
   * Auto-embed content with default settings
   * Chunks content, generates embeddings, stores in Qdrant
   * @param content Text content to embed
   * @param metadata Metadata for the content
   */
  autoEmbed(
    content: string,
    metadata: {
      url: string;
      title?: string;
      sourceCommand?: string;
      contentType?: string;
      [key: string]: unknown;
    }
  ): Promise<void>;

  /**
   * Batch embed multiple items with concurrency control
   * @param items Array of items to embed
   * @param options Batch options
   * @param options.concurrency Maximum number of concurrent embedding operations
   * @param options.onProgress Optional callback invoked after each item completes
   * @returns Promise with embedding result statistics
   */
  batchEmbed(
    items: Array<{
      content: string;
      metadata: {
        url: string;
        title?: string;
        sourceCommand?: string;
        contentType?: string;
        [key: string]: unknown;
      };
    }>,
    options?: {
      concurrency?: number;
      onProgress?: (current: number, total: number) => void | Promise<void>;
    }
  ): Promise<{ succeeded: number; failed: number; errors: string[] }>;
}

/**
 * Dependency Injection Container Interface
 * Manages all application dependencies with immutable config
 */
export interface IContainer {
  /**
   * Immutable configuration (frozen after creation)
   */
  readonly config: ImmutableConfig;

  /**
   * Get or create Firecrawl SDK client
   * Throws if API key not configured
   */
  getFirecrawlClient(): Firecrawl;

  /**
   * Get or create HTTP client
   */
  getHttpClient(): IHttpClient;

  /**
   * Get or create TEI service
   * Throws if TEI URL not configured
   */
  getTeiService(): ITeiService;

  /**
   * Get or create Qdrant service
   * Throws if Qdrant URL not configured
   */
  getQdrantService(): IQdrantService;

  /**
   * Get or create embedding pipeline
   * Composes TEI and Qdrant services
   */
  getEmbedPipeline(): IEmbedPipeline;

  /**
   * Cleanup resources
   */
  dispose(): Promise<void>;
}
