/**
 * Tests for webhook server status endpoint
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IContainer } from '../../container/types';

vi.mock('../../utils/config', () => ({
  getConfig: vi.fn().mockReturnValue({
    teiUrl: 'http://tei:8080',
    qdrantUrl: 'http://qdrant:6333',
  }),
  initializeConfig: vi.fn(),
}));

vi.mock('../../utils/embedpipeline', () => ({
  createEmbedItems: vi
    .fn()
    .mockReturnValue([
      { content: 'hello', metadata: { url: 'https://example.com' } },
    ]),
  batchEmbed: vi.fn().mockResolvedValue({ succeeded: 1, failed: 0 }),
}));

vi.mock('../../container/DaemonContainerFactory', () => ({
  createDaemonContainer: vi.fn(),
}));

describe('webhook server status endpoint', () => {
  let queueDir: string;

  beforeEach(() => {
    queueDir = mkdtempSync(join(tmpdir(), 'firecrawl-queue-'));
    process.env.FIRECRAWL_EMBEDDER_QUEUE_DIR = queueDir;
    process.env.FIRECRAWL_EMBEDDER_WEBHOOK_PORT = '53999'; // Use a different port for tests
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(queueDir, { recursive: true, force: true });
    delete process.env.FIRECRAWL_EMBEDDER_QUEUE_DIR;
    delete process.env.FIRECRAWL_EMBEDDER_WEBHOOK_PORT;
    vi.resetModules();
  });

  it('should return queue stats at /status endpoint with webhook configured', async () => {
    const now = Date.now();
    const jobs = [
      {
        id: 'job-1',
        jobId: 'job-1',
        url: 'https://example.com/1',
        status: 'pending',
        retries: 0,
        maxRetries: 3,
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
      },
      {
        id: 'job-2',
        jobId: 'job-2',
        url: 'https://example.com/2',
        status: 'pending',
        retries: 0,
        maxRetries: 3,
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
      },
      {
        id: 'job-3',
        jobId: 'job-3',
        url: 'https://example.com/3',
        status: 'processing',
        retries: 0,
        maxRetries: 3,
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
      },
    ];

    for (const job of jobs) {
      writeFileSync(
        join(queueDir, `${job.jobId}.json`),
        JSON.stringify(job, null, 2)
      );
    }

    const mockContainer: IContainer = {
      config: {
        apiKey: 'test-key',
        teiUrl: 'http://tei:8080',
        qdrantUrl: 'http://qdrant:6333',
        embedderWebhookUrl: 'https://example.com/webhook',
        embedderWebhookPort: 53999,
        embedderWebhookPath: '/webhooks/crawl',
      },
      getFirecrawlClient: vi.fn(),
      getHttpClient: vi.fn(),
      getTeiService: vi.fn(),
      getQdrantService: vi.fn(),
      getEmbedPipeline: vi.fn(),
      dispose: vi.fn(),
    };

    const { startEmbedderDaemon } = await import(
      '../../utils/background-embedder'
    );

    // Start daemon in background (don't await, it runs forever)
    const daemonPromise = startEmbedderDaemon(mockContainer);

    // Wait a bit for server to start
    await new Promise((resolve) => setTimeout(resolve, 100));

    try {
      // Make request to status endpoint
      const response = await fetch('http://localhost:53999/status');
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        webhookConfigured: true,
        pollingIntervalMs: expect.any(Number),
        staleThresholdMs: expect.any(Number),
        pendingJobs: 2,
        processingJobs: 1,
      });
      expect(body.pollingIntervalMs).toBeGreaterThan(0);
      expect(body.staleThresholdMs).toBeGreaterThan(0);
    } finally {
      // Cleanup: we can't easily stop the server, but the test process will clean up
      void daemonPromise;
    }
  });

  it('should return webhookConfigured: false when URL not set', async () => {
    const mockContainer: IContainer = {
      config: {
        apiKey: 'test-key',
        teiUrl: 'http://tei:8080',
        qdrantUrl: 'http://qdrant:6333',
        embedderWebhookUrl: undefined, // No webhook URL
        embedderWebhookPort: 53998,
        embedderWebhookPath: '/webhooks/crawl',
      },
      getFirecrawlClient: vi.fn(),
      getHttpClient: vi.fn(),
      getTeiService: vi.fn(),
      getQdrantService: vi.fn(),
      getEmbedPipeline: vi.fn(),
      dispose: vi.fn(),
    };

    const { startEmbedderDaemon } = await import(
      '../../utils/background-embedder'
    );

    // Update port for this test
    process.env.FIRECRAWL_EMBEDDER_WEBHOOK_PORT = '53998';

    // Start daemon in background
    const daemonPromise = startEmbedderDaemon(mockContainer);

    // Wait for server to start
    await new Promise((resolve) => setTimeout(resolve, 100));

    try {
      // Make request to status endpoint
      const response = await fetch('http://localhost:53998/status');
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.webhookConfigured).toBe(false);
      expect(body.pendingJobs).toBe(0);
      expect(body.processingJobs).toBe(0);
    } finally {
      void daemonPromise;
    }
  });
});
