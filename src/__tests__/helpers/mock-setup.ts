/**
 * Test helper utilities for setting up mocks
 *
 * Provides reusable mock setup patterns to reduce duplication across test files
 */

import type { Mock } from 'vitest';
import { vi } from 'vitest';
import type {
  IContainer,
  IEmbedPipeline,
  IQdrantService,
} from '../../container/types';
import type { MockAxonClient } from '../utils/mock-client';

/**
 * Mock configuration options for creating test containers
 */
export interface MockContainerConfig {
  apiKey?: string;
  apiUrl?: string;
  teiUrl?: string;
  qdrantUrl?: string;
  qdrantCollection?: string;
  userAgent?: string;
  embedderWebhookUrl?: string;
  embedderWebhookSecret?: string;
  embedderWebhookPort?: number;
  embedderWebhookPath?: string;
}

/**
 * Mock embed pipeline options
 */
export interface MockEmbedPipelineConfig {
  autoEmbed?: Mock;
  batchEmbed?: Mock;
}

/**
 * Create a mock Axon client with common methods
 *
 * @param overrides - Optional method overrides
 * @returns Mock Axon client
 */
export function createMockAxonClient(
  overrides?: Partial<MockAxonClient>
): MockAxonClient {
  return {
    scrape: vi.fn(),
    crawl: vi.fn(),
    search: vi.fn(),
    map: vi.fn(),
    extract: vi.fn(),
    agent: vi.fn(),
    startCrawl: vi.fn(),
    getCrawlStatus: vi.fn(),
    cancelCrawl: vi.fn(),
    getCrawlErrors: vi.fn(),
    getActiveCrawls: vi.fn(),
    getExtractStatus: vi.fn(),
    startExtract: vi.fn(),
    startBatchScrape: vi.fn(),
    batchScrape: vi.fn(),
    getBatchScrapeStatus: vi.fn(),
    getBatchScrapeErrors: vi.fn(),
    cancelBatchScrape: vi.fn(),
    ...overrides,
  };
}

/**
 * Create a mock embed pipeline
 *
 * @param config - Optional configuration for mock methods
 * @returns Mock embed pipeline
 */
export function createMockEmbedPipeline(
  config?: MockEmbedPipelineConfig
): IEmbedPipeline {
  return {
    autoEmbed: config?.autoEmbed ?? vi.fn().mockResolvedValue(undefined),
    batchEmbed:
      config?.batchEmbed ??
      vi.fn().mockResolvedValue({ succeeded: 0, failed: 0, errors: [] }),
  } as IEmbedPipeline;
}

/**
 * Create a mock Qdrant service with common methods
 *
 * @returns Mock Qdrant service
 */
export function createMockQdrantService(): IQdrantService {
  return {
    ensureCollection: vi.fn(),
    deleteByUrl: vi.fn(),
    deleteByUrlAndSourceCommand: vi.fn().mockResolvedValue(undefined),
    deleteByDomain: vi.fn(),
    countByDomain: vi.fn(),
    countByUrl: vi.fn(),
    upsertPoints: vi.fn(),
    queryPoints: vi.fn(),
    scrollByUrl: vi.fn(),
    scrollAll: vi.fn(),
    getCollectionInfo: vi.fn(),
    countPoints: vi.fn(),
    deleteAll: vi.fn(),
  };
}

/**
 * Create a mock container with common dependencies
 *
 * @param mockClient - Optional mock Axon client
 * @param config - Optional configuration overrides
 * @param embedPipelineConfig - Optional embed pipeline configuration
 * @returns Mock container for testing
 */
export function createMockContainer(
  mockClient?: Partial<MockAxonClient>,
  config?: MockContainerConfig,
  embedPipelineConfig?: MockEmbedPipelineConfig
): IContainer {
  const fullMockClient = createMockAxonClient(mockClient);
  const mockEmbedPipeline = createMockEmbedPipeline(embedPipelineConfig);

  // Create mock HTTP client
  const mockFetch = vi.fn();
  const mockHttpClient = {
    fetchWithTimeout: vi.fn(
      async (url: string, init?: RequestInit, _timeoutMs?: number) => {
        if (mockFetch.getMockImplementation()) {
          return await mockFetch(url, init);
        }
        throw new Error(
          'No fetch mock configured - use mockFetch.mockResolvedValue() in your test'
        );
      }
    ),
    fetchWithRetry: vi.fn(async (url: string, init?: RequestInit) => {
      if (mockFetch.getMockImplementation()) {
        return await mockFetch(url, init);
      }
      throw new Error(
        'No fetch mock configured - use mockFetch.mockResolvedValue() in your test'
      );
    }),
    mockFetch,
  };

  // Freeze config to mirror ImmutableConfig behavior
  const frozenConfig = Object.freeze({
    apiKey: config?.apiKey ?? 'test-api-key',
    apiUrl: config?.apiUrl ?? 'https://api.axon.dev',
    teiUrl: config?.teiUrl ?? 'http://localhost:8080',
    qdrantUrl: config?.qdrantUrl ?? 'http://localhost:6333',
    qdrantCollection: config?.qdrantCollection ?? 'test_collection',
    userAgent: config?.userAgent,
    embedderWebhookUrl: config?.embedderWebhookUrl,
    embedderWebhookSecret: config?.embedderWebhookSecret,
    embedderWebhookPort: config?.embedderWebhookPort,
    embedderWebhookPath: config?.embedderWebhookPath,
  });

  return {
    config: frozenConfig,
    getAxonClient: vi.fn().mockReturnValue(fullMockClient),
    getEmbedPipeline: vi.fn().mockReturnValue(mockEmbedPipeline),
    getTeiService: vi.fn().mockReturnValue({
      getTeiInfo: vi.fn().mockResolvedValue({
        model_id: 'test-model',
        model_type: { embedding: { dim: 384 } },
      }),
      embed: vi.fn().mockResolvedValue([]),
      batchEmbed: vi.fn().mockResolvedValue([]),
    }),
    getQdrantService: vi.fn().mockReturnValue(createMockQdrantService()),
    getHttpClient: vi.fn().mockReturnValue(mockHttpClient),
    dispose: vi.fn().mockResolvedValue(undefined),
  } as unknown as IContainer;
}

/**
 * Setup common mocks for file system operations
 *
 * @returns Mock functions for fs operations
 */
export function setupFsMocks(): {
  existsSync: Mock;
  readFileSync: Mock;
  writeFileSync: Mock;
  unlinkSync: Mock;
  mkdirSync: Mock;
  chmodSync: Mock;
  promises: {
    access: Mock;
    readFile: Mock;
    writeFile: Mock;
    mkdir: Mock;
    unlink: Mock;
  };
} {
  return {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    mkdirSync: vi.fn(),
    chmodSync: vi.fn(),
    promises: {
      access: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn(),
      mkdir: vi.fn(),
      unlink: vi.fn(),
    },
  };
}

/**
 * Setup common mocks for os module
 *
 * @param homedir - Optional home directory path (defaults to '/home/testuser')
 * @returns Mock functions for os operations
 */
export function setupOsMocks(homedir = '/home/testuser') {
  return {
    homedir: vi.fn(() => homedir),
  };
}

// Output mocks moved to module-mocks.ts - use mockOutputModule() instead
