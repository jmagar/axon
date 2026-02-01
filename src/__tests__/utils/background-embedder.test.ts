/**
 * Tests for background embedder stale job processing
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/embed-queue', () => ({
  getStalePendingJobs: vi.fn(),
  markJobProcessing: vi.fn(),
  markJobCompleted: vi.fn(),
  markJobFailed: vi.fn(),
  updateEmbedJob: vi.fn(),
  cleanupOldJobs: vi.fn().mockReturnValue(0),
}));

vi.mock('../../utils/config', () => ({
  getConfig: vi.fn().mockReturnValue({
    teiUrl: 'http://tei:8080',
    qdrantUrl: 'http://qdrant:6333',
  }),
  initializeConfig: vi.fn(),
}));

vi.mock('../../utils/client', () => ({
  getClient: vi.fn(),
}));

vi.mock('../../utils/embedpipeline', () => ({
  createEmbedItems: vi
    .fn()
    .mockReturnValue([
      { content: 'hello', metadata: { url: 'https://example.com' } },
    ]),
  batchEmbed: vi.fn().mockResolvedValue(undefined),
}));

describe('processStaleJobsOnce', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should process stale pending jobs', async () => {
    const { getStalePendingJobs, markJobProcessing, markJobCompleted } =
      await import('../../utils/embed-queue');
    const { getClient } = await import('../../utils/client');

    vi.mocked(getStalePendingJobs).mockReturnValue([
      {
        id: 'job-1',
        jobId: 'job-1',
        url: 'https://example.com',
        status: 'pending',
        retries: 0,
        maxRetries: 3,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    vi.mocked(getClient).mockReturnValue({
      getCrawlStatus: vi.fn().mockResolvedValue({
        status: 'completed',
        data: [
          {
            markdown: 'hello',
            metadata: { sourceURL: 'https://example.com' },
          },
        ],
      }),
    } as unknown as ReturnType<typeof getClient>);

    const { processStaleJobsOnce } = await import(
      '../../utils/background-embedder'
    );

    const processed = await processStaleJobsOnce(60_000);

    expect(processed).toBe(1);
    expect(markJobProcessing).toHaveBeenCalledWith('job-1');
    expect(markJobCompleted).toHaveBeenCalledWith('job-1');
  });
});
