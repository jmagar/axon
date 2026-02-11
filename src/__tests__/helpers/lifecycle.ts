/**
 * Test helper utilities for test lifecycle management
 *
 * Provides reusable setup/teardown patterns to reduce duplication across test files
 */

import { afterEach, beforeEach, vi } from 'vitest';

/**
 * Setup environment variable isolation for tests
 *
 * @param envVars - Object containing environment variables to set
 * @returns Cleanup function to restore original env vars
 */
export function setupEnvVars(
  envVars: Record<string, string | undefined>
): () => void {
  const originalEnv: Record<string, string | undefined> = {};

  // Save original values
  for (const key of Object.keys(envVars)) {
    originalEnv[key] = process.env[key];
  }

  // Set new values
  for (const [key, value] of Object.entries(envVars)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  // Return cleanup function
  return () => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

/**
 * Setup standard test lifecycle hooks with mock clearing
 *
 * Call this in describe blocks to automatically setup beforeEach/afterEach
 *
 * @param beforeEachFn - Optional function to run before each test
 * @param afterEachFn - Optional function to run after each test
 */
export function setupTestLifecycle(
  beforeEachFn?: () => void | Promise<void>,
  afterEachFn?: () => void | Promise<void>
) {
  beforeEach(async () => {
    vi.clearAllMocks();
    await beforeEachFn?.();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await afterEachFn?.();
  });
}

// Note: Module mocks must be set up at the top level before imports
// Use vi.mock() directly in your test file, not as a function call
// See module-mocks.ts for reusable mock factory functions

/**
 * Setup console spy with automatic cleanup
 *
 * @param methods - Console methods to spy on (default: ['log', 'error', 'warn'])
 * @returns Object containing spy functions and cleanup
 */
export function setupConsoleSpy(
  methods: Array<'log' | 'error' | 'warn' | 'info' | 'debug'> = [
    'log',
    'error',
    'warn',
  ]
): {
  spies: Record<string, ReturnType<typeof vi.spyOn>>;
  cleanup: () => void;
} {
  const spies: Record<string, ReturnType<typeof vi.spyOn>> = {};

  for (const method of methods) {
    spies[method] = vi.spyOn(console, method).mockImplementation(() => {});
  }

  const cleanup = () => {
    for (const spy of Object.values(spies)) {
      spy.mockRestore();
    }
  };

  return { spies, cleanup };
}

/**
 * Setup timer mocks with automatic cleanup
 *
 * @returns Cleanup function to restore real timers
 */
export function setupFakeTimers(): () => void {
  vi.useFakeTimers();
  return () => {
    vi.useRealTimers();
  };
}

/**
 * Setup process.cwd mock with automatic cleanup
 *
 * @param mockPath - Mock path to return from process.cwd()
 * @returns Cleanup function to restore original process.cwd
 */
export function setupCwdMock(mockPath: string): () => void {
  const originalCwd = process.cwd;
  process.cwd = vi.fn(() => mockPath) as () => string;
  return () => {
    process.cwd = originalCwd;
  };
}

/**
 * Create a test context with common setup and teardown
 *
 * @param setup - Setup function to run before each test
 * @param teardown - Teardown function to run after each test
 * @returns Object with beforeEach and afterEach hooks configured
 */
export function createTestContext<T>(
  setup: () => T | Promise<T>,
  teardown?: (context: T) => void | Promise<void>
) {
  let context: T;

  beforeEach(async () => {
    vi.clearAllMocks();
    context = await setup();
  });

  afterEach(async () => {
    if (teardown) {
      await teardown(context);
    }
    vi.clearAllMocks();
  });

  return {
    getContext: () => {
      if (context === undefined) {
        throw new Error(
          'Test context not initialized - ensure beforeEach has run'
        );
      }
      return context;
    },
  };
}

/**
 * Wait for all pending promises to resolve
 *
 * Useful in tests to ensure async operations complete
 */
export async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

/**
 * Run function with temporary environment variables
 *
 * @param envVars - Environment variables to set temporarily
 * @param fn - Function to run with modified env
 * @returns Result of the function
 */
export async function withEnv<T>(
  envVars: Record<string, string | undefined>,
  fn: () => T | Promise<T>
): Promise<T> {
  const cleanup = setupEnvVars(envVars);
  try {
    return await fn();
  } finally {
    cleanup();
  }
}

/**
 * Setup standard file system mocks for tests
 *
 * @param homedir - Mock home directory path
 * @param cwd - Mock current working directory path
 * @returns Object containing cleanup functions and mock refs
 */
export function setupFileSystemMocks(
  homedir = '/home/testuser',
  cwd = '/test/working/directory'
) {
  const originalCwd = process.cwd;
  const originalFirecrawlHome = process.env.FIRECRAWL_HOME;

  // Setup mocks
  vi.doMock('node:os', () => ({
    homedir: vi.fn(() => homedir),
  }));

  process.cwd = vi.fn(() => cwd) as () => string;
  delete process.env.FIRECRAWL_HOME;

  // Return cleanup function
  return {
    cleanup: () => {
      process.cwd = originalCwd;
      if (originalFirecrawlHome === undefined) {
        delete process.env.FIRECRAWL_HOME;
      } else {
        process.env.FIRECRAWL_HOME = originalFirecrawlHome;
      }
      vi.doUnmock('node:os');
    },
    setFirecrawlHome: (path: string | undefined) => {
      if (path === undefined) {
        delete process.env.FIRECRAWL_HOME;
      } else {
        process.env.FIRECRAWL_HOME = path;
      }
    },
  };
}
