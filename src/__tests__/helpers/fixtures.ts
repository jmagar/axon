/**
 * Test helper utilities for generating test fixtures
 *
 * Provides reusable fixture generators to reduce duplication across test files
 */

/**
 * Scrape response fixture options
 */
export interface ScrapeResponseOptions {
  markdown?: string;
  html?: string;
  screenshot?: string;
  url?: string;
  title?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Create a mock scrape response
 *
 * @param options - Optional response properties
 * @returns Mock scrape response
 */
export function createScrapeResponse(
  options?: ScrapeResponseOptions
): Record<string, unknown> {
  return {
    markdown: options?.markdown ?? '# Test Content',
    url: options?.url ?? 'https://example.com',
    ...(options?.html && { html: options.html }),
    ...(options?.screenshot && { screenshot: options.screenshot }),
    ...(options?.title && { title: options.title }),
    ...(options?.description && { description: options.description }),
    ...(options?.metadata && { metadata: options.metadata }),
  };
}

/**
 * Search result item fixture options
 */
export interface SearchResultOptions {
  url?: string;
  title?: string;
  description?: string;
  score?: number;
}

/**
 * Create a mock search result item
 *
 * @param options - Optional result properties
 * @returns Mock search result item
 */
export function createSearchResult(
  options?: SearchResultOptions
): Record<string, unknown> {
  return {
    url: options?.url ?? 'https://example.com',
    title: options?.title ?? 'Example Title',
    description: options?.description ?? 'Example description',
    ...(options?.score !== undefined && { score: options.score }),
  };
}

/**
 * Create a mock search response with multiple results
 *
 * @param count - Number of results to generate
 * @param options - Optional result properties
 * @returns Mock search response
 */
export function createSearchResponse(
  count = 3,
  options?: SearchResultOptions
): { web: Array<Record<string, unknown>> } {
  const results = Array.from({ length: count }, (_, i) =>
    createSearchResult({
      url: options?.url ?? `https://example.com/page-${i + 1}`,
      title: options?.title ?? `Result ${i + 1}`,
      description: options?.description ?? `Description ${i + 1}`,
      score: options?.score,
    })
  );
  return { web: results };
}

/**
 * Crawl status fixture options
 */
export interface CrawlStatusOptions {
  status?: 'scraping' | 'completed' | 'failed' | 'cancelled';
  total?: number;
  completed?: number;
  creditsUsed?: number;
  expiresAt?: string;
  next?: string;
  data?: Array<Record<string, unknown>>;
}

/**
 * Create a mock crawl status response
 *
 * @param options - Optional status properties
 * @returns Mock crawl status response
 */
export function createCrawlStatus(
  options?: CrawlStatusOptions
): Record<string, unknown> {
  return {
    status: options?.status ?? 'completed',
    total: options?.total ?? 10,
    completed: options?.completed ?? 10,
    creditsUsed: options?.creditsUsed ?? 10,
    expiresAt: options?.expiresAt ?? new Date().toISOString(),
    ...(options?.next && { next: options.next }),
    ...(options?.data && { data: options.data }),
  };
}

/**
 * Qdrant point payload fixture options
 */
export interface QdrantPointOptions {
  id?: string;
  url?: string;
  domain?: string;
  title?: string;
  sourceCommand?: string;
  contentType?: string;
  scrapedAt?: string;
  chunkIndex?: number;
  totalChunks?: number;
  chunkHeader?: string;
  chunkText?: string;
  vector?: number[];
}

/**
 * Create a mock Qdrant point
 *
 * @param options - Optional point properties
 * @returns Mock Qdrant point
 */
export function createQdrantPoint(
  options?: QdrantPointOptions
): Record<string, unknown> {
  return {
    id: options?.id ?? '1',
    vector: options?.vector ?? [],
    payload: {
      url: options?.url ?? 'https://example.com',
      domain: options?.domain ?? 'example.com',
      title: options?.title ?? 'Test Page',
      source_command: options?.sourceCommand ?? 'scrape',
      content_type: options?.contentType ?? 'text/html',
      scraped_at: options?.scrapedAt ?? new Date().toISOString(),
      chunk_index: options?.chunkIndex ?? 0,
      total_chunks: options?.totalChunks ?? 1,
      chunk_header: options?.chunkHeader ?? 'Introduction',
      chunk_text: options?.chunkText ?? 'Test content',
    },
  };
}

/**
 * Create multiple mock Qdrant points
 *
 * @param count - Number of points to generate
 * @param baseOptions - Base options for all points
 * @returns Array of mock Qdrant points
 */
export function createQdrantPoints(
  count: number,
  baseOptions?: QdrantPointOptions
): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, i) =>
    createQdrantPoint({
      ...baseOptions,
      id: String(i + 1),
      chunkIndex: i,
      chunkHeader: `Section ${i + 1}`,
      chunkText: `Content for chunk ${i + 1}`,
    })
  );
}

