/**
 * Tests for retrieve command
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeRetrieve } from '../../commands/retrieve';
import { initializeConfig, resetConfig } from '../../utils/config';
import * as qdrant from '../../utils/qdrant';

vi.mock('../../utils/qdrant');

describe('executeRetrieve', () => {
  beforeEach(() => {
    resetConfig();
    initializeConfig({
      qdrantUrl: 'http://localhost:53333',
      qdrantCollection: 'test_col',
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetConfig();
    vi.clearAllMocks();
  });

  it('should retrieve and reassemble document from Qdrant', async () => {
    vi.mocked(qdrant.scrollByUrl).mockResolvedValue([
      {
        id: '1',
        payload: {
          chunk_index: 0,
          chunk_text: 'Intro.',
          chunk_header: 'Title',
        },
      },
      {
        id: '2',
        payload: {
          chunk_index: 1,
          chunk_text: 'Content.',
          chunk_header: 'Section',
        },
      },
    ]);

    const result = await executeRetrieve({ url: 'https://example.com' });

    expect(qdrant.scrollByUrl).toHaveBeenCalledWith(
      'http://localhost:53333',
      'test_col',
      'https://example.com'
    );
    expect(result.success).toBe(true);
    expect(result.data?.totalChunks).toBe(2);
    expect(result.data?.content).toContain('# Title');
    expect(result.data?.content).toContain('# Section');
  });

  it('should return error when no chunks found', async () => {
    vi.mocked(qdrant.scrollByUrl).mockResolvedValue([]);

    const result = await executeRetrieve({ url: 'https://notfound.com' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No content found');
  });

  it('should fail when QDRANT_URL not configured', async () => {
    resetConfig();
    initializeConfig({});

    const result = await executeRetrieve({ url: 'https://example.com' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('QDRANT_URL');
  });
});
