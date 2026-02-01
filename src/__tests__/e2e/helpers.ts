/**
 * E2E test helpers for CLI testing
 */

import { spawnSync } from 'node:child_process';
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const CLI_PATH = resolve(__dirname, '../../../dist/index.js');
export const TEST_SERVER_URL = 'http://127.0.0.1:4321';

/**
 * Result from running the CLI
 */
export interface CLIResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * Run the CLI with the given arguments
 */
export async function runCLI(
  args: string[],
  options: {
    env?: Record<string, string>;
    input?: string;
    timeout?: number;
    cwd?: string;
  } = {}
): Promise<CLIResult> {
  const { env = {}, input, timeout = 30000, cwd } = options;

  const tmpDir = mkdtempSync(join(tmpdir(), 'firecrawl-cli-'));
  const stdoutPath = join(tmpDir, 'stdout.txt');
  const stderrPath = join(tmpDir, 'stderr.txt');

  const stdoutFd = openSync(stdoutPath, 'w');
  const stderrFd = openSync(stderrPath, 'w');

  try {
    const result = spawnSync('node', [CLI_PATH, ...args], {
      env: {
        ...process.env,
        // Ensure no local config interferes
        FIRECRAWL_API_KEY: '',
        FIRECRAWL_API_URL: '',
        TEI_URL: '',
        QDRANT_URL: '',
        // Override with test-specific env
        ...env,
      },
      cwd: cwd || process.cwd(),
      input,
      timeout,
      stdio: ['pipe', stdoutFd, stderrFd],
    });

    const stdout = readFileSync(stdoutPath, 'utf-8');
    const stderr = readFileSync(stderrPath, 'utf-8');

    return {
      stdout,
      stderr,
      exitCode: result.status,
    };
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Run CLI expecting success (exit code 0)
 */
export async function runCLISuccess(
  args: string[],
  options: Parameters<typeof runCLI>[1] = {}
): Promise<CLIResult> {
  const result = await runCLI(args, options);
  if (result.exitCode !== 0) {
    throw new Error(
      `CLI failed with exit code ${result.exitCode}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
    );
  }
  return result;
}

/**
 * Run CLI expecting failure (non-zero exit code)
 */
export async function runCLIFailure(
  args: string[],
  options: Parameters<typeof runCLI>[1] = {}
): Promise<CLIResult> {
  const result = await runCLI(args, options);
  if (result.exitCode === 0) {
    throw new Error(
      `CLI unexpectedly succeeded\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
    );
  }
  return result;
}

/**
 * Parse JSON from CLI output, handling potential non-JSON prefixes
 */
export function parseJSONOutput<T = unknown>(output: string): T {
  // Find the first { or [ in the output
  const jsonStart = output.search(/[{[]/);
  if (jsonStart === -1) {
    throw new Error(`No JSON found in output: ${output}`);
  }
  const jsonStr = output.slice(jsonStart);
  return JSON.parse(jsonStr);
}

/**
 * Check if the test server is running
 */
export async function isTestServerRunning(): Promise<boolean> {
  try {
    const response = await fetch(TEST_SERVER_URL, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Wait for the test server to be available
 */
export async function waitForTestServer(
  maxAttempts = 10,
  delayMs = 500
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    if (await isTestServerRunning()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`Test server not available at ${TEST_SERVER_URL}`);
}

/**
 * Get a valid test API key (for tests that need real API access)
 */
export function getTestApiKey(): string | undefined {
  return process.env.TEST_FIRECRAWL_API_KEY || process.env.FIRECRAWL_API_KEY;
}

/**
 * Check if we have API credentials for integration tests
 */
export function hasApiCredentials(): boolean {
  return Boolean(getTestApiKey());
}

/**
 * Skip test if no API credentials
 */
export function skipWithoutApiCredentials(): void {
  if (!hasApiCredentials()) {
    throw new Error('Skipping: No API credentials available');
  }
}

/**
 * Create a temporary test directory
 */
export async function createTempDir(): Promise<string> {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return mkdtemp(join(tmpdir(), 'firecrawl-e2e-'));
}

/**
 * Clean up a temporary test directory
 */
export async function cleanupTempDir(dir: string): Promise<void> {
  const { rm } = await import('node:fs/promises');
  await rm(dir, { recursive: true, force: true });
}
