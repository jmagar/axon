/**
 * Login command implementation
 * Handles API key entry for authentication
 */

import { interactiveLogin, isAuthenticated } from '../utils/auth';
import { DEFAULT_API_URL } from '../utils/config';
import { getConfigDirectoryPath, saveCredentials } from '../utils/credentials';

export interface LoginOptions {
  apiKey?: string;
  apiUrl?: string;
}

/**
 * Main login command handler
 */
export async function handleLoginCommand(
  options: LoginOptions = {}
): Promise<void> {
  const apiUrl = options.apiUrl?.replace(/\/$/, '') || DEFAULT_API_URL;

  // If already authenticated, let them know
  if (isAuthenticated() && !options.apiKey) {
    console.log('You are already logged in.');
    console.log(`Credentials stored at: ${getConfigDirectoryPath()}`);
    console.log('\nTo login with a different account, run:');
    console.log('  firecrawl logout');
    console.log('  firecrawl login');
    return;
  }

  // If API key provided directly, save it
  if (options.apiKey) {
    try {
      saveCredentials({
        apiKey: options.apiKey,
        apiUrl: apiUrl,
      });
      console.log('✓ Login successful!');
    } catch (error) {
      console.error(
        'Error saving credentials:',
        error instanceof Error ? error.message : 'Unknown error'
      );
      process.exit(1);
    }
    return;
  }

  try {
    const result = await interactiveLogin();

    // Save credentials
    saveCredentials({
      apiKey: result.apiKey,
      apiUrl: result.apiUrl || apiUrl,
    });

    console.log('\n✓ Login successful!');
  } catch (error) {
    console.error(
      '\nError:',
      error instanceof Error ? error.message : 'Unknown error'
    );
    process.exit(1);
  }
}

import { Command } from 'commander';

/**
 * Create and configure the login command
 */
export function createLoginCommand(): Command {
  const loginCmd = new Command('login')
    .description('Login to Firecrawl (alias for config)')
    .option(
      '-k, --api-key <key>',
      'Provide API key directly (skips interactive flow)'
    )
    .option('--api-url <url>', 'API URL (default: https://api.firecrawl.dev)')
    .action(async (options) => {
      await handleLoginCommand({
        apiKey: options.apiKey,
        apiUrl: options.apiUrl,
      });
    });

  return loginCmd;
}
