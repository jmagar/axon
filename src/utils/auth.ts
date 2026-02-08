/**
 * Authentication utilities for CLI authentication flow.
 *
 * This module is stateless and resolves auth from:
 * explicit API key -> env var -> stored credentials.
 */

import * as readline from 'node:readline';
import { loadCredentials, saveCredentials } from './credentials';
import { DEFAULT_API_URL } from './defaults';
import { fmt, icons } from './theme';

/**
 * Prompt for input
 */
function promptInput(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer: string) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Perform manual API key login
 */
async function manualLogin(): Promise<{ apiKey: string; apiUrl: string }> {
  console.log('');
  const apiKey = await promptInput('Enter your Firecrawl API key: ');

  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error('API key cannot be empty');
  }

  const apiUrl = await promptInput(
    `Enter API URL (default: ${DEFAULT_API_URL}): `
  );

  return {
    apiKey: apiKey.trim(),
    apiUrl: apiUrl.trim() || DEFAULT_API_URL,
  };
}

/**
 * Use environment variable for authentication
 */
function envVarLogin(): { apiKey: string; apiUrl: string } | null {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (apiKey && apiKey.length > 0) {
    return {
      apiKey,
      apiUrl: process.env.FIRECRAWL_API_URL || DEFAULT_API_URL,
    };
  }
  return null;
}

/**
 * Print the Firecrawl CLI banner
 */
function printBanner(): void {
  // Get version from package.json
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const packageJson = require('../../package.json');
  const version = packageJson.version || 'unknown';

  console.log('');
  console.log(
    `  ${fmt.primary(`${icons.success} firecrawl`)} ${fmt.dim('cli')} ${fmt.dim(`v${version}`)}`
  );
  console.log(`  ${fmt.dim('Turn websites into LLM-ready data')}`);
  console.log('');
}

/**
 * Interactive login flow — prompts for API key and URL
 */
async function interactiveLogin(): Promise<{
  apiKey: string;
  apiUrl: string;
}> {
  // First check if env var is set
  const envResult = envVarLogin();
  if (envResult) {
    printBanner();
    console.log(fmt.dim('Using FIRECRAWL_API_KEY from environment variable\n'));
    return envResult;
  }

  printBanner();
  console.log(
    fmt.dim('Welcome! To get started, provide your Firecrawl API key.\n')
  );
  console.log(
    fmt.dim(
      'Tip: You can also set FIRECRAWL_API_KEY and FIRECRAWL_API_URL environment variables\n'
    )
  );

  return manualLogin();
}

/**
 * Export banner for use in other places
 */
export { printBanner };

function normalizeApiKey(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveApiKey(explicitApiKey?: string): string | undefined {
  const stored = loadCredentials();
  return (
    normalizeApiKey(explicitApiKey) ||
    normalizeApiKey(process.env.FIRECRAWL_API_KEY) ||
    normalizeApiKey(stored?.apiKey)
  );
}

export type AuthSource = 'explicit' | 'env' | 'stored' | 'none';

export function getAuthSource(explicitApiKey?: string): AuthSource {
  if (normalizeApiKey(explicitApiKey)) {
    return 'explicit';
  }
  if (normalizeApiKey(process.env.FIRECRAWL_API_KEY)) {
    return 'env';
  }
  if (normalizeApiKey(loadCredentials()?.apiKey)) {
    return 'stored';
  }
  return 'none';
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(explicitApiKey?: string): boolean {
  return Boolean(resolveApiKey(explicitApiKey));
}

/**
 * Ensure user is authenticated before running a command
 * If not authenticated, prompts for login
 * Returns the API key
 */
export async function ensureAuthenticated(
  explicitApiKey?: string
): Promise<string> {
  // Check if we already have credentials
  const existingKey = resolveApiKey(explicitApiKey);
  if (existingKey) {
    return existingKey;
  }

  // No credentials found - prompt for login
  try {
    const result = await interactiveLogin();

    // Save credentials
    saveCredentials({
      apiKey: result.apiKey,
      apiUrl: result.apiUrl,
    });

    console.log(`\n${fmt.success(`${icons.success} Login successful!`)}`);

    return result.apiKey;
  } catch (error) {
    console.error(
      fmt.error(
        `Authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    );
    process.exit(1);
  }
}

/**
 * Export for direct login command usage
 */
export { manualLogin, interactiveLogin };
