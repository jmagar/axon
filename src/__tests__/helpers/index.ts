/**
 * Test helper utilities
 *
 * Central export point for all test helper modules
 */

export type { ErrorResult, Result, SuccessResult } from './assertions';
// Assertion utilities
export {
  expectArrayResult,
  expectCalledTimes,
  expectCalledWithContaining,
  expectCalledWithOptions,
  expectCalledWithQueryAndOptions,
  expectCalledWithUrlAndOptions,
  expectDefined,
  expectErrorResult,
  expectFetchCalled,
  expectNotCalled,
  expectProperties,
  expectResultData,
  expectSuccessResult,
} from './assertions';
export type {
  BatchStatusOptions,
  CrawlStatusOptions,
  CredentialsOptions,
  ExtractResponseOptions,
  JobHistoryOptions,
  MapResponseOptions,
  QdrantPointOptions,
  ScrapeResponseOptions,
  SearchResultOptions,
} from './fixtures';
// Fixture generators
export {
  createBatchStatus,
  createCrawlStatus,
  createCredentials,
  createExtractResponse,
  createJobHistoryEntry,
  createJobHistoryFile,
  createMapResponse,
  createQdrantPoint,
  createQdrantPoints,
  createScrapeResponse,
  createSearchResponse,
  createSearchResult,
} from './fixtures';
// Lifecycle utilities
export {
  createTestContext,
  flushPromises,
  setupConsoleSpy,
  setupCwdMock,
  setupEnvVars,
  setupFakeTimers,
  setupFileSystemMocks,
  setupTestLifecycle,
  withEnv,
} from './lifecycle';
export type {
  MockContainerConfig,
  MockEmbedPipelineConfig,
} from './mock-setup';
// Mock setup utilities
export {
  createMockContainer,
  createMockEmbedPipeline,
  createMockFirecrawlClient,
  createMockQdrantService,
  setupFsMocks,
  setupOsMocks,
} from './mock-setup';
// Module mock utilities
export {
  connectCommandToOutput,
  mockBatchModule,
  mockCommandModule,
  mockCrawlEmbedModule,
  mockCrawlExecuteModule,
  mockCrawlFormatModule,
  mockCrawlPollingModule,
  mockCredentialsModule,
  mockDeleteModule,
  mockExtractModule,
  mockJobHistoryModule,
  mockJobModule,
  mockOutputModule,
  mockSettingsModule,
  setupCommonCommandMocks,
  setupCrawlCommandMocks,
} from './module-mocks';
export type { ConsoleCapture, ExitCodeCapture } from './process';
// Process utilities
export {
  createConsoleSpy,
  setupCommandTestCapture,
  setupConsoleCapture,
  setupExitCodeCapture,
  withConsoleCapture,
  withExitCodeCapture,
  withSuppressedConsole,
} from './process';
