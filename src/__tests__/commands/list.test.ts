/**
 * Tests for list command
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createListCommand,
  executeList,
  handleListCommand,
} from '../../commands/list';
import type { IContainer } from '../../container/types';
import { writeOutput } from '../../utils/output';
import {
  type MockFirecrawlClient,
  setupTest,
  teardownTest,
} from '../utils/mock-client';
import { createTestContainer } from '../utils/test-container';

vi.mock('../../utils/output', () => ({
  writeOutput: vi.fn(),
}));

describe('executeList', () => {
  type ListMock = MockFirecrawlClient &
    Required<Pick<MockFirecrawlClient, 'getActiveCrawls'>>;

  let mockClient: ListMock;
  let container: IContainer;

  beforeEach(() => {
    setupTest();

    mockClient = { scrape: vi.fn(), getActiveCrawls: vi.fn() };
    container = createTestContainer(mockClient as any);
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

    const result = await executeList(container, {});

    expect(mockClient.getActiveCrawls).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.data?.crawls.length).toBe(1);
  });
});

describe('handleListCommand', () => {
  type ListMock = MockFirecrawlClient &
    Required<Pick<MockFirecrawlClient, 'getActiveCrawls'>>;

  let mockClient: ListMock;
  let container: IContainer;

  beforeEach(() => {
    setupTest();

    mockClient = { scrape: vi.fn(), getActiveCrawls: vi.fn() };
    container = createTestContainer(mockClient as any);
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

    await handleListCommand(container, { pretty: false });

    expect(writeOutput).toHaveBeenCalledTimes(0);
  });

  it('should write JSON output when pretty is true even if empty', async () => {
    mockClient.getActiveCrawls.mockResolvedValue({
      success: true,
      crawls: [],
    });

    await handleListCommand(container, { pretty: true });

    expect(writeOutput).toHaveBeenCalledTimes(1);
  });

  it('should default to pretty JSON output when pretty is undefined', async () => {
    mockClient.getActiveCrawls.mockResolvedValue({
      success: true,
      crawls: [],
    });

    await handleListCommand(container, {});

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
    const testContainer = createTestContainer(mockClient as any);

    const cmd = createListCommand();
    cmd.exitOverride();
    (cmd as any)._container = testContainer;

    await cmd.parseAsync(['node', 'test'], { from: 'node' });

    expect(mockClient.getActiveCrawls).toHaveBeenCalledTimes(1);
  });
});
