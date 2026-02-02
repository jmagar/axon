/**
 * Authentication utilities for CLI authentication flow
 *
 * Note: This module uses legacy config functions (getConfig, updateConfig)
 * because it runs before container initialization during the login flow.
 * The interactive authentication system is orthogonal to the DI container
 * and would require major refactoring to migrate.
 */

import * as readline from 'node:readline';
import { DEFAULT_API_URL, getConfig, updateConfig } from './config';
import { saveCredentials } from './credentials';

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
  const orange = '\x1b[38;5;208m';
  const reset = '\x1b[0m';
  const dim = '\x1b[2m';
  const bold = '\x1b[1m';

  // Get version from package.json
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const packageJson = require('../../package.json');
  const version = packageJson.version || 'unknown';

  console.log('');
  console.log(
    `  ${orange}🔥 ${bold}firecrawl${reset} ${dim}cli${reset} ${dim}v${version}${reset}`
  );
  console.log(`  ${dim}Turn websites into LLM-ready data${reset}`);
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
    console.log('Using FIRECRAWL_API_KEY from environment variable\n');
    return envResult;
  }

  printBanner();
  console.log('Welcome! To get started, provide your Firecrawl API key.\n');
  console.log(
    'Tip: You can also set FIRECRAWL_API_KEY and FIRECRAWL_API_URL environment variables\n'
  );

  return manualLogin();
}

/**
 * Export banner for use in other places
 */
export { printBanner };

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
  const apiKey = getConfig().apiKey;
  return !!apiKey && apiKey.length > 0;
}

/**
 * Ensure user is authenticated before running a command
 * If not authenticated, prompts for login
 * Returns the API key
 */
export async function ensureAuthenticated(): Promise<string> {
  // Check if we already have credentials
  const existingKey = getConfig().apiKey;
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

    // Update global config
    updateConfig({
      apiKey: result.apiKey,
      apiUrl: result.apiUrl,
    });

    console.log('\n✓ Login successful!');

    return result.apiKey;
  } catch (error) {
    console.error(
      '\nAuthentication failed:',
      error instanceof Error ? error.message : 'Unknown error'
    );
    process.exit(1);
  }
}

/**
 * Export for direct login command usage
 */
export { manualLogin, interactiveLogin };