/**
 * Job history entry fixture options
 */
export interface JobHistoryOptions {
  id?: string;
  updatedAt?: string;
  status?: string;
}

/**
 * Create a mock job history entry
 *
 * @param options - Optional entry properties
 * @returns Mock job history entry
 */
export function createJobHistoryEntry(
  options?: JobHistoryOptions
): Record<string, unknown> {
  return {
    id: options?.id ?? 'test-job-id',
    updatedAt: options?.updatedAt ?? new Date().toISOString(),
    ...(options?.status && { status: options.status }),
  };
}

/**
 * Create a mock job history file content
 *
 * @param crawlJobs - Array of crawl job entries
 * @param batchJobs - Array of batch job entries
 * @param extractJobs - Array of extract job entries
 * @returns Mock job history file content
 */
export function createJobHistoryFile(
  crawlJobs: Array<Record<string, unknown>> = [],
  batchJobs: Array<Record<string, unknown>> = [],
  extractJobs: Array<Record<string, unknown>> = []
): Record<string, Array<Record<string, unknown>>> {
  return {
    crawl: crawlJobs,
    batch: batchJobs,
    extract: extractJobs,
  };
}

/**
 * Credentials fixture options
 */
export interface CredentialsOptions {
  apiKey?: string;
  apiUrl?: string;
}

/**
 * Create mock credentials
 *
 * @param options - Optional credentials properties
 * @returns Mock credentials
 */
export function createCredentials(
  options?: CredentialsOptions
): Record<string, string> {
  return {
    apiKey: options?.apiKey ?? 'fc-test-api-key',
    apiUrl: options?.apiUrl ?? 'https://api.firecrawl.dev',
  };
}

/**
 * Map response fixture options
 */
export interface MapResponseOptions {
  links?: string[];
  error?: string;
}

/**
 * Create a mock map response
 *
 * @param options - Optional response properties
 * @returns Mock map response
 */
export function createMapResponse(
  options?: MapResponseOptions
): Record<string, unknown> {
  const links = options?.links ?? [
    'https://example.com/page-1',
    'https://example.com/page-2',
    'https://example.com/page-3',
  ];
  return {
    links,
    ...(options?.error && { error: options.error }),
  };
}

/**
 * Extract response fixture options
 */
export interface ExtractResponseOptions {
  data?: Record<string, unknown>;
  success?: boolean;
  warning?: string;
}

/**
 * Create a mock extract response
 *
 * @param options - Optional response properties
 * @returns Mock extract response
 */
export function createExtractResponse(
  options?: ExtractResponseOptions
): Record<string, unknown> {
  return {
    success: options?.success ?? true,
    data: options?.data ?? { title: 'Test', description: 'Test description' },
    ...(options?.warning && { warning: options.warning }),
  };
}

/**
 * Batch scrape status fixture options
 */
export interface BatchStatusOptions {
  status?: 'processing' | 'completed' | 'failed';
  total?: number;
  completed?: number;
  failed?: number;
  data?: Array<Record<string, unknown>>;
}

/**
 * Create a mock batch scrape status response
 *
 * @param options - Optional status properties
 * @returns Mock batch scrape status response
 */
export function createBatchStatus(
  options?: BatchStatusOptions
): Record<string, unknown> {
  return {
    status: options?.status ?? 'completed',
    total: options?.total ?? 5,
    completed: options?.completed ?? 5,
    failed: options?.failed ?? 0,
    ...(options?.data && { data: options.data }),
  };
}
