/**
 * Tests for list command
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createListCommand,
  executeList,
  handleListCommand,
} from '../../commands/list';
import { getClient } from '../../utils/client';
import { initializeConfig } from '../../utils/config';
import { writeOutput } from '../../utils/output';
import {
  type MockFirecrawlClient,
  setupTest,
  teardownTest,
} from '../utils/mock-client';

vi.mock('../../utils/client', async () => {
  const actual = await vi.importActual('../../utils/client');
  return { ...actual, getClient: vi.fn() };
});

vi.mock('../../utils/output', () => ({
  writeOutput: vi.fn(),
}));

describe('executeList', () => {
  type ListMock = MockFirecrawlClient &
    Required<Pick<MockFirecrawlClient, 'getActiveCrawls'>>;

  let mockClient: ListMock;

  beforeEach(() => {
    setupTest();
    initializeConfig({
      apiKey: 'test-api-key',
      apiUrl: 'https://api.firecrawl.dev',
    });

    mockClient = { scrape: vi.fn(), getActiveCrawls: vi.fn() };
    vi.mocked(getClient).mockReturnValue(
      mockClient as unknown as ReturnType<typeof getClient>
    );
  });

  afterEach(() => {
    teardownTest();
    vi.clearAllMocks();
  });

  it('should return active crawls list', async () => {
    mockClient.getActiveCrawls.mockResolvedValue({
      success: true,
      crawls: [{ id: 'job-1', teamId: 'team-1', url: 'https://a.com' }],
    });

    const result = await executeList({});

    expect(mockClient.getActiveCrawls).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.data?.crawls.length).toBe(1);
  });
});

describe('handleListCommand', () => {
  type ListMock = MockFirecrawlClient &
    Required<Pick<MockFirecrawlClient, 'getActiveCrawls'>>;

  let mockClient: ListMock;

  beforeEach(() => {
    setupTest();

    mockClient = { scrape: vi.fn(), getActiveCrawls: vi.fn() };
    vi.mocked(getClient).mockReturnValue(
      mockClient as unknown as ReturnType<typeof getClient>
    );
  });

  afterEach(() => {
    teardownTest();
    vi.clearAllMocks();
  });

  it('should write output on success', async () => {
    mockClient.getActiveCrawls.mockResolvedValue({
      success: true,
      crawls: [],
    });

    await handleListCommand({ pretty: false });

    expect(writeOutput).toHaveBeenCalledTimes(0);
  });

  it('should write JSON output when pretty is true even if empty', async () => {
    mockClient.getActiveCrawls.mockResolvedValue({
      success: true,
      crawls: [],
    });

    await handleListCommand({ pretty: true });

    expect(writeOutput).toHaveBeenCalledTimes(1);
  });

  it('should default to pretty JSON output when pretty is undefined', async () => {
    mockClient.getActiveCrawls.mockResolvedValue({
      success: true,
      crawls: [],
    });

    await handleListCommand({});

    expect(writeOutput).toHaveBeenCalledTimes(1);
  });
});

describe('createListCommand', () => {
  it('should call getActiveCrawls when invoked', async () => {
    const mockClient = {
      getActiveCrawls: vi.fn().mockResolvedValue({
        success: true,
        crawls: [],
      }),
    };
    vi.mocked(getClient).mockReturnValue(
      mockClient as unknown as ReturnType<typeof getClient>
    );

    const cmd = createListCommand();
    cmd.exitOverride();

    await cmd.parseAsync(['node', 'test'], { from: 'node' });

    expect(mockClient.getActiveCrawls).toHaveBeenCalledTimes(1);
  });
});
