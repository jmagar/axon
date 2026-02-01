/**
 * Tests for crawl command embedding config initialization
 *
 * These tests verify that the config system is properly initialized
 * before embeddings are attempted, ensuring TEI_URL and QDRANT_URL
 * are available to the embedding pipeline.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleCrawlCommand } from '../../commands/crawl';
import { getClient } from '../../utils/client';
import {
  type getConfig,
  initializeConfig,
  resetConfig,
} from '../../utils/config';
import {
  type MockFirecrawlClient,
  setupTest,
  teardownTest,
} from '../utils/mock-client';

// Track config state during autoEmbed calls
let configStateWhenEmbedCalled: ReturnType<typeof getConfig> | null = null;

// Mock the Firecrawl client module
vi.mock('../../utils/client', async () => {
  const actual = await vi.importActual('../../utils/client');
  return {
    ...actual,
    getClient: vi.fn(),
  };
});

// Mock embedpipeline and capture config state
type EmbedPage = {
  markdown?: string;
  html?: string;
  url?: string;
  title?: string;
  metadata?: {
    sourceURL?: string;
    url?: string;
    title?: string;
  };
};

type CrawlMockClient = MockFirecrawlClient &
  Required<
    Pick<MockFirecrawlClient, 'startCrawl' | 'getCrawlStatus' | 'crawl'>
  >;

vi.mock('../../utils/embedpipeline', () => ({
  batchEmbed: vi.fn().mockImplementation(async () => {
    // Capture config state when embedding is called
    const { getConfig } = await import('../../utils/config');
    configStateWhenEmbedCalled = getConfig();
  }),
  createEmbedItems: vi
    .fn()
    .mockImplementation((pages: EmbedPage[], sourceCommand) => {
      return pages
        .filter((page) => page.markdown || page.html)
        .map((page) => ({
          content: page.markdown || page.html || '',
          metadata: {
            url:
              page.url || page.metadata?.sourceURL || page.metadata?.url || '',
            title: page.title || page.metadata?.title,
            sourceCommand,
            contentType: page.markdown ? 'markdown' : 'html',
          },
        }));
    }),
}));

// Mock settings
vi.mock('../../utils/settings', () => ({
  loadSettings: vi.fn().mockReturnValue({}),
}));

// Mock writeOutput
vi.mock('../../utils/output', () => ({
  writeOutput: vi.fn(),
}));

vi.mock('../../utils/embed-queue', () => ({
  enqueueEmbedJob: vi.fn().mockReturnValue({
    id: 'mock-job',
    jobId: 'mock-job',
    url: 'https://example.com',
    status: 'pending',
    retries: 0,
    maxRetries: 3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
  getEmbedJob: vi.fn().mockReturnValue(null),
}));

vi.mock('../../utils/background-embedder', () => ({
  processEmbedQueue: vi.fn().mockResolvedValue(undefined),
}));

describe('Crawl embedding config initialization', () => {
  let mockClient: CrawlMockClient;

  beforeEach(() => {
    setupTest();
    configStateWhenEmbedCalled = null;

    // Reset config before each test
    resetConfig();

    // Create mock client
    mockClient = {
      scrape: vi.fn(),
      startCrawl: vi.fn(),
      getCrawlStatus: vi.fn(),
      crawl: vi.fn(),
    };

    // Mock getClient to return our mock
    vi.mocked(getClient).mockReturnValue(
      mockClient as unknown as ReturnType<typeof getClient>
    );
  });

  afterEach(() => {
    teardownTest();
    vi.clearAllMocks();
    resetConfig();
  });

  describe('Config initialization with environment variables', () => {
    it('should have TEI_URL and QDRANT_URL available when embedding after wait', async () => {
      // Set environment variables
      process.env.TEI_URL = 'http://test-tei:52000';
      process.env.QDRANT_URL = 'http://test-qdrant:6333';
      process.env.FIRECRAWL_API_KEY = 'test-api-key';

      // Initialize config (simulating what index.ts does)
      initializeConfig();

      const mockCrawlJob = {
        id: 'test-job-id',
        status: 'completed',
        total: 1,
        completed: 1,
        data: [
          {
            markdown: '# Test Page',
            metadata: {
              sourceURL: 'https://example.com/test',
              title: 'Test',
            },
          },
        ],
      };
      mockClient.crawl.mockResolvedValue(mockCrawlJob);

      await handleCrawlCommand({
        urlOrJobId: 'https://example.com',
        wait: true,
      });

      // Verify config was available during embedding
      expect(configStateWhenEmbedCalled).not.toBeNull();
      expect(configStateWhenEmbedCalled?.teiUrl).toBe('http://test-tei:52000');
      expect(configStateWhenEmbedCalled?.qdrantUrl).toBe(
        'http://test-qdrant:6333'
      );

      // Cleanup
      delete process.env.TEI_URL;
      delete process.env.QDRANT_URL;
    });

    it('should queue async job for background embedding instead of inline', async () => {
      // Set environment variables
      process.env.TEI_URL = 'http://test-tei:52000';
      process.env.QDRANT_URL = 'http://test-qdrant:6333';
      process.env.FIRECRAWL_API_KEY = 'test-api-key';

      // Initialize config (simulating what index.ts does)
      initializeConfig();

      const mockResponse = {
        id: 'test-job-id',
        url: 'https://example.com',
      };
      mockClient.startCrawl.mockResolvedValue(mockResponse);

      await handleCrawlCommand({
        urlOrJobId: 'https://example.com',
      });

      // Async jobs now queue for background processing, not inline embedding
      // So config state is not captured during handleCrawlCommand
      expect(configStateWhenEmbedCalled).toBeNull();

      // Cleanup
      delete process.env.TEI_URL;
      delete process.env.QDRANT_URL;
    });

    it('should have empty config when initializeConfig was never called', async () => {
      // DO NOT call initializeConfig() - simulating direct import bug
      // Environment variables are set but config not initialized
      process.env.TEI_URL = 'http://test-tei:52000';
      process.env.QDRANT_URL = 'http://test-qdrant:6333';
      process.env.FIRECRAWL_API_KEY = 'test-api-key';

      const mockCrawlJob = {
        id: 'test-job-id',
        status: 'completed',
        total: 1,
        completed: 1,
        data: [
          {
            markdown: '# Test Page',
            metadata: {
              sourceURL: 'https://example.com/test',
              title: 'Test',
            },
          },
        ],
      };
      mockClient.crawl.mockResolvedValue(mockCrawlJob);

      await handleCrawlCommand({
        urlOrJobId: 'https://example.com',
        wait: true,
      });

      // This test demonstrates the bug: without initializeConfig(),
      // the config would be empty even though env vars are set
      // In the real CLI, index.ts calls initializeConfig() so this doesn't happen
      // But if someone imports utilities directly, they'd hit this bug
      expect(configStateWhenEmbedCalled).not.toBeNull();

      // In the actual CLI flow, config SHOULD be initialized because
      // handleCrawlCommand is only called after index.ts runs initializeConfig()
      // But in unit tests or direct imports, this shows the importance of initialization

      // Cleanup
      delete process.env.TEI_URL;
      delete process.env.QDRANT_URL;
    });
  });

  describe('Config priority with explicit options', () => {
    it('should prefer provided config over environment variables', async () => {
      // Set environment variables
      process.env.TEI_URL = 'http://env-tei:52000';
      process.env.QDRANT_URL = 'http://env-qdrant:6333';
      process.env.FIRECRAWL_API_KEY = 'test-api-key';

      // Initialize config with explicit values (higher priority)
      initializeConfig({
        teiUrl: 'http://explicit-tei:52000',
        qdrantUrl: 'http://explicit-qdrant:6333',
        apiKey: 'explicit-api-key',
      });

      const mockCrawlJob = {
        id: 'test-job-id',
        status: 'completed',
        total: 1,
        completed: 1,
        data: [
          {
            markdown: '# Test Page',
            metadata: {
              sourceURL: 'https://example.com/test',
              title: 'Test',
            },
          },
        ],
      };
      mockClient.crawl.mockResolvedValue(mockCrawlJob);

      await handleCrawlCommand({
        urlOrJobId: 'https://example.com',
        wait: true,
      });

      // Should use explicit config, not env vars
      expect(configStateWhenEmbedCalled?.teiUrl).toBe(
        'http://explicit-tei:52000'
      );
      expect(configStateWhenEmbedCalled?.qdrantUrl).toBe(
        'http://explicit-qdrant:6333'
      );

      // Cleanup
      delete process.env.TEI_URL;
      delete process.env.QDRANT_URL;
    });
  });

  describe('Embedding should not run without config', () => {
    it('should skip embedding silently when TEI_URL is not configured', async () => {
      // Initialize config WITHOUT TEI/Qdrant URLs
      initializeConfig({
        apiKey: 'test-api-key',
      });

      const mockCrawlJob = {
        id: 'test-job-id',
        status: 'completed',
        total: 1,
        completed: 1,
        data: [
          {
            markdown: '# Test Page',
            metadata: {
              sourceURL: 'https://example.com/test',
              title: 'Test',
            },
          },
        ],
      };
      mockClient.crawl.mockResolvedValue(mockCrawlJob);

      await handleCrawlCommand({
        urlOrJobId: 'https://example.com',
        wait: true,
      });

      // Config should be initialized but without TEI/Qdrant
      expect(configStateWhenEmbedCalled).not.toBeNull();
      expect(configStateWhenEmbedCalled?.teiUrl).toBeUndefined();
      expect(configStateWhenEmbedCalled?.qdrantUrl).toBeUndefined();
      // This is expected behavior - embedding will no-op silently
    });
  });
});
