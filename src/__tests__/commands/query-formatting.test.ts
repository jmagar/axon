import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleQueryCommand } from '../../commands/query';
import type {
  IContainer,
  IQdrantService,
  ITeiService,
} from '../../container/types';
import { createTestContainer } from '../utils/test-container';

describe('query output formatting', () => {
  let _stdoutSpy: MockInstance;
  let _stderrSpy: MockInstance;
  let writes: string[];
  let container: IContainer;
  let teiService: ITeiService;
  let qdrantService: IQdrantService;

  beforeEach(() => {
    writes = [];
    _stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk) => {
        writes.push(String(chunk));
        return true;
      });
    _stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    teiService = {
      getTeiInfo: vi.fn().mockResolvedValue({
        modelId: 'test',
        dimension: 1024,
        maxInput: 32768,
      }),
      embedBatch: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
      embedChunks: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
    };

    qdrantService = {
      ensureCollection: vi.fn().mockResolvedValue(undefined),
      deleteByUrl: vi.fn().mockResolvedValue(undefined),
      deleteByUrlAndSourceCommand: vi.fn().mockResolvedValue(undefined),
      deleteByDomain: vi.fn().mockResolvedValue(undefined),
      countByDomain: vi.fn().mockResolvedValue(0),
      upsertPoints: vi.fn().mockResolvedValue(undefined),
      queryPoints: vi.fn().mockResolvedValue([
        {
          id: 'id-high',
          vector: [0.1],
          score: 0.82,
          payload: {
            url: 'https://high.example.com/guide',
            title: 'High relevance',
            chunk_text:
              'This guide explains agent orchestration and query optimization in detail with practical patterns.',
            chunk_index: 0,
            total_chunks: 1,
            domain: 'high.example.com',
            source_command: 'crawl',
          },
        },
        {
          id: 'id-medium',
          vector: [0.1],
          score: 0.61,
          payload: {
            url: 'https://medium.example.com/reference',
            title: 'Medium relevance',
            chunk_text:
              'Reference page with related concepts and moderate overlap for the same query context.',
            chunk_index: 0,
            total_chunks: 1,
            domain: 'medium.example.com',
            source_command: 'crawl',
          },
        },
      ]),
      scrollByUrl: vi.fn().mockResolvedValue([]),
      getCollectionInfo: vi.fn().mockResolvedValue({
        status: 'green',
        vectorsCount: 0,
        pointsCount: 0,
        segmentsCount: 1,
        config: { dimension: 1024, distance: 'Cosine' },
      }),
      scrollAll: vi.fn().mockResolvedValue([]),
      countPoints: vi.fn().mockResolvedValue(0),
      countByUrl: vi.fn().mockResolvedValue(0),
      deleteAll: vi.fn().mockResolvedValue(undefined),
    };

    container = createTestContainer(undefined, {
      teiUrl: 'http://localhost:53001',
      qdrantUrl: 'http://localhost:53002',
      qdrantCollection: 'test_col',
    });

    vi.spyOn(container, 'getTeiService').mockReturnValue(teiService);
    vi.spyOn(container, 'getQdrantService').mockReturnValue(qdrantService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders style header structure and severity-first ordering', async () => {
    await handleQueryCommand(container, {
      query: 'agent orchestration',
      limit: 10,
      domain: 'example.com',
    });

    const output = writes.join('');
    expect(output).toContain('Query Results for "agent orchestration"');
    expect(output).toContain(
      'Showing 2 of 2 results | mode: compact | limit: 10'
    );
    expect(output).toContain(
      'Legend: ● high relevance  ◐ medium relevance  ○ low relevance'
    );
    expect(output).toContain(
      'Filters: mode=compact, limit=10, domain=example.com'
    );
    expect(output).toContain('As of (ET):');

    const highIndex = output.indexOf('https://high.example.com/guide');
    const mediumIndex = output.indexOf('https://medium.example.com/reference');
    expect(highIndex).toBeGreaterThan(-1);
    expect(mediumIndex).toBeGreaterThan(-1);
    expect(highIndex).toBeLessThan(mediumIndex);
  });

  it('keeps json output machine-friendly', async () => {
    await handleQueryCommand(container, {
      query: 'agent orchestration',
      limit: 2,
      json: true,
    });

    const output = writes.join('');
    expect(() => JSON.parse(output)).not.toThrow();
    expect(output).not.toContain('Query Results for');
    expect(output).not.toContain('Legend:');
    expect(output).not.toContain('Filters:');
  });
});
