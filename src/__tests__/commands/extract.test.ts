/**
 * Tests for extract command
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeExtract, handleExtractCommand } from '../../commands/extract';
import { getClient } from '../../utils/client';
import { initializeConfig } from '../../utils/config';
// autoEmbed is mocked below via mockAutoEmbed
import { writeOutput } from '../../utils/output';
import { setupTest, teardownTest } from '../utils/mock-client';

vi.mock('../../utils/client', async () => {
  const actual = await vi.importActual('../../utils/client');
  return { ...actual, getClient: vi.fn() };
});

// Mock embedpipeline - mock autoEmbed and provide implementations for batch functions
// Use vi.hoisted to ensure mockAutoEmbed is defined before vi.mock runs (vi.mock is hoisted)
const { mockAutoEmbed } = vi.hoisted(() => ({
  mockAutoEmbed: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../utils/embedpipeline', () => ({
  autoEmbed: mockAutoEmbed,
  // Re-implement batchEmbed to call the mockAutoEmbed
  batchEmbed: vi.fn().mockImplementation(
    async (
      items: Array<{
        content: string;
        metadata: {
          url: string;
          title?: string;
          sourceCommand: string;
          contentType?: string;
        };
      }>
    ) => {
      for (const item of items) {
        await mockAutoEmbed(item.content, item.metadata);
      }
    }
  ),
  // Re-implement createEmbedItems to match real behavior
  createEmbedItems: vi.fn().mockImplementation(
    (
      pages: Array<{
        markdown?: string;
        html?: string;
        url?: string;
        title?: string;
        metadata?: { sourceURL?: string; url?: string; title?: string };
      }>,
      sourceCommand: string
    ) => {
      return pages
        .filter((page) => page.markdown || page.html)
        .map((page) => ({
          content: page.markdown || page.html || '',
          metadata: {
            url:
              page.url || page.metadata?.sourceURL || page.metadata?.url || '',
            title: page.title || page.metadata?.title,
            sourceCommand,
            contentType: page.markdown ? 'markdown' : 'html',
          },
        }));
    }
  ),
}));

vi.mock('../../utils/output', () => ({
  writeOutput: vi.fn(),
}));

describe('executeExtract', () => {
  let mockClient: { extract: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    setupTest();
    initializeConfig({
      apiKey: 'test-api-key',
      apiUrl: 'https://api.firecrawl.dev',
    });

    mockClient = {
      extract: vi.fn(),
    };

    vi.mocked(getClient).mockReturnValue(
      mockClient as unknown as ReturnType<typeof getClient>
    );
  });

  afterEach(() => {
    teardownTest();
    vi.clearAllMocks();
  });

  it('should call extract with URLs and prompt', async () => {
    mockClient.extract.mockResolvedValue({
      success: true,
      data: { name: 'Example', price: 9.99 },
    });

    const result = await executeExtract({
      urls: ['https://example.com'],
      prompt: 'Extract product pricing',
    });

    expect(mockClient.extract).toHaveBeenCalledTimes(1);
    expect(mockClient.extract).toHaveBeenCalledWith(
      expect.objectContaining({
        urls: ['https://example.com'],
        prompt: 'Extract product pricing',
      })
    );
    expect(result.success).toBe(true);
    expect(result.data?.extracted).toEqual({ name: 'Example', price: 9.99 });
  });

  it('should pass schema as parsed JSON object', async () => {
    mockClient.extract.mockResolvedValue({
      success: true,
      data: { name: 'Test' },
    });

    await executeExtract({
      urls: ['https://example.com'],
      schema: '{"name": "string", "price": "number"}',
    });

    expect(mockClient.extract).toHaveBeenCalledWith(
      expect.objectContaining({
        urls: ['https://example.com'],
        schema: { name: 'string', price: 'number' },
      })
    );
  });

  it('should handle SDK error response', async () => {
    mockClient.extract.mockResolvedValue({
      success: false,
      error: 'Extraction failed',
    });

    const result = await executeExtract({
      urls: ['https://example.com'],
      prompt: 'test',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Extraction failed');
  });

  it('should handle thrown errors', async () => {
    mockClient.extract.mockRejectedValue(new Error('Network error'));

    const result = await executeExtract({
      urls: ['https://example.com'],
      prompt: 'test',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Network error');
  });

  it('should include sources in result when showSources is true', async () => {
    mockClient.extract.mockResolvedValue({
      success: true,
      data: { name: 'Test' },
      sources: ['https://example.com/page1'],
    });

    const result = await executeExtract({
      urls: ['https://example.com'],
      prompt: 'test',
      showSources: true,
    });

    expect(result.data?.sources).toEqual(['https://example.com/page1']);
  });
});

describe('executeExtract status mode', () => {
  it('should call getExtractStatus when status is true', async () => {
    const mockClient = { getExtractStatus: vi.fn() };
    vi.mocked(getClient).mockReturnValue(
      mockClient as unknown as ReturnType<typeof getClient>
    );

    mockClient.getExtractStatus.mockResolvedValue({
      id: 'ext-1',
      status: 'completed',
      data: { ok: true },
      tokensUsed: 1,
    });

    const result = await executeExtract({
      status: true,
      jobId: 'ext-1',
      urls: [],
    });

    expect(mockClient.getExtractStatus).toHaveBeenCalledWith('ext-1');
    expect(result.success).toBe(true);
    expect(result.data?.extracted).toEqual({ ok: true });
    expect(result.data?.status).toBe('completed');
    expect(result.data?.tokensUsed).toBe(1);
  });
});

describe('createExtractCommand', () => {
  it('should require job id for --status', async () => {
    const { createExtractCommand } = await import('../../commands/extract');
    const cmd = createExtractCommand();
    cmd.exitOverride();

    await expect(
      cmd.parseAsync(['node', 'test', '--status'], { from: 'node' })
    ).rejects.toThrow();
  });
});

describe('handleExtractCommand', () => {
  let mockClient: { extract: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    setupTest();
    initializeConfig({
      apiKey: 'test-api-key',
      apiUrl: 'https://api.firecrawl.dev',
    });

    mockClient = {
      extract: vi.fn(),
    };

    vi.mocked(getClient).mockReturnValue(
      mockClient as unknown as ReturnType<typeof getClient>
    );
    mockAutoEmbed.mockResolvedValue(undefined);
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
  });

  afterEach(() => {
    teardownTest();
    vi.clearAllMocks();
  });

  it('should auto-embed once per source URL when available', async () => {
    mockClient.extract.mockResolvedValue({
      success: true,
      data: { name: 'Test' },
      sources: ['https://example.com/page1', 'https://example.com/page2'],
    });

    await handleExtractCommand({
      urls: ['https://example.com'],
      prompt: 'test',
    });

    expect(mockAutoEmbed).toHaveBeenCalledTimes(2);
    expect(mockAutoEmbed).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ url: 'https://example.com/page1' })
    );
    expect(writeOutput).toHaveBeenCalled();
  });

  it('should skip auto-embed when embed is false', async () => {
    mockClient.extract.mockResolvedValue({
      success: true,
      data: { name: 'Test' },
    });

    await handleExtractCommand({
      urls: ['https://example.com'],
      prompt: 'test',
      embed: false,
    });

    expect(mockAutoEmbed).not.toHaveBeenCalled();
    expect(writeOutput).toHaveBeenCalled();
  });
});
