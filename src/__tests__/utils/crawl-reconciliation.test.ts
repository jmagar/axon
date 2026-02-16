import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MISSING_GRACE_MS,
  DEFAULT_MISSING_THRESHOLD,
  listReconciliationStatus,
  reconcileCrawlDomainState,
  resetReconciliationState,
} from '../../utils/crawl-reconciliation';

describe('crawl reconciliation', () => {
  let tempDir: string;
  let originalAxonHome: string | undefined;

  beforeEach(async () => {
    originalAxonHome = process.env.AXON_HOME;
    tempDir = await mkdtemp(join(tmpdir(), 'axon-reconcile-'));
    process.env.AXON_HOME = tempDir;
  });

  afterEach(async () => {
    if (originalAxonHome === undefined) {
      delete process.env.AXON_HOME;
    } else {
      process.env.AXON_HOME = originalAxonHome;
    }
    await rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('deletes only after threshold and grace period by default', async () => {
    const day1 = new Date('2026-02-01T00:00:00.000Z');
    const day2 = new Date('2026-02-02T00:00:00.000Z');
    const day9 = new Date('2026-02-09T00:00:00.000Z');

    await reconcileCrawlDomainState({
      domain: 'docs.example.com',
      seenUrls: ['https://docs.example.com/a', 'https://docs.example.com/b'],
      now: day1,
    });

    const firstMiss = await reconcileCrawlDomainState({
      domain: 'docs.example.com',
      seenUrls: ['https://docs.example.com/a'],
      now: day2,
    });
    expect(firstMiss.urlsToDelete).toEqual([]);

    const secondMissAfterGrace = await reconcileCrawlDomainState({
      domain: 'docs.example.com',
      seenUrls: ['https://docs.example.com/a'],
      now: day9,
    });
    expect(secondMissAfterGrace.urlsToDelete).toEqual([
      'https://docs.example.com/b',
    ]);
  });

  it('hardSync deletes missing urls immediately', async () => {
    await reconcileCrawlDomainState({
      domain: 'docs.example.com',
      seenUrls: ['https://docs.example.com/a', 'https://docs.example.com/b'],
      now: new Date('2026-02-01T00:00:00.000Z'),
    });

    const hardSync = await reconcileCrawlDomainState({
      domain: 'docs.example.com',
      seenUrls: ['https://docs.example.com/a'],
      hardSync: true,
      now: new Date('2026-02-02T00:00:00.000Z'),
    });

    expect(hardSync.urlsToDelete).toEqual(['https://docs.example.com/b']);
  });

  it('exports documented defaults', () => {
    expect(DEFAULT_MISSING_THRESHOLD).toBe(2);
    expect(DEFAULT_MISSING_GRACE_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('supports dry-run reconciliation without mutating store', async () => {
    await reconcileCrawlDomainState({
      domain: 'docs.example.com',
      seenUrls: ['https://docs.example.com/a', 'https://docs.example.com/b'],
      now: new Date('2026-02-01T00:00:00.000Z'),
    });

    const preview = await reconcileCrawlDomainState({
      domain: 'docs.example.com',
      seenUrls: ['https://docs.example.com/a'],
      dryRun: true,
      now: new Date('2026-02-10T00:00:00.000Z'),
    });
    expect(preview.urlsToDelete).toEqual([]);

    const status = await listReconciliationStatus({
      domain: 'docs.example.com',
    });
    expect(status[0].missingUrls).toBe(0);
  });

  it('lists status and reset state by domain', async () => {
    await reconcileCrawlDomainState({
      domain: 'docs.example.com',
      seenUrls: ['https://docs.example.com/a', 'https://docs.example.com/b'],
      now: new Date('2026-02-01T00:00:00.000Z'),
    });
    await reconcileCrawlDomainState({
      domain: 'docs.example.com',
      seenUrls: ['https://docs.example.com/a'],
      now: new Date('2026-02-02T00:00:00.000Z'),
    });

    const statuses = await listReconciliationStatus({
      domain: 'docs.example.com',
      now: new Date('2026-02-10T00:00:00.000Z'),
    });
    expect(statuses).toHaveLength(1);
    expect(statuses[0].trackedUrls).toBe(2);
    expect(statuses[0].missingUrls).toBe(1);
    expect(statuses[0].eligibleForDeleteNow).toBe(1);

    const resetResult = await resetReconciliationState('docs.example.com');
    expect(resetResult.removedDomains).toBe(1);
    expect(resetResult.removedUrls).toBe(2);

    const afterReset = await listReconciliationStatus({
      domain: 'docs.example.com',
    });
    expect(afterReset).toHaveLength(0);
  });
});
