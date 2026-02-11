/**
 * Logout command implementation
 * Clears stored credentials
 */

import { getAuthSource, isAuthenticated } from '../utils/auth';
import { deleteCredentials, loadCredentials } from '../utils/credentials';
import { fmt, icons } from '../utils/theme';

/**
 * Main logout command handler
 */
export async function handleLogoutCommand(): Promise<void> {
  const credentials = loadCredentials();
  const hasStoredCredentials = Boolean(credentials?.apiKey);
  const authSource = getAuthSource();

  if (!hasStoredCredentials) {
    if (authSource === 'env' && isAuthenticated()) {
      console.log(
        fmt.dim(
          'No stored credentials found. Authentication is from environment.'
        )
      );
      console.log(fmt.dim('Unset FIRECRAWL_API_KEY to fully log out.'));
      return;
    }

    console.log(fmt.dim('No credentials found. You are not logged in.'));
    return;
  }

  try {
    deleteCredentials();

    if (authSource === 'env') {
      console.log(
        fmt.success(
          `${icons.success} Stored credentials cleared (environment authentication still active)`
        )
      );
      console.log(fmt.dim('Unset FIRECRAWL_API_KEY to fully log out.'));
      return;
    }

    console.log(fmt.success(`${icons.success} Logged out successfully`));
  } catch (error) {
    console.error(
      fmt.error(
        `Error logging out: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    );
    process.exit(1);
  }
}

import { Command } from 'commander';

/**
 * Create and configure the logout command
 */
export function createLogoutCommand(): Command {
  const logoutCmd = new Command('logout')
    .description('Logout and clear stored credentials')
    .action(async () => {
      await handleLogoutCommand();
    });

  return logoutCmd;
}
