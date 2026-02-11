/**
 * Test helper utilities for module mocking
 *
 * Provides reusable module mock patterns to reduce duplication across test files
 */

import type { Mock } from 'vitest';
import { vi } from 'vitest';

/**
 * Setup mock for output module
 *
 * @returns Mock implementation object
 */
export function mockOutputModule(): {
  writeOutput: Mock;
  validateOutputPath: Mock;
  handleScrapeOutput: Mock;
} {
  return {
    writeOutput: vi.fn(),
    validateOutputPath: vi.fn((path: string) => path),
    handleScrapeOutput: vi.fn(),
  };
}

/**
 * Setup mock for command utils module
 *
 * @returns Mock implementation object
 */
export function mockCommandModule(): {
  formatJson: Mock;
  writeCommandOutput: Mock;
} {
  return {
    formatJson: vi.fn(),
    writeCommandOutput: vi.fn(),
  };
}

/**
 * Setup mock for job module
 *
 * @returns Mock implementation object
 */
export function mockJobModule(): {
  isJobId: Mock;
  extractJobId: Mock;
} {
  return {
    isJobId: vi.fn(),
    extractJobId: vi.fn(),
  };
}

/**
 * Setup mock for job-history module
 *
 * @returns Mock implementation object
 */
export function mockJobHistoryModule(): {
  recordJob: Mock;
  getRecentJobIds: Mock;
  clearJobHistory: Mock;
  removeJobIds: Mock;
} {
  return {
    recordJob: vi.fn().mockResolvedValue(undefined),
    getRecentJobIds: vi.fn().mockResolvedValue([]),
    clearJobHistory: vi.fn().mockResolvedValue(undefined),
    removeJobIds: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Setup mock for crawl/execute module
 *
 * @returns Mock implementation object
 */
export function mockCrawlExecuteModule(): {
  executeCrawl: Mock;
} {
  return {
    executeCrawl: vi.fn(),
  };
}

/**
 * Setup mock for crawl/embed module
 *
 * @returns Mock implementation object
 */
export function mockCrawlEmbedModule(): {
  handleManualEmbedding: Mock;
  handleAsyncEmbedding: Mock;
  handleSyncEmbedding: Mock;
} {
  return {
    handleManualEmbedding: vi.fn(),
    handleAsyncEmbedding: vi.fn(),
    handleSyncEmbedding: vi.fn(),
  };
}

/**
 * Setup mock for crawl/format module
 *
 * @returns Mock implementation object
 */
export function mockCrawlFormatModule(): {
  formatCrawlStatus: Mock;
} {
  return {
    formatCrawlStatus: vi.fn(),
  };
}

/**
 * Setup mock for crawl/polling module
 *
 * @returns Mock implementation object
 */
export function mockCrawlPollingModule(): {
  pollCrawlStatus: Mock;
} {
  return {
    pollCrawlStatus: vi.fn(),
  };
}

/**
 * Setup mock for batch module
 *
 * @returns Mock implementation object
 */
export function mockBatchModule(): {
  executeBatch: Mock;
  handleBatchCommand: Mock;
} {
  return {
    executeBatch: vi.fn(),
    handleBatchCommand: vi.fn(),
  };
}

/**
 * Setup mock for extract module
 *
 * @returns Mock implementation object
 */
export function mockExtractModule(): {
  executeExtract: Mock;
  handleExtractCommand: Mock;
} {
  return {
    executeExtract: vi.fn(),
    handleExtractCommand: vi.fn(),
  };
}

/**
 * Setup mock for delete module
 *
 * @returns Mock implementation object
 */
export function mockDeleteModule(): {
  executeDelete: Mock;
  handleDeleteCommand: Mock;
} {
  return {
    executeDelete: vi.fn(),
    handleDeleteCommand: vi.fn(),
  };
}

/**
 * Setup mock for credentials module
 *
 * Mocks all exported functions from credentials.ts including the internal
 * setSecurePermissions behavior (handled via chmodSync in fs mock)
 *
 * @returns Mock implementation object
 */
export function mockCredentialsModule(): {
  getConfigDirectoryPath: Mock;
  loadCredentials: Mock;
  saveCredentials: Mock;
  deleteCredentials: Mock;
} {
  return {
    getConfigDirectoryPath: vi.fn().mockReturnValue('/tmp/firecrawl-home'),
    loadCredentials: vi.fn().mockReturnValue(null),
    saveCredentials: vi.fn(),
    deleteCredentials: vi.fn(),
  };
}

/**
 * Setup mock for settings module
 *
 * Mocks all exported functions from settings.ts including the internal
 * setSecurePermissions behavior (handled via chmodSync in fs mock)
 *
 * @returns Mock implementation object
 */
export function mockSettingsModule(): {
  loadSettings: Mock;
  saveSettings: Mock;
  clearSetting: Mock;
} {
  return {
    loadSettings: vi.fn().mockReturnValue({}),
    saveSettings: vi.fn(),
    clearSetting: vi.fn(),
  };
}

/**
 * Setup common module mocks for command tests
 *
 * Sets up output, command, job, and job-history mocks
 *
 * @returns Object containing all mock implementations
 */
export function setupCommonCommandMocks(): {
  output: ReturnType<typeof mockOutputModule>;
  command: ReturnType<typeof mockCommandModule>;
  job: ReturnType<typeof mockJobModule>;
  jobHistory: ReturnType<typeof mockJobHistoryModule>;
} {
  const output = mockOutputModule();
  const command = mockCommandModule();
  const job = mockJobModule();
  const jobHistory = mockJobHistoryModule();

  vi.mock('../../utils/output', () => output);
  vi.mock('../../utils/command', () => command);
  vi.mock('../../utils/job', () => job);
  vi.mock('../../utils/job-history', () => jobHistory);

  return {
    output,
    command,
    job,
    jobHistory,
  };
}

/**
 * Setup all crawl command module mocks
 *
 * Sets up execute, embed, format, and polling mocks
 *
 * @returns Object containing all mock implementations
 */
export function setupCrawlCommandMocks(): {
  execute: ReturnType<typeof mockCrawlExecuteModule>;
  embed: ReturnType<typeof mockCrawlEmbedModule>;
  format: ReturnType<typeof mockCrawlFormatModule>;
  polling: ReturnType<typeof mockCrawlPollingModule>;
} {
  const execute = mockCrawlExecuteModule();
  const embed = mockCrawlEmbedModule();
  const format = mockCrawlFormatModule();
  const polling = mockCrawlPollingModule();

  vi.mock('../../../commands/crawl/execute', () => execute);
  vi.mock('../../../commands/crawl/embed', () => embed);
  vi.mock('../../../commands/crawl/format', () => format);
  vi.mock('../../../commands/crawl/polling', () => polling);

  return {
    execute,
    embed,
    format,
    polling,
  };
}

/**
 * Connect writeCommandOutput mock to writeOutput mock
 *
 * Common pattern in command tests where writeCommandOutput delegates to writeOutput
 *
 * @param writeCommandOutput - Mock for writeCommandOutput
 * @param writeOutput - Mock for writeOutput
 */
export function connectCommandToOutput(
  writeCommandOutput: Mock,
  writeOutput: Mock
) {
  writeCommandOutput.mockImplementation((content, options) => {
    writeOutput(String(content), options.output, !!options.output);
  });
}
