/**
 * Tests for query command
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeQuery } from '../../commands/query';
import type { IContainer } from '../../container/types';
import { resetConfig } from '../../utils/config';
import * as embeddings from '../../utils/embeddings';
import * as qdrant from '../../utils/qdrant';
import { createTestContainer } from '../utils/test-container';

vi.mock('../../utils/embeddings');
vi.mock('../../utils/qdrant');

describe('executeQuery', () => {
  let container: IContainer;

  beforeEach(() => {
    resetConfig();
    container = createTestContainer(undefined, {
      teiUrl: 'http://localhost:52000',
      qdrantUrl: 'http://localhost:53333',
      qdrantCollection: 'test_col',
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetConfig();
    vi.clearAllMocks();
  });

  it('should embed query and search Qdrant', async () => {
    vi.mocked(embeddings.embedBatch).mockResolvedValue([[0.1, 0.2, 0.3]]);
    vi.mocked(qdrant.queryPoints).mockResolvedValue([
      {
        id: 'uuid-1',
        score: 0.92,
        payload: {
          url: 'https://example.com/auth',
          title: 'Auth Docs',
          chunk_header: '## Authentication',
          chunk_text: 'Set environment variables...',
          chunk_index: 0,
          total_chunks: 3,
          domain: 'example.com',
          source_command: 'scrape',
        },
      },
    ]);

    const result = await executeQuery(container, {
      query: 'how to authenticate',
    });

    expect(embeddings.embedBatch).toHaveBeenCalledWith(
      'http://localhost:52000',
      ['how to authenticate']
    );
    expect(qdrant.queryPoints).toHaveBeenCalledWith(
      'http://localhost:53333',
      'test_col',
      [0.1, 0.2, 0.3],
      expect.objectContaining({ limit: 5 })
    );
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0].score).toBe(0.92);
    expect(result.data?.[0].url).toBe('https://example.com/auth');
  });

  it('should pass domain filter to Qdrant', async () => {
    vi.mocked(embeddings.embedBatch).mockResolvedValue([[0.1]]);
    vi.mocked(qdrant.queryPoints).mockResolvedValue([]);

    await executeQuery(container, {
      query: 'test',
      domain: 'example.com',
      limit: 10,
    });

    expect(qdrant.queryPoints).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ limit: 10, domain: 'example.com' })
    );
  });

  it('should fail when TEI_URL not configured', async () => {
    const badContainer = createTestContainer(undefined, {
      teiUrl: undefined,
      qdrantUrl: undefined,
    });

    const result = await executeQuery(badContainer, { query: 'test' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('TEI_URL');
  });

  it('should handle empty results', async () => {
    vi.mocked(embeddings.embedBatch).mockResolvedValue([[0.1]]);
    vi.mocked(qdrant.queryPoints).mockResolvedValue([]);

    const result = await executeQuery(container, { query: 'nonexistent' });
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(0);
  });
});
