/**
 * E2E test helpers for CLI testing
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { resolve } from 'node:path';

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

  return new Promise((resolve, reject) => {
    const child = spawn('node', [CLI_PATH, ...args], {
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
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    if (input) {
      child.stdin.write(input);
      child.stdin.end();
    }

    const timeoutId = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`CLI timed out after ${timeout}ms`));
    }, timeout);

    child.on('close', (code) => {
      clearTimeout(timeoutId);
      resolve({
        stdout,
        stderr,
        exitCode: code,
      });
    });

    child.on('error', (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
  });
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
