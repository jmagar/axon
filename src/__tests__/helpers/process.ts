/**
 * Test helper utilities for process-level operations
 *
 * Provides helpers for managing process.exitCode, console output, and other process state
 */

import { afterEach, beforeEach, vi } from 'vitest';

type ConsoleMethod = 'log' | 'error' | 'warn' | 'info' | 'debug';

function createConsoleMethodSpy(
  method: ConsoleMethod,
  sink?: string[]
): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(console, method).mockImplementation((...args) => {
    if (sink) {
      sink.push(args.join(' '));
    }
  });
}

function setupConsoleSpies(
  methods: ConsoleMethod[],
  sinks: Partial<Record<ConsoleMethod, string[]>> = {}
): Record<ConsoleMethod, ReturnType<typeof vi.spyOn>> {
  const entries = methods.map((method) => [
    method,
    createConsoleMethodSpy(method, sinks[method]),
  ]);
  return Object.fromEntries(entries) as Record<
    ConsoleMethod,
    ReturnType<typeof vi.spyOn>
  >;
}

function restoreConsoleSpies(
  spies: Partial<Record<ConsoleMethod, ReturnType<typeof vi.spyOn>>>
): void {
  Object.values(spies).forEach((spy) => {
    spy?.mockRestore();
  });
}

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

  const spies = setupConsoleSpies(['log', 'error', 'warn'], {
    log: logs,
    error: errors,
    warn: warnings,
  });

  return {
    logs,
    errors,
    warnings,
    mockLog: spies.log,
    mockError: spies.error,
    mockWarn: spies.warn,
    restore: () => {
      restoreConsoleSpies(spies);
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

  const spies = setupConsoleSpies(['log', 'error'], {
    log: logs,
    error: errors,
  });

  try {
    const result = await fn();
    return [result, logs, errors];
  } finally {
    restoreConsoleSpies(spies);
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
  return createConsoleMethodSpy(method);
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
  const spies = setupConsoleSpies(['log', 'error', 'warn']);

  try {
    return await fn();
  } finally {
    restoreConsoleSpies(spies);
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

  let spies = {} as Record<ConsoleMethod, ReturnType<typeof vi.spyOn>>;

  beforeEach(() => {
    // Re-create spies for each test after previous cleanup.
    spies = setupConsoleSpies(['log', 'error'], {
      log: logs,
      error: errors,
    });
  });

  afterEach(() => {
    logs.length = 0;
    errors.length = 0;
    restoreConsoleSpies(spies);
  });

  return {
    ...exitCodeCapture,
    logs,
    errors,
    get mockLog() {
      return spies.log;
    },
    get mockError() {
      return spies.error;
    },
  };
}
