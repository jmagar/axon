/**
 * Zod schemas for runtime validation of stored data
 *
 * These schemas provide type-safe validation for:
 * - User credentials (API keys, URLs)
 * - User settings (exclude paths, preferences)
 *
 * All schemas use .strict() mode to reject unknown fields and prevent injection attacks.
 */

import { z } from 'zod';

/**
 * Schema for stored credentials file (~/.axon/credentials.json by default)
 *
 * Example:
 * ```json
 * {
 *   "apiKey": "fc-abc123",
 *   "apiUrl": "https://api.firecrawl.dev"
 * }
 * ```
 */
export const StoredCredentialsSchema = z
  .object({
    apiKey: z.string().optional(),
    apiUrl: z.string().url().optional(),
  })
  .strict();

const CrawlSettingsSchema = z
  .object({
    maxDepth: z.number().int().min(1).max(100).optional(),
    crawlEntireDomain: z.boolean().optional(),
    allowSubdomains: z.boolean().optional(),
    onlyMainContent: z.boolean().optional(),
    excludeTags: z.array(z.string()).optional(),
    sitemap: z.enum(['skip', 'include']).optional(),
    ignoreQueryParameters: z.boolean().optional(),
    autoEmbed: z.boolean().optional(),
    pollIntervalSeconds: z.number().min(0.1).max(60).optional(),
  })
  .strict();

const ScrapeSettingsSchema = z
  .object({
    formats: z.array(z.string()).optional(),
    onlyMainContent: z.boolean().optional(),
    timeoutSeconds: z.number().min(1).max(300).optional(),
    excludeTags: z.array(z.string()).optional(),
    autoEmbed: z.boolean().optional(),
  })
  .strict();

const MapSettingsSchema = z
  .object({
    sitemap: z.enum(['only', 'include', 'skip']).optional(),
    includeSubdomains: z.boolean().nullable().optional(),
    ignoreQueryParameters: z.boolean().nullable().optional(),
    ignoreCache: z.boolean().nullable().optional(),
  })
  .strict();

const SearchSettingsSchema = z
  .object({
    limit: z.number().int().min(1).max(100).optional(),
    sources: z.array(z.string()).optional(),
    timeoutMs: z.number().int().min(1000).max(300000).optional(),
    ignoreInvalidUrls: z.boolean().optional(),
    scrape: z.boolean().optional(),
    scrapeFormats: z.array(z.string()).optional(),
    onlyMainContent: z.boolean().optional(),
    autoEmbed: z.boolean().optional(),
  })
  .strict();

const ExtractSettingsSchema = z
  .object({
    allowExternalLinks: z.boolean().optional(),
    enableWebSearch: z.boolean().optional(),
    includeSubdomains: z.boolean().optional(),
    showSources: z.boolean().optional(),
    ignoreInvalidUrls: z.boolean().optional(),
    autoEmbed: z.boolean().optional(),
  })
  .strict();

const BatchSettingsSchema = z
  .object({
    onlyMainContent: z.boolean().optional(),
    ignoreInvalidUrls: z.boolean().optional(),
  })
  .strict();

const AskSettingsSchema = z
  .object({
    limit: z.number().int().min(1).max(100).optional(),
    fullDocs: z.number().int().min(1).max(20).optional(),
    backfillChunks: z.number().int().min(0).max(20).optional(),
  })
  .strict();

const HttpSettingsSchema = z
  .object({
    timeoutMs: z.number().int().min(1000).max(300000).optional(),
    maxRetries: z.number().int().min(0).max(10).optional(),
    baseDelayMs: z.number().int().min(100).max(60000).optional(),
    maxDelayMs: z.number().int().min(1000).max(300000).optional(),
  })
  .strict();

const ChunkingSettingsSchema = z
  .object({
    maxChunkSize: z.number().int().min(100).max(10000).optional(),
    targetChunkSize: z.number().int().min(50).max(5000).optional(),
    overlapSize: z.number().int().min(0).max(1000).optional(),
    minChunkSize: z.number().int().min(10).max(1000).optional(),
  })
  .strict();

const EmbeddingSettingsSchema = z
  .object({
    maxConcurrent: z.number().int().min(1).max(50).optional(),
    batchSize: z.number().int().min(1).max(100).optional(),
    maxConcurrentBatches: z.number().int().min(1).max(10).optional(),
    maxRetries: z.number().int().min(0).max(10).optional(),
  })
  .strict();

const PollingSettingsSchema = z
  .object({
    intervalMs: z.number().int().min(1000).max(60000).optional(),
  })
  .strict();

/**
 * Schema for user settings file (~/.axon/settings.json by default)
 */
export const UserSettingsSchema = z
  .object({
    settingsVersion: z.literal(2).optional(),
    defaultExcludePaths: z.array(z.string()).optional(),
    defaultExcludeExtensions: z.array(z.string()).optional(),
    crawl: CrawlSettingsSchema.optional(),
    scrape: ScrapeSettingsSchema.optional(),
    map: MapSettingsSchema.optional(),
    search: SearchSettingsSchema.optional(),
    extract: ExtractSettingsSchema.optional(),
    batch: BatchSettingsSchema.optional(),
    ask: AskSettingsSchema.optional(),
    http: HttpSettingsSchema.optional(),
    chunking: ChunkingSettingsSchema.optional(),
    embedding: EmbeddingSettingsSchema.optional(),
    polling: PollingSettingsSchema.optional(),
  })
  .strict();

/**
 * SEC-05: Schema for embed job files (~/.axon/embed-queue/*.json)
 *
 * Validates job files read from disk to prevent deserialization attacks.
 * Uses .strict() to reject unknown fields.
 */
export const EmbedJobSchema = z
  .object({
    id: z.string().min(1),
    jobId: z.string().min(1),
    url: z.string().url(),
    status: z.enum(['pending', 'processing', 'completed', 'failed']),
    retries: z.number().int().min(0),
    maxRetries: z.number().int().min(0),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    lastError: z.string().optional(),
    apiKey: z.string().optional(),
    totalDocuments: z.number().int().min(0).optional(),
    processedDocuments: z.number().int().min(0).optional(),
    failedDocuments: z.number().int().min(0).optional(),
    progressUpdatedAt: z.string().datetime().optional(),
    hardSync: z.boolean().optional(),
  })
  .strict();

export type ValidatedEmbedJob = z.infer<typeof EmbedJobSchema>;

// Export TypeScript types inferred from schemas
export type StoredCredentials = z.infer<typeof StoredCredentialsSchema>;
export type UserSettings = z.infer<typeof UserSettingsSchema>;

export type EffectiveUserSettings = {
  settingsVersion: 2;
  defaultExcludePaths: string[];
  defaultExcludeExtensions: string[];
  crawl: Required<z.infer<typeof CrawlSettingsSchema>>;
  scrape: Required<z.infer<typeof ScrapeSettingsSchema>>;
  map: Required<z.infer<typeof MapSettingsSchema>>;
  search: Required<z.infer<typeof SearchSettingsSchema>>;
  extract: Required<z.infer<typeof ExtractSettingsSchema>>;
  batch: Required<z.infer<typeof BatchSettingsSchema>>;
  ask: Required<z.infer<typeof AskSettingsSchema>>;
  http: Required<z.infer<typeof HttpSettingsSchema>>;
  chunking: Required<z.infer<typeof ChunkingSettingsSchema>>;
  embedding: Required<z.infer<typeof EmbeddingSettingsSchema>>;
  polling: Required<z.infer<typeof PollingSettingsSchema>>;
};
