/**
 * Logout command implementation
 * Clears stored credentials
 */

import { deleteCredentials, loadCredentials } from '../utils/credentials';
import { fmt, icons } from '../utils/theme';

/**
 * Main logout command handler
 */
export async function handleLogoutCommand(): Promise<void> {
  const credentials = loadCredentials();

  if (!credentials || !credentials.apiKey) {
    console.log(fmt.dim('No credentials found. You are not logged in.'));
    return;
  }

  try {
    deleteCredentials();

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
