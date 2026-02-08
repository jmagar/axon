/**
 * Tests for crawl command embedding config initialization
 *
 * These tests verify that the config is properly passed through the DI container
 * before embeddings are attempted, ensuring TEI_URL and QDRANT_URL
 * are available to the embedding pipeline.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleCrawlCommand } from '../../commands/crawl';
import type { MockFirecrawlClient } from '../utils/mock-client';
import { createTestContainer } from '../utils/test-container';

// Mock embedpipeline and capture config state

type CrawlMockClient = MockFirecrawlClient &
  Required<
    Pick<MockFirecrawlClient, 'startCrawl' | 'getCrawlStatus' | 'crawl'>
  >;

// Mock settings
vi.mock('../../utils/settings', () => ({
  loadSettings: vi.fn().mockReturnValue({}),
}));

// Mock writeOutput
vi.mock('../../utils/output', () => ({
  writeOutput: vi.fn(),
}));

vi.mock('../../utils/embed-queue', () => ({
  enqueueEmbedJob: vi.fn().mockResolvedValue({
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
    // Create mock client
    mockClient = {
      scrape: vi.fn(),
      startCrawl: vi.fn(),
      getCrawlStatus: vi.fn(),
      crawl: vi.fn(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Config initialization with container', () => {
    it('should have TEI_URL and QDRANT_URL available when embedding after wait', async () => {
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

      // Create a mock autoEmbed to track calls
      const mockAutoEmbed = vi.fn().mockResolvedValue(undefined);

      // Create container with specific TEI and Qdrant URLs
      const container = createTestContainer(mockClient, {
        apiKey: 'test-api-key',
        teiUrl: 'http://test-tei:52000',
        qdrantUrl: 'http://test-qdrant:6333',
        mockAutoEmbed,
      });

      await handleCrawlCommand(container, {
        urlOrJobId: 'https://example.com',
        wait: true,
      });

      // Verify container has correct config
      expect(container.config.teiUrl).toBe('http://test-tei:52000');
      expect(container.config.qdrantUrl).toBe('http://test-qdrant:6333');

      // Verify autoEmbed was called (embedding happened)
      expect(mockAutoEmbed).toHaveBeenCalled();
    });

    it('should queue async job for background embedding instead of inline', async () => {
      const mockResponse = {
        id: 'test-job-id',
        url: 'https://example.com',
      };
      mockClient.startCrawl.mockResolvedValue(mockResponse);

      // Create a mock autoEmbed to track calls
      const mockAutoEmbed = vi.fn().mockResolvedValue(undefined);

      const container = createTestContainer(mockClient, {
        apiKey: 'test-api-key',
        teiUrl: 'http://test-tei:52000',
        qdrantUrl: 'http://test-qdrant:6333',
        mockAutoEmbed,
      });

      await handleCrawlCommand(container, {
        urlOrJobId: 'https://example.com',
      });

      // Async jobs now queue for background processing, not inline embedding
      // So autoEmbed should NOT be called during handleCrawlCommand
      expect(mockAutoEmbed).not.toHaveBeenCalled();
    });

    it('should use default config when no custom config provided', async () => {
      // With DI container, config is always initialized when container is created
      // This test verifies that default values are used when not explicitly provided
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

      // Create a mock autoEmbed to track calls
      const mockAutoEmbed = vi.fn().mockResolvedValue(undefined);

      // Create container without explicit TEI/Qdrant URLs (will use defaults)
      const container = createTestContainer(mockClient, {
        apiKey: 'test-api-key',
        mockAutoEmbed,
      });

      await handleCrawlCommand(container, {
        urlOrJobId: 'https://example.com',
        wait: true,
      });

      // Config should be initialized with defaults from createTestContainer
      expect(container.config.teiUrl).toBe('http://localhost:8080');
      expect(container.config.qdrantUrl).toBe('http://localhost:6333');

      // Verify autoEmbed was called (embedding happened)
      expect(mockAutoEmbed).toHaveBeenCalled();
    });
  });

  describe('Config priority with explicit options', () => {
    it('should prefer provided config over defaults', async () => {
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

      // Create a mock autoEmbed to track calls
      const mockAutoEmbed = vi.fn().mockResolvedValue(undefined);

      // Create container with explicit config (higher priority than defaults)
      const container = createTestContainer(mockClient, {
        apiKey: 'explicit-api-key',
        teiUrl: 'http://explicit-tei:52000',
        qdrantUrl: 'http://explicit-qdrant:6333',
        mockAutoEmbed,
      });

      await handleCrawlCommand(container, {
        urlOrJobId: 'https://example.com',
        wait: true,
      });

      // Should use explicit config, not defaults
      expect(container.config.teiUrl).toBe('http://explicit-tei:52000');
      expect(container.config.qdrantUrl).toBe('http://explicit-qdrant:6333');

      // Verify autoEmbed was called (embedding happened)
      expect(mockAutoEmbed).toHaveBeenCalled();
    });
  });

  describe('Embedding with default config values', () => {
    it('should have default config values when TEI/Qdrant URLs not explicitly set', async () => {
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

      // Create a mock autoEmbed to track calls
      const mockAutoEmbed = vi.fn().mockResolvedValue(undefined);

      // Create container without specifying TEI/Qdrant URLs
      // createTestContainer provides defaults (http://localhost:8080 and http://localhost:6333)
      const container = createTestContainer(mockClient, {
        apiKey: 'test-api-key',
        mockAutoEmbed,
        // Note: not passing teiUrl/qdrantUrl, so defaults are used
      });

      await handleCrawlCommand(container, {
        urlOrJobId: 'https://example.com',
        wait: true,
      });

      // Config should have default values from createTestContainer
      expect(container.config.teiUrl).toBe('http://localhost:8080');
      expect(container.config.qdrantUrl).toBe('http://localhost:6333');

      // autoEmbed should be called with these default config values
      // In real usage, if TEI is not available, the pipeline will handle the error gracefully
      expect(mockAutoEmbed).toHaveBeenCalled();
    });
  });
});
