import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleEmbedCommand } from '../../commands/embed';
import type {
  IContainer,
  IQdrantService,
  ITeiService,
} from '../../container/types';
import { writeOutput } from '../../utils/output';
import type { MockAxonClient } from '../utils/mock-client';
import { createTestContainer } from '../utils/test-container';

vi.mock('../../utils/output', () => ({
  writeOutput: vi.fn(),
  validateOutputPath: vi.fn(),
}));

describe('embed output formatting', () => {
  let mockClient: Partial<MockAxonClient>;
  let container: IContainer;
  let mockTeiService: ITeiService;
  let mockQdrantService: IQdrantService;

  beforeEach(() => {
    mockClient = {
      scrape: vi.fn().mockResolvedValue({
        markdown: '# Test\n\nBody',
        metadata: { title: 'Test' },
      }),
    };

    mockTeiService = {
      getTeiInfo: vi.fn().mockResolvedValue({
        modelId: 'test',
        dimension: 1024,
        maxInput: 32768,
      }),
      embedBatch: vi.fn().mockResolvedValue([[0.1, 0.2]]),
      embedChunks: vi.fn().mockResolvedValue([[0.1, 0.2]]),
    };

    mockQdrantService = {
      ensureCollection: vi.fn().mockResolvedValue(undefined),
      deleteByUrl: vi.fn().mockResolvedValue(undefined),
      deleteByUrlAndSourceCommand: vi.fn().mockResolvedValue(undefined),
      deleteByDomain: vi.fn().mockResolvedValue(undefined),
      countByDomain: vi.fn().mockResolvedValue(0),
      upsertPoints: vi.fn().mockResolvedValue(undefined),
      queryPoints: vi.fn().mockResolvedValue([]),
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

    container = createTestContainer(mockClient, {
      apiKey: 'test-api-key',
      apiUrl: 'https://api.axon.dev',
      teiUrl: 'http://localhost:52000',
      qdrantUrl: 'http://localhost:53333',
      qdrantCollection: 'test_col',
    });

    vi.spyOn(container, 'getTeiService').mockReturnValue(mockTeiService);
    vi.spyOn(container, 'getQdrantService').mockReturnValue(mockQdrantService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders STYLE header fields in human output mode', async () => {
    await handleEmbedCommand(container, {
      input: 'https://example.com',
      collection: 'my_collection',
      noChunk: true,
    });

    const output = vi.mocked(writeOutput).mock.calls.at(-1)?.[0];
    expect(output).toContain('Embed Result');
    expect(output).toContain('Chunks embedded: 1 | Collection: my_collection');
    expect(output).toContain('Filters: collection=my_collection, noChunk=true');
  });
});
