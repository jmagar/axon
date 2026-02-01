/**
 * Tests for extract command
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeExtract, handleExtractCommand } from '../../commands/extract';
import type { IContainer } from '../../container/types';
import { writeOutput } from '../../utils/output';

// Mock autoEmbed to track calls
const mockAutoEmbed = vi.fn().mockResolvedValue(undefined);

vi.mock('../../utils/output', () => ({
  writeOutput: vi.fn(),
}));

describe('executeExtract', () => {
  let mockClient: { extract: ReturnType<typeof vi.fn> };
  let mockContainer: IContainer;

  beforeEach(() => {
    mockClient = {
      extract: vi.fn(),
    };

    mockContainer = {
      config: {
        apiKey: 'test-api-key',
        apiUrl: 'https://api.firecrawl.dev',
        teiUrl: 'http://localhost:53001',
        qdrantUrl: 'http://localhost:53002',
        collectionName: 'firecrawl',
      },
      getFirecrawlClient: vi.fn().mockReturnValue(mockClient),
      getEmbedPipeline: vi.fn().mockReturnValue({
        autoEmbed: mockAutoEmbed,
      }),
      getHttpClient: vi.fn(),
      getTeiService: vi.fn(),
      getQdrantService: vi.fn(),
      dispose: vi.fn(),
    } as unknown as IContainer;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should call extract with URLs and prompt', async () => {
    mockClient.extract.mockResolvedValue({
      success: true,
      data: { name: 'Example', price: 9.99 },
    });

    const result = await executeExtract(mockContainer, {
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

    await executeExtract(mockContainer, {
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

    const result = await executeExtract(mockContainer, {
      urls: ['https://example.com'],
      prompt: 'test',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Extraction failed');
  });

  it('should handle thrown errors', async () => {
    mockClient.extract.mockRejectedValue(new Error('Network error'));

    const result = await executeExtract(mockContainer, {
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

    const result = await executeExtract(mockContainer, {
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
    const mockContainer = {
      config: {
        apiKey: 'test-api-key',
        apiUrl: 'https://api.firecrawl.dev',
        teiUrl: 'http://localhost:53001',
        qdrantUrl: 'http://localhost:53002',
        collectionName: 'firecrawl',
      },
      getFirecrawlClient: vi.fn().mockReturnValue(mockClient),
      getEmbedPipeline: vi.fn(),
      getHttpClient: vi.fn(),
      getTeiService: vi.fn(),
      getQdrantService: vi.fn(),
      dispose: vi.fn(),
    } as unknown as IContainer;

    mockClient.getExtractStatus.mockResolvedValue({
      id: 'ext-1',
      status: 'completed',
      data: { ok: true },
      tokensUsed: 1,
    });

    const result = await executeExtract(mockContainer, {
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
  let mockContainer: IContainer;

  beforeEach(() => {
    mockClient = {
      extract: vi.fn(),
    };

    mockContainer = {
      config: {
        apiKey: 'test-api-key',
        apiUrl: 'https://api.firecrawl.dev',
        teiUrl: 'http://localhost:53001',
        qdrantUrl: 'http://localhost:53002',
        collectionName: 'firecrawl',
      },
      getFirecrawlClient: vi.fn().mockReturnValue(mockClient),
      getEmbedPipeline: vi.fn().mockReturnValue({
        autoEmbed: mockAutoEmbed,
      }),
      getHttpClient: vi.fn(),
      getTeiService: vi.fn(),
      getQdrantService: vi.fn(),
      dispose: vi.fn(),
    } as unknown as IContainer;

    mockAutoEmbed.mockResolvedValue(undefined);
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should auto-embed once per source URL when available', async () => {
    mockClient.extract.mockResolvedValue({
      success: true,
      data: { name: 'Test' },
      sources: ['https://example.com/page1', 'https://example.com/page2'],
    });

    await handleExtractCommand(mockContainer, {
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

    await handleExtractCommand(mockContainer, {
      urls: ['https://example.com'],
      prompt: 'test',
      embed: false,
    });

    expect(mockAutoEmbed).not.toHaveBeenCalled();
    expect(writeOutput).toHaveBeenCalled();
  });
});
