/**
 * Test helper utilities for process-level operations
 *
 * Provides helpers for managing process.exitCode, console output, and other process state
 */

import { afterEach, beforeEach, vi } from 'vitest';

/**
 * Result from capturing process exit code
 */
export interface ExitCodeCapture {
  getExitCode: () => number | undefined;
  resetExitCode: () => void;
}

/**
 * Setup exit code capture for tests
 *
 * Resets exitCode before each test and captures value after
 *
 * @returns Object with methods to get and reset exit code
 */
export function setupExitCodeCapture(): ExitCodeCapture {
  let capturedExitCode: number | undefined;

  beforeEach(() => {
    process.exitCode = 0; // Reset before each test
  });

  afterEach(() => {
    capturedExitCode =
      typeof process.exitCode === 'number' ? process.exitCode : undefined;
    process.exitCode = 0; // Reset after each test
  });

  return {
    getExitCode: () => capturedExitCode,
    resetExitCode: () => {
      process.exitCode = 0;
      capturedExitCode = undefined;
    },
  };
}

/**
 * Execute function with exit code capture and automatic cleanup
 *
 * @param fn - Function to execute
 * @returns Tuple of [result, exitCode]
 */
export async function withExitCodeCapture<T>(
  fn: () => T | Promise<T>
): Promise<[T, number | undefined]> {
  const originalExitCode = process.exitCode;
  process.exitCode = 0;

  try {
    const result = await fn();
    return [result, process.exitCode];
  } finally {
    process.exitCode = originalExitCode;
  }
}

/**
 * Result from capturing console output
 */
export interface ConsoleCapture {
  logs: string[];
  errors: string[];
  warnings: string[];
  mockLog: ReturnType<typeof vi.spyOn>;
  mockError: ReturnType<typeof vi.spyOn>;
  mockWarn: ReturnType<typeof vi.spyOn>;
  restore: () => void;
}

/**
 * Setup console output capture
 *
 * Captures console.log, console.error, and console.warn calls
 *
 * @returns Object with captured output and mock functions
 */
export function setupConsoleCapture(): ConsoleCapture {
  const logs: string[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  const mockLog = vi.spyOn(console, 'log').mockImplementation((...args) => {
    logs.push(args.join(' '));
  });

  const mockError = vi.spyOn(console, 'error').mockImplementation((...args) => {
    errors.push(args.join(' '));
  });

  const mockWarn = vi.spyOn(console, 'warn').mockImplementation((...args) => {
    warnings.push(args.join(' '));
  });

  return {
    logs,
    errors,
    warnings,
    mockLog,
    mockError,
    mockWarn,
    restore: () => {
      mockLog.mockRestore();
      mockError.mockRestore();
      mockWarn.mockRestore();
    },
  };
}

/**
 * Execute function with console capture
 *
 * @param fn - Function to execute
 * @returns Tuple of [result, consoleLogs, consoleErrors]
 */
export async function withConsoleCapture<T>(
  fn: () => T | Promise<T>
): Promise<[T, string[], string[]]> {
  const logs: string[] = [];
  const errors: string[] = [];

  const mockLog = vi.spyOn(console, 'log').mockImplementation((...args) => {
    logs.push(args.join(' '));
  });

  const mockError = vi.spyOn(console, 'error').mockImplementation((...args) => {
    errors.push(args.join(' '));
  });

  try {
    const result = await fn();
    return [result, logs, errors];
  } finally {
    mockLog.mockRestore();
    mockError.mockRestore();
  }
}

/**
 * Create a console spy
 *
 * Useful for single-test console spying. Remember to call `.mockRestore()` when done.
 *
 * @param method - Console method to spy on
 * @returns Mock spy function
 */
export function createConsoleSpy(
  method: 'log' | 'error' | 'warn' | 'info' | 'debug' = 'error'
): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(console, method).mockImplementation(() => {});
}

/**
 * Execute function with temporary console suppression
 *
 * Suppresses all console output during function execution
 *
 * @param fn - Function to execute
 * @returns Function result
 */
export async function withSuppressedConsole<T>(
  fn: () => T | Promise<T>
): Promise<T> {
  const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});
  const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});
  const mockWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

  try {
    return await fn();
  } finally {
    mockLog.mockRestore();
    mockError.mockRestore();
    mockWarn.mockRestore();
  }
}

/**
 * Setup exit code and console capture together
 *
 * Common pattern for command tests that check both exit codes and console output
 *
 * @returns Object with exit code and console capture utilities
 */
export function setupCommandTestCapture() {
  const exitCodeCapture = setupExitCodeCapture();
  const logs: string[] = [];
  const errors: string[] = [];

  let mockLog = vi.spyOn(console, 'log').mockImplementation((...args) => {
    logs.push(args.join(' '));
  });

  let mockError = vi.spyOn(console, 'error').mockImplementation((...args) => {
    errors.push(args.join(' '));
  });

  beforeEach(() => {
    // Re-create spies for each test after previous cleanup
    mockLog = vi.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });

    mockError = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args.join(' '));
    });
  });

  afterEach(() => {
    logs.length = 0;
    errors.length = 0;
    mockLog.mockRestore();
    mockError.mockRestore();
  });

  return {
    ...exitCodeCapture,
    logs,
    errors,
    get mockLog() {
      return mockLog;
    },
    get mockError() {
      return mockError;
    },
  };
}
