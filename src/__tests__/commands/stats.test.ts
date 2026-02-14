/**
 * Tests for stats command
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeStats, handleStatsCommand } from '../../commands/stats';
import type { IContainer, IQdrantService } from '../../container/types';
import { writeOutput } from '../../utils/output';
import { createTestContainer } from '../utils/test-container';

vi.mock('../../utils/output', () => ({
  writeOutput: vi.fn(),
}));

describe('executeStats', () => {
  let container: IContainer;
  let mockQdrantService: IQdrantService;

  beforeEach(() => {
    mockQdrantService = {
      ensureCollection: vi.fn(),
      deleteByUrl: vi.fn(),
      deleteByDomain: vi.fn(),
      countByDomain: vi.fn(),
      countByUrl: vi.fn(),
      upsertPoints: vi.fn(),
      queryPoints: vi.fn(),
      scrollByUrl: vi.fn(),
      scrollAll: vi.fn().mockResolvedValue([]),
      getCollectionInfo: vi.fn().mockResolvedValue({
        status: 'green',
        vectorsCount: 1000,
        pointsCount: 500,
        segmentsCount: 3,
        config: { dimension: 768, distance: 'Cosine' },
      }),
      countPoints: vi.fn().mockResolvedValue(1000),
      deleteAll: vi.fn(),
    };

    container = createTestContainer(undefined, {
      qdrantUrl: 'http://localhost:53333',
      qdrantCollection: 'test_col',
    });

    vi.spyOn(container, 'getQdrantService').mockReturnValue(mockQdrantService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return collection stats', async () => {
    vi.mocked(mockQdrantService.scrollAll).mockResolvedValue([
      {
        id: 'p1',
        payload: {
          domain: 'example.com',
          source_command: 'crawl',
          url: 'https://a.com',
        },
      },
      {
        id: 'p2',
        payload: {
          domain: 'example.com',
          source_command: 'crawl',
          url: 'https://a.com',
        },
      },
      {
        id: 'p3',
        payload: {
          domain: 'other.com',
          source_command: 'scrape',
          url: 'https://b.com',
        },
      },
    ]);

    const result = await executeStats(container, {});

    expect(result.success).toBe(true);
    expect(result.data?.collection).toBe('test_col');
    expect(result.data?.status).toBe('green');
    expect(result.data?.dimension).toBe(768);
    expect(result.data?.byDomain).toHaveLength(2);
    expect(result.data?.bySourceCommand).toHaveLength(2);
  });

  it('should fail when QDRANT_URL not configured', async () => {
    const badContainer = createTestContainer(undefined, {
      qdrantUrl: undefined,
    });

    const result = await executeStats(badContainer, {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('QDRANT_URL');
  });

  it('should aggregate by domain correctly', async () => {
    vi.mocked(mockQdrantService.scrollAll).mockResolvedValue([
      {
        id: 'p1',
        payload: {
          domain: 'a.com',
          source_command: 'crawl',
          url: 'https://a.com/1',
        },
      },
      {
        id: 'p2',
        payload: {
          domain: 'a.com',
          source_command: 'crawl',
          url: 'https://a.com/2',
        },
      },
      {
        id: 'p3',
        payload: {
          domain: 'b.com',
          source_command: 'scrape',
          url: 'https://b.com/1',
        },
      },
    ]);

    const result = await executeStats(container, {});

    const aDomain = result.data?.byDomain.find((d) => d.domain === 'a.com');
    expect(aDomain?.vectorCount).toBe(2);
    expect(aDomain?.sourceCount).toBe(2);
  });
});

describe('handleStatsCommand output', () => {
  it('should include title, summary, freshness, and tables', async () => {
    const mockQdrantService: IQdrantService = {
      ensureCollection: vi.fn(),
      deleteByUrl: vi.fn(),
      deleteByDomain: vi.fn(),
      countByDomain: vi.fn(),
      countByUrl: vi.fn(),
      upsertPoints: vi.fn(),
      queryPoints: vi.fn(),
      scrollByUrl: vi.fn(),
      scrollAll: vi.fn().mockResolvedValue([
        {
          id: 'p1',
          payload: {
            domain: 'example.com',
            source_command: 'crawl',
            url: 'https://example.com/a',
          },
        },
      ]),
      getCollectionInfo: vi.fn().mockResolvedValue({
        status: 'green',
        vectorsCount: 1,
        pointsCount: 1,
        segmentsCount: 1,
        config: { dimension: 768, distance: 'Cosine' },
      }),
      countPoints: vi.fn().mockResolvedValue(1),
      deleteAll: vi.fn(),
    };
    const container = createTestContainer(undefined, {
      qdrantUrl: 'http://localhost:53333',
      qdrantCollection: 'test_col',
    });
    vi.spyOn(container, 'getQdrantService').mockReturnValue(mockQdrantService);

    await handleStatsCommand(container, {
      verbose: true,
      collection: 'test_col',
    });

    const output = vi.mocked(writeOutput).mock.calls.at(-1)?.[0] as string;
    expect(output).toContain('Vector Database Statistics');
    expect(output).toContain(
      'Collection: test_col | Status: green | Vectors: 1'
    );
    expect(output).toContain('Filters: collection=test_col, verbose=true');
    expect(output).toMatch(
      /As of \(EST\): \d{2}:\d{2}:\d{2} \| \d{2}\/\d{2}\/\d{4}/
    );
    expect(output).toContain('By domain');
    expect(output).toContain('By source command');
  });

  it('should not show dash row in overview table when database is empty', async () => {
    const mockQdrantService: IQdrantService = {
      ensureCollection: vi.fn(),
      deleteByUrl: vi.fn(),
      deleteByDomain: vi.fn(),
      countByDomain: vi.fn(),
      countByUrl: vi.fn(),
      upsertPoints: vi.fn(),
      queryPoints: vi.fn(),
      scrollByUrl: vi.fn(),
      scrollAll: vi.fn().mockResolvedValue([]),
      getCollectionInfo: vi.fn().mockResolvedValue({
        status: 'green',
        vectorsCount: 0,
        pointsCount: 0,
        segmentsCount: 0,
        config: { dimension: 768, distance: 'Cosine' },
      }),
      countPoints: vi.fn().mockResolvedValue(0),
      deleteAll: vi.fn(),
    };
    const container = createTestContainer(undefined, {
      qdrantUrl: 'http://localhost:53333',
      qdrantCollection: 'test_col',
    });
    vi.spyOn(container, 'getQdrantService').mockReturnValue(mockQdrantService);

    await handleStatsCommand(container, {
      collection: 'test_col',
    });

    const output = vi.mocked(writeOutput).mock.calls.at(-1)?.[0] as string;

    // Should NOT contain em-dash placeholders (—) in overview table
    // Bug: formatAlignedTable defaults emptyWithDashRow=true, creating a row like "—  —"
    const lines = output.split('\n');
    const metricHeaderIdx = lines.findIndex((l) => l.includes('Metric'));
    const byDomainIdx = lines.findIndex(
      (l, i) => i > metricHeaderIdx && l.includes('By domain')
    );

    const overviewLines = lines.slice(metricHeaderIdx, byDomainIdx);

    // Filter to data rows (skip header and divider which is all dashes)
    const dataRows = overviewLines.slice(2).filter((l) => l.trim().length > 0);

    // No data row should contain only em-dashes (—)
    const hasEmDashRow = dataRows.some((line) => {
      const cells = line
        .split(/\s{2,}/)
        .map((c) => c.trim())
        .filter(Boolean);
      return cells.length > 0 && cells.every((cell) => cell === '—');
    });

    expect(hasEmDashRow).toBe(false);
  });
});
