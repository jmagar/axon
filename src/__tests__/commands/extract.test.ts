/**
 * Tests for extract command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeExtract, handleExtractCommand } from '../../commands/extract';
import { getClient } from '../../utils/client';
import { initializeConfig } from '../../utils/config';
import { setupTest, teardownTest } from '../utils/mock-client';
import { autoEmbed } from '../../utils/embedpipeline';
import { writeOutput } from '../../utils/output';

vi.mock('../../utils/client', async () => {
  const actual = await vi.importActual('../../utils/client');
  return { ...actual, getClient: vi.fn() };
});

vi.mock('../../utils/embedpipeline', () => ({
  autoEmbed: vi.fn(),
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
    vi.mocked(autoEmbed).mockResolvedValue();
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

    expect(autoEmbed).toHaveBeenCalledTimes(2);
    expect(autoEmbed).toHaveBeenCalledWith(
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

    expect(autoEmbed).not.toHaveBeenCalled();
    expect(writeOutput).toHaveBeenCalled();
  });
});
