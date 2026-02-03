import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeConfig } from '../../utils/config';
import * as embeddings from '../../utils/embeddings';
import {
  autoEmbed,
  batchEmbed,
  createEmbedItems,
} from '../../utils/embedpipeline';
import * as qdrant from '../../utils/qdrant';

vi.mock('../../utils/embeddings');
vi.mock('../../utils/qdrant');

describe('autoEmbed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should no-op when TEI_URL is not set', async () => {
    initializeConfig({ qdrantUrl: 'http://localhost:53333' });

    await autoEmbed('some content', {
      url: 'https://example.com',
      sourceCommand: 'scrape',
    });

    expect(embeddings.embedChunks).not.toHaveBeenCalled();
  });

  it('should no-op when QDRANT_URL is not set', async () => {
    initializeConfig({ teiUrl: 'http://localhost:52000' });

    await autoEmbed('some content', {
      url: 'https://example.com',
      sourceCommand: 'scrape',
    });

    expect(embeddings.embedChunks).not.toHaveBeenCalled();
  });

  it('should no-op for empty content', async () => {
    initializeConfig({
      teiUrl: 'http://localhost:52000',
      qdrantUrl: 'http://localhost:53333',
    });

    await autoEmbed('', {
      url: 'https://example.com',
      sourceCommand: 'scrape',
    });

    expect(embeddings.embedChunks).not.toHaveBeenCalled();
  });

  it('should chunk, embed, delete old, and upsert when configured', async () => {
    initializeConfig({
      teiUrl: 'http://localhost:52000',
      qdrantUrl: 'http://localhost:53333',
      qdrantCollection: 'test_col',
    });

    vi.mocked(embeddings.getTeiInfo).mockResolvedValue({
      modelId: 'test',
      dimension: 1024,
      maxInput: 32768,
    });
    vi.mocked(embeddings.embedChunks).mockResolvedValue([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    vi.mocked(qdrant.ensureCollection).mockResolvedValue();
    vi.mocked(qdrant.deleteByUrl).mockResolvedValue();
    vi.mocked(qdrant.upsertPoints).mockResolvedValue();

    await autoEmbed('# Title\n\nSome content.\n\n## Section\n\nMore content.', {
      url: 'https://example.com/page',
      title: 'Test Page',
      sourceCommand: 'scrape',
      contentType: 'markdown',
    });

    expect(embeddings.getTeiInfo).toHaveBeenCalledWith(
      'http://localhost:52000'
    );
    expect(qdrant.ensureCollection).toHaveBeenCalledWith(
      'http://localhost:53333',
      'test_col',
      1024
    );
    expect(qdrant.deleteByUrl).toHaveBeenCalledWith(
      'http://localhost:53333',
      'test_col',
      'https://example.com/page'
    );
    expect(embeddings.embedChunks).toHaveBeenCalled();
    expect(qdrant.upsertPoints).toHaveBeenCalled();

    // Check upserted points have correct metadata
    const points = vi.mocked(qdrant.upsertPoints).mock.calls[0][2];
    expect(points.length).toBeGreaterThan(0);
    expect(points[0].payload).toMatchObject({
      url: 'https://example.com/page',
      title: 'Test Page',
      source_command: 'scrape',
      content_type: 'markdown',
      domain: 'example.com',
    });
    expect(points[0].payload.scraped_at).toBeDefined();
    expect(points[0].payload.chunk_index).toBe(0);
    expect(points[0].payload.chunk_text).toBeDefined();
    expect(points[0].payload.total_chunks).toBeGreaterThan(0);
  });

  it('should never throw — errors are caught and logged', async () => {
    initializeConfig({
      teiUrl: 'http://localhost:52000',
      qdrantUrl: 'http://localhost:53333',
    });

    vi.mocked(embeddings.getTeiInfo).mockRejectedValue(new Error('TEI down'));

    // Should not throw
    await expect(
      autoEmbed('content', {
        url: 'https://example.com',
        sourceCommand: 'scrape',
      })
    ).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalled();
  });
});

