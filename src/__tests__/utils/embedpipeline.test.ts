import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeConfig } from '../../utils/config';
import * as embeddings from '../../utils/embeddings';
import { autoEmbed } from '../../utils/embedpipeline';
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
