import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IContainer, IQdrantService } from '../../container/types';
import { createTestContainer } from '../utils/test-container';

vi.mock('../../utils/output', () => ({
  writeOutput: vi.fn(),
}));

describe('reconcile command', () => {
  let container: IContainer;
  let qdrant: IQdrantService;
  let tempDir: string;
  let originalAxonHome: string | undefined;

  beforeEach(async () => {
    originalAxonHome = process.env.AXON_HOME;

    qdrant = {
      ensureCollection: vi.fn(),
      upsertPoints: vi.fn(),
      deleteByUrl: vi.fn(),
      deleteByUrlAndSourceCommand: vi.fn().mockResolvedValue(undefined),
      queryPoints: vi.fn(),
      scrollByUrl: vi.fn(),
      deleteByDomain: vi.fn(),
      countByDomain: vi.fn(),
      getCollectionInfo: vi.fn(),
      scrollAll: vi.fn(),
      countPoints: vi.fn(),
      countByUrl: vi.fn(),
      deleteAll: vi.fn(),
    };

    container = createTestContainer(
      {
        map: vi.fn().mockResolvedValue({
          links: [{ url: 'https://docs.example.com/a' }],
        }),
      },
      {
        qdrantUrl: 'http://localhost:53333',
        qdrantCollection: 'axon',
      }
    );
    vi.spyOn(container, 'getQdrantService').mockReturnValue(qdrant);
    tempDir = await mkdtemp(join(tmpdir(), 'axon-reconcile-cmd-'));
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

  it('status returns tracked and missing counts', async () => {
    const { reconcileCrawlDomainState } = await import(
      '../../utils/crawl-reconciliation'
    );
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

    const { executeReconcileStatus } = await import('../../commands/reconcile');
    const result = await executeReconcileStatus(container, {
      domain: 'docs.example.com',
    });

    expect(result.success).toBe(true);
    expect(result.data?.domains[0]?.trackedUrls).toBe(2);
    expect(result.data?.domains[0]?.missingUrls).toBe(1);
    expect(result.data?.domains[0]?.eligibleForDeleteNow).toBe(1);
  });

  it('run preview does not delete from qdrant', async () => {
    const { executeReconcileRun } = await import('../../commands/reconcile');
    const result = await executeReconcileRun(container, {
      domain: 'docs.example.com',
      apply: false,
    });

    expect(result.success).toBe(true);
    expect(result.data?.apply).toBe(false);
    expect(result.data?.deletedCount).toBe(0);
    expect(qdrant.deleteByUrlAndSourceCommand).not.toHaveBeenCalled();
  });

  it('run --apply deletes eligible crawl urls with source scope', async () => {
    const { reconcileCrawlDomainState } = await import(
      '../../utils/crawl-reconciliation'
    );

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

    // second miss + long grace => eligible deletion
    const { executeReconcileRun } = await import('../../commands/reconcile');
    const result = await executeReconcileRun(container, {
      domain: 'docs.example.com',
      apply: true,
      now: new Date('2026-02-20T00:00:00.000Z'),
    });

    expect(result.success).toBe(true);
    expect(result.data?.apply).toBe(true);
    expect(result.data?.deletedCount).toBe(1);
    expect(qdrant.deleteByUrlAndSourceCommand).toHaveBeenCalledWith(
      'axon',
      'https://docs.example.com/b',
      'crawl'
    );
  });

  it('reset all requires --yes in non-interactive mode', async () => {
    const { handleReconcileResetCommand } = await import(
      '../../commands/reconcile'
    );
    process.exitCode = 0;
    await handleReconcileResetCommand(container, {
      yes: false,
      output: undefined,
      pretty: false,
      json: false,
    });

    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});
