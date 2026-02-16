/**
 * Tests for info command
 */

import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInfoCommand, executeInfo } from '../../commands/info';
import type { IContainer, IQdrantService } from '../../container/types';
import type { CommandWithContainer } from '../../types/test';
import { createTestContainer } from '../utils/test-container';

describe('executeInfo', () => {
  let container: IContainer;
  let mockQdrantService: IQdrantService;

  beforeEach(() => {
    mockQdrantService = {
      ensureCollection: vi.fn(),
      deleteByUrl: vi.fn(),
      deleteByUrlAndSourceCommand: vi.fn().mockResolvedValue(undefined),
      deleteByDomain: vi.fn(),
      countByDomain: vi.fn(),
      countByUrl: vi.fn(),
      upsertPoints: vi.fn(),
      queryPoints: vi.fn(),
      scrollByUrl: vi.fn(),
      scrollAll: vi.fn(),
      getCollectionInfo: vi.fn(),
      countPoints: vi.fn(),
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

  it('should return detailed info for a URL with chunks', async () => {
    const testUrl = 'https://example.com/page';
    const mockPoints = [
      {
        id: '1',
        vector: [],
        payload: {
          url: testUrl,
          domain: 'example.com',
          title: 'Test Page',
          source_command: 'scrape',
          content_type: 'text/html',
          scraped_at: '2026-02-03T12:00:00Z',
          chunk_index: 0,
          chunk_header: 'Introduction',
          chunk_text: 'This is the first chunk of content',
        },
      },
      {
        id: '2',
        vector: [],
        payload: {
          url: testUrl,
          domain: 'example.com',
          title: 'Test Page',
          source_command: 'scrape',
          content_type: 'text/html',
          scraped_at: '2026-02-03T12:00:00Z',
          chunk_index: 1,
          chunk_header: 'Main Content',
          chunk_text:
            'This is the second chunk with more details about the topic',
        },
      },
    ];

    vi.mocked(mockQdrantService.scrollByUrl).mockResolvedValue(mockPoints);

    const result = await executeInfo(container, {
      url: testUrl,
      collection: 'test_col',
    });

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.url).toBe(testUrl);
    expect(result.data?.domain).toBe('example.com');
    expect(result.data?.title).toBe('Test Page');
    expect(result.data?.totalChunks).toBe(2);
    expect(result.data?.sourceCommand).toBe('scrape');
    expect(result.data?.contentType).toBe('text/html');
    expect(result.data?.chunks).toHaveLength(2);
    expect(result.data?.chunks[0].index).toBe(0);
    expect(result.data?.chunks[0].header).toBe('Introduction');
    expect(result.data?.chunks[0].textPreview).toBe(
      'This is the first chunk of content'
    );
    expect(mockQdrantService.scrollByUrl).toHaveBeenCalledWith(
      'test_col',
      testUrl
    );
  });

  it('should return error when URL not found', async () => {
    const testUrl = 'https://example.com/notfound';
    vi.mocked(mockQdrantService.scrollByUrl).mockResolvedValue([]);

    const result = await executeInfo(container, {
      url: testUrl,
      collection: 'test_col',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('URL not found in vector database');
    expect(mockQdrantService.scrollByUrl).toHaveBeenCalledWith(
      'test_col',
      testUrl
    );
  });

  it('should truncate text preview to 100 chars by default', async () => {
    const testUrl = 'https://example.com/long';
    const longText = 'a'.repeat(200);
    const mockPoints = [
      {
        id: '1',
        vector: [],
        payload: {
          url: testUrl,
          domain: 'example.com',
          title: 'Long Page',
          source_command: 'scrape',
          content_type: 'text/html',
          scraped_at: '2026-02-03T12:00:00Z',
          chunk_index: 0,
          chunk_header: null,
          chunk_text: longText,
        },
      },
    ];

    vi.mocked(mockQdrantService.scrollByUrl).mockResolvedValue(mockPoints);

    const result = await executeInfo(container, {
      url: testUrl,
      collection: 'test_col',
      full: false,
    });

    expect(result.success).toBe(true);
    expect(result.data?.chunks[0].textPreview.length).toBeLessThanOrEqual(103); // 100 + "..."
    expect(result.data?.chunks[0].textPreview).toContain('...');
  });

  it('should fail when QDRANT_URL not configured', async () => {
    const badContainer = createTestContainer(undefined, {
      qdrantUrl: undefined,
    });

    const result = await executeInfo(badContainer, {
      url: 'https://example.com',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('QDRANT_URL');
  });

  it('should return full text when full option is true', async () => {
    const longText = 'a'.repeat(200); // Text longer than 100 char preview

    vi.mocked(mockQdrantService.scrollByUrl).mockResolvedValue([
      {
        id: 'p1',
        vector: [],
        payload: {
          url: 'https://example.com/docs',
          domain: 'example.com',
          title: 'Documentation',
          total_chunks: 1,
          source_command: 'crawl',
          content_type: 'markdown',
          scraped_at: '2025-01-15T10:00:00Z',
          chunk_index: 0,
          chunk_header: 'Test',
          chunk_text: longText,
        },
      },
    ]);

    const result = await executeInfo(container, {
      url: 'https://example.com/docs',
      full: true,
    });

    expect(result.success).toBe(true);
    expect(result.data?.chunks[0].textPreview).toBe(longText);
    expect(result.data?.chunks[0].textPreview).not.toContain('...');
  });

  it('should sort chunks by index', async () => {
    vi.mocked(mockQdrantService.scrollByUrl).mockResolvedValue([
      {
        id: 'p3',
        vector: [],
        payload: {
          url: 'https://example.com/docs',
          domain: 'example.com',
          title: 'Documentation',
          total_chunks: 3,
          source_command: 'crawl',
          content_type: 'markdown',
          scraped_at: '2025-01-15T10:00:00Z',
          chunk_index: 2,
          chunk_header: 'Third',
          chunk_text: 'Third chunk',
        },
      },
      {
        id: 'p1',
        vector: [],
        payload: {
          url: 'https://example.com/docs',
          domain: 'example.com',
          title: 'Documentation',
          total_chunks: 3,
          source_command: 'crawl',
          content_type: 'markdown',
          scraped_at: '2025-01-15T10:00:00Z',
          chunk_index: 0,
          chunk_header: 'First',
          chunk_text: 'First chunk',
        },
      },
      {
        id: 'p2',
        vector: [],
        payload: {
          url: 'https://example.com/docs',
          domain: 'example.com',
          title: 'Documentation',
          total_chunks: 3,
          source_command: 'crawl',
          content_type: 'markdown',
          scraped_at: '2025-01-15T10:00:00Z',
          chunk_index: 1,
          chunk_header: 'Second',
          chunk_text: 'Second chunk',
        },
      },
    ]);

    const result = await executeInfo(container, {
      url: 'https://example.com/docs',
    });

    expect(result.success).toBe(true);
    expect(result.data?.chunks[0].index).toBe(0);
    expect(result.data?.chunks[1].index).toBe(1);
    expect(result.data?.chunks[2].index).toBe(2);
    expect(result.data?.chunks[0].header).toBe('First');
    expect(result.data?.chunks[1].header).toBe('Second');
    expect(result.data?.chunks[2].header).toBe('Third');
  });

  it('should handle null chunk headers', async () => {
    vi.mocked(mockQdrantService.scrollByUrl).mockResolvedValue([
      {
        id: 'p1',
        vector: [],
        payload: {
          url: 'https://example.com/docs',
          domain: 'example.com',
          title: 'Documentation',
          total_chunks: 1,
          source_command: 'crawl',
          content_type: 'markdown',
          scraped_at: '2025-01-15T10:00:00Z',
          chunk_index: 0,
          chunk_header: null,
          chunk_text: 'Some text without header',
        },
      },
    ]);

    const result = await executeInfo(container, {
      url: 'https://example.com/docs',
    });

    expect(result.success).toBe(true);
    expect(result.data?.chunks[0].header).toBeNull();
  });
});

describe('createInfoCommand', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should output storage paths via info storage --pretty', async () => {
    const command = createInfoCommand();
    let output = '';
    const writeSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        output += String(chunk);
        return true;
      });

    await command.parseAsync(['node', 'test', 'storage', '--pretty'], {
      from: 'node',
    });

    writeSpy.mockRestore();
    const parsed = JSON.parse(output.trim()) as { storageRoot?: string };
    expect(parsed.storageRoot).toBeDefined();
  });

  it('should require URL for info command action', async () => {
    const command = createInfoCommand();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });

    // commander.error() throws an error with the message and exits with code 1
    await expect(
      command.parseAsync(['node', 'test'], { from: 'node' })
    ).rejects.toThrow();

    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });

  it('should expand tilde in AXON_HOME for info storage --json', async () => {
    const originalHome = process.env.AXON_HOME;
    process.env.AXON_HOME = '~/.axon';

    try {
      const command = createInfoCommand();
      let output = '';
      const writeSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation((chunk: string | Uint8Array) => {
          output += String(chunk);
          return true;
        });

      await command.parseAsync(['node', 'test', 'storage', '--json'], {
        from: 'node',
      });

      writeSpy.mockRestore();

      const parsed = JSON.parse(output.trim()) as {
        storageRoot: string;
        credentialsPath: string;
        settingsPath: string;
        jobHistoryPath: string;
        embedQueueDir: string;
      };
      const expectedRoot = join(homedir(), '.axon');

      expect(parsed.storageRoot).toBe(expectedRoot);
      expect(parsed.credentialsPath).toBe(
        join(expectedRoot, 'credentials.json')
      );
      expect(parsed.settingsPath).toBe(join(expectedRoot, 'settings.json'));
      expect(parsed.jobHistoryPath).toBe(
        join(expectedRoot, 'job-history.json')
      );
      expect(parsed.embedQueueDir).toBe(join(expectedRoot, 'embed-queue'));
    } finally {
      if (originalHome === undefined) {
        delete process.env.AXON_HOME;
      } else {
        process.env.AXON_HOME = originalHome;
      }
    }
  });

  it('should respect custom AXON_HOME path for info storage', async () => {
    const originalHome = process.env.AXON_HOME;
    const customPath = join(
      tmpdir(),
      `axon-custom-home-${process.pid}-${Date.now()}`
    );
    process.env.AXON_HOME = customPath;

    try {
      const command = createInfoCommand();
      let output = '';
      const writeSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation((chunk: string | Uint8Array) => {
          output += String(chunk);
          return true;
        });

      await command.parseAsync(['node', 'test', 'storage', '--json'], {
        from: 'node',
      });

      writeSpy.mockRestore();

      const parsed = JSON.parse(output.trim()) as {
        storageRoot: string;
        credentialsPath: string;
        settingsPath: string;
        jobHistoryPath: string;
        embedQueueDir: string;
        exists: {
          storageRoot: boolean;
          credentialsPath: boolean;
          settingsPath: boolean;
          jobHistoryPath: boolean;
          embedQueueDir: boolean;
        };
      };

      expect(parsed.storageRoot).toBe(customPath);
      expect(parsed.credentialsPath).toBe(join(customPath, 'credentials.json'));
      expect(parsed.settingsPath).toBe(join(customPath, 'settings.json'));
      expect(parsed.jobHistoryPath).toBe(join(customPath, 'job-history.json'));
      expect(parsed.embedQueueDir).toBe(join(customPath, 'embed-queue'));
      expect(parsed.exists.storageRoot).toBe(false);
      expect(parsed.exists.credentialsPath).toBe(false);
      expect(parsed.exists.settingsPath).toBe(false);
      expect(parsed.exists.jobHistoryPath).toBe(false);
      expect(parsed.exists.embedQueueDir).toBe(false);
    } finally {
      if (originalHome === undefined) {
        delete process.env.AXON_HOME;
      } else {
        process.env.AXON_HOME = originalHome;
      }
    }
  });

  it('should render styled text output for URL info with filters', async () => {
    const command = createInfoCommand() as CommandWithContainer;
    const mockQdrantService: IQdrantService = {
      ensureCollection: vi.fn(),
      deleteByUrl: vi.fn(),
      deleteByUrlAndSourceCommand: vi.fn().mockResolvedValue(undefined),
      deleteByDomain: vi.fn(),
      countByDomain: vi.fn(),
      countByUrl: vi.fn(),
      upsertPoints: vi.fn(),
      queryPoints: vi.fn(),
      scrollByUrl: vi.fn().mockResolvedValue([
        {
          id: '1',
          vector: [],
          payload: {
            url: 'https://example.com/page',
            domain: 'example.com',
            title: 'Example Page',
            source_command: 'scrape',
            content_type: 'text/html',
            scraped_at: '2026-02-11T12:00:00Z',
            chunk_index: 0,
            chunk_header: 'Intro',
            chunk_text:
              'This is a long preview line that should be rendered in the table body for command output tests.',
          },
        },
      ]),
      scrollAll: vi.fn(),
      getCollectionInfo: vi.fn(),
      countPoints: vi.fn(),
      deleteAll: vi.fn(),
    };
    const container = createTestContainer(undefined, {
      qdrantUrl: 'http://localhost:53333',
      qdrantCollection: 'test_col',
    });
    vi.spyOn(container, 'getQdrantService').mockReturnValue(mockQdrantService);
    command._container = container as IContainer;

    let output = '';
    const writeSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        output += String(chunk);
        return true;
      });

    await command.parseAsync(
      ['node', 'test', 'https://example.com/page', '--full'],
      { from: 'node' }
    );
    writeSpy.mockRestore();

    expect(output).toContain('URL Information');
    expect(output).toContain(
      'Chunks: 1 | Domain: example.com | Source: scrape'
    );
    expect(output).toContain('Filters: full=true');
    expect(output).toContain('Field');
    expect(output).toContain('Chunks');
    expect(output).toContain('Preview');
  });
});
