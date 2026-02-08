/**
 * Tests for webhook server status endpoint
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IContainer } from '../../container/types';

vi.mock('../../container/DaemonContainerFactory', () => ({
  createDaemonContainer: vi.fn(),
}));

describe('webhook server status endpoint', () => {
  let queueDir: string;
  let cleanup: (() => Promise<void>) | undefined;
  let port: number;

  const getAvailablePort = async (): Promise<number> =>
    await new Promise((resolve, reject) => {
      const server = createServer();
      server.unref();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          server.close(() => reject(new Error('Failed to allocate port')));
          return;
        }
        server.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(address.port);
        });
      });
    });

  beforeEach(async () => {
    port = await getAvailablePort();
    queueDir = mkdtempSync(join(tmpdir(), 'firecrawl-queue-'));
    process.env.FIRECRAWL_EMBEDDER_QUEUE_DIR = queueDir;
    process.env.FIRECRAWL_EMBEDDER_WEBHOOK_PORT = String(port);
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
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
        embedderWebhookPort: port,
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

    // Start daemon in background and store cleanup function
    cleanup = await startEmbedderDaemon(mockContainer);

    // Wait a bit for server to start
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Make request to status endpoint
    const response = await fetch(`http://localhost:${port}/status`);
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
  });

  it('should return webhookConfigured: false when URL not set', async () => {
    const mockContainer: IContainer = {
      config: {
        apiKey: 'test-key',
        teiUrl: 'http://tei:8080',
        qdrantUrl: 'http://qdrant:6333',
        embedderWebhookUrl: undefined, // No webhook URL
        embedderWebhookPort: port,
        embedderWebhookPath: '/webhooks/crawl',
      },
      getFirecrawlClient: vi.fn(),
      getHttpClient: vi.fn(),
      getTeiService: vi.fn(),
      getQdrantService: vi.fn(),
      getEmbedPipeline: vi.fn(),
      dispose: vi.fn(),
    };

    // Update port for this test BEFORE importing to avoid module cache issues
    process.env.FIRECRAWL_EMBEDDER_WEBHOOK_PORT = String(port);
    vi.resetModules();

    const { startEmbedderDaemon } = await import(
      '../../utils/background-embedder'
    );

    // Start daemon in background and store cleanup function
    cleanup = await startEmbedderDaemon(mockContainer);

    // Wait for server to start
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Make request to status endpoint
    const response = await fetch(`http://localhost:${port}/status`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.webhookConfigured).toBe(false);
    expect(body.pendingJobs).toBe(0);
    expect(body.processingJobs).toBe(0);
  });
});