describe('batchEmbed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return empty result for empty items array', async () => {
    const result = await batchEmbed([]);

    expect(result).toEqual({
      succeeded: 0,
      failed: 0,
      errors: [],
    });
  });

  it('should track succeeded count when all items succeed', async () => {
    initializeConfig({
      teiUrl: 'http://localhost:52000',
      qdrantUrl: 'http://localhost:53333',
    });

    vi.mocked(embeddings.getTeiInfo).mockResolvedValue({
      modelId: 'test',
      dimension: 1024,
      maxInput: 32768,
    });
    vi.mocked(embeddings.embedChunks).mockResolvedValue([[0.1, 0.2]]);
    vi.mocked(qdrant.ensureCollection).mockResolvedValue();
    vi.mocked(qdrant.deleteByUrl).mockResolvedValue();
    vi.mocked(qdrant.upsertPoints).mockResolvedValue();

    const result = await batchEmbed([
      {
        content: 'Content 1',
        metadata: {
          url: 'https://example.com/1',
          sourceCommand: 'scrape',
        },
      },
      {
        content: 'Content 2',
        metadata: {
          url: 'https://example.com/2',
          sourceCommand: 'scrape',
        },
      },
    ]);

    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('should track failed count and collect errors when items fail', async () => {
    initializeConfig({
      teiUrl: 'http://localhost:52000',
      qdrantUrl: 'http://localhost:53333',
    });

    // Make embedChunks fail
    vi.mocked(embeddings.getTeiInfo).mockResolvedValue({
      modelId: 'test',
      dimension: 1024,
      maxInput: 32768,
    });
    vi.mocked(qdrant.ensureCollection).mockResolvedValue();
    vi.mocked(embeddings.embedChunks).mockRejectedValue(new Error('TEI error'));

    const result = await batchEmbed([
      {
        content: 'Content 1',
        metadata: {
          url: 'https://example.com/1',
          sourceCommand: 'scrape',
        },
      },
      {
        content: 'Content 2',
        metadata: {
          url: 'https://example.com/2',
          sourceCommand: 'scrape',
        },
      },
    ]);

    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(2);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('https://example.com/');
    expect(result.errors[0]).toContain('TEI error');
  });

  it('should track partial failures (mix of success and failure)', async () => {
    initializeConfig({
      teiUrl: 'http://localhost:52000',
      qdrantUrl: 'http://localhost:53333',
    });

    vi.mocked(embeddings.getTeiInfo).mockResolvedValue({
      modelId: 'test',
      dimension: 1024,
      maxInput: 32768,
    });
    vi.mocked(qdrant.ensureCollection).mockResolvedValue();
    vi.mocked(qdrant.deleteByUrl).mockResolvedValue();
    vi.mocked(qdrant.upsertPoints).mockResolvedValue();

    // Fail embedding for Content 2, succeed for Content 1
    vi.mocked(embeddings.embedChunks).mockImplementation(
      async (_teiUrl: string, texts: string[]) => {
        // Check if this batch contains Content 2
        if (texts.some((text) => text.includes('Content 2'))) {
          throw new Error('Failed embedding');
        }
        return [[0.1, 0.2]];
      }
    );

    const result = await batchEmbed([
      {
        content: 'Content 1',
        metadata: {
          url: 'https://example.com/1',
          sourceCommand: 'scrape',
        },
      },
      {
        content: 'Content 2',
        metadata: {
          url: 'https://example.com/2',
          sourceCommand: 'scrape',
        },
      },
    ]);

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Embedded 1/2 items (1 failed)')
    );
  });

  it('should limit errors to first 10 to avoid memory issues', async () => {
    initializeConfig({
      teiUrl: 'http://localhost:52000',
      qdrantUrl: 'http://localhost:53333',
    });

    vi.mocked(embeddings.getTeiInfo).mockResolvedValue({
      modelId: 'test',
      dimension: 1024,
      maxInput: 32768,
    });
    vi.mocked(qdrant.ensureCollection).mockResolvedValue();
    vi.mocked(embeddings.embedChunks).mockRejectedValue(new Error('Error'));

    // Create 20 items that will all fail
    const items = Array.from({ length: 20 }, (_, i) => ({
      content: `Content ${i}`,
      metadata: {
        url: `https://example.com/${i}`,
        sourceCommand: 'scrape',
      },
    }));

    const result = await batchEmbed(items);

    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(20);
    // Should only collect first 10 errors
    expect(result.errors).toHaveLength(10);
  });
});

describe('createEmbedItems', () => {
  it('creates embed items from pages with markdown content', () => {
    const pages = [
      { markdown: '# Title', url: 'https://example.com', title: 'Example' },
    ];
    const items = createEmbedItems(pages, 'crawl');
    expect(items).toHaveLength(1);
    expect(items[0].content).toBe('# Title');
    expect(items[0].metadata.url).toBe('https://example.com');
    expect(items[0].metadata.sourceCommand).toBe('crawl');
    expect(items[0].metadata.contentType).toBe('markdown');
  });

  it('creates embed items from pages with html content', () => {
    const pages = [{ html: '<p>Hello</p>', url: 'https://example.com' }];
    const items = createEmbedItems(pages, 'scrape');
    expect(items).toHaveLength(1);
    expect(items[0].metadata.contentType).toBe('html');
  });

  it('extracts url from metadata.sourceURL fallback', () => {
    const pages = [
      { markdown: 'content', metadata: { sourceURL: 'https://fallback.com' } },
    ];
    const items = createEmbedItems(pages, 'crawl');
    expect(items[0].metadata.url).toBe('https://fallback.com');
  });

  it('filters out pages without markdown or html', () => {
    const pages = [
      { markdown: 'valid', url: 'https://a.com' },
      { url: 'https://empty.com' }, // No content
      { html: 'also valid', url: 'https://b.com' },
    ];
    const items = createEmbedItems(pages, 'crawl');
    expect(items).toHaveLength(2);
  });

  it('returns empty array for empty input', () => {
    const items = createEmbedItems([], 'crawl');
    expect(items).toHaveLength(0);
  });
});
